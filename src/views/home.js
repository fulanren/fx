import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { confirmBox } from '../ui/confirm.js';
import { dbGet } from '../db.js';
import { showPasteOptionsModal } from './importDoc.js';
import { renderFAB } from '../main.js';
import { taskCard } from './chapter.js';
import { toastSuccess, toastError } from '../ui/toast.js';


// ============ 文件夹折叠状态 ============
// 从本地存储读取已折叠的文件夹 ID 集合
export function getCollapsedFolders() {
  try { return new Set(JSON.parse(localStorage.getItem('kg_collapsed_folders') || '[]')); }
  catch { return new Set(); }
}

export let collapsedFolders = getCollapsedFolders();

// 切换折叠状态
export function toggleFolderCollapse(id) {
  if (collapsedFolders.has(id)) {
    collapsedFolders.delete(id); // 已经折叠，则展开
  } else {
    collapsedFolders.add(id);    // 已经展开，则折叠
  }

  // 保存到本地存储
  localStorage.setItem('kg_collapsed_folders', JSON.stringify([...collapsedFolders]));

  // 核心修复：既然 taskCard 是递归渲染的，这里只需触发全局刷新即可，不需要手动去拼装 DOM
  if (window.renderHomeGlobal) {
    window.renderHomeGlobal();
  } else if (typeof renderHome === 'function') {
    renderHome();
  }
}

// ============ 散落卡片折叠状态 ============
export function getInboxCollapsed() {
  return localStorage.getItem('kg_inbox_collapsed') === 'true';
}
export function setInboxCollapsed(val) {
  localStorage.setItem('kg_inbox_collapsed', val);
}

// ============ 全局（文件夹）多选状态 ============
export let multiSelectMode = false;
export const selectedIds = new Set();

// ============ 散落卡片独立的专属多选状态 ============
export let cardMultiMode = false;
export const selectedCardIds = new Set();

export function renderHome() {
  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = multiSelectMode ? '选择任务' : '资料库';
  document.getElementById('btn-back').classList.add('hidden');

  // 把状态挂到 window 上，供 taskCard 递归调用
  window.multiSelectMode = multiSelectMode;
  window.selectedIds = selectedIds;
  window.renderHomeGlobal = renderHome;

  // 1. 今日待复习
  const due = store.getDuePoints();
  if (!multiSelectMode && due.length > 0) {
    const isDueHidden = localStorage.getItem('kg_hide_due_banner') === 'true';
    if (!isDueHidden) {
      view.appendChild(el('div', { class: 'banner banner-warn', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } }, [
        el('span', { text: `📌 今日待复习 ${due.length} 个知识点`, style: { flex: '1', minWidth: '120px' } }),
        el('button', { class: 'btn btn-sm btn-primary', text: '待复习管理', onClick: () => navigate('#/review') }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '快速设置', onClick: () => openDueManager(due) }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '✕', title: '隐藏提示',
          style: { padding: '2px 8px', color: 'var(--text-2)' },
          onClick: () => {
            localStorage.setItem('kg_hide_due_banner', 'true');
            renderHome();
          }
        }),
      ]));
    }
  }

  // 获取数据
  const tasks = store.getTasks();
  const scatteredPoints = store.getPoints(null).filter(p => !p.chapterId);

  // ==========================================
  // ================== 如果是管理模式 ==================
  // ==========================================
  if (multiSelectMode) {
    // 渲染顶部批量操作栏
    view.appendChild(el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', background: 'rgba(239,71,111,0.08)', borderRadius: '10px', marginBottom: '12px', border: '1px solid rgba(239,71,111,0.2)' }
    }, [
      el('div', { style: { width: '100%', fontSize: '13px', fontWeight: '600', color: 'var(--danger)', marginBottom: '4px' } }, [
        `已选中 ${selectedIds.size} 个文件夹`
      ]),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { tasks.forEach(t => selectedIds.add(t.id)); renderHome(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selectedIds.clear(); renderHome(); } }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '✖ 退出管理',
        onClick: () => { multiSelectMode = false; selectedIds.clear(); window.multiSelectMode = false; renderHome(); }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => {
          if (selectedIds.size === 0) return toastError('请先勾选文件夹');
          const items = tasks.filter(t => selectedIds.has(t.id));
          localStorage.setItem('kg_clipboard_folders', JSON.stringify(items));
          toastSuccess(`已复制 ${items.length} 个文件夹`);
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 粘贴', onClick: () => {
          const raw = localStorage.getItem('kg_clipboard_folders');
          if (!raw) return toastError('剪贴板里没有文件夹');
          import('./importDoc.js').then(({ showPasteOptionsModal }) => {
            showPasteOptionsModal((finalChapterId, finalTaskId, targetName) => {
              const folders = JSON.parse(raw);
              toastSuccess(`正在粘贴到 ${targetName}...`);
              folders.forEach(f => store.copyTask(f.id, finalTaskId));
              setTimeout(() => { selectedIds.clear(); renderHome(); }, 500);
            }, null, null, '粘贴');
          });
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🚚 移动', onClick: () => {
          if (selectedIds.size === 0) return toastError('请先勾选文件夹');
          import('./importDoc.js').then(({ showPasteOptionsModal }) => {
            showPasteOptionsModal((finalChapterId, finalTaskId, targetName) => {
              selectedIds.forEach(id => {
                if (id === finalTaskId) return;
                store.updateTask(id, { parentId: finalTaskId });
              });
              toastSuccess(`已移动 ${selectedIds.size} 个文件夹到 ${targetName}`);
              selectedIds.clear(); renderHome();
            }, null, null, '移动');
          });
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async () => {
          if (selectedIds.size === 0) return toastError('请先勾选');
          if (await confirmBox({ title: '删除文件夹', message: `确定删除选中的 ${selectedIds.size} 个文件夹吗？` })) {
            selectedIds.forEach(id => store.deleteTask(id));
            selectedIds.clear(); renderHome(); toastSuccess('已删除');
          }
        }
      })
    ]));

    // 渲染文件夹列表
    const list = el('div', { id: 'task-list' });
    const rootTasks = tasks.filter(t => !t.parentId);
    rootTasks.forEach(t => {
      list.appendChild(taskCard(t, null, 0));
    });
    view.appendChild(list);
    return; // 管理模式到此结束
  }

  // ==========================================
  // ================== 如果是普通模式 ==================
  // ==========================================

  // 3. 渲染散落卡片
  if (scatteredPoints.length > 0) {
    const isCollapsed = getInboxCollapsed();

    view.appendChild(el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px', flexWrap: 'wrap', gap: '8px' }
    }, [
      el('div', {
        style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' },
        onClick: () => { setInboxCollapsed(!isCollapsed); renderHome(); }
      }, [
        el('span', { text: isCollapsed ? '▸' : '▾' }),
        el('span', { text: `📄 散落卡片 (${scatteredPoints.length})` })
      ]),

      // 散落卡片专属工具栏
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-sm ' + (cardMultiMode ? 'btn-danger' : 'btn-ghost'),
          text: cardMultiMode ? '✕ 退出多选' : '☑ 多选',
          onClick: () => {
            cardMultiMode = !cardMultiMode;
            if (!cardMultiMode) selectedCardIds.clear();
            renderHome();
          }
        }),

        cardMultiMode ? el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { scatteredPoints.forEach(p => selectedCardIds.add(p.id)); renderHome(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { scatteredPoints.forEach(p => selectedCardIds.delete(p.id)); renderHome(); } }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => {
              if (selectedCardIds.size === 0) return toastError('请先勾选卡片');
              const items = scatteredPoints.filter(p => selectedCardIds.has(p.id));
              localStorage.setItem('kg_clipboard_points', JSON.stringify(items));
              toastSuccess(`已复制 ${items.length} 张卡片`);
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📥 粘贴', onClick: () => {
              const raw = localStorage.getItem('kg_clipboard_points');
              if (!raw) return toastError('剪贴板为空');
              const points = JSON.parse(raw);
              import('./importDoc.js').then(({ showPasteOptionsModal }) => {
                showPasteOptionsModal(async (finalChapterId, finalTaskId, targetName) => {
                  if (!finalChapterId) return toastError('请选择目标文件夹');
                  if (await confirmBox({ title: '粘贴卡片', message: `确定要将 ${points.length} 张卡片粘贴到「${targetName}」吗？` })) {
                    points.forEach(p => {
                      store.createPoint({ chapterId: finalChapterId, content: p.content, explanation: p.explanation, difficulty: p.difficulty, imageIds: p.imageIds });
                    });
                    toastSuccess('粘贴成功'); selectedCardIds.clear(); renderHome();
                  }
                }, null, null, '粘贴');
              });
            }
          }),
          (selectedCardIds.size > 0) ? el('button', {
            class: 'btn btn-sm btn-primary', text: `📁 移入 (${selectedCardIds.size})`, onClick: () => {
              import('./importDoc.js').then(({ showPasteOptionsModal }) => {
                showPasteOptionsModal(async (finalChapterId, finalTaskId, targetName) => {
                  if (!finalChapterId) return toastError('请选择目标文件夹');
                  if (await confirmBox({ title: '移入', message: `确定将 ${selectedCardIds.size} 张卡片移入「${targetName}」吗？` })) {
                    selectedCardIds.forEach(id => store.updatePoint(id, { chapterId: finalChapterId }));
                    toastSuccess('已移入'); selectedCardIds.clear(); renderHome();
                  }
                }, null, null, '移动');
              });
            }
          }) : null,
          (selectedCardIds.size > 0) ? el('button', {
            class: 'btn btn-sm btn-danger', text: `🗑 删除 (${selectedCardIds.size})`, onClick: async () => {
              if (!confirm(`确定删除选中的 ${selectedCardIds.size} 张散落卡片吗？`)) return;
              selectedCardIds.forEach(id => store.deletePoint(id));
              toastSuccess('已移入回收站'); selectedCardIds.clear(); cardMultiMode = false; renderHome();
            }
          }) : null
        ]) : null
      ])
    ]));

    // 渲染散落网格
    if (!isCollapsed) {
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', marginBottom: '24px' } });
      scatteredPoints.forEach(p => {
        const isSelected = selectedCardIds.has(p.id);
        grid.appendChild(el('div', {
          class: 'card',
          style: { position: 'relative', cursor: 'pointer', padding: '16px', margin: '0', border: '1px solid rgba(0,0,0,.05)', display: 'flex', gap: '8px', alignItems: 'flex-start', opacity: (cardMultiMode && !isSelected) ? '0.6' : '1' },
          onClick: (e) => {
            if (e.target.closest('.del-btn') || e.target.closest('input')) return;
            if (cardMultiMode) {
              if (isSelected) selectedCardIds.delete(p.id); else selectedCardIds.add(p.id);
              renderHome();
            } else {
              navigate(`#/edit-point/${p.id}`);
            }
          }
        }, [
          cardMultiMode ? el('input', {
            type: 'checkbox', checked: isSelected, style: { marginTop: '4px', width: '18px', height: '18px', accentColor: 'var(--danger)' },
            onClick: (e) => e.stopPropagation(),
            onChange: (e) => { if (e.target.checked) selectedCardIds.add(p.id); else selectedCardIds.delete(p.id); renderHome(); }
          }) : null,
          el('div', { style: { flex: '1' } }, [
            el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px', whiteSpace: 'pre-wrap' }, text: p.content.replace(/<[^>]+>/g, '').slice(0, 100) + (p.content.length > 100 ? '...' : '') }),
            el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: new Date(p.createdAt).toLocaleDateString() })
          ]),
          !cardMultiMode ? el('button', {
            class: 'btn btn-sm btn-ghost del-btn', style: { position: 'absolute', top: '8px', right: '8px', padding: '4px', color: 'var(--danger)', opacity: '0.6' }, text: '🗑',
            onClick: async (e) => {
              e.stopPropagation();
              if (await confirmBox({ title: '删除卡片', message: '确定要删除这张散落卡片吗？', danger: true, confirmText: '删除' })) { store.deletePoint(p.id); toastSuccess('已删除'); renderHome(); }
            }
          }) : null
        ]));
      });
      view.appendChild(grid);
    }
  }

  // 4. 渲染文件夹
  if (tasks.length > 0) {
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 6px' } }, [
      el('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-2)' }, text: '📁 我的文件夹' }),
      el('button', {
        class: `btn btn-sm ${multiSelectMode ? 'btn-danger' : 'btn-ghost'}`,
        text: multiSelectMode ? '✖ 退出管理' : '⚙️ 管理',
        onClick: () => { multiSelectMode = !multiSelectMode; selectedIds.clear(); renderHome(); }
      })
    ]));

    const list = el('div', { id: 'task-list' });
    const rootTasks = tasks.filter(t => !t.parentId);
    rootTasks.forEach(t => { list.appendChild(taskCard(t, null, 0)); });
    view.appendChild(list);
  } else if (scatteredPoints.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '📚' }),
      el('div', { text: '资料库空空如也' }),
      el('div', { text: '点击右下角 + 新建卡片', style: { fontSize: '13px', marginTop: '8px' } }),
    ]));
  }

  // 7. 悬浮球
  renderFAB(view);

  // 刷新侧边栏
  renderSidebar();
}

//补回了丢失的 swap 函数
function swap(ids, id, dir) {
  const idx = ids.indexOf(id);
  const target = idx + dir;
  if (target < 0 || target >= ids.length) return ids;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  return ids;
}

export function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (sidebar.classList.contains('collapsed')) return;
  sidebar.classList.remove('hidden');
  const tree = document.getElementById('sidebar-tree');
  if (!tree) return;

  let state;
  try { state = JSON.parse(localStorage.getItem('kg_sidebar_tree_state') || '{}'); } catch { state = {}; }
  if (!state.tasks) state.tasks = [];
  // 用于记录展开了哪些卡片的解释
  if (!state.points) state.points = [];

  function saveState() { localStorage.setItem('kg_sidebar_tree_state', JSON.stringify(state)); }

  function toggleTask(id) {
    const i = state.tasks.indexOf(id);
    if (i >= 0) state.tasks.splice(i, 1); else state.tasks.push(id);
    saveState();
    renderSidebar();
  }

  function togglePoint(id) {
    const i = state.points.indexOf(id);
    if (i >= 0) state.points.splice(i, 1); else state.points.push(id);
    saveState();
    renderSidebar();
  }

  clear(tree);

  // ================= 1. 获取侧边栏设置 =================
  let config = { errorBookPos: 'bottom', countdownPos: 'bottom', countdownSize: 'medium' };
  try {
    const saved = JSON.parse(localStorage.getItem('kg_sidebar_config'));
    if (saved) config = { ...config, ...saved };
  } catch (e) { }

  // ================= 2. 生成小组件 DOM =================
  const errorBookWidget = el('div', {
    style: { marginTop: '24px', paddingTop: '12px', borderTop: '1px dashed rgba(0,0,0,.08)' }
  }, [
    el('div', {
      style: { padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', color: 'var(--danger)', fontSize: '12px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.85 },
      onClick: () => { navigate('#/error-book'); if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open'); }
    }, [el('span', { text: '❗', style: { fontSize: '10px' } }), el('span', { text: '错题本' })])
  ]);

  const countdownWidget = el('div', { style: { marginTop: '12px', marginBottom: '12px' } });
  try {
    const countdowns = JSON.parse(localStorage.getItem('kg_exam_countdowns') || '[]');
    countdowns.forEach(cd => {
      if (cd.isPinned === false) return;
      const diff = new Date(cd.date).getTime() - Date.now();
      if (diff > 0) {
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        countdownWidget.appendChild(el('div', {
          style: { padding: '8px', background: 'rgba(142,202,230,.15)', borderRadius: '8px', marginBottom: '6px', textAlign: 'center', fontWeight: '600', color: 'var(--primary-dark)', fontSize: config.countdownSize === 'small' ? '12px' : config.countdownSize === 'large' ? '18px' : '14px' }
        }, [
          el('div', { text: cd.name, style: { fontSize: '11px', color: 'var(--text-2)', marginBottom: '2px' } }),
          el('div', { text: `距离还有 ${days} 天` })
        ]));
      }
    });
  } catch (e) { }

  // ================= 3. 组装侧边栏 =================
  const folderContainer = el('div', { style: { marginTop: '8px' } });

  const insertWidgets = (position, container) => {
    if (config.errorBookPos === position) container.appendChild(errorBookWidget);
    if (config.countdownPos === position) container.appendChild(countdownWidget);
  };

  const topWrapper = el('div');
  insertWidgets('top', topWrapper);
  if (topWrapper.hasChildNodes()) tree.appendChild(topWrapper);

  const middleWrapper = el('div');
  insertWidgets('middle', middleWrapper);
  if (middleWrapper.hasChildNodes()) tree.appendChild(middleWrapper);

  // 渲染侧边栏的迷你卡片
  const renderMiniPoints = (taskId, depth) => {
    const points = store.getPoints(taskId); // 获取该文件夹下的所有卡片
    points.forEach(p => {
      const isExpanded = state.points.includes(p.id);
      const hasExplanation = p.explanation && p.explanation.trim() !== '';

      // 卡片行
      const pointRow = el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
          paddingLeft: (depth * 16 + 24) + 'px', paddingTop: '4px', paddingBottom: '4px',
          fontSize: '12px', color: 'var(--text-2)', borderBottom: '1px dashed rgba(0,0,0,.04)'
        },
        onClick: () => {
          if (hasExplanation) {
            togglePoint(p.id);
          } else {
            navigate(`#/edit-point/${p.id}`);
            if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
          }
        }
      }, [
        // 展开箭头
        el('span', {
          style: { width: '12px', textAlign: 'center', fontSize: '10px' },
          text: hasExplanation ? (isExpanded ? '▾' : '▸') : '•'
        }),
        // 卡片内容（截断）
        el('span', {
          style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          text: p.content.replace(/<[^>]+>/g, '').slice(0, 20) // 去除 HTML 标签并截断
        })
      ]);

      folderContainer.appendChild(pointRow);

      // 如果展开了解释，渲染解释内容
      if (isExpanded && hasExplanation) {
        folderContainer.appendChild(el('div', {
          style: {
            paddingLeft: (depth * 16 + 40) + 'px', paddingRight: '8px',
            paddingTop: '4px', paddingBottom: '8px', fontSize: '11px', color: 'var(--text-2)',
            lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'rgba(0,0,0,0.02)', borderRadius: '4px', marginBottom: '4px'
          },
          innerHTML: p.explanation // 保留富文本格式
        }));
      }
    });
  };

  // 渲染文件夹树
  const tasks = store.getTasks();
  const renderTree = (parentId, depth) => {
    const currentLevel = tasks.filter(t => (t.parentId || null) === parentId);
    currentLevel.forEach(task => {
      const taskOpen = state.tasks.includes(task.id);
      const subFolders = tasks.filter(t => t.parentId === task.id);
      // 只要该文件夹下有卡片，就允许展开
      const hasPoints = store.getPoints(task.id).length > 0;
      const hasSub = subFolders.length > 0 || hasPoints;

      const taskRow = el('div', {
        class: 'tree-task-name',
        style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', paddingLeft: (depth * 16) + 'px', paddingTop: '6px', paddingBottom: '6px' },
        onClick: () => {
          // 如果点击文件夹名字，依然跳转到主界面
          navigate(`#/folder/${task.id}`);
          if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
        }
      }, [
        el('span', {
          style: { width: '18px', textAlign: 'center', flexShrink: '0', color: 'var(--text-2)', fontSize: '12px' },
          text: hasSub ? (taskOpen ? '▾' : '▸') : '',
          onClick: (e) => {
            e.stopPropagation(); // 阻止跳转
            if (hasSub) toggleTask(task.id);
          },
        }),
        el('span', {
          style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px' },
          text: `📁 ${task.name}`
        }),
      ]);

      folderContainer.appendChild(taskRow);

      // 如果展开了，先渲染子文件夹，再渲染卡片
      if (taskOpen) {
        if (subFolders.length > 0) {
          renderTree(task.id, depth + 1);
        }
        if (hasPoints) {
          renderMiniPoints(task.id, depth + 1);
        }
      }
    });
  };

  renderTree(null, 0);
  tree.appendChild(folderContainer);

  if (tasks.length === 0) {
    folderContainer.appendChild(el('div', {
      style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(0,0,0,.08)', fontSize: '12px', color: 'var(--text-2)', padding: '6px 10px' },
      text: '还没有文件夹'
    }));
  }

  const bottomWrapper = el('div');
  insertWidgets('bottom', bottomWrapper);
  if (bottomWrapper.hasChildNodes()) tree.appendChild(bottomWrapper);
}

function openDueManager(due) {
  const selected = new Set();
  const list = el('div', { style: { maxHeight: '50vh', overflowY: 'auto', margin: '12px 0' } },
    due.map(p => {
      const ch = store.getChapter(p.chapterId);
      return el('label', {
        style: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px', borderBottom: '1px solid rgba(0,0,0,.06)', cursor: 'pointer' },
      }, [
        el('input', {
          type: 'checkbox',
          onChange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); },
        }),
        el('div', { style: { flex: '1' } }, [
          el('div', { style: { fontSize: '14px', fontWeight: '600' }, text: p.content.slice(0, 50) }),
          ch ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: ch.name }) : null,
        ]),
      ]);
    })
  );

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '480px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' } }, [
      el('h3', { text: '管理今日待复习' }),
      el('p', { text: '勾选不想今天复习的知识点，选择处理方式', style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' } }),
      list,
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' } }, [
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选',
            onClick: () => {
              due.forEach(p => selected.add(p.id));
              list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选',
            onClick: () => {
              selected.clear();
              list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            },
          }),
        ]),
        el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
          el('button', {
            class: 'btn btn-sm btn-primary', text: '今天跳过',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(0, 0, 0, 0);
              selected.forEach(id => store.snoozePoint(id, tomorrow.toISOString()));
              mask.remove();
              toastSuccess(`已跳过 ${selected.size} 个知识点，明天再出现`);
              renderHome();
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '3 天后',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              const d = new Date();
              d.setDate(d.getDate() + 3);
              d.setHours(0, 0, 0, 0);
              selected.forEach(id => store.snoozePoint(id, d.toISOString()));
              mask.remove();
              toastSuccess(`已推迟 ${selected.size} 个知识点 3 天`);
              renderHome();
            },
          }),
          (() => {
            const dayInput = el('input', { type: 'number', min: '1', max: '365', placeholder: '天数', style: { width: '60px', padding: '4px 6px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)', fontSize: '13px' } });
            const customBtn = el('button', {
              class: 'btn btn-sm btn-ghost', text: '推迟',
              onClick: () => {
                if (selected.size === 0) { alert('请先勾选'); return; }
                const days = parseInt(dayInput.value);
                if (!days || days < 1 || days > 365) { alert('请输入 1-365 之间的天数'); return; }
                const d = new Date();
                d.setDate(d.getDate() + days);
                d.setHours(0, 0, 0, 0);
                selected.forEach(id => store.snoozePoint(id, d.toISOString()));
                mask.remove();
                toastSuccess(`已推迟 ${selected.size} 个知识点 ${days} 天`);
                renderHome();
              }
            });
            return el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg)', padding: '2px 6px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } }, [dayInput, customBtn]);
          })(),
          el('button', {
            class: 'btn btn-sm btn-danger', text: '永久排除',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              if (!confirm(`永久排除 ${selected.size} 个知识点，不再出现在待复习里？`)) return;
              selected.forEach(id => store.excludePoint(id));
              mask.remove();
              toastSuccess(`已排除 ${selected.size} 个知识点`);
              renderHome();
            },
          }),
        ]),
        el('div', { style: { textAlign: 'right' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => mask.remove() }),
        ]),
      ]),
    ]),
  ]);
  document.body.appendChild(mask);
}

function openCopyPasteModal() {
  const clipboardRaw = localStorage.getItem('kg_clipboard_copy');
  let clipboardName = '';
  if (clipboardRaw) {
    try {
      const data = JSON.parse(clipboardRaw);
      clipboardName = data.type === 'task' ? data.task.name : data.chapter.name;
    } catch { }
  }

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '340px' } }, [
      el('h3', { text: '📋 复制与粘贴' }),
      el('p', { style: { fontSize: '12px', color: 'var(--text-2)', margin: '8px 0 16px' }, text: '你可以复制当前任务列表里的某一个，或者把剪贴板里刚复制的内容粘贴出来。' }),
      el('button', {
        class: 'btn btn-primary', text: '📥 粘贴剪贴板内容', style: { width: '100%', marginBottom: '8px' },
        onClick: () => {
          if (!clipboardRaw) { alert('剪贴板为空'); return; }
          const res = store.pasteData();
          if (res.success) {
            toastSuccess(res.msg);
            mask.remove();
            if (multiSelectMode) { multiSelectMode = false; selectedIds.clear(); }
            renderHome();
          } else {
            alert(res.msg);
          }
        },
      }),
      clipboardName ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '16px', textAlign: 'center' }, text: `剪贴板当前内容：${clipboardName}` }) : null,
      el('div', { style: { borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: '16px', marginTop: '8px' } }, [
        el('button', {
          class: 'btn btn-ghost', text: '📋 复制指定任务', style: { width: '100%' },
          onClick: () => {
            const tasks = store.getTasks();
            if (tasks.length === 0) { alert('没有任务可复制'); return; }
            const targetName = prompt('输入要复制的任务名称（需完全一致）：', tasks[0].name);
            if (!targetName) return;
            const target = tasks.find(t => t.name === targetName);
            if (target) {
              store.copyTask(target.id);
              toastSuccess(`已复制「${target.name}」`);
              mask.remove();
            } else {
              alert('未找到该名称的任务');
            }
          },
        }),
      ]),
      el('div', { style: { marginTop: '16px', textAlign: 'center' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '关闭', onClick: () => mask.remove() })
      ])
    ])
  ]);
  document.body.appendChild(mask);
}

//补回了丢失的快速预览图片方法
async function openQuickImagePreview(imageIds, title) {
  if (!imageIds || imageIds.length === 0) return;
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'rgba(0,0,0,0.9)' } });
  const imgWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '20px', maxHeight: '80vh', overflowY: 'auto', justifyContent: 'center' } });
  mask.appendChild(el('h3', { text: title + ' - 附件预览', style: { color: '#fff', textAlign: 'center', marginTop: '20px' } }));
  mask.appendChild(imgWrap);
  for (const id of imageIds) {
    const rec = await store.dbGet('images', id);
    if (rec && (rec.annotatedBlob || rec.originalBlob)) {
      const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
      imgWrap.appendChild(el('img', { src: url, style: { maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px', objectFit: 'contain' }, onLoad: () => URL.revokeObjectURL(url) }));
    }
  }
  const closeBtn = el('button', { class: 'btn btn-primary', text: '关闭', style: { position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)' }, onClick: () => mask.remove() });
  mask.appendChild(closeBtn);
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  document.body.appendChild(mask);
}

//移入文件夹弹窗
function openMoveToFolderModal(selectedCardIds, onSuccess) {
  if (selectedCardIds.size === 0) return;

  const allFolders = store.getTasks();
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
    el('h3', { text: `移动 ${selectedCardIds.size} 张卡片` }),
    el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择要移动到的文件夹：' }),
  ]);
  mask.appendChild(box);

  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' } });

  if (allFolders.length === 0) {
    list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '暂无已有文件夹' }));
  } else {
    const folderContainer = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    allFolders.forEach(folder => {
      folderContainer.appendChild(el('div', {
        style: { padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.04)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' },
        onClick: () => executeMove(folder)
      }, [
        el('span', { text: '📁', style: { fontSize: '16px' } }),
        el('span', { text: folder.name, style: { fontWeight: '500' } })
      ]));
    });
    list.appendChild(folderContainer);
  }
  box.appendChild(list);

  // 底部操作区
  box.appendChild(el('div', { class: 'confirm-actions', style: { justifyContent: 'space-between' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📁+ 新建文件夹并移入',
      onClick: () => {
        const newName = prompt('输入新文件夹名称：');
        if (!newName || !newName.trim()) return;
        const finalName = newName.trim();

        // 建文件夹
        const newTask = store.createTask({ name: finalName });
        executeMove(newTask);
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
  ]));

  // 真正的执行移动逻辑
  function executeMove(targetTask) {
    let chapters = store.getChapters(targetTask.id);
    let targetChapterId = chapters.length > 0 ? chapters[0].id : store.createChapter({ name: '默认子模块', taskId: targetTask.id }).id;

    selectedCardIds.forEach(id => {
      const pt = store.getPoint(id);
      if (pt) store.updatePoint(id, { chapterId: targetChapterId });
    });

    toastSuccess(`已将 ${selectedCardIds.size} 张卡片移入「${targetTask.name}」`);
    mask.remove();

    // 清理状态并刷新
    selectedCardIds.clear();
    onSuccess();
  }

  document.body.appendChild(mask);
}

window.renderHomeGlobal = renderHome;
