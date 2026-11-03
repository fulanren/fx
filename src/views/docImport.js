import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

/**
 * 统一文档导入入口
 * 支持 .docx / .txt / .pdf（文字版 / 扫描版）
 * @param {string} chapterId 目标章节 id
 */
export function docImportModal(chapterId) {
    return new Promise(resolve => {
        const fileInput = el('input', {
            type: 'file',
            accept: '.docx,.doc,.pdf,.txt',
            style: { display: 'none' },
            onChange: async (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(false); return; }
                try {
                    const ext = file.name.split('.').pop().toLowerCase();
                    let text = '';

                    if (ext === 'docx') {
                        text = await parseDocx(file);
                    } else if (ext === 'txt') {
                        text = await file.text();
                    } else if (ext === 'pdf') {
                        // 先尝试提取文字版
                        const result = await parsePdfAuto(file);
                        text = result.text;
                        if (result.isScanned) {
                            // 扫描版，走 OCR
                            toastSuccess(`检测到扫描版 PDF，开始 OCR 识别（共 ${result.pageCount} 页）…`);
                            text = await ocrPdf(file, result.pageCount);
                        }
                    } else if (ext === 'doc') {
                        toastError('旧版 .doc 不支持，请用 Word 另存为 .docx 后再导入');
                        resolve(false);
                        return;
                    } else {
                        toastError('不支持的文件类型：' + ext);
                        resolve(false);
                        return;
                    }

                    if (!text.trim()) { toastError('文件里没有可提取的文字'); resolve(false); return; }
                    showTextEditor(text, chapterId, resolve);
                } catch (err) {
                    toastError('解析失败：' + err.message);
                    resolve(false);
                }
            },
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 60000);
    });
}

/** 解析 DOCX，用 mammoth.js */
async function parseDocx(file) {
    if (!window.mammoth) throw new Error('mammoth.js 未加载，请检查网络');
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return result.value || '';
}

/** 自动判断 PDF 是文字版还是扫描版 */
async function parsePdfAuto(file) {
    if (!window.pdfjsLib) throw new Error('PDF.js 未加载');
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const pageCount = pdf.numPages;

    let fullText = '';
    let textPages = 0;

    // 先逐页提取文字，统计有文字的页数
    for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join('').trim();
        if (pageText.length > 20) textPages++;
        fullText += pageText + '\n\n';
    }

    // 如果超过 70% 的页有文字，认为是文字版
    const isScanned = textPages < pageCount * 0.7;
    return { text: fullText, isScanned, pageCount };
}

/** 扫描版 PDF 逐页 OCR，带进度条 */
async function ocrPdf(file, pageCount) {
    if (!window.Tesseract) {
        await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }
    if (!window.Tesseract) throw new Error('OCR 引擎加载失败');
    if (!window.pdfjsLib) throw new Error('PDF.js 未加载');

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

    // 进度条
    const progressContainer = el('div', {
        style: { position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', background: 'var(--card)', padding: '16px', borderRadius: '12px', boxShadow: 'var(--shadow-lg)', zIndex: '999', width: '80%', maxWidth: '400px' },
    }, [
        el('div', { style: { fontWeight: '600', marginBottom: '12px' }, text: '正在 OCR 识别…' }),
        el('div', { style: { height: '6px', background: 'rgba(0,0,0,.1)', borderRadius: '3px', overflow: 'hidden' } }, [
            el('div', { id: 'ocr-progress-fill', style: { height: '100%', width: '0%', background: 'var(--primary)', transition: 'width .2s' } }),
        ]),
        el('div', { id: 'ocr-progress-text', style: { fontSize: '12px', color: 'var(--text-2)', textAlign: 'center', marginTop: '8px' }, text: `0 / ${pageCount}` }),
    ]);
    document.body.appendChild(progressContainer);

    let fullText = '';
    for (let i = 1; i <= pageCount; i++) {
        try {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width;
            canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

            const result = await window.Tesseract.recognize(canvas, 'chi_sim');
            fullText += (result.data.text || '') + '\n\n';

            // 更新进度
            const pct = Math.round(i / pageCount * 100);
            const fill = document.getElementById('ocr-progress-fill');
            const text = document.getElementById('ocr-progress-text');
            if (fill) fill.style.width = pct + '%';
            if (text) text.textContent = `${i} / ${pageCount}（${pct}%）`;
        } catch (e) {
            console.warn(`第 ${i} 页 OCR 失败`, e);
        }
    }

    progressContainer.remove();
    return fullText;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

/** 文字编辑 + 拆分 + 生成知识点 */
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
        el('option', { value: 'chapter', text: '按「## 章节」标题拆分' }),
    ]);

    function splitText() {
        const t = textarea.value;
        if (splitMode === 'blank') return t.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
        if (splitMode === 'line') return t.split('\n').map(s => s.trim()).filter(Boolean);
        if (splitMode === 'heading') {
            const parts = t.split(/###\s*知识点[：:]\s*/);
            return parts.map(s => s.trim()).filter(Boolean);
        }
        if (splitMode === 'chapter') {
            const parts = t.split(/##\s*章节[：:]\s*/);
            return parts.map(s => s.trim()).filter(Boolean);
        }
        return [];
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
            el('h3', { text: '文档提取文字' }),
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
                        navigate(`#/chapter/${chapterId}`);
                        resolve(true);
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);
    updatePreview();
}