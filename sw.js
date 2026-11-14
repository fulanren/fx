const CACHE_NAME = 'kaogong-v1';
const ASSETS = [
  './',
  './index.html',
  './assets/styles/main.css'
];

// 安装时缓存基础资源
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

// 拦截请求，优先返回缓存
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});