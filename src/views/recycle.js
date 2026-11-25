import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { fmtDate, daysBetween } from '../utils/date.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';

const TYPE_LABEL = { task: '任务', chapter: '章节', point: '知识点', image: '图片', composite: '合成图', attachment: '附件' };

let multiMode = false;
const selected = new Set();
let searchKeyword = '';
let searchScope = 'all'; // 'all' | 'name' | 'type' | 'path'

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

  // ===== 搜索过滤 =====
  const keyword = searchKeyword.trim().toLowerCase();
  const filtered = keyword ? bin.filter(item => {
    const p = item.payload || {};
    const name = (p.name || p.content || p.id || '').toLowerCase();
    const typeLabel = (TYPE_LABEL[item.type] || item.type || '').toLowerCase();
    const path = [p.folderName, p.pointName, p.entityName].filter(Boolean).join(' ').toLowerCase();

    switch (searchScope) {
      case 'name': return name.includes(keyword);
      case 'type': return typeLabel.includes(keyword);
      case 'path': return path.includes(keyword);
      default: return name.includes(keyword) || typeLabel.includes(keyword) || path.includes(keyword);
    }
  }) : bin;

  // ===== 顶部工具栏 =====
  const toolbar = el('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
      marginBottom: '6px',
    }
  });

  // 搜索范围下拉
  const scopeSelect = el('select', {
    value: searchScope,
    style: {
      padding: '5px 6px',
      fontSize: '12px',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      background: 'var(--bg-1)',
      color: 'var(--text-1)',
      flexShrink: 0,
    },
    onChange: (e) => {
      searchScope = e.target.value;
      renderRecycle();
    },
  }, [
    el('option', { value: 'all', text: '全部' }),
    el('option', { value: 'name', text: '名称' }),
    el('option', { value: 'type', text: '类型' }),
    el('option', { value: 'path', text: '路径' }),
  ]);
  toolbar.appendChild(scopeSelect);

  // 搜索输入框
  const searchInput = el('input', {
    type: 'text',
    placeholder: searchScope === 'all' ? '搜索名称/类型/路径...' :
      searchScope === 'name' ? '搜索名称...' :
        searchScope === 'type' ? '搜索类型...' : '搜索路径...',
    value: searchKeyword,
    style: {
      flex: '1',
      minWidth: '120px',
      maxWidth: '220px',
      padding: '5px 10px',
      fontSize: '13px',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      outline: 'none',
      background: 'var(--bg-1)',
      color: 'var(--text-1)',
    },
    onInput: (e) => {
      searchKeyword = e.target.value;
      renderRecycle();
      const input = document.querySelector('#view input[type="text"]');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    },
    onKeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToFirstMatch();
      }
    },
  });
  toolbar.appendChild(searchInput);

  // 清空按钮
  if (searchKeyword) {
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost',
      text: '✕',
      style: { padding: '4px 8px', flexShrink: 0 },
      onClick: () => {
        searchKeyword = '';
        renderRecycle();
      },
    }));
  }

  // 统计文字
  toolbar.appendChild(el('div', {
    style: { fontSize: '12px', color: 'var(--text-2)', flex: '1', minWidth: '0', textAlign: 'right' },
    text: multiMode
      ? `已选 ${selected.size} / ${filtered.length} 项`
      : (keyword ? `找到 ${filtered.length} / ${bin.length} 项` : `共 ${bin.length} 项`)
  }));

  // 批量模式按钮
  if (multiMode) {
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '全选',
      onClick: () => { filtered.forEach(i => selected.add(i.id)); renderRecycle(); },
    }));
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '非全选',
      onClick: () => { selected.clear(); renderRecycle(); },
    }));
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-primary', text: '批量恢复',
      onClick: () => {
        if (selected.size === 0) { alert('请先勾选'); return; }
        selected.forEach(id => store.restoreRecycle(id));
        toastSuccess(`已恢复 ${selected.size} 项`);
        selected.clear();
        multiMode = false;
        renderRecycle();
      },
    }));
    toolbar.appendChild(el('button', {
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
    }));
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '完成',
      onClick: () => { multiMode = false; selected.clear(); renderRecycle(); },
    }));
  } else {
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '☑ 批量',
      onClick: () => { multiMode = true; renderRecycle(); },
    }));
  }

  view.appendChild(toolbar);

  // ===== 无搜索结果 =====
  if (filtered.length === 0) {
    view.appendChild(el('div', { class: 'empty', style: { padding: '30px 0' } }, [
      el('div', { class: 'empty-icon', text: '🔍' }),
      el('div', { text: `没有匹配"${searchKeyword}"的内容` }),
    ]));
    return;
  }

  // ===== 分组渲染 =====
  const groups = { task: [], chapter: [], point: [], image: [], composite: [], attachment: [] };
  filtered.forEach(i => { (groups[i.type] || (groups[i.type] = [])).push(i); });

  for (const [type, items] of Object.entries(groups)) {
    if (!items || items.length === 0) continue;
    view.appendChild(el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-2)', margin: '6px 0 3px' }, text: (TYPE_LABEL[type] || type) + `（${items.length}）` }));
    items.forEach(item => view.appendChild(recycleCard(item)));
  }

  view.appendChild(el('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } }, [
    el('button', {
      class: 'btn btn-danger', text: '清空回收站', style: { flex: '1' },
      onClick: async () => {
        if (await confirmBox({ title: '清空回收站', message: '所有内容将永久删除，无法恢复', danger: true, confirmText: '清空' })) {
          store.emptyRecycle();
          toastSuccess('已清空');
          multiMode = false;
          selected.clear();
          searchKeyword = '';
          renderRecycle();
        }
      },
    }),
  ]));
}

// ===== 跳转到第一个匹配项 =====
function jumpToFirstMatch() {
  const keyword = searchKeyword.trim().toLowerCase();
  if (!keyword) return;

  // 找到第一个匹配的卡片 DOM
  const cards = document.querySelectorAll('#view .card[data-item-id]');
  for (const card of cards) {
    const title = (card.querySelector('.card-title')?.textContent || '').toLowerCase();
    const path = (card.querySelector('.card-path')?.textContent || '').toLowerCase();
    const typeText = (card.getAttribute('data-type') || '').toLowerCase();

    let match = false;
    switch (searchScope) {
      case 'name': match = title.includes(keyword); break;
      case 'type': match = typeText.includes(keyword); break;
      case 'path': match = path.includes(keyword); break;
      default: match = title.includes(keyword) || typeText.includes(keyword) || path.includes(keyword);
    }

    if (match) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 高亮闪烁
      card.style.transition = 'background 0.3s';
      card.style.background = 'rgba(255, 200, 0, 0.3)';
      setTimeout(() => { card.style.background = ''; }, 1200);
      break;
    }
  }
}

function recycleCard(item) {
  const p = item.payload || {};

  let title = '';
  let pathInfo = '';
  let icon = '📄';

  if (item.type === 'image' || item.type === 'composite') {
    title = item.type === 'image' ? '图片文件' : '合成图片';
    icon = '🖼️';
    const pointName = (p.pointName || '未知卡片').replace(/<[^>]+>/g, '').slice(0, 30);
    const folderName = p.folderName ? p.folderName.replace(/<[^>]+>/g, '').slice(0, 20) : '';
    pathInfo = folderName ? `📂 ${folderName} › 📄 ${pointName}` : `📄 所属卡片：${pointName}`;
  } else if (item.type === 'attachment') {
    title = (p.attachment && (p.attachment.name || p.attachment.path)) || '未知附件';
    icon = '📎';
    const entityName = p.entityName ? p.entityName.replace(/<[^>]+>/g, '').slice(0, 30) : '';
    const folderName = p.folderName ? p.folderName.replace(/<[^>]+>/g, '').slice(0, 20) : '';
    pathInfo = folderName ? `📂 ${folderName} › 📎 ${entityName}` : (entityName ? `📄 所属卡片：${entityName}` : '');
  } else {
    title = p.name || p.content || p.id || '未知项目';
    icon = item.type === 'chapter' ? '📁' : (item.type === 'task' ? '✅' : '📄');
  }

  const remain = Math.max(0, 30 - daysBetween(item.deletedAt, new Date().toISOString()));

  return el('div', {
    class: 'card' + (selected.has(item.id) ? ' selected' : ''),
    'data-item-id': item.id,
    'data-type': TYPE_LABEL[item.type] || item.type,
    style: {
      cursor: 'default',
      display: 'flex',
      alignItems: 'center',
      padding: '6px 10px',
      gap: '8px',
      transition: 'background 0.2s'
    }
  }, [
    multiMode ? el('div', { class: 'select-box', style: { flexShrink: 0 } }, [
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

    el('div', {
      style: { fontSize: '20px', width: '28px', textAlign: 'center', flexShrink: 0 },
      text: icon
    }),

    el('div', { style: { flex: 1, minWidth: 0 } }, [
      el('div', {
        class: 'card-title',
        text: title,
        style: {
          fontSize: '14px', fontWeight: '600', color: 'var(--text-1)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0
        }
      }),
      pathInfo ? el('div', {
        class: 'card-path',
        text: pathInfo,
        style: {
          fontSize: '12px', color: 'var(--text-2)', marginTop: '1px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }
      }) : null,
      el('div', {
        class: 'card-meta',
        style: {
          display: 'flex', gap: '10px', alignItems: 'center', marginTop: '1px',
          fontSize: '12px', color: 'var(--text-3)'
        }
      }, [
        el('span', {
          text: `删除于 ${(() => {
            const d = new Date(item.deletedAt);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${y}-${m}-${day} ${h}:${min}`;
          })()}`
        }),
        el('span', {
          text: `剩余 ${remain} 天`,
          style: remain <= 3 ? { color: 'var(--danger)', fontWeight: '600' } : {}
        }),
      ]),
    ]),

    !multiMode ? el('div', {
      class: 'card-actions',
      style: { display: 'flex', gap: '6px', flexShrink: 0, marginLeft: '4px' }
    }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '恢复',
        onClick: () => {
          try {
            const success = store.restoreRecycle(item.id);
            if (success) {
              toastSuccess('已恢复');
              renderRecycle();
            } else {
              alert('底层恢复失败：找不到此项目或数据已损坏');
            }
          } catch (err) {
            console.error("恢复过程中发生错误:", err);
            alert("恢复报错：" + err.message);
          }
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