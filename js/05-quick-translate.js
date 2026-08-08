/* 05-quick-translate.js — part of OpenLiteraReader.
   Instant translate-on-selection (paints the translation over the selected word/phrase), the free dictionary lookup panel, and the shared back-button history guard used by all of select mode, quick-translate, dictionary mode, the settings sheet and the sidebar.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- QUICK TRANSLATE: select a word or phrase and its translation
   is painted right over it — sized to the selection and coloured from the
   page behind it, so it reads as the word itself rather than a popup.
   Reuses the same engine, cache and language settings as the full-page
   translation. ---------- */
let quickTrans=false, quickTimer=null, quickToken=0;

function hideQuickPop(){
  quickToken++;
  clearTimeout(quickTimer);
  quickPop.className='';
}
function setQuickTrans(on){
  quickTrans=on;
  document.body.classList.toggle('quicktrans',on);
  $('#quickTransBtn').classList.toggle('active',on);
  if(on){
    if(dictMode) setDictMode(false);
    showHintOnce('quickTrans','Select a word or phrase to see it translated · tap the button again to exit');
    document.body.classList.remove('hud-hidden');
  } else selectHint.classList.remove('show');
  const s=window.getSelection(); if(s) s.removeAllRanges();
  hideQuickPop();
  syncModeNavGuard();
}
$('#quickTransBtn').addEventListener('click',()=>setQuickTrans(!quickTrans));

/* ---------- DICTIONARY: select a word, see its definition ----------
   Free, no-key, CORS-enabled API (dictionaryapi.dev) — called straight
   from the browser, no server involved on this app's side. English only,
   and a lookup of a multi-word selection just uses the first word, since
   the API itself is a single-word lookup, not a phrase one. Mutually
   exclusive with quick-translate (both react to a selection, so having
   both on at once would be ambiguous about which one it's for) —
   switching either on switches the other off. Results are cached in
   memory for the session, since a definition doesn't change from one
   lookup to the next. */
let dictMode=false, dictTimer=null, dictToken=0, lastDictText='';
const dictCache=new Map();

function hideDictPanel(){
  dictToken++;
  clearTimeout(dictTimer);
  dictPanel.classList.remove('open');
  dictScrim.classList.remove('show');
}
function setDictMode(on){
  dictMode=on;
  document.body.classList.toggle('dictmode',on);
  $('#dictBtn').classList.toggle('active',on);
  if(on){
    if(quickTrans) setQuickTrans(false);
    showHintOnce('dictMode','Select a word to look it up · tap the button again to exit');
    document.body.classList.remove('hud-hidden');
  } else selectHint.classList.remove('show');
  const s=window.getSelection(); if(s) s.removeAllRanges();
  lastDictText='';
  hideDictPanel();
  syncModeNavGuard();
}
$('#dictBtn').addEventListener('click',()=>setDictMode(!dictMode));
dictScrim.addEventListener('click',hideDictPanel);

function scheduleDictLookup(){
  if(!dictMode) return;
  clearTimeout(dictTimer);
  const s=window.getSelection();
  if(!s||s.isCollapsed){ lastDictText=''; return; }
  const node=s.anchorNode, el=node&&(node.nodeType===1?node:node.parentElement);
  if(!el||!el.closest||!el.closest('.textLayer')) return;   // original text only
  const text=selText(s);
  if(!text||text===lastDictText) return;
  lastDictText=text;
  dictTimer=setTimeout(()=>runDictLookup(text),300);
}

async function runDictLookup(text){
  const token=++dictToken;
  const word=text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z'-]/g,'');
  if(!word) return;
  dictBody.innerHTML='<div class="dictMsg pending">Looking up \u201c'+escapeHtml(word)+'\u201d\u2026</div>';
  dictPanel.classList.add('open');
  dictScrim.classList.add('show');

  if(dictCache.has(word)){
    renderDictResult(word, dictCache.get(word));
    return;
  }
  try{
    const res=await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(word));
    if(token!==dictToken||!dictMode) return;   // superseded by a newer selection, or turned off while waiting
    if(!res.ok){ dictCache.set(word,null); renderDictResult(word,null); return; }
    const data=await res.json();
    dictCache.set(word,data);
    if(token!==dictToken||!dictMode) return;
    renderDictResult(word,data);
  }catch(e){
    if(token!==dictToken||!dictMode) return;
    dictBody.innerHTML='<div class="dictMsg">Couldn\u2019t reach the dictionary \u2014 check your connection and try again.</div>';
  }
}

function renderDictResult(word,data){
  if(!data||!data.length){
    dictBody.innerHTML='<div class="dictMsg">No dictionary entry found for \u201c'+escapeHtml(word)+'\u201d.</div>';
    return;
  }
  const entry=data[0];
  const phon=entry.phonetic||(entry.phonetics||[]).map(p=>p.text).find(Boolean)||'';
  const audioRaw=(entry.phonetics||[]).map(p=>p.audio).find(a=>a);
  const audioUrl=audioRaw?(audioRaw.indexOf('//')===0?'https:'+audioRaw:audioRaw):'';

  let html='<div class="dictWord"><h2>'+escapeHtml(entry.word||word)+'</h2>';
  if(phon) html+='<span class="dictPhon">'+escapeHtml(phon)+'</span>';
  if(audioUrl) html+='<button class="dictPlay" type="button" aria-label="Play pronunciation">'+
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20"/></svg></button>';
  html+='</div>';

  (entry.meanings||[]).forEach(m=>{
    html+='<div class="dictPos">'+escapeHtml(m.partOfSpeech||'')+'</div>';
    const defs=m.definitions||[];
    defs.slice(0,4).forEach((d,i)=>{
      html+='<div class="dictDef">';
      if(defs.length>1) html+='<span class="n">'+(i+1)+'.</span>';
      html+=escapeHtml(d.definition||'');
      if(d.example) html+='<div class="dictEx">\u201c'+escapeHtml(d.example)+'\u201d</div>';
      html+='</div>';
      if(d.synonyms&&d.synonyms.length)
        html+='<div class="dictSyn">'+d.synonyms.slice(0,8).map(sy=>'<span>'+escapeHtml(sy)+'</span>').join('')+'</div>';
    });
  });

  dictBody.innerHTML=html;
  if(audioUrl){
    const btn=dictBody.querySelector('.dictPlay');
    if(btn) btn.addEventListener('click',()=>{ new Audio(audioUrl).play().catch(()=>{}); });
  }
}

/* ---------- back button exits an open mode/panel instead of leaving the
   page ----------
   Entering select mode, quick-translate mode, dictionary mode, or opening
   the settings sheet/sidebar on a phone-width screen pushes one extra
   history entry. The device/browser back button pops it like any other
   back-navigation, which fires popstate below — treated as "close
   whatever's open", not as leaving the reader. Exiting normally (tapping
   that control again) cleans the same entry back up via history.back(),
   with suppressNavSync stopping that from bouncing back through the
   popstate handler and re-pushing it. The sheet/sidebar dock in place
   (not an overlay) on a wide screen, so they're excluded there — back
   should behave normally on desktop. */
let modeNavGuarded=false, suppressNavSync=false;
function anyModeActive(){
  return selectMode||quickTrans||dictMode||
    (!isDesk()&&(sheet.classList.contains('open')||sidebar.classList.contains('open')));
}
function syncModeNavGuard(){
  if(suppressNavSync) return;
  if(anyModeActive()){
    if(!modeNavGuarded){ modeNavGuarded=true; history.pushState({readerMode:true},''); }
  }else if(modeNavGuarded){
    modeNavGuarded=false;
    history.back();
  }
}
window.addEventListener('popstate',()=>{
  if(!modeNavGuarded) return;
  modeNavGuarded=false;
  suppressNavSync=true;
  if(quickTrans) setQuickTrans(false);
  if(dictMode) setDictMode(false);
  if(selectMode) enterSelectMode(false);
  if(sheet.classList.contains('open')) setPanel(false);
  if(sidebar.classList.contains('open')) setRail(false);
  suppressNavSync=false;
});

/* Commonest colour in a padded region = background, pixels far from it =
   ink — the same idea as analyse() for the full-page overlay, but reading
   straight off the live canvas in on-screen pixels so it needs no PDF-space
   conversion for an arbitrary drag-selected rectangle. */
function sampleInPlaceColours(canvas,x,y,w,h){
  const padX=Math.max(3,Math.min(16,w*0.15)), padY=Math.max(3,Math.min(16,h*0.35));
  const sx=Math.max(0,Math.floor(x-padX)), sy=Math.max(0,Math.floor(y-padY));
  const sw=Math.min(canvas.width-sx,Math.ceil(w+padX*2));
  const sh=Math.min(canvas.height-sy,Math.ceil(h+padY*2));
  if(sw<2||sh<2) return null;
  const t=document.createElement('canvas');
  const tw=Math.max(1,Math.min(40,sw)), th=Math.max(1,Math.round(tw*sh/sw));
  t.width=tw; t.height=th;
  const tx=t.getContext('2d');
  if(!tx||!tx.drawImage) return null;
  try{ tx.drawImage(canvas,sx,sy,sw,sh,0,0,tw,th); }catch(e){ return null; }
  let img;
  try{ img=tx.getImageData(0,0,tw,th); }catch(e){ return null; }
  const d=img.data;
  const counts=new Map();
  let sr=0,sg=0,sb=0,n=0;
  for(let i=0;i<d.length;i+=4){
    const R=d[i],G=d[i+1],B=d[i+2];
    const k=((R>>4)<<8)|((G>>4)<<4)|(B>>4);
    counts.set(k,(counts.get(k)||0)+1);
    sr+=R; sg+=G; sb+=B; n++;
  }
  if(!n) return null;
  let best=-1,bk=0xfff;
  counts.forEach((v,k)=>{ if(v>best){ best=v; bk=k; } });
  let bg=[((bk>>8)&15)*17,((bk>>4)&15)*17,(bk&15)*17];
  if(best/n<=0.22) bg=[sr/n|0,sg/n|0,sb/n|0];             // no single dominant colour (artwork) — use the average instead
  const lum=(bg[0]*0.299+bg[1]*0.587+bg[2]*0.114)/255;
  return {bg:bg, ink:(lum>0.5?[24,27,31]:[232,234,237])};
}

/* Everything needed to paint over the current selection: which page it's
   on (to find its canvas), the on-screen rect to cover, and the text's own
   font size so the translation reads at roughly the size it replaces.
   getClientRects() gives one rect per line of the selection — merging
   those (rather than using the range's own getBoundingClientRect) covers
   every selected line without also grabbing the unselected margin a full
   bounding box would include for a selection that starts or ends mid-line.
   pdf.js's textLayer also carries an invisible .endOfContent spacer (it
   lets a drag extend cleanly past the last line) that goes full width while
   a selection is live — a rect that wide is never real selected text, so
   it's dropped rather than let it stretch the merged box out to the page's
   full width. */
function quickTarget(){
  const s=window.getSelection();
  if(!s||!s.rangeCount||s.isCollapsed) return null;
  const r=s.getRangeAt(0);
  const node=s.anchorNode, el=node&&(node.nodeType===1?node:node.parentElement);
  const box=el&&el.closest?el.closest('.pageBox'):null;
  const boxRect=box&&box.getBoundingClientRect();
  const list=r.getClientRects();
  let rect=null;
  if(list&&list.length){
    let L=Infinity,T=Infinity,R=-Infinity,B=-Infinity;
    for(const c of list){
      if(c.width<2||c.height<2) continue;
      if(boxRect&&c.width>boxRect.width+1) continue;
      if(c.left<L)L=c.left; if(c.top<T)T=c.top;
      if(c.right>R)R=c.right; if(c.bottom>B)B=c.bottom;
    }
    if(R>L&&B>T) rect={left:L,top:T,width:R-L,height:B-T};
  }
  if(!rect) rect=r.getBoundingClientRect();
  if(!rect||(!rect.width&&!rect.height)) return null;
  const canvas=box&&box.querySelector('canvas:not(.imgLayer)');
  const fs=el?parseFloat(getComputedStyle(el).fontSize):0;
  return {rect:rect,canvas:canvas,fontSize:fs||14};
}

/* Position and colour the patch to exactly cover the target rect, growing
   from its top-left corner (rather than centring) so short translations
   sit snug and long ones grow the same direction reading already flows. */
function paintQuickPop(t){
  const r=t.rect;
  quickPop.style.left=r.left+'px';
  quickPop.style.top=r.top+'px';
  quickPop.style.minWidth=r.width+'px';
  quickPop.style.minHeight=r.height+'px';
  quickPop.style.maxWidth=Math.max(r.width,Math.min(280,window.innerWidth-r.left-8))+'px';
  quickPop.style.fontSize=t.fontSize+'px';
  quickPop.style.lineHeight=Math.max(1,t.fontSize*1.2)+'px';

  let col=null;
  if(document.body.dataset.mode==='dark') col={bg:DARK_PAPER,ink:DARK_INK};
  else if(t.canvas&&t.canvas.width){
    const cr=t.canvas.getBoundingClientRect();
    if(cr.width){
      const sc=t.canvas.width/cr.width;
      col=sampleInPlaceColours(t.canvas,(r.left-cr.left)*sc,(r.top-cr.top)*sc,r.width*sc,r.height*sc);
    }
  }
  quickPop.style.background=col?('rgb('+col.bg.join(',')+')'):'';
  quickPop.style.color=col?('rgb('+col.ink.join(',')+')'):'';
}

/* Normalised text of a Selection — used both to decide what to translate
   and, once it comes back, to check the selection didn't move on while we
   waited. Comparing against a raw re-stringified selection there instead
   used to mismatch for anything spanning more than one line (a line wrap
   reads back with a stray newline), so the result was silently dropped and
   the patch just pulsed forever for any selection longer than one line. */
function selText(s){ return s.toString().trim().replace(/\s+/g,' '); }

async function runQuickTranslate(text){
  const token=++quickToken;
  const t=quickTarget();
  if(!t){ hideQuickPop(); return; }
  paintQuickPop(t);
  quickPop.textContent='';
  quickPop.className='show pending';
  try{
    const out=await translateText(text);
    if(token!==quickToken||!quickTrans) return;      // superseded by a newer selection, or turned off
    const s=window.getSelection();
    if(!s||s.isCollapsed||selText(s)!==text) return;   // selection moved on while we waited
    const t2=quickTarget();
    if(t2) paintQuickPop(t2);
    quickPop.textContent=out;
    quickPop.className='show';
  }catch(e){
    if(token!==quickToken||!quickTrans) return;
    // an error is a status message, not a translation — drop the in-place sizing/colour
    // so it reads as normal UI text instead of being squeezed into one word's tiny box
    quickPop.style.minWidth=quickPop.style.minHeight=quickPop.style.fontSize=quickPop.style.lineHeight='';
    quickPop.style.background=quickPop.style.color='';
    quickPop.textContent=cleanErr(e);
    quickPop.className='show err';
  }
}

let lastQuickText='';
function scheduleQuickTranslate(){
  if(!quickTrans) return;
  clearTimeout(quickTimer);
  const s=window.getSelection();
  if(!s||s.isCollapsed){ lastQuickText=''; hideQuickPop(); return; }
  const node=s.anchorNode, el=node&&(node.nodeType===1?node:node.parentElement);
  if(!el||!el.closest||!el.closest('.textLayer')){ hideQuickPop(); return; }  // original text only
  const text=selText(s);
  if(!text){ hideQuickPop(); return; }
  if(text===lastQuickText && quickPop.classList.contains('show')){
    const t=quickTarget(); if(t) paintQuickPop(t);
    return;
  }
  lastQuickText=text;
  quickTimer=setTimeout(()=>runQuickTranslate(text),220);
}


