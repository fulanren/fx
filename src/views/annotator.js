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

const DEFAULT_TOP_BAR_CONFIG = {
  '←': true, '→': true, '↑': true, '↓': true,
  '🔍+': true, '🔍-': true, '1:1': true,
  '↶': true, '🗑': true, '➕': true, '📚': true, '💾': true, '🔒': true
};

const DEFAULT_MODE_BAR_CONFIG = {
  'pen-first': true, 'finger-draw': true, 'pen-only': true
};

function getTopBarConfig() {
  try { return JSON.parse(localStorage.getItem('kg_topbar_config') || 'null') || { ...DEFAULT_TOP_BAR_CONFIG }; }
  catch { return { ...DEFAULT_TOP_BAR_CONFIG }; }
}
function getModeBarConfig() {
  try { return JSON.parse(localStorage.getItem('kg_modebar_config') || 'null') || { ...DEFAULT_MODE_BAR_CONFIG }; }
  catch { return { ...DEFAULT_MODE_BAR_CONFIG }; }
}

const DEFAULT_LAYER_ORDER = ['base', 'shape', 'stroke', 'text', 'tape', 'paper', 'paperStroke'];

const imageCache = new Map();
let paperStrokeSelected = null;
let paperStrokeSelectedList = [];
let paperTapeSelected = null;
let paperTapeSelectedList = [];
let paperShapeSelected = null;
let paperShapeSelectedList = [];
window.__paperShapeSelectedList = paperShapeSelectedList;
window.__paperTapeSelectedList = paperTapeSelectedList;

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
  const modeConfig = getModeBarConfig(); // 读取配置
  const modeBar = el('div', { class: 'annotator-mode-bar' });
  const modeBtns = {};
  [
    { id: 'pen-first', label: '✍️ 触控笔优先', tip: '手指平移/缩放，触控笔绘制' },
    { id: 'finger-draw', label: '👆 手指也可画', tip: '手指和触控笔都可绘制' },
    { id: 'pen-only', label: '🖊 仅触控笔绘制', tip: '手指只能平移/缩放，不能绘制' },
  ].forEach(m => {
    if (modeConfig[m.id] === false) return; // 根据配置隐藏
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

  function openTopBarConfigPanel() {
    const topConfig = getTopBarConfig();
    const modeConfig = getModeBarConfig();
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

    const allLabels = {
      '←': '← 左移', '→': '→ 右移', '↑': '↑ 上移', '↓': '↓ 下移',
      '🔍+': '🔍+ 放大', '🔍-': '🔍- 缩小', '1:1': '1:1 原始大小',
      '↶': '↶ 撤销', '🗑': '🗑 清除', '➕': '➕ 扩展画布', '📚': '📚 图层顺序', '💾': '💾 保存', '🔒': '🔒 锁图标开关'
    };
    const allModes = {
      'pen-first': '✍️ 触控笔优先', 'finger-draw': '👆 手指也可画', 'pen-only': '🖊 仅触控笔绘制'
    };

    const renderList = () => {
      list.innerHTML = '';

      // 顶栏按钮 全选/全不选
      list.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', marginBottom: '4px' } }, [
        el('span', { style: { fontWeight: '600' }, text: '顶栏按钮' }),
        el('div', { style: { display: 'flex', gap: '6px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => {
              Object.keys(allLabels).forEach(k => topConfig[k] = true);
              localStorage.setItem('kg_topbar_config', JSON.stringify(topConfig));
              renderList();
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => {
              Object.keys(allLabels).forEach(k => topConfig[k] = false);
              localStorage.setItem('kg_topbar_config', JSON.stringify(topConfig));
              renderList();
            }
          })
        ])
      ]));

      Object.entries(allLabels).forEach(([key, text]) => {
        list.appendChild(el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox', checked: topConfig[key] !== false, onChange: (e) => {
              topConfig[key] = e.target.checked;
              localStorage.setItem('kg_topbar_config', JSON.stringify(topConfig));
            }
          }),
          el('span', { text })
        ]));
      });

      // 输入模式按钮 全选/全不选
      list.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', marginBottom: '4px' } }, [
        el('span', { style: { fontWeight: '600' }, text: '输入模式按钮' }),
        el('div', { style: { display: 'flex', gap: '6px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => {
              Object.keys(allModes).forEach(k => modeConfig[k] = true);
              localStorage.setItem('kg_modebar_config', JSON.stringify(modeConfig));
              renderList();
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => {
              Object.keys(allModes).forEach(k => modeConfig[k] = false);
              localStorage.setItem('kg_modebar_config', JSON.stringify(modeConfig));
              renderList();
            }
          })
        ])
      ]));

      Object.entries(allModes).forEach(([key, text]) => {
        list.appendChild(el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox', checked: modeConfig[key] !== false, onChange: (e) => {
              modeConfig[key] = e.target.checked;
              localStorage.setItem('kg_modebar_config', JSON.stringify(modeConfig));
            }
          }),
          el('span', { text })
        ]));
      });
    };

    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '360px' } }, [
        el('h3', { text: '工具栏管理' }),
        list,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-primary', text: '应用并刷新',
            onClick: () => {
              mask.remove();
              renderAnnotator({ params: { id: imageId }, query: { pointId } });
            }
          })
        ])
      ])
    ]);
    document.body.appendChild(mask);
  }

  function setInputMode(mode) {
    inputMode = mode;
    Object.entries(modeBtns).forEach(([id, btn]) => btn.classList.toggle('active', id === mode));
    toastSuccess(mode === 'pen-first' ? '触控笔优先' : mode === 'finger-draw' ? '手指也可画' : '仅触控笔');
  }

  // ============ 容器 ============
  const canvasWrap = el('div', { class: 'annotator-canvas-wrap' });
  canvasWrap.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;touch-action:none;z-index: 10;`;
  wrap.appendChild(canvasWrap);

  // ============ 边缘切图按钮 ============
  try {
    if (pointId) {
      const pt = store.getPoint(pointId);
      if (pt) {
        const allImageIds = [...(pt.imageIds || []), ...(pt.compositeImageIds || [])];
        const currentIndex = allImageIds.indexOf(imageId);

        if (currentIndex > 0) {
          const prevId = allImageIds[currentIndex - 1];
          if (prevId) {
            const prevBtn = el('button', {
              style: {
                position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(0,0,0,0.4)',
                color: '#fff', border: 'none', fontSize: '24px', zIndex: '200', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
              },
              text: '❮',
              title: '上一张',
              onClick: () => {
                if (typeof window.__saveAll === 'function') {
                  window.__saveAll(false).then(() => {
                    window.location.hash = `#/annotate/${prevId}?pointId=${pointId}`;
                  });
                } else {
                  window.location.hash = `#/annotate/${prevId}?pointId=${pointId}`;
                }
              }
            });
            if (prevBtn) wrap.appendChild(prevBtn);
          }
        }

        if (currentIndex >= 0 && currentIndex < allImageIds.length - 1) {
          const nextId = allImageIds[currentIndex + 1];
          if (nextId) {
            const nextBtn = el('button', {
              style: {
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(0,0,0,0.4)',
                color: '#fff', border: 'none', fontSize: '24px', zIndex: '200', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
              },
              text: '❯',
              title: '下一张',
              onClick: () => {
                if (typeof window.__saveAll === 'function') {
                  window.__saveAll(false).then(() => {
                    window.location.hash = `#/annotate/${nextId}?pointId=${pointId}`;
                  });
                } else {
                  window.location.hash = `#/annotate/${nextId}?pointId=${pointId}`;
                }
              }
            });
            if (nextBtn) wrap.appendChild(nextBtn);
          }
        }
      }
    }
  } catch (err) {
    console.warn('切图按钮渲染失败:', err);
  }

  // ============ 底图 ============
  const base = el('img', {
    class: 'annotator-base',
    src: baseUrl,
    style: { width: W + 'px', height: H + 'px', display: 'block', userSelect: 'none', pointerEvents: 'none' },
  });
  canvasWrap.appendChild(base);

  // ============ 笔迹层 ============
  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.className = 'annotator-stroke';
  strokeCanvas.width = W;
  strokeCanvas.height = H;
  strokeCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;`;
  const ctx = strokeCanvas.getContext('2d', { willReadFrequently: true });
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
  paperStrokeCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;`;
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
  textCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;`;
  canvasWrap.appendChild(textCanvas);
  const textLayer = createTextLayer({ canvas: textCanvas, width: W, height: H, imageId, store });

  // ============ 胶带层 ============
  const tapeCanvas = document.createElement('canvas');
  tapeCanvas.className = 'annotator-tape';
  tapeCanvas.width = W;
  tapeCanvas.height = H;
  tapeCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;`;
  canvasWrap.appendChild(tapeCanvas);
  const tapeLayer = createTapeLayer({ canvas: tapeCanvas, width: W, height: H, imageId, store, baseImg });
  window.__tapeLayer = tapeLayer;

  // ============ 纸张层 ============
  const paperCanvas = document.createElement('canvas');
  paperCanvas.className = 'annotator-paper';
  paperCanvas.width = W;
  paperCanvas.height = H;
  paperCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;`;
  canvasWrap.appendChild(paperCanvas);
  const paperLayer = createPaperLayer({ canvas: paperCanvas, width: W, height: H, imageId, store, textCanvas, textLayer });
  window.__paperLayer = paperLayer;

  // ============ 预览层 ============
  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'annotator-preview';
  previewCanvas.width = W;
  previewCanvas.height = H;
  previewCanvas.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;`;
  const previewCtx = previewCanvas.getContext('2d');
  canvasWrap.appendChild(previewCanvas);

  function clearPreview() { previewCtx.clearRect(0, 0, W, H); }

  // ============ 查找点击位置的形状 ============
  function findShapeAt(x, y) {
    const papers = paperLayer.getPapers();
    for (let i = papers.length - 1; i >= 0; i--) {
      const p = papers[i];
      if (!p.shapes || p.visible === false) continue;
      const relX = x - p.x;
      const relY = y - p.y;
      const sorted = [...p.shapes].sort((a, b) => (b.sortOrder || b.zIndex || 0) - (a.sortOrder || a.zIndex || 0));
      for (const s of sorted) {
        if (s.visible === false) continue;
        const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2);
        const y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
        if (relX >= x1 - 8 && relX <= x2 + 8 && relY >= y1 - 8 && relY <= y2 + 8) {
          return { paper: p, shape: s };
        }
      }
    }
    return null;
  }
  function findShapeHandleAt(x, y) {
    return paperLayer.hitShapeHandle ? paperLayer.hitShapeHandle(x, y) : null;
  }



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

    // 根据面板顺序，依次追加到 DOM 中，决定谁盖住谁
    order.forEach((key) => { if (layerMap[key]) canvasWrap.appendChild(layerMap[key]); });
    canvasWrap.appendChild(previewEl);

    if (window.__tapeLayer) window.__tapeLayer.redraw();
    if (window.__paperLayer) window.__paperLayer.redraw();
    if (window.__textLayer) window.__textLayer.redraw();
  }

  const savedOrder = store.getLayerOrder ? store.getLayerOrder() : null;
  let currentLayerOrder = savedOrder && savedOrder.length === DEFAULT_LAYER_ORDER.length
    ? [...savedOrder]
    : [...DEFAULT_LAYER_ORDER];
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
  let paperTapeSelectMode = false;
  let formatClipboard = null;
  let shapeOnPaper = true;  // true=画在纸张上，false=画在底图上
  let shapeDragOffset = null;
  let shapeSelectTimer = null;
  let shapeLongPressFired = false;
  let polygonPoints = [];
  let polygonDrawing = false;


  function canvasToImage(clientX, clientY) {
    // 注意：这里必须用 canvasWrap 的 rect，不能用 strokeCanvas！
    const rect = canvasWrap.getBoundingClientRect();
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
    if (!paper) return;
    window.__paperEditingItem = paper;

    const rect = strokeCanvas.getBoundingClientRect();
    const sx = rect.width / W;
    const sy = rect.height / H;

    paper.textVisible = false;
    paperLayer.redraw();

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

    updateSubToolbar();

    function finish() {
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
      window.__paperEditingItem = null;
      updateSubToolbar();
      document.removeEventListener('pointerdown', outsideClick, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function outsideClick(e) {
      if (ta.contains(e.target)) return;
      // 点击子工具栏/设置面板/底部工具栏时不关闭
      if (e.target.closest && e.target.closest('.sub-toolbar')) return;
      if (e.target.closest && e.target.closest('.annotator-setting-panel')) return;
      if (e.target.closest && e.target.closest('.annotator-bottom-bar')) return;
      if (e.target.closest && e.target.closest('.tape-row')) return;
      if (e.target.closest && e.target.closest('.tape-toolbar')) return;
      finish();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        window.__paperEditingItem = null;
        paper.textVisible = true;
        // 不要重绘整张纸和所有胶带，只在纸张上重绘这根笔迹
        // 这里我们用一个更轻量的方式，直接画在纸张的画布上
        const pctx = window.__paperLayerCtx;
        if (pctx) {
          const p = hitPaper;
          pctx.save();
          pctx.translate(p.x + p.w / 2, p.y + p.h / 2);
          pctx.rotate((p.rotation || 0) * Math.PI / 180);
          pctx.translate(-p.w / 2, -p.h / 2);
          pctx.strokeStyle = currentColor;
          pctx.lineWidth = currentWidth;
          pctx.lineCap = 'round';
          const pts = hitPaper._currentStroke.points;
          if (pts.length >= 2) {
            pctx.beginPath();
            pctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
            pctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            pctx.stroke();
          }
          pctx.restore();
        }
        ta.remove();
        updateSubToolbar();
        document.removeEventListener('pointerdown', outsideClick, true);
        document.removeEventListener('keydown', onKey, true);
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish();
    }

    setTimeout(() => {
      document.addEventListener('pointerdown', outsideClick, true);
      document.addEventListener('keydown', onKey, true);
    }, 300);
  }
  window.__openPaperTextEditor = openPaperTextEditor;
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

    // 优先让浏览器回退到上一步（可能是 PDF 阅读页，也可能是知识点编辑页）
    if (history.length > 1) {
      history.back();
    } else if (pointId) {
      // 如果是直接复制链接进来的，没有历史记录，就保底回编辑页
      window.location.hash = `#/edit-point/${pointId}`;
    } else {
      window.location.hash = '#/';
    }
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
    // 每次刷新子工具栏时，同步选中列表到 window，供 annotatorPaper.js 读取
    window.__paperShapeSelectedList = paperShapeSelectedList;
    window.__paperTapeSelectedList = paperTapeSelectedList;
    window.__updateSubToolbar = updateSubToolbar;
    subBar.innerHTML = '';
    // 根据工具决定颜色条和粗细行的显示
    const showColorAndWidth = ['pen', 'eraser', 'circle-erase', 'shape', 'eyedropper', 'hand'].includes(currentTool);
    colorBar.style.display = showColorAndWidth ? 'flex' : 'none';
    widthRow.style.display = showColorAndWidth ? 'flex' : 'none';
    if (currentTool === 'shape') {
      // 绘制位置开关
      subBar.appendChild(el('div', { class: 'tape-row' }, [
        el('span', { class: 'tape-label', text: '画在' }),
        el('button', {
          class: 'tape-chip' + (shapeOnPaper === false ? ' active' : ''),
          text: '底图上',
          onClick: () => {
            shapeOnPaper = false;
            updateSubToolbar();
          },
        }),
        el('button', {
          class: 'tape-chip' + (shapeOnPaper === true ? ' active' : ''),
          text: '纸张上',
          onClick: () => {
            shapeOnPaper = true;
            updateSubToolbar();
          },
        }),
      ]));
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

      // ============ 形状管理 ============
      subBar.appendChild(el('div', { class: 'tape-row' }, [
        el('button', {
          class: 'tape-chip', text: '⚙️ 管理形状',
          onClick: () => openShapeImageManager(),
        }),
      ]));

      // 自由多边形提示
      if (shapeType === 'polygon') {
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '连续点多个点，双击结束' }),
        ]));
      }
      // ============ 选中纸张形状后的操作（多选版） ============
      const selectedShapes = paperLayer.getSelectedShapes ? paperLayer.getSelectedShapes() : [];
      if (selectedShapes.length > 0) {
        const firstSel = selectedShapes[0];
        const s = firstSel.shape;

        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: `已选 ${selectedShapes.length} 个形状` }),
          el('button', {
            class: 'tape-chip', text: '👁 显/隐',
            onClick: () => {
              selectedShapes.forEach(({ shape }) => {
                shape.visible = shape.visible === false ? true : false;
              });
              paperLayer.save();
              paperLayer.redraw();
            },
          }),
          el('button', {
            class: 'tape-chip' + (s.locked ? ' active' : ''),
            text: s.locked ? '🔒 已锁' : '🔓 锁定',
            onClick: () => {
              const nextLocked = !s.locked;
              selectedShapes.forEach(({ shape }) => { shape.locked = nextLocked; });
              paperLayer.save();
              paperLayer.redraw();
              updateSubToolbar();
            },
          }),
          el('button', {
            class: 'tape-chip', text: '📋 复制',
            onClick: () => {
              const data = selectedShapes.map(({ paper, shape }) => ({
                paperId: paper.id,
                shape: JSON.parse(JSON.stringify(shape))
              }));
              clipboard = { type: 'shape', data: data };
              toastSuccess(`已复制 ${data.length} 个形状`);
            },
          }),
          el('button', {
            class: 'tape-chip', text: '📥 粘贴',
            onClick: () => {
              pasteClipboard();
              updateSubToolbar();
            },
          }),
          el('button', {
            class: 'tape-chip', text: '🗑 删除',
            onClick: () => {
              selectedShapes.forEach(({ paper, shape }) => {
                if (!paper.shapes) return;
                const idx = paper.shapes.indexOf(shape);
                if (idx >= 0) paper.shapes.splice(idx, 1);
              });
              paperLayer.setShapeSelection([]);
              paperLayer.save();
              paperLayer.redraw();
              updateSubToolbar();
            },
          }),
          el('button', {
            class: 'tape-chip', text: '取消选中',
            onClick: () => {
              paperLayer.setShapeSelection([]);
              updateSubToolbar();
            },
          }),
        ]));

        // 透明度和旋转（只操作第一个，应用到所有选中项）
        const opNum = el('input', {
          type: 'number', min: '0', max: '1', step: '0.1',
          value: String(s.opacity !== undefined ? s.opacity : 1),
          style: { width: '48px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
          onInput: (e) => {
            const v = Math.max(0, Math.min(1, Number(e.target.value) || 1));
            selectedShapes.forEach(({ shape }) => { shape.opacity = v; });
            paperLayer.save();
            paperLayer.redraw();
          },
        });
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '透明' }), opNum,
        ]));

        // 旋转
        const rotNum = el('input', {
          type: 'number', min: '-180', max: '180', step: '15',
          value: String(s.rotation || 0),
          style: { width: '56px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)' },
          onInput: (e) => {
            const v = Number(e.target.value) || 0;
            selectedShapes.forEach(({ shape }) => { shape.rotation = v; });
            paperLayer.save();
            paperLayer.redraw();
          },
        });
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '旋转' }),
          rotNum,
          el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: '°' }),
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
      // ============ 全局胶带 + 纸张胶带 统一选中提示 ============
      const globalCount = tapeLayer.getSelectedIds().length;
      const paperCount = paperTapeSelectedList.length;
      const selectedCount = globalCount + paperCount;

      if (selectedCount > 0) {
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--primary-dark)' }, text: `已选中 ${selectedCount} 条胶带` }),
          el('button', { class: 'tape-chip', text: '🔲 框选更多', onClick: () => { tapeSelectMode = true; updateSubToolbar(); } }),
          el('button', {
            class: 'tape-chip', text: '取消选中',
            onClick: () => {
              tapeLayer.clearSelection();
              paperTapeSelectedList = [];
              paperTapeSelected = null;
              window.__paperTapeSelectedList = paperTapeSelectedList;
              tapeSelectMode = false;
              updateSubToolbar();
            }
          }),
        ]));

        // 第二行：全选、全不选、批量删除
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('button', {
            class: 'tape-chip', text: '全选',
            onClick: () => {
              tapeLayer.selectAll();
              paperTapeSelectedList = [];
              paperLayer.getPapers().forEach(p => {
                if (p.tapes) p.tapes.forEach(t => paperTapeSelectedList.push({ paper: p, tape: t }));
              });
              window.__paperTapeSelectedList = paperTapeSelectedList;
              updateSubToolbar();
            }
          }),
          el('button', {
            class: 'tape-chip', text: '全不选',
            onClick: () => {
              tapeLayer.clearSelection();
              paperTapeSelectedList = [];
              paperTapeSelected = null;
              window.__paperTapeSelectedList = paperTapeSelectedList;
              updateSubToolbar();
            }
          }),
          el('button', {
            class: 'tape-chip', text: '🗑 批量删除',
            onClick: () => {
              // 删除全局胶带
              tapeLayer.getSelectedIds().forEach(id => {
                const tapes = tapeLayer.getTapes();
                const idx = tapes.findIndex(t => t.id === id);
                if (idx >= 0) tapes.splice(idx, 1);
              });
              tapeLayer.clearSelection();
              if (store.saveTape) store.saveTape(imageId, tapeLayer.getTapes());
              tapeLayer.redrawAsync();

              // 删除纸张胶带
              paperTapeSelectedList.forEach(({ paper: p, tape: t }) => {
                const idx = p.tapes.indexOf(t);
                if (idx >= 0) p.tapes.splice(idx, 1);
              });
              paperTapeSelectedList = [];
              paperTapeSelected = null;
              window.__paperTapeSelectedList = [];
              paperLayer.save();
              paperLayer.redraw();

              updateSubToolbar();
            },
          }),
        ]));

        // 第三行：锁定、显隐、置顶/置底、删除
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('button', {
            class: 'tape-chip', text: '🔓 锁定',
            onClick: () => {
              const t = tapeLayer.getSelected();
              if (t) { t.locked = !t.locked; store.saveTape(imageId, tapeLayer.getTapes()); tapeLayer.redraw(); }
              paperTapeSelectedList.forEach(({ tape }) => { tape.locked = !tape.locked; });
              if (paperTapeSelectedList.length > 0) { paperLayer.save(); paperLayer.redraw(); }
              updateSubToolbar();
            }
          }),
          el('button', {
            class: 'tape-chip', text: '👁 显/隐',
            onClick: () => {
              const t = tapeLayer.getSelected();
              if (t) { t.visible = !t.visible; store.saveTape(imageId, tapeLayer.getTapes()); tapeLayer.redraw(); }
              paperTapeSelectedList.forEach(({ tape }) => { tape.visible = tape.visible === false ? true : false; });
              if (paperTapeSelectedList.length > 0) { paperLayer.save(); paperLayer.redraw(); }
              updateSubToolbar();
            }
          }),

          // ====================================================
          el('button', {
            class: 'tape-chip', text: '🗑 删除',
            onClick: () => {
              // 删除全局胶带
              const t = tapeLayer.getSelected();
              if (t) {
                const tapes = tapeLayer.getTapes();
                const idx = tapes.indexOf(t);
                if (idx >= 0) tapes.splice(idx, 1);
                tapeLayer.clearSelection();
                store.saveTape(imageId, tapeLayer.getTapes());
                tapeLayer.redrawAsync();
              }
              // 删除纸张胶带
              if (paperTapeSelectedList.length > 0) {
                paperTapeSelectedList.forEach(({ paper: p, tape: pt }) => {
                  const idx = p.tapes.indexOf(pt);
                  if (idx >= 0) p.tapes.splice(idx, 1);
                });
                paperTapeSelectedList = [];
                paperTapeSelected = null;
                window.__paperTapeSelectedList = [];
                paperLayer.save();
                paperLayer.redraw();
              }
              updateSubToolbar();
            }
          }),
        ]));

      }

      // 原有的工具栏
      subBar.appendChild(tapeLayer.renderTapeToolbar());
    }

    if (currentTool === 'paper') {
      subBar.appendChild(paperLayer.renderPaperToolbar());
      // 检查编辑项是否还存在
      if (window.__paperEditingItem) {
        const papers = paperLayer.getPapers();
        if (!papers.find(p => p.id === window.__paperEditingItem.id)) {
          window.__paperEditingItem = null;
        }
      }

      if (window.__paperEditingItem) {
        const item = window.__paperEditingItem;
        const ts = item.textStyle || {};
        const fs = ts.fontSize || 16;
        const lh = ts.lineHeight || 1.5;
        const ff = ts.fontFamily || 'sans-serif';
        const al = ts.align || 'left';

        const updatePaperText = () => {
          item.textStyle = item.textStyle || {};
          paperLayer.save();
          paperLayer.redraw();
        };

        // 字号
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '字号' }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '−',
            style: { minWidth: '22px', padding: '0 3px', fontSize: '12px', minHeight: '26px' },
            onClick: () => {
              item.textStyle.fontSize = Math.max(10, fs - 1);
              updatePaperText(); updateSubToolbar();
            }
          }),
          el('span', { style: { fontSize: '12px', minWidth: '24px', textAlign: 'center' }, text: String(fs) }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '+',
            style: { minWidth: '22px', padding: '0 3px', fontSize: '12px', minHeight: '26px' },
            onClick: () => {
              item.textStyle.fontSize = Math.min(48, fs + 1);
              updatePaperText(); updateSubToolbar();
            }
          }),
        ]));

        // 行距
        const lhRow = el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '行距' }),
        ]);
        const lhCustom = el('input', {
          type: 'number', min: '0.5', max: '5.0', step: '0.1',
          value: String(lh),
          placeholder: '行距',
          style: { width: '56px', padding: '3px', fontSize: '12px', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)', display: 'none' },
          onInput: (e) => {
            item.textStyle.lineHeight = Math.max(0.5, Math.min(5.0, Number(e.target.value) || 1.5));
            updatePaperText();
          },
        });
        const lhSelect = el('select', {
          style: { width: '80px', padding: '4px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' },
          onChange: (e) => {
            const v = e.target.value;
            if (v === 'custom') {
              lhCustom.style.display = 'inline-block';
              lhCustom.focus();
            } else {
              lhCustom.style.display = 'none';
              item.textStyle.lineHeight = Number(v);
              updatePaperText();
            }
          },
        }, [
          ...[1.0, 1.1, 1.2, 1.25, 1.5, 2.0].map(v => el('option', {
            value: String(v),
            text: String(v),
            selected: lh === v,
          })),
          el('option', { value: 'custom', text: '自定义…' }),
        ]);
        lhRow.appendChild(lhSelect);
        lhRow.appendChild(lhCustom);
        subBar.appendChild(lhRow);

        // 字体
        const fontSelect = el('select', {
          style: { flex: '1', padding: '4px 6px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' },
          onChange: (e) => {
            item.textStyle.fontFamily = e.target.value;
            updatePaperText();
          },
        }, [
          el('option', { value: 'sans-serif', text: '黑体', selected: ff === 'sans-serif' }),
          el('option', { value: 'serif', text: '宋体', selected: ff === 'serif' }),
          el('option', { value: 'monospace', text: '等宽', selected: ff === 'monospace' }),
        ]);
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '字体' }),
          fontSelect,
        ]));

        // 对齐
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '对齐' }),
          ...['left', 'center', 'right'].map(a => el('button', {
            class: 'tape-chip' + (al === a ? ' active' : ''),
            text: a === 'left' ? '左对齐' : a === 'center' ? '居中' : '右对齐',
            onClick: () => {
              item.textStyle.align = a;
              updatePaperText();
              updateSubToolbar();
            },
          })),
        ]));

        // 文字颜色
        const cw = el('div');
        cw.appendChild(renderColorPicker({
          current: ts.color || '#2B2D42',
          onChange: (c) => {
            item.textStyle.color = c;
            updatePaperText();
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
        targetCtx.save();
        targetCtx.fillStyle = fc;
        targetCtx.beginPath();
        pathFn();
        targetCtx.fill();
        targetCtx.restore();
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
  // ============ 形状图片管理 ============
  function openShapeImageManager() {
    const shapes = (store.getPatterns ? store.getPatterns() : []).filter(p => p.type === 'shape-image');
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
        const isUsing = window.__shapeImageId === p.id;
        const isFav = p.favorited === true;
        const isLocked = p.locked === true;
        list.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: 'var(--bg)', borderRadius: '8px' },
        }, [
          el('input', { type: 'checkbox', checked, onChange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); } }),
          p.thumbUrl ? el('img', { src: p.thumbUrl, style: { width: '40px', height: '40px', borderRadius: '6px', objectFit: 'contain', background: '#fff' } }) : null,
          el('span', { style: { flex: '1', fontSize: '12px', color: 'var(--text-2)' }, text: p.id.slice(0, 8) }),
          el('button', {
            class: 'tape-chip' + (isFav ? ' active' : ''),
            text: isFav ? '⭐' : '☆',
            onClick: () => {
              p.favorited = !isFav;
              if (store.getPatterns) {
                const all = store.getPatterns();
                const idx = all.findIndex(x => x.id === p.id);
                if (idx >= 0) { all[idx].favorited = p.favorited; }
                localStorage.setItem('kg_patterns', JSON.stringify(all));
              }
              renderList();
            },
          }),
          el('button', {
            class: 'tape-chip' + (isLocked ? ' active' : ''),
            text: isLocked ? '🔒' : '🔓',
            onClick: () => {
              p.locked = !isLocked;
              if (store.getPatterns) {
                const all = store.getPatterns();
                const idx = all.findIndex(x => x.id === p.id);
                if (idx >= 0) { all[idx].locked = p.locked; }
                localStorage.setItem('kg_patterns', JSON.stringify(all));
              }
              renderList();
            },
          }),
          el('button', {
            class: 'tape-chip' + (isUsing ? ' active' : ''),
            text: isUsing ? '✅ 使用中' : '使用',
            onClick: () => {
              if (isLocked && !isUsing) { toastError('已锁定，先解锁'); return; }
              if (isUsing) { window.__shapeImageId = null; shapeType = 'arrow'; }
              else { shapeType = 'custom-image'; window.__shapeImageId = p.id; }
              updateSubToolbar();
              mask.remove();
            },
          }),
        ]));
      });
    }
    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
        el('h3', { text: '管理自定义形状' }),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { shapes.forEach(p => selected.add(p.id)); renderList(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); renderList(); } }),
        ]),
        list,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '删除选中',
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(mask);
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
  // ============ 顶栏动态按钮 ============
  const dynBar = document.getElementById('topbar-dynamic');
  let setSaveStatus = () => { };
  let updateUndoBtn = () => { };

  if (dynBar) {
    dynBar.innerHTML = '';
    const topConfig = getTopBarConfig(); // 读取配置

    const mk = (label, title, fn) => {
      if (topConfig[label] === false) return; // 根据配置决定是否显示
      const b = el('button', { class: 'btn btn-sm btn-ghost', text: label, title, onClick: fn });
      attachLongPress(b, title);
      dynBar.appendChild(b);
      return b;
    };

    //切换上一张/下一张图片
    if (pointId) {
      const pt = store.getPoint(pointId);
      if (pt) {
        const allImageIds = [...(pt.imageIds || []), ...(pt.compositeImageIds || [])];
        const currentIndex = allImageIds.indexOf(imageId);

        if (currentIndex > 0) {
          const prevId = allImageIds[currentIndex - 1];
          dynBar.appendChild(mk('⏮', '上一张图片', () => {
            window.location.hash = `#/annotate/${prevId}?pointId=${pointId}`;
          }));
        }

        if (currentIndex >= 0 && currentIndex < allImageIds.length - 1) {
          const nextId = allImageIds[currentIndex + 1];
          dynBar.appendChild(mk('⏭', '下一张图片', () => {
            window.location.hash = `#/annotate/${nextId}?pointId=${pointId}`;
          }));
        }
      }
    }

    // 原有的移动/缩放/撤销等按钮
    mk('←', '左移', () => { offsetX += 40; updateTransform(); });
    mk('→', '右移', () => { offsetX -= 40; updateTransform(); });
    mk('↑', '上移', () => { offsetY += 40; updateTransform(); });
    mk('↓', '下移', () => { offsetY -= 40; updateTransform(); });
    mk('🔍+', '放大', () => { scale = Math.min(10, scale * 1.25); updateTransform(); });
    mk('🔍-', '缩小', () => { scale = Math.max(0.3, scale / 1.25); updateTransform(); });
    mk('1:1', '原始大小', () => { scale = 1; offsetX = 0; offsetY = 0; updateTransform(); });

    // 撤销按钮需要特殊处理，因为要更新数字
    const undoBtn = mk('↶', '撤销', undo);
    if (undoBtn) {
      updateUndoBtn = () => {
        const n = undoStack.length;
        undoBtn.textContent = n > 0 ? `↶ ${n}` : '↶';
        undoBtn.style.opacity = n > 0 ? '1' : '0.4';
      };
      updateUndoBtn();
    }

    mk('🗑', '清除', clearAll);
    mk('➕', '扩展画布', openExpandDialog);
    mk('📚', '图层顺序', openLayerPanel);
    mk('🔒', '显示/隐藏全部锁图标', () => {
      const cur = textLayer.getShowLockIcons();
      textLayer.setShowLockIcons(!cur);
      tapeLayer.setShowLockIcons(!cur);
      toastSuccess(cur ? '锁图标已隐藏' : '锁图标已显示');
    });

    // 齿轮按钮：管理工具栏
    dynBar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '⚙️', title: '管理工具栏',
      onClick: openTopBarConfigPanel
    }));

    mk('💾', '保存', () => saveAll(true));

    // 保存状态灯
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
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
        el('h3', { text: '清除' }),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '12px 0' } }, [
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            el('input', { type: 'checkbox', id: 'clr-stroke', checked: true }),
            el('span', { text: '笔迹' }),
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            el('input', { type: 'checkbox', id: 'clr-tape', checked: true }),
            el('span', { text: '胶带' }),
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            el('input', { type: 'checkbox', id: 'clr-shape', checked: true }),
            el('span', { text: '形状' }),
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            el('input', { type: 'checkbox', id: 'clr-text', checked: true }),
            el('span', { text: '文字' }),
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            el('input', { type: 'checkbox', id: 'clr-paper', checked: true }),
            el('span', { text: '纸张' }),
          ]),
        ]),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '确定清除',
            onClick: () => {
              // 1. 清除笔迹（全局笔迹 + 纸张上的笔迹）
              if (document.getElementById('clr-stroke').checked) {
                ctx.clearRect(0, 0, W, H);
                paperStrokeCtx.clearRect(0, 0, W, H);
                paperLayer.getPapers().forEach(p => { p.strokes = []; });
                paperLayer.save();
                paperLayer.redraw();
              }

              // 2. 清除胶带（全局胶带 + 纸张绑定的胶带）
              if (document.getElementById('clr-tape').checked) {
                tapeLayer.getTapes().length = 0;
                store.saveTape(imageId, []);
                tapeLayer.redrawAsync();
                paperLayer.getPapers().forEach(p => { p.tapes = []; });
                paperLayer.save();
              }

              // 3. 清除形状（纸张上的形状）
              if (document.getElementById('clr-shape').checked) {
                paperLayer.getPapers().forEach(p => { p.shapes = []; });
                paperLayer.setShapeSelection([]);
                paperLayer.save();
                paperLayer.redraw();
              }

              // 4. 清除文字（全局文字）
              if (document.getElementById('clr-text').checked) {
                textLayer.getItems().length = 0;
                textLayer.select(null);
                textLayer.save();
                textLayer.redraw();
              }

              // 5. 清除纸张（连带纸张上的笔迹、胶带、形状）
              if (document.getElementById('clr-paper').checked) {
                paperLayer.getPapers().length = 0;
                store.savePaper(imageId, []);
                paperLayer.setShapeSelection([]);
                paperLayer.redraw();
              }

              dirty = true;
              if (typeof setSaveStatus === 'function') setSaveStatus('dirty');
              mask.remove();
              toastSuccess('已清除');
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
    const labels = {
      base: '🖼 底图',
      stroke: '✏️ 笔迹',
      text: 'T 文字',
      tape: '🎗️ 胶带',
      paper: '📄 纸张',
      shape: '🔺 形状',
      paperStroke: '✏️ 纸张笔迹'
    };

    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', userSelect: 'none' } });

    let dragIndex = -1;
    let dragEl = null;
    let startY = 0;
    let dragging = false;

    function renderList() {
      list.innerHTML = '';
      // 倒序显示：数组最后一个（最顶层）显示在面板最上面
      [...tempOrder].reverse().forEach((key, i) => {
        const item = el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '12px 16px', background: 'var(--card)',
            borderRadius: '8px', border: '1px solid rgba(0,0,0,.06)',
            cursor: 'grab', transition: 'transform 0.1s',
            touchAction: 'none' // 防止触屏滚动干扰
          },
          'data-key': key
        }, [
          el('span', { style: { flex: '1', fontWeight: '600', fontSize: '14px' }, text: labels[key] || key }),
          el('span', { style: { color: 'var(--text-2)' }, text: '≡' }) // 拖拽手柄图标
        ]);

        // ============ 拖拽逻辑 ============
        item.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();

          dragIndex = i;
          dragEl = item;
          startY = e.clientY;
          dragging = false;

          item.style.cursor = 'grabbing';
          item.style.zIndex = '10';
          item.style.boxShadow = '0 8px 24px rgba(0,0,0,.15)';

          item.setPointerCapture(e.pointerId);

          const onMove = (ev) => {
            const dy = ev.clientY - startY;
            if (Math.abs(dy) > 5) dragging = true;
            if (!dragging) return;

            item.style.transform = `translateY(${dy}px)`;

            // 判断是否越过相邻元素
            const items = [...list.children];
            const currentRect = item.getBoundingClientRect();
            const currentCenter = currentRect.top + currentRect.height / 2;

            let targetIndex = dragIndex;

            items.forEach((other, idx) => {
              if (other === item) return;
              const otherRect = other.getBoundingClientRect();
              const otherCenter = otherRect.top + otherRect.height / 2;

              if (idx < dragIndex && currentCenter < otherCenter) {
                targetIndex = idx;
              } else if (idx > dragIndex && currentCenter > otherCenter) {
                targetIndex = idx;
              }
            });

            if (targetIndex !== dragIndex) {
              // 视觉交换
              const temp = tempOrder[tempOrder.length - 1 - dragIndex];
              tempOrder[tempOrder.length - 1 - dragIndex] = tempOrder[tempOrder.length - 1 - targetIndex];
              tempOrder[tempOrder.length - 1 - targetIndex] = temp;

              dragIndex = targetIndex;
              startY = ev.clientY;
              item.style.transform = 'translateY(0)';

              // 重新渲染列表，并把原元素重新绑定
              const currentKey = item.getAttribute('data-key');
              renderList();

              // 找到新渲染出来的元素并重新设置拖拽状态
              dragEl = list.querySelector(`[data-key="${currentKey}"]`);
              if (dragEl) {
                dragEl.style.cursor = 'grabbing';
                dragEl.style.zIndex = '10';
                dragEl.style.boxShadow = '0 8px 24px rgba(0,0,0,.15)';
                dragEl.setPointerCapture(ev.pointerId);
                bindDrag(dragEl);
              }
            }
          };

          const onUp = (ev) => {
            if (dragEl) {
              dragEl.style.cursor = 'grab';
              dragEl.style.zIndex = 'auto';
              dragEl.style.boxShadow = 'none';
              dragEl.style.transform = 'translateY(0)';
            }
            item.releasePointerCapture(ev.pointerId);
            item.removeEventListener('pointermove', onMove);
            item.removeEventListener('pointerup', onUp);
            item.removeEventListener('pointercancel', onUp);

            if (dragging) {
              // 应用新顺序
              applyLayerOrder(tempOrder);
            }
            dragging = false;
          };

          item.addEventListener('pointermove', onMove);
          item.addEventListener('pointerup', onUp);
          item.addEventListener('pointercancel', onUp);
        });

        list.appendChild(item);
      });
    }

    // 绑定新元素的拖拽事件（因为拖动过程中会重新渲染DOM）
    function bindDrag(newEl) {
      const key = newEl.getAttribute('data-key');
      const i = tempOrder.length - 1 - tempOrder.indexOf(key);

      newEl.addEventListener('pointerdown', (e) => {
        // 触发和上面一样的拖拽逻辑
        newEl.dispatchEvent(new PointerEvent('pointerdown', e));
      });
    }

    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '380px' } }, [
        el('h3', { text: '图层顺序' }),
        el('p', { text: '长按拖动调整顺序，越靠上，层级越高', style: { fontSize: '13px', color: 'var(--text-2)' } }),
        list,
        el('div', { class: 'confirm-actions', style: { flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-ghost', text: '恢复默认',
            onClick: () => {
              tempOrder.length = 0;
              tempOrder.push(...DEFAULT_LAYER_ORDER);
              applyLayerOrder(tempOrder);
              renderList();
            }
          }),
          el('button', {
            class: 'btn btn-ghost', text: '取消',
            onClick: () => {
              applyLayerOrder(currentLayerOrder); // 恢复原样
              mask.remove();
            }
          }),
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onClick: () => {
              currentLayerOrder = [...tempOrder];
              if (store.saveLayerOrder) store.saveLayerOrder(currentLayerOrder);
              applyLayerOrder(currentLayerOrder); // 保存后立刻应用并重绘
              mask.remove();
              toastSuccess('图层顺序已保存');
            }
          }),
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
      const copy = {
        ...clipboard.data, id: crypto.randomUUID(), x: clipboard.data.x + 20, y: clipboard.data.y + 20, locked: false, strokes: clipboard.data.strokes ? JSON.parse(JSON.stringify(clipboard.data.strokes)) : [],
        tapes: clipboard.data.tapes ? JSON.parse(JSON.stringify(clipboard.data.tapes)) : [],
        shapes: clipboard.data.shapes ? JSON.parse(JSON.stringify(clipboard.data.shapes)) : [],
      };

      paperLayer.getPapers().push(copy);
      paperLayer.select(copy);
      paperLayer.save();
      paperLayer.redraw();
      setActiveTool('paper');
    } else if (clipboard.type === 'shape') {
      const newSelections = [];
      clipboard.data.forEach(item => {
        const paper = paperLayer.getPapers().find(p => p.id === item.paperId);
        if (!paper) return;
        if (!paper.shapes) paper.shapes = [];

        const newShape = JSON.parse(JSON.stringify(item.shape));
        newShape.id = crypto.randomUUID();
        // 偏移 20px 避免重叠
        newShape.x1 += 20; newShape.y1 += 20;
        newShape.x2 += 20; newShape.y2 += 20;

        paper.shapes.push(newShape);
        newSelections.push({ paper, shape: newShape });
      });
      paperLayer.save();
      paperLayer.redraw();
      paperLayer.setShapeSelection(newSelections);
      setActiveTool('shape');
    }
    dirty = true;
    setSaveStatus('dirty');
    toastSuccess('已粘贴');
  }
  // ============ 手势事件 ============
  canvasWrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // 阻止拖动底图（浏览器默认行为）
    e.preventDefault();
    e.stopPropagation();

    const isTouch = e.pointerType === 'touch';
    const shouldDrawWithFinger = inputMode === 'finger-draw';
    const shouldPanWithFinger = isTouch && !shouldDrawWithFinger && currentTool === 'hand';

    // ============ 双指操作 ============
    if (shouldPanWithFinger) {
      if (pointers.size === 0) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drawing = 'pan';
        startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
        try { strokeCanvas.setPointerCapture(e.pointerId); } catch { }
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

    // 强制重置
    drawing = false;
    points = [];
    startPt = null;

    // 如果是手指，且没开“手指也可画”，且不是抓手，直接拦截
    if (isTouch && !shouldDrawWithFinger && currentTool !== 'hand') {
      return;
    }

    // 双指缩放
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      startPt = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
      drawing = 'pinch';
      return;
    }

    // 统一坐标转换
    const pt = canvasToImage(e.clientX, e.clientY);


    // ============ 吸管 ============
    if (currentTool === 'eyedropper') {
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

    // ============ 抓手 ============
    if (currentTool === 'hand') {
      drawing = 'pan';
      startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
      try { strokeCanvas.setPointerCapture(e.pointerId); } catch { }
      return;
    }

    // ============ 胶带 ============
    if (currentTool === 'tape') {
      // 先检查纸张胶带
      const papers = paperLayer.getPapers();
      for (let i = papers.length - 1; i >= 0; i--) {
        const p = papers[i];
        if (!p.tapes || p.visible === false) continue;
        for (let j = p.tapes.length - 1; j >= 0; j--) {
          const t = p.tapes[j];
          if (t.visible === false) continue;
          const relX = pt.x - p.x;
          const relY = pt.y - p.y;
          if (tapeLayer.hitTape(t, relX, relY, 0)) {
            let longPressed = false;
            const timer = setTimeout(() => {
              longPressed = true;
              tapeSelectMode = true;
              if (!paperTapeSelectedList.find(item => item.tape.id === t.id)) {
                paperTapeSelectedList.push({ paper: p, tape: t });
                paperTapeSelected = { paper: p, tape: t };
              }
              window.__paperTapeSelectedList = paperTapeSelectedList;
              updateSubToolbar();
              toastSuccess('已选中纸张胶带');
            }, 500);
            const onUp = () => {
              clearTimeout(timer);
              if (!longPressed) {
                t.visible = !t.visible;
                paperLayer.save();
                paperLayer.redraw();
                window.__tapeLayer.redraw();
              }
              strokeCanvas.removeEventListener('pointerup', onUp);
              strokeCanvas.removeEventListener('pointercancel', onUp);
            };
            strokeCanvas.addEventListener('pointerup', onUp);
            strokeCanvas.addEventListener('pointercancel', onUp);
            return;
          }
        }
      }

      // 再检查全局胶带
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
            if (settingPanel) settingPanel.style.display = 'flex';
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

      // 点空白：画新胶带
      pushUndo();
      const hitPaper = paperLayer.hitTest(pt.x, pt.y);
      if (hitPaper && !hitPaper.locked) {
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
            locked: false,
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

    // ============ 文字 ============
    if (currentTool === 'text') {
      const hit = textLayer.hitTest(pt.x, pt.y);
      if (hit) {
        const wasSelected = textLayer.getSelected() === hit;
        textLayer.select(hit);
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
        openInlineTextEditor(newItem);
        updateSubToolbar();
      }
      return;
    }

    // ============ 画笔 / 橡皮 / 圈擦 ============
    if (currentTool === 'pen' || currentTool === 'eraser' || currentTool === 'circle-erase') {
      pushUndo();
      e.preventDefault();

      const hitPaper = paperLayer.hitTest(pt.x, pt.y);

      if (currentTool === 'eraser') {
        drawing = 'eraser';
      } else if (currentTool === 'circle-erase') {
        drawing = 'circle-erase';
        if (eraseShape === 'free') eraseFreePath = [pt];
      } else {
        drawing = 'pen';
        if (hitPaper && !hitPaper.locked) {
          hitPaper._currentStroke = { type: 'pen', points: [], color: currentColor, width: currentWidth };
        }
      }

      startPt = pt;
      points = [{ ...pt, pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5 }];
      try { strokeCanvas.setPointerCapture(e.pointerId); } catch { }
      return;
    }

    // ============ 形状 ============
    if (currentTool === 'shape') {
      // 先检查是否点中选中形状的控制手柄
      const handleId = findShapeHandleAt(pt.x, pt.y);
      if (handleId) {
        pushUndo();
        const sel = paperLayer.getSelectedShapes()[0];
        shapeDragOffset = paperLayer.startShapeResize(sel, handleId, pt.x - sel.paper.x, pt.y - sel.paper.y);
        drawing = 'shape-resize';
        strokeCanvas.setPointerCapture(e.pointerId);
        return;
      }

      // 检查是否点中已有形状
      const clickedShape = findShapeAt(pt.x, pt.y);
      if (clickedShape) {
        if (clickedShape.shape.locked) {
          toastError('已锁定');
          return;
        }

        const cur = paperLayer.getSelectedShapes ? paperLayer.getSelectedShapes() : [];

        // 长按进入多选模式
        shapeLongPressFired = false;
        shapeSelectTimer = setTimeout(() => {
          shapeLongPressFired = true;
          let newSel;
          if (cur.some(sel => sel.shape === clickedShape.shape)) {
            newSel = cur;
          } else {
            newSel = [...cur, clickedShape];
          }
          paperLayer.setShapeSelection(newSel);
          updateSubToolbar();
          toastSuccess('多选模式：继续点击可加选/减选');
        }, 500);

        // 短按逻辑（松手时判断）
        const onUp = () => {
          clearTimeout(shapeSelectTimer);
          strokeCanvas.removeEventListener('pointerup', onUp);
          strokeCanvas.removeEventListener('pointercancel', onUp);
          if (shapeLongPressFired) return;

          // 短按
          let newSel;
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            if (cur.some(sel => sel.shape === clickedShape.shape)) {
              newSel = cur.filter(sel => sel.shape !== clickedShape.shape);
            } else {
              newSel = [...cur, clickedShape];
            }
          } else {
            // 已选中 → 开始拖动
            if (cur.length === 1 && cur[0].shape === clickedShape.shape) {
              pushUndo();
              shapeDragOffset = paperLayer.startShapeDrag(clickedShape, pt.x - clickedShape.paper.x, pt.y - clickedShape.paper.y);
              drawing = 'shape-drag';
              return;
            }
            newSel = [clickedShape];
          }
          paperLayer.setShapeSelection(newSel);
          updateSubToolbar();
        };
        strokeCanvas.addEventListener('pointerup', onUp);
        strokeCanvas.addEventListener('pointercancel', onUp);
        return;
      }

      // 没点中形状，走原来的绘制逻辑
      pushUndo();
      const hitPaperShape = paperLayer.hitTest(pt.x, pt.y);
      if (!shapeOnPaper || !hitPaperShape) {
        drawing = shapeType;
        startPt = pt;
        strokeCanvas.setPointerCapture(e.pointerId);
        return;
      }
      if (hitPaperShape && !hitPaperShape.locked) {
        drawing = 'paper-shape';
        startPt = pt;
        window.__paperShapeTarget = hitPaperShape;
        window.__paperShapeType = shapeType;
        window.__paperShapeBorderColor = window.__shapeBorderColor || currentColor;
        window.__paperShapeFillColor = window.__shapeFillColor || 'transparent';
        window.__paperShapeWidth = currentWidth;
        window.__paperShapeWave = waveAmplitude;
      } else {
        drawing = shapeType;
        startPt = pt;
      }
      strokeCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // ============ 纸张（拖拽 / 缩放 / 旋转） ============
    if (currentTool === 'paper') {
      const sel = paperLayer.getSelected();

      // 1. 优先判断：是否点中了缩放控制点
      if (sel && !sel.locked) {
        const handles = paperLayer.getHandles();
        // 放大命中区域，手指更容易点中
        const hitHandle = handles.find(h => Math.hypot(pt.x - h.x, pt.y - h.y) < 30);
        if (hitHandle) {
          pushUndo();
          paperDragOffset = paperLayer.startResize(hitHandle.id, pt.x, pt.y);
          drawing = 'paper-resize';
          strokeCanvas.setPointerCapture(e.pointerId);
          return;
        }

        // 旋转手柄判定
        const cx = sel.x + sel.w / 2;
        const cy = sel.y + sel.h / 2;
        const rad = (sel.rotation || 0) * Math.PI / 180;
        const hx = cx + Math.sin(rad) * (sel.h / 2 + 20);
        const hy = cy - Math.cos(rad) * (sel.h / 2 + 20);
        if (Math.hypot(pt.x - hx, pt.y - hy) < 30) {
          pushUndo();
          paperDragOffset = paperLayer.startRotate(pt.x, pt.y);
          drawing = 'paper-rotate';
          strokeCanvas.setPointerCapture(e.pointerId);
          return;
        }
      }

      // 2. 如果没有点中控制点，才进行纸张的命中测试
      const hit = paperLayer.hitTest(pt.x, pt.y);
      if (hit) {
        if (sel !== hit) {
          paperLayer.select(hit);
          updateSubToolbar();
          return; // 只选中，不拖动
        }
        // 3. 拖动纸张内部
        if (sel.x <= pt.x && pt.x <= sel.x + sel.w && sel.y <= pt.y && pt.y <= sel.y + sel.h) {
          if (sel.locked) { toastError('已锁定'); return; }
          pushUndo();
          paperDragOffset = { dx: pt.x - sel.x, dy: pt.y - sel.y, paper: sel, _lastX: sel.x, _lastY: sel.y };
          drawing = 'paper-drag';
          strokeCanvas.setPointerCapture(e.pointerId);
          return;
        }
      } else {
        paperLayer.select(null);
        drawing = false;
        updateSubToolbar();
      }
      return;
    }

  });

  canvasWrap.addEventListener('pointermove', (e) => {
    if (drawing === 'paper-resize' && paperDragOffset) {
      const pt = canvasToImage(e.clientX, e.clientY);
      paperDragOffset.move(pt.x, pt.y);
      dirty = true;
      return;
    }
    // ============ 纸张拖动（极速联动版 + 辅助线） ============
    if (drawing === 'paper-drag' && paperDragOffset) {
      const p = paperDragOffset.paper;
      const pt = canvasToImage(e.clientX, e.clientY); // 👈 必须加上这一行！计算鼠标当前坐标

      // 1. 更新纸张的实时位置
      p.x = pt.x - paperDragOffset.dx;
      p.y = pt.y - paperDragOffset.dy;

      // 2. 计算这一帧的差值
      const dx = p.x - (paperDragOffset._lastX || p.x);
      const dy = p.y - (paperDragOffset._lastY || p.y);
      paperDragOffset._lastX = p.x;
      paperDragOffset._lastY = p.y;

      // 3. 将差值应用到绑定的胶带上
      let tapesChanged = false;
      tapeLayer.getTapes().forEach(t => {
        if (t._boundPaperId === p.id) {
          t.points.forEach(pt2 => { pt2.x += dx; pt2.y += dy; });
          tapesChanged = true;
        }
      });

      // 4. 计算辅助线
      const guides = drawGuideLines(p);
      snapToGuide(p, guides);

      // 5. 重绘
      paperLayer.redraw();
      if (tapesChanged) tapeLayer.redraw();

      dirty = true;
      return;
    }
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
      // 绝对防线：只有抓手工具才允许平移
      if (currentTool !== 'hand') {
        drawing = false;
        return;
      }
      offsetX = e.clientX - startPt.x;
      offsetY = e.clientY - startPt.y;
      if (!window.__panRaf) {
        window.__panRaf = requestAnimationFrame(() => { updateTransform(); window.__panRaf = null; });
      }
      return;
    }

    // ============ 画笔 / 橡皮 ============
    if (drawing === 'pen' || drawing === 'eraser') {
      const pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
      points.push({ ...pt, pressure });

      // --- 橡皮逻辑 ---
      if (drawing === 'eraser') {
        const eraserRadius = currentWidth * 2 / Math.sqrt(W / 800);
        const lastPt = points.length > 1 ? points[points.length - 2] : pt;

        // 1. 擦除全局画布
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

        // 2. 擦除胶带
        tapeLayer.eraseSegment(lastPt.x, lastPt.y, pt.x, pt.y, eraserRadius);

        // 3. 擦除纸张笔迹
        paperLayer.getPapers().forEach(p => {
          if (!p.strokes || p.locked) return;
          let changed = false;
          const newStrokes = [];
          const eraserLeft = pt.x - p.x - eraserRadius;
          const eraserRight = pt.x - p.x + eraserRadius;
          const eraserTop = pt.y - p.y - eraserRadius;
          const eraserBottom = pt.y - p.y + eraserRadius;

          p.strokes.forEach(s => {
            if (!s.points || s.points.length < 2) { newStrokes.push(s); return; }
            const segments = [];
            let current = [];
            s.points.forEach(sp => {
              const hit = sp.x >= eraserLeft && sp.x <= eraserRight && sp.y >= eraserTop && sp.y <= eraserBottom;
              if (hit) {
                if (current.length >= 2) segments.push(current);
                current = [];
              } else {
                current.push(sp);
              }
            });
            if (current.length >= 2) segments.push(current);
            if (segments.length === 0) { changed = true; return; }
            if (segments.length === 1 && segments[0].length === s.points.length) { newStrokes.push(s); return; }
            changed = true;
            newStrokes.push({ ...s, points: segments[0] });
            for (let i = 1; i < segments.length; i++) newStrokes.push({ ...s, points: segments[i] });
          });
          p.strokes = newStrokes;
          if (changed) { paperLayer.save(); paperLayer.redraw(); }
        });

        // 4. 预览圆圈
        clearPreview();
        previewCtx.save();
        previewCtx.strokeStyle = '#3B82F6';
        previewCtx.lineWidth = 2;
        if (eraserShape === 'square') previewCtx.strokeRect(pt.x - eraserRadius, pt.y - eraserRadius, eraserRadius * 2, eraserRadius * 2);
        else { previewCtx.beginPath(); previewCtx.arc(pt.x, pt.y, eraserRadius, 0, Math.PI * 2); previewCtx.stroke(); }
        previewCtx.restore();
      }

      // --- 画笔逻辑 ---
      else if (drawing === 'pen') {
        // 判断是否在纸上
        let hitPaper = null;
        const paperList = paperLayer.getPapers();
        for (let i = paperList.length - 1; i >= 0; i--) {
          if (paperLayer.hitTest(pt.x, pt.y) === paperList[i]) { hitPaper = paperList[i]; break; }
        }

        if (hitPaper && !hitPaper.locked) {
          // 画在纸上
          if (!hitPaper._currentStroke) hitPaper._currentStroke = { type: 'pen', points: [], color: currentColor, width: currentWidth };
          hitPaper._currentStroke.points.push({ x: pt.x - hitPaper.x, y: pt.y - hitPaper.y, pressure });

          if (!window.__paperPenRaf) {
            window.__paperPenRaf = requestAnimationFrame(() => {
              paperLayer.redraw();
              window.__paperPenRaf = null;
            });
          }
        } else {
          // 画在全局
          const recent = points.slice(-12);
          const scaleFactor = Math.sqrt(W / 800);
          if (e.pointerType === 'pen') drawPressurePath(ctx, recent, currentColor, currentWidth, scaleFactor);
          else drawSmoothCurve(ctx, recent, currentColor, currentWidth, scaleFactor);
        }
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

    // ============ 形状拖动 / 缩放 ============
    if (drawing === 'shape-drag' && shapeDragOffset) {
      shapeDragOffset.move(pt.x - paperLayer.getSelectedShapes()[0].paper.x, pt.y - paperLayer.getSelectedShapes()[0].paper.y);
      return;
    }
    if (drawing === 'shape-resize' && shapeDragOffset) {
      shapeDragOffset.move(pt.x - paperLayer.getSelectedShapes()[0].paper.x, pt.y - paperLayer.getSelectedShapes()[0].paper.y);
      return;
    }

    // 纸张上的形状预览
    if (drawing === 'paper-shape') {
      clearPreview();
      previewCtx.save();
      const p = window.__paperShapeTarget;
      const relX1 = startPt.x - p.x;
      const relY1 = startPt.y - p.y;
      const relX2 = pt.x - p.x;
      const relY2 = pt.y - p.y;
      const bc = window.__paperShapeBorderColor;
      const fc = window.__paperShapeFillColor;
      const lw = window.__paperShapeWidth / Math.sqrt(W / 800);
      const st = window.__paperShapeType;
      // 预览时把坐标加回纸张偏移，画在预览层
      if (st === 'arrow') drawArrow(previewCtx, startPt.x, startPt.y, pt.x, pt.y, bc, lw);
      else if (st === 'rect') {
        if (fc !== 'transparent' && fc !== 'none') {
          previewCtx.fillStyle = fc;
          previewCtx.fillRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
        }
        previewCtx.strokeStyle = bc;
        previewCtx.lineWidth = lw;
        previewCtx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
      }
      else if (st === 'line') {
        previewCtx.strokeStyle = bc; previewCtx.lineWidth = lw;
        previewCtx.beginPath(); previewCtx.moveTo(startPt.x, startPt.y); previewCtx.lineTo(pt.x, pt.y); previewCtx.stroke();
      }
      else if (st === 'wave') drawWave(previewCtx, startPt.x, startPt.y, pt.x, pt.y, bc, lw, window.__paperShapeWave);
      else drawPresetShape(previewCtx, st, startPt.x, startPt.y, pt.x, pt.y, bc, fc, lw);
      previewCtx.restore();
      return;
    }
    if (window.__paperShapeOpacity !== undefined) {
      previewCtx.globalAlpha = window.__paperShapeOpacity;
    }

    // 纸张形状拖动
    if (drawing === 'paper-shape-drag' && window.__paperShapeDrag) {
      const d = window.__paperShapeDrag;
      const p = d.paper;
      const s = d.shape;
      const relX = pt.x - p.x;
      const relY = pt.y - p.y;
      const newX1 = relX - d.dx;
      const newY1 = relY - d.dy;
      const dx = newX1 - d.origX1;
      const dy = newY1 - d.origY1;
      s.x1 = d.origX1 + dx;
      s.y1 = d.origY1 + dy;
      s.x2 = d.origX2 + dx;
      s.y2 = d.origY2 + dy;
      if (!window.__paperShapeDragRaf) {
        window.__paperShapeDragRaf = requestAnimationFrame(() => {
          paperLayer.redraw();
          window.__paperShapeDragRaf = null;
        });
      }
      dirty = true;
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



    if (drawing === 'paper-tape-select') {
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
      // 预览线
      points.push(pt);
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

  canvasWrap.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (window.__panRaf) { cancelAnimationFrame(window.__panRaf); window.__panRaf = null; }

    // 👇 这里不要提前把 drawing 设为 false，必须保留状态，让下面的分支去清空
    if (drawing === 'pinch') { if (pointers.size < 2) drawing = false; return; }
    if (drawing === 'pan') { drawing = false; return; }

    const pt = canvasToImage(e.clientX, e.clientY);

    // ============ 形状拖动 / 缩放结束 ============
    if (drawing === 'shape-drag' || drawing === 'shape-resize') {
      if (shapeDragOffset && shapeDragOffset.end) shapeDragOffset.end();
      shapeDragOffset = null;
      drawing = false;
      updateSubToolbar();
      return;
    }


    // ============ 画笔 / 橡皮 结束 ============
    if (drawing === 'pen' || drawing === 'eraser') {
      // 1. 保存纸张上的笔迹
      paperLayer.getPapers().forEach(p => {
        if (p._currentStroke) {
          if (!p.strokes) p.strokes = [];
          p.strokes.push(p._currentStroke);
          delete p._currentStroke;
        }
      });
      paperLayer.save();
      paperLayer.redraw();
      tapeLayer.redraw();

      drawing = false; // 在这里清空
      clearPreview();

      if (dirty) {
        if (typeof setSaveStatus === 'function') setSaveStatus('saving');
        saveAll(false).then(() => {
          if (typeof setSaveStatus === 'function') setSaveStatus('saved');
        }).catch(() => { });
      }
      return;
    }

    // ... 下面保留你原来的圈擦、形状、胶带等结束逻辑 ...

    // ============ 圈擦 结束 ============
    if (drawing === 'circle-erase') {
      if (eraseShape === 'rect') {
        eraseRect(ctx, startPt.x, startPt.y, pt.x, pt.y);
        eraseRect(paperStrokeCtx, startPt.x, startPt.y, pt.x, pt.y);
      } else if (eraseShape === 'circle') {
        const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
        eraseCircle(ctx, startPt.x, startPt.y, r);
        eraseCircle(paperStrokeCtx, startPt.x, startPt.y, r);
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
      }

      if (eraseShape === 'rect') {
        const minX = Math.min(startPt.x, pt.x);
        const maxX = Math.max(startPt.x, pt.x);
        const minY = Math.min(startPt.y, pt.y);
        const maxY = Math.max(startPt.y, pt.y);
        for (let x = minX; x <= maxX; x += 10) {
          for (let y = minY; y <= maxY; y += 10) {
            tapeLayer.eraseAt(x, y, 15);
          }
        }
      } else if (eraseShape === 'circle') {
        const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
        for (let x = startPt.x - r; x <= startPt.x + r; x += 10) {
          for (let y = startPt.y - r; y <= startPt.y + r; y += 10) {
            if (Math.hypot(x - startPt.x, y - startPt.y) <= r) tapeLayer.eraseAt(x, y, 15);
          }
        }
      } else if (eraseShape === 'free' && eraseFreePath && eraseFreePath.length > 2) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        eraseFreePath.forEach(p => {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        for (let x = minX; x <= maxX; x += 10) {
          for (let y = minY; y <= maxY; y += 10) {
            if (isPointInPolygon(x, y, eraseFreePath)) tapeLayer.eraseAt(x, y, 15);
          }
        }
      }

      paperLayer.getPapers().forEach(p => {
        if (!p.strokes || p.locked) return;
        let changed = false;
        const newStrokes = [];
        p.strokes.forEach(s => {
          if (!s.points || s.points.length < 2) { newStrokes.push(s); return; }
          const segments = [];
          let current = [];
          for (let i = 0; i < s.points.length - 1; i++) {
            const a = s.points[i];
            const b = s.points[i + 1];
            const segLen = Math.hypot(b.x - a.x, b.y - a.y);
            const steps = Math.max(1, Math.ceil(segLen / 2));
            for (let j = 0; j <= steps; j++) {
              const t = j / steps;
              const sp = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
              const sx = sp.x + p.x;
              const sy = sp.y + p.y;
              let hit = false;
              if (eraseShape === 'rect') {
                const minX = Math.min(startPt.x, pt.x);
                const maxX = Math.max(startPt.x, pt.x);
                const minY = Math.min(startPt.y, pt.y);
                const maxY = Math.max(startPt.y, pt.y);
                hit = sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
              } else if (eraseShape === 'circle') {
                const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
                hit = Math.hypot(sx - startPt.x, sy - startPt.y) <= r;
              } else if (eraseShape === 'free' && eraseFreePath && eraseFreePath.length > 2) {
                hit = isPointInPolygon(sx, sy, eraseFreePath);
              }
              if (hit) {
                if (current.length >= 2) segments.push(current);
                current = [];
              } else {
                current.push(sp);
              }
            }
          }
          if (current.length >= 2) segments.push(current);
          if (segments.length === 0) { changed = true; return; }
          if (segments.length === 1 && segments[0].length === s.points.length) { newStrokes.push(s); return; }
          changed = true;
          newStrokes.push({ ...s, points: segments[0] });
          for (let i = 1; i < segments.length; i++) newStrokes.push({ ...s, points: segments[i] });
        });
        p.strokes = newStrokes;
        if (changed) { paperLayer.save(); paperLayer.redraw(); }
      });
      eraseFreePath = null;
      clearPreview();
      drawing = false;
      return;
    }

    // ============ 纸张形状拖动结束 ============
    if (drawing === 'paper-shape-drag') {
      if (window.__paperShapeDragRaf) { cancelAnimationFrame(window.__paperShapeDragRaf); window.__paperShapeDragRaf = null; }
      if (window.__paperShapeDrag) {
        window.__paperShapeDrag.paper && paperLayer.save();
        window.__paperShapeDrag = null;
      }
      drawing = false;
      return;
    }

    // ============ 纸张上的形状保存 ============
    if (drawing === 'paper-shape') {
      clearPreview();
      const p = window.__paperShapeTarget;
      if (p) {
        const relX1 = startPt.x - p.x;
        const relY1 = startPt.y - p.y;
        const relX2 = pt.x - p.x;
        const relY2 = pt.y - p.y;
        if (!p.shapes) p.shapes = [];
        p.shapes.push({
          id: crypto.randomUUID(),
          type: window.__paperShapeType,
          x1: relX1, y1: relY1, x2: relX2, y2: relY2,
          borderColor: window.__paperShapeBorderColor,
          fillColor: window.__paperShapeFillColor,
          width: window.__paperShapeWidth,
          waveAmplitude: window.__paperShapeWave,
          visible: true,
          locked: false,
        });
        paperLayer.save();
        paperLayer.redraw();
      }
      drawing = false;
      dirty = true;
      return;
    }

    // ============ 全局图形保存 ============
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

    // ============ 全局胶带拖动结束 ============
    if (drawing === 'tape-drag' || drawing === 'tape-rotate') {
      if (tapeDragOffset && tapeDragOffset.end) tapeDragOffset.end();
      drawing = false;
      tapeDragOffset = null;
      return;
    }

    // ============ 全局胶带框选结束 ============
    if (drawing === 'tape-select') {
      clearPreview();
      const pt2 = canvasToImage(e.clientX, e.clientY);
      const w = Math.abs(pt2.x - startPt.x);
      const h = Math.abs(pt2.y - startPt.y);
      if (w > 10 && h > 10) {
        tapeLayer.selectInRect(startPt.x, startPt.y, pt2.x, pt2.y);
        const count = tapeLayer.getSelectedIds().length;
        if (count > 0) toastSuccess(`已选中 ${count} 条胶带`);
      }
      tapeSelectMode = false;
      drawing = false;
      startPt = null;
      points = [];
      updateSubToolbar();
      return;
    }

    // ============ 纸张胶带框选结束 ============
    if (drawing === 'paper-tape-select') {
      clearPreview();
      const pt2 = canvasToImage(e.clientX, e.clientY);
      const x1 = Math.min(startPt.x, pt2.x);
      const x2 = Math.max(startPt.x, pt2.x);
      const y1 = Math.min(startPt.y, pt2.y);
      const y2 = Math.max(startPt.y, pt2.y);
      const w = x2 - x1;
      const h = y2 - y1;

      if (w > 10 && h > 10) {
        paperLayer.getPapers().forEach(p => {
          if (!p.tapes || p.visible === false) return;
          p.tapes.forEach(t => {
            if (t.visible === false) return;
            if (!t.points || t.points.length < 2) return;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            t.points.forEach(pt3 => {
              minX = Math.min(minX, pt3.x + p.x);
              maxX = Math.max(maxX, pt3.x + p.x);
              minY = Math.min(minY, pt3.y + p.y);
              maxY = Math.max(maxY, pt3.y + p.y);
            });
            if (maxX >= x1 && minX <= x2 && maxY >= y1 && minY <= y2) {
              if (!paperTapeSelectedList.find(item => item.tape.id === t.id)) {
                paperTapeSelectedList.push({ paper: p, tape: t });
              }
            }
          });
        });
        window.__paperTapeSelectedList = paperTapeSelectedList;
        if (paperTapeSelectedList.length > 0) {
          paperTapeSelected = paperTapeSelectedList[0];
          toastSuccess(`已选中 ${paperTapeSelectedList.length} 条纸张胶带`);
        } else {
          toastError('没有选中任何胶带');
        }
        paperLayer.redraw();
      }

      paperTapeSelectMode = false;
      drawing = false;
      startPt = null;
      points = [];
      updateSubToolbar();
      return;
    }

    // ============ 纸张上画胶带结束 ============
    if (drawing === 'paper-tape') {
      clearPreview();
      const hitPaper = paperLayer.getPapers().find(p => p._currentTape);
      if (hitPaper && hitPaper._currentTape.points.length >= 2) {
        const p = hitPaper;
        const globalPoints = p._currentTape.points.map(pt => {
          let x = pt.x + p.x;
          let y = pt.y + p.y;
          if (p.rotation) {
            const rad = p.rotation * Math.PI / 180;
            const cx = p.x + p.w / 2;
            const cy = p.y + p.h / 2;
            const dx = x - cx; const dy = y - cy;
            x = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
            y = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
          }
          return { x, y };
        });

        tapeLayer.getTapes().push({
          ...p._currentTape,
          id: crypto.randomUUID(),
          points: globalPoints,
          _boundPaperId: p.id,
          visible: true,
        });

        store.saveTape(imageId, tapeLayer.getTapes());
        tapeLayer.redrawAsync();
      }
      if (hitPaper) delete hitPaper._currentTape;
      drawing = false;
      points = [];
      return;
    }

    // ============ 全局胶带画完结束 ============
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

    // ============ 文字缩放/旋转结束 ============
    if (drawing === 'text-resize' || drawing === 'text-rotate') {
      if (textDragOffset && textDragOffset._raf) { cancelAnimationFrame(textDragOffset._raf); textDragOffset._raf = null; }
      if (textDragOffset && textDragOffset.end) textDragOffset.end();
      clearPreview();
      drawing = false;
      textDragOffset = null;
      return;
    }

    // ============ 文字拖动结束 ============
    if (drawing === 'text-drag') {
      clearPreview();
      if (textDragOffset && textDragOffset._raf) { cancelAnimationFrame(textDragOffset._raf); textDragOffset._raf = null; }
      textLayer.save();
      drawing = false;
      textDragOffset = null;
    }

    // ============ 纸张缩放/旋转结束 ============
    if (drawing === 'paper-resize' || drawing === 'paper-rotate') {
      if (paperDragOffset && paperDragOffset.end) paperDragOffset.end();
      drawing = false;
      paperDragOffset = null;
      updateSubToolbar();
      return;
    }

    // ============ 纸张拖动结束 ============
    if (drawing === 'paper-drag') {
      clearPreview(); // 清除辅助线
      if (paperDragOffset && paperDragOffset._raf) {
        cancelAnimationFrame(paperDragOffset._raf);
        paperDragOffset._raf = null;
      }
      if (paperDragOffset && paperDragOffset.paper) {
        paperLayer.save(); // 保存纸张坐标
      }
      store.saveTape(imageId, tapeLayer.getTapes());

      drawing = false; // 核心：结束拖动状态
      paperDragOffset = null;
      updateSubToolbar();
      return;
    }

    // ============ 每次操作结束，自动保存 ============
    if (dirty) {
      if (typeof setSaveStatus === 'function') setSaveStatus('saving');
      saveAll(false).then(() => {
        if (typeof setSaveStatus === 'function') setSaveStatus('saved');
      }).catch(() => {
        if (typeof setSaveStatus === 'function') setSaveStatus('error');
      });
    }
  });

  canvasWrap.addEventListener('pointercancel', (e) => {
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
    paperDragOffset = null;
    textDragOffset = null;
    tapeDragOffset = null;
    shapeDragOffset = null;
    if (shapeSelectTimer) { clearTimeout(shapeSelectTimer); shapeSelectTimer = null; }
  });

  // ============ 鼠标滚轮缩放（绑定到最外层容器） ============
  canvasWrap.addEventListener('wheel', (e) => {
    // 阻止页面滚动
    e.preventDefault();

    // 使用 Ctrl + 滚轮，或者直接滚轮都可以缩放（如果你想直接滚轮缩放，去掉 e.ctrlKey 的判断即可）
    const rect = strokeCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // 计算缩放比例
    const delta = -e.deltaY * 0.002;
    const newScale = Math.max(0.3, Math.min(10, scale * (1 + delta)));

    // 以鼠标位置为中心进行缩放
    offsetX -= mx * (newScale / scale - 1);
    offsetY -= my * (newScale / scale - 1);

    scale = newScale;
    updateTransform();
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