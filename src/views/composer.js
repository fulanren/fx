import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { getImageCached, putImageCached, dbDelete } from '../db.js';
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
  document.getElementById('page-title').textContent = '合并';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate(`#/chapter/${point.chapterId}`);

  // ============ 状态变量 ============
  let style = 'vertical';
  let gap = 16;
  let width = 800;
  let bg = '#FFFFFF';
  let showIndex = true;

  const allIds = [
    ...(point.imageIds || []),
    ...(point.compositeImageIds || []),
  ];
  let selectedIds = new Set(allIds);
  const externalFiles = [];

  let loadedImages = [];
  let previewTimer = null;

    // ============ 选择区容器 ============
  const pickerContainer = el('div', { style: { marginBottom: '8px' } });

  // 缩略图网格
  const pickerWrap = el('div', {
    style: {
      display: 'flex', flexWrap: 'wrap', gap: '8px',
      padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,.05)',
      maxHeight: '200px', overflowY: 'auto',
      alignItems: 'flex-start',
    }
  });
  pickerContainer.appendChild(pickerWrap);

  // 底部操作按钮行
  const pickerActions = el('div', {
    style: { display: 'flex', gap: '6px', padding: '8px 0', flexWrap: 'wrap', alignItems: 'center' }
  });
  pickerContainer.appendChild(pickerActions);

  const itemStates = new Map();

  const selectionStatus = el('div', {
    style: { fontSize: '12px', color: 'var(--text-2)', marginLeft: 'auto' },
  });

  function updateSelectionStatus() {
    selectionStatus.textContent = `已选 ${selectedIds.size} / 共 ${itemStates.size}`;
  }

  // 单个缩略图构建
  function buildPickerItem(id, isExternal = false) {
    const item = el('div', {
      style: { position: 'relative', flexShrink: 0, width: '72px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'pointer', transition: 'all .15s' },
      title: '点击切换选中状态',
      onClick: (e) => {
        if (e.target.tagName === 'BUTTON') return;
        const state = itemStates.get(id);
        if (!state) return;
        if (state.selected) {
          state.selected = false;
          selectedIds.delete(id);
          thumbBox.style.borderColor = 'transparent';
          thumbBox.style.opacity = '0.4';
        } else {
          state.selected = true;
          selectedIds.add(id);
          thumbBox.style.borderColor = 'var(--primary)';
          thumbBox.style.opacity = '1';
        }
        loadedImages = [];
        schedulePreview();
        updateSelectionStatus();
      },
    });

    const state = { el: item, selected: true };
    itemStates.set(id, state);

    const thumbBox = el('div', {
      style: {
        width: '72px', height: '56px', borderRadius: '6px', overflow: 'hidden',
        border: '2px solid var(--primary)', background: '#eee',
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      },
    });
    item.appendChild(thumbBox);

    // 外部导入「临时」角标
    if (isExternal) {
      thumbBox.appendChild(el('div', {
        style: { position: 'absolute', bottom: '0', left: '0', background: 'rgba(255,181,167,0.92)', color: '#fff', fontSize: '9px', padding: '1px 4px', borderTopRightRadius: '4px', zIndex: '2' },
        text: '临时',
      }));
    }

    // 右上角移除按钮
    thumbBox.appendChild(el('button', {
      style: { position: 'absolute', top: '2px', right: '2px', width: '16px', height: '16px', borderRadius: '50%', background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '3', padding: '0', lineHeight: '1' },
      text: '×',
      title: '从选择区移除',
      onClick: (e) => {
        e.stopPropagation();
        item.remove();
        itemStates.delete(id);
        selectedIds.delete(id);
        const idx = externalFiles.findIndex(f => f.id === id);
        if (idx >= 0) externalFiles.splice(idx, 1);
        loadedImages = [];
        schedulePreview();
        updateSelectionStatus();
      },
    }));

    // 文件名
    const nameEl = el('div', {
      style: { fontSize: '10px', color: 'var(--text-2)', maxWidth: '72px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' },
      text: '加载中…',
    });
    item.appendChild(nameEl);

    // 缩略图内容
    if (isExternal) {
      const ext = externalFiles.find(f => f.id === id);
      if (ext) {
        nameEl.textContent = ext.name || '未命名';
        item.title = `${ext.name || '未命名'}（点击切换选中）`;
        if (ext.type === 'pdf') {
          thumbBox.style.background = '#FFF0F0';
          thumbBox.appendChild(el('span', { style: { fontSize: '24px' }, text: '📄' }));
        } else if (ext.blob) {
          const url = URL.createObjectURL(ext.blob);
          thumbBox.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) }));
        }
      }
    } else {
      import('../db.js').then(({ dbGet }) => {
        dbGet('images', id).then(rec => {
          if (!rec) { thumbBox.appendChild(el('span', { style: { fontSize: '18px' }, text: '?' })); nameEl.textContent = '已丢失'; return; }
          if (rec.type === 'pdf_placeholder') {
            thumbBox.style.background = '#FFF0F0';
            thumbBox.appendChild(el('span', { style: { fontSize: '24px' }, text: '📄' }));
            nameEl.textContent = rec.pdfName || 'PDF';
            item.title = `${rec.pdfName || 'PDF'}（点击切换选中）`;
            return;
          }
          const rawBlob = rec.annotatedBlob || rec.originalBlob;
          if (!(rawBlob instanceof Blob) || rawBlob.size === 0) {
            thumbBox.appendChild(el('span', { style: { fontSize: '20px' }, text: '🖼' }));
            nameEl.textContent = rec.name || '损坏';
            return;
          }
          const url = URL.createObjectURL(rawBlob);
          thumbBox.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) }));
          const displayName = rec.name || (rec.type === 'composite' ? '合并图' : `图片 ${allIds.indexOf(id) + 1}`);
          nameEl.textContent = displayName;
          item.title = `${displayName}（点击切换选中）`;
        });
      });
    }

    return item;
  }

  // 渲染已有文件
  allIds.forEach(id => {
    pickerWrap.appendChild(buildPickerItem(id, false));
    selectedIds.add(id);
  });

  // ============ 导入 / 全选 / 重置按钮组 ============
  function addImportButtons(parent) {
    // 外部导入图片
    const importImgBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      style: { flexShrink: 0, padding: '4px 10px', border: '1.5px dashed var(--primary)', borderRadius: '6px', color: 'var(--primary-dark)', fontSize: '12px', minHeight: '28px' },
      title: '从本地选择图片加入合并',
      onClick: () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
        input.onchange = async (e) => {
          const files = Array.from(e.target.files || []);
          for (const f of files) {
            const id = `ext_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            externalFiles.push({ id, type: 'image', name: f.name, blob: f });
            selectedIds.add(id);
            pickerWrap.appendChild(buildPickerItem(id, true));
          }
          updateSelectionStatus();
          schedulePreview();
        };
        input.click();
      },
    }, [el('span', { text: '🖼 图片' })]);

    // 外部导入 PDF
    const importPdfBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      style: { flexShrink: 0, padding: '4px 10px', border: '1.5px dashed var(--accent)', borderRadius: '6px', color: 'var(--accent)', fontSize: '12px', minHeight: '28px' },
      title: '从本地选择 PDF 加入合并',
      onClick: () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true;
        input.onchange = async (e) => {
          const files = Array.from(e.target.files || []);
          for (const f of files) {
            const id = `ext_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            externalFiles.push({ id, type: 'pdf', name: f.name, blob: f });
            selectedIds.add(id);
            pickerWrap.appendChild(buildPickerItem(id, true));
          }
          updateSelectionStatus();
          schedulePreview();
        };
        input.click();
      },
    }, [el('span', { text: '📄 PDF' })]);

    // 全选 / 取消全选
    const toggleAllBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      style: { flexShrink: 0, padding: '4px 10px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '6px', color: 'var(--text-2)', fontSize: '12px', minHeight: '28px' },
      title: '全选 / 全部取消',
      onClick: () => {
        const allSelected = selectedIds.size === itemStates.size;
        itemStates.forEach((state, id) => {
          state.selected = !allSelected;
          const thumb = state.el.querySelector('div');
          if (!allSelected) {
            selectedIds.add(id);
            if (thumb) { thumb.style.borderColor = 'var(--primary)'; thumb.style.opacity = '1'; }
          } else {
            selectedIds.delete(id);
            if (thumb) { thumb.style.borderColor = 'transparent'; thumb.style.opacity = '0.4'; }
          }
        });
        toggleAllBtn.firstChild.textContent = allSelected ? '☐ 全选' : '☑ 全选';
        loadedImages = [];
        schedulePreview();
        updateSelectionStatus();
      },
    }, [el('span', { text: '☑ 全选' })]);

    // 重置为知识点原有
    const resetBtn = el('button', {
      class: 'btn btn-sm btn-ghost',
      style: { flexShrink: 0, padding: '4px 10px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '6px', color: 'var(--text-2)', fontSize: '12px', minHeight: '28px' },
      title: '重置为知识点原有文件（清空外部导入）',
      onClick: () => {
        externalFiles.forEach(ext => {
          const state = itemStates.get(ext.id);
          if (state) state.el.remove();
          itemStates.delete(ext.id);
          selectedIds.delete(ext.id);
        });
        externalFiles.length = 0;
        allIds.forEach(id => selectedIds.add(id));
        itemStates.forEach((state) => {
          state.selected = true;
          state.el.style.opacity = '1';
          const thumb = state.el.querySelector('div');
          if (thumb) { thumb.style.borderColor = 'var(--primary)'; thumb.style.opacity = '1'; }
        });
        loadedImages = [];
        schedulePreview();
        updateSelectionStatus();
      },
    }, [el('span', { text: '🔄 重置' })]);

    parent.appendChild(importImgBtn);
    parent.appendChild(importPdfBtn);
    parent.appendChild(toggleAllBtn);
    parent.appendChild(resetBtn);
    parent.appendChild(selectionStatus);
  }

  addImportButtons(pickerActions);
  updateSelectionStatus();updateSelectionStatus();

  // ============ styleRow ============
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

  // ============ widthInput ============
  const widthNum = el('input', {
    type: 'number', min: '400', max: '1600', step: '50', value: String(width),
    style: { width: '64px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
    onInput: (e) => {
      const v = Math.max(400, Math.min(1600, Number(e.target.value) || 800));
      width = v; widthRange.value = v; schedulePreview();
    },
  });
  const widthRange = el('input', {
    type: 'range', min: '400', max: '1600', step: '10', value: String(width),
    style: { flex: '1', minWidth: '80px' },
    onInput: (e) => { width = Number(e.target.value); widthNum.value = width; schedulePreview(); },
  });
  const widthMinus = el('button', {
    class: 'btn btn-sm btn-ghost', text: '−',
    style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
    onClick: () => { width = Math.max(400, width - 50); widthRange.value = width; widthNum.value = width; schedulePreview(); },
  });
  const widthPlus = el('button', {
    class: 'btn btn-sm btn-ghost', text: '+',
    style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
    onClick: () => { width = Math.min(1600, width + 50); widthRange.value = width; widthNum.value = width; schedulePreview(); },
  });
  const widthInput = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1' } }, [
    widthMinus, widthRange, widthNum, widthPlus,
  ]);

  // ============ gapInput ============
  const gapNum = el('input', {
    type: 'number', min: '0', max: '40', step: '1', value: String(gap),
    style: { width: '56px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
    onInput: (e) => {
      const v = Math.max(0, Math.min(40, Number(e.target.value) || 0));
      gap = v; gapRange.value = v; schedulePreview();
    },
  });
  const gapRange = el('input', {
    type: 'range', min: '0', max: '40', step: '1', value: String(gap),
    style: { flex: '1', minWidth: '80px' },
    onInput: (e) => { gap = Number(e.target.value); gapNum.value = gap; schedulePreview(); },
  });
  const gapMinus = el('button', {
    class: 'btn btn-sm btn-ghost', text: '−',
    style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
    onClick: () => { gap = Math.max(0, gap - 1); gapRange.value = gap; gapNum.value = gap; schedulePreview(); },
  });
  const gapPlus = el('button', {
    class: 'btn btn-sm btn-ghost', text: '+',
    style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
    onClick: () => { gap = Math.min(40, gap + 1); gapRange.value = gap; gapNum.value = gap; schedulePreview(); },
  });
  const gapInput = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1' } }, [
    gapMinus, gapRange, gapNum, gapPlus,
  ]);

  // ============ indexCheck ============
  const indexCheck = el('input', {
    type: 'checkbox', checked: showIndex,
    onChange: (e) => { showIndex = e.target.checked; schedulePreview(); },
  });

  // ============ preview ============
  const preview = el('canvas', { class: 'compose-preview' });
  const previewCtx = preview.getContext('2d');
  preview.style.cursor = 'pointer';
  preview.addEventListener('click', () => {
    if (!preview.width) return;
    const bigMask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'rgba(0,0,0,0.9)' } });
    const bigCanvas = document.createElement('canvas');
    bigCanvas.width = preview.width;
    bigCanvas.height = preview.height;
    bigCanvas.getContext('2d').drawImage(preview, 0, 0);
    bigCanvas.style.maxWidth = '95vw';
    bigCanvas.style.maxHeight = '90vh';
    bigCanvas.style.objectFit = 'contain';
    bigMask.appendChild(bigCanvas);
    bigMask.addEventListener('click', () => bigMask.remove());
    document.body.appendChild(bigMask);
  });

  // ============ topFixedBar ============
  const topFixedBar = el('div', {
    style: {
      position: 'sticky', top: '0', zIndex: '100',
      display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 12px', background: 'var(--card)',
      borderBottom: '1px solid rgba(0,0,0,.06)',
      marginBottom: '12px',
    },
  }, [
    el('span', { style: { fontSize: '14px', fontWeight: '600' }, text: '合并' }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => navigate(`#/chapter/${point.chapterId}`) }),
      el('button', { class: 'btn btn-sm btn-primary', text: '生成并保存', onClick: generate }),
    ]),
  ]);

  // ============ 渲染顺序 ============
  view.appendChild(topFixedBar);
  view.appendChild(el('div', { style: { marginBottom: '8px', fontSize: '13px', color: 'var(--text-2)' }, text: '选择参与合并的文件（点击可切换选中，右上角可移除）：' }));
  view.appendChild(pickerContainer);
  view.appendChild(styleRow);
  view.appendChild(el('div', { class: 'compose-row' }, [el('span', { class: 'tape-label', text: '宽度' }), widthInput]));
  view.appendChild(el('div', { class: 'compose-row' }, [el('span', { class: 'tape-label', text: '间距' }), gapInput]));
  view.appendChild(el('div', { class: 'compose-row' }, [el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [indexCheck, '显示序号'])]));
  view.appendChild(el('div', { style: { margin: '16px 0', textAlign: 'center' } }, [preview]));

  // ============ 预览函数 ============
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreview, 300);
  }

  async function loadAllImages() {
    const ids = Array.from(selectedIds);
    const result = [];

    for (const id of ids) {
      const ext = externalFiles.find(f => f.id === id);
      if (ext) {
        if (ext.type === 'pdf') {
          const buf = await ext.blob.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 2 });
            const c = document.createElement('canvas');
            c.width = vp.width; c.height = vp.height;
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            const url = c.toDataURL('image/png');
            const im = new Image();
            im.src = url;
            await new Promise(r => { im.onload = r; });
            result.push({ img: im, width: im.width, height: im.height, url, sourceId: id, pageNum: i });
          }
        } else {
          const url = URL.createObjectURL(ext.blob);
          const im = new Image();
          im.src = url;
          await new Promise(r => { im.onload = r; });
          result.push({ img: im, width: im.width, height: im.height, url, sourceId: id });
        }
        continue;
      }

      const rec = await getImageCached(id);
      if (!rec) continue;

      if (rec.type === 'pdf_placeholder' && rec.pdfId) {
        const { dbGet } = await import('../db.js');
        const pdfRec = await dbGet('pdfs', rec.pdfId);
        if (!pdfRec || !pdfRec.blob) continue;

        const buf = await pdfRec.blob.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 2 });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          const url = c.toDataURL('image/png');
          const im = new Image();
          im.src = url;
          await new Promise(r => { im.onload = r; });
          result.push({ img: im, width: im.width, height: im.height, url, sourceId: id, pageNum: i });
        }
        continue;
      }

      const blob = rec.annotatedBlob || rec.originalBlob;
      if (!(blob instanceof Blob) || blob.size === 0) continue;
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.src = url;
      await new Promise(r => { im.onload = r; });
      result.push({ img: im, width: im.width, height: im.height, url, sourceId: id });
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
      previewCtx.fillText('没有图片可合并', 200, 100);
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

  async function generate() {
    if (loadedImages.length === 0) loadedImages = await loadAllImages();
    if (loadedImages.length === 0) { toastError('没有文件可合并'); return; }
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
        sourceImageIds: Array.from(selectedIds),
      });

      let savedToPoint = false;
      await new Promise(resolve => {
        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
          el('div', { class: 'confirm-box', style: { maxWidth: '360px' } }, [
            el('h3', { text: '✅ 合并完成' }),
            el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' }, text: '已合并，请选择操作：' }),
            el('div', { class: 'confirm-actions', style: { flexDirection: 'column', gap: '8px', marginTop: '12px', alignItems: 'stretch' } }, [
              el('button', {
                class: 'btn btn-primary', text: '📌 保存到当前知识点',
                onClick: () => {
                  store.addCompositeToPoint(pointId, newId);
                  savedToPoint = true;
                  mask.remove();
                  toastSuccess('已保存到当前知识点');
                  navigate(`#/chapter/${point.chapterId}`);
                  resolve();
                },
              }),
              el('button', {
                class: 'btn btn-ghost', text: '📄 导出为 PDF',
                onClick: async () => {
                  try {
                    if (!window.PDFLib) { toastError('PDF 库未加载'); return; }
                    const { PDFDocument } = window.PDFLib;
                    const pdfDoc = await PDFDocument.create();
                    const imgBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
                    const imgBuf = await imgBlob.arrayBuffer();
                    const pdfImg = await pdfDoc.embedJpg(imgBuf);
                    const A4W = 595.28;
                    const scale = A4W / c.width;
                    const A4H = c.height * scale;
                    const page = pdfDoc.addPage([A4W, A4H]);
                    page.drawImage(pdfImg, { x: 0, y: 0, width: A4W, height: A4H });
                    const bytes = await pdfDoc.save();
                    const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
                    await downloadWithPicker(pdfBlob, `合并_${Date.now()}.pdf`, 'application/pdf', ['.pdf']);
                  } catch (err) {
                    toastError('导出 PDF 失败: ' + err.message);
                  }
                },
              }),
              el('button', {
                class: 'btn btn-ghost', text: '🖼 直接下载为图片',
                onClick: async () => {
                  await downloadWithPicker(blob, `合并_${Date.now()}.png`, 'image/png', ['.png']);
                },
              }),
              el('button', {
                class: 'btn btn-ghost', text: '🗂 打包为图片 ZIP',
                onClick: async () => {
                  try {
                    if (!window.JSZip) { toastError('JSZip 未加载'); return; }
                    const zip = new window.JSZip();
                    zip.file('合并.png', blob);
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    await downloadWithPicker(zipBlob, `合并_${Date.now()}.zip`, 'application/zip', ['.zip']);
                  } catch (err) {
                    toastError('打包失败: ' + err.message);
                  }
                },
              }),
                            el('button', {
                class: 'btn btn-ghost', text: '取消',
                onClick: async () => {
                  mask.remove();
                  try {
                    await dbDelete('images', newId);
                  } catch (e) { console.warn('清理合并图失败:', e); }
                  toastSuccess('已取消');
                  resolve();
                },
              }),
            ]),
          ]),
        ]);
        document.body.appendChild(mask);
      });

      if (savedToPoint) {
        // 已在按钮里跳转
      }
      return;

    } catch (e) {
      toastError('合并失败：' + e.message);
    }
  }

  drawPreview();
}

// ============ 统一下载封装（优先唤起系统「另存为」） ============
async function downloadWithPicker(blob, filename, mimeType, extensions) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: '导出文件', accept: { [mimeType]: extensions } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toastSuccess('导出成功');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('另存为失败，降级为普通下载', err);
    }
  }
  // 降级：浏览器默认下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
  toastSuccess('已开始下载（已保存至默认下载目录）');
}