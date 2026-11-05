// src/views/annotator.js
// 标注页：主入口

import { el, clear } from '../utils/dom.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import * as store from '../store.js';
import { dbGet, dbPut } from '../db.js';
import { createTapeLayer } from './annotatorTape.js';
import { createPaperLayer } from './annotatorPaper.js';
import { createTextLayer } from './annotatorText.js';
import {
  drawSmoothPath, drawSmoothCurve, drawPressurePath, drawArrow, drawRect, drawLine, drawWave,
  eraseCircle, eraseSquare, eraseRect,
} from '../utils/canvas.js';
import { renderColorPicker } from '../ui/colorPicker.js';

const TOOLS = [
  { id: 'pen', label: '✏️', name: '画笔' },
  { id: 'eraser', label: '🧽', name: '橡皮' },
  { id: 'circle-erase', label: '⭕', name: '圈擦' },
  { id: 'text', label: 'T', name: '文字' },
  { id: 'shape', label: '▱', name: '形状' },
  { id: 'tape', label: '🎗️', name: '胶带' },
  { id: 'paper', label: '📄', name: '纸张' },
  { id: 'hand', label: '✋', name: '抓手' },
  { id: 'eyedropper', label: '💧', name: '吸管' },
];

const DEFAULT_LAYER_ORDER = ['base', 'stroke', 'text', 'tape', 'paper', 'paperStroke'];

const imageCache = new Map();
async function getImageCached(id) {
  if (imageCache.has(id)) return imageCache.get(id);
  const rec = await dbGet('images', id);
  imageCache.set(id, rec);
  return rec;
}
export async function putImageCached(rec) {
  await dbPut('images', rec);
  imageCache.set(rec.id, rec);
}

export async function renderAnnotator({ params, query }) {
  const imageId = params.id;
  const pointId = query.pointId;
  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = '标注';
  document.getElementById('btn-back').classList.remove('hidden');

  const img = await getImageCached(imageId);
  window.__img = img;
  if (!img) {
    view.appendChild(el('div', { style: { padding: '24px', textAlign: 'center', color: 'var(--text-2)' }, text: '图片不存在或已删除' }));
    return;
  }

  let W = img.width;
  let H = img.height;

  // ============ 加载底图：originalBlob 保留原图，不带胶带 ============
  const baseImg = new Image();
  const baseUrl = URL.createObjectURL(img.originalBlob);
  await new Promise((resolve) => { baseImg.onload = resolve; baseImg.src = baseUrl; });

  const wrap = el('div', { class: 'annotator-wrap' });
  view.appendChild(wrap);

  const zoomLabel = el('div', { class: 'annotator-zoom-label', text: '100%' });
  wrap.appendChild(zoomLabel);

  // 输入模式切换
  let inputMode = 'pen-first';
  const modeBar = el('div', { class: 'annotator-mode-bar' });
  const modeBtns = {};
  [
    { id: 'pen-first', label: '✍️ 触控笔优先', tip: '手指平移/缩放，触控笔绘制' },
    { id: 'finger-draw', label: '👆 手指也可画', tip: '手指和触控笔都可绘制' },
    { id: 'pen-only', label: '🖊 仅触控笔绘制', tip: '手指只能平移/缩放，不能绘制' },
  ].forEach(m => {
    const btn = el('button', {
      class: 'mode-btn' + (m.id === inputMode ? ' active' : ''),
      text: m.label,
      title: m.tip,
      onClick: () => setInputMode(m.id),
    });
    modeBtns[m.id] = btn;
    modeBar.appendChild(btn);
  });
  wrap.appendChild(modeBar);

  function setInputMode(mode) {
    inputMode = mode;
    Object.entries(modeBtns).forEach(([id, btn]) => btn.classList.toggle('active', id === mode));
    toastSuccess(mode === 'pen-first' ? '触控笔优先' : mode === 'finger-draw' ? '手指也可画' : '仅触控笔');
  }

  const canvasWrap = el('div', { class: 'annotator-canvas-wrap' });
  wrap.appendChild(canvasWrap);

  // ============ 底图 ============
  const base = el('img', {
    class: 'annotator-base',
    src: baseUrl,
    style: { width: W + 'px', height: H + 'px', display: 'block', userSelect: 'none' },
  });
  canvasWrap.appendChild(base);

  // ============ 笔迹层 ============
  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.className = 'annotator-stroke';
  strokeCanvas.width = W;
  strokeCanvas.height = H;
  strokeCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;touch-action:none;z-index:2;`;
  const ctx = strokeCanvas.getContext('2d');
  const strokeImg = img;
  if (strokeImg && strokeImg.strokeBlob) {
    const strokeUrl = URL.createObjectURL(strokeImg.strokeBlob);
    const strokeDrawImg = new Image();
    await new Promise((resolve) => { strokeDrawImg.onload = resolve; strokeDrawImg.src = strokeUrl; });
    ctx.drawImage(strokeDrawImg, 0, 0);
    URL.revokeObjectURL(strokeUrl);
  }
  canvasWrap.appendChild(strokeCanvas);

  // ============ 纸张笔迹层 ============
  const paperStrokeCanvas = document.createElement('canvas');
  paperStrokeCanvas.className = 'annotator-paper-stroke';
  paperStrokeCanvas.width = W;
  paperStrokeCanvas.height = H;
  paperStrokeCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:3;`;
  const paperStrokeCtx = paperStrokeCanvas.getContext('2d');
  if (strokeImg && strokeImg.paperStrokeBlob) {
    const psUrl = URL.createObjectURL(strokeImg.paperStrokeBlob);
    const psImg = new Image();
    await new Promise((resolve) => { psImg.onload = resolve; psImg.src = psUrl; });
    paperStrokeCtx.drawImage(psImg, 0, 0);
    URL.revokeObjectURL(psUrl);
  }
  canvasWrap.appendChild(paperStrokeCanvas);

  // ============ 文字层 ============
  const textCanvas = document.createElement('canvas');
  textCanvas.className = 'annotator-text';
  textCanvas.width = W;
  textCanvas.height = H;
  textCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:4;`;
  canvasWrap.appendChild(textCanvas);
  const textLayer = createTextLayer({ canvas: textCanvas, width: W, height: H, imageId, store });

  // ============ 胶带层 ============
  const tapeCanvas = document.createElement('canvas');
  tapeCanvas.className = 'annotator-tape';
  tapeCanvas.width = W;
  tapeCanvas.height = H;
  tapeCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:5;`;
  canvasWrap.appendChild(tapeCanvas);
  const tapeLayer = createTapeLayer({ canvas: tapeCanvas, width: W, height: H, imageId, store, baseImg });
  // 预加载自定义形状图片
  window.__shapeImageCache = {};
  if (store.getPatterns) {
    store.getPatterns().filter(p => p.type === 'shape-image').forEach(async p => {
      try {
        const rec = await dbGet('patterns', p.id);
        if (rec && rec.blob) {
          const url = URL.createObjectURL(rec.blob);
          const img = new Image();
          img.src = url;
          await new Promise(r => { img.onload = r; });
          window.__shapeImageCache[p.id] = img;
        }
      } catch { }
    });
  }
  window.__drawTapeOnPaper = (targetCtx, t) => {
    // 克隆一份，避免影响全局胶带层
    const ctx2 = targetCtx;
    // 直接用 tapeLayer 的 drawTape
    tapeLayer.drawTapeRaw(ctx2, t);
  };
  window.__tapeLayer = tapeLayer;
  await tapeLayer.redrawAsync();

  window.__copyTape = (tape) => {
    clipboard = { type: 'tape', data: JSON.parse(JSON.stringify(tape)) };
    toastSuccess('已复制胶带');
  };
  window.__pasteClipboard = () => pasteClipboard();

  // ============ 纸张层 ============
  const paperCanvas = document.createElement('canvas');
  paperCanvas.className = 'annotator-paper';
  paperCanvas.width = W;
  paperCanvas.height = H;
  paperCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:6;`;
  canvasWrap.appendChild(paperCanvas);
  const paperLayer = createPaperLayer({ canvas: paperCanvas, width: W, height: H, imageId, store, textCanvas, textLayer });
  window.__paperLayer = paperLayer;
  await paperLayer.redraw();

  window.__copyPaper = (paper) => {
    clipboard = { type: 'paper', data: JSON.parse(JSON.stringify(paper)) };
    toastSuccess('已复制纸张');
  };

  // ============ 预览层 ============
  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'annotator-preview';
  previewCanvas.width = W;
  previewCanvas.height = H;
  previewCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;z-index:7;`;
  const previewCtx = previewCanvas.getContext('2d');
  canvasWrap.appendChild(previewCanvas);

  function clearPreview() { previewCtx.clearRect(0, 0, W, H); }

  // ============ 对齐辅助线 ============
  function drawGuideLines(target) {
    if (!target) return;
    const guides = [];
    const snapDist = 8;
    const tLeft = target.x, tRight = target.x + target.w, tCenterX = target.x + target.w / 2;
    const tTop = target.y, tBottom = target.y + target.h, tCenterY = target.y + target.h / 2;

    const canvasTargets = [
      { axis: 'x', value: 0 }, { axis: 'x', value: W }, { axis: 'x', value: W / 2 },
      { axis: 'y', value: 0 }, { axis: 'y', value: H }, { axis: 'y', value: H / 2 },
    ];
    const otherTargets = [];
    paperLayer.getPapers().forEach(p => {
      if (p === target) return;
      otherTargets.push(
        { axis: 'x', value: p.x }, { axis: 'x', value: p.x + p.w }, { axis: 'x', value: p.x + p.w / 2 },
        { axis: 'y', value: p.y }, { axis: 'y', value: p.y + p.h }, { axis: 'y', value: p.y + p.h / 2 },
      );
    });
    tapeLayer.getTapes().forEach(t => {
      if (t.points.length < 2) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      t.points.forEach(pt => {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
      });
      otherTargets.push(
        { axis: 'x', value: minX }, { axis: 'x', value: maxX }, { axis: 'x', value: (minX + maxX) / 2 },
        { axis: 'y', value: minY }, { axis: 'y', value: maxY }, { axis: 'y', value: (minY + maxY) / 2 },
      );
    });
    textLayer.getItems().forEach(ti => {
      if (ti === target) return;
      otherTargets.push(
        { axis: 'x', value: ti.x }, { axis: 'x', value: ti.x + ti.w }, { axis: 'x', value: ti.x + ti.w / 2 },
        { axis: 'y', value: ti.y }, { axis: 'y', value: ti.y + ti.h }, { axis: 'y', value: ti.y + ti.h / 2 },
      );
    });

    const allTargets = [...canvasTargets, ...otherTargets];
    const check = (axis, targetValues) => {
      targetValues.forEach(tv => {
        allTargets.filter(t => t.axis === axis).forEach(ref => {
          if (Math.abs(tv - ref.value) < snapDist) {
            guides.push({ axis, value: ref.value, snap: ref.value - tv });
          }
        });
      });
    };
    check('x', [tLeft, tRight, tCenterX]);
    check('y', [tTop, tBottom, tCenterY]);

    const unique = [];
    guides.forEach(g => {
      if (!unique.find(u => u.axis === g.axis && Math.abs(u.value - g.value) < 0.5)) unique.push(g);
    });

    clearPreview();
    previewCtx.save();
    previewCtx.strokeStyle = '#EF476F';
    previewCtx.lineWidth = 1;
    previewCtx.setLineDash([6, 4]);
    unique.forEach(g => {
      previewCtx.beginPath();
      if (g.axis === 'x') { previewCtx.moveTo(g.value, 0); previewCtx.lineTo(g.value, H); }
      else { previewCtx.moveTo(0, g.value); previewCtx.lineTo(W, g.value); }
      previewCtx.stroke();
    });
    previewCtx.restore();
    return unique;
  }

  function snapToGuide(target, guides) {
    if (!guides || guides.length === 0) return;
    let snappedX = false, snappedY = false;
    guides.forEach(g => {
      if (g.axis === 'x' && !snappedX && Math.abs(g.snap) > 0) { target.x += g.snap; snappedX = true; }
      else if (g.axis === 'y' && !snappedY && Math.abs(g.snap) > 0) { target.y += g.snap; snappedY = true; }
    });
  }

  // ============ 图层顺序 ============
  const layerMap = { base, stroke: strokeCanvas, paperStroke: paperStrokeCanvas, text: textCanvas, tape: tapeCanvas, paper: paperCanvas };

  function applyLayerOrder(order) {
    const previewEl = previewCanvas;
    [...canvasWrap.children].forEach((child) => { if (child !== previewEl) canvasWrap.removeChild(child); });
    order.forEach((key) => { if (layerMap[key]) canvasWrap.appendChild(layerMap[key]); });
    canvasWrap.appendChild(previewEl);
  }

  const savedOrder = store.getLayerOrder ? store.getLayerOrder() : null;
  let currentLayerOrder = savedOrder && savedOrder.length === 6 ? [...savedOrder] : [...DEFAULT_LAYER_ORDER];
  applyLayerOrder(currentLayerOrder);
  // ============ 状态变量 ============
  let currentTool = 'pen';
  let currentColor = '#EF476F';
  let currentWidth = 3;
  let inlineEditorEl = null;
  let waveAmplitude = 8;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drawing = false;
  let startPt = null;
  let points = [];
  let eraseFreePath = null;
  let eraserShape = 'circle';
  let eraseShape = 'rect';
  let shapeType = 'arrow';
  let dirty = false;
  let paperDragOffset = null;
  let textDragOffset = null;
  let tapeDragOffset = null;
  const pointers = new Map();
  const toolWidths = { pen: 3, eraser: 5, 'circle-erase': 5, shape: 2 };
  let undoStack = [];
  let panelVisible = false;
  let clipboard = null;
  let tapeSelectMode = false;
  let formatClipboard = null;
  let polygonPoints = [];
  let polygonDrawing = false;

  function canvasToImage(clientX, clientY) {
    const rect = strokeCanvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * W,
      y: (clientY - rect.top) / rect.height * H,
    };
  }

  function updateTransform() {
    canvasWrap.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    canvasWrap.style.transformOrigin = 'top left';
    const zl = document.querySelector('.annotator-zoom-label');
    if (zl) zl.textContent = Math.round(scale * 100) + '%';
  }

  // ============ 撤销 ============
  function pushUndo(force = false) {
    undoStack.push({
      stroke: ctx.getImageData(0, 0, W, H),
      paperStroke: paperStrokeCtx.getImageData(0, 0, W, H),
      paper: JSON.parse(JSON.stringify(paperLayer.getPapers())),
      tape: JSON.parse(JSON.stringify(tapeLayer.getTapes())),
      text: JSON.parse(JSON.stringify(textLayer.getItems())),
    });
    if (undoStack.length > 30) undoStack.shift();
    if (typeof updateUndoBtn === 'function') updateUndoBtn();
    if (typeof setSaveStatus === 'function') setSaveStatus('dirty');
  }

  function undo() {
    const snap = undoStack.pop();
    if (!snap) { toastError('没有可撤销的操作'); return; }
    ctx.putImageData(snap.stroke, 0, 0);
    paperStrokeCtx.putImageData(snap.paperStroke, 0, 0);
    paperLayer.restore(snap.paper);
    tapeLayer.restore(snap.tape);
    textLayer.restore(snap.text);
    dirty = true;
    if (typeof updateUndoBtn === 'function') updateUndoBtn();
    if (typeof setSaveStatus === 'function') setSaveStatus('dirty');
  }

  // ============ 纸张文字浮动编辑 ============
  function openPaperTextEditor(paper) {
    const rect = strokeCanvas.getBoundingClientRect();
    const sx = rect.width / W;
    const sy = rect.height / H;

    paper.textVisible = false;
    paperLayer.redraw();
    window.__paperEditingItem = paper;

    const ta = document.createElement('textarea');
    ta.value = paper.text || '';
    ta.placeholder = '输入文字…';
    ta.style.cssText = `
      position: fixed;
      left: ${rect.left + paper.x * sx + 4}px;
      top: ${rect.top + paper.y * sy + 4}px;
      width: ${Math.max(80, paper.w * sx - 8)}px;
      height: ${Math.max(40, paper.h * sy - 8)}px;
      font-size: ${Math.max(12, (paper.textStyle?.fontSize || 16) * sx)}px;
      color: ${paper.textStyle?.color || '#2B2D42'};
      background: rgba(255,255,255,.95);
      border: 2px solid #3B82F6;
      border-radius: 6px;
      padding: 4px 6px;
      resize: none;
      z-index: 999;
      outline: none;
      font-family: -apple-system, "PingFang SC", sans-serif;
    `;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    if (window.visualViewport) {
      const adjustPosition = () => {
        const vv = window.visualViewport;
        const editorRect = ta.getBoundingClientRect();
        if (editorRect.bottom > vv.height - 20) {
          ta.style.top = Math.max(10, vv.height - editorRect.height - 30) + 'px';
        }
      };
      window.visualViewport.addEventListener('resize', adjustPosition);
    }

    if (window.visualViewport) {
      const adjustPosition = () => {
        const vv = window.visualViewport;
        const editorRect = ta.getBoundingClientRect();
        if (editorRect.bottom > vv.height - 20) {
          ta.style.top = Math.max(10, vv.height - editorRect.height - 30) + 'px';
        }
      };
      window.visualViewport.addEventListener('resize', adjustPosition);
    }

    function finish() {
      window.__paperEditingItem = null;
      const val = ta.value;
      ta.remove();
      paper.textVisible = true;
      if (val !== paper.text) {
        pushUndo();
        paper.text = val;
        paperLayer.save();
      }
      paperLayer.redraw();
      dirty = true;
      document.removeEventListener('pointerdown', outsideClick, true);
      document.removeEventListener('keydown', onKey, true);
      updateSubToolbar();
    }
    function outsideClick(e) {
      if (!ta.contains(e.target)) finish();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        window.__paperEditingItem = null;
        paper.textVisible = true;
        paperLayer.redraw();
        ta.remove();
        document.removeEventListener('pointerdown', outsideClick, true);
        document.removeEventListener('keydown', onKey, true);
        updateSubToolbar();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish();
    }

    setTimeout(() => {
      document.addEventListener('pointerdown', outsideClick, true);
      document.addEventListener('keydown', onKey, true);
    }, 50);
  }
  window.__openPaperTextEditor = openPaperTextEditor;

  // ============ 保存 ============
  async function saveAll(showToast = false) {
    const strokeBlob = await new Promise((r) => strokeCanvas.toBlob(r, 'image/png'));
    const paperStrokeBlob = await new Promise((r) => paperStrokeCanvas.toBlob(r, 'image/png'));

    const merged = document.createElement('canvas');
    merged.width = W; merged.height = H;
    const mctx = merged.getContext('2d');
    mctx.drawImage(baseImg, 0, 0);
    mctx.drawImage(paperCanvas, 0, 0);
    mctx.drawImage(paperStrokeCanvas, 0, 0);
    mctx.drawImage(strokeCanvas, 0, 0);
    mctx.drawImage(textCanvas, 0, 0);
    mctx.drawImage(tapeCanvas, 0, 0);
    const annotatedBlob = await new Promise((r) => merged.toBlob(r, 'image/png'));

    // 关键：originalBlob 永远是 img.originalBlob，不能被覆盖
    await putImageCached({
      ...img,
      originalBlob: img.originalBlob,
      strokeBlob,
      paperStrokeBlob,
      annotatedBlob,
      updatedAt: new Date().toISOString(),
    });

    store.saveTape(imageId, tapeLayer.getTapes());
    store.savePaper(imageId, paperLayer.getPapers());
    store.saveTextItems(imageId, textLayer.getItems());

    dirty = false;
    if (showToast) toastSuccess('已保存');
    if (typeof setSaveStatus === 'function') setSaveStatus('saved');
  }

  // ============ 返回 ============
  async function goBack() {
    if (dirty) {
      const r = await confirmBox({ title: '未保存', message: '当前标注未保存，是否保存？', confirmText: '保存并返回', cancelText: '不保存' });
      if (r) await saveAll(true);
    }
    if (pointId) window.location.hash = `#/edit-point/${pointId}`;
    else history.back();
  }
  document.getElementById('btn-back').onclick = goBack;

  // ============ 工具栏 ============
  const toolBar = el('div', { class: 'annotator-toolbar' });
  const toolBtns = [];
  TOOLS.forEach((tool) => {
    const btn = el('button', {
      class: 'tool-btn' + (tool.id === currentTool ? ' active' : ''),
      text: tool.label,
      title: tool.name,
      onClick: () => setActiveTool(tool.id),
    });
    toolBtns.push(btn);
    toolBar.appendChild(btn);
  });

  const settingPanelBtn = el('button', {
    class: 'tool-btn', text: '🎨', title: '颜色/粗细/工具设置',
    onClick: () => { panelVisible = !panelVisible; settingPanel.style.display = panelVisible ? 'flex' : 'none'; },
  });
  toolBar.appendChild(settingPanelBtn);

  // ============ 颜色条 ============
  const colorBar = el('div', { class: 'annotator-colorbar' });
  function refreshColorBar() {
    colorBar.innerHTML = '';
    colorBar.appendChild(renderColorPicker({
      current: currentColor,
      onChange: (c) => { currentColor = c; refreshColorBar(); },
    }));
  }
  refreshColorBar();

  // ============ 粗细行 ============
  const widthRange = el('input', {
    type: 'range', min: '1', max: '100', value: String(currentWidth),
    style: { flex: '1' },
    onInput: (e) => { currentWidth = Number(e.target.value); widthNum.value = currentWidth; },
  });
  const widthNum = el('input', {
    type: 'number', min: '1', max: '100', value: String(currentWidth),
    style: { width: '48px', padding: '4px 6px', fontSize: '13px', textAlign: 'center' },
    onInput: (e) => { const v = Math.max(1, Math.min(100, Number(e.target.value) || 1)); currentWidth = v; widthRange.value = v; },
  });
  const widthMinus = el('button', {
    class: 'btn btn-sm btn-ghost', text: '−',
    style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
    onClick: () => { currentWidth = Math.max(1, currentWidth - 1); widthRange.value = currentWidth; widthNum.value = currentWidth; },
  });
  const widthPlus = el('button', {
    class: 'btn btn-sm btn-ghost', text: '+',
    style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
    onClick: () => { currentWidth = Math.min(100, currentWidth + 1); widthRange.value = currentWidth; widthNum.value = currentWidth; },
  });
  const widthRow = el('div', { class: 'annotator-widthrow' }, [
    el('span', { text: '粗细', style: { fontSize: '13px', color: 'var(--text-2)' } }),
    widthRange, widthMinus, widthNum, widthPlus,
  ]);

  const subBar = el('div', { class: 'sub-toolbar', style: { display: 'none' } });
  const settingPanel = el('div', { class: 'annotator-setting-panel', style: { display: 'none' } }, [colorBar, widthRow, subBar]);
  const bottomBar = el('div', { class: 'annotator-bottom-bar' }, [toolBar, settingPanel]);
  view.appendChild(bottomBar);

  // ============ 工具切换 ============
  function setActiveTool(toolId) {
    currentTool = toolId;
    toolBtns.forEach((btn, i) => btn.classList.toggle('active', TOOLS[i].id === toolId));
    if (toolId in toolWidths) {
      currentWidth = toolWidths[toolId];
      widthRange.value = currentWidth;
      widthNum.value = currentWidth;
    }
    if (toolId === 'tape') tapeLayer.select(null);
    else if (toolId === 'paper') paperLayer.setTool('select');
    else paperLayer.setTool(null);
    if (toolId === 'text') textLayer.select(null);
    strokeCanvas.style.cursor = toolId === 'eyedropper' ? 'crosshair' : (toolId === 'hand' ? 'grab' : 'crosshair');
    updateSubToolbar();
    if (['circle-erase', 'shape', 'eraser', 'tape', 'paper', 'text'].includes(toolId)) {
      panelVisible = true;
      if (settingPanel) settingPanel.style.display = 'flex';
    }
    if (toolId !== 'text') formatClipboard = null;

  }

  // ============ 子工具栏 ============
  function updateSubToolbar() {
    subBar.innerHTML = '';
    // 根据工具决定颜色条和粗细行的显示
    const showColorAndWidth = ['pen', 'eraser', 'circle-erase', 'shape', 'eyedropper', 'hand'].includes(currentTool);
    colorBar.style.display = showColorAndWidth ? 'flex' : 'none';
    widthRow.style.display = showColorAndWidth ? 'flex' : 'none';
    if (currentTool === 'shape') {
      // 形状按钮：前 3 个 + 更多下拉
      const allShapes = [
        { id: 'arrow', label: '↗' },
        { id: 'rect', label: '▭' },
        { id: 'line', label: '—' },
        { id: 'wave', label: '〰️' },
        { id: 'circle', label: '○' },
        { id: 'star', label: '⭐' },
        { id: 'triangle', label: '△' },
        { id: 'dialog', label: '💬' },
        { id: 'flag', label: '🚩' },
        { id: 'check', label: '✅' },
        { id: 'cross', label: '❌' },
        { id: 'ban', label: '⊘' },
        { id: 'custom-image', label: '🖼' },
        { id: 'polygon', label: '⬠' },
      ];
      const topShapes = allShapes.slice(0, 4);
      const moreShapes = allShapes.slice(4);

      const shapeRow = el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '形状' }),
      ]);
      topShapes.forEach(s => {
        shapeRow.appendChild(el('button', {
          class: 'tape-chip' + (shapeType === s.id ? ' active' : ''),
          text: s.label,
          title: s.label,
          onClick: () => {
            shapeType = s.id;
            if (s.id === 'custom-image') openShapeImageUpload();
            updateSubToolbar();
          },
        }));
      });
      // 更多下拉
      const moreSelect = el('select', {
        style: { padding: '3px 6px', fontSize: '11px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' },
        onChange: (e) => {
          const v = e.target.value;
          if (!v) return;
          shapeType = v;
          if (v === 'custom-image') openShapeImageUpload();
          updateSubToolbar();
        },
      }, [
        el('option', { value: '', text: '更多…' }),
        ...moreShapes.map(s => el('option', { value: s.id, text: s.label, selected: shapeType === s.id })),
      ]);
      shapeRow.appendChild(moreSelect);
      subBar.appendChild(shapeRow);

      // 边框颜色（所有形状通用）
      const bc = el('div');
      bc.appendChild(renderColorPicker({
        current: window.__shapeBorderColor || currentColor,
        onChange: (c) => { window.__shapeBorderColor = c; },
      }));
      subBar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '边框' }), bc,
      ]));

      // 填充色（矩形、圆形、三角形、多边形、星、对话框、旗帜、对勾、叉号、禁止）
      if (['rect', 'circle', 'triangle', 'polygon', 'star', 'dialog', 'flag', 'check', 'cross', 'ban'].includes(shapeType)) {
        const fc = el('div');
        fc.appendChild(renderColorPicker({
          current: window.__shapeFillColor || 'transparent',
          onChange: (c) => { window.__shapeFillColor = c; },
          allowNone: true,
        }));
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '填充' }), fc,
        ]));
      }

      // 波浪波幅
      if (shapeType === 'wave') {
        const waveNum = el('input', {
          type: 'number', min: '2', max: '30', value: String(waveAmplitude),
          style: { width: '48px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
          onInput: (e) => { waveAmplitude = Math.max(2, Math.min(30, Number(e.target.value) || 8)); },
        });
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '波幅' }), waveNum,
        ]));
      }

      // 自定义图片形状
      if (shapeType === 'custom-image') {
        const customShapes = store.getPatterns ? store.getPatterns().filter(p => p.type === 'shape-image') : [];
        if (customShapes.length > 0) {
          const row = el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '图片' }),
          ]);
          customShapes.forEach(p => {
            const thumb = el('div', {
              style: {
                position: 'relative', width: '40px', height: '40px',
                borderRadius: '6px', overflow: 'hidden',
                border: window.__shapeImageId === p.id ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.1)',
                cursor: 'pointer', background: '#fff',
              },
              onClick: () => { window.__shapeImageId = p.id; updateSubToolbar(); },
            });
            if (p.thumbUrl) thumb.appendChild(el('img', { src: p.thumbUrl, style: { width: '100%', height: '100%', objectFit: 'contain' } }));
            row.appendChild(thumb);
          });
          row.appendChild(el('button', {
            class: 'tape-chip', text: '✏️ 添加图片',
            onClick: () => openShapeImageUpload(),
          }));
          subBar.appendChild(row);
        } else {
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('button', { class: 'tape-chip', text: '✏️ 上传图片形状', onClick: () => openShapeImageUpload() }),
          ]));
        }
      }

      // 自由多边形提示
      if (shapeType === 'polygon') {
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '连续点多个点，双击结束' }),
        ]));
      }
    }

    if (currentTool === 'circle-erase') {
      subBar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '形状' }),
        el('button', { class: 'tape-chip' + (eraseShape === 'rect' ? ' active' : ''), text: '▭ 矩形', onClick: () => { eraseShape = 'rect'; updateSubToolbar(); } }),
        el('button', { class: 'tape-chip' + (eraseShape === 'circle' ? ' active' : ''), text: '○ 圆形', onClick: () => { eraseShape = 'circle'; updateSubToolbar(); } }),
        el('button', { class: 'tape-chip' + (eraseShape === 'free' ? ' active' : ''), text: '〰️ 自由', onClick: () => { eraseShape = 'free'; updateSubToolbar(); } }),
      ]));
    }

    if (currentTool === 'eraser') {
      subBar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '形状' }),
        el('button', { class: 'tape-chip' + (eraserShape === 'circle' ? ' active' : ''), text: '○ 圆形', onClick: () => { eraserShape = 'circle'; updateSubToolbar(); } }),
        el('button', { class: 'tape-chip' + (eraserShape === 'square' ? ' active' : ''), text: '▭ 方形', onClick: () => { eraserShape = 'square'; updateSubToolbar(); } }),
      ]));
    }

    if (currentTool === 'tape') {
      console.log('胶带 pointerdown，tapeSelectMode:', tapeSelectMode, 'drawing:', drawing);
      const selectedCount = tapeLayer.getSelectedIds().length;
      if (selectedCount > 0) {
        // 已选中：显示选中状态 + 框选更多 + 取消选中
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', {
            style: { fontSize: '13px', fontWeight: '600', color: 'var(--primary-dark)' },
            text: `已选中 ${selectedCount} 条胶带`,
          }),
          el('button', {
            class: 'tape-chip' + (tapeSelectMode ? ' active' : ''),
            text: tapeSelectMode ? '🔲 框选中（拖框）' : '🔲 框选更多',
            onClick: () => {
              tapeSelectMode = !tapeSelectMode;
              toastSuccess(tapeSelectMode ? '拖框选中更多胶带' : '已退出框选');
              updateSubToolbar();
            },
          }),
          el('button', {
            class: 'tape-chip', text: '取消选中',
            onClick: () => {
              tapeLayer.clearSelection();
              tapeSelectMode = false;
              updateSubToolbar();
            },
          }),
        ]));
      }
      subBar.appendChild(tapeLayer.renderTapeToolbar());
    }
    if (currentTool === 'paper') {
      subBar.appendChild(paperLayer.renderPaperToolbar());
      if (window.__paperEditingItem) {
        const item = window.__paperEditingItem;
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '字号' }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '−', onClick: () => {
              item.textStyle = item.textStyle || {};
              item.textStyle.fontSize = Math.max(10, (item.textStyle.fontSize || 16) - 1);
              paperLayer.save(); paperLayer.redraw();
            }
          }),
          el('span', { style: { fontSize: '12px' }, text: String(item.textStyle?.fontSize || 16) }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '+', onClick: () => {
              item.textStyle = item.textStyle || {};
              item.textStyle.fontSize = Math.min(48, (item.textStyle.fontSize || 16) + 1);
              paperLayer.save(); paperLayer.redraw();
            }
          }),
        ]));
        const cw = el('div');
        cw.appendChild(renderColorPicker({
          current: item.textStyle?.color || '#2B2D42',
          onChange: (c) => {
            item.textStyle = item.textStyle || {};
            item.textStyle.color = c;
            paperLayer.save(); paperLayer.redraw();
          },
        }));
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '文字颜色' }), cw,
        ]));
      }

      subBar.appendChild(el('div', { class: 'tape-row' }, [
        el('button', {
          class: 'tape-chip', text: '📋 纸张列表/进入编辑',
          onClick: () => paperLayer.openPaperListManager(),
        }),
      ]));
      const sel = paperLayer.getSelected();
      if (sel) {
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '文字预设' }),
          ...[
            { name: '标题', fontSize: 24, color: '#2B2D42' },
            { name: '正文', fontSize: 16, color: '#2B2D42' },
            { name: '注释', fontSize: 12, color: '#64748B' },
            { name: '重点', fontSize: 18, color: '#EF476F' },
          ].map(p => el('button', {
            class: 'tape-chip',
            text: p.name,
            onClick: () => {
              sel.textStyle = { ...sel.textStyle, fontSize: p.fontSize, color: p.color };
              paperLayer.save(); paperLayer.redraw();
            },
          })),
        ]));
      }
      // 如果正在编辑纸张文字，加字号/颜色控件
      if (window.__paperEditingItem) {
        const item = window.__paperEditingItem;
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '字号' }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '−', onClick: () => {
              item.textStyle = item.textStyle || {};
              item.textStyle.fontSize = Math.max(10, (item.textStyle.fontSize || 16) - 1);
              paperLayer.save(); paperLayer.redraw();
            }
          }),
          el('span', { style: { fontSize: '12px' }, text: String(item.textStyle?.fontSize || 16) }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '+', onClick: () => {
              item.textStyle = item.textStyle || {};
              item.textStyle.fontSize = Math.min(48, (item.textStyle.fontSize || 16) + 1);
              paperLayer.save(); paperLayer.redraw();
            }
          }),
        ]));
        const cw = el('div');
        cw.appendChild(renderColorPicker({
          current: item.textStyle?.color || '#2B2D42',
          onChange: (c) => {
            item.textStyle = item.textStyle || {};
            item.textStyle.color = c;
            paperLayer.save(); paperLayer.redraw();
          },
        }));
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '文字颜色' }), cw,
        ]));
      }
    }

    if (currentTool === 'text') {
      const sel = textLayer.getSelected();
      if (sel) {
        if (inlineEditorEl) {
          // 编辑中：保留常用控件 + 完成按钮
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '编辑中…' }),
            el('button', { class: 'btn btn-sm btn-primary', text: '✓ 完成', onClick: () => saveInlineTextNow() }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '−', onClick: () => {
                sel.fontSize = Math.max(10, (sel.fontSize || 20) - 2);
                inlineEditorEl.style.fontSize = (sel.fontSize) * (strokeCanvas.getBoundingClientRect().width / W) + 'px';
              }
            }),
            el('span', { style: { fontSize: '12px' }, text: String(sel.fontSize || 20) }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '+', onClick: () => {
                sel.fontSize = Math.min(80, (sel.fontSize || 20) + 2);
                inlineEditorEl.style.fontSize = (sel.fontSize) * (strokeCanvas.getBoundingClientRect().width / W) + 'px';
              }
            }),
          ]));
          // 颜色
          const cw = el('div');
          cw.appendChild(renderColorPicker({
            current: sel.color || '#2B2D42',
            onChange: (c) => {
              sel.color = c;
              if (inlineEditorEl) inlineEditorEl.style.color = c;
            },
          }));
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '颜色' }), cw,
          ]));
        } else {
          const btnStyle = { padding: '6px 10px', fontSize: '13px', minHeight: '36px', borderRadius: '8px' };
          // 快速样式预设
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '预设' }),
            ...[
              { name: '标题', fontSize: 28, color: '#2B2D42', bgColor: '#FFFFFF', noBg: true },
              { name: '正文', fontSize: 18, color: '#2B2D42', bgColor: '#FFFFFF', noBg: true },
              { name: '注释', fontSize: 14, color: '#64748B', bgColor: '#FFFFFF', noBg: true },
              { name: '重点', fontSize: 20, color: '#EF476F', bgColor: '#FFD166', noBg: false },
            ].map(p => el('button', {
              class: 'tape-chip',
              text: p.name,
              onClick: () => {
                sel.fontSize = p.fontSize;
                sel.color = p.color;
                sel.bgColor = p.bgColor;
                sel.noBg = p.noBg;
                const lines = sel.text.split('\n');
                sel.h = Math.max(40, lines.length * p.fontSize * (sel.lineHeight || 1.5) + 8);
                textLayer.save();
                textLayer.redraw();
                updateSubToolbar();
              },
            })),
          ]));
          subBar.appendChild(el('div', { class: 'tape-row', style: { gap: '4px' } }, [
            el('button', { class: 'btn btn-ghost', text: '✏️', title: '编辑', style: btnStyle, onClick: () => openInlineTextEditor(sel) }),
            el('button', { class: 'btn btn-ghost', text: '📋复制', title: '复制', style: btnStyle, onClick: () => { clipboard = { type: 'text', data: JSON.parse(JSON.stringify(sel)) }; toastSuccess('已复制'); } }),
            el('button', { class: 'btn btn-ghost', text: '📝复制文字内容', title: '复制文字内容', style: btnStyle, onClick: async () => { try { await navigator.clipboard.writeText(sel.text || ''); toastSuccess('文字内容已复制'); } catch { toastError('复制失败'); } } }),
            el('button', { class: 'btn btn-ghost', text: '🖌', title: '格式刷', style: btnStyle, onClick: () => { formatClipboard = { fontSize: sel.fontSize, fontFamily: sel.fontFamily, lineHeight: sel.lineHeight, align: sel.align, color: sel.color, bgColor: sel.bgColor, noBg: sel.noBg }; toastSuccess('格式已复制'); } }),
            el('button', { class: 'btn btn-ghost', text: '⬆️', title: '置顶', style: btnStyle, onClick: () => { textLayer.bringToFront(sel); } }),
            el('button', { class: 'btn btn-ghost', text: '⬇️', title: '置底', style: btnStyle, onClick: () => { textLayer.sendToBack(sel); } }),
            el('button', { class: 'btn btn-ghost', text: sel.locked ? '🔒已锁' : '🔓锁定', title: sel.locked ? '已锁定' : '锁定', style: btnStyle, onClick: () => { const cur = textLayer.getSelected(); if (!cur) return; cur.locked = !cur.locked; textLayer.save(); textLayer.redraw(); updateSubToolbar(); } }),
            el('button', { class: 'btn btn-ghost', text: '📥粘贴', title: '粘贴', style: btnStyle, onClick: () => pasteClipboard() }),
            el('button', {
              class: 'btn btn-ghost', text: '📋 列表', title: '文字列表', style: btnStyle,
              onClick: () => textLayer.openTextListManager(),
            }),
            el('button', { class: 'btn btn-danger', text: '🗑', title: '删除', style: btnStyle, onClick: () => { pushUndo(); textLayer.removeText(sel); textLayer.select(null); textLayer.save(); textLayer.redraw(); updateSubToolbar(); } }),

          ]));

          // 字号
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '字号' }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '−', style: { minWidth: '22px', padding: '0 3px', fontSize: '12px', minHeight: '26px' }, onClick: () => { sel.fontSize = Math.max(10, (sel.fontSize || 20) - 1); const lines = sel.text.split('\n'); sel.h = Math.max(40, lines.length * sel.fontSize * (sel.lineHeight || 1.5) + 8); textLayer.save(); textLayer.redraw(); updateSubToolbar(); } }),
            el('input', { type: 'number', min: '10', max: '80', value: String(sel.fontSize || 20), style: { width: '48px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' }, onInput: (e) => { const v = Math.max(10, Math.min(80, Number(e.target.value) || 20)); sel.fontSize = v; const lines = sel.text.split('\n'); sel.h = Math.max(40, lines.length * v * (sel.lineHeight || 1.5) + 8); textLayer.save(); textLayer.redraw(); } }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '+', style: { minWidth: '22px', padding: '0 3px', fontSize: '12px', minHeight: '26px' }, onClick: () => { sel.fontSize = Math.min(80, (sel.fontSize || 20) + 1); const lines = sel.text.split('\n'); sel.h = Math.max(40, lines.length * sel.fontSize * (sel.lineHeight || 1.5) + 8); textLayer.save(); textLayer.redraw(); updateSubToolbar(); } }),
          ]));

          // 行距
          const lhRow = el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '行距' })]);
          const lhSelect = el('select', { style: { width: '80px', padding: '4px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }, onChange: (e) => { const v = e.target.value; if (v === 'custom') { lhCustom.style.display = 'inline-block'; lhCustom.focus(); } else { lhCustom.style.display = 'none'; sel.lineHeight = Number(v); const lines = sel.text.split('\n'); sel.h = Math.max(40, lines.length * (sel.fontSize || 20) * sel.lineHeight + 8); textLayer.save(); textLayer.redraw(); } } },
            [...[1.0, 1.1, 1.2, 1.25, 1.8, 2.0, 2.5].map(v => el('option', { value: String(v), text: String(v), selected: (sel.lineHeight || 1.5) === v })), el('option', { value: 'custom', text: '自定义…' })]
          );
          const lhCustom = el('input', { type: 'number', min: '0.5', max: '5.0', step: '0.1', value: String(sel.lineHeight || 1.5), placeholder: '行距', style: { width: '56px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)', display: 'none', marginLeft: '4px' }, onInput: (e) => { const v = Math.max(0.5, Math.min(5.0, Number(e.target.value) || 1.5)); sel.lineHeight = v; const lines = sel.text.split('\n'); sel.h = Math.max(40, lines.length * (sel.fontSize || 20) * v + 8); textLayer.save(); textLayer.redraw(); } });
          lhRow.appendChild(lhSelect); lhRow.appendChild(lhCustom); subBar.appendChild(lhRow);

          // 字体
          const fontSelect = el('select', { style: { flex: '1', padding: '4px 6px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)', minWidth: '80px' }, onChange: (e) => { sel.fontFamily = e.target.value; textLayer.save(); textLayer.redraw(); } },
            [
              el('option', { value: 'sans-serif', text: '黑体', selected: (sel.fontFamily || 'sans-serif') === 'sans-serif' }),
              el('option', { value: 'serif', text: '宋体', selected: sel.fontFamily === 'serif' }),
              el('option', { value: 'monospace', text: '等宽', selected: sel.fontFamily === 'monospace' }),
            ]
          );
          subBar.appendChild(el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '字体' }), fontSelect]));

          // 颜色
          const cw = el('div');
          cw.appendChild(renderColorPicker({ current: sel.color || '#2B2D42', onChange: (c) => { sel.color = c; textLayer.save(); textLayer.redraw(); } }));
          subBar.appendChild(el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '颜色' }), cw]));

          // 对齐
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '对齐' }),
            ...['left', 'center', 'right'].map(a => el('button', { class: 'tape-chip' + (sel.align === a ? ' active' : ''), text: a === 'left' ? '左对齐' : a === 'center' ? '居中' : '右对齐', onClick: () => { sel.align = a; textLayer.save(); textLayer.redraw(); updateSubToolbar(); } })),
          ]));

          // 背景色
          const bgW = el('div');
          bgW.appendChild(renderColorPicker({ current: sel.noBg ? 'none' : (sel.bgColor || '#FFFFFF'), onChange: (c) => { if (c === 'none') sel.noBg = true; else { sel.noBg = false; sel.bgColor = c; } textLayer.save(); textLayer.redraw(); }, allowNone: true }));
          subBar.appendChild(el('div', { class: 'tape-row' }, [el('span', { class: 'tape-label', text: '背景' }), bgW]));
          // ============ 透明度 ============
          const opNum = el('input', {
            type: 'number', min: '0', max: '1', step: '0.1',
            value: String(sel.opacity !== undefined ? sel.opacity : 1),
            style: { width: '48px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
            onInput: (e) => {
              sel.opacity = Math.max(0, Math.min(1, Number(e.target.value) || 1));
              opRange.value = sel.opacity;
              textLayer.save(); textLayer.redraw();
            },
          });
          const opRange = el('input', {
            type: 'range', min: '0', max: '1', step: '0.1',
            value: String(sel.opacity !== undefined ? sel.opacity : 1),
            style: { flex: '1', minWidth: '80px' },
            onInput: (e) => {
              sel.opacity = Number(e.target.value);
              opNum.value = sel.opacity;
              textLayer.save(); textLayer.redraw();
            },
          });
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '透明' }),
            opRange, opNum,
          ]));

          // ============ 旋转 ============
          const rotNum = el('input', {
            type: 'number', min: '-180', max: '180', step: '15',
            value: String(sel.rotation || 0),
            style: { width: '56px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
            onInput: (e) => {
              sel.rotation = Number(e.target.value) || 0;
              rotRange.value = sel.rotation;
              textLayer.save(); textLayer.redraw();
            },
          });
          const rotRange = el('input', {
            type: 'range', min: '-180', max: '180', step: '15',
            value: String(sel.rotation || 0),
            style: { flex: '1', minWidth: '80px' },
            onInput: (e) => {
              sel.rotation = Number(e.target.value);
              rotNum.value = sel.rotation;
              textLayer.save(); textLayer.redraw();
            },
          });
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('span', { class: 'tape-label', text: '旋转' }),
            rotRange, rotNum,
            el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: '°' }),
          ]));
        }
      } else {
        subBar.appendChild(el('div', { class: 'tape-row' }, [el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '点击图片任意位置添加文字' })]));
      }
    }

    subBar.style.display = subBar.children.length > 0 ? 'flex' : 'none';
    // 子工具栏有内容时，确保设置面板是展开的
    if (subBar.children.length > 0) {
      settingPanel.style.display = 'flex';
      panelVisible = true;
    }
  }
  window.__updateSubToolbar = updateSubToolbar;
  function drawPolygonOnCanvas() {
    if (polygonPoints.length < 3) return;
    const bc = window.__shapeBorderColor || currentColor;
    const fc = window.__shapeFillColor || 'transparent';
    const scaleFactor = Math.sqrt(W / 800);
    ctx.save();
    if (fc !== 'transparent' && fc !== 'none') {
      ctx.fillStyle = fc;
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i++) ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = bc;
    ctx.lineWidth = currentWidth / scaleFactor;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
    for (let i = 1; i < polygonPoints.length; i++) ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // ============ 预设形状绘制 ============
  function drawPresetShape(targetCtx, type, x1, y1, x2, y2, bc, fc, lineWidth) {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    const cx = x + w / 2, cy = y + h / 2;

    targetCtx.save();
    targetCtx.strokeStyle = bc;
    targetCtx.lineWidth = lineWidth;
    targetCtx.lineJoin = 'round';
    targetCtx.lineCap = 'round';

    const fill = (pathFn) => {
      if (fc && fc !== 'transparent' && fc !== 'none') {
        targetCtx.fillStyle = fc;
        targetCtx.beginPath();
        pathFn();
        targetCtx.fill();
      }
    };

    if (type === 'circle') {
      fill(() => targetCtx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2));
      targetCtx.beginPath();
      targetCtx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      targetCtx.stroke();
    } else if (type === 'triangle') {
      const path = () => {
        targetCtx.moveTo(cx, y);
        targetCtx.lineTo(x + w, y + h);
        targetCtx.lineTo(x, y + h);
        targetCtx.closePath();
      };
      fill(path);
      targetCtx.beginPath();
      path();
      targetCtx.stroke();
    } else if (type === 'star') {
      const points = [];
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.4;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      const path = () => {
        targetCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) targetCtx.lineTo(points[i].x, points[i].y);
        targetCtx.closePath();
      };
      fill(path);
      targetCtx.beginPath();
      path();
      targetCtx.stroke();
    } else if (type === 'dialog') {
      const r = Math.min(w, h) * 0.1;
      const path = () => {
        targetCtx.moveTo(x + r, y);
        targetCtx.lineTo(x + w - r, y);
        targetCtx.quadraticCurveTo(x + w, y, x + w, y + r);
        targetCtx.lineTo(x + w, y + h - r);
        targetCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        targetCtx.lineTo(cx + w * 0.1, y + h);
        targetCtx.lineTo(cx - w * 0.1, y + h + h * 0.15);
        targetCtx.lineTo(cx - w * 0.1, y + h);
        targetCtx.lineTo(x + r, y + h);
        targetCtx.quadraticCurveTo(x, y + h, x, y + h - r);
        targetCtx.lineTo(x, y + r);
        targetCtx.quadraticCurveTo(x, y, x + r, y);
        targetCtx.closePath();
      };
      fill(path);
      targetCtx.beginPath();
      path();
      targetCtx.stroke();
    } else if (type === 'flag') {
      const poleX = x + w * 0.2;
      targetCtx.beginPath();
      targetCtx.moveTo(poleX, y);
      targetCtx.lineTo(poleX, y + h);
      targetCtx.stroke();
      const path = () => {
        targetCtx.moveTo(poleX, y);
        targetCtx.lineTo(x + w, y + h * 0.2);
        targetCtx.lineTo(poleX, y + h * 0.4);
        targetCtx.closePath();
      };
      fill(path);
      targetCtx.beginPath();
      path();
      targetCtx.stroke();
    } else if (type === 'check') {
      targetCtx.beginPath();
      targetCtx.moveTo(x + w * 0.2, y + h * 0.5);
      targetCtx.lineTo(x + w * 0.4, y + h * 0.8);
      targetCtx.lineTo(x + w * 0.85, y + h * 0.2);
      targetCtx.stroke();
    } else if (type === 'cross') {
      targetCtx.beginPath();
      targetCtx.moveTo(x + w * 0.2, y + h * 0.2);
      targetCtx.lineTo(x + w * 0.8, y + h * 0.8);
      targetCtx.moveTo(x + w * 0.8, y + h * 0.2);
      targetCtx.lineTo(x + w * 0.2, y + h * 0.8);
      targetCtx.stroke();
    } else if (type === 'ban') {
      const r = Math.min(w, h) / 2;
      targetCtx.beginPath();
      targetCtx.arc(cx, cy, r, 0, Math.PI * 2);
      targetCtx.stroke();
      targetCtx.beginPath();
      const angle = Math.PI / 4;
      targetCtx.moveTo(cx - r * Math.cos(angle), cy - r * Math.sin(angle));
      targetCtx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
      targetCtx.stroke();
    } else if (type === 'custom-image') {
      const img = window.__shapeImageCache?.[window.__shapeImageId];
      if (img) {
        targetCtx.drawImage(img, x, y, w, h);
      }
    }

    targetCtx.restore();
  }

  // ============ 上传形状图片 ============
  async function openShapeImageUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/svg+xml';
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
      if (store.addPattern) store.addPattern({ id, thumbUrl, type: 'shape-image' });
      window.__shapeImageId = id;
      toastSuccess('形状图片已添加');
      updateSubToolbar();
    };
    input.click();
  }
  // ============ 内联文字编辑 ============
  function openInlineTextEditor(textItem) {
    closeInlineTextEditor();
    textItem.visible = false;
    textLayer.redraw();
    const rect = strokeCanvas.getBoundingClientRect();
    const sx = rect.width / W;
    const sy = rect.height / H;

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = textItem.text || '';
    editor.style.cssText = `
      position: fixed;
      left: ${rect.left + textItem.x * sx}px;
      top: ${rect.top + textItem.y * sy}px;
      width: ${Math.max(120, textItem.w * sx)}px;
      min-height: ${Math.max(40, textItem.h * sy)}px;
      font-size: ${(textItem.fontSize || 20) * sx}px;
      font-family: ${textItem.fontFamily || 'sans-serif'};
      line-height: ${textItem.lineHeight || 1.5};
      color: ${textItem.color || '#2B2D42'};
      background: ${textItem.noBg ? 'rgba(255,255,255,.9)' : (textItem.bgColor || '#FFFFFF')};
      border: 2px solid #3B82F6;
      border-radius: 6px;
      padding: 4px;
      outline: none;
      z-index: 999;
      white-space: pre-wrap;
      word-break: break-word;
      overflow: auto;
      text-align: ${textItem.align || 'left'};
    `;
    editor.dataset.inlineEditor = '1';
    document.body.appendChild(editor);
    if (window.visualViewport) {
      const adjustPosition = () => {
        const vv = window.visualViewport;
        const editorRect = editor.getBoundingClientRect();
        if (editorRect.bottom > vv.height - 20) {
          editor.style.top = Math.max(10, vv.height - editorRect.height - 30) + 'px';
        }
      };
      window.visualViewport.addEventListener('resize', adjustPosition);
      editor._adjustPosition = adjustPosition;
    }
    inlineEditorEl = editor;

    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function saveInlineText() {
      if (!inlineEditorEl) return;
      textItem.text = editor.textContent || '';
      if (textItem.text.trim() === '') {
        textLayer.save();
        textLayer.redraw();
      } else {
        const fs = textItem.fontSize || 20;
        const lines = textItem.text.split('\n');
        textItem.h = Math.max(40, lines.length * fs * (textItem.lineHeight || 1.5) + 8);
        textLayer.save();
        textLayer.redraw();
      }
      textItem.visible = true;
      textLayer.redraw();
      closeInlineTextEditor();
      updateSubToolbar();
    }

    function onInput() {
      const text = editor.textContent || '';
      textItem.text = text;
      const fs = textItem.fontSize || 20;
      const lines = text.split('\n');
      textItem.h = Math.max(40, lines.length * fs * (textItem.lineHeight || 1.5) + 8);
      textLayer.redraw();
      dirty = true;
      if (typeof setSaveStatus === 'function') setSaveStatus('dirty');
      editor.style.minHeight = Math.max(40, textItem.h * sy) + 'px';
    }
    editor.addEventListener('input', onInput);

    editor.addEventListener('blur', () => {
      setTimeout(() => {
        if (inlineEditorEl !== editor) return;
        const text = editor.textContent || '';
        if (text.trim() === '') return;
        saveInlineText();
      }, 500);
    });

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
        e.preventDefault();
        saveInlineText();
      }
    });

    editor._saveInlineText = saveInlineText;
  }

  function closeInlineTextEditor() {
    if (inlineEditorEl) {
      const e = inlineEditorEl;
      inlineEditorEl = null;
      e.remove();
    }
    // 确保当前选中文字可见
    const sel = textLayer.getSelected();
    if (sel && sel.visible === false) {
      sel.visible = true;
      textLayer.redraw();
    }
  }

  function saveInlineTextNow() {
    window.__openTextEditor = openInlineTextEditor;
    if (inlineEditorEl && inlineEditorEl._saveInlineText) inlineEditorEl._saveInlineText();
  }

  // ============ 扩展画布 ============
  function openExpandDialog() {
    const papers = paperLayer.getPapers();
    const dirSelect = el('select', { id: 'expand-dir', onChange: () => updatePreview() }, [
      el('option', { value: 'top', text: '↑ 上方' }),
      el('option', { value: 'bottom', text: '↓ 下方' }),
      el('option', { value: 'left', text: '← 左侧' }),
      el('option', { value: 'right', text: '→ 右侧' }),
    ]);
    const presetSelect = el('select', { id: 'expand-preset', onChange: () => { pxInput.disabled = presetSelect.value !== 'custom'; updatePreview(); } }, [
      el('option', { value: 'custom', text: '自定义像素' }),
      el('option', { value: 'a4', text: 'A4（2480×3508）' }),
      el('option', { value: 'a3', text: 'A3（3508×4961）' }),
      el('option', { value: 'a5', text: 'A5（1748×2480）' }),
      el('option', { value: 'square', text: '正方形（2000×2000）' }),
      el('option', { value: '16:9', text: '16:9（2560×1440）' }),
      el('option', { value: '4:3', text: '4:3（2048×1536）' }),
      el('option', { value: 'original', text: '与图片一致' }),
    ]);
    const pxInput = el('input', { type: 'number', id: 'expand-px', value: '200', min: '50', max: '5000', onInput: () => updatePreview() });
    const colorSelect = el('select', { id: 'expand-color', onChange: () => { customColorField.style.display = colorSelect.value === 'custom' ? 'block' : 'none'; updatePreview(); } }, [
      el('option', { value: '#FFFFFF', text: '白色' }),
      el('option', { value: 'transparent', text: '透明' }),
      el('option', { value: 'custom', text: '自定义' }),
    ]);
    const customColorInput = el('input', { type: 'color', id: 'expand-custom-color', value: '#FFFFFF', onInput: () => updatePreview() });
    const customColorField = el('div', { class: 'field', style: { display: 'none' } }, [
      el('label', { text: '自定义颜色' }), customColorInput,
    ]);
    const previewText = el('div', { id: 'expand-preview', style: { fontSize: '13px', color: 'var(--text-2)', marginTop: '8px', padding: '8px', background: 'var(--bg)', borderRadius: '8px' } });

    function updatePreview() {
      const dir = dirSelect.value;
      const preset = presetSelect.value;
      let newW = W, newH = H;
      if (preset === 'original') { newW = img.width; newH = img.height; }
      else if (preset === 'a4') { newW = 2480; newH = 3508; }
      else if (preset === 'a3') { newW = 3508; newH = 4961; }
      else if (preset === 'a5') { newW = 1748; newH = 2480; }
      else if (preset === 'square') { newW = 2000; newH = 2000; }
      else if (preset === '16:9') { newW = 2560; newH = 1440; }
      else if (preset === '4:3') { newW = 2048; newH = 1536; }
      else {
        const px = Math.max(50, Math.min(5000, Number(pxInput.value) || 200));
        if (dir === 'top' || dir === 'bottom') newH = H + px;
        else newW = W + px;
      }
      const color = colorSelect.value === 'custom' ? customColorInput.value : colorSelect.value;
      previewText.textContent = `即将扩展为：${newW} × ${newH} px（原 ${W} × ${H}），扩展区域颜色：${color === 'transparent' ? '透明' : color}`;
    }

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '420px' } }, [
        el('h3', { text: '扩展画布' }),
        el('div', { class: 'field' }, [el('label', { text: '方向' }), dirSelect]),
        el('div', { class: 'field' }, [el('label', { text: '预设尺寸' }), presetSelect]),
        el('div', { class: 'field' }, [el('label', { text: '扩展像素（自定义时有效）' }), pxInput]),
        el('div', { class: 'field' }, [el('label', { text: '扩展区域颜色' }), colorSelect]),
        customColorField,
        previewText,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-primary', text: '扩展',
            onClick: async () => {
              const dir = dirSelect.value;
              const preset = presetSelect.value;
              const color = colorSelect.value === 'custom' ? customColorInput.value : colorSelect.value;
              if (preset === 'original') {
                if (W === img.width && H === img.height) { toastError('当前已是原图大小'); return; }
                mask.remove();
                await doResizeToOriginal(img.width, img.height);
                return;
              }
              let targetW = W, targetH = H;
              if (preset === 'a4') { targetW = 2480; targetH = 3508; }
              else if (preset === 'a3') { targetW = 3508; targetH = 4961; }
              else if (preset === 'a5') { targetW = 1748; targetH = 2480; }
              else if (preset === 'square') { targetW = 2000; targetH = 2000; }
              else if (preset === '16:9') { targetW = 2560; targetH = 1440; }
              else if (preset === '4:3') { targetW = 2048; targetH = 1536; }
              else {
                const px = Math.max(50, Math.min(5000, Number(pxInput.value) || 200));
                if (dir === 'top' || dir === 'bottom') targetH = H + px;
                else targetW = W + px;
              }
              mask.remove();
              await doExpandToSize(targetW, targetH, color);
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
    updatePreview();
  }

  async function doResizeToOriginal(newW, newH) {
    const newStroke = document.createElement('canvas');
    newStroke.width = newW; newStroke.height = newH;
    newStroke.getContext('2d').drawImage(strokeCanvas, 0, 0);

    const newPaperStroke = document.createElement('canvas');
    newPaperStroke.width = newW; newPaperStroke.height = newH;
    newPaperStroke.getContext('2d').drawImage(paperStrokeCanvas, 0, 0);

    const strokeBlob = await new Promise(r => newStroke.toBlob(r, 'image/png'));
    const paperStrokeBlob = await new Promise(r => newPaperStroke.toBlob(r, 'image/png'));
    const annotatedBlob = await new Promise(r => {
      const m = document.createElement('canvas');
      m.width = newW; m.height = newH;
      const mctx = m.getContext('2d');
      mctx.drawImage(baseImg, 0, 0);
      mctx.drawImage(newStroke, 0, 0);
      mctx.drawImage(newPaperStroke, 0, 0);
      m.toBlob(r, 'image/png');
    });

    await putImageCached({
      ...img,
      originalBlob: img.originalBlob,
      strokeBlob,
      paperStrokeBlob,
      annotatedBlob,
      width: newW, height: newH,
      updatedAt: new Date().toISOString(),
    });
    toastSuccess(`已调整为 ${newW}×${newH}，即将刷新`);
    setTimeout(() => location.reload(), 500);
  }

  async function doExpandToSize(newW, newH, bgColor) {
    const newOriginal = document.createElement('canvas');
    newOriginal.width = newW; newOriginal.height = newH;
    const octx = newOriginal.getContext('2d');
    if (bgColor === 'transparent') octx.clearRect(0, 0, newW, newH);
    else { octx.fillStyle = bgColor; octx.fillRect(0, 0, newW, newH); }
    octx.drawImage(baseImg, 0, 0);

    const newStroke = document.createElement('canvas');
    newStroke.width = newW; newStroke.height = newH;
    newStroke.getContext('2d').drawImage(strokeCanvas, 0, 0);

    const newPaperStroke = document.createElement('canvas');
    newPaperStroke.width = newW; newPaperStroke.height = newH;
    newPaperStroke.getContext('2d').drawImage(paperStrokeCanvas, 0, 0);

    const originalBlob = await new Promise(r => newOriginal.toBlob(r, 'image/png'));
    const strokeBlob = await new Promise(r => newStroke.toBlob(r, 'image/png'));
    const paperStrokeBlob = await new Promise(r => newPaperStroke.toBlob(r, 'image/png'));
    const annotatedBlob = await new Promise(r => {
      const m = document.createElement('canvas');
      m.width = newW; m.height = newH;
      const mctx = m.getContext('2d');
      mctx.drawImage(newOriginal, 0, 0);
      mctx.drawImage(newStroke, 0, 0);
      mctx.drawImage(newPaperStroke, 0, 0);
      mctx.drawImage(tapeCanvas, 0, 0);
      mctx.drawImage(textCanvas, 0, 0);
      m.toBlob(r, 'image/png');
    });

    await putImageCached({
      ...img,
      originalBlob,
      strokeBlob,
      paperStrokeBlob,
      annotatedBlob,
      width: newW, height: newH,
      updatedAt: new Date().toISOString(),
    });
    toastSuccess(`已扩展为 ${newW}×${newH}，即将刷新`);
    setTimeout(() => location.reload(), 500);
  }

  // ============ 顶栏动态按钮 ============
  const dynBar = document.getElementById('topbar-dynamic');
  let setSaveStatus = () => { };
  let updateUndoBtn = () => { };
  if (dynBar) {
    dynBar.innerHTML = '';
    const mk = (label, title, fn) => {
      const b = el('button', { class: 'btn btn-sm btn-ghost', text: label, title, onClick: fn });
      attachLongPress(b, title);
      return b;
    };
    dynBar.appendChild(mk('←', '左移', () => { offsetX += 40; updateTransform(); }));
    dynBar.appendChild(mk('→', '右移', () => { offsetX -= 40; updateTransform(); }));
    dynBar.appendChild(mk('↑', '上移', () => { offsetY += 40; updateTransform(); }));
    dynBar.appendChild(mk('↓', '下移', () => { offsetY -= 40; updateTransform(); }));
    dynBar.appendChild(mk('🔍+', '放大', () => { scale = Math.min(10, scale * 1.25); updateTransform(); }));
    dynBar.appendChild(mk('🔍-', '缩小', () => { scale = Math.max(0.3, scale / 1.25); updateTransform(); }));
    dynBar.appendChild(mk('1:1', '原始大小', () => { scale = 1; offsetX = 0; offsetY = 0; updateTransform(); }));
    const undoBtn = mk('↶', '撤销', undo);
    dynBar.appendChild(undoBtn);
    updateUndoBtn = () => {
      const n = undoStack.length;
      undoBtn.textContent = n > 0 ? `↶ ${n}` : '↶';
      undoBtn.style.opacity = n > 0 ? '1' : '0.4';
    };
    updateUndoBtn();
    dynBar.appendChild(mk('🗑', '清除', clearAll));
    dynBar.appendChild(mk('➕', '扩展画布', openExpandDialog));
    dynBar.appendChild(mk('📚', '图层顺序', openLayerPanel));
    dynBar.appendChild(mk('💾', '保存', () => saveAll(true)));
    dynBar.appendChild(mk('🔒', '显示/隐藏全部锁图标', () => {
      const cur = textLayer.getShowLockIcons();
      textLayer.setShowLockIcons(!cur);
      tapeLayer.setShowLockIcons(!cur);
      toastSuccess(cur ? '锁图标已隐藏' : '锁图标已显示');
    }));
    const saveStatusDot = el('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#06D6A0', marginLeft: '6px', transition: 'background .3s' }, title: '已保存' });
    dynBar.appendChild(saveStatusDot);
    setSaveStatus = (status) => {
      if (status === 'saved') { saveStatusDot.style.background = '#06D6A0'; saveStatusDot.title = '已保存'; }
      else if (status === 'dirty') { saveStatusDot.style.background = '#FFD166'; saveStatusDot.title = '有改动，未保存'; }
      else if (status === 'saving') { saveStatusDot.style.background = '#8ECAE6'; saveStatusDot.title = '保存中…'; }
      else if (status === 'error') { saveStatusDot.style.background = '#EF476F'; saveStatusDot.title = '保存失败'; }
    };
  }
  window.__saveAll = saveAll;
  window.__setSaveStatus = setSaveStatus;

  // ============ 长按提示 ============
  let tooltipEl = null;
  function showTooltip(btn, text) {
    hideTooltip();
    const rect = btn.getBoundingClientRect();
    tooltipEl = el('div', {
      style: { position: 'fixed', left: rect.left + rect.width / 2 + 'px', top: rect.bottom + 8 + 'px', transform: 'translateX(-50%)', background: 'rgba(43,45,66,.95)', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '9999' },
      text,
    });
    document.body.appendChild(tooltipEl);
  }
  function hideTooltip() { if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; } }
  function attachLongPress(btn, text) {
    let timer = null;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); timer = setTimeout(() => showTooltip(btn, text), 500); });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); clearTimeout(timer); setTimeout(hideTooltip, 800); });
    btn.addEventListener('pointerleave', () => { clearTimeout(timer); hideTooltip(); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ============ 清除 ============
  async function clearAll() {
    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '300px' } }, [
        el('h3', { text: '清除' }),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '12px 0' } }, [
          el('label', {}, [el('input', { type: 'checkbox', id: 'clr-stroke', checked: true }), ' 笔迹']),
          el('label', {}, [el('input', { type: 'checkbox', id: 'clr-tape', checked: true }), ' 胶带']),
          el('label', {}, [el('input', { type: 'checkbox', id: 'clr-paper', checked: true }), ' 纸张']),
        ]),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '清除',
            onClick: () => {
              pushUndo(true);
              if (document.getElementById('clr-stroke').checked) {
                ctx.clearRect(0, 0, W, H);
                paperStrokeCtx.clearRect(0, 0, W, H);
                textLayer.getItems().length = 0;
                textLayer.save();
                textLayer.redraw();
              }
              if (document.getElementById('clr-tape').checked) {
                tapeLayer.getTapes().length = 0;
                store.saveTape(imageId, []);
                tapeLayer.redrawAsync();
              }
              if (document.getElementById('clr-paper').checked) {
                paperLayer.getPapers().length = 0;
                store.savePaper(imageId, []);
                paperLayer.redraw();
              }
              dirty = true;
              setSaveStatus('dirty');
              mask.remove();
            },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  }

  // ============ 图层顺序 ============
  function openLayerPanel() {
    const tempOrder = [...currentLayerOrder];
    const labels = { base: '🖼 底图', stroke: '✏️ 笔迹', text: 'T 文字', tape: '🎗️ 胶带', paper: '📄 纸张', paperStroke: '✏️ 纸张笔迹' };
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });
    function renderList() {
      list.innerHTML = '';
      if (shapes.length === 0) {
        list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '还没有自定义形状' }));
        return;
      }
      shapes.forEach(p => {
        const checked = selected.has(p.id);
        const row = el('div', {
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
            class: 'tape-chip', text: tapePatternImageId === p.id ? '✅ 使用中' : '使用',
            onClick: () => {
              tapeShape = 'custom';
              tapePatternImageId = p.id;
              renderTapeToolbar();
              mask.remove();
            },
          }),
        ]);
        list.appendChild(row);
      });
    }
    renderList();
    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '380px' } }, [
        el('h3', { text: '图层顺序' }),
        el('p', { text: '从下到上排列', style: { fontSize: '13px', color: 'var(--text-2)' } }),
        list,
        el('div', { class: 'confirm-actions', style: { flexWrap: 'wrap' } }, [
          el('button', { class: 'btn btn-ghost', text: '恢复默认', onClick: () => { tempOrder.length = 0; tempOrder.push(...DEFAULT_LAYER_ORDER); applyLayerOrder(tempOrder); renderList(); } }),
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { applyLayerOrder(DEFAULT_LAYER_ORDER); currentLayerOrder = [...DEFAULT_LAYER_ORDER]; if (store.saveLayerOrder) store.saveLayerOrder(DEFAULT_LAYER_ORDER); mask.remove(); } }),
          el('button', { class: 'btn btn-primary', text: '保存', onClick: () => { currentLayerOrder = [...tempOrder]; if (store.saveLayerOrder) store.saveLayerOrder(currentLayerOrder); mask.remove(); toastSuccess('已保存'); } }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
  }

  // ============ 复制 / 粘贴 ============
  function copySelected() {
    const selText = textLayer.getSelected();
    if (selText && currentTool === 'text') { clipboard = { type: 'text', data: JSON.parse(JSON.stringify(selText)) }; toastSuccess('已复制文字'); return; }
    const selTape = tapeLayer.getSelected();
    if (selTape && currentTool === 'tape') { clipboard = { type: 'tape', data: JSON.parse(JSON.stringify(selTape)) }; toastSuccess('已复制胶带'); return; }
    const selPaper = paperLayer.getSelected();
    if (selPaper && currentTool === 'paper') { clipboard = { type: 'paper', data: JSON.parse(JSON.stringify(selPaper)) }; toastSuccess('已复制纸张'); return; }
    toastError('请先选中要复制的对象');
  }

  function pasteClipboard() {
    if (!clipboard) { toastError('剪贴板为空'); return; }
    pushUndo();
    if (clipboard.type === 'text') {
      const copy = { ...clipboard.data, id: crypto.randomUUID(), x: clipboard.data.x + 20, y: clipboard.data.y + 20 };
      textLayer.getItems().push(copy);
      textLayer.select(copy);
      textLayer.save();
      textLayer.redraw();
      setActiveTool('text');
    } else if (clipboard.type === 'tape') {
      const copy = { ...clipboard.data, id: crypto.randomUUID(), points: clipboard.data.points.map(p => ({ x: p.x + 20, y: p.y + 20 })), erasedPath: [], locked: false };
      tapeLayer.getTapes().push(copy);
      tapeLayer.select(copy.id);
      store.saveTape(imageId, tapeLayer.getTapes());
      tapeLayer.redrawAsync();
      setActiveTool('tape');
    } else if (clipboard.type === 'paper') {
      const copy = { ...clipboard.data, id: crypto.randomUUID(), x: clipboard.data.x + 20, y: clipboard.data.y + 20, locked: false, strokes: clipboard.data.strokes ? JSON.parse(JSON.stringify(clipboard.data.strokes)) : [] };
      paperLayer.getPapers().push(copy);
      paperLayer.select(copy);
      paperLayer.save();
      paperLayer.redraw();
      setActiveTool('paper');
    }
    dirty = true;
    setSaveStatus('dirty');
    toastSuccess('已粘贴');
  }
  // ============ 手势事件 ============
  strokeCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const isTouch = e.pointerType === 'touch';
    const shouldDrawWithFinger = inputMode === 'finger-draw';
    const shouldPanWithFinger = isTouch && !shouldDrawWithFinger;

    if (shouldPanWithFinger && currentTool !== 'hand') {
      if (pointers.size === 0) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drawing = 'pan';
        startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
        strokeCanvas.setPointerCapture(e.pointerId);
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        drawing = 'pinch';
        startPt = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
        };
      }
      return;
    }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      drawing = false;
      const pts = [...pointers.values()];
      startPt = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
      drawing = 'pinch';
      return;
    }

    // 吸管
    if (currentTool === 'eyedropper') {
      const pt = canvasToImage(e.clientX, e.clientY);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = W;
      tempCanvas.height = H;
      const tctx = tempCanvas.getContext('2d');
      tctx.drawImage(baseImg, 0, 0);
      try {
        const pixel = tctx.getImageData(Math.round(pt.x), Math.round(pt.y), 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        currentColor = hex;
        toastSuccess(`已取色 ${hex}`);
        setActiveTool('pen');
        refreshColorBar();
      } catch { toastError('取色失败'); }
      return;
    }

    // 抓手
    if (currentTool === 'hand') {
      drawing = 'pan';
      startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
      strokeCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // 统一坐标转换
    const pt = canvasToImage(e.clientX, e.clientY);

    // ============ 胶带 ============
    if (currentTool === 'tape') {
      console.log('胶带 pointerdown，tapeSelectMode:', tapeSelectMode, 'drawing:', drawing, '选中数:', tapeLayer.getSelectedIds().length);

      // 框选模式：只有已选中胶带时才进入
      if (tapeSelectMode && tapeLayer.getSelectedIds().length > 0) {
        const tapes = tapeLayer.getTapes();
        let hit = null;
        for (let i = tapes.length - 1; i >= 0; i--) {
          if (tapeLayer.hitTape(tapes[i], pt.x, pt.y, 0)) {
            hit = tapes[i];
            break;
          }
        }
        if (hit) {
          tapeLayer.toggleSelect(hit.id);
          updateSubToolbar();
          const count = tapeLayer.getSelectedIds().length;
          toastSuccess(count > 0 ? `已选中 ${count} 条胶带` : '已取消选中');
        } else {
          drawing = 'tape-select';
          startPt = pt;
          points = [pt];
          strokeCanvas.setPointerCapture(e.pointerId);
        }
        return;
      }

      // 非框选模式：单击显隐 / 长按选中
      const tapes = tapeLayer.getTapes();
      for (let i = tapes.length - 1; i >= 0; i--) {
        if (tapeLayer.hitTape(tapes[i], pt.x, pt.y, 0)) {
          const hitTape = tapes[i];
          tapeLayer.toggleVisible(hitTape.id);
          let longPressed = false;
          const timer = setTimeout(() => {
            longPressed = true;
            tapeLayer.toggleVisible(hitTape.id);
            tapeLayer.toggleSelect(hitTape.id);
            updateSubToolbar();
            panelVisible = true;
            if (settingPanel) settingPanel.style.display = 'flex';
            const count = tapeLayer.getSelectedIds().length;
            toastSuccess(count > 1 ? `已选中 ${count} 条胶带` : '已选中胶带');
          }, 500);
          const onUp = () => {
            clearTimeout(timer);
            strokeCanvas.removeEventListener('pointerup', onUp);
            strokeCanvas.removeEventListener('pointercancel', onUp);
          };
          strokeCanvas.addEventListener('pointerup', onUp);
          strokeCanvas.addEventListener('pointercancel', onUp);
          return;
        }
      }

      // 点空白：画新胶带（如果在纸张内，记到纸张上）
      pushUndo();
      const hitPaper = paperLayer.hitTest(pt.x, pt.y);
      if (hitPaper && !hitPaper.locked) {
        // 纸张内胶带
        if (!hitPaper._currentTape) {
          hitPaper._currentTape = {
            id: crypto.randomUUID(),
            points: [{ x: pt.x - hitPaper.x, y: pt.y - hitPaper.y }],
            width: tapeLayer.getWidth(),
            color: tapeLayer.getColor(),
            shape: tapeLayer.getShape(),
            pattern: tapeLayer.getPattern(),
            patternImageId: tapeLayer.getPatternImageId(),
            opacity: 1,
            rotation: 0,
            visible: true,
            erasedPath: [],
          };
        }
        drawing = 'paper-tape';
        startPt = pt;
        points = [pt];
        strokeCanvas.setPointerCapture(e.pointerId);
        return;
      }
      drawing = 'tape';
      startPt = pt;
      points = [pt];
      strokeCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // ============ 画笔 / 橡皮 ============
    if (currentTool === 'pen' || currentTool === 'eraser') {
      pushUndo();
      drawing = currentTool === 'eraser' ? 'eraser' : true;
      const pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
      points = [{ ...pt, pressure }];
      if (currentTool === 'eraser') {
        const eraserRadius = currentWidth * 2 / Math.sqrt(W / 800);
        if (eraserShape === 'square') {
          eraseSquare(ctx, pt.x, pt.y, eraserRadius);
          eraseSquare(paperStrokeCtx, pt.x, pt.y, eraserRadius);
        } else {
          eraseCircle(ctx, pt.x, pt.y, eraserRadius);
          eraseCircle(paperStrokeCtx, pt.x, pt.y, eraserRadius);
        }
        tapeLayer.eraseSegment(pt.x, pt.y, pt.x, pt.y, eraserRadius);
      }
      strokeCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // ============ 圈擦 ============
    if (currentTool === 'circle-erase') {
      pushUndo();
      drawing = 'circle-erase';
      startPt = pt;
      if (eraseShape === 'free') eraseFreePath = [pt];
      strokeCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // ============ 形状 ============
    if (currentTool === 'shape') {
      // 自由多边形：点一下加一个点
      if (shapeType === 'polygon') {
        if (!polygonDrawing) {
          pushUndo();
          polygonDrawing = true;
          polygonPoints = [pt];
        } else {
          // 判断是否双击结束（距离上一个点很近）
          const last = polygonPoints[polygonPoints.length - 1];
          if (Math.hypot(pt.x - last.x, pt.y - last.y) < 10 && polygonPoints.length >= 3) {
            // 双击结束：绘制多边形
            drawPolygonOnCanvas();
            polygonDrawing = false;
            polygonPoints = [];
            clearPreview();
            dirty = true;
          } else {
            polygonPoints.push(pt);
            // 预览
            clearPreview();
            previewCtx.save();
            previewCtx.strokeStyle = window.__shapeBorderColor || currentColor;
            previewCtx.lineWidth = currentWidth;
            previewCtx.setLineDash([6, 4]);
            previewCtx.beginPath();
            previewCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
            for (let i = 1; i < polygonPoints.length; i++) previewCtx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
            previewCtx.stroke();
            previewCtx.restore();
          }
        }
        return;
      }
      pushUndo();
      drawing = shapeType;
      startPt = pt;
      strokeCanvas.setPointerCapture(e.pointerId);
      return;
    }


    // ============ 文字 ============
    if (currentTool === 'text') {
      const hit = textLayer.hitTest(pt.x, pt.y);
      if (hit) {
        const wasSelected = textLayer.getSelected() === hit;
        textLayer.select(hit);
        panelVisible = true;
        if (formatClipboard) {
          hit.fontSize = formatClipboard.fontSize;
          hit.fontFamily = formatClipboard.fontFamily;
          hit.lineHeight = formatClipboard.lineHeight;
          hit.align = formatClipboard.align;
          hit.color = formatClipboard.color;
          hit.bgColor = formatClipboard.bgColor;
          hit.noBg = formatClipboard.noBg;
          const lines = (hit.text || '').split('\n');
          hit.h = Math.max(40, lines.length * hit.fontSize * hit.lineHeight + 8);
          textLayer.save();
          textLayer.redraw();
          formatClipboard = null;
          updateSubToolbar();
          return;
        }
        if (settingPanel) settingPanel.style.display = 'flex';
        updateSubToolbar();
        if (hit.locked) { toastError('已锁定'); return; }
        if (wasSelected) {
          const handle = textLayer.hitHandle(pt.x, pt.y);
          if (handle) {
            if (handle.id === 'rotate') {
              textDragOffset = textLayer.startRotate(pt.x, pt.y);
              drawing = 'text-rotate';
            } else {
              textDragOffset = textLayer.startResize(handle.id, pt.x, pt.y);
              drawing = 'text-resize';
            }
            strokeCanvas.setPointerCapture(e.pointerId);
            return;
          }
        }
        drawing = 'text-drag';
        textDragOffset = { dx: pt.x - hit.x, dy: pt.y - hit.y, item: hit };
        strokeCanvas.setPointerCapture(e.pointerId);
      } else {
        pushUndo();
        const newItem = textLayer.addText({ x: pt.x, y: pt.y, text: '', fontSize: 20, fontFamily: 'sans-serif', lineHeight: 1.5, align: 'left', color: currentColor, bgColor: '#FFFFFF', noBg: true, w: 160, h: 40 });
        textLayer.select(newItem);
        panelVisible = true;
        if (settingPanel) settingPanel.style.display = 'flex';
        openInlineTextEditor(newItem);
        updateSubToolbar();
        dirty = true;
        setSaveStatus('dirty');
      }
      return;
    }

    // ============ 纸张 ============
    if (currentTool === 'paper') {
      paperLayer.handlePointerDown(pt.x, pt.y);
      // 纸张内画胶带
      if (currentTool === 'tape') {
        // 不在这里处理，胶带分支在前面已经处理了
      }
      const sel = paperLayer.getSelected();
      if (sel) {
        // 双击检测：两次点击在 350ms 内且位置接近
        const now = Date.now();
        const lastClick = window.__paperLastClick || { id: null, time: 0, x: 0, y: 0 };
        if (lastClick.id === sel.id && now - lastClick.time < 350 &&
          Math.hypot(pt.x - lastClick.x, pt.y - lastClick.y) < 20) {
          window.__paperLastClick = { id: null, time: 0, x: 0, y: 0 };
          if (window.__openPaperTextEditor) window.__openPaperTextEditor(sel);
          return;
        }
        window.__paperLastClick = { id: sel.id, time: now, x: pt.x, y: pt.y };

        const handles = paperLayer.getHandles();
        const hitHandle = handles.find(h => Math.hypot(pt.x - h.x, pt.y - h.y) < 18);
        if (hitHandle) {
          paperDragOffset = paperLayer.startResize(hitHandle.id, pt.x, pt.y);
          drawing = 'paper-resize';
          strokeCanvas.setPointerCapture(e.pointerId);
          return;
        }
        const cx = sel.x + sel.w / 2;
        const cy = sel.y + sel.h / 2;
        const rad = (sel.rotation || 0) * Math.PI / 180;
        const hx = cx + Math.sin(rad) * (sel.h / 2 + 20);
        const hy = cy - Math.cos(rad) * (sel.h / 2 + 20);
        if (Math.hypot(pt.x - hx, pt.y - hy) < 14) {
          paperDragOffset = paperLayer.startRotate(pt.x, pt.y);
          drawing = 'paper-rotate';
          strokeCanvas.setPointerCapture(e.pointerId);
          return;
        }
        if (sel.x <= pt.x && pt.x <= sel.x + sel.w && sel.y <= pt.y && pt.y <= sel.y + sel.h) {
          if (sel.locked) { toastError('已锁定'); return; }
          paperDragOffset = { dx: pt.x - sel.x, dy: pt.y - sel.y, paper: sel };
          drawing = 'paper-drag';
          strokeCanvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      paperLayer.redraw();
      return;
    }
  });

  strokeCanvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 画笔合并事件
    if (drawing === true && e.getCoalescedEvents) {
      const events = e.getCoalescedEvents();
      if (events.length > 1 && currentTool === 'pen') {
        const rect = strokeCanvas.getBoundingClientRect();
        events.forEach(ev => {
          const px = (ev.clientX - rect.left) / rect.width * W;
          const py = (ev.clientY - rect.top) / rect.height * H;
          const pressure = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
          points.push({ x: px, y: py, pressure });
        });
        const recent = points.slice(-20);
        const scaleFactor = Math.sqrt(W / 800);
        if (e.pointerType === 'pen') drawPressurePath(ctx, recent, currentColor, currentWidth, scaleFactor);
        else drawSmoothCurve(ctx, recent, currentColor, currentWidth, scaleFactor);
        dirty = true;
        return;
      }
    }

    if (pointers.size >= 2 && drawing !== 'pinch') {
      const pts = [...pointers.values()];
      drawing = 'pinch';
      startPt = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
      return;
    }

    if (drawing === 'pinch' && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (startPt && startPt.dist) {
        scale = Math.max(0.3, Math.min(10, scale * (dist / startPt.dist)));
        offsetX += cx - startPt.cx;
        offsetY += cy - startPt.cy;
        updateTransform();
      }
      startPt = { dist, cx, cy };
      return;
    }

    const pt = canvasToImage(e.clientX, e.clientY);

    if (drawing === 'pan') {
      offsetX = e.clientX - startPt.x;
      offsetY = e.clientY - startPt.y;
      if (!window.__panRaf) {
        window.__panRaf = requestAnimationFrame(() => { updateTransform(); window.__panRaf = null; });
      }
      return;
    }

    // 橡皮：连续擦除，路径无缝
    if (drawing === 'eraser') {
      const eraserRadius = currentWidth * 2 / Math.sqrt(W / 800);
      const lastPt = points.length > 0 ? points[points.length - 1] : pt;
      points.push(pt);

      // 笔迹层用线段插值擦除
      const dx = pt.x - lastPt.x;
      const dy = pt.y - lastPt.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(dist / (eraserRadius * 0.3)));

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = lastPt.x + dx * t;
        const py = lastPt.y + dy * t;
        if (eraserShape === 'square') {
          eraseSquare(ctx, px, py, eraserRadius);
          eraseSquare(paperStrokeCtx, px, py, eraserRadius);
        } else {
          eraseCircle(ctx, px, py, eraserRadius);
          eraseCircle(paperStrokeCtx, px, py, eraserRadius);
        }
      }

      // 胶带层用线段擦除，一次调用无残留
      tapeLayer.eraseSegment(lastPt.x, lastPt.y, pt.x, pt.y, eraserRadius);
      // 擦除纸张上的胶带
      paperLayer.getPapers().forEach(p => {
        if (!p.tapes || p.locked) return;
        p.tapes.forEach(t => {
          if (!t.erasedPath) t.erasedPath = [];
          const relX1 = lastPt.x - p.x;
          const relY1 = lastPt.y - p.y;
          const relX2 = pt.x - p.x;
          const relY2 = pt.y - p.y;
          const dist = Math.hypot(relX2 - relX1, relY2 - relY1);
          const step = Math.max(1, eraserRadius * 0.3);
          const n = Math.max(1, Math.ceil(dist / step));
          for (let i = 0; i <= n; i++) {
            const ratio = i / n;
            const px = relX1 + (relX2 - relX1) * ratio;
            const py = relY1 + (relY2 - relY1) * ratio;
            if (tapeLayer.hitTape(t, px, py, eraserRadius)) {
              t.erasedPath.push({ x: px, y: py, r: eraserRadius });
            }
          }
        });
      });
      paperLayer.save();
      paperLayer.redraw();

      // 预览
      clearPreview();
      previewCtx.save();
      previewCtx.strokeStyle = '#3B82F6';
      previewCtx.lineWidth = 2;
      if (eraserShape === 'square') {
        previewCtx.strokeRect(pt.x - eraserRadius, pt.y - eraserRadius, eraserRadius * 2, eraserRadius * 2);
      } else {
        previewCtx.beginPath();
        previewCtx.arc(pt.x, pt.y, eraserRadius, 0, Math.PI * 2);
        previewCtx.stroke();
      }
      previewCtx.restore();
      dirty = true;
      return;
    }

    // 画笔
    if (drawing === true) {
      const pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
      points.push({ ...pt, pressure });
      const hitPaper = paperLayer.hitTest(pt.x, pt.y);
      if (hitPaper && !hitPaper.locked) {
        const relX = pt.x - hitPaper.x;
        const relY = pt.y - hitPaper.y;
        if (!hitPaper._currentStroke) hitPaper._currentStroke = { type: 'pen', points: [], color: currentColor, width: currentWidth };
        hitPaper._currentStroke.points.push({ x: relX, y: relY, pressure });
        paperLayer.redraw();
      } else {
        const recent = points.slice(-12);
        const scaleFactor = Math.sqrt(W / 800);
        if (e.pointerType === 'pen') drawPressurePath(ctx, recent, currentColor, currentWidth, scaleFactor);
        else drawSmoothCurve(ctx, recent, currentColor, currentWidth, scaleFactor);
      }
      dirty = true;
      return;
    }

    // 圈擦预览
    if (drawing === 'circle-erase') {
      clearPreview();
      previewCtx.save();
      previewCtx.strokeStyle = 'rgba(59,130,246,.8)';
      previewCtx.lineWidth = 2;
      if (eraseShape === 'rect') {
        previewCtx.setLineDash([6, 4]);
        previewCtx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
      } else if (eraseShape === 'free') {
        if (eraseFreePath) {
          eraseFreePath.push(pt);
          previewCtx.beginPath();
          previewCtx.moveTo(eraseFreePath[0].x, eraseFreePath[0].y);
          for (let i = 1; i < eraseFreePath.length; i++) previewCtx.lineTo(eraseFreePath[i].x, eraseFreePath[i].y);
          previewCtx.closePath();
          previewCtx.fillStyle = 'rgba(59,130,246,.15)';
          previewCtx.fill();
          previewCtx.stroke();
        }
      } else {
        previewCtx.setLineDash([6, 4]);
        const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
        previewCtx.beginPath();
        previewCtx.arc(startPt.x, startPt.y, r, 0, Math.PI * 2);
        previewCtx.stroke();
      }
      previewCtx.restore();
      return;
    }

    // 图形预览
    if (['arrow', 'rect', 'line', 'wave', 'circle', 'triangle', 'star', 'dialog', 'flag', 'check', 'cross', 'ban', 'custom-image'].includes(drawing)) {
      clearPreview();
      previewCtx.save();
      const bc = window.__shapeBorderColor || currentColor;
      const fc = window.__shapeFillColor || 'transparent';
      const scaleFactor = Math.sqrt(W / 800);
      const lw = currentWidth / scaleFactor;

      if (drawing === 'arrow') drawArrow(previewCtx, startPt.x, startPt.y, pt.x, pt.y, bc, lw);
      else if (drawing === 'rect') {
        if (fc !== 'transparent' && fc !== 'none') {
          previewCtx.fillStyle = fc;
          previewCtx.fillRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
        }
        previewCtx.strokeStyle = bc;
        previewCtx.lineWidth = lw;
        previewCtx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
      }
      else if (drawing === 'line') { previewCtx.strokeStyle = bc; previewCtx.lineWidth = lw; previewCtx.beginPath(); previewCtx.moveTo(startPt.x, startPt.y); previewCtx.lineTo(pt.x, pt.y); previewCtx.stroke(); }
      else if (drawing === 'wave') drawWave(previewCtx, startPt.x, startPt.y, pt.x, pt.y, bc, lw, waveAmplitude);
      else drawPresetShape(previewCtx, drawing, startPt.x, startPt.y, pt.x, pt.y, bc, fc, lw);

      previewCtx.restore();
      return;
    }

    if (drawing === 'tape-drag' && tapeDragOffset) { tapeDragOffset.move(pt.x, pt.y); return; }
    if (drawing === 'tape-rotate' && tapeDragOffset) { tapeDragOffset.move(pt.x, pt.y); return; }

    if (drawing === 'tape-select') {
      clearPreview();
      previewCtx.save();
      previewCtx.strokeStyle = '#3B82F6';
      previewCtx.lineWidth = 2;
      previewCtx.setLineDash([6, 4]);
      previewCtx.fillStyle = 'rgba(59,130,246,.1)';
      const x = Math.min(startPt.x, pt.x);
      const y = Math.min(startPt.y, pt.y);
      const w = Math.abs(pt.x - startPt.x);
      const h = Math.abs(pt.y - startPt.y);
      previewCtx.fillRect(x, y, w, h);
      previewCtx.strokeRect(x, y, w, h);
      previewCtx.restore();
      return;
    }

    // 纸张上画胶带
    if (drawing === 'paper-tape') {
      const hitPaper = paperLayer.getPapers().find(p => p._currentTape);
      if (hitPaper) {
        const relX = pt.x - hitPaper.x;
        const relY = pt.y - hitPaper.y;
        const last = hitPaper._currentTape.points[hitPaper._currentTape.points.length - 1];
        if (!last || Math.hypot(relX - last.x, relY - last.y) > 1) {
          hitPaper._currentTape.points.push({ x: relX, y: relY });
          paperLayer.redraw();
        }
      }
      points.push(pt);
      // 预览
      clearPreview();
      previewCtx.save();
      previewCtx.strokeStyle = tapeLayer.getColor();
      previewCtx.lineWidth = tapeLayer.getWidth();
      previewCtx.lineCap = 'round';
      previewCtx.beginPath();
      previewCtx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) previewCtx.lineTo(points[i].x, points[i].y);
      previewCtx.stroke();
      previewCtx.restore();
      return;
    }

    if (drawing === 'tape') {
      if (e.shiftKey && points.length > 1) {
        const start = points[0];
        if (Math.abs(pt.x - start.x) > Math.abs(pt.y - start.y)) pt.y = start.y;
        else pt.x = start.x;
      }
      // 矩形/圆形只用首尾两点
      const shape = tapeLayer.getShape();
      if (shape === 'rect' || shape === 'circle') {
        points = [points[0], pt];
      } else {
        points.push(pt);
      }
      tapeLayer.previewTape(points, currentColor, tapeLayer.getWidth());
      return;
    }

    if (drawing === 'paper-drag' && paperDragOffset) {
      const p = paperDragOffset.paper;
      p.x = pt.x - paperDragOffset.dx;
      p.y = pt.y - paperDragOffset.dy;
      const guides = drawGuideLines(p);
      snapToGuide(p, guides);
      if (!paperDragOffset._raf) paperDragOffset._raf = requestAnimationFrame(() => { paperLayer.redraw(); paperDragOffset._raf = null; });
      dirty = true;
      return;
    }

    // 纸张缩放
    if (drawing === 'paper-resize' && paperDragOffset) {
      paperDragOffset.move(pt.x, pt.y);
      if (!paperDragOffset._raf) {
        paperDragOffset._raf = requestAnimationFrame(() => {
          paperLayer.redraw();
          paperDragOffset._raf = null;
        });
      }
      dirty = true;
      return;
    }

    // 纸张旋转
    if (drawing === 'paper-rotate' && paperDragOffset) {
      paperDragOffset.move(pt.x, pt.y);
      if (!paperDragOffset._raf) {
        paperDragOffset._raf = requestAnimationFrame(() => {
          paperLayer.redraw();
          paperDragOffset._raf = null;
        });
      }
      dirty = true;
      return;
    }

    // 文字缩放
    if (drawing === 'text-resize' && textDragOffset) {
      textDragOffset.move(pt.x, pt.y);
      if (!textDragOffset._raf) {
        textDragOffset._raf = requestAnimationFrame(() => {
          textLayer.redraw();
          textDragOffset._raf = null;
        });
      }
      return;
    }

    // 文字旋转
    if (drawing === 'text-rotate' && textDragOffset) {
      textDragOffset.move(pt.x, pt.y);
      if (!textDragOffset._raf) {
        textDragOffset._raf = requestAnimationFrame(() => {
          textLayer.redraw();
          textDragOffset._raf = null;
        });
      }
      return;
    }

    if (drawing === 'text-drag' && textDragOffset) {
      const item = textDragOffset.item;
      item.x = pt.x - textDragOffset.dx;
      item.y = pt.y - textDragOffset.dy;
      const guides = drawGuideLines(item);
      snapToGuide(item, guides);
      if (!textDragOffset._raf) textDragOffset._raf = requestAnimationFrame(() => { textLayer.redraw(); textDragOffset._raf = null; });
      dirty = true;
      return;
    }
  });

  function isPointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  strokeCanvas.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (window.__eraserRaf) { cancelAnimationFrame(window.__eraserRaf); window.__eraserRaf = null; }

    if (drawing === 'pinch') { if (pointers.size < 2) drawing = false; return; }
    if (drawing === 'pan') { if (window.__panRaf) { cancelAnimationFrame(window.__panRaf); window.__panRaf = null; } drawing = false; return; }

    const pt = canvasToImage(e.clientX, e.clientY);

    if (drawing === 'eraser' || drawing === true) {
      paperLayer.getPapers().forEach(p => {
        if (p._currentStroke) {
          if (!p.strokes) p.strokes = [];
          p.strokes.push(p._currentStroke);
          delete p._currentStroke;
        }
      });
      paperLayer.save();
      paperLayer.redraw();
      drawing = false;
      clearPreview();
      return;
    }

    if (drawing === 'circle-erase') {
      if (eraseShape === 'rect') {
        eraseRect(ctx, startPt.x, startPt.y, pt.x, pt.y);
        eraseRect(paperStrokeCtx, startPt.x, startPt.y, pt.x, pt.y);
        // 胶带：矩形区域内逐点擦
        const minX = Math.min(startPt.x, pt.x);
        const maxX = Math.max(startPt.x, pt.x);
        const minY = Math.min(startPt.y, pt.y);
        const maxY = Math.max(startPt.y, pt.y);
        const step = 10;
        for (let x = minX; x <= maxX; x += step) {
          for (let y = minY; y <= maxY; y += step) {
            tapeLayer.eraseAt(x, y, 15);
          }
        }
      } else if (eraseShape === 'circle') {
        const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
        eraseCircle(ctx, startPt.x, startPt.y, r);
        eraseCircle(paperStrokeCtx, startPt.x, startPt.y, r);
        // 胶带：圆形区域内逐点擦
        const step = 10;
        for (let x = startPt.x - r; x <= startPt.x + r; x += step) {
          for (let y = startPt.y - r; y <= startPt.y + r; y += step) {
            if (Math.hypot(x - startPt.x, y - startPt.y) <= r) {
              tapeLayer.eraseAt(x, y, 15);
            }
          }
        }
      } else if (eraseShape === 'free' && eraseFreePath && eraseFreePath.length > 2) {
        const doFreeErase = (targetCtx) => {
          targetCtx.save();
          targetCtx.globalCompositeOperation = 'destination-out';
          targetCtx.beginPath();
          targetCtx.moveTo(eraseFreePath[0].x, eraseFreePath[0].y);
          for (let i = 1; i < eraseFreePath.length; i++) targetCtx.lineTo(eraseFreePath[i].x, eraseFreePath[i].y);
          targetCtx.closePath();
          targetCtx.fill();
          targetCtx.restore();
        };
        doFreeErase(ctx);
        doFreeErase(paperStrokeCtx);
        // 胶带：自由形状区域内逐点擦
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        eraseFreePath.forEach(p => {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        const step = 10;
        for (let x = minX; x <= maxX; x += step) {
          for (let y = minY; y <= maxY; y += step) {
            // 点在多边形内判断
            if (isPointInPolygon(x, y, eraseFreePath)) {
              tapeLayer.eraseAt(x, y, 15);
            }
          }
        }
        eraseFreePath = null;
      }
      clearPreview();
      drawing = false;
      return;
    }

    if (['arrow', 'rect', 'line', 'wave', 'circle', 'triangle', 'star', 'dialog', 'flag', 'check', 'cross', 'ban', 'custom-image'].includes(drawing)) {
      const bc = window.__shapeBorderColor || currentColor;
      const fc = window.__shapeFillColor || 'transparent';
      const scaleFactor = Math.sqrt(W / 800);
      const lw = currentWidth / scaleFactor;

      if (drawing === 'arrow') drawArrow(ctx, startPt.x, startPt.y, pt.x, pt.y, bc, lw);
      else if (drawing === 'rect') {
        const x = Math.min(startPt.x, pt.x), y = Math.min(startPt.y, pt.y);
        const w = Math.abs(pt.x - startPt.x), h = Math.abs(pt.y - startPt.y);
        if (fc !== 'transparent' && fc !== 'none') { ctx.fillStyle = fc; ctx.fillRect(x, y, w, h); }
        ctx.strokeStyle = bc;
        ctx.lineWidth = lw;
        ctx.strokeRect(x, y, w, h);
      }
      else if (drawing === 'line') {
        ctx.strokeStyle = bc; ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(startPt.x, startPt.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      }
      else if (drawing === 'wave') drawWave(ctx, startPt.x, startPt.y, pt.x, pt.y, bc, lw, waveAmplitude);
      else drawPresetShape(ctx, drawing, startPt.x, startPt.y, pt.x, pt.y, bc, fc, lw);

      clearPreview();
      drawing = false;
      dirty = true;
      setSaveStatus('dirty');
      return;
    }

    if (drawing === 'tape-drag' || drawing === 'tape-rotate') { if (tapeDragOffset && tapeDragOffset.end) tapeDragOffset.end(); drawing = false; tapeDragOffset = null; return; }

    if (drawing === 'tape-select') {
      clearPreview();
      const pt2 = canvasToImage(e.clientX, e.clientY);
      const w = Math.abs(pt2.x - startPt.x);
      const h = Math.abs(pt2.y - startPt.y);
      if (w > 10 && h > 10) {
        tapeLayer.selectInRect(startPt.x, startPt.y, pt2.x, pt2.y);
        const count = tapeLayer.getSelectedIds().length;
        if (count > 0) {
          toastSuccess(`已选中 ${count} 条胶带`);
        }
      }
      // 框选完自动退出框选模式
      tapeSelectMode = false;
      drawing = false;
      startPt = null;
      points = [];
      updateSubToolbar();
      return;
    }

    if (drawing === 'paper-tape') {
      clearPreview();
      const hitPaper = paperLayer.getPapers().find(p => p._currentTape);
      if (hitPaper) {
        if (hitPaper._currentTape.points.length >= 2) {
          if (!hitPaper.tapes) hitPaper.tapes = [];
          hitPaper.tapes.push({
            ...hitPaper._currentTape,
            id: crypto.randomUUID(),
          });
          paperLayer.save();
          paperLayer.redraw();
        }
        delete hitPaper._currentTape;
      }
      drawing = false;
      points = [];
      return;
    }

    // 纸张上画胶带结束
    if (drawing === 'paper-tape') {
      clearPreview();
      const hitPaper = paperLayer.getPapers().find(p => p._currentTape);
      if (hitPaper) {
        if (hitPaper._currentTape.points.length >= 2) {
          if (!hitPaper.tapes) hitPaper.tapes = [];
          hitPaper.tapes.push(hitPaper._currentTape);
          paperLayer.save();
          paperLayer.redraw();
        }
        delete hitPaper._currentTape;
      }
      drawing = false;
      points = [];
      return;
    }

    if (drawing === 'tape') {
      tapeLayer.previewTape([], '', 0);
      if (points.length >= 2) {
        const tape = tapeLayer.createTapeFromPoints(points, currentColor);
        pushUndo(true);
        tapeLayer.addTape(tape);
      }
      drawing = false;
      return;
    }

    if (drawing === 'paper-drag' || drawing === 'paper-resize' || drawing === 'paper-rotate') {
      clearPreview();
      if (paperDragOffset && paperDragOffset._raf) { cancelAnimationFrame(paperDragOffset._raf); paperDragOffset._raf = null; }
      if (paperDragOffset && paperDragOffset.end) paperDragOffset.end();
      if (paperDragOffset && paperDragOffset.paper) paperLayer.save();
      drawing = false;
      paperDragOffset = null;
      return;
    }

    if (drawing === 'text-resize' || drawing === 'text-rotate') {
      if (textDragOffset && textDragOffset._raf) { cancelAnimationFrame(textDragOffset._raf); textDragOffset._raf = null; }
      if (textDragOffset && textDragOffset.end) textDragOffset.end();
      clearPreview();
      drawing = false;
      textDragOffset = null;
      return;
    }

    if (drawing === 'text-drag') {
      clearPreview();
      if (textDragOffset && textDragOffset._raf) { cancelAnimationFrame(textDragOffset._raf); textDragOffset._raf = null; }
      textLayer.save();
      drawing = false;
      textDragOffset = null;
      return;
    }
  });

  strokeCanvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    drawing = false;
    clearPreview();
    if (window.__eraserRaf) { cancelAnimationFrame(window.__eraserRaf); window.__eraserRaf = null; }
    if (window.__panRaf) { cancelAnimationFrame(window.__panRaf); window.__panRaf = null; }
    if (paperDragOffset && paperDragOffset._raf) { cancelAnimationFrame(paperDragOffset._raf); paperDragOffset._raf = null; }
    if (textDragOffset && textDragOffset._raf) { cancelAnimationFrame(textDragOffset._raf); textDragOffset._raf = null; }
    paperDragOffset = null;
    textDragOffset = null;
    tapeDragOffset = null;
  });

  strokeCanvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = strokeCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = -e.deltaY * 0.002;
      const newScale = Math.max(0.3, Math.min(10, scale * (1 + delta)));
      offsetX -= mx * (newScale / scale - 1);
      offsetY -= my * (newScale / scale - 1);
      scale = newScale;
      updateTransform();
    }
  }, { passive: false });

  // ============ 初始化 ============
  updateTransform();
  setActiveTool('pen');
  updateSubToolbar();

  window.addEventListener('beforeunload', () => { if (dirty) saveAll(false).catch(() => { }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveAll(false).catch(() => { }); });

  const keyHandler = (e) => {
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && e.key === 'c') { e.preventDefault(); copySelected(); return; }
    if (e.ctrlKey && e.key === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (e.key === 'Escape') { document.querySelectorAll('.confirm-mask').forEach(m => m.remove()); return; }
  };
  window.addEventListener('keydown', keyHandler);

  const autoSaveTimer = setInterval(() => {
    if (dirty) {
      setSaveStatus('saving');
      saveAll(false).then(() => setSaveStatus('saved')).catch(() => setSaveStatus('error'));
    }
  }, 30 * 1000);

  window.__annotatorCleanup = () => {
    clearInterval(autoSaveTimer);
    window.removeEventListener('keydown', keyHandler);
    hideTooltip();
    if (baseUrl) URL.revokeObjectURL(baseUrl);
  };
}