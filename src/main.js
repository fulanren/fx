import { migrate, cleanExpiredDrafts, cleanRecycleBin } from './migrate.js';
import { storageSelfCheck } from './db.js';
import { register, startRouter, navigate } from './router.js';
import { flushAll } from './store.js';
import * as store from './store.js';
import { initTheme } from './ui/theme.js';
import { initShortcuts } from './ui/shortcuts.js';
import { el } from './utils/dom.js';
import { renderHome, renderSidebar } from './views/home.js';
import { renderFolderDetail } from './views/chapter.js';
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

let hasShownGlobalError = false;
window.addEventListener('error', (e) => {
  //如果是跨域导致的 Script error，直接 return 忽略掉！
  if (e.message === 'Script error.' || !e.error) return;

  console.error('系统级错误:', e.error || e.message);

  if (hasShownGlobalError) return;
  hasShownGlobalError = true;

  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#EF476F;color:#fff;padding:10px 20px;border-radius:8px;z-index:999999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.2);';
  toast.textContent = '⚠️ 页面发生了一点小错误，请刷新重试';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    hasShownGlobalError = false;
  }, 3000);
});

// 修复 PDF.js Worker 404 的问题
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

async function boot() {
  // 1. 基础数据迁移与清理
  migrate();
  store.autoCleanRecycleBin();
  await migrateImageNames();

  // 2. 存储自检
  const check = await storageSelfCheck();
  if (!check.ok) { showStorageError(); return; }

  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch (e) { }
  }

  // 3. 过期数据清理与主题初始化
  cleanExpiredDrafts();
  cleanRecycleBin();
  initTheme();

  //延迟 5 秒后，执行“每日数据自动快照”，保障数据安全
  setTimeout(() => { autoSnapshot(); }, 5000);

  // 5. 自定义顶栏快捷按钮
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
      { id: 'home', icon: '🏠', title: '首页', href: '#/' },
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

    if (!prefs || Array.isArray(prefs) || Object.keys(prefs).length === 0) {
      prefs = {
        theme: false, quickNote: false, review: false, search: false, export: false,
        import: false, template: false, importDoc: false, home: true,
        resources: true, inbox: false, countdown: false, trash: true,
        help: true, settings: true, backToTop: true
      };
    }

    function renderTopbarTools() {
      topbarActions.querySelectorAll('.topbar-tool-btn').forEach(el => el.remove());

      const activeIds = Array.isArray(prefs)
        ? prefs
        : Object.keys(prefs).filter(k => prefs[k] === true);

      activeIds.forEach(id => {
        const tool = ALL_TOOLS.find(t => t.id === id);
        if (!tool) return;

        const btn = el('button', {
          class: 'btn btn-sm btn-ghost topbar-tool-btn',
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0', marginRight: '4px', width: '36px', height: '36px',
            borderRadius: '8px', background: 'rgba(142, 202, 230, 0.12)', position: 'relative'
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
  register('/folder/:taskId', renderFolderDetail);
  register('/edit-task/:id', renderEditTask);
  register('/edit-chapter/:id', renderEditChapter); // 兼容旧数据的编辑
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
      // 编辑文件夹，返回首页
      navigate('#/');

    } else if (hash.startsWith('#/edit-chapter/')) {
      // 编辑章节（虽然隐藏了，但可能从别处进入），返回首页
      navigate('#/');

    } else if (hash.startsWith('#/edit-point/')) {
      // 编辑知识点，直接返回它所属的卡片列表（章节详情）
      const m = hash.match(/chapterId=([^&]+)/);
      if (m) {
        navigate(`#/chapter/${m[1]}`);
      } else {
        history.back();
      }

    } else if (hash.startsWith('#/chapter/')) {
      //从卡片列表返回，直接回首页（文件夹列表），不再经过章节列表
      navigate('#/');

    } else if (hash.startsWith('#/chapter-list/')) {
      // 如果误入章节列表，直接重定向回首页
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
          else if (it.action === 'batchImport') {
            const hash = window.location.hash;
            const chapterMatch = hash.match(/#\/chapter\/([a-zA-Z0-9-]+)/);
            const currentChapId = chapterMatch ? chapterMatch[1] : null;
            import('./views/importDoc.js').then(m => m.globalBatchImportModal(currentChapId));
          }
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

//监听全站点击，随时准备解除任何不该有的滚动锁定
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
    // 强制清空所有内联样式，让 CSS 文件重新接管
    view.style.cssText = '';

    // 默认移除 PDF 专属类名
    view.classList.remove('pdf-active-view');

    // 如果是 PDF 页面，打上专属类名
    if (location.hash.startsWith('#/pdf-viewer/')) {
      view.classList.add('pdf-active-view');
    }
    // 注意：我们不需要在这里写 padding、overflow 等内联样式了！
    // 它们全都会由 main.css 里的 `#view` 和 `#view.pdf-active-view` 完美控制。
  }

  // 进入标注页时，隐藏顶栏多余的全局按钮
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

  //如果是第一次打开（本地压根没有备份记录），直接不提示
  if (!lastBackup) return;

  const now = Date.now();
  const daysSince = (now - new Date(lastBackup).getTime()) / (1000 * 60 * 60 * 24);

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

  // ============ 原有的长按提示气泡逻辑 ============
  document.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('button, .btn, .tool-btn, .topbar-tool-btn, .tape-chip, .fab, #btn-more');
    if (!target) return;

    let tipText = target.getAttribute('title') ||
      target.getAttribute('data-tooltip') ||
      target.getAttribute('aria-label') ||
      (target.innerText ? target.innerText.trim() : '') ||
      (target.textContent ? target.textContent.trim() : '');

    if (!tipText || tipText.length > 10 || tipText.includes('\n')) {
      const html = target.innerHTML.toLowerCase();
      if (html.includes('svg') || html.includes('img')) {
        if (target.id === 'btn-more') tipText = '更多功能';
        else if (target.id === 'btn-back') tipText = '返回上一页';
        else if (target.id === 'btn-menu') tipText = '展开侧边栏';
        else if (target.classList.contains('topbar-tool-btn')) tipText = target.title || '快捷功能';
        else tipText = '按钮';
      } else {
        return;
      }
    }

    timer = setTimeout(() => {
      show(target, tipText);
    }, 500);
  }, { passive: true });

  document.addEventListener('pointerup', () => {
    clearTimeout(timer);
    setTimeout(hide, 1500);
  }, { passive: true });

  document.addEventListener('pointermove', () => {
    clearTimeout(timer);
    hide();
  }, { passive: true });

  document.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    hide();
  }, { passive: true });

  //全局双向链接长按拦截器
  document.addEventListener('pointerdown', (e) => {
    const linkEl = e.target.closest('.knowledge-link');
    if (!linkEl) return;

    const startX = e.clientX;
    const startY = e.clientY;

    const linkTimer = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);

      const url = linkEl.getAttribute('data-link-url');

      const oldMenu = document.getElementById('global-link-menu');
      if (oldMenu) oldMenu.remove();

      const rect = linkEl.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.id = 'global-link-menu';
      menu.style.cssText = `
        position: fixed; top: ${rect.bottom + 8}px; left: ${Math.max(10, rect.left)}px;
        background: var(--card); border: 1px solid rgba(0,0,0,.1); box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        border-radius: 8px; padding: 4px; display: flex; flex-direction: column; z-index: 999999;
      `;

      const isEditPage = window.location.hash.includes('/edit-point/') || window.location.hash.includes('/edit-chapter/');

      const createBtn = (text, color, onClick, disabled = false) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-ghost';
        btn.textContent = text;
        btn.style.cssText = `justify-content: flex-start; color: ${color}; font-size: 13px; padding: 8px 16px; opacity: ${disabled ? 0.5 : 1}; pointer-events: ${disabled ? 'none' : 'auto'};`;
        btn.onclick = (ev) => { ev.stopPropagation(); onClick(); menu.remove(); };
        return btn;
      };

      menu.appendChild(createBtn('🚀 前往', 'var(--primary)', () => { window.location.hash = url; }));
      // 改在 pointerdown 里触发跳转，并给个小延迟
      btn.onpointerdown = (ev) => {
        ev.preventDefault();
        setTimeout(() => {
          window.location.hash = route;
        }, 50);
      };
      menu.appendChild(createBtn('🔄 重置', '#B8860B', () => { window.location.hash = url; }));
      menu.appendChild(createBtn('🗑 删除', 'var(--danger)', () => {
        if (!isEditPage) return alert('请先进入编辑页面才能删除该连接');
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNode(linkEl);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete');
        const editor = document.querySelector('.rich-text-editor');
        if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
      }, !isEditPage));
      menu.appendChild(createBtn('✖ 取消', 'var(--text-2)', () => { }));

      document.body.appendChild(menu);

      setTimeout(() => {
        document.addEventListener('pointerdown', (ev) => {
          if (!menu.contains(ev.target)) menu.remove();
        }, { once: true });
      }, 10);

    }, 500);

    const cancelLinkTimer = () => clearTimeout(linkTimer);
    linkEl.addEventListener('pointerup', cancelLinkTimer, { once: true });
    linkEl.addEventListener('pointermove', (ev) => {
      if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) cancelLinkTimer();
    }, { once: true });
    linkEl.addEventListener('pointerleave', cancelLinkTimer, { once: true });
  });

  // 供管理面板联动闪烁使用
  window.flashLink = function (id, isOn) {
    // 放宽查找，只要 data-link 里包含该 ID 的都算
    const links = document.querySelectorAll(`.knowledge-link[data-link-id="${id}"], .editor-link[data-link*="${id}"]`);

    links.forEach(link => {
      if (isOn) {
        link.dataset.origBg = link.style.background;
        link.dataset.origColor = link.style.color;

        link.style.transition = 'none';
        link.style.background = 'rgba(255, 209, 102, 0.9)';
        link.style.color = '#2B2D42';
        link.style.borderRadius = '4px';
        link.style.padding = '0 4px';

        // 强行滚动到屏幕中间
        link.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        link.style.transition = 'background 0.2s, color 0.2s';
        link.style.background = link.dataset.origBg || 'transparent';
        link.style.color = link.dataset.origColor || '#5C6BC0';
        link.style.padding = '0';
      }
    });
  };

})();

// ============ 每日数据自动快照机制 ============
function autoSnapshot() {
  const today = new Date().toISOString().split('T')[0];
  const lastSnap = localStorage.getItem('kg_last_snapshot');

  if (lastSnap !== today) {
    try {
      const snapshotData = {
        tasks: JSON.parse(localStorage.getItem('kg_tasks') || '[]'),
        chapters: JSON.parse(localStorage.getItem('kg_chapters') || '[]'),
        points: JSON.parse(localStorage.getItem('kg_points') || '[]'),
        timestamp: new Date().toISOString()
      };

      localStorage.setItem(`kg_snapshot_${today}`, JSON.stringify(snapshotData));
      localStorage.setItem('kg_last_snapshot', today);
      console.log('✅ 今日自动快照已保存，空间占用:', JSON.stringify(snapshotData).length, '字节');

      // 清理 3 天前的旧快照
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key.startsWith('kg_snapshot_')) {
          const dateStr = key.replace('kg_snapshot_', '');
          const snapDate = new Date(dateStr);
          if (!isNaN(snapDate) && (new Date() - snapDate) > 3 * 86400000) {
            localStorage.removeItem(key);
            console.log(`🗑 已清理过期快照: ${key}`);
          }
        }
      }
    } catch (e) {
      console.warn('自动快照失败，可能是存储空间不足', e);
    }
  }
}

// ================= 全局通用悬浮球 (新建卡片 + 新建文件夹) =================
export function renderFAB(viewContainer, currentFolderId = null) {
  const oldFab = document.getElementById('global-fab-group');
  if (oldFab) oldFab.remove();

  const fabGroup = el('div', {
    id: 'global-fab-group',
    style: {
      position: 'fixed', bottom: '30px', right: '30px',
      display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 99999, alignItems: 'center'
    }
  });

  // 新建卡片按钮（蓝）
  fabGroup.appendChild(el('button', {
    class: 'fab', text: '+', 'aria-label': '新建卡片', title: '新建卡片',
    style: {
      width: '40px', height: '40px', minHeight: '40px', padding: '0',
      fontSize: '24px', background: 'var(--primary)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(142, 202, 230, 0.4)', position: 'relative', right: '0', bottom: '0'
    },
    onClick: () => {
      // 直接携带当前文件夹的 ID
      const url = currentFolderId ? `#/edit-point/new?taskId=${currentFolderId}` : '#/edit-point/new';
      navigate(url);
    },
  }));

  // 新建文件夹按钮（黄）
  fabGroup.appendChild(el('button', {
    class: 'fab', title: '新建文件夹',
    style: {
      width: '40px', height: '40px', minHeight: '40px', padding: '0',
      background: '#FFD166', color: '#2B2D42',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(255, 209, 102, 0.4)', position: 'relative', right: '0', bottom: '0'
    },
    innerHTML: `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>`,
    onClick: () => {
      const folderName = prompt('请输入新建文件夹的名称：');
      if (!folderName || !folderName.trim()) return;
      const finalName = folderName.trim();

      // 查重
      const siblings = currentFolderId ? store.getTasks().filter(t => t.parentId === currentFolderId) : store.getTasks().filter(t => !t.parentId);
      if (siblings.some(t => t.name === finalName)) {
        return toastError('当前层级已存在同名文件夹！');
      }

      // 把当前文件夹作为父级，实现无限嵌套
      store.createTask({ name: finalName, parentId: currentFolderId });
      toastSuccess('文件夹创建成功');

      // 刷新页面
      if (currentFolderId) {
        // 如果是在文件夹内，重新触发路由渲染
        navigate(`#/folder/${currentFolderId}`);
      } else {
        if (typeof renderHome === 'function') renderHome();
      }
    }
  }));

  viewContainer.appendChild(fabGroup);
}
