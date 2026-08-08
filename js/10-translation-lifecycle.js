/* 10-translation-lifecycle.js — part of OpenLiteraReader.
   Turning translation mode on/off, resetting state on a new file, and the language/engine settings UI.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------------- entering / leaving ---------------- */
function setTranslation(on){
  if(on && !pdfDoc) return;
  TR.on=on;
  const cols = on && TR.view==='columns';
  biMode=cols;
  document.body.classList.toggle('tactive',on);
  document.body.classList.toggle('bimode',cols);
  $('#translateBtn').classList.toggle('active',on);
  if(!on){
    clearOverlays(); setStatus('');
    document.body.classList.remove('comparing');
    applyTranslationLayout();
    return;
  }

  document.body.classList.remove('hud-hidden');
  if(selectMode) enterSelectMode(false);
  if(cols && !biBuilt) buildBi();
  const target=currentPage;
  requestAnimationFrame(()=>{
    if(cols){
      const sec=biBody.querySelector('.biPage[data-page="'+target+'"]');
      if(sec) biView.scrollTop=Math.max(0,sec.offsetTop-biChromeH());
    } else applyTranslationLayout();
    ensureEngine().then(()=>{
      if(cols) fillPage(target); else repaintVisible();
    },e=>{
      setStatus(cleanErr(e),'err');
      if(cols) engineTrouble(e);
    });
  });
}
function setBiMode(on){ setTranslation(on); }
$('#translateBtn').addEventListener('click',()=>setTranslation(!TR.on));

biView.addEventListener('scroll',()=>{
  const mid=biView.scrollTop+biView.clientHeight*0.35;
  let cur=1;
  for(const s of biBody.children){ if(s.offsetTop<=mid) cur=+s.dataset.page; else break; }
  if(cur!==currentPage){
    currentPage=cur;
    badge.textContent=currentPage+' / '+numPages;
    updatePageInd();
    sidebar.querySelectorAll('.thumb').forEach(t=>
      t.classList.toggle('current',+t.dataset.page===cur));
  }
},{passive:true});

/* ---------------- reset on a new file ---------------- */
function resetTranslation(file){
  TR.docId=file?file.name:'document';
  TR.active=null; TR.on=false;
  probes.clear(); clearOverlays();
  document.body.classList.remove('tactive');
  stopFlag=runningAll; 
  pageParas.clear(); pageJobs.clear();
  biBuilt=false; biBody.innerHTML='';
  biIntro.style.display='none';
  biProgress.style.width='0%';
  setStatus('');
  biMode=false;
  document.body.classList.remove('bimode');
  $('#translateBtn').classList.remove('active');
}

/* re-reading a page is cheap, so redo it when header skipping changes */
$('[data-toggle="skipRunning"]').addEventListener('click',()=>{
  pageParas.clear();
  invalidateTranslations();
});

/* ---------------- settings wiring ---------------- */
function fillSelect(sel,extra){
  sel.innerHTML='';
  if(extra){
    const o=document.createElement('option');
    o.value='auto'; o.textContent='Detect automatically';
    sel.appendChild(o);
  }
  for(const [code,name] of LANGS){
    const o=document.createElement('option');
    o.value=code; o.textContent=name+' ('+code+')';
    sel.appendChild(o);
  }
}
const tgtSel=$('#tgtLang'), srcSel=$('#srcLang'), engSel=$('#engineSel'), hostInput=$('#hostUrl');
fillSelect(tgtSel,false);
fillSelect(srcSel,true);
tgtSel.value=TR.target; srcSel.value=TR.source; engSel.value=TR.engine;
hostInput.value=TR.host;

function refreshLangLabels(){
  $('#biTgtName').textContent=LANG_NAME[TR.target]||TR.target;
  $('#biSrcName').textContent=TR.source==='auto'
    ? (LANG_NAME[TR.srcResolved]||'Detected')
    : (LANG_NAME[TR.source]||TR.source);
}
function invalidateTranslations(){
  TR.active=null;
  pageJobs.clear();
  refreshOverlays();
  biIntro.style.display='none';
  if(biBuilt){
    buildBi();
    if(biMode) ensureEngine().then(()=>fillPage(currentPage),e=>{
      setStatus(cleanErr(e),'err'); engineTrouble(e);
    });
  }
  refreshLangLabels();
}
tgtSel.addEventListener('change',()=>{ TR.target=tgtSel.value; saveTR(); invalidateTranslations(); });
srcSel.addEventListener('change',()=>{ TR.source=srcSel.value; saveTR(); invalidateTranslations(); });

const HINTS={
  auto:'Tries the offline translator first, then the free web engines.',
  ondevice:'Runs inside the browser, nothing leaves the device, no limit. Chrome 138+ or Edge 148+ on a desktop; the first use downloads a language pack.',
  google:'Google\'s public endpoint. Free and unmetered, but it is undocumented and can start refusing requests.',
  lingva:'An open-source relay in front of Google Translate. Leave the address blank for lingva.ml or enter your own instance.',
  mymemory:'No key needed, about 5,000 characters a day per address. Put an email in the address box to raise it.',
  libre:'Fully open source and self-hosted: <b>docker run -p 5000:5000 libretranslate/libretranslate --load-only en,lt</b> — then put http://localhost:5000 in the address box.'
};
function refreshEngineUI(){
  $('#engineHint').innerHTML=HINTS[TR.engine]||'';
  const wants=TR.engine==='libre'||TR.engine==='lingva'||TR.engine==='mymemory';
  $('#hostRow').style.display=wants?'flex':'none';
  hostInput.placeholder = TR.engine==='libre' ? 'http://localhost:5000'
                        : TR.engine==='lingva' ? 'https://lingva.ml'
                        : 'you@example.com (optional)';
}
engSel.addEventListener('change',()=>{
  TR.engine=engSel.value; TR.active=null; saveTR();
  refreshEngineUI(); invalidateTranslations();
});
hostInput.addEventListener('change',()=>{
  TR.host=hostInput.value.trim(); TR.active=null; saveTR(); invalidateTranslations();
});

$('#colSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  TR.cols=b.dataset.cols; saveTR();
  document.body.dataset.bicols=TR.cols;
  [...e.currentTarget.children].forEach(x=>x.classList.toggle('on',x===b));
});
$('#fontSeg').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  TR.font=b.dataset.bifont; saveTR();
  document.body.dataset.bifont=TR.font;
  refreshOverlays();
  [...e.currentTarget.children].forEach(x=>x.classList.toggle('on',x===b));
});
$('#clearCacheBtn').addEventListener('click',async e=>{
  await cacheClear();
  e.target.textContent='Cleared';
  setTimeout(()=>{ e.target.textContent='Clear saved translations'; },1500);
});

/* restore saved preferences */
document.body.dataset.bicols=TR.cols;
document.body.dataset.bifont=TR.font;
document.documentElement.style.setProperty('--bi-size',TR.size+'rem');
[...$('#colSeg').children].forEach(b=>b.classList.toggle('on',b.dataset.cols===TR.cols));
[...$('#fontSeg').children].forEach(b=>b.classList.toggle('on',b.dataset.bifont===TR.font));
refreshEngineUI();
refreshLangLabels();

/* text size: the zoom buttons resize the columns while reading side by side */
function biTextSize(delta){
  TR.size=Math.min(1.6,Math.max(0.72,+(TR.size+delta).toFixed(2)));
  document.documentElement.style.setProperty('--bi-size',TR.size+'rem');
  $('#zoomPct').textContent=Math.round(TR.size*100)+'%';
  saveTR();
}


/* ==================================================================
   DESKTOP CHROME
   Same reader, laid out for a mouse and a wide screen: a thin
   toolbar, a docked settings panel, two-page spreads, rotation and
   chapter marks. The phone layout is untouched below 900px.
   ================================================================== */

const DESK=window.matchMedia('(min-width:900px)');
const isDesk=()=>DESK.matches;
const chromeH=()=>(isDesk()?80:102)+
  (document.body.classList.contains('tactive')&&!document.body.classList.contains('bimode')?52:0);
const biChromeH=()=>isDesk()?106:120;

let spread=false, rotation=0, toc=[];
