import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { putImageCached } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export function pdfImportModal(pointId) {
    return new Promise(resolve => {
        const fileInput = el('input', {
            type: 'file',
            accept: 'application/pdf',
            style: { display: 'none' },
            onChange: async (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(false); return; }
                try {
                    await processPdf(file, pointId, resolve);
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

async function processPdf(file, pointId, resolve) {
    if (!window.pdfjsLib) {
        toastError('PDF.js 未加载，请检查网络');
        resolve(false);
        return;
    }
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    showPagePicker(pdf, pointId, resolve);
}

function showPagePicker(pdf, pointId, resolve) {
    const selected = new Set();
    const pages = el('div', { class: 'pdf-pages-grid' });
    const countLabel = el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '已选 0 页' });

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '720px', maxHeight: '90vh', overflow: 'auto' } }, [
            el('h3', { text: `选择页面（共 ${pdf.numPages} 页）` }),
            el('div', { style: { display: 'flex', gap: '8px', margin: '8px 0', alignItems: 'center', flexWrap: 'wrap' } }, [
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全选',
                    onClick: () => {
                        for (let i = 1; i <= pdf.numPages; i++) selected.add(i);
                        countLabel.textContent = `已选 ${selected.size} 页`;
                        pages.querySelectorAll('.pdf-page-thumb').forEach(t => t.style.borderColor = 'var(--primary)');
                    },
                }),
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全不选',
                    onClick: () => {
                        selected.clear();
                        countLabel.textContent = '已选 0 页';
                        pages.querySelectorAll('.pdf-page-thumb').forEach(t => t.style.borderColor = 'transparent');
                    },
                }),
                countLabel,
            ]),
            pages,
            el('div', { class: 'confirm-actions', style: { marginTop: '12px' } }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(false); } }),
                el('button', {
                    class: 'btn btn-primary', text: '导入选中页',
                    onClick: async () => {
                        if (selected.size === 0) { alert('请至少选择一页'); return; }
                        const pageNums = [...selected].sort((a, b) => a - b);
                        mask.remove();
                        let lastImageId = null;
                        let successCount = 0;
                        for (const n of pageNums) {
                            try {
                                const page = await pdf.getPage(n);
                                const imgId = await renderPageToImage(page, n, pointId);
                                if (imgId) { lastImageId = imgId; successCount++; }
                            } catch (err) {
                                console.error(`第 ${n} 页导入失败`, err);
                                toastError(`第 ${n} 页导入失败`);
                            }
                        }
                        if (successCount > 0) {
                            toastSuccess(`已导入 ${successCount} 页`);
                            if (lastImageId) navigate(`#/annotate/${lastImageId}?pointId=${pointId}`);
                            else {
                                const p = store.getPoint(pointId);
                                if (p) navigate(`#/chapter/${p.chapterId}`);
                            }
                        } else toastError('没有成功导入任何页');
                        resolve(true);
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);

    (async () => {
        const maxPreview = Math.min(pdf.numPages, 60);
        for (let i = 1; i <= maxPreview; i++) {
            try {
                const page = await pdf.getPage(i);
                const vp = page.getViewport({ scale: 0.4 });
                const c = document.createElement('canvas');
                c.width = vp.width; c.height = vp.height;
                await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                const thumb = el('div', {
                    class: 'pdf-page-thumb',
                    onClick: () => {
                        if (selected.has(i)) { selected.delete(i); thumb.style.borderColor = 'transparent'; }
                        else { selected.add(i); thumb.style.borderColor = 'var(--primary)'; }
                        countLabel.textContent = `已选 ${selected.size} 页`;
                    },
                }, [
                    el('img', { src: c.toDataURL() }),
                    el('div', { class: 'pdf-page-label', text: `第 ${i} 页` }),
                ]);
                pages.appendChild(thumb);
            } catch (err) {
                console.warn(`第 ${i} 页缩略图生成失败`, err);
            }
        }
        if (pdf.numPages > maxPreview) {
            pages.appendChild(el('div', {
                style: { gridColumn: '1 / -1', textAlign: 'center', fontSize: '12px', color: 'var(--text-2)', padding: '8px' },
                text: `仅显示前 ${maxPreview} 页（共 ${pdf.numPages} 页）`,
            }));
        }
    })();
}

async function renderPageToImage(page, pageNum, pointId) {
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const imageId = uuid();
    await putImageCached({
        id: imageId, type: 'original',
        originalBlob: blob, annotatedBlob: blob,
        width: c.width, height: c.height, dpr: 2,
        createdAt: new Date().toISOString(),
    });
    store.addImageToPoint(pointId, imageId);
    return imageId;
}