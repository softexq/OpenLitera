/* sw.js — part of OpenLiteraReader.
   Caches the app shell (this file list) so the reader itself loads
   instantly and works offline once it's been opened at least once.
   Deliberately does NOT cache books/, audiobooks/, the PDF.js CDN
   script, or the dictionary API — those are fetched fresh over the
   network as normal; only the app's own HTML/CSS/JS is cached here. */
const CACHE_NAME='olr-shell-v1';
const APP_SHELL=[
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/css/01-variables-and-landing.css',
  '/css/02-hud-and-viewer.css',
  '/css/03-quick-translate.css',
  '/css/04-sidebar-and-sheet.css',
  '/css/05-bilingual-view.css',
  '/css/06-panels-and-desktop.css',
  '/css/07-overlay-and-themes.css',
  '/js/01-core-setup.js',
  '/js/02-file-open-and-pages.js',
  '/js/03-zoom-and-touch.js',
  '/js/04-select-mode.js',
  '/js/05-quick-translate.js',
  '/js/06-navigation-and-progress.js',
  '/js/07-translation-engines.js',
  '/js/08-text-extraction.js',
  '/js/09-bilingual-view.js',
  '/js/10-translation-lifecycle.js',
  '/js/11-layout-and-view-modes.js',
  '/js/12-sidebar-and-chrome.js',
  '/js/13-page-overlay-translation.js',
  '/js/14-images-and-compare-view.js'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

/* Stale-while-revalidate for the app shell only: serve the cached copy
   immediately if there is one (fast, works offline), and in the
   background fetch a fresh copy to update the cache for next time.
   Anything not in APP_SHELL (PDFs, audiobooks, the translation/
   dictionary APIs, the PDF.js CDN) is left completely alone — this
   listener just doesn't touch those requests at all. */
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  const path=url.pathname==='/'?'/':url.pathname;
  if(!APP_SHELL.includes(path)) return;

  event.respondWith(
    caches.match(event.request).then(cached=>{
      const fresh=fetch(event.request).then(resp=>{
        if(resp&&resp.status===200){
          const copy=resp.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        }
        return resp;
      }).catch(()=>cached);
      return cached||fresh;
    })
  );
});
