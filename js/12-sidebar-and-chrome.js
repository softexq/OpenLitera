/* 12-sidebar-and-chrome.js — part of OpenLiteraReader.
   Chapter/TOC list, the toolbar title, fullscreen, and keyboard shortcuts.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- chapters, read from the document's own outline ---------- */
async function loadChapters(){
  toc=[];
  let out=null;
  try{ out=await pdfDoc.getOutline(); }catch(e){}
  if(out&&out.length){
    for(const it of out.slice(0,80)){
      try{
        let dest=it.dest;
        if(typeof dest==='string') dest=await pdfDoc.getDestination(dest);
        if(!dest||!dest[0]) continue;
        const idx=await pdfDoc.getPageIndex(dest[0]);
        toc.push({title:(it.title||'').trim()||'Untitled',page:idx+1});
      }catch(e){}
    }
    toc.sort((a,b)=>a.page-b.page);
  }
  drawChapters(); buildContents();
}
function drawChapters(){
  track.querySelectorAll('.chapMark').forEach(m=>m.remove());
  if(!settings.chapters||!toc.length||numPages<2) return;
  for(const c of toc){
    const m=document.createElement('div');
    m.className='chapMark';
    const at=(c.page-1)/(numPages-1)*100;
    m.style.left=Math.min(99.4,Math.max(0.6,at))+'%';
    m.title=c.title+' — page '+c.page;
    m.addEventListener('pointerdown',e=>{ e.stopPropagation(); goToPage(c.page); });
    track.appendChild(m);
  }
}
function buildContents(){
  const old=sidebar.querySelector('.tocBox'); if(old) old.remove();
  if(!toc.length) return;
  const box=document.createElement('div');
  box.className='tocBox';
  const h=document.createElement('div');
  h.className='tocHead'; h.textContent='CONTENTS';
  box.appendChild(h);
  toc.forEach(c=>{
    const b=document.createElement('button');
    b.className='tocItem';
    const s=document.createElement('span'); s.textContent=c.title;
    const i=document.createElement('i'); i.textContent=c.page;
    b.append(s,i);
    b.addEventListener('click',()=>{ goToPage(c.page); if(!isDesk()) setRail(false); });
    box.appendChild(b);
  });
  sidebar.prepend(box);
}
$('[data-toggle="chapters"]').addEventListener('click',()=>drawChapters());

/* ---------- title in the middle of the toolbar ---------- */
async function setDocTitle(file){
  let t=file?String(file.name).replace(/\.pdf$/i,''):'';
  try{
    const md=await pdfDoc.getMetadata();
    const mt=md&&md.info&&md.info.Title;
    if(mt&&String(mt).trim()) t=String(mt).trim();
  }catch(e){}
  const el=$('#docTitle'); if(el) el.textContent=t;
  document.title=t?t+' · OpenLiteraReader':'OpenLiteraReader';
}

/* ---------- full screen ---------- */
$('#fsBtn').addEventListener('click',()=>{
  if(document.fullscreenElement){ if(document.exitFullscreen) document.exitFullscreen(); }
  else if(document.documentElement.requestFullscreen)
    document.documentElement.requestFullscreen().catch(()=>{});
});
document.addEventListener('fullscreenchange',()=>{
  $('#fsBtn').classList.toggle('active',!!document.fullscreenElement);
  setTimeout(relayout,140);
});

/* ---------- keyboard, since there is one ---------- */
document.addEventListener('keydown',e=>{
  if(!pdfDoc) return;
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  switch(e.key){
    case 'ArrowRight': case 'PageDown': gotoRel(1);  e.preventDefault(); break;
    case 'ArrowLeft':  case 'PageUp':   gotoRel(-1); e.preventDefault(); break;
    case 'Home': goToPage(1);        e.preventDefault(); break;
    case 'End':  goToPage(numPages); e.preventDefault(); break;
    case '+': case '=': zoomStep(1);  e.preventDefault(); break;
    case '-': case '_': zoomStep(-1); e.preventDefault(); break;
    case 'f': case 'F': $('#fsBtn').click(); break;
    case 'Escape': if(sheet.classList.contains('open')) setPanel(false);
                   else if(sidebar.classList.contains('open')) setRail(false); break;
  }
});
