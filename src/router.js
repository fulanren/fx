const routes = [];
let currentCleanup = null;
export function register(path, handler) {
  const keys = [];
  const pattern = path.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; });
  routes.push({ re: new RegExp('^' + pattern + '$'), keys, handler });
}
export function navigate(hash) {
  if (location.hash === hash) return render();
  location.hash = hash;
}
export async function render() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      if (currentCleanup) { try { currentCleanup(); } catch {} currentCleanup = null; }
      const result = await r.handler({ params, query });
      if (typeof result === 'function') currentCleanup = result;
      updateNav(path);
      return;
    }
  }
  document.getElementById('view').innerHTML = '<div class="empty"><div class="empty-icon">🤔</div>页面不存在</div>';
}
function updateNav(path) {
  document.querySelectorAll('#bottombar a').forEach(a => {
    const tab = a.getAttribute('data-tab');
    a.classList.toggle('active',
      (tab === 'home' && (path === '/' || path.startsWith('/chapter'))) ||
      (tab === 'review' && path.startsWith('/review')) ||
      (tab === 'trash' && path.startsWith('/trash'))
    );
  });
}
export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}