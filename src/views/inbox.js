import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';

export function renderInbox() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '速记收件箱';
  document.getElementById('btn-back').classList.remove('hidden');

  // 👇 新增：多选状态
  let isMulti = false;
  let selected = new Set();

  // 渲染列表的函数
  function renderList() {
    view.innerHTML = '';
    
    const items = store.getInbox ? store.getInbox() : [];
    
    if (items.length === 0) {
      view.appendChild(el('div', { class: 'empty', text: '收件箱空空的~' }));
      return;
    }

    // 👇 顶部操作栏
    const topBar = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', padding: '0 16px' } }, [
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('button', {
          class: 'btn btn-sm ' + (isMulti ? 'btn-danger' : 'btn-ghost'),
          text: isMulti ? '✕ 取消' : '☑ 多选',
          onClick: () => { isMulti = !isMulti; selected.clear(); renderList(); }
        }),
        isMulti ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '全选',
          onClick: () => { items.forEach(i => selected.add(i.id)); renderList(); }
        }) : null,
        isMulti ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '全不选',
          onClick: () => { selected.clear(); renderList(); }
        }) : null
      ]),
      // 👇 批量操作按钮
      isMulti && selected.size > 0 ? el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('button', {
          class: 'btn btn-sm btn-primary', text: `🗑 删除 (${selected.size})`,
          onClick: async () => {
            if (!confirm(`确定删除选中的 ${selected.size} 条速记吗？`)) return;
            const currentItems = items.filter(i => !selected.has(i.id));
            localStorage.setItem('kg_inbox', JSON.stringify(currentItems));
            toastSuccess('已删除');
            isMulti = false; selected.clear(); renderList();
          }
        })
      ]) : null
    ]);
    view.appendChild(topBar);

    // 👇 列表渲染
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 16px' } });
    
    items.forEach(item => {
      const isSelected = selected.has(item.id);
      
      const card = el('div', {
        style: { padding: '12px', background: isSelected ? 'rgba(142,202,230,0.15)' : 'var(--card)', borderRadius: '8px', border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(0,0,0,.05)', display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', transition: 'all 0.2s' },
        onClick: () => {
          if (isMulti) {
            if (isSelected) selected.delete(item.id); else selected.add(item.id);
            renderList();
          } else {
            // 原来的单个操作：去归类
            openClassifyModal(item, renderList);
          }
        }
      }, [
        // 多选框
        isMulti ? el('input', { type: 'checkbox', checked: isSelected, style: { marginTop: '4px' }, onClick: (e) => e.stopPropagation(), onChange: (e) => {
          if (e.target.checked) selected.add(item.id); else selected.delete(item.id);
          renderList();
        }}) : null,
        
        // 内容区
        el('div', { style: { flex: '1' } }, [
          el('div', { style: { fontSize: '14px', whiteSpace: 'pre-wrap', lineHeight: '1.5' }, text: item.content }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '8px' }, text: new Date(item.createdAt).toLocaleString() })
        ]),
        
        // 非多选模式下的删除按钮
        !isMulti ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '🗑', style: { color: 'var(--danger)' },
          onClick: (e) => {
            e.stopPropagation();
            if (!confirm('删除这条速记？')) return;
            const currentItems = items.filter(i => i.id !== item.id);
            localStorage.setItem('kg_inbox', JSON.stringify(currentItems));
            renderList();
          }
        }) : null
      ]);
      list.appendChild(card);
    });

    view.appendChild(list);
    
    // 底部留白
    view.appendChild(el('div', { style: { height: '80px' } }));
  }

  renderList();
}