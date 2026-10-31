import { el } from '../utils/dom.js';

export function mergeModal({ title, items, targetId, onConfirm }) {
  return new Promise(resolve => {
    const sourceItems = items.filter(i => i.id !== targetId);
    const checked = new Set(sourceItems.map(i => i.id));
    let dedupe = false;

    const list = el('div', { style: { maxHeight: '200px', overflowY: 'auto', margin: '12px 0' } },
      sourceItems.map(item => el('label', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', cursor: 'pointer' },
      }, [
        el('input', {
          type: 'checkbox', checked: true,
          onChange: (e) => {
            if (e.target.checked) checked.add(item.id);
            else checked.delete(item.id);
          },
        }),
        el('span', { text: item.name || item.content }),
      ]))
    );

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '480px' } }, [
        el('h3', { text: title }),
        el('p', { text: '选择要合并的项，合并后源项进入回收站（7 天内可恢复）' }),
        list,
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer' } }, [
          el('input', { type: 'checkbox', onChange: (e) => { dedupe = e.target.checked; } }),
          el('span', { text: '去重同名项' }),
        ]),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(false); } }),
          el('button', {
            class: 'btn btn-primary', text: '合并',
            onClick: () => {
              if (checked.size === 0) { alert('至少选择一项'); return; }
              mask.remove();
              onConfirm([...checked], dedupe);
              resolve(true);
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  });
}