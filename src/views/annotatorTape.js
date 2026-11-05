// src/views/annotatorTape.js
// 胶带图层：独立 canvas，支持多种形状、花样、显隐、擦除、拖动、旋转、透明度

import { el } from '../utils/dom.js';
import { dbGet, dbPut } from '../db.js';
import { renderColorPicker } from '../ui/colorPicker.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export function createTapeLayer({ canvas, width, height, imageId, store, baseImg }) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    canvas = document.createElement('canvas');
    canvas.width = width || 1;
    canvas.height = height || 1;
  }

  const ctx = canvas.getContext('2d');
  const W = width;
  const H = height;

  let tapes = [];
  let selectedIds = new Set();
  let showShapeList = true;
  let showPatternList = true;
  let showLockIcons = true;
  let tapeWidth = 20;
  let tapeShape = 'line-round';
  let tapePattern = 'solid';
  let tapePatternImageId = null;
  let tapeColor = '#FFE066';
  const patternImages = new Map();

  // ============ 加载 / 保存 ============
  function load() {
    const saved = store.getTape ? store.getTape(imageId) : null;
    if (saved && Array.isArray(saved)) {
      tapes = saved;
    } else {
      try {
        const raw = localStorage.getItem('kg_tape_' + imageId);
        if (raw) tapes = JSON.parse(raw);
      } catch { tapes = []; }
    }
    // 压缩历史超大擦除路径
    tapes.forEach(t => {
      if (t.erasedPath && t.erasedPath.length > 500) {
        const step = Math.ceil(t.erasedPath.length / 500);
        t.erasedPath = t.erasedPath.filter((_, i) => i % step === 0);
      }
    });
  }

  function save() {
    if (store.saveTape) {
      store.saveTape(imageId, tapes);
    } else {
      localStorage.setItem('kg_tape_' + imageId, JSON.stringify(tapes));
    }
  }

  // ============ 自定义花样加载 ============
  async function loadPatternImage(patternId) {
    if (patternImages.has(patternId)) return patternImages.get(patternId);
    let rec = null;
    try { rec = await dbGet('patterns', patternId); } catch { rec = null; }
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    const img = new Image();
    img.src = url;
    await new Promise(r => { img.onload = r; img.onerror = r; });
    patternImages.set(patternId, img);
    return img;
  }

  // ============ 命中检测 ============
  function hitTape(t, x, y, radius) {
    const r = radius || t.width / 2;
    if (t.shape === 'rect') {
      if (t.points.length < 2) return false;
      const p0 = t.points[0], p1 = t.points[t.points.length - 1];
      const minX = Math.min(p0.x, p1.x) - r, maxX = Math.max(p0.x, p1.x) + r;
      const minY = Math.min(p0.y, p1.y) - r, maxY = Math.max(p0.y, p1.y) + r;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    if (t.shape === 'circle') {
      if (t.points.length < 2) return false;
      const p0 = t.points[0], p1 = t.points[t.points.length - 1];
      const dist = Math.hypot(x - p0.x, y - p0.y);
      const radiusCircle = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      return Math.abs(dist - radiusCircle) <= r || dist <= radiusCircle;
    }
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1], b = t.points[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t2 = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t2 = Math.max(0, Math.min(1, t2));
      const px = a.x + dx * t2, py = a.y + dy * t2;
      if (Math.hypot(x - px, y - py) <= r) return true;
    }
    return false;
  }

  // ============ 绘制胶带 ============
  function drawTape(ctx, t) {
    if (!t.points || t.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = t.opacity !== undefined ? t.opacity : 1;

    // 旋转
    const cx = t.points.reduce((s, p) => s + p.x, 0) / t.points.length;
    const cy = t.points.reduce((s, p) => s + p.y, 0) / t.points.length;
    if (t.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate(t.rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }

    ctx.lineCap = t.shape === 'line-round' ? 'round' : 'butt';
    ctx.lineJoin = 'round';

    if (t.shape === 'rect') {
      const p0 = t.points[0], p1 = t.points[t.points.length - 1];
      const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
      if (t.pattern === 'custom' && t.patternImageId && patternImages.has(t.patternImageId)) {
        const pattern = ctx.createPattern(patternImages.get(t.patternImageId), 'repeat');
        if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h); }
      } else if (t.pattern === 'dots') {
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        const step = Math.max(8, t.width * 0.7);
        const dotR = Math.max(2, t.width / 8);
        for (let px = x + step / 2; px < x + w; px += step)
          for (let py = y + step / 2; py < y + h; py += step) {
            ctx.beginPath();
            ctx.arc(px, py, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
      } else if (t.pattern === 'diagonal') {
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.4)';
        ctx.lineWidth = 2;
        for (let d = -h; d < w; d += 10) {
          ctx.beginPath();
          ctx.moveTo(x + d, y);
          ctx.lineTo(x + d + h, y + h);
          ctx.stroke();
        }
      } else if (t.pattern === 'grid') {
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.4)';
        ctx.lineWidth = 1;
        for (let px = x; px < x + w; px += 10) {
          ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
        }
        for (let py = y; py < y + h; py += 10) {
          ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();
        }
      } else {
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y, w, h);
      }
    } else if (t.shape === 'circle') {
      const p0 = t.points[0], p1 = t.points[t.points.length - 1];
      const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2);
      if (t.pattern === 'custom' && t.patternImageId && patternImages.has(t.patternImageId)) {
        const pattern = ctx.createPattern(patternImages.get(t.patternImageId), 'repeat');
        if (pattern) ctx.fillStyle = pattern;
      } else if (t.pattern === 'dots') {
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        const step = t.width * 0.8;
        for (let px = p0.x - r; px <= p0.x + r; px += step)
          for (let py = p0.y - r; py <= p0.y + r; py += step) {
            if (Math.hypot(px - p0.x, py - p0.y) <= r) {
              ctx.beginPath();
              ctx.arc(px, py, t.width / 6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        ctx.restore();
      } else {
        ctx.fillStyle = t.color;
      }
      ctx.fill();
    } else if (t.shape === 'custom' && t.patternImageId && patternImages.has(t.patternImageId)) {
      const img = patternImages.get(t.patternImageId);
      t.points.forEach(p => {
        const size = t.width;
        ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
      });
    } else {
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.lineCap = t.shape === 'line-round' ? 'round' : 'butt';
      ctx.beginPath();
      ctx.moveTo(t.points[0].x, t.points[0].y);
      for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
      ctx.stroke();

      if (t.pattern === 'dots') {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        const step = Math.max(8, t.width * 0.7);  // 波点间距
        const dotR = Math.max(2, t.width / 8);    // 波点半径
        // 沿路径累计距离，等距打点
        let acc = 0;
        for (let i = 0; i < t.points.length - 1; i++) {
          const a = t.points[i], b = t.points[i + 1];
          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
          if (segLen === 0) continue;
          const dirX = (b.x - a.x) / segLen;
          const dirY = (b.y - a.y) / segLen;
          let dist = 0;
          while (acc + (segLen - dist) >= step) {
            const need = step - acc;
            dist += need;
            acc = 0;
            const px = a.x + dirX * dist;
            const py = a.y + dirY * dist;
            ctx.beginPath();
            ctx.arc(px, py, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
          acc += segLen - dist;
        }
        ctx.restore();
      }

      if (t.pattern === 'custom' && t.patternImageId && patternImages.has(t.patternImageId)) {
        ctx.strokeStyle = ctx.createPattern(patternImages.get(t.patternImageId), 'repeat') || t.color;
        ctx.beginPath();
        ctx.moveTo(t.points[0].x, t.points[0].y);
        for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
        ctx.stroke();
      }
    }

    // 擦除
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

  // ============ 选中框 ============
  function drawSelection(ctx, t) {
    if (!t.points || t.points.length < 2) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    t.points.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = t.width / 2 + 4;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    ctx.save();
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    ctx.setLineDash([]);
    [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].forEach(([hx, hy]) => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3B82F6';
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
      ctx.strokeRect(hx - 4, hy - 4, 8, 8);
    });
    // 旋转手柄
    ctx.beginPath();
    ctx.moveTo((minX + maxX) / 2, minY);
    ctx.lineTo((minX + maxX) / 2, minY - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc((minX + maxX) / 2, minY - 20, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#3B82F6';
    ctx.fill();
    ctx.stroke();
    if (t.locked && showLockIcons) {
      ctx.fillStyle = '#EF476F';
      ctx.font = '14px sans-serif';
      ctx.fillText('🔒', maxX - 16, minY - 4);
    }
    ctx.restore();
  }

  // ============ 重绘（同步） ============
  function redraw() {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    tapes.forEach(t => {
      if (!t.visible) return;
      drawTape(ctx, t);
    });
    // 选中框
    selectedIds.forEach(id => {
      const sel = tapes.find(t => t.id === id);
      if (sel && sel.visible) drawSelection(ctx, sel);
    });
  }

  async function redrawAsync() {
    for (const t of tapes) {
      if (t.pattern === 'custom' && t.patternImageId) {
        await loadPatternImage(t.patternImageId);
      }
    }
    redraw();
  }

  // ============ 预览 ============
  function previewTape(points, color, width) {
    if (!points || points.length === 0) {
      redraw();
      return;
    }
    redraw();
    ctx.save();
    const c = color || tapeColor;
    const w = width || tapeWidth;
    const p0 = points[0];
    const p1 = points[points.length - 1];

    if (tapeShape === 'rect') {
      // 矩形预览：虚线框
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      const rw = Math.abs(p1.x - p0.x);
      const rh = Math.abs(p1.y - p0.y);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, rw, rh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, rw, rh);
    } else if (tapeShape === 'circle') {
      // 圆形预览
      const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 线形预览（圆头/方头）
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.lineCap = tapeShape === 'line-round' ? 'round' : 'butt';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // ============ 创建 / 添加 ============
  function createTapeFromPoints(points, color) {
    return {
      id: crypto.randomUUID(),
      points: points.map(p => ({ x: p.x, y: p.y })),
      width: tapeWidth,
      pattern: tapePattern,
      patternImageId: tapePatternImageId,
      shape: tapeShape,
      color: color || tapeColor,
      opacity: 1,
      rotation: 0,
      visible: true,
      locked: false,
      erasedPath: [],
    };
  }

  async function addTape(tape) {
    tapes.push(tape);
    save();
    await redrawAsync();
  }

  // ============ 显隐 / 选中 ============
  function toggleVisible(id) {
    const t = tapes.find(x => x.id === id);
    console.log('=== toggleVisible ===', 'id:', id, '找到:', !!t, '当前 visible:', t?.visible);
    if (t) {
      t.visible = !t.visible;
      console.log('切换后 visible:', t.visible);
      if (!t.visible) selectedIds.delete(id);
      save();
      redraw();
      console.log('redraw 后，可见胶带:', tapes.filter(x => x.visible).length, '/', tapes.length);
      toastSuccess(t.visible ? '已显示' : '已隐藏');
    }
  }

  function showAll() {
    tapes.forEach(t => { t.visible = true; });
    save();
    redrawAsync();
  }

  function hideAll() {
    tapes.forEach(t => { t.visible = false; });
    save();
    redrawAsync();
  }

  function select(id) {
    selectedIds.clear();
    if (id) selectedIds.add(id);
    redraw();
  }

  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    redraw();
  }

  function selectAll() {
    tapes.forEach(t => { if (t.visible) selectedIds.add(t.id); });
    redraw();
  }

  function selectInRect(x1, y1, x2, y2) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    tapes.forEach(t => {
      if (!t.visible) return;
      let tMinX = Infinity, tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity;
      t.points.forEach(p => {
        tMinX = Math.min(tMinX, p.x); tMaxX = Math.max(tMaxX, p.x);
        tMinY = Math.min(tMinY, p.y); tMaxY = Math.max(tMaxY, p.y);
      });
      // 胶带包围盒完全在框内
      if (tMinX >= minX && tMaxX <= maxX && tMinY >= minY && tMaxY <= maxY) {
        selectedIds.add(t.id);
      }
    });
    redraw();
  }

  function clearSelection() {
    selectedIds.clear();
    redraw();
  }

  function getSelected() {
    if (selectedIds.size === 0) return null;
    return tapes.find(t => t.id === [...selectedIds][0]) || null;
  }

  function getSelectedIds() {
    return [...selectedIds];
  }

  // ============ 拖动 / 旋转 ============
  function startDrag(startX, startY) {
    const t = getSelected();
    if (!t || t.locked) return null;
    const origPoints = t.points.map(p => ({ x: p.x, y: p.y }));
    return {
      move(clientX, clientY) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        t.points = origPoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
        redraw();
      },
      end() { save(); },
    };
  }

  function startRotate(startX, startY) {
    const t = getSelected();
    if (!t || t.locked) return null;
    const cx = t.points.reduce((s, p) => s + p.x, 0) / t.points.length;
    const cy = t.points.reduce((s, p) => s + p.y, 0) / t.points.length;
    const startAngle = Math.atan2(startY - cy, startX - cx);
    const origRotation = t.rotation || 0;
    return {
      move(clientX, clientY) {
        const angle = Math.atan2(clientY - cy, clientX - cx);
        let deg = origRotation + (angle - startAngle) * 180 / Math.PI;
        deg = Math.round(deg / 15) * 15;
        t.rotation = deg;
        redraw();
      },
      end() { save(); },
    };
  }

  // ============ 擦除 ============
  // 擦除：支持单点和线段（从 x1,y1 到 x2,y2），沿路径逐点擦除，无残留
  function eraseAt(x, y, radius) {
    // 保留原单点接口，内部转成线段
    return eraseSegment(x, y, x, y, radius);
  }

  function eraseSegment(x1, y1, x2, y2, radius) {
    let changed = false;
    const MIN_DIST = 2;
    const MAX_POINTS = 2000;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    // 沿线段按半径 30% 步进，确保无缝
    const step = Math.max(1, radius * 0.3);
    const steps = Math.max(1, Math.ceil(dist / step));

    tapes.forEach(t => {
      if (!t.visible || t.locked) return;
      if (!t.erasedPath) t.erasedPath = [];
      for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const px = x1 + (x2 - x1) * ratio;
        const py = y1 + (y2 - y1) * ratio;
        if (hitTape(t, px, py, radius)) {
          const last = t.erasedPath[t.erasedPath.length - 1];
          if (!last || Math.hypot(px - last.x, py - last.y) >= MIN_DIST) {
            t.erasedPath.push({ x: px, y: py, r: radius });
            changed = true;
          }
        }
      }
      if (t.erasedPath.length > MAX_POINTS) {
        t.erasedPath = t.erasedPath.slice(-Math.floor(MAX_POINTS / 2));
      }
    });
    if (changed) { save(); redrawAsync(); }
  }

  // ============ 点击切换显隐 ============
  function handleClick(x, y) {
    for (let i = tapes.length - 1; i >= 0; i--) {
      if (hitTape(tapes[i], x, y, 0)) {
        toggleVisible(tapes[i].id);
        return true;
      }
    }
    return false;
  }

  // ============ 预设样式 ============
  const TAPE_PRESETS = [
    { name: '背诵遮挡', width: 40, shape: 'line-round', pattern: 'solid', color: '#FFE066', opacity: 1 },
    { name: '重点标记', width: 20, shape: 'line-round', pattern: 'solid', color: '#FFB5A7', opacity: 0.6 },
    { name: '划线', width: 8, shape: 'line-square', pattern: 'solid', color: '#8ECAE6', opacity: 1 },
    { name: '波点标记', width: 24, shape: 'line-round', pattern: 'dots', color: '#CDB4DB', opacity: 1 },
  ];

  function applyPreset(preset) {
    tapeWidth = preset.width;
    tapeShape = preset.shape;
    tapePattern = preset.pattern;
    tapeColor = preset.color;
    tapePatternImageId = null;
    toastSuccess(`已应用预设：${preset.name}`);
  }

  // ============ 工具栏 ============
  function renderTapeToolbar() {
    const bar = el('div', { class: 'tape-toolbar' });

    // 预设
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '预设' }),
      ...TAPE_PRESETS.map(p => el('button', {
        class: 'tape-chip',
        text: p.name,
        title: `${p.name}（宽${p.width}，${p.pattern}）`,
        onClick: () => { applyPreset(p); renderTapeToolbar(); },
      })),
    ]));

    // 宽度
    const widthNum = el('input', {
      type: 'number', min: '4', max: '300', value: String(tapeWidth),
      style: { width: '52px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
      onInput: (e) => { tapeWidth = Math.max(4, Math.min(300, Number(e.target.value) || 8)); widthRange.value = tapeWidth; },
    });
    const widthRange = el('input', {
      type: 'range', min: '4', max: '300', value: String(tapeWidth),
      style: { flex: '1', minWidth: '80px' },
      onInput: (e) => { tapeWidth = Number(e.target.value); widthNum.value = tapeWidth; },
    });
    bar.appendChild(el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '宽度' }), widthRange, widthNum]));

    // 形状
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '形状' }),
      ...[
        { id: 'line-round', label: '╱ 圆头线' },
        { id: 'rect', label: '▭ 矩形' },
        { id: 'circle', label: '○ 圆形' },
      ].map(s => el('button', {
        class: 'tape-chip' + (tapeShape === s.id && tapeShape !== 'custom' ? ' active' : ''),
        text: s.label,
        onClick: (ev) => {
          tapeShape = s.id;
          tapePatternImageId = null;
          const row = ev.target.parentElement;
          row.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
          ev.target.classList.add('active');
        },
      })),
    ]));

    // 形状管理按钮
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('button', { class: 'tape-chip', text: '⚙️ 管理形状', onClick: () => openShapeManager() }),
      el('button', { class: 'tape-chip', text: '✏️ 添加形状', onClick: () => openCustomShapeUpload() }),
    ]));

    // 自定义形状缩略图（只在管理弹窗点了"显示"时渲染）
    if (showShapeList && store.getPatterns && store.getPatterns().length > 0) {
      const customShapes = store.getPatterns().filter(p => p.type === 'shape');
      if (customShapes.length > 0) {
        const shapeRow = el('div', { class: 'tape-row' });
        customShapes.forEach(p => {
          const thumb = el('div', {
            style: {
              position: 'relative', width: '56px', height: '56px',
              borderRadius: '8px', overflow: 'hidden',
              outline: tapePatternImageId === p.id ? '2px solid var(--primary)' : 'none',
              outlineOffset: '0px',
              cursor: 'pointer',
              background: 'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 12px 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '4px',
              boxSizing: 'border-box',
            },
            title: p.id.slice(0, 8),
            onClick: () => { tapeShape = 'custom'; tapePatternImageId = p.id; renderTapeToolbar(); },
          });
          if (p.thumbUrl) {
            thumb.appendChild(el('img', {
              src: p.thumbUrl,
              style: {
                width: '100%', height: '100%',
                objectFit: 'contain',
                display: 'block',
              },
            }));
          }
          thumb.appendChild(el('button', {
            style: {
              position: 'absolute', top: '0', right: '0',
              background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none',
              borderRadius: '0 0 0 6px', width: '18px', height: '18px',
              fontSize: '12px', cursor: 'pointer', padding: '0',
              lineHeight: '1',
            },
            text: '×',
            onClick: (e) => {
              e.stopPropagation();
              if (!confirm('删除这个形状？')) return;
              if (store.removePattern) store.removePattern(p.id);
              renderTapeToolbar();
            },
          }));
          shapeRow.appendChild(thumb);
        });
        bar.appendChild(shapeRow);
      }
    }

    // 花样
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '花样' }),
      ...[
        { id: 'solid', label: '纯色' },
        { id: 'dots', label: '波点' },
        { id: 'diagonal', label: '斜线' },
        { id: 'grid', label: '网格' },
      ].map(p => el('button', {
        class: 'tape-chip' + (tapePattern === p.id && tapePattern !== 'custom' ? ' active' : ''),
        text: p.label,
        onClick: (ev) => {
          tapePattern = p.id;
          tapePatternImageId = null;
          const row = ev.target.parentElement;
          row.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
          ev.target.classList.add('active');
        },
      })),
    ]));

    // 花样管理按钮
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('button', { class: 'tape-chip', text: '⚙️ 管理花样', onClick: () => openPatternManager() }),
      el('button', { class: 'tape-chip', text: '✏️ 添加花样', onClick: () => openPatternUpload() }),
    ]));

    // 自定义花样缩略图（只在管理弹窗点了"显示"时渲染）
    if (showPatternList && store.getPatterns && store.getPatterns().length > 0) {
      const patterns = store.getPatterns().filter(p => p.type === 'pattern');
      if (patterns.length > 0) {
        const patternRow = el('div', { class: 'tape-row' });
        patterns.forEach(p => {
          const thumb = el('div', {
            style: {
              position: 'relative', width: '56px', height: '56px',
              borderRadius: '8px', overflow: 'hidden',
              outline: tapePatternImageId === p.id ? '2px solid var(--primary)' : 'none',
              outlineOffset: '0px',
              cursor: 'pointer',
              background: 'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 12px 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '4px',
              boxSizing: 'border-box',
            },
            title: p.id.slice(0, 8),
            onClick: () => { tapePattern = 'custom'; tapePatternImageId = p.id; renderTapeToolbar(); },
          });
          if (p.thumbUrl) {
            thumb.appendChild(el('img', {
              src: p.thumbUrl,
              style: {
                width: '100%', height: '100%',
                objectFit: 'contain',
                display: 'block',
              },
            }));
          }
          thumb.appendChild(el('button', {
            style: {
              position: 'absolute', top: '0', right: '0',
              background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none',
              borderRadius: '0 0 0 6px', width: '18px', height: '18px',
              fontSize: '12px', cursor: 'pointer', padding: '0',
              lineHeight: '1',
            },
            text: '×',
            onClick: (e) => {
              e.stopPropagation();
              if (!confirm('删除这个花样？')) return;
              if (store.removePattern) store.removePattern(p.id);
              renderTapeToolbar();
            },
          }));
          patternRow.appendChild(thumb);
        });
        bar.appendChild(patternRow);
      }
    }

    // 颜色
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '颜色' }),
      renderColorPicker({ current: tapeColor, onChange: (c) => { tapeColor = c; } }),
    ]));

    // 选中时的操作
    const sel = getSelected();
    if (sel) {
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: `已选 ${selectedIds.size}` }),
        el('button', { class: 'tape-chip', text: '全选', onClick: () => { selectAll(); renderTapeToolbar(); } }),
        el('button', { class: 'tape-chip', text: '全不选', onClick: () => { clearSelection(); renderTapeToolbar(); } }),
        el('button', {
          class: 'tape-chip', text: '🗑 批量删除', onClick: () => {
            selectedIds.forEach(id => {
              const idx = tapes.findIndex(t => t.id === id);
              if (idx >= 0) tapes.splice(idx, 1);
            });
            selectedIds.clear();
            save();
            redrawAsync();
            renderTapeToolbar();
          },
        }),
      ]));

      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '操作' }),
        el('button', { class: 'tape-chip', text: sel.locked ? '🔒 已锁定' : '🔓 锁定', onClick: () => { sel.locked = !sel.locked; save(); redraw(); renderTapeToolbar(); } }),
        el('button', { class: 'tape-chip', text: '👁 显/隐', onClick: () => { sel.visible = !sel.visible; save(); redraw(); renderTapeToolbar(); } }),
        el('button', { class: 'tape-chip', text: '📋 复制', onClick: () => { if (window.__copyTape) window.__copyTape(sel); } }),
        el('button', { class: 'tape-chip', text: '📥 粘贴', onClick: () => { if (window.__pasteClipboard) window.__pasteClipboard(); } }),
        el('button', {
          class: 'tape-chip', text: '🗑 删除', onClick: () => {
            if (sel.locked) { toastSuccess('已锁定'); return; }
            const idx = tapes.indexOf(sel);
            if (idx >= 0) tapes.splice(idx, 1);
            selectedIds.delete(sel.id);
            save(); redrawAsync(); renderTapeToolbar();
          },
        }),
      ]));

      // 透明度
      const opacityRange = el('input', {
        type: 'range', min: '0.1', max: '1', step: '0.1', value: String(sel.opacity !== undefined ? sel.opacity : 1),
        style: { flex: '1' },
        onInput: (e) => { sel.opacity = Number(e.target.value); opacityNum.value = sel.opacity; save(); redraw(); },
      });
      const opacityNum = el('input', {
        type: 'number', min: '0.1', max: '1', step: '0.1', value: String(sel.opacity !== undefined ? sel.opacity : 1),
        style: { width: '48px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
        onInput: (e) => { sel.opacity = Math.max(0.1, Math.min(1, Number(e.target.value) || 1)); opacityRange.value = sel.opacity; save(); redraw(); },
      });
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '透明度' }),
        opacityRange, opacityNum,
      ]));

      // 旋转
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '旋转' }),
        el('input', {
          type: 'number', min: '-180', max: '180', step: '15', value: String(sel.rotation || 0),
          style: { width: '56px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
          onInput: (e) => { sel.rotation = Number(e.target.value) || 0; save(); redraw(); },
        }),
        el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '°' }),
      ]));

      // 清除擦除
      bar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '边界' }),
        el('button', {
          class: 'tape-chip', text: '🧹 清除擦除', onClick: () => {
            selectedIds.forEach(id => {
              const t = tapes.find(x => x.id === id);
              if (t) t.erasedPath = [];
            });
            save();
            redraw();
            toastSuccess('擦除路径已清除');
          },
        }),
      ]));
    }

    // 全部显隐
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '全部' }),
      el('button', { class: 'tape-chip', text: '👁 全部显示', onClick: () => showAll() }),
      el('button', { class: 'tape-chip', text: '🙈 全部隐藏', onClick: () => hideAll() }),
    ]));

    return bar;
  }

  // ============ 自定义上传 / 管理 ============
  async function openPatternUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const { patternCropModal } = await import('./patternCrop.js');
      const result = await patternCropModal(f);
      if (!result) return;
      const id = crypto.randomUUID();
      await dbPut('patterns', { id, blob: result.blob, createdAt: new Date().toISOString() });
      const thumbUrl = await new Promise(r => {
        const reader = new FileReader();
        reader.onload = () => r(reader.result);
        reader.readAsDataURL(result.blob);
      });
      if (store.addPattern) store.addPattern({ id, thumbUrl, type: 'pattern' });
      tapePattern = 'custom';
      tapePatternImageId = id;
      toastSuccess('花样已添加');
      renderTapeToolbar();
    };
    input.click();
  }

  async function openCustomShapeUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const { patternCropModal } = await import('./patternCrop.js');
      const result = await patternCropModal(f);
      if (!result) return;
      const id = crypto.randomUUID();
      await dbPut('patterns', { id, blob: result.blob, createdAt: new Date().toISOString() });
      const thumbUrl = await new Promise(r => {
        const reader = new FileReader();
        reader.onload = () => r(reader.result);
        reader.readAsDataURL(result.blob);
      });
      if (store.addPattern) store.addPattern({ id, thumbUrl, type: 'shape' });
      tapeShape = 'custom';
      tapePatternImageId = id;
      toastSuccess('自定义形状已添加');
      renderTapeToolbar();
    };
    input.click();
  }

  function openShapeManager() {
    const shapes = (store.getPatterns ? store.getPatterns() : []).filter(p => p.type === 'shape');
    const selected = new Set();
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

    function renderList() {
      list.innerHTML = '';
      if (shapes.length === 0) {
        list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '还没有自定义形状' }));
        return;
      }
      shapes.forEach(p => {
        const checked = selected.has(p.id);
        const isUsing = tapeShape === 'custom' && tapePatternImageId === p.id;
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
          p.thumbUrl ? el('img', { src: p.thumbUrl, style: { width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' } }) : null,
          el('span', { style: { flex: '1', fontSize: '12px', color: 'var(--text-2)' }, text: p.id.slice(0, 8) }),
          el('button', {
            class: 'tape-chip' + (isUsing ? ' active' : ''),
            text: isUsing ? '✅ 使用中' : '使用',
            onClick: () => {
              if (isUsing) {
                tapeShape = 'line-round';
                tapePatternImageId = null;
                toastSuccess('已取消使用');
              } else {
                tapeShape = 'custom';
                tapePatternImageId = p.id;
                toastSuccess('已选用');
              }
              renderTapeToolbar();
              mask.remove();
            },
          }),
        ]));
      });
    }
    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '360px' } }, [
        el('h3', { text: '管理自定义形状' }),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', {
            class: 'btn btn-sm ' + (showShapeList ? 'btn-primary' : 'btn-ghost'),
            text: showShapeList ? '👁 列表已显示' : '🙈 列表已隐藏',
            onClick: () => {
              showShapeList = !showShapeList;
              renderTapeToolbar();
              mask.remove();
            },
          }),
        ]),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { shapes.forEach(p => selected.add(p.id)); renderList(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); renderList(); } }),
        ]),
        list,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '删除选中',
            onClick: () => {
              if (selected.size === 0) { toastError('请先勾选'); return; }
              selected.forEach(id => { if (store.removePattern) store.removePattern(id); });
              selected.clear();
              mask.remove();
              renderTapeToolbar();
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  }

  function openPatternManager() {
    const patterns = (store.getPatterns ? store.getPatterns() : []).filter(p => p.type === 'pattern');
    const selected = new Set();
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

    function renderList() {
      list.innerHTML = '';
      if (patterns.length === 0) {
        list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '还没有自定义花样' }));
        return;
      }
      patterns.forEach(p => {
        const checked = selected.has(p.id);
        const isUsing = tapePattern === 'custom' && tapePatternImageId === p.id;
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
          p.thumbUrl ? el('img', { src: p.thumbUrl, style: { width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' } }) : null,
          el('span', { style: { flex: '1', fontSize: '12px', color: 'var(--text-2)' }, text: p.id.slice(0, 8) }),
          el('button', {
            class: 'tape-chip' + (isUsing ? ' active' : ''),
            text: isUsing ? '✅ 使用中' : '使用',
            onClick: () => {
              if (isUsing) {
                tapePattern = 'solid';
                tapePatternImageId = null;
                toastSuccess('已取消使用');
              } else {
                tapePattern = 'custom';
                tapePatternImageId = p.id;
                toastSuccess('已选用');
              }
              renderTapeToolbar();
              mask.remove();
            },
          }),
        ]));
      });
    }
    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '360px' } }, [
        el('h3', { text: '管理自定义花样' }),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', {
            class: 'btn btn-sm ' + (showPatternList ? 'btn-primary' : 'btn-ghost'),
            text: showPatternList ? '👁 列表已显示' : '🙈 列表已隐藏',
            onClick: () => {
              showPatternList = !showPatternList;
              renderTapeToolbar();
              mask.remove();
            },
          }),
        ]),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { patterns.forEach(p => selected.add(p.id)); renderList(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); renderList(); } }),
        ]),
        list,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '删除选中',
            onClick: () => {
              if (selected.size === 0) { toastError('请先勾选'); return; }
              selected.forEach(id => { if (store.removePattern) store.removePattern(id); });
              selected.clear();
              mask.remove();
              renderTapeToolbar();
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  }

  // ============ 锁定图标开关 ============
  function setShowLockIcons(v) { showLockIcons = v; redraw(); }
  function getShowLockIcons() { return showLockIcons; }

  // ============ 初始化 ============
  load();
  redraw();

  return {
    redraw,
    redrawAsync,
    previewTape,
    createTapeFromPoints,
    addTape,
    toggleVisible,
    showAll,
    hideAll,
    eraseAt,
    eraseSegment,
    select,
    getSelected,
    handleClick,
    getTapes: () => tapes,
    getWidth: () => tapeWidth,
    setWidth: (w) => { tapeWidth = Math.max(4, Math.min(300, w)); },
    getShape: () => tapeShape,
    setShape: (s) => { tapeShape = s; },
    getPattern: () => tapePattern,
    setPattern: (p) => { tapePattern = p; },
    getPatternImageId: () => tapePatternImageId,
    setPatternImageId: (id) => { tapePatternImageId = id; },
    getColor: () => tapeColor,
    setColor: (c) => { tapeColor = c; },
    restore: (newTapes) => { tapes = newTapes; save(); redrawAsync(); },
    renderTapeToolbar,
    loadPatternImage,
    startDrag,
    startRotate,
    hitTape,
    toggleSelect,
    selectAll,
    clearSelection,
    getSelectedIds,
    setShowLockIcons,
    getShowLockIcons,
    openCustomShapeUpload,
    openShapeManager,
    openPatternManager,
    selectInRect,
        drawTapeRaw: (targetCtx, t) => drawTape(targetCtx, t),
  };
}