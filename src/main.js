import { migrate, cleanExpiredDrafts, cleanRecycleBin } from './migrate.js';
import { storageSelfCheck } from './db.js';
import { register, startRouter, navigate } from './router.js';
import { flushAll } from './store.js';
import * as store from './store.js';
import { initTheme } from './ui/theme.js';
import { initShortcuts } from './ui/shortcuts.js';
import { el } from './utils/dom.js';
import { renderHome, renderSidebar } from './views/home.js';
import { renderChapterList, renderChapterDetail } from './views/chapter.js';
import { renderEditTask } from './views/editTask.js';
import { renderEditChapter } from './views/editChapter.js';
import { renderEditPoint } from './views/editPoint.js';
import { renderReview } from './views/review.js';
import { renderRecycle } from './views/recycle.js';
import { renderSearch } from './views/search.js';
import { renderInbox } from './views/inbox.js';
import { renderAnnotator } from './views/annotator.js';
import { renderComposer } from './views/composer.js';
import { renderSettings } from './views/settings.js';
import { renderHelp } from './views/help.js';
import { renderTemplate } from './views/template.js';
import { renderCountdownPage } from './views/countdownPage.js';
import { renderErrorBook } from './views/errorBook.js';
import { toastError, toastSuccess } from './ui/toast.js';
import { renderPdfViewer } from './views/pdfViewer.js';
import { renderUploadPdf } from './views/uploadPdf.js';
import { renderResourceOverview } from './views/resourceOverview.js';
import { initEmojiReplacer } from './utils/emojiReplacer.js';

// 修复 PDF.js Worker 404 的问题
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

async function boot() {
  migrate();
  store.autoCleanRecycleBin();
  await migrateImageNames();

  const check = await storageSelfCheck();
  if (!check.ok) { showStorageError(); return; }

  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch (e) { }
  }

  cleanExpiredDrafts();
  cleanRecycleBin();
  initTheme();

  // ============ 可自定义的顶栏快捷按钮 ============
  const btnMore = document.getElementById('btn-more');
  if (btnMore) {
    const topbarActions = document.getElementById('topbar-actions');

    const ALL_TOOLS = [
      {
        id: 'theme', icon: '🌙', title: '切换主题', action: () => {
          const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
          if (isDark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('kg_theme', 'light'); }
          else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('kg_theme', 'dark'); }
          location.reload();
        }
      },
      {
        id: 'quickNote', icon: '⚡️', title: '速记', action: () => {
          const text = prompt('⚡️ 速记：随手记下灵感或错题');
          if (text && text.trim()) { store.addInbox(text.trim()); toastSuccess('已存入速记收件箱'); }
        }
      },
      { id: 'review', icon: '🎯', title: '去复习', href: '#/review' },
      { id: 'search', icon: '🔍', title: '全局搜索', href: '#/search' },
      { id: 'export', icon: '📤', title: '导出数据', action: () => import('./views/settings.js').then(m => m.openExportModal()) },
      { id: 'import', icon: '📥', title: '导入数据', action: () => import('./views/settings.js').then(m => m.openImportModal()) },
      { id: 'template', icon: '📑', title: '资料模板', href: '#/template' },
      { id: 'importDoc', icon: '📄', title: '文档导入', action: () => import('./views/importDoc.js').then(m => m.globalImportDocModal()) },
      { id: 'home', icon: '🏠', title: '背诵首页', href: '#/' },
      { id: 'resources', icon: '📁', title: '资源总览', href: '#/resources' },
      { id: 'inbox', icon: '📥', title: '速记收件箱', href: '#/inbox' },
      { id: 'countdown', icon: '⏰', title: '考试倒计时', href: '#/countdown' },
      { id: 'trash', icon: '🗑', title: '回收站', href: '#/trash' },
      { id: 'help', icon: '❓', title: '帮助', href: '#/help' },
      { id: 'settings', icon: '⚙️', title: '设置页', href: '#/settings' },
      {
        id: 'backToTop', icon: '🚀', title: '回到顶部', action: () => {
          const scrollContainer = document.querySelector('.pdf-scroll-container') || document.getElementById('view') || window;
          if (scrollContainer === window) window.scrollTo({ top: 0, behavior: 'smooth' });
          else scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
    ];

    let prefs = JSON.parse(localStorage.getItem('kg_topbar_prefs') || 'null');

    // 👇 核心修复：如果之前存的是数组，或者根本没存过，初始化对象
    if (!prefs || Array.isArray(prefs) || Object.keys(prefs).length === 0) {
      prefs = {
        theme: false,
        quickNote: false,
        review: false,
        search: false,
        export: false,
        import: false,
        template: false,
        importDoc: false,
        home: true,
        resources: true,
        inbox: false,
        countdown: false,
        trash: true,
        help: true,
        settings: true,  // 比如让设置页默认显示
        backToTop: true
      };
    }

    function renderTopbarTools() {
      // 1. 先清理掉旧的按钮
      topbarActions.querySelectorAll('.topbar-tool-btn').forEach(el => el.remove());

      // 2. 判断当前 prefs 的格式，兼容“对象”和“数组”
      const activeIds = Array.isArray(prefs)
        ? prefs
        : Object.keys(prefs).filter(k => prefs[k] === true);

      // 3. 遍历渲染
      activeIds.forEach(id => {
        const tool = ALL_TOOLS.find(t => t.id === id);
        if (!tool) return;

        const btn = el('button', {
          class: 'btn btn-sm btn-ghost topbar-tool-btn',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            marginRight: '4px', // 👈 把它改小一点，比如 2px 或 4px
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: 'rgba(142, 202, 230, 0.12)',
            position: 'relative'
          },
          text: tool.id === 'theme'
            ? (document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙')
            : tool.icon,
          title: tool.title,
          onClick: (e) => {
            e.stopPropagation();
            if (tool.href) window.location.hash = tool.href;
            else if (tool.action) tool.action();
          }
        });
        topbarActions.insertBefore(btn, btnMore);
      });
    }
    renderTopbarTools();

    btnMore.onclick = (e) => {
      e.stopPropagation();
      openMoreMenu();
    };
  }

  // ============ 全局剪贴板嗅探 ============
  window.addEventListener('paste', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const text = e.clipboardData.getData('text');
    const items = e.clipboardData.items;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) { hasImage = true; break; }
    }
    if (!text && !hasImage) return;
    e.preventDefault();
    openPasteCreateModal(text, hasImage);
  });

  // ============ 存储空间预警 ============
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      const percent = Math.round((usage / quota) * 100);
      if (percent > 80) {
        const view = document.getElementById('view');
        if (view && location.hash === '#/') {
          const banner = el('div', {
            class: 'banner banner-danger',
            style: { background: '#FFE5E5', color: '#EF476F', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', fontWeight: '600' }
          }, [
            el('span', { text: `⚠️ 存储空间已用 ${percent}%，请尽快在设置中备份或压缩图片！` })
          ]);
          view.insertBefore(banner, view.firstChild);
        }
      }
    });
  }

  // ============ 路由注册 ============
  register('/', renderHome);
  register('/chapter-list/:taskId', renderChapterList);
  register('/chapter/:id', renderChapterDetail);
  register('/edit-task/:id', renderEditTask);
  register('/edit-chapter/:id', renderEditChapter);
  register('/edit-point/:id', renderEditPoint);
  register('/review', renderReview);
  register('/trash', renderRecycle);
  register('/search', renderSearch);
  register('/inbox', renderInbox);
  register('/annotate/:id', renderAnnotator);
  register('/composer', renderComposer);
  register('/settings', renderSettings);
  register('/help', renderHelp);
  register('/template', renderTemplate);
  register('/countdown', renderCountdownPage);
  register('/error-book', renderErrorBook);
  register('/pdf-viewer/:id', renderPdfViewer);
  register('/upload-pdf/:id', renderUploadPdf);
  register('/resources', renderResourceOverview);

  startRouter();

  // ============ 返回按钮逻辑 ============
  const btnBack = document.getElementById('btn-back');
  btnBack.onclick = () => {
    const hash = location.hash;
    if (hash.startsWith('#/edit-task/')) {
      navigate('#/');
    } else if (hash.startsWith('#/edit-chapter/')) {
      const m = hash.match(/taskId=([^&]+)/);
      if (m) navigate(`#/chapter-list/${m[1]}`);
      else history.back();
    } else if (hash.startsWith('#/edit-point/')) {
      const m = hash.match(/chapterId=([^&]+)/);
      if (m) navigate(`#/chapter/${m[1]}`);
      else history.back();
    } else if (hash.startsWith('#/chapter/')) {
      const chapterId = hash.split('/')[2]?.split('?')[0];
      const chapter = store.getChapter(chapterId);
      if (chapter) navigate(`#/chapter-list/${chapter.taskId}`);
      else navigate('#/');
    } else if (hash.startsWith('#/chapter-list/')) {
      navigate('#/');
    } else if (hash.startsWith('#/pdf-viewer/') || hash.startsWith('#/annotate/')) {
      const match = hash.match(/[?&]returnUrl=([^&]+)/);
      if (match) {
        const returnUrl = decodeURIComponent(match[1]);
        if (returnUrl !== hash) { window.location.hash = returnUrl; return; }
      }
      const pointMatch = hash.match(/[?&]pointId=([^&]+)/);
      if (pointMatch && pointMatch[1]) { navigate(`#/edit-point/${pointMatch[1]}`); return; }
      navigate('#/resources');
    } else {
      if (history.length > 1) history.back();
      else navigate('#/');
    }
  };

  // ============ 全局快捷键监听 ============
  window.addEventListener('keydown', (e) => {
    // 如果正在输入框里打字，不触发快捷键
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    // 1. 按 `N` 快捷新建卡片
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      // 根据当前页面上下文判断新建类型
      if (location.hash.startsWith('#/chapter/')) {
        const chapterId = location.hash.split('/')[2];
        window.location.hash = `#/edit-point/new?chapterId=${chapterId}`;
      } else {
        window.location.hash = '#/edit-task/new';
      }
    }

    // 2. 按 `Ctrl + K` 或 `/` 全局搜索
    if ((e.ctrlKey && e.key === 'k') || e.key === '/') {
      e.preventDefault();
      window.location.hash = '#/search';
    }

    // 3. 按 `Esc` 关闭弹窗
    if (e.key === 'Escape') {
      const masks = document.querySelectorAll('.confirm-mask');
      masks.forEach(m => m.remove());
    }
  });

  initShortcuts();
  initSidebar();

  window.addEventListener('resize', () => {
    if (location.hash === '' || location.hash === '#/') renderSidebar();
  });

  window.addEventListener('beforeunload', () => { flushAll(); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAll();
  });

  import('./ui/reminder.js').then(({ initReminder }) => initReminder());
}

// ============ 辅助函数们 ============

function openMoreMenu() {
  const existing = document.getElementById('more-menu');
  if (existing) { existing.remove(); return; }
  const items = [
    { icon: '🏠', label: '背诵', href: '#/' },
    { icon: '📁', label: '资源总览', href: '#/resources' },
    { icon: '🎯', label: '待复习管理', href: '#/review' },
    { icon: '🔍', label: '搜索', href: '#/search' },
    { icon: '📥', label: '速记', href: '#/inbox' },
    { icon: '📤', label: '导出数据', action: 'export' },
    { icon: '📥', label: '导入备份', action: 'import' },
    { icon: '📑', label: '资料模板', href: '#/template' },
    { icon: '📄', label: '导入文件', action: 'importDoc' },
    { icon: '📋', label: '批量粘贴', action: 'batchImport' },
    { icon: '⏰', label: '考试倒计时', href: '#/countdown' },
    { icon: '🗑', label: '回收站', href: '#/trash' },
    { icon: '❓', label: '帮助', href: '#/help' },
    { icon: '⚙️', label: '设置', href: '#/settings' },
  ];
  const menu = el('div', {
    id: 'more-menu',
    style: {
      position: 'fixed', top: '56px', right: '12px', background: 'var(--card)',
      borderRadius: '12px', boxShadow: 'var(--shadow-lg)', padding: '6px',
      zIndex: '9999', minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '2px',
      border: '1px solid rgba(0,0,0,0.1)', maxHeight: '80vh', overflowY: 'auto'
    },
  });

  items.forEach(it => {
    const elStyle = { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', textDecoration: 'none', color: 'var(--text)', fontSize: '15px', cursor: 'pointer' };
    if (it.href) {
      menu.appendChild(el('a', { href: it.href, style: elStyle, onClick: () => menu.remove() }, [
        el('span', { text: it.icon }), el('span', { text: it.label })
      ]));
    } else if (it.action) {
      menu.appendChild(el('div', {
        style: elStyle,
        onClick: async () => {
          menu.remove();
          if (it.action === 'importDoc') { import('./views/importDoc.js').then(m => m.globalImportDocModal()); }
          else if (it.action === 'batchImport') { import('./views/importDoc.js').then(m => m.globalBatchImportModal()); }
          else if (it.action === 'export') { import('./views/settings.js').then(m => m.openExportModal()); }
          else if (it.action === 'import') { import('./views/settings.js').then(m => m.openImportModal()); }
        }
      }, [el('span', { text: it.icon }), el('span', { text: it.label })]));
    }
  });
  document.body.appendChild(menu);
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'btn-more' && !e.target.closest('#btn-more')) {
        menu.remove(); document.removeEventListener('pointerdown', close, true);
      }
    };
    document.addEventListener('pointerdown', close, true);
  }, 50);
}

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  const closeBtn = document.getElementById('sidebar-close');
  const menuBtn = document.getElementById('btn-menu');
  if (!sidebar) return;
  const savedW = Number(localStorage.getItem('kg_sidebar_width') || 280);
  if (savedW >= 200 && savedW <= 600) document.documentElement.style.setProperty('--sidebar-w', savedW + 'px');
  const collapsed = localStorage.getItem('kg_sidebar_collapsed') === '1';
  if (collapsed) sidebar.classList.add('collapsed');
  function toggleSidebar(force) {
    const isCollapsed = force !== undefined ? !force : !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', isCollapsed);
    localStorage.setItem('kg_sidebar_collapsed', isCollapsed ? '1' : '0');
    if (isCollapsed) {
      sidebar.style.setProperty('width', '0', 'important');
      sidebar.style.setProperty('padding', '0', 'important');
      sidebar.style.setProperty('display', 'none', 'important');
    } else {
      sidebar.style.removeProperty('width');
      sidebar.style.removeProperty('padding');
      sidebar.style.removeProperty('display');
    }
    if (window.innerWidth < 1024) {
      if (!isCollapsed) { sidebar.classList.add('overlay'); document.body.classList.add('sidebar-open'); }
      else { sidebar.classList.remove('overlay'); document.body.classList.remove('sidebar-open'); }
      document.getElementById('main').style.marginLeft = '0';
    } else {
      sidebar.classList.remove('overlay'); document.body.classList.remove('sidebar-open');
    }
    if (!isCollapsed) renderSidebar();
  }
  if (closeBtn) closeBtn.addEventListener('click', () => toggleSidebar(false));
  if (menuBtn) menuBtn.addEventListener('click', () => toggleSidebar());
  let dragging = false, startX = 0, startW = 0;
  if (resizer) {
    resizer.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX; startW = sidebar.offsetWidth; resizer.setPointerCapture(e.pointerId); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; });
    resizer.addEventListener('pointermove', (e) => { if (!dragging) return; const w = Math.max(200, Math.min(600, startW + (e.clientX - startX))); document.documentElement.style.setProperty('--sidebar-w', w + 'px'); });
    resizer.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; resizer.releasePointerCapture(e.pointerId); document.body.style.cursor = ''; document.body.style.userSelect = ''; localStorage.setItem('kg_sidebar_width', String(sidebar.offsetWidth)); });
    resizer.addEventListener('dblclick', () => { document.documentElement.style.setProperty('--sidebar-w', '280px'); localStorage.setItem('kg_sidebar_width', '280'); });
  }
  window.addEventListener('resize', () => {
    if (sidebar.classList.contains('collapsed')) { document.body.classList.remove('sidebar-open'); return; }
    if (window.innerWidth < 1024) { sidebar.classList.add('overlay'); document.body.classList.add('sidebar-open'); }
    else { sidebar.classList.remove('overlay'); document.body.classList.remove('sidebar-open'); }
  });
  if (!collapsed && window.innerWidth < 1024) { sidebar.classList.add('overlay'); document.body.classList.add('sidebar-open'); }
}

function showStorageError() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="empty" style="max-width:500px;margin:40px auto">
      <div class="empty-icon">⚠️</div>
      <div style="font-size:17px;font-weight:600;margin-bottom:12px">存储不可用</div>
      <div style="text-align:left;font-size:14px;line-height:1.8;color:var(--text-2)">
        当前打开方式不支持数据持久化，你的内容将无法保存。<br><br>
        <b>请改用以下方式打开：</b><br>
        • Windows：双击项目根目录的 <code>start.bat</code><br>
        • macOS：双击 <code>start.command</code><br>
        • 或手动运行 <code>python -m http.server 8080</code> 后访问 <code>http://localhost:8080</code>
      </div>
    </div>
  `;
}

// ============ 全局长按提示 ============
function attachLongPressTooltip(btn, text) {
  let timer = null;
  let tooltipEl = null;
  btn.style.userSelect = 'none';
  btn.style.webkitUserSelect = 'none';
  btn.style.webkitTouchCallout = 'none';
  btn.style.touchAction = 'manipulation';
  btn.setAttribute('draggable', 'false');
  const show = () => {
    if (tooltipEl) return;
    const rect = btn.getBoundingClientRect();
    tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = `position: fixed; left: ${rect.left + rect.width / 2}px; top: ${rect.bottom + 8}px; transform: translateX(-50%); background: rgba(43,45,66,.95); color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap; pointer-events: none; z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);`;
    tooltipEl.textContent = text;
    document.body.appendChild(tooltipEl);
    if (navigator.vibrate) navigator.vibrate(40);
  };
  const hide = () => { if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; } };
  btn.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); timer = setTimeout(show, 350); }, { passive: false });
  btn.addEventListener('touchend', function (e) { e.preventDefault(); clearTimeout(timer); setTimeout(hide, 1000); }, { passive: false });
  btn.addEventListener('touchmove', function (e) { clearTimeout(timer); hide(); }, { passive: true });
  btn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') timer = setTimeout(show, 500); });
  btn.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') { clearTimeout(timer); setTimeout(hide, 1000); } });
  btn.addEventListener('pointerleave', () => { clearTimeout(timer); hide(); });
}

// ============ 一次性迁移 ============
async function migrateImageNames() {
  if (localStorage.getItem('kg_migrated_imgname') === '1') return;
  try {
    const { dbAll, dbPut } = await import('./db.js');
    const all = await dbAll('images');
    let count = 0;
    for (const r of all) {
      if (r.type === 'pdf_placeholder') continue;
      if (!r.name) { r.name = `图片_${r.id.slice(0, 6)}`; await dbPut('images', r); count++; }
    }
    if (count > 0) console.log(`[迁移] 已为 ${count} 张旧图片补 name 字段`);
    localStorage.setItem('kg_migrated_imgname', '1');
  } catch (e) { }
}

// ============ 自动云同步拦截 ============
window.addEventListener('beforeunload', () => {
  if (localStorage.getItem('kg_webdav_autosync') !== '1') return;
  const settings = JSON.parse(localStorage.getItem('kg_webdav_settings') || '{}');
  if (!settings.url || !settings.user || !settings.pass) return;
  const auth = 'Basic ' + btoa(`${settings.user}:${settings.pass}`);
  const baseUrl = settings.url.endsWith('/') ? settings.url : settings.url + '/';
  const fileName = '资料复习系统_云端备份.json';
  const backupData = { version: 1, timestamp: Date.now(), data: { kg_tasks: JSON.parse(localStorage.getItem('kg_tasks') || '[]'), kg_chapters: JSON.parse(localStorage.getItem('kg_chapters') || '[]'), kg_points: JSON.parse(localStorage.getItem('kg_points') || '[]'), kg_inbox: JSON.parse(localStorage.getItem('kg_inbox') || '[]'), kg_settings: JSON.parse(localStorage.getItem('kg_settings') || '{}') } };
  fetch(baseUrl + fileName, { method: 'PUT', headers: { 'Authorization': auth, 'Content-Type': 'application/json;charset=utf-8' }, body: JSON.stringify(backupData), keepalive: true }).catch(() => { });
});

// ============ 防止全站锁死 ============
setInterval(() => {
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = 'auto';
  }
  if (document.documentElement.style.overflow === 'hidden') {
    document.documentElement.style.overflow = 'auto';
  }
}, 500);

// ============ 全局粘贴事件 ============
window.addEventListener('paste', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const text = e.clipboardData.getData('text');
  const items = e.clipboardData.items;
  let hasImage = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) { hasImage = true; break; }
  }
  if (!text && !hasImage) return;
  e.preventDefault();
  openPasteCreateModal(text, hasImage);
});

function openPasteCreateModal(text, hasImage) {
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const textarea = el('textarea', { value: text || '', placeholder: hasImage ? '[包含图片，请去编辑页粘贴上传]' : '粘贴的内容...', style: { width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '12px', outline: 'none', resize: 'vertical' } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
    el('h3', { text: '⚡ 极速记录' }), textarea,
    el('div', { class: 'confirm-actions' }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      el('button', {
        class: 'btn btn-primary', text: '存入收集箱', onClick: () => {
          const val = textarea.value.trim(); if (!val) return;
          store.createPoint({ content: val }); mask.remove(); toastSuccess('已存入收集箱');
          if (location.hash === '#/' || location.hash === '') renderHome();
        }
      })
    ])
  ]);
  mask.appendChild(box); document.body.appendChild(mask); setTimeout(() => textarea.focus(), 100);
}

// ============ 全局：防键盘遮挡与解除滚动锁死 ============
document.addEventListener('focusin', (e) => {
  const target = e.target;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    // 每次输入框聚焦时，强行确保页面可以滚动
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    const view = document.getElementById('view');
    if (view) {
      view.style.overflowY = 'auto';
    }

    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
});

// 👇 终极保底：监听全站点击，随时准备解除任何不该有的滚动锁定
document.addEventListener('click', () => {
  const html = document.documentElement;
  const body = document.body;
  if (html.style.overflow === 'hidden') html.style.overflow = 'auto';
  if (body.style.overflow === 'hidden') body.style.overflow = 'auto';
});

/* // ============ 全局防连点机制 ============
let lastClickTime = 0;
let lastClickTarget = null;
document.addEventListener('click', (e) => {
  if (e.target.closest('.annotator-wrap') || location.hash.startsWith('#/annotate/')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].includes(e.target.tagName) || e.target.closest('label')) return;
  const now = Date.now();
  const btn = e.target.closest('button, .btn');
  if (btn) {
    if (btn === lastClickTarget && now - lastClickTime < 400) { e.preventDefault(); e.stopPropagation(); return; }
    lastClickTime = now; lastClickTarget = btn;
  }
}); */

// ============ 通用手势 ============
window.attachSwipeAction = function (container, onDelete, onStar) {
  let startX = 0, startY = 0, currentX = 0;
  const content = container.querySelector('.point-card-content');
  if (!content) return;
  let isSwiping = false;
  content.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; startX = e.touches[0].clientX; startY = e.touches[0].clientY; currentX = 0; isSwiping = false; content.style.transition = 'none'; }, { passive: true });
  content.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const diffX = e.touches[0].clientX - startX; const diffY = e.touches[0].clientY - startY;
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) { isSwiping = true; currentX = Math.max(-80, Math.min(80, diffX)); content.style.transform = `translateX(${currentX}px)`; }
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    content.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)';
    if (isSwiping) { e.stopPropagation(); e.preventDefault(); if (currentX < -40) content.style.transform = 'translateX(-80px)'; else if (currentX > 40) content.style.transform = 'translateX(80px)'; else content.style.transform = 'translateX(0)'; }
  });
  content.addEventListener('click', (e) => {
    if (isSwiping) return;
    if (content.style.transform && content.style.transform !== 'translateX(0px)') { content.style.transform = 'translateX(0)'; e.stopPropagation(); e.preventDefault(); }
  }, true);
};

// ============ 全局：回到顶部火箭 ============
const globalBackToTop = document.createElement('button');
globalBackToTop.id = 'global-back-to-top';
globalBackToTop.innerHTML = '🚀';
globalBackToTop.title = '回到顶部';
globalBackToTop.style.cssText = `position: fixed; right: 20px; bottom: calc(80px + env(safe-area-inset-bottom)); width: 44px; height: 44px; border-radius: 50%; background: rgba(255, 255, 255, 0.95); box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 1px solid rgba(0,0,0,0.05); font-size: 20px; z-index: 999; cursor: pointer; display: none; align-items: center; justify-content: center; transition: transform 0.2s, opacity 0.2s; opacity: 0;`;
document.body.appendChild(globalBackToTop);

globalBackToTop.onclick = () => {
  const pdfContainer = document.querySelector('.pdf-scroll-container');
  const viewContainer = document.getElementById('view');
  if (pdfContainer && pdfContainer.scrollTop > 0) pdfContainer.scrollTo({ top: 0, behavior: 'smooth' });
  else if (viewContainer && viewContainer.scrollTop > 0) viewContainer.scrollTo({ top: 0, behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
};

function updateBackToTopVisibility() {
  if (localStorage.getItem('kg_hide_back_to_top') === '1') { globalBackToTop.style.display = 'none'; return; }
  let scrollTop = 0;
  const pdfContainer = document.querySelector('.pdf-scroll-container');
  const viewContainer = document.getElementById('view');
  if (pdfContainer && viewContainer && viewContainer.contains(pdfContainer)) scrollTop = pdfContainer.scrollTop;
  else if (viewContainer) scrollTop = viewContainer.scrollTop;
  else scrollTop = window.scrollY;
  if (scrollTop > 300) { if (globalBackToTop.style.display !== 'flex') { globalBackToTop.style.display = 'flex'; setTimeout(() => globalBackToTop.style.opacity = '1', 10); } }
  else { if (globalBackToTop.style.display !== 'none') { globalBackToTop.style.opacity = '0'; setTimeout(() => globalBackToTop.style.display = 'none', 200); } }
}

window.addEventListener('scroll', updateBackToTopVisibility, true);
document.addEventListener('DOMContentLoaded', () => {
  const view = document.getElementById('view');
  if (view) view.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
});

// ============ 全局路由切换清理（最终修复版） ============
window.addEventListener('hashchange', () => {
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.style.display = '';

  const view = document.getElementById('view');
  if (view) {
    // 🛑 终极绝杀：强制清空所有内联样式，让 CSS 文件重新接管
    view.style.cssText = '';

    // 默认移除 PDF 专属类名
    view.classList.remove('pdf-active-view');

    // 👇 核心修复：如果是 PDF 页面，打上专属类名
    if (location.hash.startsWith('#/pdf-viewer/')) {
      view.classList.add('pdf-active-view');
    }
    // 注意：我们不需要在这里写 padding、overflow 等内联样式了！
    // 它们全都会由 main.css 里的 `#view` 和 `#view.pdf-active-view` 完美控制。
  }

  // 👇 核心新增：进入标注页时，隐藏顶栏多余的全局按钮
  const topbarActions = document.getElementById('topbar-actions');
  if (topbarActions) {
    if (location.hash.startsWith('#/annotate/')) {
      // 进入画板，把除了“更多(⋮)”以外的所有动态按钮全部隐藏
      topbarActions.querySelectorAll('.topbar-tool-btn').forEach(btn => {
        btn.style.display = 'none';
      });
    } else {
      // 离开画板，恢复显示
      topbarActions.querySelectorAll('.topbar-tool-btn').forEach(btn => {
        btn.style.display = 'flex'; // 注意这里要恢复成 flex，才能保持图标居中
      });
    }
  }

  // 下面是原有的组件清理逻辑（保持不变）
  if (!location.hash.startsWith('#/annotate/') && window.__annotatorCleanup) {
    window.__annotatorCleanup();
  }

  const oldTouchBar = document.getElementById('review-touch-bar');
  if (oldTouchBar) oldTouchBar.remove();

  const oldQuickNote = document.getElementById('floating-folder-menu');
  if (oldQuickNote) oldQuickNote.remove();

  const fab = document.getElementById('fab-quick-note');
  if (fab) {
    const hidePages = ['#/annotate/', '#/edit-point/', '#/edit-chapter/', '#/edit-task/'];
    const shouldHide = hidePages.some(page => location.hash.startsWith(page));
    fab.style.display = shouldHide ? 'none' : 'flex';
  }

  setTimeout(updateBackToTopVisibility, 100);
  if (view) view.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
});

// 启动全局 Emoji 替换魔法
initEmojiReplacer();

// ============ 数据保命机制 ============
function checkBackupSafety() {
  const lastBackup = localStorage.getItem('kg_last_backup_at');
  const now = Date.now();
  const daysSince = lastBackup ? (now - new Date(lastBackup).getTime()) / (1000 * 60 * 60 * 24) : 999;

  if (daysSince > 7) {
    // 如果超过 7 天没备份，在页面顶部弹出一个警告条
    const warningBar = document.createElement('div');
    warningBar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#FFF4D6;color:#8A6D1B;padding:8px;text-align:center;font-size:13px;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,.1);cursor:pointer;';
    warningBar.innerHTML = `⚠️ 已经 ${Math.floor(daysSince)} 天没有备份了！点击这里去「设置 -> 导出数据」把数据存到电脑里，防止丢失。`;
    warningBar.onclick = () => { window.location.hash = '#/settings'; warningBar.remove(); };
    document.body.appendChild(warningBar);

    // 3秒后自动消失，不碍事
    setTimeout(() => warningBar.remove(), 5000);
  }
}

// 在启动时调用
setTimeout(checkBackupSafety, 2000);

// ============ 启动应用 ============
boot().catch(e => {
  console.error('启动失败', e);
  toastError('启动失败：' + e.message);
});

// ============ 多标签页防冲突机制 ============
(function initMultiTabGuard() {
  // 生成一个唯一的标签页 ID
  const tabId = Math.random().toString(36).substring(2, 9);

  // 页面加载时，广播自己的存在
  localStorage.setItem('kg_active_tab', JSON.stringify({ tabId, time: Date.now() }));

  // 监听 storage 变化（当其他标签页写入时触发）
  window.addEventListener('storage', (e) => {
    // 如果检测到其他标签页刚发了心跳，且当前页面不是最新活跃的
    if (e.key === 'kg_active_tab') {
      try {
        const data = JSON.parse(e.newValue);
        if (data && data.tabId !== tabId && Date.now() - data.time < 3000) {
          // 显示一个持久化警告条
          let warn = document.getElementById('kg-multitab-warn');
          if (!warn) {
            warn = document.createElement('div');
            warn.id = 'kg-multitab-warn';
            warn.style.cssText = 'position:fixed;top:0;left:0;right:0;background:var(--danger);color:#fff;padding:8px;text-align:center;font-size:13px;z-index:999999;font-weight:bold;';
            warn.textContent = '⚠️ 警告：检测到您在其他标签页打开了本系统，同时编辑可能会导致数据相互覆盖！请关闭多余的标签页。';
            document.body.appendChild(warn);
          }
        }
      } catch (err) { }
    }
  });
})();

// ============ 全局通用：长按 500ms 自动显示功能提示 ============
(function initGlobalLongPress() {
  let timer = null;
  let tooltipEl = null;

  const show = (target, text) => {
    if (!text) return;
    if (tooltipEl) tooltipEl.remove();

    const rect = target.getBoundingClientRect();
    tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = `
      position: fixed; left: ${rect.left + rect.width / 2}px; top: ${rect.bottom + 8}px; 
      transform: translateX(-50%); background: rgba(43,45,66,.95); color: #fff; 
      padding: 6px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap; 
      pointer-events: none; z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideUp 0.2s ease-out;
    `;
    tooltipEl.textContent = text;
    document.body.appendChild(tooltipEl);
    if (navigator.vibrate) navigator.vibrate(30); // 手机端震动反馈
  };

  const hide = () => {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };

  // 拦截全站的触摸/鼠标按下
  document.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('button, .btn, .tool-btn, .tape-chip, .fab, input[type="checkbox"]');
    if (!target) return;

    // 尝试获取提示文字：优先找 title 属性，其次找 data-tooltip，最后找按钮内的文字
    let tipText = target.getAttribute('title') ||
      target.getAttribute('data-tooltip') ||
      target.getAttribute('aria-label') ||
      (target.innerText ? target.innerText.trim() : '') ||
      (target.textContent ? target.textContent.trim() : '');

    // 如果按钮里是 SVG/Emoji，提取不到文字，就跳过
    if (!tipText || tipText.length > 10 || tipText.includes('\n')) {
      // 针对纯图标按钮，你可以通过特殊类名或 id 手动兜底（可根据实际情况调整）
      if (target.innerHTML.includes('folder')) tipText = '文件夹';
      else if (target.innerHTML.includes('trash')) tipText = '删除';
      else if (target.innerHTML.includes('edit') || target.innerHTML.includes('pen')) tipText = '编辑';
      else return;
    }

    // 开始 500ms 倒计时
    timer = setTimeout(() => {
      show(target, tipText);
    }, 500);
  }, { passive: true });

  // 手指抬起、移动、或者鼠标松开时，取消倒计时并隐藏气泡
  document.addEventListener('pointerup', () => {
    clearTimeout(timer);
    setTimeout(hide, 2000);
  }, { passive: true });

  document.addEventListener('pointermove', () => {
    clearTimeout(timer);
    hide();
  }, { passive: true });

  document.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    hide();
  }, { passive: true });
})();