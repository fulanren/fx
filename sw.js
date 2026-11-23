// 标准的极简 PWA Service Worker
self.addEventListener('install', (e) => {
  self.skipWaiting(); 
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim()); 
});

self.addEventListener('fetch', (e) => {
  // 直接放行所有网络请求，不进行缓存拦截
  e.respondWith(fetch(e.request));
});