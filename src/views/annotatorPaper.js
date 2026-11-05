// src/views/annotatorPaper.js
// 纸张图层：便签、便利贴、横线、方格、标签条、空白

import { el } from '../utils/dom.js';
import { renderColorPicker } from '../ui/colorPicker.js';

const PAPER_STYLES = [
  { id: 'note', label: '📄 便签', bg: '#FDF6E3', w: 200, h: 200 },
  { id: 'sticky', label: '🟨 便利贴', bg: '#FFF3B0', w: 150, h: 150 },
  { id: 'lined', label: '📝 横线', bg: '#FFFFFF', w: 300, h: 400 },
  { id: 'grid', label: '🗒 方格', bg: '#FFFFFF', w: 200, h: 200 },
  { id: 'tag', label: '🏷 标签条', bg: '#FFFFFF', w: 200, h: 40 },
  { id: 'blank', label: '🧾 空白', bg: '#FFFFFF', w: 200, h: 200 },
  { id: 'a4', label: '📃 A4 纸', bg: '#FFFFFF', w: 248, h: 351 },
  { id: 'a5', label: '📃 A5 纸', bg: '#FFFFFF', w: 175, h: 248 },
  { id: 'square', label: '⬜ 正方形', bg: '#FFFFFF', w: 200, h: 200 },
  { id: 'wide', label: '▭ 宽矩形', bg: '#FFFFFF', w: 300, h: 150 },
  { id: 'tall', label: '▯ 高矩形', bg: '#FFFFFF', w: 150, h: 300 },
];

export function createPaperLayer({ canvas, width, height, imageId, store, textCanvas, textLayer }) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    canvas = document.createElement('canvas');
    canvas.width = width || 1;
    canvas.height = height || 1;
  }

  const ctx = canvas.getContext('2d');
  const W = width;
  const H = height;

  let papers = [];
  let selected = null;
  let currentTool = null;

  // ============ 加载 / 保存 ============
  function load() {
    const saved = store.getPaper ? store.getPaper(imageId) : null;
    if (saved && Array.isArray(saved)) {
      papers = saved;
    } else {
      try {
        const raw = localStorage.getItem('kg_paper_' + imageId);
        if (raw) papers = JSON.parse(raw);
      } catch { papers = []; }
    }
  }

  function save() {
    if (store.savePaper) {
      store.savePaper(imageId, papers);
    } else {
      localStorage.setItem('kg_paper_' + imageId, JSON.stringify(papers));
    }
  }

  // ============ 换行 ============
  function wrapText(ctx, text, maxWidth) {
    if (!text) return [];
    const lines = [];
    text.split('\n').forEach(line => {
      if (line.length === 0) { lines.push(''); return; }
      let current = '';
      for (const ch of line) {
        const test = current + ch;
        if (ctx.measureText(test).width > maxWidth && current.length > 0) {
          lines.push(current);
          current = ch;
        } else {
          current = test;
        }
      }
      if (current.length > 0) lines.push(current);
    });
    return lines;
  }

  // ============ 绘制单张纸 ============
  function drawPaper(ctx, p) {
    if (p.visible === false) return;

    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.rotate((p.rotation || 0) * Math.PI / 180);
    ctx.translate(-p.w / 2, -p.h / 2);

    // 背景
    ctx.globalAlpha = p.opacity !== undefined ? p.opacity : 0.95;
    ctx.fillStyle = p.bgColor || '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(0, 0, p.w, p.h, 8);
    ctx.fill();

    // PDF / 图片背景
    if (p.pdfImage || p.bgImage) {
      const src = p.pdfImage || p.bgImage;
      if (!p._bgImg || p._bgImgSrc !== src) {
        p._bgImg = new Image();
        p._bgImgSrc = src;
        p._bgImg.src = src;
      }
      if (p._bgImg.complete && p._bgImg.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(0, 0, p.w, p.h, 8);
        ctx.clip();
        ctx.drawImage(p._bgImg, 0, 0, p.w, p.h);
        ctx.restore();
      }
    }

    ctx.globalAlpha = 1;

    // 边框
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, p.w, p.h, 8);
    ctx.stroke();

    // 样式线
    if (p.style === 'lined') {
      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      ctx.lineWidth = 1;
      for (let y = 24; y < p.h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(p.w - 8, y);
        ctx.stroke();
      }
    } else if (p.style === 'grid') {
      ctx.strokeStyle = 'rgba(0,0,0,.06)';
      ctx.lineWidth = 1;
      for (let x = 16; x < p.w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, p.h - 8);
        ctx.stroke();
      }
      for (let y = 16; y < p.h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(p.w - 8, y);
        ctx.stroke();
      }
    }

    // 文字
    if (p.text) {
      const fs = p.textStyle && p.textStyle.fontSize ? p.textStyle.fontSize : 16;
      const fontFamily = p.textStyle && p.textStyle.fontFamily ? p.textStyle.fontFamily : 'sans-serif';
      ctx.font = `${fs}px ${fontFamily}`;
      ctx.fillStyle = (p.textStyle && p.textStyle.color) || '#2B2D42';
      ctx.textBaseline = 'top';
      const lines = wrapText(ctx, p.text, p.w - 16);
      lines.forEach((line, i) => {
        const displayLine = line.replace(/ /g, '\u00A0');
        ctx.fillText(displayLine, 8, 8 + i * (fs + 4));
      });
    }

    // 纸张上的笔迹（只画笔迹，不画胶带）
    if (p.strokes && p.strokes.length) {
      p.strokes.forEach(s => {
        if (s.type !== 'pen' && s.type !== 'eraser') return;
        if (!s.points || s.points.length < 2) return;
        ctx.save();
        ctx.globalCompositeOperation = s.type === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = s.color || '#2B2D42';
        ctx.lineWidth = s.width || 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
        ctx.restore();
      });
    }

    // 纸张上的胶带：用 tapeLayer 的完整绘制
    if (p.tapes && p.tapes.length && window.__drawTapeOnPaper) {
      p.tapes.forEach(t => {
        if (!t.points || t.points.length < 2) return;
        window.__drawTapeOnPaper(ctx, t);
      });
    }

    // 锁定图标
    if (p.locked) {
      ctx.fillStyle = '#EF476F';
      ctx.font = '14px sans-serif';
      ctx.fillText('🔒', p.w - 16, -4);
    }

    ctx.restore();
  }

  // ============ 选中框 ============
  function drawSelection(ctx, p) {
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.rotate((p.rotation || 0) * Math.PI / 180);
    ctx.translate(-p.w / 2, -p.h / 2);

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0, 0, p.w, p.h);
    ctx.setLineDash([]);

    // 8 个控制点
    [[0, 0], [p.w / 2, 0], [p.w, 0], [p.w, p.h / 2], [p.w, p.h], [p.w / 2, p.h], [0, p.h], [0, p.h / 2]].forEach(([x, y]) => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 2;
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    });

    // 旋转手柄
    ctx.beginPath();
    ctx.moveTo(p.w / 2, 0);
    ctx.lineTo(p.w / 2, -20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.w / 2, -20, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#3B82F6';
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // ============ 重绘 ============
  function redraw() {
    ctx.clearRect(0, 0, W, H);
    papers.forEach(p => {
      if (p.visible === false) return;
      drawPaper(ctx, p);
    });
    if (selected) drawSelection(ctx, selected);
  }

  // ============ 命中检测 ============
  function hitTest(x, y) {
    for (let i = papers.length - 1; i >= 0; i--) {
      const p = papers[i];
      if (p.visible === false) continue;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const angle = -(p.rotation || 0) * Math.PI / 180;
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle) + p.w / 2;
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle) + p.h / 2;
      if (lx >= 0 && lx <= p.w && ly >= 0 && ly <= p.h) return p;
    }
    return null;
  }

  // ============ 选中 ============
  function select(p) {
    selected = p;
    redraw();
  }

  function getSelected() {
    return selected;
  }

  // ============ 控制点 ============
  function getHandles() {
    if (!selected) return [];
    const p = selected;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const angle = (p.rotation || 0) * Math.PI / 180;
    const local = [
      { id: 'nw', x: 0, y: 0 },
      { id: 'n', x: p.w / 2, y: 0 },
      { id: 'ne', x: p.w, y: 0 },
      { id: 'e', x: p.w, y: p.h / 2 },
      { id: 'se', x: p.w, y: p.h },
      { id: 's', x: p.w / 2, y: p.h },
      { id: 'sw', x: 0, y: p.h },
      { id: 'w', x: 0, y: p.h / 2 },
    ];
    return local.map(h => {
      const lx = h.x - p.w / 2;
      const ly = h.y - p.h / 2;
      const rx = lx * Math.cos(angle) - ly * Math.sin(angle) + cx;
      const ry = lx * Math.sin(angle) + ly * Math.cos(angle) + cy;
      return { id: h.id, x: rx, y: ry };
    });
  }

  // ============ 调整大小 ============
  function startResize(handleId, startX, startY) {
    const sel = getSelected();
    if (!sel || sel.locked) return null;
    const orig = { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
    return {
      move(clientX, clientY) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (handleId === 'se') { sel.w = Math.max(60, orig.w + dx); sel.h = Math.max(30, orig.h + dy); }
        else if (handleId === 'sw') { sel.x = orig.x + dx; sel.w = Math.max(60, orig.w - dx); sel.h = Math.max(30, orig.h + dy); }
        else if (handleId === 'ne') { sel.y = orig.y + dy; sel.w = Math.max(60, orig.w + dx); sel.h = Math.max(30, orig.h - dy); }
        else if (handleId === 'nw') { sel.x = orig.x + dx; sel.y = orig.y + dy; sel.w = Math.max(60, orig.w - dx); sel.h = Math.max(30, orig.h - dy); }
        else if (handleId === 'n') { sel.y = orig.y + dy; sel.h = Math.max(30, orig.h - dy); }
        else if (handleId === 's') { sel.h = Math.max(30, orig.h + dy); }
        else if (handleId === 'w') { sel.x = orig.x + dx; sel.w = Math.max(60, orig.w - dx); }
        else if (handleId === 'e') { sel.w = Math.max(60, orig.w + dx); }
        redraw();
      },
      end() { save(); },
    };
  }

  // ============ 旋转 ============
  function startRotate(startX, startY) {
    if (!selected || selected.locked) return null;
    const cx = selected.x + selected.w / 2;
    const cy = selected.y + selected.h / 2;
    const startAngle = Math.atan2(startY - cy, startX - cx);
    const origRotation = selected.rotation || 0;
    return {
      move(clientX, clientY) {
        const angle = Math.atan2(clientY - cy, clientX - cx);
        let deg = origRotation + (angle - startAngle) * 180 / Math.PI;
        deg = Math.round(deg / 15) * 15;
        selected.rotation = deg;
        redraw();
      },
      end() { save(); },
    };
  }

  // ============ 创建 ============
  function addPaper(styleId) {
    const style = PAPER_STYLES.find(s => s.id === styleId) || PAPER_STYLES[0];
    const p = {
      id: crypto.randomUUID(),
      x: W * 0.3,
      y: H * 0.3,
      w: Math.min(style.w || 200, W * 0.5),
      h: Math.min(style.h || 200, H * 0.5),
      bgColor: style.bg,
      text: '',
      textStyle: { fontSize: 16, fontFamily: 'sans-serif', color: '#2B2D42' },
      rotation: 0,
      opacity: 0.95,
      visible: true,
      locked: false,
      strokes: [],
      tapes: [],
    };
    papers.push(p);
    selected = p;
    save();
    redraw();
    return p;
  }

  // ============ 删除 ============
  function removeSelected() {
    if (!selected || selected.locked) return;
    const idx = papers.indexOf(selected);
    if (idx >= 0) papers.splice(idx, 1);
    selected = null;
    save();
    redraw();
  }

  function bringToFront(paper) {
    const idx = papers.indexOf(paper);
    if (idx < 0) return;
    papers.splice(idx, 1);
    papers.push(paper);
    save();
    redraw();
  }

  function sendToBack(paper) {
    const idx = papers.indexOf(paper);
    if (idx < 0) return;
    papers.splice(idx, 1);
    papers.unshift(paper);
    save();
    redraw();
  }

  // ============ 设置文字 ============
  function setText(text) {
    if (!selected) return;
    selected.text = text;
    save();
    redraw();
  }

  // ============ 设置样式 ============
  function setStyle(style) {
    if (!selected) return;
    if (style.bgColor) selected.bgColor = style.bgColor;
    if (style.textStyle) selected.textStyle = { ...selected.textStyle, ...style.textStyle };
    if (style.opacity !== undefined) selected.opacity = style.opacity;
    save();
    redraw();
  }

  // ============ 指针按下 ============
  function handlePointerDown(x, y) {
    if (currentTool === 'select') {
      const hit = hitTest(x, y);
      if (hit) {
        selected = hit;
        redraw();
      } else {
        selected = null;
        redraw();
      }
    }
  }

  // ============ 从 PDF 导入为纸张 ============
  async function openPdfImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!window.pdfjsLib) {
        alert('PDF.js 未加载');
        return;
      }
      try {
        const buf = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const c = canvas.getContext('2d');
        await page.render({ canvasContext: c, viewport: vp }).promise;
        const bgUrl = canvas.toDataURL('image/jpeg', 0.85);
        const p = addPaper('blank');
        p.w = Math.min(canvas.width * 0.5, W * 0.8);
        p.h = Math.min(canvas.height * 0.5, H * 0.8);
        p.bgColor = '#FFFFFF';
        p.pdfImage = bgUrl;
        save();
        redraw();
        renderPaperToolbar();
      } catch (e) {
        alert('PDF 导入失败：' + e.message);
      }
    };
    input.click();
  }

  // ============ 从图片导入为纸张 ============
  function openImageImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const p = addPaper('blank');
          p.w = Math.min(img.width * 0.5, W * 0.8);
          p.h = Math.min(img.height * 0.5, H * 0.8);
          p.bgColor = '#FFFFFF';
          p.bgImage = reader.result;
          save();
          redraw();
          renderPaperToolbar();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  // ============ 工具栏 ============
  function renderPaperToolbar() {
    const bar = el('div', { class: 'tape-toolbar' });

    // ============ 添加纸张：前 4 个 + 更多下拉 ============
    const addRow = el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '添加' }),
    ]);
    PAPER_STYLES.slice(0, 4).forEach(s => {
      addRow.appendChild(el('button', {
        class: 'tape-chip',
        style: { padding: '3px 8px', fontSize: '11px', minHeight: '26px' },
        text: s.label,
        onClick: () => addPaper(s.id),
      }));
    });
    const moreSelect = el('select', {
      style: { padding: '3px 6px', fontSize: '11px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' },
      onChange: (e) => {
        const v = e.target.value;
        if (!v) return;
        if (v === '__pdf__') openPdfImport();
        else if (v === '__image__') openImageImport();
        else addPaper(v);
        e.target.value = '';
      },
    }, [
      el('option', { value: '', text: '更多…' }),
      ...PAPER_STYLES.slice(4).map(s => el('option', { value: s.id, text: s.label })),
      el('option', { value: '__pdf__', text: '📄 从 PDF 导入' }),
      el('option', { value: '__image__', text: '🖼 从图片导入' }),
    ]);
    addRow.appendChild(moreSelect);
    bar.appendChild(addRow);

    // ============ 选中纸张时的操作 ============
    const sel = getSelected();
    if (sel) {
      const smallBtn = { padding: '3px 8px', fontSize: '11px', minHeight: '26px' };
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '选中' }),
        el('button', {
          class: 'tape-chip', style: smallBtn, text: '✏️ 编辑文字', onClick: () => {
            if (window.__openPaperTextEditor) window.__openPaperTextEditor(sel);
            else { const t = prompt('输入文字', sel.text || ''); if (t !== null) setText(t); }
          }
        }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '📋 复制', onClick: () => { if (window.__copyPaper) window.__copyPaper(sel); } }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '📥 粘贴', onClick: () => { if (window.__pasteClipboard) window.__pasteClipboard(); } }),
        el('button', { class: 'tape-chip' + (sel.locked ? ' active' : ''), style: smallBtn, text: sel.locked ? '🔒 已锁定' : '🔓 锁定', onClick: () => { sel.locked = !sel.locked; save(); redraw(); renderPaperToolbar(); } }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '⬆️ 置顶', onClick: () => { bringToFront(sel); renderPaperToolbar(); } }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '⬇️ 置底', onClick: () => { sendToBack(sel); renderPaperToolbar(); } }),
        el('button', {
          class: 'tape-chip', style: smallBtn, text: '🗑 删除', onClick: () => {
            if (sel.locked) { alert('已锁定'); return; }
            if (!confirm('确定删除？')) return;
            removeSelected();
          }
        }),
      ]));

      // ============ 透明度：滑块 + 数值 ============
      const opNum = el('input', {
        type: 'number', min: '0.1', max: '1', step: '0.1',
        value: String(sel.opacity !== undefined ? sel.opacity : 0.95),
        style: { width: '48px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
        onInput: (e) => {
          sel.opacity = Math.max(0.1, Math.min(1, Number(e.target.value) || 1));
          opRange.value = sel.opacity;
          save(); redraw();
        },
      });
      const opRange = el('input', {
        type: 'range', min: '0.1', max: '1', step: '0.1',
        value: String(sel.opacity !== undefined ? sel.opacity : 0.95),
        style: { flex: '1', minWidth: '80px' },
        onInput: (e) => { sel.opacity = Number(e.target.value); opNum.value = sel.opacity; save(); redraw(); },
      });
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '透明度' }),
        opRange, opNum,
      ]));

      // ============ 旋转：滑块 + 数值 ============
      const rotNum = el('input', {
        type: 'number', min: '-180', max: '180', step: '15',
        value: String(sel.rotation || 0),
        style: { width: '56px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
        onInput: (e) => {
          sel.rotation = Number(e.target.value) || 0;
          rotRange.value = sel.rotation;
          save(); redraw();
        },
      });
      const rotRange = el('input', {
        type: 'range', min: '-180', max: '180', step: '15',
        value: String(sel.rotation || 0),
        style: { flex: '1', minWidth: '80px' },
        onInput: (e) => { sel.rotation = Number(e.target.value); rotNum.value = sel.rotation; save(); redraw(); },
      });
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '旋转' }),
        rotRange, rotNum,
        el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: '°' }),
      ]));

      // ============ 背景色 ============
      const bgColorWrap = el('div');
      bgColorWrap.appendChild(renderColorPicker({
        current: sel.bgColor || '#FFFFFF',
        onChange: (c) => { sel.bgColor = c; save(); redraw(); },
      }));
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '背景色' }),
        bgColorWrap,
      ]));

      // 样式切换（只在非 PDF/图片背景时显示）
      if (!sel.pdfImage && !sel.bgImage) {
        bar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '样式' }),
          ...[
            { id: 'blank', label: '🧾 空白' },
            { id: 'lined', label: '📝 横线' },
            { id: 'grid', label: '🗒 方格' },
            { id: 'note', label: '📄 便签' },
            { id: 'sticky', label: '🟨 便利贴' },
          ].map(s => el('button', {
            class: 'tape-chip' + (sel.style === s.id ? ' active' : ''),
            style: { padding: '3px 8px', fontSize: '11px', minHeight: '26px' },
            text: s.label,
            onClick: () => {
              sel.style = s.id;
              save();
              redraw();
              renderPaperToolbar();
            },
          })),
        ]));
      }
    }

    return bar;
  }

  // ============ 纸张列表管理 ============
  function openPaperListManager() {
    const selected = new Set();
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

    function renderList() {
      list.innerHTML = '';
      if (papers.length === 0) {
        list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '还没有纸张' }));
        return;
      }
      papers.forEach((p, i) => {
        const checked = selected.has(p.id);
        const isFav = (p.favorited === true);
        list.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--bg)', borderRadius: '8px' },
        }, [
          el('input', {
            type: 'checkbox',
            checked: checked,
            onChange: (e) => {
              if (e.target.checked) selected.add(p.id);
              else selected.delete(p.id);
            },
          }),
          el('span', { style: { flex: '1', fontSize: '12px', color: 'var(--text-2)' }, text: `${i + 1}. ${(p.text || '空白纸张').slice(0, 20)}` }),
          el('button', {
            class: 'tape-chip' + (isFav ? ' active' : ''),
            text: isFav ? '⭐ 已收藏' : '☆ 收藏',
            onClick: () => {
              p.favorited = !p.favorited;
              save();
              renderList();
            },
          }),
          el('button', {
            class: 'tape-chip', text: '✏️ 编辑',
            onClick: () => {
              select(p);
              if (window.__openPaperTextEditor) window.__openPaperTextEditor(p);
              mask.remove();
            },
          }),
        ]));
      });
    }
    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
        el('h3', { text: '纸张列表' }),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { papers.forEach(p => selected.add(p.id)); renderList(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); renderList(); } }),
        ]),
        list,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '删除选中',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              if (!confirm(`删除 ${selected.size} 张纸？`)) return;
              selected.forEach(id => {
                const idx = papers.findIndex(p => p.id === id);
                if (idx >= 0) papers.splice(idx, 1);
              });
              selected.clear();
              save();
              redraw();
              mask.remove();
              if (typeof window.__updateSubToolbar === 'function') window.__updateSubToolbar();
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  }

  // ============ 初始化 ============
  load();
  redraw();

  return {
    redraw,
    hitTest,
    select,
    getSelected,
    getHandles,
    startResize,
    startRotate,
    addPaper,
    removeSelected,
    setText,
    setStyle,
    handlePointerDown,
    setTool(tool) { currentTool = tool; },
    getPapers: () => papers,
    save,
    restore(newPapers) { papers = newPapers; save(); redraw(); },
    setLocked(id, locked) {
      const p = papers.find(x => x.id === id);
      if (p) { p.locked = locked; save(); redraw(); }
    },
    isLocked(id) {
      const p = papers.find(x => x.id === id);
      return p ? !!p.locked : false;
    },
    renderPaperToolbar,
    PAPER_STYLES,
    bringToFront,
    sendToBack,
    openPaperListManager,
  };
}
