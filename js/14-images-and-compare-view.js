/* 14-images-and-compare-view.js — part of OpenLiteraReader.
   Detects images/photos on a page so they keep their real colours in dark mode, plus the side-by-side "compare" view.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------------- where the translation is shown ---------------- */
const viewSeg=$('#viewSeg');
[...viewSeg.children].forEach(b=>b.classList.toggle('on',b.dataset.tview===TR.view));
viewSeg.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b||b.dataset.tview===TR.view) return;
  TR.view=b.dataset.tview; saveTR();
  [...viewSeg.children].forEach(x=>x.classList.toggle('on',x===b));
  if(TR.on){ setTranslation(false); setTranslation(true); }
});

/* ==================================================================
   PICTURES KEEP THEIR OWN COLOURS
   Dark mode inverts the whole page canvas, which turns photographs
   into negatives. The illustrated regions are found in the page's
   drawing instructions and re-drawn, unfiltered, on top.
   ================================================================== */

const imgRects=new Map();

const IMG_OPS=(function(){
  const O=(window.pdfjsLib&&pdfjsLib.OPS)||{}, set=new Set();
  ['paintImageXObject','paintInlineImageXObject','paintJpegXObject'].forEach(k=>{
    if(typeof O[k]==='number') set.add(O[k]);
  });
  return set;
})();

function unitBox(m){
  const xs=[],ys=[];
  for(const [x,y] of [[0,0],[1,0],[0,1],[1,1]]){
    xs.push(m[0]*x+m[2]*y+m[4]);
    ys.push(m[1]*x+m[3]*y+m[5]);
  }
  return {x0:Math.min.apply(null,xs),y0:Math.min.apply(null,ys),
          x1:Math.max.apply(null,xs),y1:Math.max.apply(null,ys)};
}
function mergeRects(rs){
  let out=[];
  for(let pass=0;pass<2;pass++){
    const next=[];
    for(const r of (pass?out:rs)){
      if(r.x1-r.x0<3||r.y1-r.y0<3) continue;
      let hit=null;
      for(const o of next){
        if(r.x0<o.x1+2&&r.x1>o.x0-2&&r.y0<o.y1+2&&r.y1>o.y0-2){ hit=o; break; }
      }
      if(hit){
        hit.x0=Math.min(hit.x0,r.x0); hit.y0=Math.min(hit.y0,r.y0);
        hit.x1=Math.max(hit.x1,r.x1); hit.y1=Math.max(hit.y1,r.y1);
      } else next.push({x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1});
    }
    out=next;
  }
  return out;
}

/* Walk the page's drawing instructions, tracking the current matrix, and
   note where each image lands. */
async function imageRects(page,vp){
  const key=page.pageNumber+'@'+rotation;
  if(imgRects.has(key)) return imgRects.get(key);
  let list=[];
  if(IMG_OPS.size){
    try{
      const ops=await page.getOperatorList();
      const O=pdfjsLib.OPS;
      let ctm=vp.transform.slice();
      const stack=[];
      for(let i=0;i<ops.fnArray.length;i++){
        const fn=ops.fnArray[i], a=ops.argsArray[i];
        if(fn===O.save) stack.push(ctm.slice());
        else if(fn===O.restore){ if(stack.length) ctm=stack.pop(); }
        else if(fn===O.transform) ctm=mul(ctm,a);
        else if(fn===O.paintFormXObjectBegin){ stack.push(ctm.slice()); if(a&&a[0]) ctm=mul(ctm,a[0]); }
        else if(fn===O.paintFormXObjectEnd){ if(stack.length) ctm=stack.pop(); }
        else if(IMG_OPS.has(fn)) list.push(unitBox(ctm));
      }
      list=mergeRects(list);
    }catch(e){ list=[]; }
  }
  imgRects.set(key,list);
  return list;
}

/* A page-sized, pale, colourless image is a scan of printed text — that one
   still wants inverting, or dark mode would do nothing on those pages. */
function regionStats(canvas,x,y,w,h){
  const t=document.createElement('canvas');
  t.width=32; t.height=32;
  const tx=t.getContext('2d');
  if(!tx||!tx.drawImage) return null;
  try{ tx.drawImage(canvas,x,y,w,h,0,0,32,32); }catch(e){ return null; }
  let img;
  try{ img=tx.getImageData(0,0,32,32); }catch(e){ return null; }
  const d=img.data;
  let sat=0,lum=0,n=0;
  for(let i=0;i<d.length;i+=4){
    const R=d[i],G=d[i+1],B=d[i+2];
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
    sat+=mx?(mx-mn)/mx:0;
    lum+=(R*0.299+G*0.587+B*0.114)/255;
    n++;
  }
  return n?{sat:sat/n,lum:lum/n}:null;
}

async function buildImageLayer(page,canvas,vp){
  const rects=await imageRects(page,vp);
  if(!rects.length||!canvas.width) return null;

  const s=canvas.width/vp.width;
  const keep=[];
  for(const r of rects){
    const x=Math.max(0,Math.floor(r.x0*s)), y=Math.max(0,Math.floor(r.y0*s));
    const w=Math.min(canvas.width-x,Math.ceil((r.x1-r.x0)*s));
    const h=Math.min(canvas.height-y,Math.ceil((r.y1-r.y0)*s));
    if(w<3||h<3) continue;
    /* Colourless artwork on a pale ground — a scan, a diagram, a line
       drawing — reads as text and should invert with everything else.
       Anything with colour, or anything dark, is a picture: leave it be. */
    const st=regionStats(canvas,x,y,w,h);
    if(st&&st.sat<0.08&&st.lum>0.6) continue;
    keep.push([x,y,w,h]);
  }
  if(!keep.length) return null;

  const c=document.createElement('canvas');
  c.className='imgLayer';
  c.width=canvas.width; c.height=canvas.height;
  const cx=c.getContext('2d');
  if(!cx||!cx.drawImage) return null;
  for(const [x,y,w,h] of keep){
    try{ cx.drawImage(canvas,x,y,w,h,x,y,w,h); }catch(e){}
  }
  return c;
}

$('[data-toggle="trueImages"]').addEventListener('click',()=>{
  if(!pdfDoc) return;
  rendered.clear();
  renderVisibleNow(); scheduleRerender();
});


/* ==================================================================
   COMPARE — the same page twice, original beside translation
   ================================================================== */

let mirrorBoxes=[];

function isCompare(){ return TR.on && TR.view==='compare'; }
function transBox(n){ return isCompare() ? mirrorBoxes[n-1] : pageBoxes[n-1]; }

function ensureMirrors(){
  if(mirrorBoxes.length===pageBoxes.length) return;
  mirrorBoxes=pageBoxes.map((b,i)=>{
    const m=document.createElement('div');
    m.className='pageBox mirror';
    m.dataset.page=i+1;
    return m;
  });
}

/* The right-hand page is a bitmap copy of the left, so pdf.js only ever
   renders each page once. */
function syncMirror(n){
  if(!isCompare()) return;
  const src=pageBoxes[n-1], dst=mirrorBoxes[n-1];
  if(!src||!dst) return;
  const sc=src.querySelector('canvas:not(.imgLayer)');
  if(!sc||!sc.width) return;

  let dc=dst.querySelector('canvas:not(.imgLayer)');
  if(!dc){ dc=document.createElement('canvas'); dst.insertBefore(dc,dst.firstChild); }
  if(dc.width!==sc.width||dc.height!==sc.height){ dc.width=sc.width; dc.height=sc.height; }
  const cx=dc.getContext('2d');
  if(cx&&cx.drawImage){
    try{ cx.clearRect(0,0,dc.width,dc.height); cx.drawImage(sc,0,0); }catch(e){}
  }

  const si=src.querySelector('.imgLayer');
  let di=dst.querySelector('.imgLayer');
  if(si){
    if(!di){ di=document.createElement('canvas'); di.className='imgLayer'; dst.insertBefore(di,dc.nextSibling); }
    if(di.width!==si.width||di.height!==si.height){ di.width=si.width; di.height=si.height; }
    const ix=di.getContext('2d');
    if(ix&&ix.drawImage){
      try{ ix.clearRect(0,0,di.width,di.height); ix.drawImage(si,0,0); }catch(e){}
    }
  } else if(di) di.remove();

  dst.style.height='auto';
}

function applyTranslationLayout(){
  if(!pdfDoc) return;
  if(isCompare()) ensureMirrors();
  document.body.classList.toggle('comparing',isCompare());
  const keep=currentPage;
  rendered.clear();
  computeBase(); layoutPages(); applyZoomWidths();
  requestAnimationFrame(()=>{
    goToPage(keep); renderVisibleNow(); scheduleRerender(); updateProgressFromScroll();
  });
}

/* Rotating the device changes viewer.clientWidth, which computeBase() and
   applyZoomWidths() turn into a new baseWidth/page width for every page —
   a real relayout, exactly like applyTranslationLayout() above triggers
   when switching view modes. This used to skip the two things that
   function does to survive that: nothing remembered which page you were
   on to restore afterward (so the reflow could land you anywhere), and
   rendered wasn't cleared, so already-rendered pages kept comparing
   against the same zoom value (rotation doesn't change zoom, only
   baseWidth) and never got asked to redraw at their new size — just
   CSS-stretched from their old canvas until something else happened to
   trigger a fresh render. Debounced since an animated rotation can fire
   several resize events in quick succession; only the last one should
   actually trigger a relayout. */
let resizeTimer=null;
window.addEventListener('resize',()=>{
  if(!pdfDoc) return;
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    const keep=currentPage;
    rendered.clear();
    computeBase();
    applyZoomWidths();
    requestAnimationFrame(()=>{
      goToPage(keep); renderVisibleNow(); scheduleRerender(); updateProgressFromScroll();
    });
  },150);
});
