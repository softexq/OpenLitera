/* 04-select-mode.js — part of OpenLiteraReader.
   "Select text" sweep-select mode (Kindle-style drag-to-select) and the Copy pill.
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */

/* ---------- SELECT MODE: drag across text to sweep-select (Kindle-style) ---------- */
const copyPill=$('#copyPill'), quickPop=$('#quickPop'), selectHint=$('#selectHint');
function caretRange(x,y){
  if(document.caretRangeFromPoint) return document.caretRangeFromPoint(x,y);
  if(document.caretPositionFromPoint){
    const p=document.caretPositionFromPoint(x,y);
    if(p){ const r=document.createRange(); r.setStart(p.offsetNode,p.offset); r.collapse(true); return r; }
  }
  return null;
}
function inTextLayer(node){
  const el=node && (node.nodeType===1?node:node.parentElement);
  return el && el.closest && el.closest('.textLayer,.transLayer');
}

let anchorR=null, selecting=false;
/* first-use hints for select-mode / quick-translate — each shown once
   ever, then remembered (falls back to "always show" if storage isn't
   available, e.g. some restrictive embedded contexts) */
function hintSeen(key){
  try{ return localStorage.getItem('olr-hint-'+key)==='1'; }catch(e){ return false; }
}
function markHintSeen(key){
  try{ localStorage.setItem('olr-hint-'+key,'1'); }catch(e){}
}
function showHintOnce(key,text){
  if(hintSeen(key)){ selectHint.classList.remove('show'); return; }
  selectHint.textContent=text;
  selectHint.classList.add('show');
  markHintSeen(key);
}

function enterSelectMode(on){
  selectMode=on;
  document.body.classList.toggle('selectmode',on);
  $('#selectBtn').classList.toggle('active',on);
  if(on) showHintOnce('selectMode','Drag across the text to select · tap the button again to exit');
  else selectHint.classList.remove('show');
  const s=window.getSelection(); if(s) s.removeAllRanges();
  copyPill.classList.remove('show');
  if(on) document.body.classList.remove('hud-hidden');
  syncModeNavGuard();
}
$('#selectBtn').addEventListener('click',()=>enterSelectMode(!selectMode));

viewer.addEventListener('pointerdown',e=>{
  if(!selectMode) return;
  const r=caretRange(e.clientX,e.clientY);
  if(!r || !inTextLayer(r.startContainer)) return;
  e.preventDefault();
  anchorR=r; selecting=true;
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r.cloneRange());
  copyPill.classList.remove('show');
  viewer.setPointerCapture&&viewer.setPointerCapture(e.pointerId);
});
viewer.addEventListener('pointermove',e=>{
  if(!selectMode || !selecting || !anchorR) return;
  e.preventDefault();
  const f=caretRange(e.clientX,e.clientY);
  if(!f) return;
  const r=document.createRange();
  if(anchorR.compareBoundaryPoints(Range.START_TO_START,f)<=0){
    r.setStart(anchorR.startContainer,anchorR.startOffset);
    r.setEnd(f.startContainer,f.startOffset);
  }else{
    r.setStart(f.startContainer,f.startOffset);
    r.setEnd(anchorR.startContainer,anchorR.startOffset);
  }
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
},{passive:false});
['pointerup','pointercancel'].forEach(ev=>viewer.addEventListener(ev,()=>{
  if(!selectMode) return;
  selecting=false;
  const s=window.getSelection();
  copyPill.classList.toggle('show', !!(s && !s.isCollapsed && s.toString().trim()));
}));

async function doCopy(text){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    const ta=document.createElement('textarea'); ta.value=text;
    ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
}
copyPill.addEventListener('click',async()=>{
  const s=window.getSelection(); const text=s?s.toString().trim():'';
  if(text){ await doCopy(text); copyPill.textContent='Copied ✓'; setTimeout(()=>copyPill.textContent='Copy',1200); }
});
