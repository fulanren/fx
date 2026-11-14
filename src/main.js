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

// 修复 PDF.js Worker 404 的问题
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

async function boot() {
  migrate();
  await migrateImageNames();

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

  // ============ 可自定义的顶栏快捷按钮 ============
  const btnMore = document.getElementById('btn-more');
  if (btnMore) {
    const topbarActions = document.getElementById('topbar-actions');

    // 定义所有可用的工具（兼容 action 与 href 页面跳转）
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
      // 👇 新增的全面工具
      { id: 'home', icon: '📚', title: '背诵首页', href: '#/' },
      { id: 'resources', icon: '📁', title: '资源总览', href: '#/resources' },
      { id: 'inbox', icon: '📥', title: '速记收件箱', href: '#/inbox' },
      { id: 'countdown', icon: '⏰', title: '考试倒计时', href: '#/countdown' },
      { id: 'trash', icon: '🗑', title: '回收站', href: '#/trash' },
      { id: 'help', icon: '❓', title: '帮助', href: '#/help' },
      { id: 'settings', icon: '⚙️', title: '设置页', href: '#/settings' },
    ];

    // 读取用户配置（默认显示 5 个常用工具）
    let prefs = JSON.parse(localStorage.getItem('kg_topbar_prefs') || '[]');
    if (prefs.length === 0) prefs = ['theme', 'quickNote', 'review', 'search', 'export'];

    // 渲染顶栏快捷图标
    function renderTopbarTools() {
      topbarActions.querySelectorAll('.topbar-tool-btn').forEach(el => el.remove());

      prefs.forEach(id => {
        const tool = ALL_TOOLS.find(t => t.id === id);
        if (!tool) return;

        const btn = el('button', {
          class: 'btn btn-sm btn-ghost topbar-tool-btn',
          style: { fontSize: '18px', marginRight: '4px' },
          // 根据主题动态显示图标
          text: tool.id === 'theme' ? (document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙') : tool.icon,
          title: tool.title,
          onClick: (e) => {
            e.stopPropagation();
            if (tool.href) {
              window.location.hash = tool.href;
            } else if (tool.action) {
              tool.action();
            }
          }
        });

        topbarActions.insertBefore(btn, btnMore);
      });
    }
    renderTopbarTools();

    // 绑定 ⋮ 点击事件
    btnMore.onclick = (e) => {
      e.stopPropagation();
      openMoreMenu();
    };

    // 全局监听路由变化，清理不需要的悬浮元素
    window.addEventListener('hashchange', () => {
      const oldTouchBar = document.getElementById('review-touch-bar');
      if (oldTouchBar) oldTouchBar.remove();

      // 如果你还有其他的全屏悬浮窗（比如速记），也可以在这里顺便清理
      const oldQuickNote = document.getElementById('floating-folder-menu');
      if (oldQuickNote) oldQuickNote.remove();
    });
  }

  // ============ 全局剪贴板嗅探 ============
  window.addEventListener('paste', (e) => {
    // 如果正在输入框里打字，就不拦截
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const text = e.clipboardData.getData('text');
    const items = e.clipboardData.items;
    let hasImage = false;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        hasImage = true;
        break;
      }
    }

    if (!text && !hasImage) return;

    // 弹出轻量新建窗
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

      const btnBack = document.getElementById('btn-back');
  btnBack.onclick = () => {
    const hash = location.hash;
    
    // 1. 编辑任务 -> 回首页
    if (hash.startsWith('#/edit-task/')) {
      navigate('#/');
    } 
    // 2. 编辑章节 -> 回章节列表
    else if (hash.startsWith('#/edit-chapter/')) {
      const m = hash.match(/taskId=([^&]+)/);
      if (m) navigate(`#/chapter-list/${m[1]}`);
      else history.back();
    } 
    // 3. 编辑知识点 -> 回章节详情
    else if (hash.startsWith('#/edit-point/')) {
      const m = hash.match(/chapterId=([^&]+)/);
      if (m) navigate(`#/chapter/${m[1]}`);
      else history.back();
    } 
    // 4. 章节详情 -> 回章节列表
    else if (hash.startsWith('#/chapter/')) {
      const chapterId = hash.split('/')[2]?.split('?')[0];
      const chapter = store.getChapter(chapterId);
      if (chapter) navigate(`#/chapter-list/${chapter.taskId}`);
      else navigate('#/');
    } 
    // 5. 章节列表 -> 回首页
    else if (hash.startsWith('#/chapter-list/')) {
      navigate('#/');
    } 
    // 👇 6. 核心修复：PDF 阅读器或标注页
    else if (hash.startsWith('#/pdf-viewer/') || hash.startsWith('#/annotate/')) {
      // 优先检查有没有 returnUrl
      const match = hash.match(/[?&]returnUrl=([^&]+)/);
      if (match) {
        // 如果有 returnUrl，且不是当前页面，就跳转过去
        const returnUrl = decodeURIComponent(match[1]);
        if (returnUrl !== hash) {
            window.location.hash = returnUrl;
            return;
        }
      }
      
      // 如果没有 returnUrl，但有 pointId（从知识点进入的），退回知识点
      const pointMatch = hash.match(/[?&]pointId=([^&]+)/);
      if (pointMatch && pointMatch[1]) {
        navigate(`#/edit-point/${pointMatch[1]}`);
        return;
      }
      
      // 如果什么参数都没有，保底退回资料总览，绝不使用 history.back()
      navigate('#/resources');
    } 
    // 7. 其他页面 -> 正常后退
    else {
      if (history.length > 1) history.back();
      else navigate('#/');
    }
  };

  window.addEventListener('hashchange', () => {
    // 👇 每次切换页面，强行清空边距！防止首页的 16px 影响 PDF 等页面
    const view = document.getElementById('view');
    if (view) view.style.padding = '0';

    if (!location.hash.startsWith('#/annotate/')) {
      const dyn = document.getElementById('topbar-dynamic');
      if (dyn) dyn.innerHTML = '';
    }

    // 切换页面时，自动隐藏或显示速记按钮
    const fab = document.getElementById('fab-quick-note');
    if (fab) {
      const hidePages = ['#/annotate/', '#/edit-point/', '#/edit-chapter/', '#/edit-task/'];
      const shouldHide = hidePages.some(page => location.hash.startsWith(page));
      fab.style.display = shouldHide ? 'none' : 'flex';
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

  // 如果你之前加过页面的 items，保留它们，并加上顶栏工具
    const items = [
    { icon: '📚', label: '背诵', href: '#/', desc: '返回首页，查看任务与待复习' },
    { icon: '📁', label: '资源总览', href: '#/resources', desc: '查看所有图片和 PDF 附件' },
    { icon: '🎯', label: '待复习管理', href: '#/review', desc: '按计划复习知识点' },
    { icon: '🔍', label: '搜索', href: '#/search', desc: '在全站搜索知识点或文件' },
    { icon: '📥', label: '速记', href: '#/inbox', desc: '查看快速记录的散落卡片' },
    { icon: '📤', label: '导出数据', action: 'export', desc: '备份所有文字、图片为 ZIP' },
    { icon: '📥', label: '导入备份', action: 'import', desc: '从 ZIP 文件恢复数据' },
    { icon: '📑', label: '资料模板', href: '#/template', desc: '管理申论答题卡、横线纸模板' },
    { icon: '📄', label: '导入文件', action: 'importDoc', desc: '从 Word/PDF 批量导入知识点' },
    { icon: '📋', label: '批量粘贴', action: 'batchImport', desc: '粘贴大段文字并自动拆分' },
    { icon: '⏰', label: '考试倒计时', href: '#/countdown', desc: '设置并查看倒计时' },
    { icon: '🗑', label: '回收站', href: '#/trash', desc: '恢复误删的知识点或文件' },
    { icon: '❓', label: '帮助', href: '#/help', desc: '查看详细操作手册' },
    { icon: '⚙️', label: '设置', href: '#/settings', desc: '管理暗黑模式、云同步等' },
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

  // 1. 渲染常规功能项
    items.forEach(it => {
    // 👇 核心修改：左侧图标和文字，右侧说明
    const leftDiv = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', fontWeight: '500', flexShrink: '0' } }, [
      el('span', { text: it.icon, style: { fontSize: '18px' } }), 
      el('span', { text: it.label })
    ]);

    const rightDiv = el('div', { 
      style: { fontSize: '11px', color: 'var(--text-2)', marginLeft: '20px', textAlign: 'right', flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 
      text: it.desc || ''
    });

    // 让整行左右对齐，并且鼠标悬浮时有背景色
    const elStyle = { 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between', 
      padding: '10px 14px', 
      borderRadius: '8px', 
      textDecoration: 'none', 
      color: 'var(--text)', 
      cursor: 'pointer',
      transition: 'background 0.2s'
    };

    // 鼠标悬浮效果
    const onHover = (e) => { e.currentTarget.style.background = 'var(--bg)'; };
    const onLeave = (e) => { e.currentTarget.style.background = 'transparent'; };

    if (it.href) {
      menu.appendChild(el('a', { 
        href: it.href, 
        style: elStyle, 
        onClick: () => menu.remove(),
        onPointerEnter: onHover,
        onPointerLeave: onLeave
      }, [leftDiv, rightDiv]));
    } else if (it.action) {
      menu.appendChild(el('div', {
        style: elStyle,
        onClick: async () => {
          menu.remove();
          if (it.action === 'importDoc') { import('./views/importDoc.js').then(m => m.globalImportDocModal()); }
          else if (it.action === 'batchImport') { import('./views/importDoc.js').then(m => m.globalBatchImportModal()); }
          else if (it.action === 'export') { import('./views/settings.js').then(m => m.openExportModal()); }
          else if (it.action === 'import') { import('./views/settings.js').then(m => m.openImportModal()); }
        },
        onPointerEnter: onHover,
        onPointerLeave: onLeave
      }, [leftDiv, rightDiv]));
    }
  });

  document.body.appendChild(menu);

  // 点击外部关闭
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
  if (savedW >= 200 && savedW <= 600) {
    document.documentElement.style.setProperty('--sidebar-w', savedW + 'px');
  }

  const collapsed = localStorage.getItem('kg_sidebar_collapsed') === '1';
  if (collapsed) sidebar.classList.add('collapsed');

  function toggleSidebar(force) {
    const isCollapsed = force !== undefined ? !force : !sidebar.classList.contains('collapsed');

    // 1. 切换类名和存储
    sidebar.classList.toggle('collapsed', isCollapsed);
    localStorage.setItem('kg_sidebar_collapsed', isCollapsed ? '1' : '0');

    // 2. 彻底控制显示与宽度（不留任何缝隙）
    if (isCollapsed) {
      sidebar.style.setProperty('width', '0', 'important');
      sidebar.style.setProperty('padding', '0', 'important');
      sidebar.style.setProperty('display', 'none', 'important');
    } else {
      sidebar.style.removeProperty('width');
      sidebar.style.removeProperty('padding');
      sidebar.style.removeProperty('display');
    }

    // 3. 如果屏幕小于1024（平板/手机），侧边栏以悬浮形式展示
    if (window.innerWidth < 1024) {
      if (!isCollapsed) {
        sidebar.classList.add('overlay');
        document.body.classList.add('sidebar-open');
      } else {
        sidebar.classList.remove('overlay');
        document.body.classList.remove('sidebar-open');
      }
      // 无论如何，右侧绝不挤开
      document.getElementById('main').style.marginLeft = '0';
    } else {
      sidebar.classList.remove('overlay');
      document.body.classList.remove('sidebar-open');
    }

    if (!isCollapsed) renderSidebar();
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

// ============ 全局长按提示（适配平板触屏） ============
function attachLongPressTooltip(btn, text) {
  let timer = null;
  let tooltipEl = null;

  // 1. 彻底封印 iOS 系统菜单的三大法宝
  btn.style.userSelect = 'none';
  btn.style.webkitUserSelect = 'none';
  btn.style.webkitTouchCallout = 'none';
  btn.style.touchAction = 'manipulation'; // 消除双击缩放延迟
  btn.setAttribute('draggable', 'false'); // 禁止长按拖拽图标

  const show = () => {
    if (tooltipEl) return;
    const rect = btn.getBoundingClientRect();
    tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = `
      position: fixed; left: ${rect.left + rect.width / 2}px; top: ${rect.bottom + 8}px;
      transform: translateX(-50%); background: rgba(43,45,66,.95); color: #fff;
      padding: 6px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap;
      pointer-events: none; z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    tooltipEl.textContent = text;
    document.body.appendChild(tooltipEl);
    // 震动反馈
    if (navigator.vibrate) navigator.vibrate(40); 
  };

  const hide = () => {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  };

  // 👇 核心修改点：使用原生的绑定，并强行阻断所有冒泡
  btn.addEventListener('touchstart', function (e) {
    // 强行阻止系统菜单、复制、翻译
    e.preventDefault();
    e.stopPropagation();
    
    timer = setTimeout(show, 350);
  }, { passive: false }); // 👈 passive: false 是关键，允许我们拦截默认行为

  btn.addEventListener('touchend', function (e) {
    e.preventDefault();
    clearTimeout(timer);
    setTimeout(hide, 1000);
  }, { passive: false });

  btn.addEventListener('touchmove', function (e) {
    clearTimeout(timer);
    hide(); // 手指一旦滑动就取消
  }, { passive: true });

  // 👇 电脑鼠标逻辑保留
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      timer = setTimeout(show, 500);
    }
  });
  
  btn.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') {
      clearTimeout(timer);
      setTimeout(hide, 1000);
    }
  });
  
  btn.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    hide();
  });
}

// ============ 一次性迁移：给旧图片补 name 字段 ============
async function migrateImageNames() {
  if (localStorage.getItem('kg_migrated_imgname') === '1') return;
  try {
    const { dbAll, dbPut } = await import('./db.js');
    const all = await dbAll('images');
    let count = 0;
    for (const r of all) {
      if (r.type === 'pdf_placeholder') continue;
      if (!r.name) {
        r.name = `图片_${r.id.slice(0, 6)}`;
        await dbPut('images', r);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[迁移] 已为 ${count} 张旧图片补 name 字段`);
    }
    localStorage.setItem('kg_migrated_imgname', '1');
  } catch (e) {
    console.warn('[迁移] 图片 name 补全失败:', e);
  }
}

// ============ 自动云同步拦截 ============
window.addEventListener('beforeunload', () => {
  // 检查是否开启了自动同步
  if (localStorage.getItem('kg_webdav_autosync') !== '1') return;
  
  const settings = JSON.parse(localStorage.getItem('kg_webdav_settings') || '{}');
  if (!settings.url || !settings.user || !settings.pass) return;

  // 因为 beforeunload 中不能用 await 或 fetch 带着复杂逻辑，这里用 sendBeacon 或同步请求兜底
  // 注意：部分浏览器限制 closing 阶段发请求，如果失败也无妨，本地数据还在
  const auth = 'Basic ' + btoa(`${settings.user}:${settings.pass}`);
  const baseUrl = settings.url.endsWith('/') ? settings.url : settings.url + '/';
  const fileName = '资料复习系统_云端备份.json';
  
  const backupData = {
    version: 1,
    timestamp: Date.now(),
    data: {
      kg_tasks: JSON.parse(localStorage.getItem('kg_tasks') || '[]'),
      kg_chapters: JSON.parse(localStorage.getItem('kg_chapters') || '[]'),
      kg_points: JSON.parse(localStorage.getItem('kg_points') || '[]'),
      kg_inbox: JSON.parse(localStorage.getItem('kg_inbox') || '[]'),
      kg_settings: JSON.parse(localStorage.getItem('kg_settings') || '{}'),
    }
  };

  // 使用 fetch 的 keepalive 选项（Chrome 支持）
  fetch(baseUrl + fileName, {
    method: 'PUT',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json;charset=utf-8'
    },
    body: JSON.stringify(backupData),
    keepalive: true // 👈 允许在页面关闭时继续发送
  }).catch(() => {});
});

boot().catch(e => {
  console.error('启动失败', e);
  toastError('启动失败：' + e.message);
});

// ============ 全局剪贴板嗅探 ============
function openPasteCreateModal(text, hasImage) {
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const textarea = el('textarea', {
    value: text || '',
    placeholder: hasImage ? '[包含图片，请去编辑页粘贴上传]' : '粘贴的内容...',
    style: { width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '12px', outline: 'none', resize: 'vertical' }
  });

  const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
    el('h3', { text: '⚡ 极速记录' }),
    textarea,
    el('div', { class: 'confirm-actions' }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      el('button', {
        class: 'btn btn-primary', text: '存入收集箱', onClick: () => {
          const val = textarea.value.trim();
          if (!val) return;
          store.createPoint({ content: val }); // 触发 store.js 的兜底逻辑
          mask.remove();
          toastSuccess('已存入收集箱');
          if (location.hash === '#/' || location.hash === '') {
            // 如果当前在首页，刷新一下以便看到收集箱数量变化
            renderHome();
          }
        }
      })
    ])
  ]);
  mask.appendChild(box);
  document.body.appendChild(mask);
  setTimeout(() => textarea.focus(), 100);
}

// 绑定全局粘贴事件 (放在文件底部或者 boot 函数里都可以)
window.addEventListener('paste', (e) => {
  // 如果正在输入框里打字，就不拦截
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

  const text = e.clipboardData.getData('text');
  const items = e.clipboardData.items;
  let hasImage = false;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      hasImage = true;
      break;
    }
  }

  if (!text && !hasImage) return;

  // 弹出轻量新建窗
  e.preventDefault();
  openPasteCreateModal(text, hasImage);
});

// ============ 全局：防键盘遮挡（平板体验） ============
document.addEventListener('focusin', (e) => {
  const target = e.target;
  // 如果是输入框或文本域
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    // 延迟一点，等系统键盘完全弹出来，再平滑滚动
    setTimeout(() => {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'center' // 把它滚到屏幕正中间，绝对不挡
      });
    }, 300);
  }
});

// 👇 全局防连点机制（防止平板用户手抖连按导致崩溃）
let lastClickTime = 0;
let lastClickTarget = null;
document.addEventListener('click', (e) => {
  // 如果是画板或特定需要连续点击的地方，跳过拦截
  if (e.target.closest('.annotator-wrap')) return;
  
  const now = Date.now();
  const btn = e.target.closest('button, .btn'); // 只拦截按钮
  
  if (btn) {
    if (btn === lastClickTarget && now - lastClickTime < 400) {
      // 400毫秒内点同一个按钮，强行拦截！
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    lastClickTime = now;
    lastClickTarget = btn;
  }
});

// ============ 通用手势：左滑删除 / 右滑标星 ============
window.attachSwipeAction = function(container, onDelete, onStar) {
  let startX = 0, startY = 0, currentX = 0;
  const content = container.querySelector('.point-card-content');
  if (!content) return;
  
  let isSwiping = false;

  content.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    isSwiping = false;
    content.style.transition = 'none'; // 拖拽时去掉动画
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const diffX = e.touches[0].clientX - startX;
    const diffY = e.touches[0].clientY - startY;

    // 如果横向移动大于纵向移动，说明是左右滑动
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
      isSwiping = true;
      // 限制最大滑动距离为 80px
      currentX = Math.max(-80, Math.min(80, diffX));
      content.style.transform = `translateX(${currentX}px)`;
    }
  }, { passive: true });

  content.addEventListener('touchend', (e) => {
    content.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)';
    
    if (isSwiping) {
      // 阻止事件冒泡（防止触发卡片的点击展开）
      e.stopPropagation();
      e.preventDefault();
      
      if (currentX < -40) {
        // 左滑超过一半，自动弹到 -80px 露出删除按钮
        content.style.transform = 'translateX(-80px)';
      } else if (currentX > 40) {
        // 右滑超过一半，弹到 80px 露出标星按钮
        content.style.transform = 'translateX(80px)';
      } else {
        // 滑动不够，自动回弹
        content.style.transform = 'translateX(0)';
      }
    }
  });

  // 点击卡片其他地方时，自动收回
  content.addEventListener('click', (e) => {
    if (isSwiping) return; // 如果是滑动后触发的点击，不处理
    // 如果已经滑开了，点击就收起
    if (content.style.transform && content.style.transform !== 'translateX(0px)') {
      content.style.transform = 'translateX(0)';
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
};

// ============ 全局：回到顶部火箭 ============
// 1. 创建悬浮火箭
const globalBackToTop = document.createElement('button');
globalBackToTop.id = 'global-back-to-top';
globalBackToTop.innerHTML = '🚀';
globalBackToTop.title = '回到顶部';
globalBackToTop.style.cssText = `
  position: fixed;
  right: 20px;
  bottom: calc(80px + env(safe-area-inset-bottom));
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  border: 1px solid rgba(0,0,0,0.05);
  font-size: 20px;
  z-index: 999;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, opacity 0.2s;
  opacity: 0;
`;
document.body.appendChild(globalBackToTop);

// 2. 点击回顶
globalBackToTop.onclick = () => {
  // 兼容多种容器滚动（PDF阅读器、网页主体等）
  const scrollContainer = document.querySelector('.pdf-scroll-container') || document.getElementById('view') || window;
  if (scrollContainer === window) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// 3. 监听全局滚动，控制火箭显示/隐藏
window.addEventListener('scroll', () => {
  let scrollTop = 0;
  const pdfContainer = document.querySelector('.pdf-scroll-container');
  
  if (pdfContainer && document.getElementById('view').contains(pdfContainer)) {
    scrollTop = pdfContainer.scrollTop;
  } else {
    const view = document.getElementById('view');
    scrollTop = view ? view.scrollTop : window.scrollY;
  }

  // 如果开启了隐藏火箭设置，就直接隐藏
  if (localStorage.getItem('kg_hide_back_to_top') === '1') {
    globalBackToTop.style.display = 'none';
    return;
  }

  if (scrollTop > 300) {
    globalBackToTop.style.display = 'flex';
    setTimeout(() => globalBackToTop.style.opacity = '1', 10);
  } else {
    globalBackToTop.style.opacity = '0';
    setTimeout(() => globalBackToTop.style.display = 'none', 200);
  }
}, true); // 用捕获阶段监听，兼容嵌套滚动
