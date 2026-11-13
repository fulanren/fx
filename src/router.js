// src/router.js
// 路由：hash 路由，支持浏览器返回

const routes = [];
let currentCleanup = null;

// ============ 注册路由 ============
export function register(path, handler) {
  const keys = [];
  const pattern = path.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  });
  routes.push({ re: new RegExp('^' + pattern + '$'), keys, handler });
}

// ============ 导航 ============
export function navigate(hash) {
  if (location.hash === hash) return render();
  location.hash = hash;
}

// ============ 渲染当前路由 ============
export async function render() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));

  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

      // 清理上一个页面的资源
      if (currentCleanup) {
        try { currentCleanup(); } catch {}
        currentCleanup = null;
      }

      try {
        const result = await r.handler({ params, query });
        if (typeof result === 'function') currentCleanup = result;
      } catch (e) {
        console.error('页面渲染失败:', path, e);
        document.getElementById('view').innerHTML =
          '<div class="empty"><div class="empty-icon">⚠️</div>页面加载失败：' + (e && e.message ? e.message : '未知错误') + '</div>';
      }

      updateNav(path);
      return;
    }
  }

  // 没有匹配的路由
  document.getElementById('view').innerHTML =
    '<div class="empty"><div class="empty-icon">🤔</div>页面不存在</div>';
}

// ============ 启动路由 ============
export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

// ============ 返回上一页 ============
export function goBack() {
  history.back();
}

// ============ 底部导航高亮（预留） ============
function updateNav() {}

window.addEventListener('hashchange', async () => {
    const hash = window.location.hash;
    // 如果当前跳转的是标注页，并且路径是合法的
    if (hash.startsWith('#/annotate/')) {
        // 调用当前页面的渲染函数
        const { renderAnnotator } = await import('./views/annotator.js');
        const pathParts = hash.split('?')[0].split('/');
        const imageId = pathParts[pathParts.length - 1];
        const queryParams = {};
        new URLSearchParams(hash.split('?')[1] || '').forEach((val, key) => {
            queryParams[key] = val;
        });
        await renderAnnotator({ params: { id: imageId }, query: queryParams });
    }
});