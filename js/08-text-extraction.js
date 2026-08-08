/* 08-text-extraction.js — part of OpenLiteraReader.
   Pulling paragraphs out of a PDF page (column/gutter detection, running-header removal) for translation.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------------- text extraction ---------------- */
function mul(a,b){
  return [
    a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]
  ];
}
function median(arr){
  if(!arr.length) return 0;
  const s=arr.slice().sort((x,y)=>x-y);
  return s[Math.floor(s.length/2)];
}
const LIG={'ﬁ':'fi','ﬂ':'fl','ﬀ':'ff','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'ft','ﬆ':'st'};
function tidy(s){
  return s.replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g,c=>LIG[c])
          .replace(/\u00ad/g,'')
          .replace(/[\u2010\u2011]/g,'-')
          .replace(/\s+/g,' ')
          .trim();
}
const RUNNING=/^\s*[\[\(\-–—|]*\s*(page|p\.|psl\.)?\s*([0-9]{1,4}|[ivxlcdmIVXLCDM]{1,7})\s*[\]\)\-–—|]*\s*$/;

/* --- one page, broken into visual lines (and into gap-split segments,
       which is what makes a two-column page readable) --- */
function buildLine(items){
  let txt='', prev=null;
  for(const it of items){
    if(prev){
      const gap=it.x-(prev.x+prev.w);
      if(gap>prev.h*0.18 && !/\s$/.test(txt) && !/^\s/.test(it.s)) txt+=' ';
    }
    txt+=it.s; prev=it;
  }
  return {
    text:tidy(txt), y:items[0].y, x0:items[0].x,
    x1:Math.max.apply(null,items.map(i=>i.x+i.w)),
    h:median(items.map(i=>i.h))
  };
}
async function pageLines(n){
  const page=await pdfDoc.getPage(n);
  const vp=page.getViewport({scale:1});
  let tc;
  try{ tc=await page.getTextContent(); }catch(e){ return {lines:[],segs:[],vp:vp}; }

  const items=[];
  for(const it of tc.items){
    if(!it.str||!it.str.trim()) continue;
    const m=mul(vp.transform,it.transform);
    const h=Math.hypot(m[2],m[3])||Math.abs(m[3])||10;
    items.push({s:it.str, x:m[4], y:m[5], w:it.width||0, h:h});
  }
  if(!items.length) return {lines:[],segs:[],vp:vp};

  items.sort((a,b)=>(a.y-b.y)||(a.x-b.x));
  const groups=[];
  for(const it of items){
    const g=groups[groups.length-1];
    if(g && Math.abs(it.y-g[0].y)<=Math.max(2,Math.min(it.h,g[0].h)*0.55)) g.push(it);
    else groups.push([it]);
  }

  const lines=[], segs=[];
  for(const g of groups){
    g.sort((a,b)=>a.x-b.x);
    lines.push(buildLine(g));
    let part=[g[0]];
    for(let i=1;i<g.length;i++){
      const prev=g[i-1], it=g[i];
      if(it.x-(prev.x+prev.w)>Math.max(prev.h*2,10)){ segs.push(buildLine(part)); part=[it]; }
      else part.push(it);
    }
    segs.push(buildLine(part));
  }
  return {lines:lines.filter(L=>L.text), segs:segs.filter(L=>L.text), vp:vp};
}

/* --- a title repeated in the margin of most pages is furniture, not content --- */
const runningHeads=new Set();
let headsLearned=false;
async function learnRunningHeads(){
  if(headsLearned) return;
  headsLearned=true;
  const pick=[], step=Math.max(1,Math.floor(numPages/8));
  for(let n=1;n<=numPages&&pick.length<8;n+=step) pick.push(n);
  if(pick.length<2) return;
  const seen=new Map();
  for(const n of pick){
    let res;
    try{ res=await pageLines(n); }catch(e){ continue; }
    const top=res.vp.height*0.09, bot=res.vp.height*0.91;
    const band=new Set();
    for(const L of res.lines){
      if(L.y<top||L.y>bot){
        const k=L.text.replace(/\d+/g,'#').trim();
        if(k.length>2&&k.length<90) band.add(k);
      }
    }
    band.forEach(k=>seen.set(k,(seen.get(k)||0)+1));
  }
  const need=Math.max(2,Math.ceil(pick.length*0.6));
  seen.forEach((count,k)=>{ if(count>=need) runningHeads.add(k); });
}

/* --- find the gutter of a two-column page, if there is one --- */
function findGutter(lines){
  if(lines.length<8) return null;
  const lo=Math.min.apply(null,lines.map(L=>L.x0));
  const hi=Math.max.apply(null,lines.map(L=>L.x1));
  const span=hi-lo;
  if(span<=0) return null;
  let best=null;
  for(let f=0.34;f<=0.66;f+=0.01){
    const g=lo+span*f;
    let cross=0,left=0,right=0;
    for(const L of lines){
      if(L.x0<g-2&&L.x1>g+2) cross++;
      else if(L.x1<=g) left++;
      else right++;
    }
    if(left<4||right<4) continue;
    const balance=Math.min(left,right)/Math.max(left,right);
    const score=balance-(cross/lines.length)*3;
    if(!best||score>best.score) best={g:g,score:score};
  }
  return best&&best.score>0.55?best.g:null;
}
/* left column top to bottom, then right, with full-width lines holding their place */
function readingOrder(lines,g){
  const full=[],left=[],right=[];
  for(const L of lines){
    if(L.x0<g-2&&L.x1>g+2){ L.col=0; full.push(L); }
    else if(L.x1<=g){ L.col=1; left.push(L); }
    else { L.col=2; right.push(L); }
  }
  const between=(arr,a,b)=>arr.filter(L=>L.y>a&&L.y<=b).sort((p,q)=>p.y-q.y);
  if(!full.length) return left.sort((p,q)=>p.y-q.y).concat(right.sort((p,q)=>p.y-q.y));
  full.sort((p,q)=>p.y-q.y);
  const out=[]; let prev=-Infinity;
  for(const f of full){
    out.push.apply(out,between(left,prev,f.y));
    out.push.apply(out,between(right,prev,f.y));
    out.push(f); prev=f.y;
  }
  out.push.apply(out,between(left,prev,Infinity));
  out.push.apply(out,between(right,prev,Infinity));
  return out;
}

async function extractPage(n){
  if(pageParas.has(n)) return pageParas.get(n);
  if(settings.skipRunning) await learnRunningHeads();

  const res=await pageLines(n);
  const vp=res.vp;
  if(!res.lines.length){ pageParas.set(n,[]); return []; }

  const top=vp.height*0.09, bot=vp.height*0.91;
  const keep=L=>{
    if(!settings.skipRunning) return true;
    if(L.y>=top&&L.y<=bot) return true;
    if(RUNNING.test(L.text)) return false;
    return !runningHeads.has(L.text.replace(/\d+/g,'#').trim());
  };
  const lines=res.lines.filter(keep), segs=res.segs.filter(keep);
  if(!lines.length){ pageParas.set(n,[]); return []; }

  const gutter=findGutter(segs);
  let use;
  if(gutter!=null) use=readingOrder(segs,gutter);
  else { use=lines; use.forEach(L=>{ L.col=0; }); }

  const medH=median(use.map(L=>L.h))||12;
  const gaps=[];
  for(let i=1;i<use.length;i++){
    const g=use[i].y-use[i-1].y;
    if(g>0&&g<medH*3) gaps.push(g);
  }
  const lead=median(gaps)||medH*1.2;

  /* margins measured per column, so an indent means the same thing everywhere */
  const cols={};
  use.forEach(L=>{ (cols[L.col]=cols[L.col]||[]).push(L); });
  Object.keys(cols).forEach(k=>{
    const g=cols[k];
    const gl=median(g.map(L=>L.x0)), gr=Math.max.apply(null,g.map(L=>L.x1));
    g.forEach(L=>{ L.cLeft=gl; L.cRight=gr; });
  });

  const paras=[];
  let cur=null;
  for(let i=0;i<use.length;i++){
    const L=use[i], P=use[i-1];
    const isHead = L.h>medH*1.16 ||
                   (L.text.length<70 && L.text.length>1 &&
                    L.text===L.text.toUpperCase() && /\p{L}/u.test(L.text));
    let brk=!cur;
    if(P&&!brk){
      const gap=L.y-P.y;
      const width=Math.max(1,P.cRight-P.cLeft);
      if(L.col!==P.col) brk=true;                                  // changed column
      else if(gap<-lead*0.5) brk=true;                             // jumped back up
      else if(gap>lead*1.5) brk=true;                              // blank space
      else if(L.x0>L.cLeft+medH*0.85) brk=true;                    // indented start
      else if(Math.abs(L.h-P.h)>Math.max(1,medH*0.2)) brk=true;    // size change
      else if(P.x1<P.cRight-width*0.16 && /[.!?:;"”»)]$/.test(P.text)) brk=true;
      else if(isHead!==cur.head) brk=true;
    }
    if(brk){ cur={text:L.text, head:isHead, ls:[L]}; paras.push(cur); }
    else{
      if(/[a-zà-öø-ÿąčęėįšųūž]-$/.test(cur.text) && /^[a-zà-öø-ÿąčęėįšųūž]/.test(L.text))
        cur.text=cur.text.slice(0,-1)+L.text;                      // rejoin a split word
      else cur.text+=' '+L.text;
      cur.ls.push(L);
    }
  }
  measureParagraphs(paras,vp,medH);
  const out=paras.filter(p=>/\p{L}|\p{N}/u.test(p.text) && p.text.length>1);
  pageParas.set(n,out);
  return out;
}
