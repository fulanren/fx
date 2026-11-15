// 极简 Service Worker，仅用于启用 PWA 安装，不做任何复杂缓存
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // 直接放行所有网络请求，不做拦截，彻底告别 Failed to fetch
});