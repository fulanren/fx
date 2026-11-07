import { migrate, cleanExpiredDrafts, cleanRecycleBin } from './migrate.js';
import { storageSelfCheck } from './db.js';
import { register, startRouter, navigate } from './router.js';
import { flushAll } from './store.js';
import * as store from './store.js';
import { toastError } from './ui/toast.js';
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

async function boot() {
  migrate();

  const check = await storageSelfCheck();
  if (!check.ok) { showStorageError(); return; }
  
  // 申请持久化存储，防止浏览器自动清理数据（只写一次就够了）
  if (navigator.storage?.persist) {
    try {
      const granted = await navigator.storage.persist();
      console.log('持久化存储:', granted ? '已授权' : '未授权');
    } catch (e) {
      console.warn('申请持久化存储失败', e);
    }
  }

  cleanExpiredDrafts();
  cleanRecycleBin();

  initTheme();
  // ============ 新增：暗黑模式切换按钮 ============
    const btnMore = document.getElementById('btn-more');
  if (btnMore) {
    // 1. 生成暗黑模式切换按钮并插入
    const themeBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      style: { fontSize: '18px', marginLeft: '8px' },
      text: document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙',
      onClick: () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
          document.documentElement.removeAttribute('data-theme');
          localStorage.setItem('kg_theme', 'light');
          themeBtn.textContent = '🌙';
        } else {
          document.documentElement.setAttribute('data-theme', 'dark');
          localStorage.setItem('kg_theme', 'dark');
          themeBtn.textContent = '☀️';
        }
      }
    });
    btnMore.parentNode.insertBefore(themeBtn, btnMore);

    // 2. 绑定右上角 ⋮ 按钮的点击事件（你之前漏掉的）
    btnMore.onclick = (e) => {
      e.stopPropagation();
      openMoreMenu();
    };
  }

    // ============ 新增：全局快捷键 ============
  window.addEventListener('keydown', (e) => {
    // 如果正在输入框里打字，则不触发快捷键
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    // 搜索：/ 或 Ctrl+K
    if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      navigate('#/search');
      return;
    }

    // 新建知识点：N 键
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const hash = location.hash;
      // 如果当前在章节详情页，直接新建该章节的知识点
      if (hash.startsWith('#/chapter/')) {
        const chapterId = hash.split('/')[2]?.split('?')[0];
        if (chapterId) {
          navigate(`#/edit-point/new?chapterId=${chapterId}`);
          return;
        }
      }
      // 如果不在章节页，就跳到新建任务
      navigate('#/edit-task/new');
      return;
    }

    // 复习页面极速自评：1 忘了，2 模糊，3 记得
    if (location.hash.startsWith('#/review') && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      const ratingMap = { '1': 'forgot', '2': 'vague', '3': 'remember' };
      const rating = ratingMap[e.key];
      // 假设你的复习页面暴露了 window.doReviewRating 方法
      if (window.doReviewRating) {
        window.doReviewRating(rating);
      }
    }
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
  register('/compose', renderComposer);
  register('/settings', renderSettings);
  register('/help', renderHelp);
  register('/template', renderTemplate);
  register('/countdown', renderCountdownPage);
  register('/error-book', renderErrorBook);

  startRouter();

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
    } else {
      if (history.length > 1) history.back();
      else navigate('#/');
    }
  };

  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/annotate/')) {
      const dyn = document.getElementById('topbar-dynamic');
      if (dyn) dyn.innerHTML = '';
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
  // 【复习提醒初始化】
  import('./ui/reminder.js').then(({ initReminder }) => initReminder());
}

function openMoreMenu() {
  const existing = document.getElementById('more-menu');
  if (existing) { existing.remove(); return; }

    const items = [
    { icon: '📚', label: '背诵', href: '#/' },
    { icon: '🎯', label: '复习', href: '#/review' },
    { icon: '🔍', label: '搜索', href: '#/search' },
    { icon: '📥', label: '速记', href: '#/inbox' },
    
    // 👇 以下 3 个是录入相关的
    { icon: '📑', label: '资料模板', href: '#/template' },
    { icon: '📄', label: '导入文件（支持自动分章）', action: 'importDoc' },
    { icon: '📋', label: '批量粘贴文本', action: 'batchImport' },
    
    { icon: '⏰', label: '考试倒计时', href: '#/countdown' },
    { icon: '🗑', label: '回收站', href: '#/trash' },
    { icon: '❓', label: '帮助', href: '#/help' },
    { icon: '⚙️', label: '设置', href: '#/settings' },
  ];

  const menu = el('div', {
    id: 'more-menu',
    style: {
      position: 'fixed',
      top: '56px',
      right: '12px',
      background: 'var(--card)',
      borderRadius: '12px',
      boxShadow: 'var(--shadow-lg)',
      padding: '6px',
      zIndex: '9999',
      minWidth: '160px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      border: '1px solid rgba(0,0,0,0.1)'
    },
  });

  // 动态添加按钮
  items.forEach(it => {
    const elStyle = {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px', borderRadius: '8px', textDecoration: 'none',
      color: 'var(--text)', fontSize: '15px', cursor: 'pointer'
    };

    if (it.href) {
      menu.appendChild(el('a', {
        href: it.href,
        style: elStyle,
        onClick: () => menu.remove(),
      }, [
        el('span', { text: it.icon }),
        el('span', { text: it.label }),
      ]));
    } else if (it.action) {
      menu.appendChild(el('div', {
        style: elStyle,
        onClick: async () => {
          menu.remove();
          if (it.action === 'importDoc') {
            const { globalImportDocModal } = await import('./views/importDoc.js');
            globalImportDocModal();
          } else if (it.action === 'batchImport') {
            const { globalBatchImportModal } = await import('./views/importDoc.js');
            globalBatchImportModal();
          }
        }
      }, [
        el('span', { text: it.icon }),
        el('span', { text: it.label }),
      ]));
    }
  });

  document.body.appendChild(menu);

  // 点击外部关闭
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'btn-more' && !e.target.closest('#btn-more')) {
        menu.remove();
        document.removeEventListener('pointerdown', close, true);
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
  if (savedW >= 200 && savedW <= 600) {
    document.documentElement.style.setProperty('--sidebar-w', savedW + 'px');
  }

  const collapsed = localStorage.getItem('kg_sidebar_collapsed') === '1';
  if (collapsed) sidebar.classList.add('collapsed');

  function toggleSidebar(force) {
    const isCollapsed = force !== undefined ? !force : !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', isCollapsed);
    localStorage.setItem('kg_sidebar_collapsed', isCollapsed ? '1' : '0');
    if (!isCollapsed) {
      if (window.innerWidth < 1024) {
        sidebar.classList.add('overlay');
        document.body.classList.add('sidebar-open');
      } else {
        sidebar.classList.remove('overlay');
        document.body.classList.remove('sidebar-open');
      }
      renderSidebar();
    } else {
      sidebar.classList.remove('overlay');
      document.body.classList.remove('sidebar-open');
    }
  }

  if (closeBtn) closeBtn.addEventListener('click', () => toggleSidebar(false));
  if (menuBtn) menuBtn.addEventListener('click', () => toggleSidebar());

  let dragging = false;
  let startX = 0;
  let startW = 0;

  if (resizer) {
    resizer.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      resizer.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    resizer.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const w = Math.max(200, Math.min(600, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    });
    resizer.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      resizer.releasePointerCapture(e.pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('kg_sidebar_width', String(sidebar.offsetWidth));
    });
    resizer.addEventListener('dblclick', () => {
      document.documentElement.style.setProperty('--sidebar-w', '280px');
      localStorage.setItem('kg_sidebar_width', '280');
    });
  }

  window.addEventListener('resize', () => {
    if (sidebar.classList.contains('collapsed')) {
      document.body.classList.remove('sidebar-open');
      return;
    }
    if (window.innerWidth < 1024) {
      sidebar.classList.add('overlay');
      document.body.classList.add('sidebar-open');
    } else {
      sidebar.classList.remove('overlay');
      document.body.classList.remove('sidebar-open');
    }
  });

  if (!collapsed && window.innerWidth < 1024) {
    sidebar.classList.add('overlay');
    document.body.classList.add('sidebar-open');
  }
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

boot().catch(e => {
  console.error('启动失败', e);
  toastError('启动失败：' + e.message);
});