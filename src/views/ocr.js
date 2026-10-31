import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export async function runOCR(imageId) {
  try {
    const img = await dbGet('images', imageId);
    if (!img) { toastError('图片不存在'); return null; }

    // 只使用有实际文字的缓存
    const cached = await dbGet('ocr_cache', imageId);
    if (cached && cached.text && cached.text.trim()) return cached;

    if (!window.Tesseract) {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }
    if (!window.Tesseract) { toastError('OCR 引擎加载失败'); return null; }

    const blob = img.originalBlob;
    if (!blob) { toastError('原图不存在'); return null; }

    toastSuccess('识别中，请稍候…');
    const result = await window.Tesseract.recognize(blob, 'chi_sim');
    const text = (result.data.text || '').trim();

    if (!text) {
      toastError('未识别到文字，图片可能是纯图形');
      return { id: imageId, text: '' };
    }

    await dbPut('ocr_cache', {
      id: imageId, text, lang: 'chi_sim',
      createdAt: new Date().toISOString(),
    });
    return { id: imageId, text };
  } catch (e) {
    console.error('OCR 失败', e);
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
      style: { width: '100%', minHeight: '200px', padding: '12px', fontSize: '15px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px' },
    });
    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '560px' } }, [
        el('h3', { text: '识别结果' }),
        el('p', { text: '可编辑后插入', style: { fontSize: '13px', color: 'var(--text-2)' } }),
        textarea,
        el('div', { class: 'confirm-actions', style: { marginTop: '16px', flexWrap: 'wrap' } }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => { mask.remove(); resolve(false); } }),
          el('button', { class: 'btn btn-ghost', text: '插入到解释', onClick: () => {
            const point = store.getPoint(pointId);
            if (point) {
              store.updatePoint(pointId, { explanation: (point.explanation || '') + '\n\n' + textarea.value });
              toastSuccess('已插入解释');
            }
            mask.remove(); resolve(true);
          } }),
          el('button', { class: 'btn btn-primary', text: '插入到内容', onClick: () => {
            const point = store.getPoint(pointId);
            if (point) {
              store.updatePoint(pointId, { content: (point.content || '') + '\n' + textarea.value });
              toastSuccess('已插入内容');
            }
            mask.remove(); resolve(true);
          } }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  });
}
