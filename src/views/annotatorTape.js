import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { uuid } from '../utils/id.js';
import { dbGet } from '../db.js';
import { renderColorPicker } from '../ui/colorPicker.js';

const TAPE_SHAPES = [
  { id: 'line-round', label: '╱ 圆头' },
  { id: 'line-square', label: '▬ 方头' },
  { id: 'rect', label: '▭ 矩形' },
  { id: 'circle', label: '○ 圆形' },
];
const TAPE_PATTERNS = [
  { id: 'solid', label: '纯色' },
  { id: 'dots', label: '波点' },
  { id: 'custom', label: '自定义' },
];

export function createTapeLayer(canvas, W, H, imageId) {
  const ctx = canvas.getContext('2d');
  let tapes = store.getTape(imageId);
  let tool = 'line-round';
  let pattern = 'solid';
  let color = '#FFD166';
  let width = 20;
  let patternImageId = null;

  function redraw() {
    ctx.clearRect(0, 0, W, H);
    tapes.forEach(t => {
      if (!t.visible) return;
      drawTape(ctx, t);
    });
  }

  function drawTape(ctx, t) {
    ctx.save();
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color;
    ctx.lineWidth = t.width;
    ctx.lineJoin = 'round';

    if (t.shape === 'line-round' || t.shape === 'line-square') {
      ctx.lineCap = t.shape === 'line-round' ? 'round' : 'butt';
      if (t.points.length < 2) { ctx.restore(); return; }
      ctx.beginPath();
      ctx.moveTo(t.points[0].x, t.points[0].y);
      for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
      ctx.stroke();
    } else if (t.shape === 'rect') {
      const p0 = t.points[0], p1 = t.points[t.points.length - 1];
      ctx.fillRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
    } else if (t.shape === 'circle') {
      const p0 = t.points[0], p1 = t.points[t.points.length - 1];
      const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t.pattern === 'dots') {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      const step = Math.max(6, t.width * 0.8);
      for (let x = 0; x < W; x += step) {
        for (let y = 0; y < H; y += step) {
          if (hitTape(t, x, y, 0)) {
            ctx.beginPath();
            ctx.arc(x, y, Math.max(2, t.width / 6), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    if (t.erasedPath && t.erasedPath.length) {
      ctx.globalCompositeOperation = 'destination-out';
      t.erasedPath.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  return {
    getTapes() { return tapes; },
    setTapes(t) { tapes = t; redraw(); },
    addTape(tape) { tapes.push(tape); store.saveTape(imageId, tapes); redraw(); },
    removeTape(id) { tapes = tapes.filter(t => t.id !== id); store.saveTape(imageId, tapes); redraw(); },
    toggleVisible(id) {
      const t = tapes.find(x => x.id === id);
      if (t) { t.visible = !t.visible; store.saveTape(imageId, tapes); redraw(); }
    },
    showAll() { tapes.forEach(t => t.visible = true); store.saveTape(imageId, tapes); redraw(); },
    hideAll() { tapes.forEach(t => t.visible = false); store.saveTape(imageId, tapes); redraw(); },
    eraseAt(x, y, r) {
      tapes.forEach(t => {
        if (!t.visible) return;
        if (hitTape(t, x, y, r)) {
          t.erasedPath = t.erasedPath || [];
          t.erasedPath.push({ x, y, r });
        }
      });
      store.saveTape(imageId, tapes);
      redraw();
    },
    hitTest(x, y) {
      for (let i = tapes.length - 1; i >= 0; i--) {
        if (hitTape(tapes[i], x, y, 0)) return tapes[i];
      }
      return null;
    },
    redraw,
    getTool() { return tool; },
    setTool(t) { tool = t; },
    getPattern() { return pattern; },
    setPattern(p) { pattern = p; },
    getColor() { return color; },
    setColor(c) { color = c; },
    getWidth() { return width; },
    setWidth(w) { width = w; },
    setPatternImage(id) { patternImageId = id; },
  };
}

function hitTape(t, x, y, r) {
  if (t.shape === 'rect') {
    const p0 = t.points[0], p1 = t.points[t.points.length - 1];
    const minX = Math.min(p0.x, p1.x) - r, maxX = Math.max(p0.x, p1.x) + r;
    const minY = Math.min(p0.y, p1.y) - r, maxY = Math.max(p0.y, p1.y) + r;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }
  if (t.shape === 'circle') {
    const p0 = t.points[0], p1 = t.points[t.points.length - 1];
    const rad = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    return Math.hypot(x - p0.x, y - p0.y) <= rad + r;
  }
  for (let i = 0; i < t.points.length - 1; i++) {
    const a = t.points[i], b = t.points[i + 1];
    const dist = pointToSegment(x, y, a.x, a.y, b.x, b.y);
    if (dist <= t.width / 2 + r) return true;
  }
  return false;
}

function pointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function renderTapeToolbar(tapeLayer, onPatternChange) {
  const bar = el('div', { class: 'tape-toolbar' });

  const shapeRow = el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '形状' }),
    ...TAPE_SHAPES.map(s => el('button', {
      class: 'tape-chip' + (tapeLayer.getTool() === s.id ? ' active' : ''),
      text: s.label,
      onClick: (e) => {
        tapeLayer.setTool(s.id);
        shapeRow.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      },
    })),
  ]);

  const patternRow = el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '花样' }),
    ...TAPE_PATTERNS.map(p => el('button', {
      class: 'tape-chip' + (tapeLayer.getPattern() === p.id ? ' active' : ''),
      text: p.label,
      onClick: (e) => {
        tapeLayer.setPattern(p.id);
        patternRow.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        if (p.id === 'custom') onPatternChange && onPatternChange();
      },
    })),
  ]);

  const widthNum = el('input', {
    type: 'number', min: '4', max: '300', value: String(tapeLayer.getWidth()),
    style: { width: '56px', padding: '4px 6px', fontSize: '13px', textAlign: 'center' },
    onInput: (e) => {
      const v = Math.max(4, Math.min(300, Number(e.target.value) || 8));
      tapeLayer.setWidth(v);
      widthRange.value = v;
    },
  });
  const widthRange = el('input', {
    type: 'range', min: '4', max: '300', value: String(tapeLayer.getWidth()),
    style: { flex: '1' },
    onInput: (e) => {
      const v = Number(e.target.value);
      tapeLayer.setWidth(v);
      widthNum.value = v;
    },
  });
  const widthRow = el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '宽度' }),
    widthRange,
    widthNum,
  ]);

  const colorRow = el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '颜色' }),
    renderColorPicker({
      current: tapeLayer.getColor(),
      onChange: (c) => tapeLayer.setColor(c),
    }),
  ]);

  bar.appendChild(shapeRow);
  bar.appendChild(patternRow);
  bar.appendChild(widthRow);
  bar.appendChild(colorRow);
  return bar;
}