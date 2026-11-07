import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { getImageCached, putImageCached } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess, toastError } from '../ui/toast.js';

const STYLES = [
  { id: 'vertical', label: '📐 纵向拼接' },
  { id: 'horizontal', label: '📖 横向拼接' },
  { id: 'grid', label: '🗂 网格' },
  { id: 'a4', label: '📄 A4 排版' },
  { id: 'polaroid', label: '🖼 拍立得墙' },
  { id: 'card', label: '📋 卡片列表' },
];

export function renderComposer({ params, query }) {
  const pointId = query.pointId;
  const point = store.getPoint(pointId);
  if (!point) { navigate('#/'); return; }

  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '合成图片';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate(`#/chapter/${point.chapterId}`);

  let style = 'vertical';
  let gap = 16;
  let width = 800;
  let bg = '#FFFFFF';
  let showIndex = true;

  // ============ 新增：图片选择 ============
  const allIds = [...(point.imageIds || []), ...(point.compositeImageIds || [])];
  let selectedIds = new Set(allIds); // 默认全选

  // 在样式选择上方插入勾选区域
  const pickerWrap = el('div', {
    style: { display: 'flex', gap: '8px', overflowX: 'auto', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,.05)', marginBottom: '16px' }
  });

  allIds.forEach(id => {
    const item = el('div', {
      style: {
        position: 'relative', flexShrink: 0, width: '60px', height: '60px',
        borderRadius: '6px', overflow: 'hidden', cursor: 'pointer',
        border: '2px solid transparent', opacity: 0.5, transition: 'all .2s'
      },
      onClick: () => {
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
          item.style.borderColor = 'transparent';
          item.style.opacity = '0.5';
        } else {
          selectedIds.add(id);
          item.style.borderColor = 'var(--primary)';
          item.style.opacity = '1';
        }
        loadedImages = []; // 清空缓存
        schedulePreview(); // 重新渲染
      }
    });

    // 默认选中状态
    if (selectedIds.has(id)) {
      item.style.borderColor = 'var(--primary)';
      item.style.opacity = '1';
    }

    import('../db.js').then(({ dbGet }) => {
      dbGet('images', id).then(rec => {
        if (!rec) return;
        const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
        item.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) }));
      });
    });

    pickerWrap.appendChild(item);
  });

  view.appendChild(el('div', { style: { marginBottom: '8px', fontSize: '13px', color: 'var(--text-2)' }, text: '选择参与合成的图片：' }));
  view.appendChild(pickerWrap);

  const preview = el('canvas', { class: 'compose-preview' });
  const previewCtx = preview.getContext('2d');

  const styleRow = el('div', { class: 'compose-row' }, [
    el('span', { class: 'tape-label', text: '样式' }),
    ...STYLES.map(s => el('button', {
      class: 'tape-chip' + (s.id === style ? ' active' : ''),
      text: s.label,
      onClick: (e) => {
        style = s.id;
        styleRow.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        schedulePreview();
      },
    })),
  ]);

  const gapInput = el('input', {
    type: 'range', min: '0', max: '40', value: String(gap),
    style: { flex: '1' },
    onInput: (e) => { gap = Number(e.target.value); schedulePreview(); },
  });
  const widthInput = el('input', {
    type: 'range', min: '400', max: '1600', value: String(width),
    style: { flex: '1' },
    onInput: (e) => { width = Number(e.target.value); schedulePreview(); },
  });
  const indexCheck = el('input', {
    type: 'checkbox', checked: showIndex,
    onChange: (e) => { showIndex = e.target.checked; schedulePreview(); },
  });

  view.appendChild(styleRow);
  view.appendChild(el('div', { class: 'compose-row' }, [
    el('span', { class: 'tape-label', text: '宽度' }), widthInput,
  ]));
  view.appendChild(el('div', { class: 'compose-row' }, [
    el('span', { class: 'tape-label', text: '间距' }), gapInput,
  ]));
  view.appendChild(el('div', { class: 'compose-row' }, [
    el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [indexCheck, '显示序号']),
  ]));
  view.appendChild(el('div', { style: { margin: '16px 0', textAlign: 'center' } }, [preview]));
  view.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => navigate(`#/chapter/${point.chapterId}`) }),
    el('button', { class: 'btn btn-ghost', text: '🖨 导出 PDF', onClick: exportPdf }),
    el('button', { class: 'btn btn-primary', text: '生成并保存', onClick: generate }),
  ]));

  let loadedImages = [];
  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreview, 300);
  }

  async function loadAllImages() {
    // 只加载被选中的
    const ids = Array.from(selectedIds);
    const result = [];
    for (const id of ids) {
      const img = await getImageCached(id);
      // ... 原有的读取逻辑 ...
      if (!img) continue;
      const blob = img.annotatedBlob || img.originalBlob;
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.src = url;
      await new Promise(r => { im.onload = r; });
      result.push({ img: im, width: im.width, height: im.height, url });
    }
    return result;
  }

  function computeLayout(images) {
    if (images.length === 0) return { width: width, height: 200, items: [] };
    const items = [];
    let totalH = 0;

    if (style === 'vertical' || style === 'card' || style === 'polaroid') {
      const pad = style === 'polaroid' ? 12 : 0;
      images.forEach((im, i) => {
        const w = width - pad * 2;
        const h = Math.round(im.height * (w / im.width));
        const x = pad;
        const y = totalH + pad;
        items.push({ ...im, x, y, w, h, index: i + 1 });
        totalH = y + h + pad + (i < images.length - 1 ? gap : 0);
      });
      return { width, height: totalH + pad, items };
    }
    if (style === 'horizontal') {
      let totalW = 0;
      images.forEach((im, i) => {
        const h = width * 0.75;
        const w = Math.round(im.width * (h / im.height));
        items.push({ ...im, x: totalW, y: 0, w, h, index: i + 1 });
        totalW += w + (i < images.length - 1 ? gap : 0);
      });
      return { width: totalW, height: width * 0.75, items };
    }
    if (style === 'grid') {
      const cols = 2;
      const cell = (width - gap * (cols - 1)) / cols;
      let rowY = 0;
      images.forEach((im, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const h = Math.round(cell * (im.height / im.width));
        items.push({ ...im, x: col * (cell + gap), y: rowY, w: cell, h, index: i + 1 });
        if (col === cols - 1 || i === images.length - 1) rowY += h + gap;
      });
      return { width, height: rowY, items };
    }
    if (style === 'a4') {
      const A4W = width;
      const A4H = Math.round(width * 1.414);
      let pageY = 0;
      images.forEach((im, i) => {
        const scale = Math.min(A4W / im.width, A4H / im.height) * 0.9;
        const w = im.width * scale;
        const h = im.height * scale;
        items.push({ ...im, x: (A4W - w) / 2, y: pageY + (A4H - h) / 2, w, h, index: i + 1 });
        pageY += A4H;
      });
      return { width: A4W, height: pageY, items };
    }
    return { width, height: 200, items: [] };
  }

  async function drawPreview() {
    if (!loadedImages.length) loadedImages = await loadAllImages();
    if (loadedImages.length === 0) {
      preview.width = 400; preview.height = 200;
      previewCtx.fillStyle = '#f0f0f0';
      previewCtx.fillRect(0, 0, 400, 200);
      previewCtx.fillStyle = '#999';
      previewCtx.font = '16px sans-serif';
      previewCtx.textAlign = 'center';
      previewCtx.fillText('没有图片可合成', 200, 100);
      return;
    }
    const layout = computeLayout(loadedImages);
    const scale = Math.min(1, 500 / layout.width);
    preview.width = Math.round(layout.width * scale);
    preview.height = Math.round(layout.height * scale);
    previewCtx.fillStyle = bg;
    previewCtx.fillRect(0, 0, preview.width, preview.height);
    layout.items.forEach(it => {
      previewCtx.drawImage(it.img, it.x * scale, it.y * scale, it.w * scale, it.h * scale);
      if (showIndex) {
        previewCtx.fillStyle = 'rgba(59,130,246,.9)';
        previewCtx.beginPath();
        previewCtx.arc((it.x + 20) * scale, (it.y + 20) * scale, 10 * scale, 0, Math.PI * 2);
        previewCtx.fill();
        previewCtx.fillStyle = '#fff';
        previewCtx.font = `bold ${14 * scale}px sans-serif`;
        previewCtx.textAlign = 'center';
        previewCtx.textBaseline = 'middle';
        previewCtx.fillText(String(it.index), (it.x + 20) * scale, (it.y + 20) * scale);
      }
    });
  }

  // ============ 导出为 PDF ============
  async function exportPdf() {
    if (!loadedImages.length) loadedImages = await loadAllImages();
    if (loadedImages.length === 0) { toastError('没有图片可导出'); return; }

    try {
      // 1. 使用和预览相同的排版逻辑，生成一张高清大图
      const layout = computeLayout(loadedImages);
      const c = document.createElement('canvas');
      c.width = layout.width;
      c.height = layout.height;
      const cctx = c.getContext('2d');
      cctx.fillStyle = bg;
      cctx.fillRect(0, 0, c.width, c.height);

      layout.items.forEach(it => {
        cctx.drawImage(it.img, it.x, it.y, it.w, it.h);
        if (showIndex) {
          cctx.fillStyle = 'rgba(59,130,246,.9)';
          cctx.beginPath();
          cctx.arc(it.x + 20, it.y + 20, 16, 0, Math.PI * 2);
          cctx.fill();
          cctx.fillStyle = '#fff';
          cctx.font = 'bold 20px sans-serif';
          cctx.textAlign = 'center';
          cctx.textBaseline = 'middle';
          cctx.fillText(String(it.index), it.x + 20, it.y + 20);
        }
      });

      // 2. 将合成图转为 Base64
      const base64Url = c.toDataURL('image/jpeg', 0.9);

      // 3. 构造打印用的 HTML
      // 这里根据合成样式决定是横屏还是竖屏
      const isLandscape = style === 'horizontal';
      const pageSize = isLandscape ? 'A4 landscape' : 'A4 portrait';

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>导出 PDF</title>
          <style>
            @page { size: ${pageSize}; margin: 10mm; }
            body { 
              margin: 0; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              min-height: 100vh; 
              background: #fff;
            }
            img { 
              max-width: 100%; 
              max-height: 100vh; 
              object-fit: contain; 
              box-shadow: 0 0 10px rgba(0,0,0,0.1); /* 仅预览用 */
            }
            @media print {
              body { min-height: auto; }
              img { box-shadow: none; max-height: 100%; }
            }
          </style>
        </head>
        <body>
          <img src="${base64Url}" />
        </body>
        </html>
      `;

      // 4. 打开新窗口触发打印
      const w = window.open('', '_blank');
      if (!w) {
        toastError('请允许浏览器弹出窗口以导出 PDF');
        return;
      }
      w.document.write(html);
      w.document.close();

      // 等待图片渲染后触发打印
      setTimeout(() => {
        w.focus();
        w.print();
      }, 600);

    } catch (e) {
      toastError('导出失败：' + e.message);
    }
  }

  async function generate() {
    if (!loadedImages.length) loadedImages = await loadAllImages();
    if (loadedImages.length === 0) { toastError('没有图片可合成'); return; }
    try {
      const layout = computeLayout(loadedImages);
      const c = document.createElement('canvas');
      c.width = layout.width;
      c.height = layout.height;
      const cctx = c.getContext('2d');
      cctx.fillStyle = bg;
      cctx.fillRect(0, 0, c.width, c.height);
      layout.items.forEach(it => {
        cctx.drawImage(it.img, it.x, it.y, it.w, it.h);
        if (showIndex) {
          cctx.fillStyle = 'rgba(59,130,246,.9)';
          cctx.beginPath();
          cctx.arc(it.x + 20, it.y + 20, 16, 0, Math.PI * 2);
          cctx.fill();
          cctx.fillStyle = '#fff';
          cctx.font = 'bold 20px sans-serif';
          cctx.textAlign = 'center';
          cctx.textBaseline = 'middle';
          cctx.fillText(String(it.index), it.x + 20, it.y + 20);
        }
      });
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const newId = uuid();
      await putImageCached({
        id: newId,
        type: 'composite',
        blob,
        annotatedBlob: blob,
        width: c.width,
        height: c.height,
        createdAt: new Date().toISOString(),
        sourceImageIds: Array.from(selectedIds), // 👈 只记选中的
      });
      store.addCompositeToPoint(pointId, newId);
      toastSuccess('合成完成');
      navigate(`#/chapter/${point.chapterId}`);
    } catch (e) {
      toastError('合成失败：' + e.message);
    }
  }

  drawPreview();
}