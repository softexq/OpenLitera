/* 07-translation-engines.js — part of OpenLiteraReader.
   Language list, translation state, the on-device/Google/Lingva/MyMemory engines, caching, and the request queue.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------------- status line ---------------- */
function setStatus(msg,kind){
  biStatus.textContent=msg||'';
  biStatus.className=kind||'';
}
const ENGINE_LABEL={
  ondevice:'On device', google:'Google', lingva:'Lingva',
  mymemory:'MyMemory', libre:'LibreTranslate'
};

/* ---------------- cache ---------------- */
const memCache=new Map();
let idbPromise=null;
function idb(){
  if(idbPromise) return idbPromise;
  idbPromise=new Promise(res=>{
    let rq;
    try{
      indexedDB.deleteDatabase('nocturne-translations');   /* left over from the old name */
      rq=indexedDB.open('openlitera-translations',1);
    }catch(e){ return res(null); }
    rq.onupgradeneeded=()=>{ rq.result.createObjectStore('t'); };
    rq.onsuccess=()=>res(rq.result);
    rq.onerror=()=>res(null);
    rq.onblocked=()=>res(null);
  });
  return idbPromise;
}
function fnv(s){
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); }
  return (h>>>0).toString(36)+'.'+s.length.toString(36);
}
function ckey(text){ return TR.srcResolved+'>'+TR.target+'|'+fnv(text); }
async function cacheGet(text){
  const k=ckey(text);
  if(memCache.has(k)) return memCache.get(k);
  const db=await idb(); if(!db) return null;
  return new Promise(res=>{
    try{
      const rq=db.transaction('t','readonly').objectStore('t').get(k);
      rq.onsuccess=()=>{ if(rq.result!=null) memCache.set(k,rq.result); res(rq.result??null); };
      rq.onerror=()=>res(null);
    }catch(e){ res(null); }
  });
}
async function cachePut(text,out){
  const k=ckey(text);
  memCache.set(k,out);
  const db=await idb(); if(!db) return;
  try{ db.transaction('t','readwrite').objectStore('t').put(out,k); }catch(e){}
}
async function cacheClear(){
  memCache.clear();
  const db=await idb(); if(!db) return;
  try{ db.transaction('t','readwrite').objectStore('t').clear(); }catch(e){}
}

/* ---------------- engines ---------------- */
async function fetchJSON(url,opts,tries){
  tries=tries||2;
  let lastErr;
  for(let i=0;i<=tries;i++){
    try{
      const ctl=new AbortController();
      const timer=setTimeout(()=>ctl.abort(),20000);
      const r=await fetch(url,Object.assign({signal:ctl.signal},opts||{}));
      clearTimeout(timer);
      if(r.status===429){ lastErr=new Error('rate'); await sleep(1200*(i+1)); continue; }
      if(!r.ok) throw new Error('http-'+r.status);
      return await r.json();
    }catch(e){ lastErr=e; if(i<tries) await sleep(500*(i+1)); }
  }
  throw lastErr;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

let odInstance=null, odPair='';
async function odPrepare(src,tgt){
  if(!('Translator' in self)) throw new Error('This browser has no built-in translator.');
  const opts={ sourceLanguage:OD_CODE[src]||src, targetLanguage:OD_CODE[tgt]||tgt };
  const pair=opts.sourceLanguage+'>'+opts.targetLanguage;
  if(odInstance && odPair===pair) return odInstance;
  const av=await Translator.availability(opts);
  if(av==='unavailable')
    throw new Error(LANG_NAME[src]+' to '+LANG_NAME[tgt]+' is not one of the on-device pairs.');
  if(av==='downloadable'||av==='downloading') setStatus('Downloading the language pack…');
  odInstance=await Translator.create(Object.assign({},opts,{
    monitor(m){
      m.addEventListener('downloadprogress',e=>{
        const pct=Math.round((e.loaded||0)*100);
        setStatus('Downloading the language pack… '+pct+'%');
      });
    }
  }));
  odPair=pair;
  return odInstance;
}

const ENGINES={
  ondevice:{
    max:3000, gap:0,
    async run(text,src,tgt){
      const t=await odPrepare(src,tgt);
      return await t.translate(text);
    }
  },
  google:{
    max:1400, gap:120,
    async run(text,src,tgt){
      const u='https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'+
              '&sl='+encodeURIComponent(src)+'&tl='+encodeURIComponent(tgt)+
              '&q='+encodeURIComponent(text);
      const j=await fetchJSON(u);
      if(!j||!j[0]) throw new Error('Unexpected reply');
      return j[0].map(seg=>seg&&seg[0]?seg[0]:'').join('');
    }
  },
  lingva:{
    max:800, gap:200,
    async run(text,src,tgt){
      const host=(TR.host||'https://lingva.ml').replace(/\/+$/,'');
      const j=await fetchJSON(host+'/api/v1/'+src+'/'+tgt+'/'+encodeURIComponent(text));
      if(j.error) throw new Error(j.error);
      return j.translation||'';
    }
  },
  mymemory:{
    max:450, gap:260,
    async run(text,src,tgt){
      const u=new URL('https://api.mymemory.translated.net/get');
      u.searchParams.set('q',text);
      u.searchParams.set('langpair',(src==='auto'?'en':src)+'|'+tgt);
      if(TR.host && TR.host.indexOf('@')>0) u.searchParams.set('de',TR.host);
      const j=await fetchJSON(u.toString());
      const out=j&&j.responseData&&j.responseData.translatedText;
      if(!out) throw new Error('No translation returned');
      if(/MYMEMORY WARNING|QUOTA/i.test(out)) throw new Error('Daily free quota used up');
      return out;
    }
  },
  libre:{
    max:3000, gap:60,
    async run(text,src,tgt){
      if(!TR.host) throw new Error('Add your LibreTranslate address in the settings.');
      const base=TR.host.replace(/\/+$/,'');
      const j=await fetchJSON(base+'/translate',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({q:text,source:src,target:tgt,format:'text'})
      });
      if(j.error) throw new Error(j.error);
      return j.translatedText||'';
    }
  }
};
const AUTO_ORDER=['ondevice','google','lingva','mymemory'];
/* MyMemory counts every call, so it gets a single lane */
const CONCURRENCY={ondevice:2, google:3, lingva:2, mymemory:1, libre:3};

async function detectSource(sample){
  if('LanguageDetector' in self){
    try{
      const d=await LanguageDetector.create();
      const r=await d.detect(sample.slice(0,700));
      if(r&&r[0]&&r[0].confidence>0.35) return r[0].detectedLanguage.split('-')[0];
    }catch(e){}
  }
  return 'en';
}

/* Picks an engine and proves it works on a short probe before committing. */
async function ensureEngine(){
  if(TR.active) return TR.active;

  if(TR.source==='auto'){
    let sample='';
    for(let n=1;n<=Math.min(numPages,3)&&sample.length<400;n++){
      const ps=await extractPage(n);
      sample+=ps.map(p=>p.text).join(' ');
    }
    TR.srcResolved=sample.trim()?await detectSource(sample):'en';
  } else TR.srcResolved=TR.source;

  if(TR.srcResolved===TR.target)
    throw new Error('The document already looks like '+LANG_NAME[TR.target]+'. Pick another language.');

  const order = TR.engine==='auto' ? AUTO_ORDER.slice() : [TR.engine];
  const failures=[];
  for(const id of order){
    try{
      setStatus('Starting '+ENGINE_LABEL[id]+'…');
      const out=await ENGINES[id].run('Hello',TR.srcResolved,TR.target);
      if(!out||!out.trim()) throw new Error('Empty reply');
      TR.active={id:id, ...ENGINES[id]};
      queue=makeQueue(CONCURRENCY[id]||2);
      setStatus(ENGINE_LABEL[id]+(id==='ondevice'?' · offline':''), id==='ondevice'?'':'warn');
      return TR.active;
    }catch(e){
      failures.push(ENGINE_LABEL[id]+': '+cleanErr(e));
    }
  }
  const err=new Error(failures.join(' · '));
  err.all=failures;
  throw err;
}
function cleanErr(e){
  const m=(e&&e.message)||String(e);
  if(/^http-/.test(m)) return 'server said '+m.slice(5);
  if(m==='rate') return 'too many requests';
  if(/Failed to fetch|NetworkError|abort/i.test(m)) return 'no reply';
  return m;
}

/* ---------------- chunking ---------------- */
function splitSentences(t){
  const out=[]; let start=0;
  for(let i=0;i<t.length;i++){
    if('.!?…;'.indexOf(t[i])<0) continue;
    let j=i+1;
    while(j<t.length && '"\')]»”’'.indexOf(t[j])>=0) j++;
    if(j>=t.length || /\s/.test(t[j])){
      out.push(t.slice(start,j+1)); start=j+1; i=j;
    }
  }
  if(start<t.length) out.push(t.slice(start));
  return out.filter(s=>s.trim());
}
function chunkText(text,max){
  if(text.length<=max) return [text];
  const chunks=[]; let buf='';
  for(let s of splitSentences(text)){
    while(s.length>max){                       // one enormous sentence
      let cut=s.lastIndexOf(' ',max);
      if(cut<max*0.5) cut=max;
      if(buf){ chunks.push(buf); buf=''; }
      chunks.push(s.slice(0,cut));
      s=s.slice(cut);
    }
    if(buf.length+s.length>max){ chunks.push(buf); buf=s; }
    else buf+=s;
  }
  if(buf.trim()) chunks.push(buf);
  return chunks;
}

/* ---------------- work queue ---------------- */
function makeQueue(n){
  let active=0; const waiting=[];
  const pump=()=>{
    if(active>=n||!waiting.length) return;
    active++;
    const job=waiting.shift();
    job.fn().then(job.res,job.rej).then(()=>{ active--; pump(); });
  };
  return fn=>new Promise((res,rej)=>{ waiting.push({fn,res,rej}); pump(); });
}
let queue=makeQueue(3);
let failStreak=0;

async function translateText(text){
  const hit=await cacheGet(text);
  if(hit!=null) return hit;
  const eng=await ensureEngine();
  const parts=chunkText(text,eng.max);
  const done=[];
  try{
    for(let i=0;i<parts.length;i++){
      if(stopFlag) throw new Error('stopped');
      done.push(await eng.run(parts[i],TR.srcResolved,TR.target));
      if(eng.gap && i<parts.length-1) await sleep(eng.gap);
    }
  }catch(e){
    if((e&&e.message)!=='stopped'){
      failStreak++;
      /* the chosen engine has stopped answering — let the next call pick a fresh one */
      if(failStreak>=4 && TR.engine==='auto'){ TR.active=null; failStreak=0; }
    }
    throw e;
  }
  failStreak=0;
  const out=done.join(' ').replace(/\s{2,}/g,' ').replace(/\s+([,.;:!?])/g,'$1').trim();
  await cachePut(text,out);
  return out;
}
