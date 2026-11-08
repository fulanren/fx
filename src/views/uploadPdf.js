import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { dbPut, putImageCached } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export function renderUploadPdf({ params }) {
  const pointId = params.id;
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '导入 PDF';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  const container = el('div', { style: { padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center' } });
  container.appendChild(el('div', { style: { fontSize: '64px' }, text: '📄' }));
  container.appendChild(el('h2', { text: '请选择要导入的 PDF 文件' }));
  
  // 原生 input，绝对不报错
  const input = el('input', {
    type: 'file',
    accept: 'application/pdf',
    style: { fontSize: '16px', padding: '12px', borderRadius: '8px', border: '2px dashed var(--primary)', background: 'var(--bg)', width: '100%', maxWidth: '300px' },
    onChange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // 清除 input 的值，方便下次选同一个文件
      e.target.value = '';

      if (!window.pdfjsLib) {
        toastError('PDF.js 库未加载');
        return;
      }

      toastSuccess('正在解析 PDF…');
      try {
        // 1. 存入文件
        const pdfId = uuid();
        await dbPut('pdfs', {
          id: pdfId, blob: file, name: file.name, createdAt: new Date().toISOString()
        });

        // 2. 解析 PDF
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

        // 3. 生成占位图
        const fakeImageId = uuid();
        await putImageCached({
          id: fakeImageId,
          type: 'pdf_placeholder',
          originalBlob: new Blob([], { type: 'text/plain' }),
          annotatedBlob: new Blob([], { type: 'text/plain' }),
          width: 0, height: 0, dpr: 1,
          pdfId: pdfId,
          pdfName: file.name,
          pdfPages: pdf.numPages,
          createdAt: new Date().toISOString()
        });

        // 4. 写入知识点
        store.addImageToPoint(pointId, fakeImageId);

        // 5. 弹出选页弹窗
        showPagePicker(pdf, pointId);
        
      } catch (err) {
        console.error(err);
        toastError('解析失败：' + err.message);
      }
    }
  });
  
  container.appendChild(input);
  view.appendChild(container);
}

// ============ 选页弹窗（全部写在内部） ============
function showPagePicker(pdf, pointId) {
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
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); history.back(); } }),
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
                                await renderPageToImage(page, n, pointId);
                                successCount++;
                            } catch (err) {
                                console.error(`第 ${n} 页导入失败`, err);
                            }
                        }
                        if (successCount > 0) {
                            toastSuccess(`已导入 ${successCount} 页`);
                            history.back();
                        } else {
                            toastError('没有成功导入任何页');
                            history.back();
                        }
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