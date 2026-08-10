const CACHE = 'shg-task-manager-v272';
const COMMENT_ASSETS = Array.from({length:16},(_,index)=>`./jira-comments-${String(index+1).padStart(2,'0')}.js`);
const ASSETS = ['./','./index.html','./styles.css','./jira-tasks.js','./victor-main-filter.js','./app.js','./version-51.js','./version-52.js','./version-53.js','./version-54.js','./version-55.js','./version-56.js','./version-57.js','./version-58.js','./version-59.js','./version-60.js','./version-62.js','./version-63.js','./version-64.js','./manifest.webmanifest','./icons/app-icon.svg','./icons/mailo-logo.jpeg',...COMMENT_ASSETS];
const STATIC_PATHS = new Set(ASSETS.map(asset => new URL(asset, self.location.origin).pathname));

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
  const url = new URL(event.request.url);
  // Never cache Supabase/API responses or other cross-origin requests. They are
  // dynamic and were the source of the browser-profile growth and UI freezes.
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' })
      .catch(() => caches.match('./index.html')));
    return;
  }
  if (!STATIC_PATHS.has(url.pathname)) return;
  const canonicalRequest = new Request(new URL(url.pathname, self.location.origin).toString());
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(canonicalRequest, copy));
    }
    return response;
  }).catch(() => caches.match(canonicalRequest)));
});
