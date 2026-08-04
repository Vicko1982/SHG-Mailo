const CACHE = 'shg-task-manager-v257';
const COMMENT_ASSETS = Array.from({length:16},(_,index)=>`./jira-comments-${String(index+1).padStart(2,'0')}.js`);
const ASSETS = ['./','./index.html','./styles.css','./jira-tasks.js','./victor-main-filter.js','./app.js','./version-51.js','./version-52.js','./version-53.js','./version-54.js','./version-55.js','./version-56.js','./version-57.js','./manifest.webmanifest','./icons/app-icon.svg','./icons/mailo-logo.jpeg',...COMMENT_ASSETS];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html'))));
});
