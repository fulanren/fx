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

const TOOL_NAMES = {
  pen: '画笔', eraser: '橡皮', 'circle-erase': '圈擦', text: '文字',
  arrow: '箭头', rect: '矩形', line: '直线', wave: '波浪',
  tape: '胶带', paper: '纸张', hand: '抓手',
};

export function renderAnnotator({ params, query }) {
  if (window.__annotatorActive && window.__annotatorCleanup) {
    try { window.__annotatorCleanup(); } catch {}
  }
  window.__annotatorActive = true;
  window.__saveAll = null;

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
  let eraseShape = 'rect';
  let waveAmplitude = 8;
  let penOnly = false;
  const toolWidths = { pen: 4, eraser: 20, 'circle-erase': 10 };

  const goBack = async () => {
    if (dirty) {
      const r = await confirmBox({
        title: '未保存',
        message: '有未保存的标注，是否保存？',
        confirmText: '保存并返回',
        cancelText: '放弃',
        extra: { label: '继续编辑', value: 'stay' },
      });
      if (r === true) {
        if (window.__saveAll) { try { await window.__saveAll(); } catch (e) { console.error(e); } }
        dirty = false;
        doNavigateBack();
        return;
      }
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

    const previewCanvas = el('canvas', { class: 'preview-canvas' });
    previewCanvas.width = W; previewCanvas.height = H;
    const previewCtx = previewCanvas.getContext('2d');

    let lastPreviewPos = null;
    function updateEraserPreview(pt, radius) {
      if (lastPreviewPos) {
        previewCtx.clearRect(
          lastPreviewPos.x - lastPreviewPos.r - 4,
          lastPreviewPos.y - lastPreviewPos.r - 4,
          lastPreviewPos.r * 2 + 8,
          lastPreviewPos.r * 2 + 8
        );
      }
      previewCtx.save();
      previewCtx.strokeStyle = 'rgba(59,130,246,.8)';
      previewCtx.lineWidth = 2;
      previewCtx.beginPath();
      previewCtx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      previewCtx.stroke();
      previewCtx.restore();
      lastPreviewPos = { x: pt.x, y: pt.y, r: radius };
    }
    function clearPreview() {
      previewCtx.clearRect(0, 0, W, H);
      lastPreviewPos = null;
    }

    canvasWrap.appendChild(base);
    canvasWrap.appendChild(paperCanvas);
    canvasWrap.appendChild(strokeCanvas);
    canvasWrap.appendChild(tapeCanvas);
    canvasWrap.appendChild(previewCanvas);
    wrap.appendChild(canvasWrap);
    view.appendChild(wrap);

    const zoomLabel = el('div', { class: 'zoom-label', text: '100%' });
    wrap.appendChild(zoomLabel);

    if (img.strokeBlob) {
      const strokeUrl = URL.createObjectURL(img.strokeBlob);
      const strokeImg = new Image();
      strokeImg.src = strokeUrl;
      await new Promise(r => { strokeImg.onload = r; });
      ctx.drawImage(strokeImg, 0, 0);
      URL.revokeObjectURL(strokeUrl);
    } else if (img.annotatedBlob && img.annotatedBlob !== img.originalBlob) {
      const annotUrl = URL.createObjectURL(img.annotatedBlob);
      const annotImg = new Image();
      annotImg.src = annotUrl;
      await new Promise(r => { annotImg.onload = r; });
      ctx.drawImage(annotImg, 0, 0);
      URL.revokeObjectURL(annotUrl);
    }

    paperLayer.redraw();
    tapeLayer.redraw();
        // ============ 长按提示 ============
        let longPressTimer = null;
        let tooltipEl = null;
        function showTooltip(btn, name) {
          hideTooltip();
          const rect = btn.getBoundingClientRect();
          tooltipEl = el('div', {
            style: {
              position: 'fixed',
              left: rect.left + rect.width / 2 + 'px',
              top: rect.top - 8 + 'px',
              transform: 'translate(-50%, -100%)',
              background: 'rgba(43,45,66,.95)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: '999',
            },
            text: name,
          });
          document.body.appendChild(tooltipEl);
        }
        function hideTooltip() {
          if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
        }
        function attachLongPress(btn, text) {
          btn.addEventListener('pointerdown', () => {
            longPressTimer = setTimeout(() => showTooltip(btn, text), 500);
          });
          btn.addEventListener('pointerup', () => {
            clearTimeout(longPressTimer);
            setTimeout(hideTooltip, 800);
          });
          btn.addEventListener('pointerleave', () => {
            clearTimeout(longPressTimer);
            hideTooltip();
          });
        }
    
        // ============ 顶栏动态按钮 ============
        const dynBar = document.getElementById('topbar-dynamic');
        if (dynBar) {
          dynBar.innerHTML = '';
          const mk = (text, title, onClick) => {
            const b = el('button', { class: 'btn btn-sm btn-ghost', text, title, onClick });
            attachLongPress(b, title);
            dynBar.appendChild(b);
          };
          mk('←', '左移', () => { offsetX += 40; updateTransform(); });
          mk('→', '右移', () => { offsetX -= 40; updateTransform(); });
          mk('↑', '上移', () => { offsetY += 40; updateTransform(); });
          mk('↓', '下移', () => { offsetY -= 40; updateTransform(); });
          mk('↶', '撤销', undo);
          mk('🗑', '清除', clearAll);
          mk('➕', '扩展画布', openExpandDialog);
          const saveBtn = el('button', { class: 'btn btn-sm btn-primary', text: '💾', title: '保存', onClick: () => { if (window.__saveAll) window.__saveAll(true); } });
          attachLongPress(saveBtn, '保存');
          dynBar.appendChild(saveBtn);
        }
    
        // ============ 工具栏 ============
        const toolBar = el('div', { class: 'annotator-toolbar' });
        function setActiveTool(id) {
          if (currentTool in toolWidths) toolWidths[currentTool] = currentWidth;
          currentTool = id;
          if (id in toolWidths) currentWidth = toolWidths[id];
          const wr = document.querySelector('.annotator-widthrow input[type="range"]');
          const wn = document.querySelector('.annotator-widthrow input[type="number"]');
          if (wr) wr.value = currentWidth;
          if (wn) wn.value = currentWidth;
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
          attachLongPress(btn, TOOL_NAMES[t.id] || t.id);
          toolBar.appendChild(btn);
        });
    
        const penOnlyBtn = el('button', {
          class: 'tool-btn' + (penOnly ? ' active' : ''),
          text: '✍️',
          title: '仅触控笔',
          onClick: () => {
            penOnly = !penOnly;
            penOnlyBtn.classList.toggle('active', penOnly);
            toastSuccess(penOnly ? '防触控已开启' : '防触控已关闭');
          },
        });
        attachLongPress(penOnlyBtn, '仅触控笔');
        toolBar.appendChild(penOnlyBtn);
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
              paperToolbar.addEventListener('paper-added', () => { dirty = true; });
            }
            subBar.appendChild(paperToolbar);
          } else if (currentTool === 'circle-erase') {
            const shapeRow = el('div', { class: 'tape-row' }, [
              el('span', { class: 'tape-label', text: '形状' }),
              ...['rect', 'circle'].map(s => el('button', {
                class: 'tape-chip' + (eraseShape === s ? ' active' : ''),
                text: s === 'rect' ? '▭ 矩形' : '○ 圆形',
                onClick: (ev) => {
                  eraseShape = s;
                  shapeRow.querySelectorAll('.tape-chip').forEach(b => b.classList.remove('active'));
                  ev.target.classList.add('active');
                },
              })),
            ]);
            subBar.appendChild(shapeRow);
          } else if (currentTool === 'wave') {
            const waveLabel = el('span', { text: String(waveAmplitude), style: { fontSize: '12px', minWidth: '24px' } });
            const waveRange = el('input', {
              type: 'range', min: '2', max: '30', value: String(waveAmplitude),
              style: { flex: '1' },
              onInput: (e) => { waveAmplitude = Number(e.target.value); waveLabel.textContent = waveAmplitude; },
            });
            subBar.appendChild(el('div', { class: 'tape-row' }, [
              el('span', { class: 'tape-label', text: '波幅' }),
              waveRange,
              waveLabel,
            ]));
          }
        }
    
        // ============ 颜色 ============
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
          attachLongPress(dot, '颜色 ' + c);
          colorBar.appendChild(dot);
        });
        const customColor = el('input', {
          type: 'color', value: currentColor, title: '自定义颜色',
          style: { width: '32px', height: '32px', border: 'none', background: 'transparent', cursor: 'pointer', padding: '0', flexShrink: '0' },
          onInput: (e) => {
            currentColor = e.target.value;
            colorBar.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
          },
        });
        colorBar.appendChild(customColor);
        view.appendChild(colorBar);
    
        // ============ 粗细 ============
        const widthNum = el('input', {
          type: 'number', min: '1', max: '100', value: String(currentWidth),
          style: { width: '56px', padding: '4px 6px', fontSize: '13px' },
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
        const widthRow = el('div', { class: 'annotator-widthrow' }, [
          el('span', { text: '粗细', style: { fontSize: '13px', color: 'var(--text-2)' } }),
          widthRange,
          widthNum,
        ]);
        view.appendChild(widthRow);
    
        // ============ 撤销栈 ============
        const undoStack = [];
        undoStack.push({
          stroke: ctx.getImageData(0, 0, W, H),
          paper: JSON.parse(JSON.stringify(paperLayer.getPapers())),
          tape: JSON.parse(JSON.stringify(tapeLayer.getTapes())),
        });
    
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
          const mask = el('div', { class: 'confirm-mask' }, [
            el('div', { class: 'confirm-box', style: { maxWidth: '300px' } }, [
              el('h3', { text: '清除' }),
              el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '12px 0' } }, [
                el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [el('input', { type: 'checkbox', id: 'clr-stroke', checked: true }), ' 笔迹']),
                el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [el('input', { type: 'checkbox', id: 'clr-tape', checked: true }), ' 胶带']),
                el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [el('input', { type: 'checkbox', id: 'clr-paper', checked: true }), ' 纸张']),
              ]),
              el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                el('button', {
                  class: 'btn btn-danger', text: '清除',
                  onClick: () => {
                    pushUndo();
                    if (document.getElementById('clr-stroke').checked) ctx.clearRect(0, 0, W, H);
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
                    dirty = true;
                    mask.remove();
                  },
                }),
              ]),
            ]),
          ]);
          document.body.appendChild(mask);
        }
    
        // ============ 扩展画布 ============
        function openExpandDialog() {
          const mask = el('div', { class: 'confirm-mask' }, [
            el('div', { class: 'confirm-box', style: { maxWidth: '360px' } }, [
              el('h3', { text: '扩展画布' }),
              el('div', { class: 'field' }, [
                el('label', { text: '方向' }),
                el('select', { id: 'expand-dir' }, [
                  el('option', { value: 'top', text: '↑ 上方' }),
                  el('option', { value: 'bottom', text: '↓ 下方' }),
                  el('option', { value: 'left', text: '← 左侧' }),
                  el('option', { value: 'right', text: '→ 右侧' }),
                ]),
              ]),
              el('div', { class: 'field' }, [
                el('label', { text: '扩展到' }),
                el('select', { id: 'expand-target' }, [
                  el('option', { value: 'custom', text: '自定义像素' }),
                  el('option', { value: 'image', text: '与图片一致（不扩展）' }),
                  el('option', { value: 'pdf', text: '与 A4 PDF 一致' }),
                  el('option', { value: 'paper', text: '与纸张一致' }),
                ]),
              ]),
              el('div', { class: 'field' }, [
                el('label', { text: '扩展像素' }),
                el('input', { type: 'number', id: 'expand-px', value: '200', min: '50', max: '2000' }),
              ]),
              el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                el('button', {
                  class: 'btn btn-primary', text: '扩展',
                  onClick: async () => {
                    const dir = document.getElementById('expand-dir').value;
                    const target = document.getElementById('expand-target').value;
                    let px = Math.max(50, Math.min(2000, Number(document.getElementById('expand-px').value) || 200));
    
                    if (target === 'image') { toastError('当前已是图片尺寸，无需扩展'); return; }
                    if (target === 'pdf') {
                      const A4W = 2480, A4H = 3508;
                      if (dir === 'top' || dir === 'bottom') px = A4H - H;
                      else px = A4W - W;
                      if (px <= 0) { toastError('当前尺寸已超过 A4，无需扩展'); return; }
                    } else if (target === 'paper') {
                      const sel = paperLayer.getSelected();
                      if (sel) {
                        if (dir === 'top' || dir === 'bottom') px = Math.max(50, Math.round(sel.h));
                        else px = Math.max(50, Math.round(sel.w));
                      } else {
                        toastError('请先选中一张纸'); return;
                      }
                    }
    
                    if (px <= 0) { toastError('无需扩展'); return; }
                    mask.remove();
                    await doExpand(dir, px);
                  },
                }),
              ]),
            ]),
          ]);
          document.body.appendChild(mask);
        }
    
        async function doExpand(dir, px) {
          const newW = dir === 'left' || dir === 'right' ? W + px : W;
          const newH = dir === 'top' || dir === 'bottom' ? H + px : H;
          const dx = dir === 'left' ? px : 0;
          const dy = dir === 'top' ? px : 0;
    
          const newOriginal = document.createElement('canvas');
          newOriginal.width = newW; newOriginal.height = newH;
          const octx = newOriginal.getContext('2d');
          octx.fillStyle = '#FFFFFF';
          octx.fillRect(0, 0, newW, newH);
          octx.drawImage(baseImg, dx, dy);
    
          const newStroke = document.createElement('canvas');
          newStroke.width = newW; newStroke.height = newH;
          newStroke.getContext('2d').drawImage(strokeCanvas, dx, dy);
    
          paperLayer.getPapers().forEach(p => { p.x += dx; p.y += dy; });
          tapeLayer.getTapes().forEach(t => { t.points.forEach(pt => { pt.x += dx; pt.y += dy; }); });
          store.savePaper(imageId, paperLayer.getPapers());
          store.saveTape(imageId, tapeLayer.getTapes());
    
          const originalBlob = await new Promise(r => newOriginal.toBlob(r, 'image/png'));
          const strokeBlob = await new Promise(r => newStroke.toBlob(r, 'image/png'));
          const annotatedBlob = await new Promise(r => {
            const m = document.createElement('canvas');
            m.width = newW; m.height = newH;
            const mctx = m.getContext('2d');
            mctx.drawImage(newOriginal, 0, 0);
            mctx.drawImage(newStroke, 0, 0);
            m.toBlob(r, 'image/png');
          });
    
          await dbPut('images', {
            ...img,
            originalBlob, strokeBlob, annotatedBlob,
            width: newW, height: newH,
            updatedAt: new Date().toISOString(),
          });
    
          toastSuccess(`已扩展 ${px}px`);
          setTimeout(() => {
            renderAnnotator({ params: { id: imageId }, query: { pointId } });
          }, 300);
        }
            // ============ 文字编辑 ============
    function openTextEditor(pos) {
      const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '380px' } }, [
          el('h3', { text: '添加文字' }),
          el('div', { class: 'field' }, [
            el('label', { text: '文字' }),
            el('textarea', { id: 'text-input', placeholder: '输入文字', style: { minHeight: '60px' } }),
          ]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { text: '字号' }),
              el('input', { type: 'number', id: 'text-size', value: '20', min: '10', max: '80' }),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: '文字颜色' }),
              el('input', { type: 'color', id: 'text-color', value: currentColor }),
            ]),
          ]),
          el('div', { class: 'field' }, [
            el('label', { text: '字体' }),
            el('select', { id: 'text-font' }, [
              el('option', { value: 'sans-serif', text: '黑体' }),
              el('option', { value: 'serif', text: '宋体' }),
              el('option', { value: 'monospace', text: '等宽' }),
            ]),
          ]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { text: '框宽（0=自适应）' }),
              el('input', { type: 'number', id: 'text-width', value: '0', min: '0' }),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: '框高（0=自适应）' }),
              el('input', { type: 'number', id: 'text-height', value: '0', min: '0' }),
            ]),
          ]),
          el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } }, [
            el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' } }, [
              el('input', { type: 'checkbox', id: 'text-no-bg' }),
              '无色背景',
            ]),
            el('input', { type: 'color', id: 'text-bg', value: '#FFFFFF', style: { width: '32px', height: '32px', border: 'none' } }),
          ]),
          el('div', { class: 'confirm-actions' }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
            el('button', {
              class: 'btn btn-primary', text: '添加',
              onClick: () => {
                const text = document.getElementById('text-input').value;
                const size = Number(document.getElementById('text-size').value) || 20;
                const color = document.getElementById('text-color').value;
                const font = document.getElementById('text-font').value;
                const noBg = document.getElementById('text-no-bg').checked;
                const bg = document.getElementById('text-bg').value;
                const fixedW = Number(document.getElementById('text-width').value) || 0;
                const fixedH = Number(document.getElementById('text-height').value) || 0;
                if (!text) { alert('请输入文字'); return; }
                pushUndo();
                ctx.save();
                ctx.font = `${size}px ${font}`;
                const lines = text.split('\n');
                const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
                const lineH = size + 4;
                const totalH = lines.length * lineH;
                const boxW = fixedW > 0 ? fixedW : maxW + 8;
                const boxH = fixedH > 0 ? fixedH : totalH + 4;
                if (!noBg) {
                  ctx.fillStyle = bg;
                  ctx.fillRect(pos.x - 4, pos.y - size, boxW, boxH);
                }
                ctx.fillStyle = color;
                lines.forEach((line, i) => {
                  ctx.fillText(line, pos.x, pos.y + i * lineH);
                });
                ctx.restore();
                dirty = true;
                mask.remove();
                setActiveTool('pen');
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);
    }

    // ============ 纸张文字编辑 ============
    function openPaperTextEditor(paper) {
      const rect = strokeCanvas.getBoundingClientRect();
      const sx = rect.width / W;
      const sy = rect.height / H;

      const ta = el('textarea', {
        value: paper.text || '',
        placeholder: '输入文字…',
        style: {
          position: 'fixed',
          left: (rect.left + paper.x * sx + 4) + 'px',
          top: (rect.top + paper.y * sy + 4) + 'px',
          width: Math.max(80, paper.w * sx - 8) + 'px',
          height: Math.max(40, paper.h * sy - 8) + 'px',
          fontSize: Math.max(12, (paper.textStyle?.fontSize || 16) * sx) + 'px',
          color: paper.textStyle?.color || '#2B2D42',
          background: 'rgba(255,255,255,.95)',
          border: '2px solid #3B82F6',
          borderRadius: '6px',
          padding: '4px 6px',
          resize: 'none',
          zIndex: '999',
          outline: 'none',
          fontFamily: '-apple-system, "PingFang SC", sans-serif',
        },
      });

      function finish() {
        const val = ta.value;
        ta.remove();
        if (val !== paper.text) {
          pushUndo();
          paper.text = val;
          paperLayer.save();
          paperLayer.redraw();
          dirty = true;
        }
        document.removeEventListener('pointerdown', outsideClick, true);
        document.removeEventListener('keydown', onKey, true);
      }
      function outsideClick(e) {
        if (!ta.contains(e.target)) finish();
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          ta.remove();
          document.removeEventListener('pointerdown', outsideClick, true);
          document.removeEventListener('keydown', onKey, true);
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish();
      }

      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      setTimeout(() => {
        document.addEventListener('pointerdown', outsideClick, true);
        document.addEventListener('keydown', onKey, true);
      }, 50);
    }

    // ============ 手势 ============
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
    previewCanvas.style.pointerEvents = 'none';

    strokeCanvas.addEventListener('pointerdown', (e) => {
      if (penOnly && e.pointerType === 'touch') return;

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
        const sel = paperLayer.getSelected();

        if (sel) {
          const handles = [
            { id: 'nw', x: sel.x, y: sel.y },
            { id: 'ne', x: sel.x + sel.w, y: sel.y },
            { id: 'sw', x: sel.x, y: sel.y + sel.h },
            { id: 'se', x: sel.x + sel.w, y: sel.y + sel.h },
            { id: 'n', x: sel.x + sel.w / 2, y: sel.y },
            { id: 's', x: sel.x + sel.w / 2, y: sel.y + sel.h },
            { id: 'w', x: sel.x, y: sel.y + sel.h / 2 },
            { id: 'e', x: sel.x + sel.w, y: sel.y + sel.h / 2 },
          ];
          const hitHandle = handles.find(h => Math.hypot(pt.x - h.x, pt.y - h.y) < 12);
          if (hitHandle) {
            paperDragOffset = paperLayer.startResize(hitHandle.id, pt.x, pt.y);
            drawing = 'paper-resize';
            return;
          }
        }

        const hit = paperLayer.hitTest(pt.x, pt.y);
        if (hit) {
          const now = Date.now();
          if (paperLayer._lastClickId === hit.id && now - (paperLayer._lastClickTime || 0) < 350) {
            paperLayer._lastClickId = null;
            paperLayer._lastClickTime = 0;
            openPaperTextEditor(hit);
            return;
          }
          paperLayer._lastClickId = hit.id;
          paperLayer._lastClickTime = now;

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
          tapeLayer.toggleVisible(hit.id);
          dirty = true;
          return;
        }
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
        if (currentTool === 'eraser') {
          const pt0 = points[0];
          eraseCircle(ctx, pt0.x, pt0.y, currentWidth * 2);
          tapeLayer.eraseAt(pt0.x, pt0.y, currentWidth * 2);
        }
      } else if (currentTool === 'circle-erase') {
        pushUndo();
        drawing = true;
        startPt = canvasToImage(e.clientX, e.clientY);
      } else if (currentTool === 'text') {
        const pos = canvasToImage(e.clientX, e.clientY);
        openTextEditor(pos);
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

      if (drawing === 'paper-resize') {
        const pt = canvasToImage(e.clientX, e.clientY);
        paperDragOffset.move(pt.x, pt.y);
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
        updateEraserPreview(pt, currentWidth * 2);
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
        clearPreview();
        previewCtx.save();
        previewCtx.strokeStyle = 'rgba(59,130,246,.9)';
        previewCtx.lineWidth = 2;
        previewCtx.setLineDash([6, 4]);
        if (eraseShape === 'rect') {
          previewCtx.strokeRect(
            Math.min(startPt.x, pt.x), Math.min(startPt.y, pt.y),
            Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y)
          );
        } else {
          const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
          previewCtx.beginPath();
          previewCtx.arc(startPt.x, startPt.y, r, 0, Math.PI * 2);
          previewCtx.stroke();
        }
        previewCtx.restore();
      } else {
        const snap = undoStack[undoStack.length - 1];
        if (snap) ctx.putImageData(snap.stroke, 0, 0);
        if (currentTool === 'arrow') drawArrow(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'rect') drawRect(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'line') drawLine(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth);
        else if (currentTool === 'wave') drawWave(ctx, startPt.x, startPt.y, pt.x, pt.y, currentColor, currentWidth, waveAmplitude);
      }
      dirty = true;
    });

    function drawTempTape(canvas, t) {
      const c = canvas.getContext('2d');
      c.save();
      c.fillStyle = t.color;
      c.strokeStyle = t.color;
      c.lineWidth = t.width;
      c.lineJoin = 'round';
      if (t.shape === 'line-round' || t.shape === 'line-square') {
        c.lineCap = t.shape === 'line-round' ? 'round' : 'butt';
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
      clearPreview();
      pointers.delete(e.pointerId);

      if (drawing === 'pan') { drawing = false; return; }
      if (drawing === 'paper-drag') {
        paperLayer.save();
        drawing = false;
        paperDragOffset = null;
        return;
      }
      if (drawing === 'paper-resize') {
        paperDragOffset.end();
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
        if (eraseShape === 'rect') {
          eraseRect(ctx, startPt.x, startPt.y, pt.x, pt.y);
        } else {
          const r = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
          eraseCircle(ctx, startPt.x, startPt.y, r);
        }
        tapeLayer.eraseAt((startPt.x + pt.x) / 2, (startPt.y + pt.y) / 2, Math.max(Math.abs(pt.x - startPt.x), Math.abs(pt.y - startPt.y)) / 2);
      }
      drawing = false;
      points = [];
      startPt = null;
      dirty = true;
    });

    strokeCanvas.addEventListener('pointercancel', (e) => {
      clearPreview();
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

    // ============ 保存 ============
    async function saveAll(showToast = false) {
      const strokeBlob = await new Promise(r => strokeCanvas.toBlob(r, 'image/png'));

      const merged = document.createElement('canvas');
      merged.width = W;
      merged.height = H;
      const mctx = merged.getContext('2d');
      mctx.drawImage(baseImg, 0, 0);
      mctx.drawImage(paperCanvas, 0, 0);
      mctx.drawImage(strokeCanvas, 0, 0);
      mctx.drawImage(tapeCanvas, 0, 0);
      const annotatedBlob = await new Promise(r => merged.toBlob(r, 'image/png'));

      await dbPut('images', {
        ...img,
        strokeBlob,
        annotatedBlob,
        updatedAt: new Date().toISOString(),
      });
      store.saveTape(imageId, tapeLayer.getTapes());
      store.savePaper(imageId, paperLayer.getPapers());
      dirty = false;
      if (showToast) toastSuccess('已保存');
    }

    window.__saveAll = saveAll;

    updateSubToolbar();

    window.__annotatorCleanup = () => {
      window.__annotatorActive = false;
      window.__saveAll = null;
      const w = document.querySelector('.annotator-wrap');
      if (w) w.remove();
    };
  });
}