import { el } from '../utils/dom.js';
import { uuid } from '../utils/id.js';
import { dbPut } from '../db.js';
import * as store from '../store.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export function patternCropModal(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => buildModal(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);

    function buildModal(img) {
      const maxW = Math.min(window.innerWidth - 60, 600);
      const scale = Math.min(1, maxW / img.width);
      const dispW = img.width * scale;
      const dispH = img.height * scale;

      // 裁剪框默认居中，占 40%
      let cropX = dispW * 0.3, cropY = dispH * 0.3;
      let cropW = dispW * 0.4, cropH = dispH * 0.4;

      const imgEl = el('img', {
        src: img.src,
        style: { width: dispW + 'px', height: dispH + 'px', display: 'block', userSelect: 'none', pointerEvents: 'none' },
      });

      const cropBox = el('div', {
        style: {
          position: 'absolute', left: cropX + 'px', top: cropY + 'px',
          width: cropW + 'px', height: cropH + 'px',
          border: '2px dashed #fff', boxShadow: '0 0 0 9999px rgba(0,0,0,.5)',
          cursor: 'move', boxSizing: 'border-box',
        },
      });

      // 4 个角手柄
      ['nw', 'ne', 'sw', 'se'].forEach(pos => {
        const handle = el('div', {
          style: {
            position: 'absolute', width: '14px', height: '14px',
            background: '#fff', borderRadius: '50%', border: '1px solid #333',
            cursor: pos + '-resize',
            left: pos.includes('w') ? '-7px' : 'calc(100% - 7px)',
            top: pos.includes('n') ? '-7px' : 'calc(100% - 7px)',
          },
        });
        handle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const startX = e.clientX, startY = e.clientY;
          const orig = { x: cropX, y: cropY, w: cropW, h: cropH };
          function move(ev) {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (pos.includes('e')) cropW = Math.max(20, orig.w + dx);
            if (pos.includes('s')) cropH = Math.max(20, orig.h + dy);
            if (pos.includes('w')) { cropW = Math.max(20, orig.w - dx); cropX = orig.x + dx; }
            if (pos.includes('n')) { cropH = Math.max(20, orig.h - dy); cropY = orig.y + dy; }
            cropX = Math.max(0, Math.min(dispW - cropW, cropX));
            cropY = Math.max(0, Math.min(dispH - cropH, cropY));
            cropBox.style.left = cropX + 'px';
            cropBox.style.top = cropY + 'px';
            cropBox.style.width = cropW + 'px';
            cropBox.style.height = cropH + 'px';
          }
          function up() {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
          }
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        });
        cropBox.appendChild(handle);
      });

      // 拖动整个框
      cropBox.addEventListener('pointerdown', (e) => {
        if (e.target !== cropBox) return;
        const startX = e.clientX, startY = e.clientY;
        const orig = { x: cropX, y: cropY };
        function move(ev) {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          cropX = Math.max(0, Math.min(dispW - cropW, orig.x + dx));
          cropY = Math.max(0, Math.min(dispH - cropH, orig.y + dy));
          cropBox.style.left = cropX + 'px';
          cropBox.style.top = cropY + 'px';
        }
        function up() {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });

      const imgWrap = el('div', {
        style: { position: 'relative', width: dispW + 'px', height: dispH + 'px', margin: '0 auto' },
      }, [imgEl, cropBox]);

      const mask = el('div', {
        class: 'confirm-mask', style: { zIndex: '500' },
      }, [
        el('div', {
          class: 'confirm-box', style: { maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: '20px' },
        }, [
          el('h3', { text: '裁剪花样', style: { marginBottom: '12px' } }),
          el('p', { text: '拖动边框调整裁剪区域，拖动框内移动', style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } }),
          imgWrap,
          el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(null); } }),
            el('button', {
              class: 'btn btn-primary', text: '保存花样',
              onClick: async () => {
                try {
                  const srcX = cropX / scale;
                  const srcY = cropY / scale;
                  const srcW = cropW / scale;
                  const srcH = cropH / scale;
                  const c = document.createElement('canvas');
                  c.width = Math.round(srcW);
                  c.height = Math.round(srcH);
                  c.getContext('2d').drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
                  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
                  const patternId = uuid();
                  await dbPut('patterns', { id: patternId, blob, createdAt: new Date().toISOString() });
                  store.addPattern({ id: patternId, createdAt: new Date().toISOString() });
                  toastSuccess('花样已保存');
                  mask.remove();
                  resolve(patternId);
                } catch (e) {
                  toastError('保存失败：' + e.message);
                }
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);
    }
  });
}