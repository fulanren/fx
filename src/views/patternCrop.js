// src/views/patternCrop.js
// 自定义花样裁剪弹窗：上传图片 → 框选区域 → 导出 Blob

import { el } from '../utils/dom.js';

export function patternCropModal(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;

    img.onload = () => {
      const maxW = Math.min(600, window.innerWidth - 64);
      const maxH = Math.min(600, window.innerHeight - 200);
      let scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const displayW = img.width * scale;
      const displayH = img.height * scale;

      // 裁剪框初始位置（居中，占 60%）
      let cropX = displayW * 0.2;
      let cropY = displayH * 0.2;
      let cropW = displayW * 0.6;
      let cropH = displayH * 0.6;

      const cropBox = el('div', {
        style: {
          position: 'absolute',
          left: cropX + 'px',
          top: cropY + 'px',
          width: cropW + 'px',
          height: cropH + 'px',
          border: '2px solid #3B82F6',
          background: 'rgba(59,130,246,.1)',
          cursor: 'move',
          boxSizing: 'border-box',
        },
      });

      // 8 个控制点
      const handles = {};
      const positions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      positions.forEach(pos => {
        const h = el('div', {
          style: {
            position: 'absolute',
            width: '12px',
            height: '12px',
            background: '#fff',
            border: '2px solid #3B82F6',
            borderRadius: '2px',
            cursor: getCursor(pos),
          },
        });
        positionHandle(h, pos, cropW, cropH);
        h.dataset.pos = pos;
        cropBox.appendChild(h);
        handles[pos] = h;
      });

      const imgWrapper = el('div', {
        style: {
          position: 'relative',
          width: displayW + 'px',
          height: displayH + 'px',
          userSelect: 'none',
          touchAction: 'none',
        },
      }, [
        el('img', {
          src: url,
          style: { width: displayW + 'px', height: displayH + 'px', display: 'block', pointerEvents: 'none' },
        }),
        cropBox,
      ]);

      // 拖动裁剪框或控制点
      let dragging = null;
      let dragStart = null;

      function onPointerDown(e) {
        const target = e.target;
        if (target.dataset.pos) {
          dragging = 'resize';
          dragStart = {
            pos: target.dataset.pos,
            x: e.clientX,
            y: e.clientY,
            cropX, cropY, cropW, cropH,
          };
        } else if (target === cropBox) {
          dragging = 'move';
          dragStart = {
            x: e.clientX,
            y: e.clientY,
            cropX, cropY,
          };
        } else {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      }

      function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        if (dragging === 'move') {
          cropX = Math.max(0, Math.min(displayW - cropW, dragStart.cropX + dx));
          cropY = Math.max(0, Math.min(displayH - cropH, dragStart.cropY + dy));
        } else if (dragging === 'resize') {
          const pos = dragStart.pos;
          let newX = dragStart.cropX;
          let newY = dragStart.cropY;
          let newW = dragStart.cropW;
          let newH = dragStart.cropH;

          if (pos.includes('w')) { newX = dragStart.cropX + dx; newW = dragStart.cropW - dx; }
          if (pos.includes('e')) { newW = dragStart.cropW + dx; }
          if (pos.includes('n')) { newY = dragStart.cropY + dy; newH = dragStart.cropH - dy; }
          if (pos.includes('s')) { newH = dragStart.cropH + dy; }

          if (newW < 40) { newW = 40; newX = dragStart.cropX + dragStart.cropW - 40; }
          if (newH < 40) { newH = 40; newY = dragStart.cropY + dragStart.cropH - 40; }
          if (newX < 0) { newX = 0; newW = dragStart.cropX + dragStart.cropW; }
          if (newY < 0) { newY = 0; newH = dragStart.cropY + dragStart.cropH; }
          if (newX + newW > displayW) newW = displayW - newX;
          if (newY + newH > displayH) newH = displayH - newY;

          cropX = newX; cropY = newY; cropW = newW; cropH = newH;
        }

        cropBox.style.left = cropX + 'px';
        cropBox.style.top = cropY + 'px';
        cropBox.style.width = cropW + 'px';
        cropBox.style.height = cropH + 'px';

        // 重新定位控制点
        positions.forEach(pos => {
          positionHandle(handles[pos], pos, cropW, cropH);
        });
      }

      function onPointerUp() {
        dragging = null;
        dragStart = null;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      }

      imgWrapper.addEventListener('pointerdown', onPointerDown);

      // 生成裁剪结果
      async function doCrop() {
        const realX = cropX / scale;
        const realY = cropY / scale;
        const realW = cropW / scale;
        const realH = cropH / scale;

        const out = document.createElement('canvas');
        out.width = realW;
        out.height = realH;
        const octx = out.getContext('2d');
        octx.drawImage(img, realX, realY, realW, realH, 0, 0, realW, realH);

        const blob = await new Promise(r => out.toBlob(r, 'image/png'));
        URL.revokeObjectURL(url);
        mask.remove();
        resolve({ blob });
      }

      const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: (displayW + 40) + 'px', maxHeight: '90vh', overflow: 'auto' } }, [
          el('h3', { text: '框选花样区域' }),
          el('p', { text: '拖动框或边角调整，松手后裁剪', style: { fontSize: '12px', color: 'var(--text-2)' } }),
          imgWrapper,
          el('div', { class: 'confirm-actions' }, [
            el('button', {
              class: 'btn btn-ghost', text: '取消',
              onClick: () => { URL.revokeObjectURL(url); mask.remove(); resolve(null); },
            }),
            el('button', {
              class: 'btn btn-primary', text: '保存花样',
              onClick: doCrop,
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}

function getCursor(pos) {
  if (pos === 'n' || pos === 's') return 'ns-resize';
  if (pos === 'e' || pos === 'w') return 'ew-resize';
  if (pos === 'nw' || pos === 'se') return 'nwse-resize';
  return 'nesw-resize';
}

function positionHandle(h, pos, w, hh) {
  const half = 6;
  if (pos.includes('n')) h.style.top = -half + 'px';
  if (pos.includes('s')) h.style.top = (hh - half) + 'px';
  if (pos.includes('w')) h.style.left = -half + 'px';
  if (pos.includes('e')) h.style.left = (w - half) + 'px';
  if (pos === 'n' || pos === 's') h.style.left = (w / 2 - half) + 'px';
  if (pos === 'e' || pos === 'w') h.style.top = (hh / 2 - half) + 'px';
}