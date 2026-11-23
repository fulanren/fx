import { el } from '../utils/dom.js';

export function mergeModal({ title, items, targetId, onConfirm }) {
  return new Promise(resolve => {
    const sourceItems = items.filter(i => i.id !== targetId);
    const checked = new Set(sourceItems.map(i => i.id));

    let saveMode = 'overwrite'; // 'overwrite' 覆盖 | 'saveAs' 另存
    let mergeMode = 'concat';   // 'concat' 拼接 | 'link' 关联
    let dedupe = false;
    let sortMode = 'keep';

    const targetItem = items.find(i => i.id === targetId);
    const targetPlainName = (targetItem?.content || '').replace(/<[^>]+>/g, '');

    // 1. 名称输入
    const nameInput = el('input', {
      type: 'text',
      value: targetItem?.name || targetPlainName || '',
      style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '14px' },
    });

    // 2. 待合并列表
    const list = el('div', { style: { maxHeight: '150px', overflowY: 'auto', margin: '8px 0', display: 'flex', flexDirection: 'column', gap: '6px' } },
      sourceItems.map(item => el('label', {
        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer' },
      }, [
        el('input', {
          type: 'checkbox', checked: true,
          style: { width: '16px', height: '16px', accentColor: 'var(--primary)' },
          onChange: (e) => {
            if (e.target.checked) checked.add(item.id);
            else checked.delete(item.id);
            updatePreview();
          },
        }),
        el('span', {
          text: (item.name || item.content || '').replace(/<[^>]+>/g, ''),
          style: { flex: '1', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
        }),
      ]))
    );

    // 3. 可编辑的预览/解释区
    const editablePreview = el('textarea', {
      style: {
        width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)',
        fontSize: '14px', lineHeight: '1.6', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical'
      }
    });

    // 4. 模式选择 (这里把卡片包成 label，彻底解决按钮打架的问题)
    const modeSelectBox = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0' } });

    const renderModeOptions = () => {
      modeSelectBox.innerHTML = '';

      // 拼接方案
      modeSelectBox.appendChild(el('label', {
        style: {
          display: 'flex', flexDirection: 'column', padding: '10px 12px',
          background: mergeMode === 'concat' ? 'rgba(142,202,230,.15)' : 'var(--bg)',
          border: `1px solid ${mergeMode === 'concat' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`,
          borderRadius: '8px', cursor: 'pointer'
        },
        onClick: () => { mergeMode = 'concat'; renderModeOptions(); updatePreview(); }
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '14px' } }, [
          el('input', { type: 'radio', checked: mergeMode === 'concat', readOnly: true, style: { width: '16px', height: '16px', accentColor: 'var(--primary)', margin: 0 } }),
          el('span', { text: '内容拼接（字段合并）', style: { color: mergeMode === 'concat' ? 'var(--primary-dark)' : 'var(--text)' } })
        ]),
        el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px', paddingLeft: '24px' }, text: '将所有选中卡片的正文合并成一张长卡片。' })
      ]));

      // 关联方案
      modeSelectBox.appendChild(el('label', {
        style: {
          display: 'flex', flexDirection: 'column', padding: '10px 12px',
          background: mergeMode === 'link' ? 'rgba(142,202,230,.15)' : 'var(--bg)',
          border: `1px solid ${mergeMode === 'link' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`,
          borderRadius: '8px', cursor: 'pointer', marginTop: '6px'
        },
        onClick: () => { mergeMode = 'link'; renderModeOptions(); updatePreview(); }
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '14px' } }, [
          el('input', { type: 'radio', checked: mergeMode === 'link', readOnly: true, style: { width: '16px', height: '16px', accentColor: 'var(--primary)', margin: 0 } }),
          el('span', { text: '关联连接（不合并内容）', style: { color: mergeMode === 'link' ? 'var(--primary-dark)' : 'var(--text)' } })
        ]),
        el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px', paddingLeft: '24px' }, text: '原卡片保留，主卡片底部会自动生成指向它们的双向跳转链接。' })
      ]));
    };
    renderModeOptions();

        // 5. 处理方式选择 (覆盖 / 另存)
    const saveModeBox = el('div', { style: { display: 'flex', gap: '10px', margin: '8px 0' } });
    const renderSaveOptions = () => {
      saveModeBox.innerHTML = '';

      // 👇 核心修复：减小内边距，防止换行，字体缩小
      const getOptionStyle = (isSelected) => ({
        flex: '1', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: '6px', 
        padding: '8px 10px', // 从 12px 减到了 8px
        background: isSelected ? 'rgba(142,202,230,.15)' : 'var(--bg)', 
        border: `1px solid ${isSelected ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, 
        borderRadius: '8px', 
        cursor: 'pointer', 
        fontSize: '13px',
        whiteSpace: 'nowrap', // 强制不换行
        transition: 'all 0.2s'
      });

      saveModeBox.appendChild(el('label', {
        style: getOptionStyle(saveMode === 'overwrite'),
        onClick: () => { saveMode = 'overwrite'; renderSaveOptions(); }
      }, [
        el('input', { type: 'radio', checked: saveMode === 'overwrite', readOnly: true, style: { margin: 0, width: '14px', height: '14px' } }),
        el('span', { text: '覆盖原卡片', style: { color: saveMode === 'overwrite' ? 'var(--primary-dark)' : 'var(--text)' } })
      ]));

      saveModeBox.appendChild(el('label', {
        style: getOptionStyle(saveMode === 'saveAs'),
        onClick: () => { saveMode = 'saveAs'; renderSaveOptions(); }
      }, [
        el('input', { type: 'radio', checked: saveMode === 'saveAs', readOnly: true, style: { margin: 0, width: '14px', height: '14px' } }),
        el('span', { text: '另存为新卡片', style: { color: saveMode === 'saveAs' ? 'var(--primary-dark)' : 'var(--text)' } })
      ]));
    };
    renderSaveOptions();

    // 核心联动函数：根据模式刷新预览
    function updatePreview() {
      if (mergeMode === 'concat') {
        const selectedItems = items.filter(i => checked.has(i.id) || i.id === targetId);
        // 将 HTML 转成纯文本进行拼接展示
        const mergedText = selectedItems.map(i => (i.content || i.name || '').replace(/<[^>]+>/g, '')).join('\n\n---\n\n');
        editablePreview.value = mergedText;
        editablePreview.disabled = false;
        editablePreview.style.opacity = '1';
      } else {
        editablePreview.value = '（关联模式下不合并内容，原卡片会被保留。合并后主卡片会生成链接列表。）';
        editablePreview.disabled = true;
        editablePreview.style.opacity = '0.6';
      }
    }
    updatePreview();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto' } }, [
        el('h3', { text: title }),

        // 处理方式
        el('div', { class: 'field' }, [
          el('label', { text: '合并后的处理方式' }),
          saveModeBox
        ]),

        // 名称
        el('div', { class: 'field' }, [
          el('label', { text: '合并后名称 (保留在卡片标题)' }),
          nameInput,
        ]),

        // 待合并项
        el('div', { class: 'field' }, [
          el('label', { text: '选择要合并的卡片' }),
          list,
        ]),

        // 合并方式
        el('div', { class: 'field' }, [
          el('label', { text: '合并方式' }),
          modeSelectBox,
        ]),

        // 合并后内容/解释
        el('div', { class: 'field' }, [
          el('label', { text: '合并后文字解释 (可手动编辑修改)' }),
          editablePreview,
        ]),

        el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(false); } }),
          el('button', {
            class: 'btn btn-primary', text: '确认合并',
            onClick: () => {
              if (checked.size === 0) { alert('至少选择一项'); return; }

              let finalName = nameInput.value.trim();
              if (!finalName) finalName = '未命名合并卡片';

              // 如果选了另存且没改名，自动加后缀防重
              if (saveMode === 'saveAs' && finalName === targetPlainName) {
                finalName = finalName + ' (合并副本)';
              }

              // 如果选的是拼接模式，使用用户编辑后的富文本内容；否则保留原始
              const finalExplanation = mergeMode === 'concat' ? editablePreview.value : (targetItem?.explanation || '');

              mask.remove();
              // 把 finalExplanation (用户在界面上编辑后的内容) 传给底层
              onConfirm([...checked], dedupe, finalName, sortMode, mergeMode, saveMode, finalExplanation);
              resolve(true);
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  });
}