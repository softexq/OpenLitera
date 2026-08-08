/* 02-file-open-and-pages.js — part of OpenLiteraReader.
   Opening a PDF (drag/drop + file picker), building the page list, and rendering each page's canvas (incl. dark-mode colour remap).
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- open file ---------- */
$('#openBtn').addEventListener('click',()=>$('#fileInput').click());
$('#fileInput').addEventListener('change',e=>{ if(e.target.files[0]) loadFile(e.target.files[0]); });
const dz=$('#dropzone');
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag');}));
dz.addEventListener('drop',e=>{
  const f=e.dataTransfer.files[0];
  if(f && f.type==='application/pdf') loadFile(f);
});

async function loadFile(file){
  const buf=await file.arrayBuffer();
  pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
  numPages=pdfDoc.numPages;
  landing.classList.add('hidden');
  topbar.style.display='flex';
  progressWrap.style.display='flex';
  viewer.style.display='block';
  zoomCtl.style.display='flex';
  resetTranslation(file);
  buildPages();
  setDocTitle(file);
  loadChapters();
}

/* ---------- optional personal library ----------
   Fully optional and self-hosted: if the person deploying this drops PDFs
   into a books/ folder alongside index.html and lists them in
   books/books.json, those show up as a tappable shelf under the dropzone.
   Nothing to build or configure otherwise — no books.json (or a fetch
   failure, e.g. no books/ folder at all) just leaves the landing page
   exactly as it was, no broken empty section. A tapped entry is fetched
   from the same origin (no CORS to worry about, since it's served
   alongside the app itself), wrapped in a real File so it can go through
   the exact same loadFile() every other PDF already goes through. */
(function initBookshelf(){
  const shelf=$('#bookShelf'), list=$('#bookList');
  if(!shelf||!list) return;
  fetch('books/books.json',{cache:'no-store'})
    .then(r=>r.ok?r.json():null)
    .then(items=>{
      if(!Array.isArray(items)||!items.length) return;
      list.innerHTML='';
      items.forEach(it=>{
        if(!it||!it.file) return;
        const title=(it.title&&String(it.title).trim())||String(it.file).replace(/\.pdf$/i,'');
        const b=document.createElement('button');
        b.className='bookItem';
        b.innerHTML=
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+
          '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'+
          '<span>'+escapeHtml(title)+'</span>';
        b.addEventListener('click',()=>openLibraryBook(String(it.file),title));
        list.appendChild(b);
      });
      if(list.children.length) shelf.style.display='flex';
    })
    .catch(()=>{ /* no books/books.json — landing page just stays as it was */ });
})();

async function openLibraryBook(path,title){
  try{
    const res=await fetch('books/'+path);
    if(!res.ok) throw new Error('missing');
    const blob=await res.blob();
    const name=/\.pdf$/i.test(title)?title:title+'.pdf';
    loadFile(new File([blob],name,{type:'application/pdf'}));
  }catch(e){
    alert('Couldn\u2019t open "'+title+'" \u2014 check it\u2019s still in the books folder.');
  }
}

/* ---------- pages ---------- */
async function buildPages(){
  pagesWrap.innerHTML=''; sidebar.innerHTML='';
  pageBoxes=[]; mirrorBoxes=[]; imgRects.clear();
  rendered.clear(); rendering.clear();

  const p1=await pdfDoc.getPage(1);
  const vp1=p1.getViewport({scale:1});
  pageRatio=vp1.height/vp1.width;
  computeBase();

  for(let i=1;i<=numPages;i++){
    const box=document.createElement('div');
    box.className='pageBox'; box.dataset.page=i;
    pageBoxes.push(box);

    const th=document.createElement('div');
    th.className='thumb'; th.dataset.page=i;
    th.innerHTML='<div class="num">'+i+'</div>';
    th.addEventListener('click',()=>{goToPage(i);closeSidebar();});
    sidebar.appendChild(th);
  }
  layoutPages();
  applyZoomWidths();

  const io=new IntersectionObserver(entries=>{
    entries.forEach(en=>{ if(en.isIntersecting) renderPage(+en.target.dataset.page); });
  },{root:viewer,rootMargin:'900px 0px'});
  pageBoxes.forEach(b=>io.observe(b));

  const ioT=new IntersectionObserver(entries=>{
    entries.forEach(en=>{ if(en.isIntersecting) renderThumb(+en.target.dataset.page); });
  },{root:sidebar,rootMargin:'400px 0px'});
  sidebar.querySelectorAll('.thumb').forEach(t=>ioT.observe(t));

  renderPage(1);
  updateProgressFromScroll();
}

function applyZoomWidths(){
  const w=Math.round(baseWidth*zoom);
  pageBoxes.forEach(b=>{
    b.style.width=w+'px';
    if(rendered.get(+b.dataset.page)!==zoom && !b.querySelector('canvas'))
      b.style.height=Math.round(w*pageRatio)+'px';
  });
  mirrorBoxes.forEach((m,i)=>{
    m.style.width=w+'px';
    const src=pageBoxes[i];
    m.style.height=(src&&src.querySelector('canvas'))?'auto':Math.round(w*pageRatio)+'px';
  });
  $('#zoomPct').textContent=Math.round(zoom*100)+'%';
  syncZoomUI();
}


/* Dark mode's exact colours (ink #FFFFFF, paper #1E1F22) are painted straight
   into each page's pixel data once, right after it renders, instead of a
   live CSS filter. A filter sitting on a raster canvas has to be recomputed
   by the browser on every frame of a pinch-zoom transform, and that
   recompute is what was catching visibly on the anti-aliased edges of
   letters as a flicker when zooming out. Baking removes the filter
   entirely, so scaling a dark-mode page costs exactly what scaling a
   light-mode page already did. */
const DARK_INK=[0xff,0xff,0xff], DARK_PAPER=[0x1e,0x1f,0x22];
/* Real PDFs rarely agree on what counts as "white" — a scanned book might sit
   at (250,246,235) where a Word export sits at pure (255,255,255). Both read as
   white paper to the eye, but a straight luminance interpolation bakes them to
   two slightly different dark shades, which shows up as a mismatch the moment
   two documents are compared. Clamping the input range before interpolating
   — a black point and a white point, the same idea as Levels in an image
   editor — makes anything reasonably close to white or black snap to the
   exact target colour, while the narrow band in between still carries the
   smooth anti-aliasing gradient at a letter's actual edge. */
const DARK_BLACK_POINT=0.15, DARK_WHITE_POINT=0.92;
function remapDarkCanvas(canvas){
  const w=canvas.width, h=canvas.height;
  if(!w||!h) return;
  const cx=canvas.getContext('2d',{willReadFrequently:true});
  if(!cx) return;
  let img;
  try{ img=cx.getImageData(0,0,w,h); }catch(e){ return; }
  const d=img.data;
  const [ir,ig,ib]=DARK_INK, [pr,pg,pb]=DARK_PAPER;
  const span=DARK_WHITE_POINT-DARK_BLACK_POINT;
  for(let i=0;i<d.length;i+=4){
    let L=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)/255;   // 0 = ink, 1 = paper
    L=(L-DARK_BLACK_POINT)/span;
    L=L<0?0:L>1?1:L;
    d[i]  =ir+(pr-ir)*L;
    d[i+1]=ig+(pg-ig)*L;
    d[i+2]=ib+(pb-ib)*L;
  }
  cx.putImageData(img,0,0);
}

async function renderPage(n,force=false){
  if(!force && rendered.get(n)===zoom) return;
  if(rendering.has(n)) return;
  rendering.add(n);
  const myZoom=zoom;
  try{
    const page=await pdfDoc.getPage(n);
    const box=pageBoxes[n-1];
    const cssW=Math.round(baseWidth*myZoom);
    const vp=page.getViewport({scale:1,rotation:rotation});
    const cssScale=cssW/vp.width;
    const svp=page.getViewport({scale:cssScale*DPR,rotation:rotation});
    const canvas=document.createElement('canvas');
    canvas.width=Math.floor(svp.width); canvas.height=Math.floor(svp.height);
    await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:svp}).promise;
    if(zoom!==myZoom){ rendering.delete(n); return renderPage(n); }

    /* Image-layer detection needs the canvas's original, not-yet-dark
       colours to tell a photo from a scanned page, so it has to run before
       the dark remap — and both have to finish before the canvas goes into
       the page, or the still-light canvas sits visible for a frame or two
       while the text layer/image layer are built, which reads as a flash
       back to light mode on every re-render (most noticeably on zoom). */
    const imgLayer=settings.trueImages ? await buildImageLayer(page,canvas,vp) : null;
    if(document.body.dataset.mode==='dark') remapDarkCanvas(canvas);

    box.querySelectorAll('canvas').forEach(c=>c.remove());
    box.insertBefore(canvas, box.firstChild);
    if(imgLayer) box.insertBefore(imgLayer, canvas.nextSibling);
    box.style.height='auto';

    const oldTL=box.querySelector('.textLayer'); if(oldTL) oldTL.remove();
    const tl=document.createElement('div');
    tl.className='textLayer';
    tl.style.setProperty('--scale-factor', cssScale);
    box.appendChild(tl);
    const cssVp=page.getViewport({scale:cssScale,rotation:rotation});
    try{
      const textContent=await page.getTextContent();
      await pdfjsLib.renderTextLayer({
        textContentSource:textContent, container:tl, viewport:cssVp, textDivs:[]
      }).promise;
      // endOfContent lets the browser extend a selection cleanly to line ends
      const eoc=document.createElement('div');
      eoc.className='endOfContent';
      tl.appendChild(eoc);
      tl.addEventListener('pointerdown',()=>tl.classList.add('selecting'));
      tl.addEventListener('pointerup',()=>setTimeout(()=>tl.classList.remove('selecting'),0));
    }catch(e){}

    syncMirror(n);
    const tb=transBox(n);
    if(tb) rescaleOverlay(tb,cssScale);
    paintOverlay(n);

    rendered.set(n,myZoom);
  } finally { rendering.delete(n); }
}

/* render pages currently on screen right now (sharp), no debounce */
function renderVisibleNow(){
  const top=viewer.scrollTop-300, bot=viewer.scrollTop+viewer.clientHeight+300;
  pageBoxes.forEach(b=>{
    const n=+b.dataset.page;
    if(b.offsetTop+b.offsetHeight>=top && b.offsetTop<=bot && rendered.get(n)!==zoom)
      renderPage(n);
  });
}
function scheduleRerender(){
  clearTimeout(rerenderTimer);
  rerenderTimer=setTimeout(()=>{
    const top=viewer.scrollTop-900, bot=viewer.scrollTop+viewer.clientHeight+900;
    pageBoxes.forEach(b=>{
      const n=+b.dataset.page;
      if(b.offsetTop+b.offsetHeight>=top && b.offsetTop<=bot){
        if(rendered.get(n)!==zoom) renderPage(n);
      } else rendered.delete(n);
    });
  },160);
}
