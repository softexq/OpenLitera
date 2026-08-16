/* 01-core-setup.js — part of OpenLiteraReader.
   PDF.js worker config, the $() helper, core DOM references, and top-level app state (zoom, settings, etc).
   Loaded as a plain (non-module) script, in numeric order, from index.html —
   it shares one global scope with every other 0X-*.js file, the same as if
   this were all still one <script> block. Keep that load order when adding
   a new file: anything referenced immediately at the top level (not inside
   a function) must already have been loaded by an earlier file. */


pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* Registering this is what makes Chrome/Brave on Android offer
   "Install app" / "Add to Home screen" with a standalone (no address
   bar) window, and it's also the prerequisite PWABuilder needs to
   package a real .apk from this site's URL. Wrapped in try/catch and a
   feature check since this should never be able to break the reader
   itself if a browser doesn't support it or a request is blocked. */
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

const $ = s => document.querySelector(s);
const landing=$('#landing'), viewer=$('#viewer'), pagesWrap=$('#pagesWrap'),
      topbar=$('#topbar'), progressWrap=$('#progressWrap'),
      fill=$('#progressFill'), knob=$('#progressKnob'), track=$('#progressTrack'),
      badge=$('#pageBadge'), sidebar=$('#sidebar'), scrim=$('#scrim'),
      sheet=$('#sheet'), sheetScrim=$('#sheetScrim'), zoomCtl=$('#zoomCtl');
const audioPanel=$('#audioPanel'), audioScrim=$('#audioScrim'),
      audioTitleEl=$('#audioTitle'), audioEl=$('#audioEl');

let pdfDoc=null, pageBoxes=[], numPages=0, currentPage=1;
let settings={ pageCount:false, knob:true, tapHud:true, skipRunning:true, chapters:true, trueImages:true };
let selectMode=false;

/* ===== zoom state ===== */
let zoom=1;                 // committed layout scale
const ZMIN=.6, ZMAX=6;
const DPR=Math.min(window.devicePixelRatio||1,3);
let baseWidth=0, pageRatio=1.4;
const rendered=new Map(), rendering=new Set();
let rerenderTimer=null;
