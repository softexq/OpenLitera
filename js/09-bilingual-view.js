/* 09-bilingual-view.js — part of OpenLiteraReader.
   Building the side-by-side translation view, "Translate page", and "Save as text file".
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------------- rendering ---------------- */
function buildBi(){
  biBody.innerHTML='';
  pageJobs.clear();
  for(let i=1;i<=numPages;i++){
    const sec=document.createElement('section');
    sec.className='biPage'; sec.dataset.page=i;
    sec.innerHTML='<div class="biPageHead">PAGE '+i+'</div><div class="biRows"></div>';
    biBody.appendChild(sec);
  }
  const io=new IntersectionObserver(es=>{
    es.forEach(e=>{ if(e.isIntersecting) fillPage(+e.target.dataset.page); });
  },{root:biView,rootMargin:'700px 0px'});
  biBody.querySelectorAll('.biPage').forEach(s=>io.observe(s));
  biBuilt=true;
}

function fillPage(n){
  if(pageJobs.has(n)) return pageJobs.get(n);
  const job=(async()=>{
    const sec=biBody.querySelector('.biPage[data-page="'+n+'"]');
    if(!sec) return;
    const rows=sec.querySelector('.biRows');
    const paras=await extractPage(n);
    rows.innerHTML='';
    if(!paras.length){
      rows.innerHTML='<div class="biEmpty">No text layer on this page — it is most likely a scan. '+
                     'The page still reads fine in the normal view.</div>';
      return;
    }
    const rtl=RTL.has(TR.target);
    const work=paras.map(p=>{
      const row=document.createElement('div');
      row.className='pair'+(p.head?' head':'');
      const s=document.createElement('div'); s.className='src'; s.textContent=p.text;
      const t=document.createElement('div'); t.className='tgt pending';
      if(rtl) t.dir='rtl';
      row.append(s,t); rows.appendChild(row);
      return queue(()=>translateText(p.text).then(o=>{
        t.classList.remove('pending'); t.textContent=o;
      },e=>{
        t.classList.remove('pending');
        if((e&&e.message)==='stopped'){ t.textContent='—'; return; }
        t.classList.add('err'); t.textContent='Not translated · '+cleanErr(e);
        throw e;
      }));
    });
    const res=await Promise.allSettled(work);
    const bad=res.filter(r=>r.status==='rejected');
    if(bad.length && bad.length===res.length) throw bad[0].reason;
  })();
  job.catch(()=>{});
  pageJobs.set(n,job);
  return job;
}

function showIntro(html){
  biIntro.style.display='block';
  biIntro.innerHTML=html;
}
function engineTrouble(e){
  const list=(e&&e.all)||[cleanErr(e)];
  showIntro(
    '<h2>Nothing could translate that yet</h2>'+
    '<p>Every engine was tried and none answered:</p>'+
    '<p class="sub">'+list.map(x=>escapeHtml(x)).join('<br>')+'</p>'+
    '<p style="margin-top:18px">The offline translator lives in Chrome and Edge on a desktop. '+
    'Everywhere else the reader needs one of the free web engines, which a network block or an '+
    'ad blocker can stop. You can also run LibreTranslate yourself and point the reader at it '+
    'under <b>Aa &rarr; Translation</b>.</p>'+
    '<button class="go" id="biRetry">Try again</button>'
  );
  const r=$('#biRetry');
  if(r) r.addEventListener('click',()=>{
    TR.active=null; biIntro.style.display='none';
    pageJobs.clear(); buildBi(); fillPage(currentPage);
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

/* ---------------- translate the page you're on ---------------- */
async function runCurrentPage(){
  if(runningAll){ stopFlag=true; return; }
  runningAll=true; stopFlag=false;
  biRunBtn.textContent='Stop';
  const n=currentPage;
  let failed=0;
  try{
    await ensureEngine();
    biProgress.style.width='0%';
    setStatus((TR.active&&ENGINE_LABEL[TR.active.id]||'Translating')+' \u00b7 page '+n);
    try{
      if(TR.view==='columns') await fillPage(n);
      else{
        const r=await warmPage(n);
        failed=r.failed;
      }
    }catch(e){
      if((e&&e.message)!=='stopped') throw e;
    }
    if(!stopFlag){
      biProgress.style.width='100%';
      const eng=TR.active?ENGINE_LABEL[TR.active.id]:'Translation';
      if(failed)
        setStatus(eng+' \u00b7 page '+n+' had trouble \u2014 tap Translate page to retry','warn');
      else
        setStatus(eng+' \u00b7 page '+n+' done');
      setTimeout(()=>{ biProgress.style.width='0%'; },2200);
    } else setStatus('Stopped','warn');
  }catch(e){
    setStatus(cleanErr(e),'err');
    engineTrouble(e);
  }
  runningAll=false; stopFlag=false;
  biRunBtn.textContent='Translate page';
}
biRunBtn.addEventListener('click',runCurrentPage);

/* ---------------- save ---------------- */
$('#biSaveBtn').addEventListener('click',async()=>{
  setStatus('Collecting the text\u2026');
  const parts=[];
  for(let n=1;n<=numPages;n++){
    let paras=[];
    try{ paras=await extractPage(n); }catch(e){}
    if(!paras.length) continue;
    parts.push('\u2014 page '+n+' \u2014');
    for(const p of paras){
      let t=null;
      try{ t=await cacheGet(p.text); }catch(e){}
      if(TR.cols==='src') parts.push(p.text);
      else if(TR.cols==='tgt') parts.push(t||p.text);
      else parts.push(p.text+'\n'+(t||'\u2026'));
    }
    parts.push('');
  }
  if(!parts.length){ setStatus('Nothing to save yet','warn'); return; }
  const blob=new Blob([parts.join('\n')],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(TR.docId.replace(/\.pdf$/i,'')||'document')+'.'+TR.target+'.txt';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  setStatus('Saved');
});
