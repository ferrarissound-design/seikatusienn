/* Replaced with a content-derived version by the production build. No user data is cached here. */
const BASE_PATH=__BASE_PATH__;
const CACHE_PREFIX='life-partner-'+encodeURIComponent(BASE_PATH)+'-';
const CACHE=CACHE_PREFIX+'__BUILD_ID__';
const ASSETS=__PRECACHE_ASSETS__;
const APP_SHELL=BASE_PATH+'index.html';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE_PATH))return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(response=>response.ok?response:caches.match(APP_SHELL)).catch(()=>caches.match(APP_SHELL)));return;
 }
 if(ASSETS.includes(url.pathname))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
