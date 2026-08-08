/* 03-zoom-and-touch.js — part of OpenLiteraReader.
   Zoom (buttons/wheel/pinch/double-tap) and the single-tap-to-toggle-HUD gesture.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- commit a zoom around a screen point (buttons/dbl-tap/wheel) ---------- */
function zoomAbout(fx, fy, factor){
  const nz=Math.min(ZMAX,Math.max(ZMIN, zoom*factor));
  const s=nz/zoom;
  if(s===1) return;

  /* Anchor on the actual page under the focal point rather than on
     pagesWrap's own edge. A .pageBox is centred with margin:0 auto while
     it's narrower than the viewer; that margin collapses to 0 once
     zooming makes it wider than the viewer, a shift pagesWrap's own
     offset never reflected — so scroll compensation based on it was
     right at first and drifted a little further off-centre with every
     step once pages grew past the viewer's width. Measuring the
     reference page's own rect before and after the resize sidesteps that
     entirely, since it reads the browser's real layout instead of
     assuming how the centring math works. */
  const vr=viewerRect();
  const screenX=vr.left+fx, screenY=vr.top+fy;
  let ref=null;
  for(const b of pageBoxes){
    const r=b.getBoundingClientRect();
    if(screenY>=r.top && screenY<=r.bottom){ ref=b; break; }
  }
  if(!ref) ref=pageBoxes.find(b=>b.getBoundingClientRect().bottom>vr.top)||pageBoxes[0];
  if(!ref){ zoom=nz; applyZoomWidths(); renderVisibleNow(); scheduleRerender(); return; }

  const before=ref.getBoundingClientRect();
  const relX=screenX-before.left, relY=screenY-before.top;

  zoom=nz; applyZoomWidths();

  const after=ref.getBoundingClientRect();
  const newScreenX=after.left+relX*s, newScreenY=after.top+relY*s;
  viewer.scrollLeft=Math.max(0, viewer.scrollLeft+(newScreenX-screenX));
  viewer.scrollTop =Math.max(0, viewer.scrollTop +(newScreenY-screenY));
  renderVisibleNow(); scheduleRerender();
}
viewer.addEventListener('wheel',e=>{
  if(e.ctrlKey){
    e.preventDefault();
    const r=viewer.getBoundingClientRect();
    zoomAbout(e.clientX-r.left, e.clientY-r.top, e.deltaY<0?1.12:1/1.12);
  }
},{passive:false});

/* ---------- PINCH: live GPU transform, bake on release (smooth) ---------- */
const pointers=new Map();
let pinching=false, didPinch=false;
let startDist=0, startZoom=1, sL0=0, sT0=0, OX0=0, OY0=0;
let liveS=1, liveTX=0, liveTY=0, rafPending=false;
let fCX=0, fCY=0;

function viewerRect(){ return viewer.getBoundingClientRect(); }

viewer.addEventListener('pointerdown',e=>{
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){
    const [a,b]=[...pointers.values()];
    startDist=Math.hypot(a.x-b.x,a.y-b.y);
    startZoom=zoom;
    sL0=viewer.scrollLeft; sT0=viewer.scrollTop;
    OX0=pagesWrap.offsetLeft; OY0=pagesWrap.offsetTop;
    pinching=true; didPinch=true;
    clearTimeout(lpTimer); lpTimer=null;
    document.body.classList.remove('selecting');
    document.body.classList.add('pinching');
  }
});
viewer.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinching && pointers.size===2){
    e.preventDefault();
    const [a,b]=[...pointers.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    const rect=viewerRect();
    fCX=(a.x+b.x)/2-rect.left;
    fCY=(a.y+b.y)/2-rect.top;
    // clamp so committed zoom stays within range
    let s=d/startDist;
    s=Math.min(ZMAX/startZoom, Math.max(ZMIN/startZoom, s));
    liveS=s;
    const ax=fCX-OX0+sL0, ay=fCY-OY0+sT0;
    liveTX=ax*(1-s); liveTY=ay*(1-s);
    if(!rafPending){
      rafPending=true;
      requestAnimationFrame(()=>{
        rafPending=false;
        pagesWrap.style.transform=
          'translate3d('+liveTX+'px,'+liveTY+'px,0) scale('+liveS+')';
        $('#zoomPct').textContent=Math.round(startZoom*liveS*100)+'%';
      });
    }
  }
},{passive:false});

function endPinch(){
  if(!pinching) return;
  pinching=false;
  document.body.classList.remove('pinching');
  const factor=liveS;
  pagesWrap.style.transform='';
  liveS=1; liveTX=0; liveTY=0;
  zoomAbout(fCX, fCY, factor);
}
['pointerup','pointercancel','pointerleave'].forEach(ev=>
  viewer.addEventListener(ev,e=>{
    pointers.delete(e.pointerId);
    if(pinching && pointers.size<2) endPinch();
    if(pointers.size===0) setTimeout(()=>didPinch=false,60);
  }));

/* ---------- tap: single = toggle HUD, double = zoom ---------- */
let tapTimer=null, lastTapAt=0, tapStart=null;
viewer.addEventListener('pointerdown',e=>{ tapStart={x:e.clientX,y:e.clientY,t:Date.now()}; });
viewer.addEventListener('pointerup',e=>{
  if(!tapStart) return;
  const fromMouse = e.pointerType==='mouse';
  const moved=Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y)>10;
  const slow=Date.now()-tapStart.t>350;
  tapStart=null;
  if(moved||slow||didPinch||pointers.size>0) return;
  const sel=window.getSelection();
  if(sel && !sel.isCollapsed) return;

  const now=Date.now();
  if(now-lastTapAt<300){
    clearTimeout(tapTimer); lastTapAt=0;
    /* Only the zoom half is skipped in select/quick-translate mode: a
       double-tap there is almost always aimed at picking a second word,
       and letting it zoom instead used to race the browser's own
       double-tap word-select and tear down the text layer mid-selection.
       A single tap toggling the HUD doesn't have that conflict. */
    if(selectMode||quickTrans||dictMode) return;
    const r=viewerRect();
    zoomAbout(e.clientX-r.left, e.clientY-r.top, zoom>1.1 ? (1/zoom) : 2);
    return;
  }
  lastTapAt=now;
  clearTimeout(tapTimer);
  tapTimer=setTimeout(()=>{
    if(!settings.tapHud || fromMouse) return;
    if(sheet.classList.contains('open')||sidebar.classList.contains('open')) return;
    document.body.classList.toggle('hud-hidden');
  },300);
});

/* ---------- text selection: freeze scroll so drags select instead of scroll ---------- */
let lpTimer=null, hadSelection=false;
function freezeScroll(on){ document.body.classList.toggle('selecting', on); }
function selectionActive(){
  const s=window.getSelection();
  if(!s || s.isCollapsed) return false;
  const el=s.anchorNode && (s.anchorNode.nodeType===1 ? s.anchorNode : s.anchorNode.parentElement);
  return !!(el && el.closest && el.closest('.textLayer,.transLayer'));
}

/* hold still ~260ms with one finger -> assume you want to select: stop the page
   from scrolling so the browser's long-press selection works cleanly */
viewer.addEventListener('pointerdown',e=>{
  if(selectMode || e.pointerType==='mouse') return;
  if(pointers.size===1){
    clearTimeout(lpTimer);
    lpTimer=setTimeout(()=>{ if(!pinching) freezeScroll(true); }, 260);
  }
});
viewer.addEventListener('pointermove',e=>{
  if(lpTimer && tapStart){
    if(Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y)>10){
      clearTimeout(lpTimer); lpTimer=null;
      if(!selectionActive()) freezeScroll(false);   // a real scroll -> let it scroll
    }
  }
});
['pointerup','pointercancel'].forEach(ev=>viewer.addEventListener(ev,()=>{
  clearTimeout(lpTimer); lpTimer=null;
  setTimeout(()=>{ if(!selectionActive()) freezeScroll(false); }, 60);
}));

/* keep scroll frozen the whole time a selection exists; release when it's cleared */
document.addEventListener('selectionchange',()=>{
  if(selectionActive()){ hadSelection=true; freezeScroll(true); }
  else if(hadSelection){ hadSelection=false; freezeScroll(false); }
  scheduleQuickTranslate();
  scheduleDictLookup();
});
