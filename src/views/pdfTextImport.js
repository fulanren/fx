import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

export function pdfTextImportModal(chapterId) {
    return new Promise(resolve => {
        const fileInput = el('input', {
            type: 'file',
            accept: 'application/pdf',
            style: { display: 'none' },
            onChange: async (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(false); return; }
                try {
                    await processPdf(file, chapterId, resolve);
                } catch (err) {
                    toastError('PDF 解析失败：' + err.message);
                    resolve(false);
                }
            },
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 60000);
    });
}

async function processPdf(file, chapterId, resolve) {
    if (!window.pdfjsLib) {
        toastError('PDF.js 未加载，请检查网络');
        resolve(false);
        return;
    }
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

    // 提取全文
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join('');
        fullText += pageText + '\n\n';
    }

    if (!fullText.trim()) {
        toastError('PDF 里没有可提取的文字，可能是扫描版，请用 OCR');
        resolve(false);
        return;
    }

    showTextEditor(fullText, chapterId, resolve);
}

function showTextEditor(text, chapterId, resolve) {
    const textarea = el('textarea', {
        value: text,
        style: { width: '100%', minHeight: '300px', padding: '12px', fontSize: '14px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px', fontFamily: 'inherit' },
    });

    const previewList = el('div', { style: { maxHeight: '200px', overflowY: 'auto', margin: '12px 0', padding: '8px', background: 'var(--bg)', borderRadius: '8px', fontSize: '13px' } });

    let splitMode = 'blank';

    const modeSelect = el('select', {
        onChange: (e) => { splitMode = e.target.value; updatePreview(); },
    }, [
        el('option', { value: 'blank', text: '按空行拆分' }),
        el('option', { value: 'line', text: '按行拆分' }),
        el('option', { value: 'heading', text: '按「### 知识点」标题拆分' }),
    ]);

    function splitText() {
        const t = textarea.value;
        if (splitMode === 'blank') {
            return t.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
        } else if (splitMode === 'line') {
            return t.split('\n').map(s => s.trim()).filter(Boolean);
        } else {
            const parts = t.split(/###\s*知识点[：:]\s*/);
            return parts.map(s => s.trim()).filter(Boolean);
        }
    }

    function updatePreview() {
        const items = splitText();
        previewList.innerHTML = '';
        previewList.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '8px' }, text: `将生成 ${items.length} 个知识点：` }));
        items.slice(0, 20).forEach((item, i) => {
            previewList.appendChild(el('div', { style: { padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,.06)' }, text: `${i + 1}. ${item.slice(0, 60)}${item.length > 60 ? '…' : ''}` }));
        });
        if (items.length > 20) {
            previewList.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' }, text: `…还有 ${items.length - 20} 个` }));
        }
    }

    textarea.addEventListener('input', updatePreview);

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '700px', maxHeight: '90vh', overflow: 'auto' } }, [
            el('h3', { text: 'PDF 提取文字' }),
            el('p', { text: '编辑文字，选择拆分方式，预览后生成知识点', style: { fontSize: '13px', color: 'var(--text-2)' } }),
            el('div', { class: 'field' }, [
                el('label', { text: '拆分方式' }),
                modeSelect,
            ]),
            textarea,
            previewList,
            el('div', { class: 'confirm-actions', style: { flexWrap: 'wrap' } }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(false); } }),
                el('button', {
                    class: 'btn btn-primary', text: '生成知识点',
                    onClick: async () => {
                        const items = splitText();
                        if (items.length === 0) { toastError('没有可生成的内容'); return; }
                        if (!await confirmBox({ title: '确认生成', message: `将生成 ${items.length} 个知识点到当前章节，是否继续？`, confirmText: '生成' })) return;
                        mask.remove();
                        for (const item of items) {
                            store.createPoint({ chapterId, content: item, explanation: '' });
                        }
                        toastSuccess(`已生成 ${items.length} 个知识点`);
                        const ch = store.getChapter(chapterId);
                        if (ch) navigate(`#/chapter/${chapterId}`);
                        resolve(true);
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);
    updatePreview();
}