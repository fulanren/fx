import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { dbGet, dbPut } from '../db.js';
import {
  drawSmoothPath, drawArrow, drawRect, drawLine, drawWave,
  eraseCircle, eraseRect,
} from '../utils/canvas.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { createTapeLayer, renderTapeToolbar } from './annotatorTape.js';
import { createPaperLayer, renderPaperToolbar } from './annotatorPaper.js';
import { patternCropModal } from '../ui/patternCrop.js';

const TOOLS = [
  { id: 'pen', label: '✏️' },
  { id: 'eraser', label: '🧽' },
  { id: 'circle-erase', label: '⭕' },
  { id: 'text', label: 'T' },
  { id: 'arrow', label: '↗' },
  { id: 'rect', label: '▭' },
  { id: 'line', label: '—' },
  { id: 'wave', label: '〰️' },
  { id: 'tape', label: '🎗️' },
  { id: 'paper', label: '📄' },
  { id: 'hand', label: '✋' },
];

const COLORS = ['#EF476F', '#F78C6B', '#FFD166', '#06D6A0', '#118AB2', '#073B4C', '#2B2D42', '#FFFFFF'];

export function renderAnnotator({ params, query }) {
  const imageId = params.id;
  const pointId = query.pointId;
  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = '标注';
  document.getElementById('btn-back').classList.remove('hidden');

  let dirty = false;
  let currentTool = 'pen';
  let currentColor = '#EF476F';
  let currentWidth = 4;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const goBack = async () => {
    if (dirty) {
      const r = await confirmBox({ title: '未保存', message: '有未保存的标注，是否保存？', confirmText: '保存并返回', cancelText: '放弃', extra: { label: '继续编辑', value: 'stay' } });
      if (r === true) { await saveAll(); dirty = false; doNavigateBack(); return; }
      if (r === false) { doNavigateBack(); return; }
      return;
    }
    doNavigateBack();
  };
  function doNavigateBack() {
    const p = pointId ? store.getPoint(pointId) : null;
    navigate(p ? `#/chapter/${p.chapterId}` : '#/');
  }
  document.getElementById('btn-back').onclick = goBack;

  dbGet('images', imageId).then(async img => {
    if (!img) { toastError('图片不存在'); navigate('#/'); return; }

    const originalUrl = URL.createObjectURL(img.originalBlob);
    const baseImg = new Image();
    baseImg.src = originalUrl;
    await new Promise(r => { baseImg.onload = r; });

    const W = img.width;
    const H = img.height;

    const wrap = el('div', { class: 'annotator-wrap' });
    const canvasWrap = el('div', { class: 'canvas-wrap' });

    const base = el('img', { src: originalUrl, class: 'base-img', draggable: 'false' });
    const strokeCanvas = el('canvas', { class: 'stroke-canvas' });
    strokeCanvas.width = W; strokeCanvas.height = H;
    const ctx = strokeCanvas.getContext('2d');

    const paperCanvas = el('canvas', { class: 'paper-canvas' });
    paperCanvas.width = W; paperCanvas.height = H;
    const paperLayer = createPaperLayer(paperCanvas, W, H, imageId);

    const tapeCanvas = el('canvas', { class: 'tape-canvas' });
    tapeCanvas.width = W; tapeCanvas.height = H;
    const tapeLayer = createTapeLayer(tapeCanvas, W, H, imageId);

    canvasWrap.appendChild(base);
    canvasWrap.appendChild(strokeCanvas);
    canvasWrap.appendChild(paperCanvas);
    canvasWrap.appendChild(tapeCanvas);
    wrap.appendChild(canvasWrap);
    view.appendChild(wrap);

    const zoomLabel = el('div', { class: 'zoom-label', text: '100%' });
    wrap.appendChild(zoomLabel);

    if (img.annotatedBlob && img.annotatedBlob !== img.originalBlob) {
      const annotUrl = URL.createObjectURL(img.annotatedBlob);
      const annotImg = new Image();
      annotImg.src = annotUrl;
      await new Promise(r => { annotImg.onload = r; });
      ctx.drawImage(annotImg, 0, 0);
    }

    paperLayer.redraw();
    tapeLayer.redraw();

    const toolBar = el('div', { class: 'annotator-toolbar' });
    function setActiveTool(id) {
      currentTool = id;
      toolBar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      const btn = toolBar.querySelector(`[data-tool="${id}"]`);
      if (btn) btn.classList.add('active');
      strokeCanvas.style.cursor = id === 'hand' ? 'grab' : 'crosshair';
      updateSubToolbar();
    }
    TOOLS.forEach(t => {
      const btn = el('button', {
        class: 'tool-btn' + (t.id === currentTool ? ' active' : ''),
        'data-tool': t.id,
        text: t.label,
        onClick: () => setActiveTool(t.id),
      });
      toolBar.appendChild(btn);
    });
    view.appendChild(toolBar);

    const subBar = el('div', { class: 'sub-toolbar' });
    view.appendChild(subBar);

    let tapeToolbar = null;
    let paperToolbar = null;

    function updateSubToolbar() {
      subBar.innerHTML = '';
      if (currentTool === 'tape') {
        if (!tapeToolbar) {
          tapeToolbar = renderTapeToolbar(tapeLayer, async () => {
            const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
            fileInput.onchange = async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              const pid = await patternCropModal(file);
              if (pid) { tapeLayer.setPatternImage(pid); toastSuccess('花样已选用'); }
            };
            document.body.appendChild(fileInput);
            fileInput.click();
            setTimeout(() => fileInput.remove(), 1000);
          });
        }
        subBar.appendChild(tapeToolbar);
        subBar.appendChild(el('div', { class: 'tape-row' }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '👁 全部显示', onClick: () => { tapeLayer.showAll(); toastSuccess('已显示所有胶带'); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '🙈 全部隐藏', onClick: () => { tapeLayer.hideAll(); toastSuccess('已隐藏所有胶带'); } }),
        ]));
      } else if (currentTool === 'paper') {
        if (!paperToolbar) {
          paperToolbar = renderPaperToolbar(paperLayer);
          paperToolbar.addEventListener('paper-added', () => {
            dirty = true;
            setTimeout(() => {
              const sel = paperLayer.getSelected();
              if (sel) {
                const text = prompt('输入纸张文字（可留空）', '');
                if (text !== null && text !== '') paperLayer.setText(text);
              }
            }, 100);
          });
        }
        subBar.appendChild(paperToolbar);
      }
    }

    const colorBar = el('div', { class: 'annotator-colorbar' });
    COLORS.forEach(c => {
      const dot = el('button', {
        class: 'color-dot' + (c === currentColor ? ' active' : ''),
        style: { background: c },
        onClick: () => {
          currentColor = c;
          colorBar.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
          dot.classList.add('active');
        },
      });
      colorBar.appendChild(dot);
    });
    view.appendChild(colorBar);

    const widthRow = el('div', { class: 'annotator-widthrow' }, [
      el('span', { text: '粗细', style: { fontSize: '13px', color: 'var(--text-2)' } }),
      el('input', {
        type: 'range', min: '1', max: '20', value: String(currentWidth),
        style: { flex: '1' },
        onInput: (e) => { currentWidth = Number(e.target.value); },
      }),
    ]);
    view.appendChild(widthRow);

    const actionBar = el('div', { class: 'annotator-actions' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '↶ 撤销', onClick: undo }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '🗑 清除', onClick: clearAll }),
      el('button', { class: 'btn btn-sm btn-primary', text: '💾 保存', onClick: () => saveAll(true) }),
    ]);
    view.appendChild(actionBar);

    const undoStack = [];
    function pushUndo() {
      const strokeSnap = ctx.getImageData(0, 0, W, H);
      undoStack.push({
        stroke: strokeSnap,
        paper: JSON.parse(JSON.stringify(paperLayer.getPapers())),
        tape: JSON.parse(JSON.stringify(tapeLayer.getTapes())),
      });
      if (undoStack.length > 30) undoStack.shift();
    }
    function undo() {
      const prev = undoStack.pop();
      if (!prev) { toastError('没有可撤销的操作'); return; }
      ctx.putImageData(prev.stroke, 0, 0);
      paperLayer.getPapers().length = 0;
      prev.paper.forEach(p => paperLayer.getPapers().push(p));
      store.savePaper(imageId, paperLayer.getPapers());
      paperLayer.redraw();
      tapeLayer.getTapes().length = 0;
      prev.tape.forEach(t => tapeLayer.getTapes().push(t));
      store.saveTape(imageId, tapeLayer.getTapes());
      tapeLayer.redraw();
      dirty = true;
    }
    async function clearAll() {
      if (await confirmBox({ title: '清除', message: '清空所有笔迹、胶带、纸张？原图不受影响', danger: true, confirmText: '清除' })) {
        pushUndo();
        ctx.clearRect(0, 0, W, H);
        paperLayer.getPapers().length = 0;
        store.savePaper(imageId, []);
        paperLayer.redraw();
        tapeLayer.getTapes().length = 0;
        store.saveTape(imageId, []);
        tapeLayer.redraw();
        dirty = true;
      }
    }

    let drawing = false;
    let startPt = null;
    let points = [];
    let pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let paperDragOffset = null;

    function canvasToImage(clientX, clientY) {
      const rect = strokeCanvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / rect.width * W,
        y: (clientY - rect.top) / rect.height * H,
      };
    }

    function updateTransform() {
      canvasWrap.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    paperCanvas.style.pointerEvents = 'none';
    tapeCanvas.style.pointerEvents = 'none';

    strokeCanvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartScale = scale;
        drawing = false;
        return;
      }

      if (currentTool === 'hand') {
        drawing = 'pan';
        startPt = { x: e.clientX - offsetX, y: e.clientY - offsetY };
        return;
      }

      if (currentTool === 'paper') {
        const pt = canvasToImage(e.clientX, e.clientY);
        const hit = paperLayer.hitTest(pt.x, pt.y);
        if (hit) {
          paperLayer.select(hit);
          paperDragOffset = { dx: pt.x - hit.x, dy: pt.y - hit.y, paper: hit };
          drawing = 'paper-drag';
          return;
        } else return;
      }

      if (currentTool === 'tape') {
        const pt = canvasToImage(e.clientX, e.clientY);
        const hit = tapeLayer.hitTest(pt.x, pt.y);
        if (hit) {
          // 点中已有胶带 → 切换显隐
          tapeLayer.toggleVisible(hit.id);
          dirty = true;
          return;
        }
        // 没点中 → 开始画新胶带
        pushUndo();
        drawing = true;
        points = [pt];
        return;
      }

      strokeCanvas.setPointerCapture(e.pointerId);

      if (currentTool === 'pen' || currentTool === 'eraser') {
        pushUndo();
        drawing = true;
        points = [canvasToImage(e.clientX, e.clientY)];
      } else if (currentTool === 'circle-erase') {
        pushUndo();
        drawing = true;
        startPt = canvasToImage(e.clientX, e.clientY);
      } else if (currentTool === 'text') {
        const pos = canvasToImage(e.clientX, e.clientY);
        const text = prompt('输入文字');
        if (text) {
          pushUndo();
          ctx.save();
          ctx.fillStyle = currentColor;
          ctx.font = `${Math.max(16, currentWidth * 5)}px sans-serif`;
          ctx.fillText(text, pos.x, pos.y);
          ctx.restore();
          dirty = true;
        }
        drawing = false;
      } else {
        pushUndo();
        drawing = true;
        startPt = canvasToImage(e.clientX, e.clientY);
      }
    });

    strokeCanvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStartDist > 0) {
          scale = Math.min(10, Math.max(0.3, pinchStartScale * dist / pinchStartDist));
          updateTransform();
        }
        return;
      }

      if (drawing === 'pan') {
        offsetX = e.clientX - startPt.x;
        offsetY = e.clientY - startPt.y;
        updateTransform();
        return;
      }

      if (drawing === 'paper-drag') {
        const pt = canvasToImage(e.clientX, e.clientY);
        const p = paperDragOffset.paper;
        p.x = pt.x - paperDragOffset.dx;
        p.y = pt.y - paperDragOffset.dy;
        paperLayer.redraw();
        dirty = true;
        return;
      }

      if (!drawing) return;

      const pt = canvasToImage(e.clientX, e.clientY);

      if (currentTool === 'pen') {
        points.push(pt);
        drawSmoothPath(ctx, points.slice(-10), currentColor, currentWidth);
      } else if (currentTool === 'eraser') {
        eraseCircle(ctx, pt.x, pt.y, currentWidth * 2);
        tapeLayer.eraseAt(pt.x, pt.y, currentWidth * 2);
      } else if (currentTool === 'tape') {
        points.push(pt);
        const tempTape = {
          id: '__temp__',
          points: points,
          width: tapeLayer.getWidth(),
          pattern: tapeLayer.getPattern(),
          patternImageId: null,
          shape: tapeLayer.getTool(),
          color: tapeLayer.getColor(),
          visible: true,
          erasedPath: [],
        };
        tapeLayer.redraw();
        drawTempTape(tapeCanvas, tempTape);
      } else if (currentTool === 'circle-erase') {
        // 松手时擦
      } else {
        const snap = undoStack[undoStack.length - 1];
        if (snap) ctx.putImageData(snap.stroke, 0, 0);
        if (currentTool === 'arrow') drawArrow(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'rect') drawRect(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'line') drawLine(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'wave') drawWave(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth, 8);
      }
      dirty = true;
    });

    function drawTempTape(canvas, t) {
      const c = canvas.getContext('2d');
      c.save();
      c.fillStyle = t.color;
      c.strokeStyle = t.color;
      c.lineWidth = t.width;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      if (t.shape === 'line-round' || t.shape === 'line-square') {
        if (t.points.length < 2) { c.restore(); return; }
        c.beginPath();
        c.moveTo(t.points[0].x, t.points[0].y);
        for (let i = 1; i < t.points.length; i++) c.lineTo(t.points[i].x, t.points[i].y);
        c.stroke();
      } else if (t.shape === 'rect') {
        const p0 = t.points[0], p1 = t.points[t.points.length - 1];
        c.fillRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
      } else if (t.shape === 'circle') {
        const p0 = t.points[0], p1 = t.points[t.points.length - 1];
        const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        c.beginPath();
        c.arc(p0.x, p0.y, r, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    strokeCanvas.addEventListener('pointerup', (e) => {
      pointers.delete(e.pointerId);

      if (drawing === 'pan') { drawing = false; return; }
      if (drawing === 'paper-drag') {
        paperLayer.save();
        drawing = false;
        paperDragOffset = null;
        return;
      }
      if (!drawing) return;

      if (currentTool === 'tape') {
        if (points.length >= 2) {
          const tape = {
            id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
            points: points,
            width: tapeLayer.getWidth(),
            pattern: tapeLayer.getPattern(),
            patternImageId: null,
            shape: tapeLayer.getTool(),
            color: tapeLayer.getColor(),
            visible: true,
            erasedPath: [],
          };
          tapeLayer.addTape(tape);
        }
      } else if (currentTool === 'circle-erase') {
        const pt = canvasToImage(e.clientX, e.clientY);
        const w = Math.abs(pt.x - startPt.x);
        const h = Math.abs(pt.y - startPt.y);
        if (w > 5 && h > 5) {
          eraseRect(ctx, startPt.x, startPt.y, pt.x, pt.y);
          tapeLayer.eraseAt((startPt.x + pt.x) / 2, (startPt.y + pt.y) / 2, Math.max(w, h) / 2);
        }
      }
      drawing = false;
      points = [];
      startPt = null;
      dirty = true;
    });

    strokeCanvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      drawing = false;
      paperDragOffset = null;
    });

    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(10, Math.max(0.3, scale * delta));
      updateTransform();
    }, { passive: false });

    strokeCanvas.addEventListener('click', (e) => {
      if (currentTool === 'paper') {
        const pt = canvasToImage(e.clientX, e.clientY);
        if (!paperLayer.hitTest(pt.x, pt.y)) paperLayer.select(null);
      }
    });

    async function saveAll(showToast = false) {
      const merged = document.createElement('canvas');
      merged.width = W;
      merged.height = H;
      const mctx = merged.getContext('2d');
      mctx.drawImage(baseImg, 0, 0);
      mctx.drawImage(strokeCanvas, 0, 0);
      mctx.drawImage(paperCanvas, 0, 0);
      mctx.drawImage(tapeCanvas, 0, 0);
      const blob = await new Promise(r => merged.toBlob(r, 'image/png'));
      await dbPut('images', {
        ...img,
        annotatedBlob: blob,
        updatedAt: new Date().toISOString(),
      });
      store.saveTape(imageId, tapeLayer.getTapes());
      store.savePaper(imageId, paperLayer.getPapers());
      dirty = false;
      if (showToast) toastSuccess('已保存');
    }

    updateSubToolbar();
  });
}