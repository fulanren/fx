import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

export function batchImportModal(chapterId) {
    const textarea = el('textarea', {
        placeholder: '每行一个知识点，或用空行分隔\n\n例如：\n宪法是国家的根本法\n全国人民代表大会是最高权力机关\n\n行政许可是指行政机关……',
        style: { width: '100%', minHeight: '200px', padding: '12px', fontSize: '14px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px', fontFamily: 'inherit' },
    });

    const modeSelect = el('select', { style: { width: '100%', padding: '8px', borderRadius: '8px', marginBottom: '12px' } }, [
        el('option', { value: 'line', text: '按行拆分（每行一个知识点）' }),
        el('option', { value: 'blank', text: '按空行拆分（适合长文本）' }),
    ]);

    const preview = el('div', { style: { fontSize: '13px', color: 'var(--text-2)', padding: '8px', background: 'var(--bg)', borderRadius: '8px', marginBottom: '12px' } });

    function updatePreview() {
        const items = splitText();
        preview.textContent = `将生成 ${items.length} 个知识点`;
    }

    function splitText() {
        const t = textarea.value;
        if (modeSelect.value === 'line') return t.split('\n').map(s => s.trim()).filter(Boolean);
        return t.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    }

    textarea.addEventListener('input', updatePreview);
    modeSelect.addEventListener('change', updatePreview);

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '600px', maxHeight: '90vh', overflow: 'auto' } }, [
            el('h3', { text: '批量导入知识点' }),
            el('p', { text: '粘贴文本，自动拆分成多个知识点', style: { fontSize: '13px', color: 'var(--text-2)' } }),
            el('div', { class: 'field' }, [
                el('label', { text: '拆分方式' }),
                modeSelect,
            ]),
            textarea,
            preview,
            el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                el('button', {
                    class: 'btn btn-primary', text: '导入',
                    onClick: async () => {
                        const items = splitText();
                        if (items.length === 0) { toastError('没有可导入的内容'); return; }
                        if (!await confirmBox({ title: '确认导入', message: `将创建 ${items.length} 个知识点`, confirmText: '导入' })) return;
                        mask.remove();
                        for (const content of items) {
                            store.createPoint({ chapterId, content, explanation: '' });
                        }
                        toastSuccess(`已导入 ${items.length} 个知识点`);
                        navigate(`#/chapter/${chapterId}`);
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);
    updatePreview();
}