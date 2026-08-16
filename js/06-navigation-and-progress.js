/* 06-navigation-and-progress.js — part of OpenLiteraReader.
   Thumbnails, scroll-progress tracking, page-rail navigation, and settings-panel open/close helpers.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- thumbnails ---------- */
const thumbDone=new Set();
async function renderThumb(n){
  if(thumbDone.has(n)) return; thumbDone.add(n);
  const page=await pdfDoc.getPage(n);
  const vp=page.getViewport({scale:1});
  const svp=page.getViewport({scale:(170*Math.min(DPR,2))/vp.width});
  const c=document.createElement('canvas');
  c.width=svp.width; c.height=svp.height;
  await page.render({canvasContext:c.getContext('2d'),viewport:svp}).promise;
  if(document.body.dataset.mode==='dark') remapDarkCanvas(c);
  sidebar.querySelector('.thumb[data-page="'+n+'"]').prepend(c);
}

/* ---------- progress / scroll ---------- */
function updateProgressFromScroll(){
  const max=viewer.scrollHeight-viewer.clientHeight;
  const pct=max>0?viewer.scrollTop/max:0;
  fill.style.width=(pct*100)+'%'; knob.style.left=(pct*100)+'%';
  const mid=viewer.scrollTop+viewer.clientHeight/2;
  let cur=1;
  for(const b of pageBoxes){ if(b.offsetTop<=mid) cur=+b.dataset.page; else break; }
  if(cur!==currentPage){
    currentPage=cur;
    sidebar.querySelectorAll('.thumb').forEach(t=>
      t.classList.toggle('current',+t.dataset.page===cur));
  }
  badge.textContent=currentPage+' / '+numPages;
  updatePageInd();
}
viewer.addEventListener('scroll',()=>{ if(!pinching&&!layoutSettling) updateProgressFromScroll(); });

function goToPage(n){
  if(document.body.classList.contains('bimode')){
    const s=biBody.querySelector('.biPage[data-page="'+n+'"]');
    if(s) biView.scrollTop=Math.max(0,s.offsetTop-biChromeH());
    return;
  }
  const b=pageBoxes[n-1];
  if(b) viewer.scrollTop=Math.max(0,b.offsetTop-chromeH());
}
function seek(x){
  const r=track.getBoundingClientRect();
  const pct=Math.min(1,Math.max(0,(x-r.left)/r.width));
  viewer.scrollTop=pct*(viewer.scrollHeight-viewer.clientHeight);
}
track.addEventListener('pointerdown',e=>{
  seek(e.clientX);
  const mv=ev=>seek(ev.clientX);
  const up=()=>{window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up);};
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
});

/* ---------- page rail ---------- */
function closeSidebar(){ setRail(false); }
$('#sidebarBtn').addEventListener('click',()=>setRail(!sidebar.classList.contains('open')));
scrim.addEventListener('click',closeSidebar);

/* ---------- settings panel ---------- */
function closeSheet(){ setPanel(false); }
$('#settingsBtn').addEventListener('click',()=>setPanel(!sheet.classList.contains('open')));
sheetScrim.addEventListener('click',closeSheet);

document.querySelectorAll('[data-set-mode]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const next=btn.dataset.setMode;
    if(next===document.body.dataset.mode) return;
    document.querySelectorAll('[data-set-mode]').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    document.body.dataset.mode=next;
    if(!pdfDoc) return;
    rendered.clear(); probes.clear(); clearOverlays();
    pageBoxes.forEach(b=>b.querySelectorAll('canvas').forEach(c=>c.remove()));
    thumbDone.clear();
    sidebar.querySelectorAll('.thumb canvas').forEach(c=>c.remove());
    renderVisibleNow(); scheduleRerender();
    if(TR.on&&TR.view!=='columns') repaintVisible();
  });
});
document.querySelectorAll('.toggle-row').forEach(row=>{
  row.addEventListener('click',()=>{
    const key=row.dataset.toggle;
    settings[key]=!settings[key];
    row.querySelector('.switch').classList.toggle('on',settings[key]);
    applyToggles();
  });
});
function applyToggles(){
  badge.classList.toggle('show',settings.pageCount);
  knob.style.display=settings.knob?'flex':'none';
  if(!settings.tapHud) document.body.classList.remove('hud-hidden');
}
applyToggles();


/* ==================================================================
   SIDE-BY-SIDE TRANSLATION
   Original text on the left, translation on the right, paragraph
   for paragraph. Tries the browser's own offline translator first
   and only falls back to a free web endpoint if that is missing.
   ================================================================== */

const LANGS=[
  ['lt','Lietuvių'],['en','English'],['lv','Latviešu'],['et','Eesti'],
  ['pl','Polski'],['ru','Русский'],['uk','Українська'],['be','Беларуская'],
  ['de','Deutsch'],['fr','Français'],['es','Español'],['it','Italiano'],
  ['pt','Português'],['nl','Nederlands'],['sv','Svenska'],['no','Norsk'],
  ['da','Dansk'],['fi','Suomi'],['is','Íslenska'],['cs','Čeština'],
  ['sk','Slovenčina'],['sl','Slovenščina'],['hr','Hrvatski'],['sr','Српски'],
  ['hu','Magyar'],['ro','Română'],['bg','Български'],['el','Ελληνικά'],
  ['tr','Türkçe'],['ar','العربية'],['he','עברית'],['fa','فارسی'],
  ['hi','हिन्दी'],['bn','বাংলা'],['ja','日本語'],['ko','한국어'],
  ['zh','中文'],['vi','Tiếng Việt'],['th','ไทย'],['id','Indonesia'],
];
const LANG_NAME=Object.fromEntries(LANGS);
const RTL=new Set(['ar','he','fa','ur','iw']);

/* Chrome's on-device models use a few legacy codes */
const OD_CODE={he:'iw'};

const TR={
  target:'lt', source:'auto', engine:'auto', view:'overlay', on:false,
  host:'', cols:'both', font:'sans', size:0.95,
  srcResolved:'en', active:null, docId:'doc',
};
try{
  const saved=localStorage.getItem('openlitera-tr')||localStorage.getItem('nocturne-tr');
  if(saved) Object.assign(TR, JSON.parse(saved));
}catch(e){}
TR.on=false;
function saveTR(){
  try{
    localStorage.setItem('openlitera-tr', JSON.stringify({
      target:TR.target, source:TR.source, engine:TR.engine,
      host:TR.host, cols:TR.cols, font:TR.font, size:TR.size, view:TR.view
    }));
  }catch(e){}
}

const biView=$('#biView'), biBody=$('#biBody'), biBar=$('#biBar'),
      biStatus=$('#biStatus'), biRunBtn=$('#biRunBtn'), biProgress=$('#biProgress'),
      biIntro=$('#biIntro');

let biMode=false, biBuilt=false, runningAll=false, stopFlag=false;
const pageParas=new Map();      // page -> [{text, head}]
const pageJobs=new Map();       // page -> promise
