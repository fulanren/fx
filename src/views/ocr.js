import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { getImageCached, dbGet, dbPut } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export async function runOCR(imageId) {
  try {
    const img = await getImageCached(imageId);
    if (!img) { toastError('图片不存在'); return null; }

    const cached = await dbGet('ocr_cache', imageId);
    if (cached && cached.text && cached.text.trim()) return cached;

    if (!window.Tesseract) {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }
    if (!window.Tesseract) { toastError('OCR 引擎加载失败，请检查网络'); return null; }

    const blob = img.originalBlob || img.annotatedBlob;
    if (!blob) { toastError('原图不存在'); return null; }

    toastSuccess('识别中，请稍候…（首次需下载语言包）');

    //通过 Canvas 强制转换成最纯净的 Base64
    const base64Image = await new Promise((resolve) => {
      const imgObj = new Image();
      const url = URL.createObjectURL(blob);
      imgObj.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = imgObj.width;
        canvas.height = imgObj.height;
        const ctx = canvas.getContext('2d');
        // 填白底，防止透明 PNG 被识别成全黑
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgObj, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      imgObj.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null); // 如果连 Image 都加载不出，直接返回 null
      };
      imgObj.src = url;
    });

    if (!base64Image) { toastError('图片解码失败'); return null; }

    //屏蔽底层噪音
    const originalWarn = console.warn;
    console.warn = function (...args) {
      if (args[0] && typeof args[0] === 'string' && (args[0].includes('Parameter not found') || args[0].includes('Warning'))) return;
      originalWarn.apply(console, args);
    };

    let text = '';
    let worker = null;

    try {
      worker = await window.Tesseract.createWorker('chi_sim+eng');
      // 使用 try-catch 死死按住 recognize 的异常，不让它抛出
      const result = await worker.recognize(base64Image).catch(e => {
        console.warn('Tesseract 内部识别警告（已拦截）', e);
        return { data: { text: '' } };
      });
      text = (result.data.text || '').trim();
    } catch (err) {
      console.error('Worker 创建或运行错误:', err);
    } finally {
      console.warn = originalWarn;
      if (worker) await worker.terminate().catch(() => { });
    }

    if (!text) {
      toastError('未识别到文字，图片可能是纯图形');
      return { id: imageId, text: '' };
    }

    await dbPut('ocr_cache', {
      id: imageId, text, lang: 'chi_sim+eng',
      createdAt: new Date().toISOString(),
    });
    return { id: imageId, text };
  } catch (e) {
    console.warn('OCR 运行异常:', e.message);
    toastError('OCR 失败：' + e.message);
    return null;
  }
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

export function renderOcrResult(imageId, text, pointId) {
  return new Promise(resolve => {
    if (!text || !text.trim()) {
      toastError('没有可插入的文字');
      resolve(false);
      return;
    }
    const textarea = el('textarea', {
      value: text,
      class: 'ocr-textarea',
    });
    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '560px' } }, [
        el('h3', { text: '识别结果' }),
        el('p', { text: '可编辑后插入', style: { fontSize: '13px', color: 'var(--text-2)' } }),
        textarea,
        el('div', { class: 'confirm-actions', style: { marginTop: '16px', flexWrap: 'wrap' } }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => { mask.remove(); resolve(false); } }),
          el('button', {
            class: 'btn btn-ghost', text: '插入到解释', onClick: () => {
              const point = store.getPoint(pointId);
              if (point) {
                store.updatePoint(pointId, { explanation: (point.explanation || '') + '\n\n' + textarea.value });
                toastSuccess('已插入解释');
              }
              mask.remove(); resolve(true);
            }
          }),
          el('button', {
            class: 'btn btn-primary', text: '插入到内容', onClick: () => {
              const point = store.getPoint(pointId);
              if (point) {
                store.updatePoint(pointId, { content: (point.content || '') + '\n' + textarea.value });
                toastSuccess('已插入内容');
              }
              mask.remove(); resolve(true);
            }
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  });
}