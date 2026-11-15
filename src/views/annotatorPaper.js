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
  let selectedShapes = [];  // [{ paper, shape }]
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
      const gapY = p.lineGap || 24;
      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      ctx.lineWidth = 1;
      for (let y = gapY; y < p.h; y += gapY) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(p.w - 8, y);
        ctx.stroke();
      }
    } else if (p.style === 'grid') {
      const gapXY = p.lineGap || 16; // 👈 动态读取间距，默认 16
      ctx.strokeStyle = 'rgba(0,0,0,.06)';
      ctx.lineWidth = 1;
      for (let x = gapXY; x < p.w; x += gapXY) {
        ctx.beginPath();
        ctx.moveTo(x, 8);
        ctx.lineTo(x, p.h - 8);
        ctx.stroke();
      }
      for (let y = gapXY; y < p.h; y += gapXY) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(p.w - 8, y);
        ctx.stroke();
      }
    }

    // 文字
    if (p.text && p.textVisible !== false) {
      const ts = p.textStyle || {};
      const fs = ts.fontSize || 16;
      const fontFamily = ts.fontFamily || 'sans-serif';
      const lineHeight = ts.lineHeight || 1.5;
      const align = ts.align || 'left';
      ctx.font = `${fs}px ${fontFamily}`;
      ctx.fillStyle = ts.color || '#2B2D42';
      ctx.textBaseline = 'top';
      const lines = wrapText(ctx, p.text, p.w - 16);
      lines.forEach((line, i) => {
        const displayLine = line.replace(/ /g, '\u00A0');
        let tx = 8;
        if (align === 'center') {
          tx = (p.w - ctx.measureText(line).width) / 2;
        } else if (align === 'right') {
          tx = p.w - 8 - ctx.measureText(line).width;
        }
        ctx.fillText(displayLine, tx, 8 + i * fs * lineHeight);
      });
    }

    // ============ 纸张上的笔迹（只画 pen，不画选中框） ============
    if (p.strokes && p.strokes.length) {
      p.strokes.forEach(s => {
        if (s.type !== 'pen') return;
        if (s.visible === false) return;
        if (!s.points || s.points.length < 2) return;
        ctx.save();
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

    // ============ 纸张上的形状 ============
    if (p.shapes && p.shapes.length) {
      p.shapes.forEach(s => {
        if (s.visible === false) return;
        ctx.save();
        if (s.rotation) {
          const cx = (s.x1 + s.x2) / 2;
          const cy = (s.y1 + s.y2) / 2;
          ctx.translate(cx, cy);
          ctx.rotate(s.rotation * Math.PI / 180);
          ctx.translate(-cx, -cy);
        }

        if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha = s.opacity;
        ctx.strokeStyle = s.borderColor || '#2B2D42';
        if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha = s.opacity;
        ctx.strokeStyle = s.borderColor || '#2B2D42';
        ctx.fillStyle = s.fillColor || 'transparent';
        ctx.lineWidth = (s.width || 4) / Math.sqrt(W / 800);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const x1 = s.x1, y1 = s.y1, x2 = s.x2, y2 = s.y2;
        const x = Math.min(x1, x2), y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        const cx = x + w / 2, cy = y + h / 2;

        const fillIf = (pathFn) => {
          if (s.fillColor && s.fillColor !== 'transparent' && s.fillColor !== 'none') {
            ctx.beginPath(); pathFn(); ctx.fill();
          }
        };

        if (s.type === 'rect') {
          fillIf(() => ctx.rect(x, y, w, h));
          ctx.strokeRect(x, y, w, h);
        } else if (s.type === 'circle') {
          fillIf(() => ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2));
          ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (s.type === 'line') {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        } else if (s.type === 'arrow') {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(12, ctx.lineWidth * 4);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(ang - Math.PI / 7), y2 - headLen * Math.sin(ang - Math.PI / 7));
          ctx.lineTo(x2 - headLen * Math.cos(ang + Math.PI / 7), y2 - headLen * Math.sin(ang + Math.PI / 7));
          ctx.closePath();
          ctx.fillStyle = s.borderColor || '#2B2D42';
          ctx.fill();
        } else if (s.type === 'triangle') {
          fillIf(() => { ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); });
          ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.stroke();
        } else if (s.type === 'star') {
          const pts = []; const outerR = Math.min(w, h) / 2; const innerR = outerR * 0.4;
          for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const a = -Math.PI / 2 + i * Math.PI / 5;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
          }
          fillIf(() => { ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); });
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); ctx.stroke();
        } else if (s.type === 'wave') {
          const amp = s.waveAmplitude || 8;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy);
          const steps = Math.max(20, Math.floor(len / 4));
          const nx = -dy / len, ny = dx / len;
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const bx = x1 + dx * t, by = y1 + dy * t;
            const wv = Math.sin(t * Math.PI * 8) * amp;
            const px = bx + nx * wv, py = by + ny * wv;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else if (s.type === 'check') {
          ctx.beginPath();
          ctx.moveTo(x + w * 0.2, y + h * 0.5);
          ctx.lineTo(x + w * 0.4, y + h * 0.8);
          ctx.lineTo(x + w * 0.85, y + h * 0.2);
          ctx.stroke();
        } else if (s.type === 'cross') {
          ctx.beginPath();
          ctx.moveTo(x + w * 0.2, y + h * 0.2); ctx.lineTo(x + w * 0.8, y + h * 0.8);
          ctx.moveTo(x + w * 0.8, y + h * 0.2); ctx.lineTo(x + w * 0.2, y + h * 0.8);
          ctx.stroke();
        } else if (s.type === 'ban') {
          const r = Math.min(w, h) / 2;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
          const a = Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(cx - r * Math.cos(a), cy - r * Math.sin(a));
          ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
          ctx.stroke();
        }

        // 选中高亮
        if (selectedShapes.some(sel => sel.shape === s && sel.paper === p)) {
          ctx.save();
          const bx1 = Math.min(s.x1, s.x2), by1 = Math.min(s.y1, s.y2);
          const bw = Math.abs(s.x2 - s.x1), bh = Math.abs(s.y2 - s.y1);
          ctx.strokeStyle = '#EF476F';
          ctx.lineWidth = 2 / Math.sqrt(W / 800);
          ctx.setLineDash([6 / Math.sqrt(W / 800), 4 / Math.sqrt(W / 800)]);
          ctx.strokeRect(bx1 - 4, by1 - 4, bw + 8, bh + 8);
          ctx.setLineDash([]);
          const hs = 10 / Math.sqrt(W / 800);
          [[bx1, by1], [bx1 + bw, by1], [bx1 + bw, by1 + bh], [bx1, by1 + bh]].forEach(([hx, hy]) => {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#EF476F';
            ctx.lineWidth = 2 / Math.sqrt(W / 800);
            ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
            ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
          });
          ctx.restore();
        }

        ctx.restore();
      });
    }

    // 纸张锁定图标
    if (p.locked) {
      ctx.fillStyle = '#EF476F';
      ctx.font = '14px sans-serif';
      ctx.fillText('🔒', p.w - 16, -4);
    }

    ctx.restore();
  }

  // ============ 选中框 ============
  function drawSelection(ctx, p) {
    if (window.__isSavingImage) return;
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
      shapes: [],
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

    // 1. 获取要删除的纸张 ID
    const paperId = selected.id;

    // 2. 从全局胶带池中，清理绑定在这张纸上的胶带
    if (window.__tapeLayer) {
      const tapes = window.__tapeLayer.getTapes();
      const remainTapes = tapes.filter(t => t._boundPaperId !== paperId);
      if (tapes.length !== remainTapes.length) {
        window.__tapeLayer.restore(remainTapes); // 更新全局胶带池并保存
      }
    }

    // 3. 删除纸张本体
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
      if (!window.pdfjsLib) { alert('PDF.js 未加载'); return; }

      try {
        const buf = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const totalPages = pdf.numPages;
        const selected = new Set();

        // 渲染缩略图
        const grid = el('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px', maxHeight: '50vh', overflowY: 'auto', margin: '12px 0',
          },
        });

        const thumbnails = [];
        for (let i = 1; i <= Math.min(totalPages, 60); i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 0.4 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

          const thumb = el('div', {
            style: {
              position: 'relative', cursor: 'pointer', borderRadius: '6px',
              overflow: 'hidden', border: '2px solid transparent',
            },
            onClick: () => {
              if (selected.has(i)) selected.delete(i);
              else selected.add(i);
              thumb.style.border = selected.has(i) ? '2px solid var(--primary)' : '2px solid transparent';
              updateCount();
            },
          }, [
            el('img', { src: dataUrl, style: { width: '100%', display: 'block' } }),
            el('div', {
              style: {
                position: 'absolute', top: '4px', left: '4px',
                background: 'rgba(0,0,0,.6)', color: '#fff',
                fontSize: '10px', padding: '1px 4px', borderRadius: '3px',
              },
              text: String(i),
            }),
          ]);
          grid.appendChild(thumb);
          thumbnails.push({ pageNum: i, thumb });
        }

        const countEl = el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '未选择' });
        const updateCount = () => {
          countEl.textContent = selected.size > 0 ? `已选 ${selected.size} 页` : '未选择';
        };

        const mask = el('div', { class: 'confirm-mask' }, [
          el('div', { class: 'confirm-box', style: { maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto' } }, [
            el('h3', { text: '从 PDF 导入（共 ' + totalPages + ' 页）' }),
            el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' } }, [
              el('button', {
                class: 'btn btn-sm btn-ghost', text: '全选',
                onClick: () => {
                  thumbnails.forEach(t => selected.add(t.pageNum));
                  thumbnails.forEach(t => t.thumb.style.border = '2px solid var(--primary)');
                  updateCount();
                },
              }),
              el('button', {
                class: 'btn btn-sm btn-ghost', text: '全不选',
                onClick: () => {
                  selected.clear();
                  thumbnails.forEach(t => t.thumb.style.border = '2px solid transparent');
                  updateCount();
                },
              }),
              countEl,
            ]),
            grid,
            el('div', { class: 'confirm-actions' }, [
              el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
              el('button', {
                class: 'btn btn-primary', text: '导入选中页',
                onClick: async () => {
                  if (selected.size === 0) { alert('请先选择页面'); return; }
                  const pages = [...selected].sort((a, b) => a - b);
                  mask.remove();
                  for (const pageNum of pages) {
                    const page = await pdf.getPage(pageNum);
                    const vp = page.getViewport({ scale: 2 });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(vp.width);
                    canvas.height = Math.round(vp.height);
                    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
                    const bgUrl = canvas.toDataURL('image/jpeg', 0.85);
                    const p = addPaper('blank');
                    p.w = Math.min(canvas.width * 0.5, W * 0.8);
                    p.h = Math.min(canvas.height * 0.5, H * 0.8);
                    p.bgColor = '#FFFFFF';
                    p.pdfImage = bgUrl;
                  }
                  save();
                  redraw();
                  renderPaperToolbar();
                  toastSuccess(`已导入 ${pages.length} 页`);
                },
              }),
            ]),
          ]),
        ]);
        document.body.appendChild(mask);
      } catch (e) {
        alert('PDF 导入失败：' + e.message);
      }
    };
    input.click();
  }

  // ============ 从图片导入为纸张（支持多选） ============
  function openImageImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;   // 关键：允许多选
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      for (const f of files) {
        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              const p = addPaper('blank');
              p.w = Math.min(img.width * 0.5, W * 0.8);
              p.h = Math.min(img.height * 0.5, H * 0.8);
              p.bgColor = '#FFFFFF';
              p.bgImage = reader.result;
              resolve();
            };
            img.onerror = resolve;
            img.src = reader.result;
          };
          reader.onerror = resolve;
          reader.readAsDataURL(f);
        });
      }

      save();
      redraw();
      renderPaperToolbar();
      toastSuccess(`已导入 ${files.length} 张图片`);
    };
    input.click();
  }

  // ============ 工具栏 ============
  function renderPaperToolbar() {
    const bar = el('div', { class: 'tape-toolbar' });

    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('button', { class: 'tape-chip', text: '📋 纸张列表', onClick: () => openPaperListManager() }),
      el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: `共 ${papers.length} 张` })
    ]));

    const addRow = el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '添加' })]);
    PAPER_STYLES.slice(0, 4).forEach(s => {
      addRow.appendChild(el('button', { class: 'tape-chip', style: { padding: '3px 8px', fontSize: '11px', minHeight: '26px' }, text: s.label, onClick: () => addPaper(s.id) }));
    });
    bar.appendChild(addRow);

    const sel = getSelected();
    if (sel) {
      const smallBtn = { padding: '3px 8px', fontSize: '11px', minHeight: '26px' };

      // 操作按钮
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('button', { class: 'tape-chip', text: '✏️ 文字', onClick: () => { if (window.__openPaperTextEditor) window.__openPaperTextEditor(sel); } }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '📋 复制', onClick: () => { if (window.__copyPaper) window.__copyPaper(sel); } }),
        el('button', { class: 'tape-chip' + (sel.locked ? ' active' : ''), style: smallBtn, text: sel.locked ? '🔒' : '🔓', onClick: () => { sel.locked = !sel.locked; save(); redraw(); renderPaperToolbar(); } }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '⬆️ 置顶', onClick: () => { bringToFront(sel); renderPaperToolbar(); } }),
        el('button', { class: 'tape-chip', style: smallBtn, text: '🗑 删除', onClick: () => { if (confirm('删除？')) { removeSelected(); renderPaperToolbar(); } } }),
      ]));

      // 样式切换
      if (!sel.pdfImage && !sel.bgImage) {
        bar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '样式' }),
          ...[
            { id: 'blank', label: '🧾 空白' },
            { id: 'lined', label: '📝 横线' },
            { id: 'grid', label: '🗒 方格' },
          ].map(s => el('button', {
            class: 'tape-chip' + (sel.style === s.id ? ' active' : ''),
            style: { padding: '3px 8px', fontSize: '11px', minHeight: '26px' },
            text: s.label,
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();

              sel.style = s.id;
              if (s.id === 'lined') sel.lineGap = 24;
              if (s.id === 'grid') sel.lineGap = 16;

              save();
              redraw();
              renderPaperToolbar();
            },
          })),
        ]));
      }

      // 行距调节
      if (sel.style === 'lined' || sel.style === 'grid') {
        const defaultGap = sel.style === 'lined' ? 24 : 16;
        const gapNum = el('input', { type: 'number', min: '8', max: '100', value: String(sel.lineGap || defaultGap), style: { width: '48px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' } });
        const gapRange = el('input', { type: 'range', min: '8', max: '100', value: String(sel.lineGap || defaultGap), style: { flex: '1', minWidth: '80px' } });

        gapRange.oninput = (e) => { sel.lineGap = Number(e.target.value); gapNum.value = sel.lineGap; save(); redraw(); };
        gapNum.oninput = (e) => { sel.lineGap = Number(e.target.value); gapRange.value = sel.lineGap; save(); redraw(); };

        bar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: sel.style === 'lined' ? '行距' : '格子' }),
          gapRange, gapNum,
        ]));
      }

      // 透明度
      const opNum = el('input', { type: 'number', min: '0.1', max: '1', step: '0.1', value: String(sel.opacity !== undefined ? sel.opacity : 0.95), style: { width: '48px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' } });
      const opRange = el('input', { type: 'range', min: '0.1', max: '1', step: '0.1', value: String(sel.opacity !== undefined ? sel.opacity : 0.95), style: { flex: '1' } });
      opRange.oninput = (e) => { sel.opacity = Number(e.target.value); opNum.value = sel.opacity; save(); redraw(); };
      opNum.oninput = (e) => { sel.opacity = Number(e.target.value); opRange.value = sel.opacity; save(); redraw(); };
      bar.appendChild(el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '透明' }), opRange, opNum]));

      // 旋转
      const rotNum = el('input', { type: 'number', min: '-180', max: '180', step: '15', value: String(sel.rotation || 0), style: { width: '56px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' } });
      const rotRange = el('input', { type: 'range', min: '-180', max: '180', step: '15', value: String(sel.rotation || 0), style: { flex: '1' } });
      rotRange.oninput = (e) => { sel.rotation = Number(e.target.value); rotNum.value = sel.rotation; save(); redraw(); };
      rotNum.oninput = (e) => { sel.rotation = Number(e.target.value); rotRange.value = sel.rotation; save(); redraw(); };
      bar.appendChild(el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '旋转' }), rotRange, rotNum, el('span', { text: '°' })]));
    }

    // 👇 终极修复：将生成的新工具栏替换掉页面上旧的
    const oldBar = document.querySelector('.tape-toolbar');
    if (oldBar && oldBar !== bar) {
      oldBar.replaceWith(bar);
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
    drawPaperRaw: (ctx, p) => drawPaper(ctx, p),
    drawSelection,
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

    // ============ 形状拖动 / 缩放 ============
    startShapeDrag: (selection, startX, startY) => {
      const { paper, shape } = selection;
      if (shape.locked) return null;
      const orig = { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
      return {
        move(clientX, clientY) {
          const dx = clientX - startX;
          const dy = clientY - startY;
          shape.x1 = orig.x1 + dx;
          shape.y1 = orig.y1 + dy;
          shape.x2 = orig.x2 + dx;
          shape.y2 = orig.y2 + dy;
          redraw();
        },
        end() { save(); },
      };
    },
    startShapeResize: (selection, handleId, startX, startY) => {
      const { paper, shape } = selection;
      if (shape.locked) return null;
      const orig = { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
      return {
        move(clientX, clientY) {
          const dx = clientX - startX;
          const dy = clientY - startY;
          if (handleId === 'nw') {
            shape.x1 = orig.x1 + dx; shape.y1 = orig.y1 + dy;
          } else if (handleId === 'ne') {
            shape.x2 = orig.x2 + dx; shape.y1 = orig.y1 + dy;
          } else if (handleId === 'se') {
            shape.x2 = orig.x2 + dx; shape.y2 = orig.y2 + dy;
          } else if (handleId === 'sw') {
            shape.x1 = orig.x1 + dx; shape.y2 = orig.y2 + dy;
          }
          redraw();
        },
        end() { save(); },
      };
    },
    hitShapeHandle: (x, y) => {
      if (selectedShapes.length !== 1) return null;
      const { paper, shape } = selectedShapes[0];
      const relX = x - paper.x;
      const relY = y - paper.y;
      const bx1 = Math.min(shape.x1, shape.x2), by1 = Math.min(shape.y1, shape.y2);
      const bw = Math.abs(shape.x2 - shape.x1), bh = Math.abs(shape.y2 - shape.y1);
      const handles = [
        { id: 'nw', x: bx1, y: by1 },
        { id: 'ne', x: bx1 + bw, y: by1 },
        { id: 'se', x: bx1 + bw, y: by1 + bh },
        { id: 'sw', x: bx1, y: by1 + bh },
      ];
      const r = 12 / Math.sqrt(W / 800);
      for (const h of handles) {
        if (Math.hypot(relX - h.x, relY - h.y) < r) return h.id;
      }
      return null;
    },

    setShapeSelection: (list) => {
      selectedShapes = list;
      redraw();
    },
    getSelectedShapes: () => selectedShapes,
    clearShapeSelection: () => { selectedShapes = []; redraw(); },
  };
}
