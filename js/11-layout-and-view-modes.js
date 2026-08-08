/* 11-layout-and-view-modes.js — part of OpenLiteraReader.
   Page layout math, single/two-page spread, rotation, page-to-page navigation, and zoom UI controls.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- layout ---------- */
function computeBase(){
  const avail=Math.max(200,viewer.clientWidth-20);
  baseWidth = (spread||isCompare()) ? Math.min((avail-14)/2,780) : Math.min(avail,900);
}
function layoutPages(){
  while(pagesWrap.firstChild) pagesWrap.removeChild(pagesWrap.firstChild);
  if(isCompare()){
    ensureMirrors();
    pageBoxes.forEach((b,i)=>{
      const row=document.createElement('div');
      row.className='spreadRow';
      row.appendChild(b);
      row.appendChild(mirrorBoxes[i]);
      pagesWrap.appendChild(row);
    });
    return;
  }
  if(!spread){ pageBoxes.forEach(b=>pagesWrap.appendChild(b)); return; }
  for(let i=0;i<pageBoxes.length;i+=2){
    const row=document.createElement('div');
    row.className='spreadRow';
    row.appendChild(pageBoxes[i]);
    if(pageBoxes[i+1]) row.appendChild(pageBoxes[i+1]);
    pagesWrap.appendChild(row);
  }
}
function relayout(){
  if(!pdfDoc) return;
  computeBase(); applyZoomWidths();
  renderVisibleNow(); scheduleRerender(); updateProgressFromScroll();
}

/* ---------- one page or two ---------- */
function setSpread(on){
  on=!!on;
  document.querySelectorAll('[data-spread]').forEach(b=>
    b.classList.toggle('selected',(b.dataset.spread==='1')===on));
  if(spread===on) return;
  spread=on;
  if(!pdfDoc) return;
  const keep=currentPage;
  rendered.clear();
  computeBase(); layoutPages(); applyZoomWidths();
  requestAnimationFrame(()=>{
    goToPage(keep); renderVisibleNow(); scheduleRerender(); updateProgressFromScroll();
  });
}
document.querySelectorAll('[data-spread]').forEach(b=>
  b.addEventListener('click',()=>setSpread(b.dataset.spread==='1')));

/* ---------- rotation ---------- */
async function setRotation(delta){
  if(!pdfDoc) return;
  rotation=((rotation+delta)%360+360)%360;
  try{
    const p1=await pdfDoc.getPage(1);
    pageRatio=p1.getViewport({scale:1,rotation:rotation}).height/
              p1.getViewport({scale:1,rotation:rotation}).width;
  }catch(e){}
  rendered.clear(); pageParas.clear(); probes.clear(); imgRects.clear(); clearOverlays();
  pageBoxes.forEach(b=>{
    const c=b.querySelector('canvas'); if(c) c.remove();
    const t=b.querySelector('.textLayer'); if(t) t.remove();
  });
  computeBase(); applyZoomWidths();
  renderVisibleNow(); scheduleRerender();
}
$('#rotL').addEventListener('click',()=>setRotation(-90));
$('#rotR').addEventListener('click',()=>setRotation(90));

/* ---------- moving through the document ---------- */
const spreadStart=n=>spread?(n%2?n:n-1):n;
function gotoRel(dir){
  const step=spread?2:1;
  goToPage(Math.min(numPages,Math.max(1,spreadStart(currentPage)+dir*step)));
}
$('#prevBtn').addEventListener('click',()=>gotoRel(-1));
$('#nextBtn').addEventListener('click',()=>gotoRel(1));

function updatePageInd(){
  const el=$('#pageInd'); if(!el) return;
  if(spread){
    const a=spreadStart(currentPage), b=Math.min(a+1,numPages);
    el.textContent=(b>a?a+'-'+b:''+a)+' / '+numPages;
  } else el.textContent=currentPage+' / '+numPages;
}

/* ---------- scaling ---------- */
function zoomStep(dir){
  if(document.body.classList.contains('bimode')) return biTextSize(dir>0?0.06:-0.06);
  zoomAbout(viewer.clientWidth/2,viewer.clientHeight/2,dir>0?1.3:1/1.3);
}
function syncZoomUI(){
  const r=$('#zoomRange'); if(!r) return;
  const lo=+r.min, hi=+r.max;
  const pct=Math.min(hi,Math.max(lo,Math.round(zoom*100)));
  r.value=pct;
  const f=((pct-lo)/(hi-lo))*100;
  r.style.background='linear-gradient(to right,#35b6e8 '+f+'%,#565d66 '+f+'%)';
}
$('#zoomRange').addEventListener('input',e=>{
  const want=(+e.target.value)/100;
  if(!want||!zoom||!pdfDoc) return;
  zoomAbout(viewer.clientWidth/2,viewer.clientHeight/2,want/zoom);
});
$('#autoScale').addEventListener('click',()=>{
  if(!pdfDoc) return;
  if(zoom!==1) zoomAbout(viewer.clientWidth/2,viewer.clientHeight/2,1/zoom);
  goToPage(currentPage);
});
['#zoomIn','#zoomInTop','#zoomPlus'].forEach(s=>{
  const e=$(s); if(e) e.addEventListener('click',()=>zoomStep(1));
});
['#zoomOut','#zoomOutTop','#zoomMinus'].forEach(s=>{
  const e=$(s); if(e) e.addEventListener('click',()=>zoomStep(-1));
});

/* ---------- rail and panel dock on a wide screen, slide over on a narrow one ---------- */
function setPanel(open){
  sheet.classList.toggle('open',open);
  sheetScrim.classList.toggle('show',open&&!isDesk());
  $('#settingsBtn').classList.toggle('active',open);
  document.body.classList.toggle('panel-open',open);
  if(isDesk()) relayout();
  syncModeNavGuard();
}
function setRail(open){
  sidebar.classList.toggle('open',open);
  scrim.classList.toggle('show',open&&!isDesk());
  $('#sidebarBtn').classList.toggle('active',open);
  document.body.classList.toggle('rail-open',open);
  if(isDesk()) relayout();
  syncModeNavGuard();
}
