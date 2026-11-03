import { el } from '../utils/dom.js';

export function mergeModal({ title, items, targetId, onConfirm }) {
  return new Promise(resolve => {
    const sourceItems = items.filter(i => i.id !== targetId);
    const checked = new Set(sourceItems.map(i => i.id));
    let dedupe = false;
    let mergeMode = 'concat';
    let sortMode = 'keep';

    const list = el('div', { style: { maxHeight: '160px', overflowY: 'auto', margin: '12px 0' } },
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

    const targetItem = items.find(i => i.id === targetId);
    const nameInput = el('input', {
      type: 'text',
      id: 'merge-target-name',
      value: targetItem?.name || targetItem?.content || '',
      style: { width: '100%' },
    });

    const modeSelect = el('select', {
      id: 'merge-mode',
      onChange: (e) => {
        mergeMode = e.target.value;
        updatePreview();
      },
    }, [
      el('option', { value: 'concat', text: '方案 A：内容拼接（字段合并）' }),
      el('option', { value: 'link', text: '方案 B：关联链接（不合并内容）' }),
    ]);

    const sortSelect = el('select', {
      id: 'merge-sort',
      onChange: (e) => { sortMode = e.target.value; },
    }, [
      el('option', { value: 'keep', text: '保持原顺序' }),
      el('option', { value: 'name-asc', text: '名称升序' }),
      el('option', { value: 'name-desc', text: '名称降序' }),
      el('option', { value: 'date-asc', text: '创建时间升序' }),
      el('option', { value: 'date-desc', text: '创建时间降序' }),
    ]);

    const previewBox = el('div', {
      id: 'merge-preview',
      style: { fontSize: '12px', color: 'var(--text-2)', background: 'var(--bg)', padding: '8px', borderRadius: '6px', maxHeight: '100px', overflowY: 'auto', marginBottom: '12px', whiteSpace: 'pre-wrap' },
    });

    function updatePreview() {
      if (mergeMode === 'concat') {
        const selectedItems = items.filter(i => checked.has(i.id) || i.id === targetId);
        const merged = selectedItems.map(i => i.content || i.name || '').join('\n\n---\n\n');
        previewBox.textContent = '合并后内容预览：\n' + merged.slice(0, 200) + (merged.length > 200 ? '…' : '');
      } else {
        previewBox.textContent = '关联链接：主知识点会列出其他知识点，点击跳转，不合并内容。';
      }
    }
    updatePreview();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '520px' } }, [
        el('h3', { text: title }),
        el('p', { text: '合并后源项进入回收站，7 天内可撤销', style: { fontSize: '12px', color: 'var(--text-2)' } }),
        el('div', { class: 'field' }, [
          el('label', { text: '合并后名称' }),
          nameInput,
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '合并方式' }),
          modeSelect,
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '排序方式' }),
          sortSelect,
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '选择要合并的项' }),
          list,
        ]),
        previewBox,
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' } }, [
          el('input', { type: 'checkbox', onChange: (e) => { dedupe = e.target.checked; } }),
          el('span', { text: '去重同名项' }),
        ]),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(false); } }),
          el('button', {
            class: 'btn btn-primary', text: '确认合并',
            onClick: () => {
              if (checked.size === 0) { alert('至少选择一项'); return; }
              const newName = nameInput.value.trim();
              mask.remove();
              onConfirm([...checked], dedupe, newName, sortMode, mergeMode);
              resolve(true);
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  });
}