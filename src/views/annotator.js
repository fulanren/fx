// ============================================================
// annotator.js — 图片标注页
// 功能：画笔、橡皮、圈擦、文字、箭头、矩形、直线、波浪、
//       胶带、纸张、抓手、扩展画布、图层顺序、撤销、保存
// 依赖：canvas 工具、胶带层、纸张层、文字层、颜色选择器
// ============================================================

import { el, clear } from '../utils/dom.js';
import { dbGet, putImageCached } from '../db.js';
import { toastError, toastSuccess } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { goBack } from '../router.js';
import * as store from '../store.js';
import { uuid } from '../utils/id.js';
import {
  drawArrow, drawLine, drawRect, drawWave,
  eraseCircle, eraseRect, drawSmoothPath,
} from '../utils/canvas.js';
import { createTapeLayer, renderTapeToolbar } from './annotatorTape.js';
import { createPaperLayer } from './annotatorPaper.js';
import { createTextLayer } from './annotatorText.js';
import { renderColorPicker } from '../ui/colorPicker.js';

// 预设颜色
const COLORS = ['#EF476F', '#F78C6B', '#FFD166', '#06D6A0', '#118AB2', '#073B4C', '#2B2D42', '#FFFFFF'];

// 工具栏定义
const TOOLS = [
  { id: 'pen', label: '✏️', name: '画笔' },
  { id: 'eraser', label: '🧽', name: '橡皮' },
  { id: 'circle-erase', label: '⭕', name: '圈擦' },
  { id: 'text', label: 'T', name: '文字' },
  { id: 'arrow', label: '↗', name: '箭头' },
  { id: 'rect', label: '▭', name: '矩形' },
  { id: 'line', label: '—', name: '直线' },
  { id: 'wave', label: '〰️', name: '波浪' },
  { id: 'tape', label: '🎗️', name: '胶带' },
  { id: 'paper', label: '📄', name: '纸张' },
  { id: 'hand', label: '✋', name: '抓手' },
];

// 默认图层顺序（从下到上）
const DEFAULT_LAYER_ORDER = ['base', 'stroke', 'paper', 'paperStroke', 'text', 'tape'];

// 入口函数：渲染标注页
export function renderAnnotator({ params, query }) {
  // 清理上一次标注页的残留（事件监听、定时器、浮动元素）
  if (window.__annotatorCleanup) window.__annotatorCleanup();

  const imageId = params.id;
  const pointId = query.pointId;
  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = '标注';
  document.getElementById('btn-back').classList.remove('hidden');

  // 返回按钮：有未保存修改时弹确认框
  const origBack = document.getElementById('btn-back').onclick;
  document.getElementById('btn-back').onclick = async () => {
    if (dirty) {
      const r = await confirmBox({
        title: '未保存', message: '有未保存的修改，确定离开？',
        confirmText: '离开', cancelText: '留下', danger: true,
      });
      if (!r) return;
    }
    await saveAll(false);
    document.getElementById('btn-back').onclick = origBack || (() => history.back());
    document.getElementById('page-title').textContent = '背诵';
    document.getElementById('btn-back').classList.add('hidden');
    goBack();
  };

  // 从 IndexedDB 读取图片记录
  dbGet('images', imageId).then(async img => {
    if (!img) { toastError('图片不存在'); goBack(); return; }
    const W = img.width, H = img.height;
    view.innerHTML = '';

    // 后续所有画布、图层、工具栏、手势都在这段内部
    // ========== 画布和图层 ==========
    let scale = 1, offsetX = 0, offsetY = 0;

    // 外层容器，支持 transform 缩放和平移
    const canvasWrap = el('div', {
      class: 'annotator-wrap',
      style: {
        position: 'relative', margin: '0 auto',
        touchAction: 'none', userSelect: 'none',
        width: W + 'px', height: H + 'px',
      },
    });
    view.appendChild(canvasWrap);

    // 底图（显示合并后的图）
    let baseImg = null;
    const base = el('img', {
      style: { display: 'block', width: '100%', height: '100%', userSelect: 'none', pointerEvents: 'none' },
    });
    const blobForDisplay = img.annotatedBlob || img.originalBlob || img.blob;
    const urlDisplay = URL.createObjectURL(blobForDisplay);
    base.src = urlDisplay;
    await new Promise(r => { base.onload = r; });
    baseImg = base;
    canvasWrap.appendChild(base);

    // 笔迹层（画笔、图形、橡皮、圈擦）
    const strokeCanvas = el('canvas', {
      class: 'stroke-canvas',
      style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', touchAction: 'none', zIndex: '1' },
    });
    strokeCanvas.width = W; strokeCanvas.height = H;
    canvasWrap.appendChild(strokeCanvas);
    const ctx = strokeCanvas.getContext('2d', { willReadFrequently: true });

    // 恢复上次的笔迹
    if (img.strokeBlob) {
      const su = URL.createObjectURL(img.strokeBlob);
      const simg = new Image();
      simg.src = su;
      await new Promise(r => { simg.onload = r; });
      ctx.drawImage(simg, 0, 0);
      URL.revokeObjectURL(su);
    }

    // 纸张笔迹层（纸张上的笔迹，独立图层）
    const paperStrokeCanvas = el('canvas', {
      class: 'paper-stroke-canvas',
      style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2' },
    });
    paperStrokeCanvas.width = W; paperStrokeCanvas.height = H;
    canvasWrap.appendChild(paperStrokeCanvas);
    const paperStrokeCtx = paperStrokeCanvas.getContext('2d', { willReadFrequently: true });

    if (img.paperStrokeBlob) {
      const psu = URL.createObjectURL(img.paperStrokeBlob);
      const psimg = new Image();
      psimg.src = psu;
      await new Promise(r => { psimg.onload = r; });
      paperStrokeCtx.drawImage(psimg, 0, 0);
      URL.revokeObjectURL(psu);
    }

    // 文字层（独立文字对象）
    const textCanvas = el('canvas', {
      class: 'text-canvas',
      style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '3' },
    });
    textCanvas.width = W; textCanvas.height = H;
    canvasWrap.appendChild(textCanvas);
    const textCtx = textCanvas.getContext('2d');
    const textLayer = createTextLayer(textCanvas, W, H, imageId);

    // 纸张层（便签、便利贴、横线纸等）
    const paperCanvas = el('canvas', {
      class: 'paper-canvas',
      style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4' },
    });
    paperCanvas.width = W; paperCanvas.height = H;
    canvasWrap.appendChild(paperCanvas);
    const paperLayer = createPaperLayer(paperCanvas, W, H, imageId, paperStrokeCtx);

    // 胶带层（记忆胶带，盖在笔迹之上）
    const tapeCanvas = el('canvas', {
      class: 'tape-canvas',
      style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '5' },
    });
    tapeCanvas.width = W; tapeCanvas.height = H;
    canvasWrap.appendChild(tapeCanvas);
    const tapeLayer = createTapeLayer(tapeCanvas, W, H, imageId);

    // 预览层（橡皮预览圈、图形预览）
    const previewCanvas = el('canvas', {
      class: 'preview-canvas',
      style: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '6' },
    });
    previewCanvas.width = W; previewCanvas.height = H;
    canvasWrap.appendChild(previewCanvas);
    const previewCtx = previewCanvas.getContext('2d');

    // 图层顺序管理
    const layerMap = {
      base, stroke: strokeCanvas, text: textCanvas,
      paper: paperCanvas, paperStroke: paperStrokeCanvas, tape: tapeCanvas,
    };
    let currentLayerOrder = store.getLayerOrder && store.getLayerOrder()
      ? [...store.getLayerOrder()]
      : [...DEFAULT_LAYER_ORDER];

    // 应用图层顺序：清空后按顺序重新 append
    function applyLayerOrder(order) {
      const previewEl = previewCanvas;
      [...canvasWrap.children].forEach(child => {
        if (child !== previewEl) canvasWrap.removeChild(child);
      });
      order.forEach(key => { if (layerMap[key]) canvasWrap.appendChild(layerMap[key]); });
      canvasWrap.appendChild(previewEl);
    }
    applyLayerOrder(currentLayerOrder);

    // 更新缩放比例显示
    function updateTransform() {
      canvasWrap.style.transform = `scale(${scale}) translate(${offsetX}px, ${offsetY}px)`;
      canvasWrap.style.transformOrigin = '0 0';
      const zoomEl = document.getElementById('zoom-level');
      if (zoomEl) zoomEl.textContent = Math.round(scale * 100) + '%';
    }

    // 屏幕坐标转图片坐标
    function canvasToImage(clientX, clientY) {
      const rect = strokeCanvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / rect.width * W,
        y: (clientY - rect.top) / rect.height * H,
      };
    }

    // 清空预览层
    function clearPreview() { previewCtx.clearRect(0, 0, W, H); }
    // ========== 工具栏状态 ==========
    let currentTool = 'pen';       // 当前工具
    let currentColor = COLORS[0];  // 当前颜色
    let currentWidth = 3;          // 当前粗细
    let eraseShape = 'free';       // 圈擦形状：free/rect/circle
    let waveAmplitude = 8;         // 波浪波幅
    let penOnly = false;           // 仅触控笔模式
    let dirty = false;             // 是否有未保存修改
    let drawing = false;           // 是否正在绘制
    let points = [];               // 当前笔迹点
    let startPt = null;            // 起始点（图形工具用）
    let eraseFreePath = null;      // 自由圈擦路径
    let paperDragOffset = null;    // 纸张/文字拖动偏移
    // 各工具记住自己的粗细
    const toolWidths = { pen: 3, eraser: 30, 'circle-erase': 40, arrow: 3, rect: 3, line: 3, wave: 3 };

    // 主工具栏
    const toolBar = el('div', { class: 'annotator-toolbar' });
    TOOLS.forEach(t => {
      toolBar.appendChild(el('button', {
        class: 'tool-btn' + (t.id === 'pen' ? ' active' : ''),
        'data-tool': t.id,
        text: t.label,
        title: t.name,
        onClick: () => setActiveTool(t.id),
      }));
    });

    // 颜色条（用颜色选择器）
    const colorBar = el('div', { class: 'annotator-colorbar' });
    const colorPickerWrap = el('div', { class: 'color-picker' });
    colorBar.appendChild(colorPickerWrap);
    function renderColorBar() {
      colorPickerWrap.innerHTML = '';
      colorPickerWrap.appendChild(renderColorPicker({
        current: currentColor,
        onChange: (c) => { currentColor = c; },
      }));
    }
    renderColorBar();

    // 粗细行：滑块 + − 数字 +
    const widthNum = el('input', {
      type: 'number', min: '1', max: '100', value: String(currentWidth),
      style: { width: '48px', padding: '4px 6px', fontSize: '13px', textAlign: 'center' },
      onInput: (e) => {
        const v = Math.max(1, Math.min(100, Number(e.target.value) || 1));
        currentWidth = v;
        if (currentTool in toolWidths) toolWidths[currentTool] = v;
        widthRange.value = v;
      },
    });
    const widthRange = el('input', {
      type: 'range', min: '1', max: '100', value: String(currentWidth),
      style: { flex: '1' },
      onInput: (e) => {
        const v = Number(e.target.value);
        currentWidth = v;
        if (currentTool in toolWidths) toolWidths[currentTool] = v;
        widthNum.value = v;
      },
    });
    const widthMinus = el('button', {
      class: 'btn btn-sm btn-ghost', text: '−',
      style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
      onClick: () => {
        const v = Math.max(1, currentWidth - 1);
        currentWidth = v;
        if (currentTool in toolWidths) toolWidths[currentTool] = v;
        widthRange.value = v; widthNum.value = v;
      },
    });
    const widthPlus = el('button', {
      class: 'btn btn-sm btn-ghost', text: '+',
      style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
      onClick: () => {
        const v = Math.min(100, currentWidth + 1);
        currentWidth = v;
        if (currentTool in toolWidths) toolWidths[currentTool] = v;
        widthRange.value = v; widthNum.value = v;
      },
    });
    const widthRow = el('div', { class: 'annotator-widthrow' }, [
      el('span', { text: '粗细', style: { fontSize: '13px', color: 'var(--text-2)' } }),
      widthRange, widthMinus, widthNum, widthPlus,
    ]);

    // 子工具栏（胶带、纸张、圈擦形状、波浪波幅、矩形边框/填充、文字操作）
    const subBar = el('div', { class: 'sub-toolbar' });

        // 防触控开关
        const penOnlyBtn = el('button', {
          class: 'btn btn-sm ' + (penOnly ? 'btn-primary' : 'btn-ghost'),
          text: penOnly ? '✍️ 防触控已开启' : '✍️ 防触控已关闭',
          title: '开启后，手指不绘制，只能用触控笔画',
          style: { fontSize: '12px', padding: '4px 10px', borderRadius: '10px' },
          onClick: (e) => {
            penOnly = !penOnly;
            e.target.textContent = penOnly ? '✍️ 防触控已开启' : '✍️ 防触控已关闭';
            e.target.classList.toggle('btn-primary', penOnly);
            e.target.classList.toggle('btn-ghost', !penOnly);
          },
        });

    // 底部统一容器，从下往上：主工具栏 → 颜色 → 粗细 → 子工具栏
    const bottomBar = el('div', { class: 'annotator-bottom-bar' });
    bottomBar.appendChild(subBar);
    bottomBar.appendChild(widthRow);
    bottomBar.appendChild(colorBar);
    bottomBar.appendChild(toolBar);
    bottomBar.appendChild(penOnlyBtn);
    view.appendChild(bottomBar);

    // 切换工具
    function setActiveTool(id) {
      const prev = currentTool;
      if (prev in toolWidths) toolWidths[prev] = currentWidth;
      currentTool = id;
      currentWidth = (id in toolWidths) ? toolWidths[id] : 3;
      widthNum.value = currentWidth;
      widthRange.value = currentWidth;
      document.querySelectorAll('.tool-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === id);
      });
      updateSubToolbar();
    }

    // 更新子工具栏内容
    function updateSubToolbar() {
      subBar.innerHTML = '';
      if (currentTool === 'tape') {
        subBar.appendChild(renderTapeToolbar(tapeLayer));
      } else if (currentTool === 'paper') {
        import('./annotatorPaper.js').then(({ renderPaperToolbar }) => {
          subBar.innerHTML = '';
          subBar.appendChild(renderPaperToolbar(paperLayer));
        });
      } else if (currentTool === 'circle-erase') {
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '形状' }),
          ...['free', 'rect', 'circle'].map(s => el('button', {
            class: 'tape-chip' + (eraseShape === s ? ' active' : ''),
            text: s === 'free' ? '自由' : s === 'rect' ? '矩形' : '圆形',
            onClick: (ev) => {
              eraseShape = s;
              subBar.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
              ev.target.classList.add('active');
            },
          })),
        ]));
      } else if (currentTool === 'wave') {
        const waveNum = el('input', {
          type: 'number', min: '2', max: '30', value: String(waveAmplitude),
          style: { width: '48px', padding: '4px 6px', fontSize: '13px', textAlign: 'center' },
          onInput: (e) => {
            const v = Math.max(2, Math.min(30, Number(e.target.value) || 8));
            waveAmplitude = v;
            waveRange.value = v;
          },
        });
        const waveRange = el('input', {
          type: 'range', min: '2', max: '30', value: String(waveAmplitude),
          style: { flex: '1' },
          onInput: (e) => {
            const v = Number(e.target.value);
            waveAmplitude = v;
            waveNum.value = v;
          },
        });
        const waveMinus = el('button', {
          class: 'btn btn-sm btn-ghost', text: '−',
          style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
          onClick: () => { waveAmplitude = Math.max(2, waveAmplitude - 1); waveRange.value = waveAmplitude; waveNum.value = waveAmplitude; },
        });
        const wavePlus = el('button', {
          class: 'btn btn-sm btn-ghost', text: '+',
          style: { minWidth: '24px', padding: '0 4px', fontSize: '14px' },
          onClick: () => { waveAmplitude = Math.min(30, waveAmplitude + 1); waveRange.value = waveAmplitude; waveNum.value = waveAmplitude; },
        });
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '波幅' }),
          waveRange, waveMinus, waveNum, wavePlus,
        ]));
      } else if (currentTool === 'rect') {
        const borderPicker = renderColorPicker({
          current: currentColor,
          onChange: (c) => { window.__rectBorderColor = c; },
        });
        const fillPicker = renderColorPicker({
          current: 'none',
          onChange: (c) => { window.__rectFillColor = c; },
          allowNone: true,
        });
        window.__rectBorderColor = currentColor;
        window.__rectFillColor = 'none';
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '边框' }), borderPicker,
        ]));
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('span', { class: 'tape-label', text: '填充' }), fillPicker,
        ]));
      } else if (currentTool === 'text') {
        const sel = textLayer.getSelected();
        if (sel) {
          subBar.appendChild(el('div', { class: 'tape-row' }, [
            el('button', { class: 'btn btn-sm btn-primary', text: '✏️ 编辑', onClick: () => openTextObjectEditor(sel) }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => {
                const copy = { ...sel, id: crypto.randomUUID(), x: sel.x + 20, y: sel.y + 20 };
                textLayer.getItems().push(copy);
                textLayer.save();
                textLayer.redraw();
                updateSubToolbar();
              }
            }),
            el('button', {
              class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: () => {
                pushUndo(true);
                textLayer.removeSelected();
                updateSubToolbar();
              }
            }),
          ]));
        }
      }
    }

    // 提示文字
    const hint = el('div', { class: 'annotator-hint', text: '触控笔/鼠标可直接画；手指按住拖动可平移，双指缩放' });
    view.appendChild(hint);

    // 缩放比例显示
    const zoomBadge = el('div', { id: 'zoom-level', class: 'annotator-zoom', text: '100%' });
    view.appendChild(zoomBadge);

    // 顶栏动态按钮
    const dynBar = document.getElementById('topbar-dynamic');
    if (dynBar) {
      dynBar.innerHTML = '';
      const mk = (txt, title, fn) => el('button', { class: 'btn btn-sm btn-ghost', text: txt, title, onClick: fn });
      dynBar.appendChild(mk('←', '左移', () => { offsetX += 40; updateTransform(); }));
      dynBar.appendChild(mk('→', '右移', () => { offsetX -= 40; updateTransform(); }));
      dynBar.appendChild(mk('↑', '上移', () => { offsetY += 40; updateTransform(); }));
      dynBar.appendChild(mk('↓', '下移', () => { offsetY -= 40; updateTransform(); }));
      dynBar.appendChild(mk('🔍+', '放大', () => { scale = Math.min(10, scale * 1.25); updateTransform(); }));
      dynBar.appendChild(mk('🔍-', '缩小', () => { scale = Math.max(0.3, scale / 1.25); updateTransform(); }));
      dynBar.appendChild(mk('1:1', '原始大小', () => { scale = 1; offsetX = 0; offsetY = 0; updateTransform(); }));
      dynBar.appendChild(mk('↶', '撤销', undo));
      dynBar.appendChild(mk('🗑', '清除', clearAll));
      dynBar.appendChild(mk('➕', '扩展画布', openExpandDialog));
      dynBar.appendChild(mk('📚', '图层顺序', openLayerPanel));
      dynBar.appendChild(mk('💾', '保存', () => saveAll(true)));
    }
    // ========== 手势处理 ==========
    const pointers = new Map();   // 当前屏幕上的手指
    let pinchDist = 0;            // 双指初始距离
    let pinchScale = 1;           // 双指初始缩放
    let pinchCx = 0, pinchCy = 0; // 双指中心

    strokeCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();

      // 防触控：手指不绘制，但双指缩放和抓手不受限制
      if (penOnly && e.pointerType === 'touch' && currentTool !== 'hand') {
        if (pointers.size === 0) {
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          return;
        }
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      strokeCanvas.setPointerCapture(e.pointerId);

      // 双指：进入缩放
      if (pointers.size === 2) {
        drawing = false;
        points = [];
        clearPreview();
        const pts = [...pointers.values()];
        pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchScale = scale;
        pinchCx = (pts[0].x + pts[1].x) / 2;
        pinchCy = (pts[0].y + pts[1].y) / 2;
        return;
      }

      const pt = canvasToImage(e.clientX, e.clientY);

      // 抓手工具：平移
      if (currentTool === 'hand') {
        drawing = 'pan';
        startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
        return;
      }

      // 画笔/橡皮
      if (currentTool === 'pen' || currentTool === 'eraser') {
        const rect = strokeCanvas.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;
        const edge = 0.15;
        const isEdge = relX < edge || relX > 1 - edge || relY < edge || relY > 1 - edge;
        // 手指在边缘 → 平移；触控笔始终绘制
        if (isEdge && e.pointerType !== 'pen') {
          drawing = 'pan';
          startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
          return;
        }
        pushUndo();
        drawing = true;
        points = [pt];
        // 橡皮：点一下擦一个圆
        if (currentTool === 'eraser') {
          eraseCircle(ctx, pt.x, pt.y, currentWidth * 2);
          eraseCircle(paperStrokeCtx, pt.x, pt.y, currentWidth * 2);
          tapeLayer.eraseAt(pt.x, pt.y, currentWidth * 2);
        }
      } else if (currentTool === 'circle-erase') {
        pushUndo();
        drawing = true;
        startPt = pt;
        if (eraseShape === 'free') eraseFreePath = [pt];
      } else if (currentTool === 'text') {
        // 文字工具：先判断是否点中控制点，再判断是否点中文字，都没点中才新建
        const sel = textLayer.getSelected();
        if (sel) {
          const handles = [
            { id: 'nw', x: sel.x, y: sel.y },
            { id: 'ne', x: sel.x + sel.w, y: sel.y },
            { id: 'sw', x: sel.x, y: sel.y + sel.h },
            { id: 'se', x: sel.x + sel.w, y: sel.y + sel.h },
          ];
          const hitHandle = handles.find(h => Math.hypot(pt.x - h.x, pt.y - h.y) < 12);
          if (hitHandle) {
            paperDragOffset = textLayer.startResize(hitHandle.id, pt.x, pt.y);
            drawing = 'text-resize';
            return;
          }
        }
        const hit = textLayer.hitTest(pt.x, pt.y);
        if (hit) {
          textLayer.select(hit);
          updateSubToolbar();
          paperDragOffset = { dx: pt.x - hit.x, dy: pt.y - hit.y, _moved: false };
          drawing = 'text-drag';
          return;
        }
        // 没点中 → 新建文字
        openTextEditor(pt);
        drawing = false;
        return;
      } else if (currentTool === 'tape' || currentTool === 'paper') {
        // 纸张工具：命中纸张 → 选中/拖动/调整大小
        if (currentTool === 'paper') {
          const hit = paperLayer.hitTest(pt.x, pt.y);
          if (hit) {
            const sel = paperLayer.getSelected();
            if (sel && sel.id === hit.id) {
              const handles = [
                { id: 'nw', x: sel.x, y: sel.y },
                { id: 'ne', x: sel.x + sel.w, y: sel.y },
                { id: 'sw', x: sel.x, y: sel.y + sel.h },
                { id: 'se', x: sel.x + sel.w, y: sel.y + sel.h },
              ];
              const hitHandle = handles.find(h => Math.hypot(pt.x - h.x, pt.y - h.y) < 12);
              if (hitHandle) {
                paperDragOffset = paperLayer.startResize(hitHandle.id, pt.x, pt.y);
                drawing = 'paper-resize';
                return;
              }
            }
            paperLayer.select(hit);
            updateSubToolbar();
            paperDragOffset = { paper: hit, dx: pt.x - hit.x, dy: pt.y - hit.y, _moved: false };
            drawing = 'paper-drag';
            return;
          }
          paperLayer.select(null);
          updateSubToolbar();
        }
        // 胶带工具：开始画胶带
        if (currentTool === 'tape') {
          drawing = true;
          points = [pt];
          pushUndo();
        }
      } else {
        // 图形工具：记录起始点
        pushUndo();
        drawing = true;
        startPt = pt;
      }
    });

    strokeCanvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 双指缩放
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist > 0) {
          scale = Math.max(0.3, Math.min(10, pinchScale * (dist / pinchDist)));
          updateTransform();
        }
        return;
      }

      // 平移
      if (drawing === 'pan') {
        offsetX = e.clientX - startPt.x;
        offsetY = e.clientY - startPt.y;
        if (!window.__panRaf) {
          window.__panRaf = requestAnimationFrame(() => {
            updateTransform();
            window.__panRaf = null;
          });
        }
        return;
      }

      const pt = canvasToImage(e.clientX, e.clientY);

      // 纸张拖动
      if (drawing === 'paper-drag') {
        if (paperDragOffset) {
          paperDragOffset.paper.x = pt.x - paperDragOffset.dx;
          paperDragOffset.paper.y = pt.y - paperDragOffset.dy;
          paperDragOffset._moved = true;
          if (!paperDragOffset._raf) {
            paperDragOffset._raf = requestAnimationFrame(() => {
              paperLayer.redraw();
              paperDragOffset._raf = null;
            });
          }
          dirty = true;
        }
        return;
      }
      // 纸张调整大小
      if (drawing === 'paper-resize') {
        if (paperDragOffset) paperDragOffset.move(pt.x, pt.y);
        dirty = true;
        return;
      }
      // 文字拖动
      if (drawing === 'text-drag') {
        const sel = textLayer.getSelected();
        if (sel) {
          sel.x = pt.x - paperDragOffset.dx;
          sel.y = pt.y - paperDragOffset.dy;
          paperDragOffset._moved = true;
          if (!paperDragOffset._raf) {
            paperDragOffset._raf = requestAnimationFrame(() => {
              textLayer.redraw();
              paperDragOffset._raf = null;
            });
          }
          dirty = true;
        }
        return;
      }
      // 文字调整大小
      if (drawing === 'text-resize') {
        if (paperDragOffset) paperDragOffset.move(pt.x, pt.y);
        dirty = true;
        return;
      }

      // 未按下：橡皮/圈擦预览
      if (!drawing) {
        if (currentTool === 'eraser') {
          clearPreview();
          previewCtx.save();
          previewCtx.strokeStyle = 'rgba(59,130,246,.8)';
          previewCtx.lineWidth = 2;
          previewCtx.beginPath();
          previewCtx.arc(pt.x, pt.y, currentWidth * 2, 0, Math.PI * 2);
          previewCtx.stroke();
          previewCtx.restore();
        } else if (currentTool === 'circle-erase') {
          clearPreview();
          previewCtx.save();
          previewCtx.strokeStyle = 'rgba(59,130,246,.8)';
          previewCtx.lineWidth = 2;
          if (eraseShape === 'free' && eraseFreePath) {
            eraseFreePath.push(pt);
            previewCtx.beginPath();
            previewCtx.moveTo(eraseFreePath[0].x, eraseFreePath[0].y);
            for (let i = 1; i < eraseFreePath.length; i++) previewCtx.lineTo(eraseFreePath[i].x, eraseFreePath[i].y);
            previewCtx.closePath();
            previewCtx.fillStyle = 'rgba(59,130,246,.15)';
            previewCtx.fill();
            previewCtx.stroke();
          } else if (eraseShape === 'rect' && startPt) {
            previewCtx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
          } else if (eraseShape === 'circle' && startPt) {
            const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
            previewCtx.beginPath();
            previewCtx.arc(startPt.x, startPt.y, r, 0, Math.PI * 2);
            previewCtx.stroke();
          }
          previewCtx.restore();
        } else if (currentTool === 'tape') {
          if (points.length > 0) {
            points.push(pt);
            clearPreview();
            previewCtx.save();
            previewCtx.strokeStyle = 'rgba(59,130,246,.5)';
            previewCtx.lineWidth = tapeLayer.getWidth();
            previewCtx.lineCap = 'round';
            previewCtx.beginPath();
            previewCtx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) previewCtx.lineTo(points[i].x, points[i].y);
            previewCtx.stroke();
            previewCtx.restore();
          }
        } else if (startPt) {
          // 图形预览
          clearPreview();
          previewCtx.save();
          previewCtx.strokeStyle = currentColor;
          previewCtx.lineWidth = currentWidth;
          previewCtx.lineCap = 'round';
          if (currentTool === 'arrow') {
            drawArrow(previewCtx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
          } else if (currentTool === 'rect') {
            const bc = window.__rectBorderColor || currentColor;
            const fc = window.__rectFillColor || 'none';
            if (fc !== 'none' && fc !== 'transparent') {
              previewCtx.fillStyle = fc;
              previewCtx.fillRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
            }
            previewCtx.strokeStyle = bc;
            previewCtx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
          } else if (currentTool === 'line') {
            drawLine(previewCtx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
          } else if (currentTool === 'wave') {
            const dx = pt.x - startPt.x, dy = pt.y - startPt.y;
            const len = Math.hypot(dx, dy);
            const steps = Math.max(20, Math.floor(len / 4));
            const nx = -dy / len, ny = dx / len;
            previewCtx.beginPath();
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              const baseX = startPt.x + dx * t;
              const baseY = startPt.y + dy * t;
              const wave = Math.sin(t * Math.PI * 8) * waveAmplitude;
              const px = baseX + nx * wave;
              const py = baseY + ny * wave;
              if (i === 0) previewCtx.moveTo(px, py); else previewCtx.lineTo(px, py);
            }
            previewCtx.stroke();
          }
          previewCtx.restore();
        }
        return;
      }

      // 按下：正式绘制到 ctx
      if (currentTool === 'pen') {
        points.push(pt);
        drawSmoothPath(ctx, points.slice(-10), currentColor, currentWidth);
        dirty = true;
      } else if (currentTool === 'eraser') {
        eraseCircle(ctx, pt.x, pt.y, currentWidth * 2);
        eraseCircle(paperStrokeCtx, pt.x, pt.y, currentWidth * 2);
        tapeLayer.eraseAt(pt.x, pt.y, currentWidth * 2);
        dirty = true;
      } else if (currentTool === 'circle-erase') {
        if (eraseShape === 'free' && eraseFreePath) eraseFreePath.push(pt);
        dirty = true;
      } else if (currentTool === 'tape') {
        points.push(pt);
        clearPreview();
        previewCtx.save();
        previewCtx.strokeStyle = 'rgba(59,130,246,.5)';
        previewCtx.lineWidth = tapeLayer.getWidth();
        previewCtx.lineCap = 'round';
        previewCtx.beginPath();
        previewCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) previewCtx.lineTo(points[i].x, points[i].y);
        previewCtx.stroke();
        previewCtx.restore();
      } else if (currentTool === 'arrow' || currentTool === 'rect' || currentTool === 'line' || currentTool === 'wave') {
        clearPreview();
        previewCtx.save();
        previewCtx.strokeStyle = currentColor;
        previewCtx.lineWidth = currentWidth;
        previewCtx.lineCap = 'round';
        if (currentTool === 'arrow') {
          drawArrow(previewCtx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        } else if (currentTool === 'rect') {
          const bc = window.__rectBorderColor || currentColor;
          const fc = window.__rectFillColor || 'none';
          if (fc !== 'none' && fc !== 'transparent') {
            previewCtx.fillStyle = fc;
            previewCtx.fillRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
          }
          previewCtx.strokeStyle = bc;
          previewCtx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
        } else if (currentTool === 'line') {
          drawLine(previewCtx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        } else if (currentTool === 'wave') {
          const dx = pt.x - startPt.x, dy = pt.y - startPt.y;
          const len = Math.hypot(dx, dy);
          const steps = Math.max(20, Math.floor(len / 4));
          const nx = -dy / len, ny = dx / len;
          previewCtx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const baseX = startPt.x + dx * t;
            const baseY = startPt.y + dy * t;
            const wave = Math.sin(t * Math.PI * 8) * waveAmplitude;
            const px = baseX + nx * wave;
            const py = baseY + ny * wave;
            if (i === 0) previewCtx.moveTo(px, py); else previewCtx.lineTo(px, py);
          }
          previewCtx.stroke();
        }
        previewCtx.restore();
      }
    });

    strokeCanvas.addEventListener('pointerup', async (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;

      // 平移结束
      if (drawing === 'pan') {
        if (window.__panRaf) { cancelAnimationFrame(window.__panRaf); window.__panRaf = null; }
        drawing = false;
        return;
      }
      // 纸张拖动结束
      if (drawing === 'paper-drag') {
        if (paperDragOffset) {
          if (paperDragOffset._raf) { cancelAnimationFrame(paperDragOffset._raf); paperDragOffset._raf = null; }
          paperLayer.save();
        }
        drawing = false;
        paperDragOffset = null;
        return;
      }
      // 纸张调整大小结束
      if (drawing === 'paper-resize') {
        if (paperDragOffset) paperDragOffset.end();
        drawing = false;
        paperDragOffset = null;
        return;
      }
      // 文字拖动结束
      if (drawing === 'text-drag') {
        if (paperDragOffset && paperDragOffset._moved) textLayer.save();
        drawing = false;
        paperDragOffset = null;
        return;
      }
      // 文字调整大小结束
      if (drawing === 'text-resize') {
        if (paperDragOffset) paperDragOffset.end();
        drawing = false;
        paperDragOffset = null;
        return;
      }
      if (!drawing) { clearPreview(); return; }

      const pt = canvasToImage(e.clientX, e.clientY);

      if (currentTool === 'pen') {
        dirty = true;
      } else if (currentTool === 'eraser') {
        dirty = true;
      } else if (currentTool === 'circle-erase') {
        // 自由圈擦：用多边形裁剪精确擦除
        if (eraseShape === 'free' && eraseFreePath && eraseFreePath.length > 2) {
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
          eraseFreePath.forEach(p => tapeLayer.eraseAt(p.x, p.y, currentWidth));
          eraseFreePath = null;
        } else if (eraseShape === 'rect') {
          eraseRect(ctx, startPt.x, startPt.y, pt.x, pt.y);
          eraseRect(paperStrokeCtx, startPt.x, startPt.y, pt.x, pt.y);
          tapeLayer.eraseAt((startPt.x + pt.x) / 2, (startPt.y + pt.y) / 2, Math.max(Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y)) / 2);
        } else if (eraseShape === 'circle') {
          const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
          eraseCircle(ctx, startPt.x, startPt.y, r);
          eraseCircle(paperStrokeCtx, startPt.x, startPt.y, r);
          tapeLayer.eraseAt(startPt.x, startPt.y, r);
        }
        clearPreview();
        dirty = true;
      } else if (currentTool === 'tape') {
        clearPreview();
        if (points.length >= 2) {
          pushUndo(true);
          const tape = {
            id: uuid(),
            points: points.slice(),
            width: tapeLayer.getWidth(),
            pattern: tapeLayer.getPattern(),
            patternImageId: tapeLayer.getPatternImageId(),
            shape: tapeLayer.getShape(),
            color: tapeLayer.getColor(),
            visible: true,
            erasedPath: [],
          };
          tapeLayer.addTape(tape);
        }
        points = [];
        dirty = true;
      } else {
        // 图形工具：正式绘制到 ctx
        if (currentTool === 'arrow') drawArrow(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'rect') {
          const bc = window.__rectBorderColor || currentColor;
          const fc = window.__rectFillColor || 'none';
          if (fc !== 'none' && fc !== 'transparent') {
            ctx.fillStyle = fc;
            ctx.fillRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
          }
          ctx.strokeStyle = bc;
          ctx.lineWidth = currentWidth;
          ctx.strokeRect(Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y), Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y));
        } else if (currentTool === 'line') drawLine(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'wave') drawWave(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth, waveAmplitude);
        clearPreview();
        dirty = true;
      }
      drawing = false;
      points = [];
    });

    strokeCanvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      drawing = false;
      points = [];
      clearPreview();
      if (window.__panRaf) { cancelAnimationFrame(window.__panRaf); window.__panRaf = null; }
    });

    // 鼠标滚轮缩放
    strokeCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.max(0.3, Math.min(10, scale * factor));
      updateTransform();
    }, { passive: false });
    // ========== 撤销 ==========
    let undoStack = [];
    let lastUndoTime = 0;

    // 保存撤销快照（绘制类 500ms 内合并，删除类 force=true 立即存）
    function pushUndo(force = false) {
      const now = Date.now();
      if (!force && now - lastUndoTime < 500) return;
      lastUndoTime = now;
      const strokeSnap = ctx.getImageData(0, 0, W, H);
      const paperStrokeSnap = paperStrokeCtx.getImageData(0, 0, W, H);
      undoStack.push({
        stroke: strokeSnap,
        paperStroke: paperStrokeSnap,
        paper: JSON.parse(JSON.stringify(paperLayer.getPapers())),
        tape: JSON.parse(JSON.stringify(tapeLayer.getTapes())),
        text: JSON.parse(JSON.stringify(textLayer.getItems())),
      });
      if (undoStack.length > 30) undoStack.shift();
    }

    function undo() {
      if (undoStack.length === 0) return;
      const snap = undoStack.pop();
      ctx.clearRect(0, 0, W, H);
      ctx.putImageData(snap.stroke, 0, 0);
      paperStrokeCtx.clearRect(0, 0, W, H);
      paperStrokeCtx.putImageData(snap.paperStroke, 0, 0);
      paperLayer.setPapers(snap.paper || []);
      tapeLayer.setTapes(snap.tape || []);
      textLayer.getItems().length = 0;
      textLayer.getItems().push(...(snap.text || []));
      textLayer.save();
      textLayer.redraw();
      paperLayer.redraw();
      tapeLayer.redraw();
      store.savePaper(imageId, paperLayer.getPapers());
      store.saveTape(imageId, tapeLayer.getTapes());
      dirty = true;
    }

    // ========== 清除 ==========
    async function clearAll() {
      const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '300px' } }, [
          el('h3', { text: '清除' }),
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '12px 0' } }, [
            el('label', {}, [el('input', { type: 'checkbox', id: 'clr-stroke', checked: true }), ' 笔迹']),
            el('label', {}, [el('input', { type: 'checkbox', id: 'clr-tape', checked: true }), ' 胶带']),
            el('label', {}, [el('input', { type: 'checkbox', id: 'clr-paper', checked: true }), ' 纸张']),
            el('label', {}, [el('input', { type: 'checkbox', id: 'clr-text', checked: true }), ' 文字']),
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
                }
                if (document.getElementById('clr-tape').checked) {
                  tapeLayer.getTapes().length = 0;
                  store.saveTape(imageId, []);
                  tapeLayer.redraw();
                }
                if (document.getElementById('clr-paper').checked) {
                  paperLayer.getPapers().length = 0;
                  store.savePaper(imageId, []);
                  paperLayer.redraw();
                }
                if (document.getElementById('clr-text').checked) {
                  textLayer.getItems().length = 0;
                  textLayer.save();
                  textLayer.redraw();
                }
                dirty = true;
                mask.remove();
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);
    }

    // ========== 保存 ==========
    async function saveAll(showToast = false) {
      const strokeBlob = await new Promise(r => strokeCanvas.toBlob(r, 'image/png'));
      const paperStrokeBlob = await new Promise(r => paperStrokeCanvas.toBlob(r, 'image/png'));
      const merged = document.createElement('canvas');
      merged.width = W; merged.height = H;
      const mctx = merged.getContext('2d');
      mctx.drawImage(baseImg, 0, 0);
      mctx.drawImage(paperCanvas, 0, 0);
      mctx.drawImage(strokeCanvas, 0, 0);
      mctx.drawImage(paperStrokeCanvas, 0, 0);
      mctx.drawImage(textCanvas, 0, 0);
      mctx.drawImage(tapeCanvas, 0, 0);
      const annotatedBlob = await new Promise(r => merged.toBlob(r, 'image/png'));
      await putImageCached({
        ...img,
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
    }

    // ========== 长按提示 ==========
    function attachLongPress(btn, text) {
      let timer = null;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        timer = setTimeout(() => showTooltip(btn, text), 500);
      });
      btn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        clearTimeout(timer);
        setTimeout(hideTooltip, 800);
      });
      btn.addEventListener('pointerleave', () => { clearTimeout(timer); hideTooltip(); });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    let tooltipEl = null;
    function showTooltip(btn, name) {
      hideTooltip();
      const rect = btn.getBoundingClientRect();
      tooltipEl = el('div', {
        style: {
          position: 'fixed',
          left: rect.left + rect.width / 2 + 'px',
          top: rect.bottom + 8 + 'px',
          transform: 'translateX(-50%)',
          background: 'rgba(43,45,66,.95)', color: '#fff',
          padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '9999',
        },
        text: name,
      });
      document.body.appendChild(tooltipEl);
    }
    function hideTooltip() {
      if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    }

    document.querySelectorAll('.tool-btn').forEach(btn => {
      const t = TOOLS.find(x => x.id === btn.dataset.tool);
      if (t) attachLongPress(btn, t.name);
    });

    // ========== 新建文字弹窗 ==========
    let textEditorOpen = false;

    function openTextEditor(pos) {
      if (textEditorOpen) return;
      textEditorOpen = true;

      const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '420px', maxHeight: '90vh', overflow: 'auto' } }, [
          el('h3', { text: '添加文字' }),
          el('div', { class: 'field' }, [
            el('label', { text: '文字内容（可换行）' }),
            el('textarea', { id: 'text-input', placeholder: '输入文字', style: { minHeight: '80px' } }),
          ]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { text: '字号' }),
              (() => {
                const num = el('input', { type: 'number', id: 'text-size', value: '20', min: '10', max: '80', style: { width: '60px', textAlign: 'center' } });
                const minus = el('button', { class: 'btn btn-sm btn-ghost', text: '−', style: { minWidth: '22px', padding: '0 3px', minHeight: '28px' }, onClick: () => { num.value = Math.max(10, Number(num.value) - 1); } });
                const plus = el('button', { class: 'btn btn-sm btn-ghost', text: '+', style: { minWidth: '22px', padding: '0 3px', minHeight: '28px' }, onClick: () => { num.value = Math.min(80, Number(num.value) + 1); } });
                return el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [minus, num, plus]);
              })(),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: '字体' }),
              el('select', { id: 'text-font' }, [
                el('option', { value: 'sans-serif', text: '黑体' }),
                el('option', { value: 'serif', text: '宋体' }),
                el('option', { value: 'monospace', text: '等宽' }),
              ]),
            ]),
          ]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { text: '行距' }),
              el('select', { id: 'text-line-height' }, [
                el('option', { value: '1.0', text: '1.0' }),
                el('option', { value: '1.2', text: '1.2' }),
                el('option', { value: '1.5', text: '1.5', selected: true }),
                el('option', { value: '1.8', text: '1.8' }),
                el('option', { value: '2.0', text: '2.0' }),
                el('option', { value: '2.5', text: '2.5' }),
                el('option', { value: '3.0', text: '3.0' }),
              ]),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: '对齐' }),
              el('select', { id: 'text-align' }, [
                el('option', { value: 'left', text: '左对齐' }),
                el('option', { value: 'center', text: '居中' }),
                el('option', { value: 'right', text: '右对齐' }),
              ]),
            ]),
          ]),
          el('div', { class: 'field' }, [el('label', { text: '文字颜色' }), el('div', { id: 'text-color-picker' })]),
          el('div', { class: 'field' }, [el('label', { text: '背景色（可选无色）' }), el('div', { id: 'text-bg-picker' })]),
          el('div', { class: 'confirm-actions' }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { textEditorOpen = false; mask.remove(); } }),
            el('button', {
              class: 'btn btn-primary', text: '添加',
              onClick: () => {
                const text = document.getElementById('text-input').value;
                const size = Number(document.getElementById('text-size').value) || 20;
                const font = document.getElementById('text-font').value;
                const colorPicker = document.getElementById('text-color-picker');
                const bgPicker = document.getElementById('text-bg-picker');
                const color = colorPicker?.dataset.color || currentColor;
                const bg = bgPicker?.dataset.color || '#FFFFFF';
                const noBg = bg === 'none';
                const lineHeight = Number(document.getElementById('text-line-height').value) || 1.5;
                const align = document.getElementById('text-align').value;
                if (!text) { alert('请输入文字'); return; }
                pushUndo(true);
                const lines = text.split('\n');
                const maxW = Math.max(...lines.map(l => l.length * size * 0.6), 100);
                textLayer.addText({
                  x: pos.x, y: pos.y,
                  w: Math.max(120, maxW + 16),
                  h: Math.max(40, lines.length * size * lineHeight + 8),
                  text, fontSize: size, fontFamily: font,
                  color, bgColor: bg, noBg, lineHeight, align,
                });
                dirty = true;
                textEditorOpen = false;
                mask.remove();
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);

      const cp = document.getElementById('text-color-picker');
      if (cp) cp.appendChild(renderColorPicker({ current: currentColor, onChange: (c) => { cp.dataset.color = c; } }));
      const bp = document.getElementById('text-bg-picker');
      if (bp) bp.appendChild(renderColorPicker({ current: '#FFFFFF', onChange: (c) => { bp.dataset.color = c; }, allowNone: true }));
      setTimeout(() => document.getElementById('text-input')?.focus(), 100);
    }

    // ========== 扩展画布到指定尺寸 ==========
    async function doExpandToSize(newW, newH, bgColor) {
      // 计算偏移：默认从左上角对齐
      const dx = 0, dy = 0;

      // 新原图
      const newOriginal = document.createElement('canvas');
      newOriginal.width = newW; newOriginal.height = newH;
      const octx = newOriginal.getContext('2d');
      if (bgColor === 'transparent') {
        octx.clearRect(0, 0, newW, newH);
      } else {
        octx.fillStyle = bgColor;
        octx.fillRect(0, 0, newW, newH);
      }
      octx.drawImage(baseImg, dx, dy);

      // 新笔迹
      const newStroke = document.createElement('canvas');
      newStroke.width = newW; newStroke.height = newH;
      newStroke.getContext('2d').drawImage(strokeCanvas, dx, dy);

      // 新纸张笔迹
      const newPaperStroke = document.createElement('canvas');
      newPaperStroke.width = newW; newPaperStroke.height = newH;
      newPaperStroke.getContext('2d').drawImage(paperStrokeCanvas, dx, dy);

      // 平移纸张、胶带、文字坐标
      paperLayer.getPapers().forEach(p => { p.x += dx; p.y += dy; });
      tapeLayer.getTapes().forEach(t => { t.points.forEach(pt => { pt.x += dx; pt.y += dy; }); });
      textLayer.getItems().forEach(t => { t.x += dx; t.y += dy; });

      // 保存新坐标
      store.savePaper(imageId, paperLayer.getPapers());
      store.saveTape(imageId, tapeLayer.getTapes());
      store.saveTextItems(imageId, textLayer.getItems());

      // 生成 Blob
      const originalBlob = await new Promise(r => newOriginal.toBlob(r, 'image/png'));
      const strokeBlob = await new Promise(r => newStroke.toBlob(r, 'image/png'));
      const paperStrokeBlob = await new Promise(r => newPaperStroke.toBlob(r, 'image/png'));

      // 合并图
      const annotatedBlob = await new Promise(r => {
        const m = document.createElement('canvas');
        m.width = newW; m.height = newH;
        const mctx = m.getContext('2d');
        mctx.drawImage(newOriginal, 0, 0);
        mctx.drawImage(newStroke, 0, 0);
        mctx.drawImage(newPaperStroke, 0, 0);
        m.toBlob(r, 'image/png');
      });

      // 存回 IndexedDB
      await putImageCached({
        ...img,
        originalBlob,
        strokeBlob,
        paperStrokeBlob,
        annotatedBlob,
        width: newW, height: newH,
        updatedAt: new Date().toISOString(),
      });

      toastSuccess(`已扩展为 ${newW}×${newH}`);
      setTimeout(() => location.reload(), 500);
    }

    // ========== 缩放到原图大小 ==========
    async function doResizeToOriginal(newW, newH) {
      // 这里其实就是裁剪画布到原图尺寸
      // 直接把当前原图、笔迹、纸张笔迹裁剪到 newW × newH
      const newOriginal = document.createElement('canvas');
      newOriginal.width = newW; newOriginal.height = newH;
      const octx = newOriginal.getContext('2d');
      octx.drawImage(baseImg, 0, 0, newW, newH, 0, 0, newW, newH);

      const newStroke = document.createElement('canvas');
      newStroke.width = newW; newStroke.height = newH;
      newStroke.getContext('2d').drawImage(strokeCanvas, 0, 0, newW, newH, 0, 0, newW, newH);

      const newPaperStroke = document.createElement('canvas');
      newPaperStroke.width = newW; newPaperStroke.height = newH;
      newPaperStroke.getContext('2d').drawImage(paperStrokeCanvas, 0, 0, newW, newH, 0, 0, newW, newH);

      const originalBlob = await new Promise(r => newOriginal.toBlob(r, 'image/png'));
      const strokeBlob = await new Promise(r => newStroke.toBlob(r, 'image/png'));
      const paperStrokeBlob = await new Promise(r => newPaperStroke.toBlob(r, 'image/png'));
      const annotatedBlob = originalBlob;

      await putImageCached({
        ...img,
        originalBlob,
        strokeBlob,
        paperStrokeBlob,
        annotatedBlob,
        width: newW, height: newH,
        updatedAt: new Date().toISOString(),
      });

      toastSuccess(`已缩放到 ${newW}×${newH}`);
      setTimeout(() => location.reload(), 500);
    }
    // ========== 编辑已有文字 ==========
    function openTextObjectEditor(textItem) {
      // 快照原值，取消时恢复
      const orig = { ...textItem };

      // 文字内容输入框
      const ta = el('textarea', {
        style: { width: '100%', minHeight: '80px', padding: '8px', fontSize: '14px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '8px', fontFamily: 'inherit', outline: 'none' },
      });
      ta.value = textItem.text || '';
      ta.dataset.textEditor = '1';

      // 字号
      const sizeNum = el('input', { type: 'number', min: '10', max: '80', value: String(textItem.fontSize || 20), style: { width: '60px', padding: '6px', borderRadius: '8px', textAlign: 'center' } });
      // 字体
      const fontSelect = el('select', { style: { width: '100px', padding: '6px', borderRadius: '8px' } }, [
        el('option', { value: 'sans-serif', text: '黑体', selected: textItem.fontFamily === 'sans-serif' }),
        el('option', { value: 'serif', text: '宋体', selected: textItem.fontFamily === 'serif' }),
        el('option', { value: 'monospace', text: '等宽', selected: textItem.fontFamily === 'monospace' }),
      ]);
      // 行距
      const lineHeightSelect = el('select', { style: { width: '80px', padding: '6px', borderRadius: '8px' } },
        [1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0].map(v => el('option', { value: String(v), text: v.toFixed(1), selected: (textItem.lineHeight || 1.5) === v }))
      );
      // 对齐
      const alignSelect = el('select', { style: { width: '90px', padding: '6px', borderRadius: '8px' } }, [
        el('option', { value: 'left', text: '左对齐', selected: textItem.align === 'left' }),
        el('option', { value: 'center', text: '居中', selected: textItem.align === 'center' }),
        el('option', { value: 'right', text: '右对齐', selected: textItem.align === 'right' }),
      ]);

      // 文字颜色
      const colorWrap = el('div');
      colorWrap.dataset.color = textItem.color || '#2B2D42';
      colorWrap.appendChild(renderColorPicker({
        current: textItem.color || '#2B2D42',
        onChange: (c) => { colorWrap.dataset.color = c; },
      }));

      // 背景色
      const bgWrap = el('div');
      bgWrap.dataset.color = textItem.noBg ? 'none' : (textItem.bgColor || '#FFFFFF');
      bgWrap.appendChild(renderColorPicker({
        current: textItem.noBg ? 'none' : (textItem.bgColor || '#FFFFFF'),
        onChange: (c) => { bgWrap.dataset.color = c; },
        allowNone: true,
      }));

      const panel = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '420px', maxHeight: '90vh', overflow: 'auto' } }, [
          el('h3', { text: '编辑文字' }),
          el('div', { class: 'field' }, [el('label', { text: '文字内容' }), ta]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [el('label', { text: '字号' }), sizeNum]),
            el('div', { class: 'field' }, [el('label', { text: '字体' }), fontSelect]),
          ]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [el('label', { text: '行距' }), lineHeightSelect]),
            el('div', { class: 'field' }, [el('label', { text: '对齐' }), alignSelect]),
          ]),
          el('div', { class: 'field' }, [el('label', { text: '文字颜色' }), colorWrap]),
          el('div', { class: 'field' }, [el('label', { text: '背景色（可选无色）' }), bgWrap]),
          el('div', { class: 'confirm-actions' }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { Object.assign(textItem, orig); panel.remove(); } }),
            el('button', {
              class: 'btn btn-primary', text: '保存',
              onClick: () => {
                const color = colorWrap.dataset.color || textItem.color;
                const bg = bgWrap.dataset.color || textItem.bgColor;
                const noBg = bg === 'none';
                textItem.text = ta.value;
                textItem.fontSize = Number(sizeNum.value) || 20;
                textItem.fontFamily = fontSelect.value;
                textItem.lineHeight = Number(lineHeightSelect.value) || 1.5;
                textItem.align = alignSelect.value;
                textItem.color = color;
                textItem.bgColor = noBg ? '#FFFFFF' : bg;
                textItem.noBg = noBg;
                textLayer.save();
                textLayer.redraw();
                dirty = true;
                panel.remove();
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(panel);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }

    // ========== 扩展画布弹窗 ==========
    function openExpandDialog() {
      const papers = paperLayer.getPapers();

      // 纸张选择（仅当预设选「与纸张一致」时显示）
      const paperSelectField = el('div', {
        class: 'field', id: 'paper-select-field', style: { display: 'none' },
      }, [
        el('label', { text: '选择纸张' }),
        el('select', { id: 'expand-paper-id' },
          papers.length > 0
            ? papers.map((p, i) => el('option', { value: p.id, text: `纸张 ${i + 1}（${Math.round(p.w)}×${Math.round(p.h)}）` }))
            : [el('option', { value: '', text: '还没有纸张' })]
        ),
      ]);

      // 隐藏的 PDF 文件输入，用于读取 PDF 第一页尺寸
      const pdfFileInput = el('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });
      let pdfTargetW = 0, pdfTargetH = 0;
      pdfFileInput.onchange = async () => {
        const f = pdfFileInput.files?.[0];
        if (!f) return;
        if (!window.pdfjsLib) { toastError('PDF.js 未加载'); return; }
        const buf = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 2 });
        pdfTargetW = Math.round(vp.width);
        pdfTargetH = Math.round(vp.height);
        updatePreview();
      };

      // 自定义平铺图片
      const styleImageInput = el('input', { type: 'file', id: 'expand-style-image', accept: 'image/*', style: { display: 'none' } });
      const styleImageField = el('div', {
        class: 'field', id: 'expand-style-image-field', style: { display: 'none' },
      }, [
        el('label', { text: '自定义平铺图片' }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '📁 选择图片', onClick: () => styleImageInput.click() }),
        el('span', { id: 'expand-style-image-name', style: { fontSize: '12px', color: 'var(--text-2)', marginLeft: '8px' }, text: '未选择' }),
        styleImageInput,
      ]);
      styleImageInput.onchange = () => {
        const name = styleImageInput.files?.[0]?.name || '未选择';
        const el2 = document.getElementById('expand-style-image-name');
        if (el2) el2.textContent = name;
      };

      // 预览文字
      const previewText = el('div', {
        id: 'expand-preview',
        style: { fontSize: '13px', color: 'var(--text-2)', marginTop: '8px', padding: '8px', background: 'var(--bg)', borderRadius: '8px' },
        text: `即将扩展为：${W} × ${H} px`,
      });

      // 方向
      const dirSelect = el('select', { id: 'expand-dir' }, [
        el('option', { value: 'top', text: '↑ 上方' }),
        el('option', { value: 'bottom', text: '↓ 下方' }),
        el('option', { value: 'left', text: '← 左侧' }),
        el('option', { value: 'right', text: '→ 右侧' }),
      ]);

      // 预设尺寸
      const presetSelect = el('select', { id: 'expand-preset' }, [
        el('option', { value: 'custom', text: '自定义像素' }),
        el('option', { value: 'a4', text: 'A4（2480×3508）' }),
        el('option', { value: 'a3', text: 'A3（3508×4961）' }),
        el('option', { value: 'a5', text: 'A5（1748×2480）' }),
        el('option', { value: 'square', text: '正方形（2000×2000）' }),
        el('option', { value: '16:9', text: '16:9（2560×1440）' }),
        el('option', { value: '4:3', text: '4:3（2048×1536）' }),
        el('option', { value: 'original', text: '与图片一致' }),
        el('option', { value: 'pdf-file', text: '与 PDF 一致（选文件）' }),
      ]);

      // 扩展区域颜色
      const colorSelect = el('select', { id: 'expand-color' }, [
        el('option', { value: '#FFFFFF', text: '白色' }),
        el('option', { value: 'transparent', text: '透明' }),
        el('option', { value: 'custom', text: '自定义' }),
      ]);

      // 自定义颜色输入
      const customColorField = el('div', { class: 'field', id: 'expand-custom-color-field', style: { display: 'none' } }, [
        el('label', { text: '自定义颜色' }),
        el('input', { type: 'color', id: 'expand-custom-color', value: '#FFFFFF', onInput: updatePreview }),
      ]);

      // 扩展像素输入
      const pxInput = el('input', {
        type: 'number', id: 'expand-px', value: '200', min: '50', max: '5000',
        onInput: updatePreview,
      });

      // 预设尺寸变更
      presetSelect.onchange = () => {
        if (presetSelect.value === 'custom') {
          pxInput.disabled = false;
          pxInput.value = '200';
        } else {
          pxInput.disabled = true;
          pxInput.value = '';
        }
        if (presetSelect.value === 'pdf-file') pdfFileInput.click();
        if (presetSelect.value === 'paper') {
          paperSelectField.style.display = 'block';
        } else {
          paperSelectField.style.display = 'none';
        }
        styleImageField.style.display = presetSelect.value === 'custom-image' ? 'block' : 'none';
        updatePreview();
      };
      dirSelect.onchange = updatePreview;

      // 颜色选择变更
      colorSelect.onchange = () => {
        customColorField.style.display = colorSelect.value === 'custom' ? 'block' : 'none';
        updatePreview();
      };

      // 更新预览文字
      function updatePreview() {
        const dir = dirSelect.value;
        const preset = presetSelect.value;
        let newW = W, newH = H;

        if (preset === 'original') {
          newW = img.width; newH = img.height;
        } else if (preset === 'a4') { newW = 2480; newH = 3508; }
        else if (preset === 'a3') { newW = 3508; newH = 4961; }
        else if (preset === 'a5') { newW = 1748; newH = 2480; }
        else if (preset === 'square') { newW = 2000; newH = 2000; }
        else if (preset === '16:9') { newW = 2560; newH = 1440; }
        else if (preset === '4:3') { newW = 2048; newH = 1536; }
        else if (preset === 'pdf-file') {
          if (pdfTargetW) { newW = pdfTargetW; newH = pdfTargetH; }
        } else {
          const px = Math.max(50, Math.min(5000, Number(pxInput.value) || 200));
          if (dir === 'top' || dir === 'bottom') newH = H + px;
          else newW = W + px;
        }

        const color = colorSelect.value === 'custom' ? customColorField.querySelector('input').value : colorSelect.value;
        const colorLabel = color === 'transparent' ? '透明' : color;
        const el2 = document.getElementById('expand-preview');
        if (el2) el2.textContent = `即将扩展为：${newW} × ${newH} px（原 ${W} × ${H}），扩展区域颜色：${colorLabel}`;
      }

      // 弹窗
      const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
          el('h3', { text: '扩展画布' }),
          el('div', { class: 'field' }, [el('label', { text: '方向' }), dirSelect]),
          el('div', { class: 'field' }, [el('label', { text: '预设尺寸' }), presetSelect]),
          el('div', { class: 'field' }, [el('label', { text: '扩展像素（自定义时有效）' }), pxInput]),
          paperSelectField,
          styleImageField,
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
                const color = colorSelect.value === 'custom'
                  ? customColorField.querySelector('input').value
                  : colorSelect.value;

                // 「与图片一致」：缩放到原图大小
                if (preset === 'original') {
                  if (W === img.width && H === img.height) {
                    toastError('当前已是原图大小'); return;
                  }
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
                else if (preset === 'pdf-file') {
                  if (!pdfTargetW) { toastError('请先选择 PDF 文件'); return; }
                  targetW = pdfTargetW; targetH = pdfTargetH;
                } else if (preset === 'paper') {
                  const selId = document.getElementById('expand-paper-id')?.value;
                  const sel = paperLayer.getPapers().find(p => p.id === selId);
                  if (!sel) { toastError('请选择纸张'); return; }
                  if (dir === 'top' || dir === 'bottom') targetH = H + Math.round(sel.h);
                  else targetW = W + Math.round(sel.w);
                } else {
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

    // ========== 图层顺序面板 ==========
    function openLayerPanel() {
      // 临时顺序（不修改 currentLayerOrder）
      const tempOrder = [...currentLayerOrder];

      // 图层名映射
      const labels = {
        base: '🖼 底图',
        stroke: '✏️ 笔迹',
        text: 'T 文字',
        paper: '📄 纸张',
        paperStroke: '✏️ 纸张笔迹',
        tape: '🎗️ 胶带',
      };

      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });

      // 重新渲染列表
      function renderList() {
        list.innerHTML = '';
        tempOrder.forEach((key, i) => {
          const row = el('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px',
              border: '1px solid rgba(0,0,0,.06)',
            },
          }, [
            el('span', { style: { flex: '1', fontWeight: '600' }, text: labels[key] || key }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '↑', disabled: i === 0,
              onClick: () => {
                if (i === 0) return;
                [tempOrder[i - 1], tempOrder[i]] = [tempOrder[i], tempOrder[i - 1]];
                applyLayerOrder(tempOrder);
                renderList();
              },
            }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '↓', disabled: i === tempOrder.length - 1,
              onClick: () => {
                if (i === tempOrder.length - 1) return;
                [tempOrder[i + 1], tempOrder[i]] = [tempOrder[i], tempOrder[i + 1]];
                applyLayerOrder(tempOrder);
                renderList();
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
          el('p', { text: '从下到上排列。点「保存」永久生效，点「取消」恢复默认', style: { fontSize: '13px', color: 'var(--text-2)' } }),
          list,
          el('div', { class: 'confirm-actions', style: { flexWrap: 'wrap' } }, [
            el('button', {
              class: 'btn btn-ghost', text: '恢复默认',
              onClick: () => {
                tempOrder.length = 0;
                tempOrder.push(...DEFAULT_LAYER_ORDER);
                applyLayerOrder(tempOrder);
                renderList();
              },
            }),
            el('button', {
              class: 'btn btn-ghost', text: '取消',
              onClick: () => {
                // 恢复默认顺序并保存
                applyLayerOrder(DEFAULT_LAYER_ORDER);
                currentLayerOrder = [...DEFAULT_LAYER_ORDER];
                store.saveLayerOrder(DEFAULT_LAYER_ORDER);
                mask.remove();
              },
            }),
            el('button', {
              class: 'btn btn-primary', text: '保存',
              onClick: () => {
                currentLayerOrder = [...tempOrder];
                store.saveLayerOrder(currentLayerOrder);
                mask.remove();
                toastSuccess('图层顺序已保存');
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);
    }

    // ========== 清理 ==========
    if (window.__annotatorAbort) window.__annotatorAbort.abort();
    const abort = new AbortController();
    window.__annotatorAbort = abort;

    window.__annotatorCleanup = () => {
      if (window.__panRaf) { cancelAnimationFrame(window.__panRaf); window.__panRaf = null; }
      document.querySelectorAll('.annotator-bottom-bar, .annotator-hint, .annotator-zoom').forEach(n => n.remove());
      document.querySelectorAll('textarea[data-text-editor]').forEach(t => t.remove());
      hideTooltip();
      URL.revokeObjectURL(urlDisplay);
      abort.abort();
      window.__annotatorCleanup = null;
    };
  }).catch(err => {
    console.error(err);
    toastError('标注页加载失败：' + err.message);
  });
}