// 极简但符合 PWA 安装标准的 Service Worker

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 强制立即接管，不等待旧版退出
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim()); // 立即控制所有打开的页面
});

// 核心修复：必须有 fetch 监听器，且不能为空，否则安卓 Chrome 判定不可安装
self.addEventListener('fetch', (e) => {
  // 这里的逻辑是：直接请求网络，不缓存，不拦截任何数据
  // 为了通过 PWA 校验，这行代码是必须存在的。
  return; 
});