import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { uuid } from '../utils/id.js';
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

export function createPaperLayer(canvas, W, H, imageId) {
  const ctx = canvas.getContext('2d');
  let papers = store.getPaper(imageId);
  let selected = null;

  function redraw() {
    ctx.clearRect(0, 0, W, H);
    papers.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    papers.forEach(p => { if (p.visible !== false) drawPaper(ctx, p); });
    if (selected) drawSelection(ctx, selected);
  }

  function drawPaper(ctx, p) {
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.rotate((p.rotation || 0) * Math.PI / 180);
    ctx.translate(-p.w / 2, -p.h / 2);

    ctx.shadowColor = 'rgba(0,0,0,.12)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = p.bgColor || '#FFFFFF';
    ctx.fillRect(0, 0, p.w, p.h);

    if (p.style === 'lined') {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      for (let y = 24; y < p.h; y += 24) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(p.w, y); ctx.stroke();
      }
      ctx.strokeStyle = '#F4A6A6';
      ctx.beginPath(); ctx.moveTo(32, 0); ctx.lineTo(32, p.h); ctx.stroke();
    } else if (p.style === 'grid') {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(219,234,254,.6)';
      ctx.lineWidth = 1;
      for (let x = 0; x < p.w; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, p.h); ctx.stroke();
      }
      for (let y = 0; y < p.h; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(p.w, y); ctx.stroke();
      }
    } else if (p.style === 'note') {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(0,0,0,.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x < p.w; x += 16) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, p.h); ctx.stroke();
      }
      for (let y = 0; y < p.h; y += 16) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(p.w, y); ctx.stroke();
      }
    } else if (p.style === 'sticky') {
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillRect(0, 0, p.w, 8);
    }

    // 纸张内的画笔笔迹
    if (p.strokes && p.strokes.length) {
      ctx.shadowColor = 'transparent';
      p.strokes.forEach(s => {
        if (s.points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
        // 如果这个 stroke 被选中，画虚线框
        if (s === p._selectedStroke) {
          ctx.strokeStyle = '#3B82F6';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          const xs = s.points.map(pt => pt.x);
          const ys = s.points.map(pt => pt.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          ctx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8);
        }
        ctx.restore();
      });
    }

    // 纸张内的胶带
    if (p.tapes && p.tapes.length) {
      ctx.shadowColor = 'transparent';
      p.tapes.forEach(t => {
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
        ctx.restore();
      });
    }

    // 文字
    if (p.text) {
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = p.textStyle?.color || '#2B2D42';
      const fs = p.textStyle?.fontSize || 16;
      ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
      ctx.textAlign = p.textStyle?.align || 'left';
      const tx = p.textStyle?.align === 'center' ? p.w / 2 : p.textStyle?.align === 'right' ? p.w - 12 : 12;
      const lines = wrapText(ctx, p.text, p.w - 24);
      lines.forEach((line, i) => {
        const displayLine = line.replace(/ /g, '\u00A0');
        ctx.fillText(displayLine, tx, fs + 8 + i * (fs + 4));
      });
    }

    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');
    paragraphs.forEach(par => {
      let line = '';
      for (const ch of par) {
        if (ctx.measureText(line + ch).width > maxWidth) {
          lines.push(line); line = ch;
        } else line += ch;
      }
      lines.push(line);
    });
    return lines;
  }

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
    [[0, 0], [p.w / 2, 0], [p.w, 0], [p.w, p.h / 2], [p.w, p.h], [p.w / 2, p.h], [0, p.h], [0, p.h / 2]].forEach(([x, y]) => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3B82F6';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.strokeRect(x - 4, y - 4, 8, 8);
    });
    // 旋转手柄：顶部中间上方 20px
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

  return {
    getImageId() { return imageId; },
    getPapers() { return papers; },
    addPaper(styleId) {
      const style = PAPER_STYLES.find(s => s.id === styleId) || PAPER_STYLES[0];
      const p = {
        id: uuid(),
        x: W * 0.3, y: H * 0.3,
        w: Math.min(style.w || 200, W * 0.5),
        h: Math.min(style.h || 200, H * 0.5),
        rotation: 0,
        style: style.id, bgColor: style.bg,
        text: '', textStyle: { fontSize: 16, color: '#2B2D42', align: 'left' },
        strokes: [],
        tapes: [],
        visible: true, zIndex: papers.length,
        createdAt: new Date().toISOString(),
      };
      papers.push(p);
      store.savePaper(imageId, papers);
      selected = p;
      redraw();
      return p;
    },
    removeSelected() {
      if (!selected) return;
      // 清理这张纸可能打开的 textarea
      document.querySelectorAll('textarea[data-paper-editor]').forEach(t => t.remove());
      papers = papers.filter(p => p.id !== selected.id);
      selected = null;
      store.savePaper(imageId, papers);
      redraw();
    },
    duplicateSelected() {
      if (!selected) return;
      const copy = { ...selected, id: uuid(), x: selected.x + 20, y: selected.y + 20, strokes: JSON.parse(JSON.stringify(selected.strokes || [])), tapes: JSON.parse(JSON.stringify(selected.tapes || [])) };
      papers.push(copy);
      selected = copy;
      store.savePaper(imageId, papers);
      redraw();
    },
    hitTest(x, y) {
      for (let i = papers.length - 1; i >= 0; i--) {
        const p = papers[i];
        if (p.visible === false) continue;
        // 反旋转到纸张局部坐标
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
    },
    select(p) { selected = p; redraw(); },
    getSelected() { return selected; },
    moveSelected(dx, dy) {
      if (!selected) return;
      selected.x += dx; selected.y += dy;
      store.savePaper(imageId, papers);
      redraw();
    },
    resizeSelected(dx, dy) {
      if (!selected) return;
      selected.w = Math.max(60, selected.w + dx);
      selected.h = Math.max(40, selected.h + dy);
      store.savePaper(imageId, papers);
      redraw();
    },
    setText(text) {
      if (!selected) return;
      selected.text = text;
      store.savePaper(imageId, papers);
      redraw();
    },
    setStyle(patch) {
      if (!selected) return;
      Object.assign(selected, patch);
      store.savePaper(imageId, papers);
      redraw();
    },
    startResize(handle, startX, startY) {
      if (!selected) return null;
      const orig = { x: selected.x, y: selected.y, w: selected.w, h: selected.h };
      return {
        move(clientX, clientY) {
          const dx = clientX - startX;
          const dy = clientY - startY;
          let { x, y, w, h } = orig;
          if (handle.includes('e')) w = Math.max(60, orig.w + dx);
          if (handle.includes('s')) h = Math.max(40, orig.h + dy);
          if (handle.includes('w')) { w = Math.max(60, orig.w - dx); x = orig.x + (orig.w - w); }
          if (handle.includes('n')) { h = Math.max(40, orig.h - dy); y = orig.y + (orig.h - h); }
          selected.x = x; selected.y = y; selected.w = w; selected.h = h;
          redraw();
        },
        end() { store.savePaper(imageId, papers); },
      };
    },

    startRotate(startX, startY) {
      if (!selected) return null;
      const cx = selected.x + selected.w / 2;
      const cy = selected.y + selected.h / 2;
      const startAngle = Math.atan2(startY - cy, startX - cx);
      const origRotation = selected.rotation || 0;
      return {
        move(clientX, clientY) {
          const angle = Math.atan2(clientY - cy, clientX - cx);
          let deg = origRotation + (angle - startAngle) * 180 / Math.PI;
          // 吸附 15°
          deg = Math.round(deg / 15) * 15;
          selected.rotation = deg;
          redraw();
        },
        end() { store.savePaper(imageId, papers); },
      };
    },
    redraw,
    save() { store.savePaper(imageId, papers); },
  };
}

export function renderPaperToolbar(paperLayer) {
  const bar = el('div', { class: 'paper-toolbar' });

  bar.appendChild(el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '样式' }),
    ...PAPER_STYLES.map(s => el('button', {
      class: 'tape-chip', text: s.label,
      onClick: () => {
        paperLayer.addPaper(s.id);
        bar.dispatchEvent(new CustomEvent('paper-added'));
      },
    })),
  ]));

  bar.appendChild(el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '背景色' }),
    renderColorPicker({
      current: '#FFFFFF',
      onChange: (c) => paperLayer.setStyle({ bgColor: c }),
    }),
  ]));

  bar.appendChild(el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '文字' }),
    el('button', {
      class: 'tape-chip', text: '编辑文字',
      onClick: () => {
        const sel = paperLayer.getSelected();
        if (!sel) { alert('请先选中一张纸'); return; }
        const text = prompt('输入文字', sel.text || '');
        if (text !== null) paperLayer.setText(text);
      },
    }),
    (() => {
      const sizeNum = el('input', {
        type: 'number', min: '10', max: '48', value: '16',
        style: { width: '48px', padding: '4px 6px', fontSize: '13px', textAlign: 'center' },
        onInput: (e) => {
          const sel = paperLayer.getSelected();
          if (sel) paperLayer.setStyle({ textStyle: { ...sel.textStyle, fontSize: Number(e.target.value) } });
        },
      });
      const sizeMinus = el('button', {
        class: 'btn btn-sm btn-ghost', text: '−',
        style: { minWidth: '22px', padding: '0 3px', fontSize: '13px', minHeight: '28px' },
        onClick: () => {
          const v = Math.max(10, Number(sizeNum.value) - 1);
          sizeNum.value = v;
          const sel = paperLayer.getSelected();
          if (sel) paperLayer.setStyle({ textStyle: { ...sel.textStyle, fontSize: v } });
        },
      });
      const sizePlus = el('button', {
        class: 'btn btn-sm btn-ghost', text: '+',
        style: { minWidth: '22px', padding: '0 3px', fontSize: '13px', minHeight: '28px' },
        onClick: () => {
          const v = Math.min(48, Number(sizeNum.value) + 1);
          sizeNum.value = v;
          const sel = paperLayer.getSelected();
          if (sel) paperLayer.setStyle({ textStyle: { ...sel.textStyle, fontSize: v } });
        },
      });
      return el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [sizeMinus, sizeNum, sizePlus]);
    })(),
    renderColorPicker({
      current: '#2B2D42',
      onChange: (c) => {
        const sel = paperLayer.getSelected();
        if (sel) paperLayer.setStyle({ textStyle: { ...sel.textStyle, color: c } });
      },
    }),
  ]));

  bar.appendChild(el('div', { class: 'tape-row' }, [
    el('button', { class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => paperLayer.duplicateSelected() }),
    el('button', { class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: () => paperLayer.removeSelected() }),
  ]));

    // 【笔迹管理】
    bar.appendChild(el('div', { class: 'tape-row' }, [
      el('span', { class: 'tape-label', text: '笔迹' }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '👆 点击选中',
        onClick: () => toastSuccess('点击纸张上的笔迹可选中'),
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '🗑 删除选中',
        onClick: () => {
          const sel = paperLayer.getSelected();
          if (!sel || !sel._selectedStroke) { alert('请先选中一张纸，再点击笔迹'); return; }
          sel.strokes = sel.strokes.filter(s => s !== sel._selectedStroke);
          sel._selectedStroke = null;
          store.savePaper(paperLayer.getImageId(), paperLayer.getPapers());
          paperLayer.redraw();
          toastSuccess('已删除笔迹');
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🎨 改颜色',
        onClick: () => {
          const sel = paperLayer.getSelected();
          if (!sel || !sel._selectedStroke) { alert('请先选中笔迹'); return; }
          const color = prompt('输入颜色（如 #EF476F）', sel._selectedStroke.color);
          if (color) {
            sel._selectedStroke.color = color;
            store.savePaper(paperLayer.getImageId(), paperLayer.getPapers());   // ← 改这里
            paperLayer.redraw();
          }
        },
      }),
    ]));

  return bar;
}