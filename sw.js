/* ============================================================
 * 资料复习系统 · 离线 Service Worker（完整版）
 * 用法：直接覆盖项目根目录的 sw.js（你原来的版本是 fetch 直通，等于没缓存）
 *
 * 策略
 *   install  预缓存「应用外壳 + 核心 JS/CSS」；大体积 wasm/语言包不预缓存
 *   activate 删除旧版本缓存并立即接管已打开页面
 *   fetch    导航 NetworkFirst（断网回落 index.html）
 *            同源静态资源 CacheFirst（vendor / 字体 / wasm / 语言包）
 *            跨源残留请求 Stale-While-Revalidate
 *            非 GET 一律放行
 *
 * 三条硬规矩
 *   1) SW 里没有 document，禁止 import src/ 下任何模块；路径一律用 self.location 解析，
 *      因此部署在 /fx/ 这种子目录（manifest.json 的 id 就是 "/fx/"）也照样正确。
 *   2) 预缓存清单不宜过大：iOS Safari 的 Cache 配额有限，且 install 里任一请求失败
 *      可能让整批回滚，所以这里逐个 add + catch，缺文件只跳过不报错。
 *   3) 改了代码/样式必须把 VERSION 加一号，否则用户端仍拿旧缓存
 *      （这是"明明改了却没生效"的第一嫌疑）。
 * ============================================================ */

const VERSION = 'v5';                  // <- 每次发版手动 +1，这里是唯一要改的地方
const PRECACHE = 'kg-shell-' + VERSION;
const RUNTIME = 'kg-runtime-' + VERSION;
const RUNTIME_MAX = 500;               // 运行时缓存条目上限，超出按先进先出清

/** 相对 SW 自身位置解析绝对 URL：缓存 key 的规范形态，子目录部署安全 */
const abs = (p) => new URL(p, self.location.href).href;

/* ---------- 预缓存清单：装完立刻断网也能开页面、能标注与导出 ---------- */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/styles/main.css',

  /* 核心运行时代码 */
  './src/main.js',
  './src/router.js',
  './src/store.js',
  './src/db.js',
  './src/autosave.js',
  './src/migrate.js',
  './src/utils/deps.js',
  './src/utils/dom.js',
  './src/utils/id.js',
  './src/utils/date.js',
  './src/utils/platform.js',
  './src/ui/toast.js',
  './src/ui/confirm.js',

  /* 懒加载的主要视图：点进去才 import，不预先抓就会"断网后进不去卡片" */
  './src/views/pdfViewer.js',
  './src/views/editPoint.js',
  './src/views/imageList.js',
  './src/views/annotator.js',
  './src/views/home.js',
  './src/views/chapter.js',
  './src/views/editTask.js',
  './src/views/review.js',
  './src/views/recycle.js',
  './src/views/search.js',
  './src/views/audio.js',
  './src/views/stats.js',
  './src/views/composer.js',
  './src/views/pdfImport.js',
  './src/views/pdfTextImport.js',
  './src/ui/attachmentModal.js',
  './src/utils/searchEngine.js',

  /* 第三方库：只预缓存"没它就白屏"的这几个 */
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/pdf-lib/pdf-lib.min.js',
  './vendor/jszip/jszip.min.js',
  './vendor/katex/katex.min.js',
  './vendor/katex/katex.min.css',
  './vendor/jspdf/jspdf.umd.min.js',
  './vendor/html2canvas/html2canvas.min.js',
  './vendor/html2pdf/html2pdf.bundle.min.js',
  './vendor/html-docx/html-docx.js',
  './vendor/mammoth/mammoth.browser.min.js',

  /* ==== 由 sw_check.py 自动补齐 ==== */
  './src/ui/colorPicker.js',
  './src/ui/mergeModal.js',
  './src/ui/reminder.js',
  './src/ui/shortcuts.js',
  './src/ui/sortable.js',
  './src/ui/speech.js',
  './src/ui/theme.js',
  './src/utils/canvas.js',
  './src/utils/emojiReplacer.js',
  './src/views/ankiExport.js',
  './src/views/annotatorPaper.js',
  './src/views/annotatorTape.js',
  './src/views/annotatorText.js',
  './src/views/batchImport.js',
  './src/views/countdownPage.js',
  './src/views/editChapter.js',
  './src/views/errorBook.js',
  './src/views/exporter.js',
  './src/views/help.js',
  './src/views/importDoc.js',
  './src/views/inbox.js',
  './src/views/ocr.js',
  './src/views/patternCrop.js',
  './src/views/pdfImportMode.js',
  './src/views/resourceOverview.js',
  './src/views/settings.js',
  './src/views/template.js',
  './src/views/uploadPdf.js',

  /* tesseract 的 core/*.wasm 与 tessdata 中英文包（合计 20-40MB）故意不预缓存：
   * 它们只在第一次用 OCR 时才需要，交给下面的 CacheFirst 在联网期间自动落盘即可。
   * 放进来会让 install 变慢、易超配额、失败率上升。 */

];

/* ---------- install：逐个抓，任一文件缺失只跳过，不拖垮整个安装 ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    for (const rel of SHELL) {
      try {
        await cache.add(new Request(abs(rel), { cache: 'reload' }));
      } catch (err) {
        console.warn('[SW] 预缓存跳过', rel, err && err.message);
      }
    }
    await self.skipWaiting();
  })());
});

/* ---------- activate：清掉旧版本缓存，立即接管所有已打开页面 ---------- */
self.addEventListener('activate', (e) => {
  const keep = [PRECACHE, RUNTIME];
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
    const all = await self.clients.matchAll({ type: 'window' });
    all.forEach(c => c.postMessage({ type: 'SW_READY', version: VERSION }));
  })());
});

/* ---------- message：页面主动要求换新 / 预热一批资源 ---------- */
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
  if (d && d.type === 'PRECACHE' && Array.isArray(d.urls)) {
    e.waitUntil((async () => {
      const c = await caches.open(RUNTIME);
      for (const u of d.urls) {
        try { await c.add(new Request(u, { cache: 'reload' })); } catch (_) { }
      }
    })());
  }
});

/** 可缓存的静态资源后缀（含 wasm / 语言包 / 字体） */
const STATIC_RE = /\.(js|mjs|css|html|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|wasm|json|map|pdf|traineddata(\.gz)?)$/i;

/** 运行时缓存按先进先出裁剪，防止无限膨胀挤掉预缓存 */
async function trim(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    await Promise.all(keys.slice(0, keys.length - max).map(r => cache.delete(r)));
  } catch (_) { /* 配额错误吞掉，不影响本次请求 */ }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 写操作绝不拦截

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  /* 1) 页面导航（冷启动 / 点桌面图标）：先联网，断网回落缓存里的 index.html */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(PRECACHE);
        await c.put(abs('./index.html'), res.clone());      // 顺手保鲜
        return res;
      } catch (err) {
        const cached = (await caches.match(abs('./index.html'))) || (await caches.match(abs('./')));
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8">'
          + '<body style="font-family:system-ui,sans-serif;padding:28px;line-height:1.7">'
          + '<h3>离线，且本机尚未缓存应用外壳</h3>'
          + '<p>请先在有网络时打开一次本应用，让它把 index.html 与 src/ 抓下来；'
          + '之后断网即可正常使用。</p></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  /* 2) 跨源请求（万一某处还残留 CDN 硬编码）：Stale-While-Revalidate */
  if (!sameOrigin) {
    if (!STATIC_RE.test(url.pathname)) return;
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone()).then(() => trim(RUNTIME, RUNTIME_MAX)).catch(() => { });
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  /* 3) 带 query 且不像静态资源的同源请求（接口式调用）不缓存，避免污染 */
  if (url.search && !STATIC_RE.test(url.pathname)) return;

  /* 4) 同源静态资源：CacheFirst（vendor / wasm / tessdata / KaTeX 字体全走这里） */
  if (STATIC_RE.test(url.pathname)) {
    e.respondWith((async () => {
      const isVendor = url.pathname.indexOf('vendor/') !== -1;
      const hit = await caches.match(req, { ignoreSearch: isVendor });   // vendor 带 ?v= 也命中同一份
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') {
          const cache = await caches.open(RUNTIME);
          await cache.put(req, res.clone());
          trim(RUNTIME, RUNTIME_MAX);
        }
        return res;
      } catch (err) {
        /* 断网且从未缓存：对 pdf worker / wasm 明确报 504，让上层出中文提示而不是静默白屏 */
        if (/(\.wasm$|pdf\.worker)/.test(url.pathname)) {
          return new Response('offline-missing-asset', { status: 504 });
        }
        throw err;
      }
    })());
    return;
  }

  /* 5) 其余同源请求：默认放行 */
});

/* 未捕获错误打日志，方便手机连电脑用 chrome://inspect 排查 */
self.addEventListener('error', (e) => console.error('[SW] error', e.message));
