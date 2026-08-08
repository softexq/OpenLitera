/* 13-page-overlay-translation.js — part of OpenLiteraReader.
   Paints full-page translations directly onto the page (paragraph layout + colour sampling).
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- keep the two layouts in step when the window crosses 900px ---------- */
function onBreakpoint(){
  sheetScrim.classList.toggle('show',sheet.classList.contains('open')&&!isDesk());
  scrim.classList.toggle('show',sidebar.classList.contains('open')&&!isDesk());
  relayout();
}
if(DESK.addEventListener) DESK.addEventListener('change',onBreakpoint);
else if(DESK.addListener) DESK.addListener(onBreakpoint);

syncZoomUI();

/* --- where each paragraph sits, how it is set, and how much room it has
       before the next one --- */
function measureParagraphs(paras,vp,medH){
  for(const p of paras){
    const ls=p.ls;
    if(!ls||!ls.length){
      p.x0=0;p.y0=0;p.x1=vp.width;p.y1=medH;p.size=medH;p.lead=medH*1.2;p.align='left';
      continue;
    }
    p.x0=Math.min.apply(null,ls.map(l=>l.x0));
    p.x1=Math.max.apply(null,ls.map(l=>l.x1));
    p.size=median(ls.map(l=>l.h))||medH;
    const ys=ls.map(l=>l.y);
    const top=Math.min.apply(null,ys), bot=Math.max.apply(null,ys);
    p.y0=top-p.size*0.95;
    p.y1=bot+p.size*0.32;
    p.lead=ls.length>1?(bot-top)/(ls.length-1):p.size*1.22;

    const cl=ls[0].cLeft, cr=ls[0].cRight, cw=Math.max(1,cr-cl), near=cw*0.045;
    const leftFlush=ls.every(l=>Math.abs(l.x0-cl)<near);
    const rightAll=ls.every(l=>Math.abs(l.x1-cr)<near);
    const body=ls.length>1?ls.slice(0,-1):ls;
    const rightBody=body.every(l=>Math.abs(l.x1-cr)<near);
    const centred=!leftFlush&&!rightAll&&
                  ls.every(l=>Math.abs((l.x0-cl)-(cr-l.x1))<cw*0.09);
    p.align = centred ? 'center'
            : (leftFlush&&rightBody&&ls.length>1) ? 'justify'
            : (rightAll&&!leftFlush) ? 'right'
            : 'left';
  }
  for(let i=0;i<paras.length;i++){
    const p=paras[i];
    let limit=vp.height-3;
    for(let j=i+1;j<paras.length;j++){
      const q=paras[j];
      if(q.y0>p.y0+1 && q.x1>p.x0+2 && q.x0<p.x1-2){ limit=Math.min(limit,q.y0-1); break; }
    }
    /* Lithuanian runs longer, so a block may grow — but only a little, or a
       paragraph sitting above a figure would sprawl across it. */
    const boxH=p.y1-p.y0;
    p.maxH=Math.max(boxH,Math.min(limit-p.y0,boxH*1.75+p.size*0.6));
    delete p.ls;
  }
}

/* ==================================================================
   TRANSLATION ON THE PAGE
   Instead of reflowing the text into columns, the translated
   paragraphs are painted back onto the page in the place the
   originals occupied, so the document keeps its own layout,
   figures and margins.
   ================================================================== */

const overlayJobs=new Map();
const probes=new Map();          /* page -> small downscaled copy, for colour sampling */

function clamp255(v){ return v<0?0:v>255?255:v|0; }

/* A shrunken copy of the page is enough to read background and ink colours
   off, and costs one read instead of one per paragraph. */
function makeProbe(canvas,vp){
  const w=Math.min(700,canvas.width);
  if(w<8) return null;
  const h=Math.max(1,Math.round(canvas.height*w/canvas.width));
  const c=document.createElement('canvas');
  c.width=w; c.height=h;
  const cx=c.getContext('2d');
  try{ cx.drawImage(canvas,0,0,w,h); }catch(e){ return null; }
  let img;
  try{ img=cx.getImageData(0,0,w,h); }catch(e){ return null; }
  return {data:img.data,w:w,h:h,s:w/vp.width};
}

/* Background = the commonest colour behind a paragraph; ink = the average of
   the pixels furthest from it, nudged clear of the background for contrast. */
function analyse(probe,p){
  const d=probe.data, W=probe.w, s=probe.s;
  const x0=Math.max(0,Math.floor(p.x0*s)), x1=Math.min(W,Math.ceil(p.x1*s));
  const y0=Math.max(0,Math.floor(p.y0*s)), y1=Math.min(probe.h,Math.ceil(p.y1*s));
  if(x1-x0<2||y1-y0<2) return null;

  const counts=new Map();
  let total=0, sr=0, sg=0, sb=0;
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
    const i=(y*W+x)*4;
    const k=((d[i]>>4)<<8)|((d[i+1]>>4)<<4)|(d[i+2]>>4);
    counts.set(k,(counts.get(k)||0)+1);
    sr+=d[i]; sg+=d[i+1]; sb+=d[i+2]; total++;
  }
  let best=-1,bk=0xfff;
  counts.forEach((v,k)=>{ if(v>best){ best=v; bk=k; } });
  let bg=[((bk>>8)&15)*17,((bk>>4)&15)*17,(bk&15)*17];

  /* Over artwork there is no single background colour, so a patch of the
     commonest one would stand out. Blend into the average instead. */
  const flat = total>0 && best/total>0.25;
  if(!flat) bg=[sr/total|0,sg/total|0,sb/total|0];

  const hits=[]; let maxD=0;
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
    const i=(y*W+x)*4;
    const dd=Math.abs(d[i]-bg[0])+Math.abs(d[i+1]-bg[1])+Math.abs(d[i+2]-bg[2]);
    if(dd>40){ hits.push(i,dd); if(dd>maxD) maxD=dd; }
  }
  const lum=(bg[0]*0.299+bg[1]*0.587+bg[2]*0.114)/255;
  let ink=lum>0.5?[24,27,31]:[232,234,237];
  if(flat && hits.length>=12){
    const cut=Math.max(60,maxD*0.6);
    let r=0,g=0,b=0,c=0;
    for(let j=0;j<hits.length;j+=2){
      if(hits[j+1]<cut) continue;
      const i=hits[j];
      r+=d[i]; g+=d[i+1]; b+=d[i+2]; c++;
    }
    if(c>3) ink=[r/c,g/c,b/c].map((v,k)=>clamp255(bg[k]+(v-bg[k])*1.25));
  }
  return {bg:bg,ink:ink};
}

function overlayScale(box,vp){
  const w=parseFloat(box.style.width)||box.offsetWidth||vp.width;
  return w/vp.width;
}
function rescaleOverlay(box,cssScale){
  const l=box.querySelector('.transLayer');
  if(l) l.style.transform='scale('+cssScale+')';
}

function overlayColours(probe,p){
  if(document.body.dataset.mode==='dark') return {bg:DARK_PAPER,ink:DARK_INK};
  return (probe&&analyse(probe,p))||{bg:[255,255,255],ink:[24,27,31]};
}
function addBlock(layer,p,text,probe){
  const col=overlayColours(probe,p);
  const el=document.createElement('div');
  el.className='tBlock'+(p.head?' head':'');
  const st=el.style, pad=Math.max(0.7,p.size*0.1);
  st.left=(p.x0-pad)+'px';
  st.top=(p.y0-pad*0.6)+'px';
  st.width=(p.x1-p.x0+pad*2)+'px';
  st.minHeight=(p.y1-p.y0+pad)+'px';
  st.maxHeight=(p.maxH+pad)+'px';
  st.fontSize=p.size+'px';
  st.lineHeight=(p.lead/p.size).toFixed(3);
  st.textAlign=p.align;
  st.background='rgb('+col.bg.join(',')+')';
  st.color='rgb('+col.ink.join(',')+')';
  el.textContent=text;
  layer.appendChild(el);

  /* Lithuanian usually runs longer than English, so ease the size down until
     the paragraph fits the room the original had. */
  let size=p.size, guard=0;
  while(el.scrollHeight>el.clientHeight+1 && size>p.size*0.55 && guard++<20){
    size*=0.95;
    st.fontSize=size+'px';
  }
  return el;
}

function paintOverlay(n){
  if(!TR.on||TR.view==='columns'||!pdfDoc) return null;
  if(overlayJobs.has(n)) return overlayJobs.get(n);
  const src=pageBoxes[n-1], box=transBox(n);
  if(!box||!src||!src.querySelector('canvas:not(.imgLayer)')) return null;

  const job=(async()=>{
    const paras=await extractPage(n);
    if(!paras.length) return;
    const page=await pdfDoc.getPage(n);
    const vp=page.getViewport({scale:1,rotation:rotation});
    const canvas=src.querySelector('canvas:not(.imgLayer)');
    if(!canvas) return;

    if(!probes.has(n)) probes.set(n,makeProbe(canvas,vp));
    const probe=probes.get(n);

    let layer=box.querySelector('.transLayer');
    if(!layer){
      layer=document.createElement('div');
      layer.className='transLayer';
      layer.style.width=vp.width+'px';
      layer.style.height=vp.height+'px';
      box.appendChild(layer);
    }
    layer.style.transform='scale('+overlayScale(box,vp)+')';

    const res=await Promise.allSettled(paras.map(p=>queue(()=>translateText(p.text).then(out=>{
      if(!TR.on||TR.view==='columns') return;
      if(!layer.isConnected||!out) return;
      addBlock(layer,p,out,probe);
    },e=>{
      if(!TR.on||TR.view==='columns'||(e&&e.message)==='stopped') throw e;
      if(!layer.isConnected) throw e;
      addFailBlock(layer,p,probe,n);
      throw e;
    }))));
    const bad=res.filter(r=>r.status==='rejected');
    if(bad.length&&bad.length===res.length) throw bad[0].reason;
  })();
  job.catch(()=>{});
  overlayJobs.set(n,job);
  return job;
}

/* translate a page's text without needing it on screen — used by Translate page */
async function warmPage(n){
  const paras=await extractPage(n);
  if(!paras.length) return {tried:0,failed:0};
  const res=await Promise.allSettled(paras.map(p=>queue(()=>translateText(p.text))));
  paintOverlay(n);
  const failed=res.filter(r=>r.status==='rejected').length;
  return {tried:paras.length,failed:failed};
}

function addFailBlock(layer,p,probe,pageNum){
  const col=overlayColours(probe,p);
  const el=document.createElement('div');
  el.className='tBlock tFail'+(p.head?' head':'');
  const st=el.style, pad=Math.max(0.7,p.size*0.1);
  st.left=(p.x0-pad)+'px'; st.top=(p.y0-pad*0.6)+'px';
  st.width=(p.x1-p.x0+pad*2)+'px'; st.minHeight=(p.y1-p.y0+pad)+'px';
  st.maxHeight=(p.maxH+pad)+'px';
  st.fontSize=Math.max(9,p.size*0.66)+'px'; st.lineHeight='1.35';
  st.textAlign=p.align;
  st.background='rgb('+col.bg.join(',')+')';
  el.textContent='Not translated \u2014 tap to retry';
  el.title='Tap to try translating this paragraph again';
  el.addEventListener('click',async()=>{
    el.textContent='Trying again\u2026';
    try{
      const out=await translateText(p.text);
      if(el.isConnected){ el.replaceWith(addBlock(layer,p,out,probe)); }
    }catch(e){ el.textContent='Still not translated \u2014 tap to retry'; }
  });
  layer.appendChild(el);
}
function repaintVisible(){
  pageBoxes.forEach(b=>{ if(b.querySelector('canvas')) paintOverlay(+b.dataset.page); });
}
function clearOverlays(){
  overlayJobs.clear();
  document.querySelectorAll('.transLayer').forEach(l=>l.remove());
}
function refreshOverlays(){
  clearOverlays();
  if(TR.on&&TR.view!=='columns') repaintVisible();
}
