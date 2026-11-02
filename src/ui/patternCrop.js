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

      function updateBox() {
        cropBox.style.left = cropX + 'px';
        cropBox.style.top = cropY + 'px';
        cropBox.style.width = cropW + 'px';
        cropBox.style.height = cropH + 'px';
      }

      // 8 个控制点
      const handles = [
        { id: 'nw', cursor: 'nwse-resize', left: '-7px', top: '-7px' },
        { id: 'n', cursor: 'ns-resize', left: 'calc(50% - 7px)', top: '-7px' },
        { id: 'ne', cursor: 'nesw-resize', left: 'calc(100% - 7px)', top: '-7px' },
        { id: 'e', cursor: 'ew-resize', left: 'calc(100% - 7px)', top: 'calc(50% - 7px)' },
        { id: 'se', cursor: 'nwse-resize', left: 'calc(100% - 7px)', top: 'calc(100% - 7px)' },
        { id: 's', cursor: 'ns-resize', left: 'calc(50% - 7px)', top: 'calc(100% - 7px)' },
        { id: 'sw', cursor: 'nesw-resize', left: '-7px', top: 'calc(100% - 7px)' },
        { id: 'w', cursor: 'ew-resize', left: '-7px', top: 'calc(50% - 7px)' },
      ];

      handles.forEach(h => {
        const handle = el('div', {
          style: {
            position: 'absolute', width: '14px', height: '14px',
            background: '#fff', borderRadius: '50%', border: '1px solid #333',
            cursor: h.cursor,
            left: h.left,
            top: h.top,
          },
        });
        handle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const startX = e.clientX, startY = e.clientY;
          const orig = { x: cropX, y: cropY, w: cropW, h: cropH };
          function move(ev) {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            let { x, y, w, h: hh } = orig;
            if (h.id.includes('e')) w = Math.max(20, orig.w + dx);
            if (h.id.includes('s')) hh = Math.max(20, orig.h + dy);
            if (h.id.includes('w')) { w = Math.max(20, orig.w - dx); x = orig.x + (orig.w - w); }
            if (h.id.includes('n')) { hh = Math.max(20, orig.h - dy); y = orig.y + (orig.h - hh); }
            cropX = Math.max(0, Math.min(dispW - w, x));
            cropY = Math.max(0, Math.min(dispH - hh, y));
            cropW = w;
            cropH = hh;
            updateBox();
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
          updateBox();
        }
        function up() {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });

      const imgWrap = el('div', {
        style: { position: 'relative', width: dispW + 'px', height: dispH + 'px', margin: '0 auto', touchAction: 'none' },
      }, [imgEl, cropBox]);

      const mask = el('div', {
        class: 'confirm-mask', style: { zIndex: '500' },
      }, [
        el('div', {
          class: 'confirm-box', style: { maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: '20px' },
        }, [
          el('h3', { text: '裁剪花样', style: { marginBottom: '12px' } }),
          el('p', { text: '拖动 8 个控制点调整裁剪区域，拖动框内移动', style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } }),
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