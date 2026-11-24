import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { dbPut, putImageCached } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export function pdfImportModal(pointId, presetFile = null) {
    return new Promise(resolve => {
        //如果有文件传进来（通过 label 选的），直接处理，绝不再弹窗
        if (presetFile) {
            handleFile(presetFile, pointId, resolve);
            return;
        }

        // 如果没传文件（比如是其他旧代码调用的），保留兜底
        const fileInput = el('input', {
            type: 'file', accept: 'application/pdf', style: { display: 'none' },
            onChange: (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(false); return; }
                handleFile(file, pointId, resolve);
            },
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 60000);
    });
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

function showPagePicker(pdf, pointId, resolve) {
    const selected = new Set();
    let currentScale = 1.3; // 默认

    const pages = el('div', { class: 'pdf-pages-grid' });
    const countLabel = el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '已选 0 页' });

    // 提示文本元素
    const hintText = el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '6px', fontStyle: 'italic' } });

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '720px', maxHeight: '90vh', overflow: 'auto' } }, [
            el('h3', { text: `选择页面（共 ${pdf.numPages} 页）` }),

            // 画质选择卡片
            el('div', { style: { margin: '12px 0', padding: '12px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } }, [
                el('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '8px' }, text: '📄 图片导出画质' }),
                el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                    el('button', {
                        class: 'btn btn-sm btn-primary', text: '超清 (2.0x)', id: 'scale-2.0',
                        onClick: () => setScale(2.0)
                    }),
                    el('button', {
                        class: 'btn btn-sm btn-ghost', text: '高清 (1.5x) ⭐推荐', id: 'scale-1.5',
                        onClick: () => setScale(1.5)
                    }),
                    el('button', {
                        class: 'btn btn-sm btn-ghost', text: '标准 (1.0x)', id: 'scale-1.0',
                        onClick: () => setScale(1.0)
                    }),
                    el('button', {
                        class: 'btn btn-sm btn-ghost', text: '流畅 (0.8x)', id: 'scale-0.8',
                        onClick: () => setScale(0.8)
                    })
                ]),
                hintText // 👈 显示动态提示
            ]),

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

                        let successCount = 0;
                        for (const n of pageNums) {
                            try {
                                const page = await pdf.getPage(n);
                                await renderPageToImage(page, n, pointId, currentScale);
                                successCount++;
                            } catch (err) {
                                console.error(`第 ${n} 页导入失败`, err);
                            }
                        }
                        if (successCount > 0) {
                            toastSuccess(`已导入 ${successCount} 页`);
                            resolve(true);
                        } else {
                            toastError('没有成功导入任何页');
                            resolve(false);
                        }
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);

    // 辅助函数：切换按钮状态 & 智能提示
    function setScale(scale) {
        currentScale = scale;
        ['2.0', '1.5', '1.0', '0.8'].forEach(s => {
            const btn = document.getElementById(`scale-${s}`);
            if (btn) {
                if (parseFloat(s) === scale) {
                    btn.className = 'btn btn-sm btn-primary';
                } else {
                    btn.className = 'btn btn-sm btn-ghost';
                }
            }
        });

        // 智能提示语
        if (scale === 2.0) {
            hintText.innerHTML = '<span style="color:var(--danger)">⚠️ 画质过高：极占内存，老旧平板可能会卡顿甚至闪退。</span>';
        } else if (scale === 1.5) {
            hintText.innerHTML = '<span style="color:var(--primary-dark)">✅ 推荐：清晰度与性能的完美平衡。</span>';
        } else if (scale === 1.0) {
            hintText.innerHTML = '<span style="color:var(--text-2)">标准画质：适合日常查看，放大会稍显模糊。</span>';
        } else if (scale === 0.8) {
            hintText.innerHTML = '<span style="color:var(--warn)">🚀 流畅模式：画质较低，但极省空间，适合纯文字阅读。</span>';
        }
    }

    // 初始化选中默认的高清 1.5x
    setScale(1.5);

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