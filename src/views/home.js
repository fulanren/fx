import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { dbGet } from '../db.js';

// ============ 文件夹折叠状态 ============
function getCollapsedFolders() {
  try { return new Set(JSON.parse(localStorage.getItem('kg_collapsed_folders') || '[]')); }
  catch { return new Set(); }
}
let collapsedFolders = getCollapsedFolders();

function toggleFolderCollapse(id) {
  if (collapsedFolders.has(id)) collapsedFolders.delete(id);
  else collapsedFolders.add(id);
  localStorage.setItem('kg_collapsed_folders', JSON.stringify([...collapsedFolders]));
  renderHome();
}

// ============ 散落卡片折叠状态 ============
function getInboxCollapsed() {
  return localStorage.getItem('kg_inbox_collapsed') === 'true';
}
function setInboxCollapsed(val) {
  localStorage.setItem('kg_inbox_collapsed', val);
}

// 全局（文件夹）多选状态
let multiSelectMode = false;
const selectedIds = new Set();

// 散落卡片独立的专属多选状态
let cardMultiMode = false;
const selectedCardIds = new Set();

export function renderHome() {
  const view = document.getElementById('view');
  clear(view);

  // 👈 【修复】彻底删掉 view.style.padding，防止在平板上导致滚动死锁

  document.getElementById('page-title').textContent = multiSelectMode ? '选择任务' : '资料库';
  document.getElementById('btn-back').classList.add('hidden');

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

  // 2. 获取数据
  const tasks = store.getTasks();
  const scatteredPoints = store.getPoints(null).filter(p => !p.chapterId);

  if (!multiSelectMode) {
    // 3. 渲染散落卡片
    if (scatteredPoints.length > 0) {
      const isCollapsed = getInboxCollapsed();

      // 标题栏 + 专属工具栏
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

        // 👇 专属工具栏（使用 cardMultiMode）
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

          cardMultiMode ? el('button', {
            class: 'btn btn-sm btn-ghost',
            text: scatteredPoints.every(p => selectedCardIds.has(p.id)) ? '全不选' : '全选',
            onClick: () => {
              const allSelected = scatteredPoints.every(p => selectedCardIds.has(p.id));
              if (allSelected) scatteredPoints.forEach(p => selectedCardIds.delete(p.id));
              else scatteredPoints.forEach(p => selectedCardIds.add(p.id));
              renderHome();
            }
          }) : null,

          (cardMultiMode && selectedCardIds.size > 0) ? el('button', {
            class: 'btn btn-sm btn-primary',
            text: `📁 移入文件夹 (${selectedCardIds.size})`,
            onClick: () => {
              openMoveToFolderModal(selectedCardIds, () => {
                cardMultiMode = false;
                renderHome();
              });
            }
          }) : null,

          (cardMultiMode && selectedCardIds.size > 0) ? el('button', {
            class: 'btn btn-sm btn-danger',
            text: `🗑 删除 (${selectedCardIds.size})`,
            onClick: async () => {
              if (!confirm(`确定删除选中的 ${selectedCardIds.size} 张散落卡片吗？`)) return;
              selectedCardIds.forEach(id => store.deletePoint(id));
              toastSuccess('已移入回收站');
              selectedCardIds.clear();
              cardMultiMode = false;
              renderHome();
            }
          }) : null,
        ])
      ]));

      // 网格渲染
      if (!isCollapsed) {
        const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', marginBottom: '24px' } });

        scatteredPoints.forEach(p => {
          const isSelected = selectedCardIds.has(p.id);

          grid.appendChild(el('div', {
            class: 'card', // 直接去掉 selected 状态的判断
            style: {
              position: 'relative', cursor: 'pointer', padding: '16px', margin: '0',
              border: '1px solid rgba(0,0,0,.05)', // 永远保持默认的极细边框
              display: 'flex', gap: '8px', alignItems: 'flex-start',
              opacity: (cardMultiMode && !isSelected) ? '0.6' : '1'
            },
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
            // 专属多选框
            cardMultiMode ? el('input', {
              type: 'checkbox',
              checked: isSelected,
              style: { marginTop: '4px', width: '18px', height: '18px' },
              onClick: (e) => e.stopPropagation(),
              onChange: (e) => {
                if (e.target.checked) selectedCardIds.add(p.id);
                else selectedCardIds.delete(p.id);
                renderHome();
              }
            }) : null,

            // 内容
            el('div', { style: { flex: '1' } }, [
              el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px', whiteSpace: 'pre-wrap' }, text: p.content.slice(0, 100) + (p.content.length > 100 ? '...' : '') }),
              el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: new Date(p.createdAt).toLocaleDateString() })
            ]),

            // 悬浮删除按钮
            !cardMultiMode ? el('button', {
              class: 'btn btn-sm btn-ghost del-btn',
              style: { position: 'absolute', top: '8px', right: '8px', padding: '4px', color: 'var(--danger)', opacity: '0.6' },
              text: '🗑',
              title: '删除此卡片',
              onClick: async (e) => {
                e.stopPropagation();
                if (await confirmBox({ title: '删除卡片', message: '确定要删除这张散落卡片吗？', danger: true, confirmText: '删除' })) {
                  store.deletePoint(p.id);
                  toastSuccess('已删除');
                  renderHome();
                }
              }
            }) : null
          ]));
        });

        view.appendChild(grid);
      }
    }

    // 4. 渲染文件夹（专题）
    if (tasks.length > 0) {
      view.appendChild(el('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-2)', margin: '12px 0 6px' }, text: '📁 我的文件夹' }));
      const list = el('div', { id: 'task-list' });

      const renderTree = (parentId, depth) => {
        tasks.filter(t => (t.parentId || null) === parentId).forEach(t => {
          const wrapper = el('div', { style: { marginLeft: depth === 0 ? '0' : '24px', position: 'relative' } });
          if (depth > 0) {
            wrapper.style.borderLeft = '2px dashed rgba(142,202,230,0.3)';
            wrapper.style.paddingLeft = '12px';
          }
          wrapper.appendChild(taskCard(t));
          list.appendChild(wrapper);

          if (!collapsedFolders.has(t.id)) {
            renderTree(t.id, depth + 1);
          }
        });
      };

      renderTree(null, 0);
      view.appendChild(list);
    }

    // 5. 只有全空才显示占位图
    if (tasks.length === 0 && scatteredPoints.length === 0) {
      view.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-icon', text: '📚' }),
        el('div', { text: '资料库空空如也' }),
        el('div', { text: '点击右下角 + 新建卡片', style: { fontSize: '13px', marginTop: '8px' } }),
      ]));
    }
  } else {
    // 6. 批量模式下的逻辑（补回全选与取消按钮）
    view.appendChild(el('div', { class: 'batch-bar' }, [
      el('span', { text: `已选 ${selectedIds.size} 项` }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { tasks.forEach(t => selectedIds.add(t.id)); renderHome(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => { multiSelectMode = false; selectedIds.clear(); renderHome(); } }),
    ]));

    const list = el('div', { id: 'task-list' });
    const renderTree = (parentId, depth) => {
      tasks.filter(t => (t.parentId || null) === parentId).forEach(t => {
        list.appendChild(taskCard(t));
        if (!collapsedFolders.has(t.id)) {
          renderTree(t.id, depth + 1);
        }
      });
    };
    renderTree(null, 0);
    view.appendChild(list);
  }

  // 7. 右下角 + 号（新建卡片）
  if (!multiSelectMode) {
    view.appendChild(el('button', {
      class: 'fab', text: '+', 'aria-label': '新建卡片',
      style: { zIndex: 99999, fontSize: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      onClick: () => navigate('#/edit-point/new'),
    }));
  }

  renderSidebar();
}

function taskCard(task) {
  const isSelected = selectedIds.has(task.id);
  const subFolders = store.getTasks().filter(t => t.parentId === task.id);
  const hasSub = subFolders.length > 0;
  const isCollapsed = collapsedFolders.has(task.id);

  const chapters = store.getChapters(task.id);
  const chapterIds = chapters.map(c => c.id);
  const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
  const pointCount = allPoints.filter(p => chapterIds.includes(p.chapterId) && !p.deletedAt).length;

  return el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': task.id,
    style: { display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'pointer', marginBottom: '8px' },
    onClick: (e) => {
      if (e.target.closest('.card-actions') || e.target.closest('.select-box') || e.target.closest('.toggle-btn')) return;

      if (multiSelectMode) {
        if (selectedIds.has(task.id)) selectedIds.delete(task.id);
        else selectedIds.add(task.id);
        renderHome();
      } else {
        if (chapters.length > 0) {
          navigate(`#/chapter/${chapters[0].id}?taskName=${encodeURIComponent(task.name)}`);
        } else {
          const newChap = store.createChapter({ name: '默认', taskId: task.id });
          navigate(`#/chapter/${newChap.id}?taskName=${encodeURIComponent(task.name)}`);
        }
      }
    },
  }, [
    multiSelectMode ? el('div', { class: 'select-box' }, [
      el('input', {
        type: 'checkbox', checked: isSelected,
        onChange: (e) => {
          if (e.target.checked) selectedIds.add(task.id);
          else selectedIds.delete(task.id);
          renderHome();
        },
      }),
    ]) : null,

    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center' } }, [
        hasSub && !multiSelectMode ? el('span', {
          class: 'toggle-btn',
          style: { cursor: 'pointer', color: 'var(--text-2)', fontSize: '14px', padding: '4px 8px 4px 0', userSelect: 'none' },
          text: isCollapsed ? '▸' : '▾',
          onClick: (e) => { e.stopPropagation(); toggleFolderCollapse(task.id); }
        }) : el('span', { style: { width: '22px', display: 'inline-block' } }),

        el('div', { class: 'card-title', text: `📁 ${task.name}` })
      ]),

      !multiSelectMode ? el('div', { class: 'card-actions', style: { display: 'flex', gap: '4px' } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '➕📁', title: '新建子文件夹',
          onClick: () => {
            const name = prompt('输入子文件夹名称：');
            if (name && name.trim()) {
              store.createTask({ name: name.trim(), parentId: task.id });
              toastSuccess('子文件夹已创建');
              renderHome();
            }
          }
        }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', title: '编辑文件夹', onClick: () => navigate(`#/edit-task/${task.id}`) }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '🗑', title: '删除文件夹', style: { color: 'var(--danger)' },
          onClick: async () => {
            if (await confirmBox({ title: '删除文件夹', message: `「${task.name}」及其卡片将进入回收站`, danger: true, confirmText: '删除' })) {
              store.deleteTask(task.id);
              toastSuccess('已移入回收站');
              renderHome();
            }
          },
        }),
      ]) : null
    ]),

    task.note ? el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: task.note }) : null,

    el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' } }, [
      el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: `💡 ${pointCount} 张卡片` }),
      hasSub ? el('span', { style: { fontSize: '12px', color: 'var(--primary)' }, text: `📁 ${subFolders.length} 个子文件夹` }) : null
    ])
  ]);
}

// 👇 【修复】补回了丢失的 swap 函数
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

  function saveState() { localStorage.setItem('kg_sidebar_tree_state', JSON.stringify(state)); }
  function toggleTask(id) {
    const i = state.tasks.indexOf(id);
    if (i >= 0) state.tasks.splice(i, 1); else state.tasks.push(id);
    saveState();
    renderSidebar();
  }

  clear(tree);

  tree.appendChild(el('div', {
    style: {
      marginTop: '24px', // 👈 往下推开，和主文件夹拉开距离
      paddingTop: '12px',
      borderTop: '1px dashed rgba(0,0,0,.08)' // 👈 用极淡的虚线作为分割
    }
  }, [
    el('div', {
      style: {
        padding: '6px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'var(--danger)', // 👈 保留红色
        fontSize: '12px', // 👈 字体变小
        fontWeight: '500', // 👈 不再加粗，降低攻击性
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        opacity: 0.85 // 👈 稍微降低透明度，显得低调
      },
      onClick: () => {
        navigate('#/error-book');
        if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
      }
    }, [
      el('span', { text: '❗', style: { fontSize: '10px' } }), // 👈 感叹号也缩小一点
      el('span', { text: '错题本' })
    ])
  ]));

  const tasks = store.getTasks();
  if (tasks.length === 0) {
      tree.appendChild(el('div', {
    style: {
      marginTop: '8px', // 👈 从 24 改成 8，瞬间拉近
      paddingTop: '8px',
      borderTop: '1px dashed rgba(0,0,0,.08)'
    }
  }, [
    el('div', {
      style: {
        padding: '6px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'var(--danger)',
        fontSize: '12px',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        opacity: 0.85
      },
      onClick: () => {
        navigate('#/error-book');
        if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
      }
    }, [
      el('span', { text: '❗', style: { fontSize: '10px' } }),
      el('span', { text: '错题本' })
    ])
  ]));
    return;
  }

  const renderTree = (parentId, depth) => {
    const currentLevel = tasks.filter(t => (t.parentId || null) === parentId);

    currentLevel.forEach(task => {
      // 👇 核心修复：确保 state.tasks 这个数组存在，且包含当前任务 ID
      const taskOpen = state.tasks.includes(task.id);
      const subFolders = tasks.filter(t => t.parentId === task.id);
      const hasSub = subFolders.length > 0;

      const taskRow = el('div', {
        class: 'tree-task-name',
        style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', paddingLeft: (depth * 16) + 'px', paddingTop: '6px', paddingBottom: '6px' },
      }, [
        // 折叠/展开箭头
        el('span', {
          style: { width: '18px', textAlign: 'center', flexShrink: '0', color: 'var(--text-2)', fontSize: '12px' },
          text: hasSub ? (taskOpen ? '▾' : '▸') : '',
          onClick: (e) => {
            e.stopPropagation();
            if (hasSub) toggleTask(task.id);
          },
        }),
        // 文件夹名字
        el('span', {
          style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px' },
          text: `📁 ${task.name}`,
          onClick: () => {
            const chapters = store.getChapters(task.id);
            if (chapters.length > 0) {
              navigate(`#/chapter/${chapters[0].id}?taskName=${encodeURIComponent(task.name)}`);
            } else {
              const newChap = store.createChapter({ name: '默认', taskId: task.id });
              navigate(`#/chapter/${newChap.id}?taskName=${encodeURIComponent(task.name)}`);
            }
            if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
          },
        }),
      ]);

      tree.appendChild(taskRow);

      // 👇 核心渲染：只有 taskOpen 为 true 且有子文件夹时，才递归渲染子级
      if (taskOpen && hasSub) {
        renderTree(task.id, depth + 1);
      }
    });
  };

  renderTree(null, 0);
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

// 👇 【修复】补回了丢失的复制粘贴面板
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

// 👇 【修复】补回了丢失的快速预览图片方法
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

// 👇 移入文件夹弹窗
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