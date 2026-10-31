import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { mergeModal } from '../ui/mergeModal.js';
import { makeSortable } from '../ui/sortable.js';

// ============ 章节展开状态（持久化） ============
const EXPANDED_KEY = 'kg_expanded_tasks';

function getExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]')); }
  catch { return new Set(); }
}
let expandedTasks = getExpanded();

function saveExpanded() {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedTasks])); }
  catch {}
}

// ============ 多选状态 ============
let multiSelectMode = false;
const selectedIds = new Set();
let sortableInstance = null;

export function renderHome() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = multiSelectMode ? '选择任务' : '背诵';
  document.getElementById('btn-back').classList.add('hidden');

  const due = store.getDuePoints();
  if (!multiSelectMode && due.length > 0) {
    view.appendChild(el('div', { class: 'banner banner-warn' }, [
      el('span', { text: `📌 今日待复习 ${due.length} 个知识点` }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '去复习', onClick: () => navigate('#/review') }),
    ]));
  }

  const streak = store.getStreak();
  if (!multiSelectMode && streak > 0) {
    view.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } },
      [`🔥 连续打卡 ${streak} 天`]));
  }

  if (multiSelectMode) {
    view.appendChild(el('div', { class: 'batch-bar' }, [
      el('span', { text: `已选 ${selectedIds.size} 项` }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '全选',
        onClick: () => {
          store.getTasks().forEach(t => selectedIds.add(t.id));
          renderHome();
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '取消',
        onClick: () => { multiSelectMode = false; selectedIds.clear(); renderHome(); },
      }),
    ]));
    view.appendChild(el('div', { class: 'batch-bar-actions' }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并选中',
        onClick: async () => {
          if (selectedIds.size < 2) { alert('至少选择 2 个任务'); return; }
          const ids = [...selectedIds];
          const targetId = ids[0];
          const items = ids.map(id => store.getTask(id));
          await mergeModal({
            title: '合并任务', items, targetId,
            onConfirm: (sourceIds, dedupe) => {
              store.mergeTasks(sourceIds, targetId, dedupe);
              toastSuccess('已合并');
              multiSelectMode = false; selectedIds.clear();
              renderHome();
            },
          });
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除选中',
        onClick: async () => {
          if (selectedIds.size === 0) return;
          if (await confirmBox({ title: '删除', message: `删除 ${selectedIds.size} 个任务？将进入回收站`, danger: true, confirmText: '删除' })) {
            selectedIds.forEach(id => store.deleteTask(id));
            toastSuccess('已移入回收站');
            multiSelectMode = false; selectedIds.clear();
            renderHome();
          }
        },
      }),
    ]));
  } else {
    view.appendChild(el('div', { style: { textAlign: 'right', marginBottom: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '☑ 批量',
        onClick: () => { multiSelectMode = true; renderHome(); },
      }),
    ]));
  }

  const tasks = store.getTasks();
  if (tasks.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '📚' }),
      el('div', { text: '还没有背诵任务' }),
      el('div', { text: '点击右下角 + 新建一个', style: { fontSize: '13px', marginTop: '8px' } }),
    ]));
  } else {
    const list = el('div', { id: 'task-list' });
    tasks.forEach(t => list.appendChild(taskCard(t)));
    view.appendChild(list);

    if (!multiSelectMode) {
      sortableInstance = makeSortable(list, '.card', (orderedIds) => {
        store.reorderTasks(orderedIds);
        toastSuccess('顺序已保存');
      });
    }
  }

  if (!multiSelectMode) {
    view.appendChild(el('button', {
      class: 'fab', text: '+', 'aria-label': '新建任务',
      onClick: () => navigate('#/edit/task/new'),
    }));
  }

  renderSidebar();
}

function taskCard(task) {
  const chapters = store.getChapters(task.id);
  const pointCount = chapters.reduce((n, c) => n + store.getPoints(c.id).length, 0);
  const isSelected = selectedIds.has(task.id);
  const isExpanded = expandedTasks.has(task.id);

  return el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': task.id,
    onClick: (e) => {
      if (e.target.closest('.card-actions') || e.target.closest('.move-btns') || e.target.closest('.select-box') || e.target.closest('.chapter-toggle') || e.target.closest('.chapter-item')) return;
      if (multiSelectMode) {
        if (selectedIds.has(task.id)) selectedIds.delete(task.id);
        else selectedIds.add(task.id);
        renderHome();
      } else {
        navigate(`#/chapter-list/${task.id}`);
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
    el('div', { class: 'card-title', text: task.name }),
    task.note ? el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' }, text: task.note }) : null,
    el('div', { class: 'card-meta' }, [
      el('span', { text: `📖 ${chapters.length} 章节` }),
      el('span', { text: `💡 ${pointCount} 知识点` }),
      !multiSelectMode ? el('span', {
        class: 'chapter-toggle',
        style: { cursor: 'pointer', color: 'var(--primary-dark)', fontSize: '13px', marginLeft: 'auto', userSelect: 'none' },
        text: isExpanded ? '▴ 收起章节' : '▾ 显示章节',
        onClick: (e) => {
          e.stopPropagation();
          if (expandedTasks.has(task.id)) expandedTasks.delete(task.id);
          else expandedTasks.add(task.id);
          saveExpanded();
          renderHome();
        },
      }) : null,
    ]),
    (isExpanded && !multiSelectMode) ? el('div', {
      style: { marginTop: '10px', borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: '10px' },
    },
      chapters.length === 0
        ? [el('div', { style: { fontSize: '13px', color: 'var(--text-2)', padding: '4px 0' }, text: '还没有章节' })]
        : chapters.map(c => el('div', {
            class: 'chapter-item',
            style: { padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' },
            onClick: (e) => { e.stopPropagation(); navigate(`#/chapter/${c.id}`); },
          }, [
            el('span', { text: c.name, style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
            el('span', { style: { fontSize: '12px', color: 'var(--text-2)', marginLeft: '8px', flexShrink: '0' }, text: `💡 ${store.getPoints(c.id).length}` }),
          ]))
    ) : null,
    !multiSelectMode ? el('div', { class: 'card-actions' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '编辑', onClick: () => navigate(`#/edit/task/${task.id}`) }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除',
        onClick: async () => {
          if (await confirmBox({ title: '删除任务', message: `「${task.name}」及其章节、知识点将进入回收站（30 天可恢复）`, danger: true, confirmText: '删除' })) {
            store.deleteTask(task.id);
            toastSuccess('已移入回收站');
            renderHome();
          }
        },
      }),
    ]) : null,
    !multiSelectMode ? el('div', { class: 'move-btns' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '↑', onClick: (e) => { e.stopPropagation(); store.reorderTasks(swap(store.getTasks().map(t=>t.id), task.id, -1)); renderHome(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '↓', onClick: (e) => { e.stopPropagation(); store.reorderTasks(swap(store.getTasks().map(t=>t.id), task.id, 1)); renderHome(); } }),
    ]) : null,
  ]);
}

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
  clear(tree);

  let expanded;
  try { expanded = new Set(JSON.parse(localStorage.getItem('kg_sidebar_expanded') || '[]')); }
  catch { expanded = new Set(); }

  function saveSidebarExpanded() {
    localStorage.setItem('kg_sidebar_expanded', JSON.stringify([...expanded]));
  }

  store.getTasks().forEach(t => {
    const chapters = store.getChapters(t.id);
    const isOpen = expanded.has(t.id);

    const taskName = el('div', {
      class: 'tree-task-name',
      style: { display: 'flex', alignItems: 'center', gap: '6px' },
      onClick: () => navigate(`#/chapter-list/${t.id}`),
    }, [
      el('span', {
        style: { cursor: 'pointer', width: '18px', textAlign: 'center', flexShrink: '0', color: 'var(--text-2)' },
        text: isOpen ? '▾' : '▸',
        onClick: (e) => {
          e.stopPropagation();
          if (expanded.has(t.id)) expanded.delete(t.id);
          else expanded.add(t.id);
          saveSidebarExpanded();
          renderSidebar();
        },
      }),
      el('span', { text: t.name, style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
    ]);

    const chapterList = isOpen ? el('div', { class: 'tree-chapters' },
      chapters.length === 0
        ? [el('div', { style: { fontSize: '12px', color: 'var(--text-2)', padding: '4px 10px' }, text: '暂无章节' })]
        : chapters.map(c => el('div', {
            class: 'tree-chapter',
            text: c.name,
            onClick: () => navigate(`#/chapter/${c.id}`),
          }))
    ) : null;

    tree.appendChild(el('div', { class: 'tree-task' }, [taskName, chapterList]));
  });

  if (store.getTasks().length === 0) {
    tree.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', padding: '12px' }, text: '暂无任务' }));
  }
}