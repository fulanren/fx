
import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { dbPut, putImageCached } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { ensurePdfJs } from '../utils/deps.js';
import { buildQualityPicker } from '../utils/pdfQuality.js';

export async function pdfImportModal(pointId, options = {}) {
    const { skipPagePicker = false, wholeBook = false } = options;

    // 选文件
    const files = await choosePdfFiles();
    if (!files.length) return;

    // 如果跳过选页，直接整本导入
    if (skipPagePicker || wholeBook) {
        await importWholePdf(files, pointId);  // 你需要实现这个函数
        return;
    }

    // 否则走原来的选页流程
    const pages = await showPagePicker(files);
    await importSelectedPages(pages, pointId);
}

async function handleFile(file, pointId, resolve) {
    if (!window.pdfjsLib) { toastError('PDF.js 未加载'); resolve(false); return; }

    try {
        // 1. 存下整个 PDF 文件
        const pdfId = uuid();
        await dbPut('pdfs', {
            id: pdfId, blob: file, name: file.name, createdAt: new Date().toISOString()
        });

        // 2. 解析 PDF
        const buf = await file.arrayBuffer();
        if (!ensurePdfJs()) { toastError('PDF.js 未加载（缺少 vendor/pdfjs/）'); resolve(false); return; }
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

        // 3. 保存为附件占位图（让列表里能看到它）
        const fakeImageId = uuid();
        // 生成第一页封面
        let coverUrl = '';
        try {
            const page1 = await pdf.getPage(1);
            const vp = page1.getViewport({ scale: 0.4 });
            const c = document.createElement('canvas');
            c.width = vp.width; c.height = vp.height;
            await page1.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            coverUrl = c.toDataURL('image/jpeg', 0.8);
        } catch (e) { console.warn('生成封面失败', e); }

        await putImageCached({
            id: fakeImageId,
            type: 'pdf_placeholder',
            originalBlob: new Blob([], { type: 'text/plain' }),
            annotatedBlob: new Blob([], { type: 'text/plain' }),
            width: 0, height: 0, dpr: 1,
            pdfId: pdfId,
            pdfName: file.name,
            pdfPages: pdf.numPages,
            coverUrl: coverUrl, //存入封面数据
            createdAt: new Date().toISOString()
        });

        // 4. 写入知识点
        store.addImageToPoint(pointId, fakeImageId);

        // 5. 弹出选页框！
        showPagePicker(pdf, pointId, resolve);

    } catch (err) {
        console.error(err);
        toastError('PDF 解析失败');
        resolve(false);
    }
}

function showPagePicker(pdf, pointId) {
    const selected = new Set();

    // ===== 画质区：统一走 pdfQuality.js 的档位表（避免两处漂移）=====
    const picker = buildQualityPicker({ el, collapsed: true });
    const qualityBox = picker.box;

    // ===== 选页列表（列表形式，非网格）=====
    const countLabel = el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '已选 0 页' });
    const listBox = el('div', {
        style: { maxHeight: '46vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }
    });
    const syncCount = () => { countLabel.textContent = `已选 ${selected.size} 页`; };

    const buildRow = (n, thumbUrl) => {
        const checkbox = el('input', { type: 'checkbox', style: { width: '18px', height: '18px', cursor: 'pointer' } });
        const row = el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }
        });
        const thumb = el('div', {
            style: { width: '44px', height: '58px', border: '1px solid var(--border)', borderRadius: '4px', flexShrink: '0', backgroundSize: 'cover', backgroundPosition: 'center' }
        });
        if (thumbUrl) thumb.style.backgroundImage = `url(${thumbUrl})`;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selected.add(n); else selected.delete(n);
            row.style.background = checkbox.checked ? 'var(--primary-light, #e8f0fe)' : '';
            syncCount();
        });
        row.addEventListener('click', (e) => {
            if (e.target === checkbox) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });
        row.append(checkbox, thumb, el('div', { style: { flex: '1', fontSize: '14px' }, text: `第 ${n} 页` }));
        return row;
    };

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '560px', maxHeight: '90vh', overflow: 'auto' } }, [
            el('h3', { text: `选择页面（共 ${pdf.numPages} 页）` }),
            qualityBox,
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0' } }, [
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全选',
                    onClick: () => {
                        for (let i = 1; i <= pdf.numPages; i++) selected.add(i);
                        listBox.querySelectorAll('input[type=checkbox]').forEach(c => {
                            c.checked = true;
                            const r = c.closest('div');
                            if (r) r.style.background = 'var(--primary-light, #e8f0fe)';
                        });
                        syncCount();
                    },
                }),
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全不选',
                    onClick: () => {
                        selected.clear();
                        listBox.querySelectorAll('input[type=checkbox]').forEach(c => {
                            c.checked = false;
                            const r = c.closest('div');
                            if (r) r.style.background = '';
                        });
                        syncCount();
                    },
                }),
                countLabel,
            ]),
            listBox,
            el('div', { class: 'confirm-actions', style: { marginTop: '12px' } }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); history.back(); } }),
                el('button', {
                    class: 'btn btn-primary', text: '导入选中页',
                    onClick: async () => {
                        if (selected.size === 0) { alert('请至少选择一页'); return; }
                        const pageNums = [...selected].sort((a, b) => a - b);
                        const scale = picker.getScale();
                        mask.remove();
                        let ok = 0;
                        for (const n of pageNums) {
                            try {
                                const page = await pdf.getPage(n);
                                await renderPageToImage(page, n, pointId, scale);
                                ok++;
                            } catch (e) { console.error(`第 ${n} 页导入失败`, e); }
                        }
                        if (ok > 0) { toastSuccess(`已导入 ${ok} 页`); history.back(); }
                        else { toastError('没有成功导入任何页'); history.back(); }
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);

    // 异步生成缩略图填充列表
    (async () => {
        const max = Math.min(pdf.numPages, 200);
        for (let i = 1; i <= max; i++) {
            try {
                const page = await pdf.getPage(i);
                const vp = page.getViewport({ scale: 0.3 });
                const cv = document.createElement('canvas');
                cv.width = vp.width; cv.height = vp.height;
                await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
                listBox.appendChild(buildRow(i, cv.toDataURL('image/jpeg', 0.6)));
            } catch (e) {
                listBox.appendChild(buildRow(i, null));
            }
        }
        if (pdf.numPages > max) {
            listBox.appendChild(el('div', {
                style: { padding: '10px', fontSize: '12px', color: 'var(--text-2)', textAlign: 'center' },
                text: `仅显示前 ${max} 页预览，可用「全选」导入全部 ${pdf.numPages} 页`
            }));
        }
    })();
}

// 注意这里加了 scale 参数
async function renderPageToImage(page, pageNum, pointId, scale = 2) {
    const vp = page.getViewport({ scale: scale }); // 使用传入的比例
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

    // 如果是低画质，可以顺便转成 JPEG 压缩体积
    const mimeType = scale <= 1.0 ? 'image/jpeg' : 'image/png';
    const quality = scale <= 1.0 ? 0.85 : undefined;

    const blob = await new Promise(r => c.toBlob(r, mimeType, quality));
    const imageId = uuid();
    await putImageCached({
        id: imageId, type: 'original',
        originalBlob: blob, annotatedBlob: blob,
        width: c.width, height: c.height, dpr: scale,
        createdAt: new Date().toISOString(),
    });
    store.addImageToPoint(pointId, imageId);
    return imageId;
}