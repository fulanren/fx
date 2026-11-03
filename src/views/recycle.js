import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { fmtDate, daysBetween } from '../utils/date.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';

const TYPE_LABEL = { task: '任务', chapter: '章节', point: '知识点', image: '图片', composite: '合成图' };

let multiMode = false;
const selected = new Set();

export function renderRecycle() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '回收站';
  document.getElementById('btn-back').classList.add('hidden');

  const bin = store.getRecycleBin();
  if (bin.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '🗑️' }),
      el('div', { text: '回收站是空的' }),
      el('div', { text: '删除的内容会保留 30 天', style: { fontSize: '13px', marginTop: '8px' } }),
    ]));
    return;
  }

  if (multiMode) {
    view.appendChild(el('div', { class: 'batch-bar' }, [
      el('span', { text: `已选 ${selected.size} 项` }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '全选',
        onClick: () => { bin.forEach(i => selected.add(i.id)); renderRecycle(); },
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '取消',
        onClick: () => { multiMode = false; selected.clear(); renderRecycle(); },
      }),
    ]));
    view.appendChild(el('div', { class: 'batch-bar-actions', style: { flexWrap: 'wrap' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '批量恢复',
        onClick: () => {
          if (selected.size === 0) { alert('请先勾选'); return; }
          selected.forEach(id => store.restoreRecycle(id));
          toastSuccess(`已恢复 ${selected.size} 项`);
          selected.clear();
          multiMode = false;
          renderRecycle();
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '批量删除',
        onClick: async () => {
          if (selected.size === 0) { alert('请先勾选'); return; }
          if (await confirmBox({ title: '批量删除', message: `彻底删除选中的 ${selected.size} 项？无法恢复`, danger: true, confirmText: '删除' })) {
            selected.forEach(id => store.purgeRecycle(id));
            toastSuccess(`已删除 ${selected.size} 项`);
            selected.clear();
            multiMode = false;
            renderRecycle();
          }
        },
      }),
    ]));
  } else {
    view.appendChild(el('div', { style: { textAlign: 'right', marginBottom: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '☑ 批量',
        onClick: () => { multiMode = true; renderRecycle(); },
      }),
    ]));
  }

  view.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } },
    [`共 ${bin.length} 项，30 天后自动清除`]));

  const groups = { task: [], chapter: [], point: [], image: [], composite: [] };
  bin.forEach(i => { (groups[i.type] || (groups[i.type] = [])).push(i); });

  for (const [type, items] of Object.entries(groups)) {
    if (!items || items.length === 0) continue;
    view.appendChild(el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-2)', margin: '16px 0 8px' }, text: (TYPE_LABEL[type] || type) + `（${items.length}）` }));
    items.forEach(item => view.appendChild(recycleCard(item)));
  }

  view.appendChild(el('div', { style: { marginTop: '24px', display: 'flex', gap: '8px' } }, [
    el('button', {
      class: 'btn btn-danger', text: '清空回收站', style: { flex: '1' },
      onClick: async () => {
        if (await confirmBox({ title: '清空回收站', message: '所有内容将永久删除，无法恢复', danger: true, confirmText: '清空' })) {
          store.emptyRecycle();
          toastSuccess('已清空');
          multiMode = false;
          selected.clear();
          renderRecycle();
        }
      },
    }),
  ]));
}

function recycleCard(item) {
  const p = item.payload;
  const name = p.name || p.content || p.id;
  const remain = Math.max(0, 30 - daysBetween(item.deletedAt, new Date().toISOString()));
  return el('div', { class: 'card' + (selected.has(item.id) ? ' selected' : ''), style: { cursor: 'default' } }, [
    multiMode ? el('div', { class: 'select-box' }, [
      el('input', {
        type: 'checkbox',
        checked: selected.has(item.id),
        onChange: (e) => {
          if (e.target.checked) selected.add(item.id);
          else selected.delete(item.id);
          renderRecycle();
        },
      }),
    ]) : null,
    el('div', { class: 'card-title', text: name }),
    el('div', { class: 'card-meta' }, [
      el('span', { text: `删除于 ${fmtDate(item.deletedAt)}` }),
      el('span', { text: `剩余 ${remain} 天`, style: remain <= 3 ? { color: 'var(--danger)' } : {} }),
    ]),
    !multiMode ? el('div', { class: 'card-actions' }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '恢复',
        onClick: () => {
          store.restoreRecycle(item.id);
          toastSuccess('已恢复');
          renderRecycle();
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '彻底删除',
        onClick: async () => {
          if (await confirmBox({ title: '彻底删除', message: '删除后无法恢复', danger: true, confirmText: '删除' })) {
            store.purgeRecycle(item.id);
            toastSuccess('已删除');
            renderRecycle();
          }
        },
      }),
    ]) : null,
  ]);
}