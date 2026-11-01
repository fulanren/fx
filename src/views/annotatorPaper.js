import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { uuid } from '../utils/id.js';

const PAPER_STYLES = [
  { id: 'note', label: '📄 便签', bg: '#FDF6E3' },
  { id: 'sticky', label: '🟨 便利贴', bg: '#FFF3B0' },
  { id: 'lined', label: '📝 横线', bg: '#FFFFFF' },
  { id: 'grid', label: '🗒 方格', bg: '#FFFFFF' },
  { id: 'tag', label: '🏷 标签条', bg: '#FFFFFF' },
  { id: 'blank', label: '🧾 空白', bg: '#FFFFFF' },
];

export function createPaperLayer(canvas, W, H, imageId) {
  const ctx = canvas.getContext('2d');
  let papers = store.getPaper(imageId);
  let selected = null;
  let editingText = null; // 正在编辑文字的纸张

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

    if (p.text) {
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = p.textStyle?.color || '#2B2D42';
      const fs = p.textStyle?.fontSize || 16;
      ctx.font = `${fs}px -apple-system, "PingFang SC", sans-serif`;
      ctx.textAlign = p.textStyle?.align || 'left';
      const tx = p.textStyle?.align === 'center' ? p.w / 2 : p.textStyle?.align === 'right' ? p.w - 12 : 12;
      const lines = wrapText(ctx, p.text, p.w - 24);
      lines.forEach((line, i) => {
        ctx.fillText(line, tx, fs + 8 + i * (fs + 4));
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
    [[0,0],[p.w/2,0],[p.w,0],[p.w,p.h/2],[p.w,p.h],[p.w/2,p.h],[0,p.h],[0,p.h/2]].forEach(([x, y]) => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3B82F6';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.strokeRect(x - 4, y - 4, 8, 8);
    });
    ctx.restore();
  }

  return {
    getPapers() { return papers; },
    addPaper(styleId) {
      const style = PAPER_STYLES.find(s => s.id === styleId) || PAPER_STYLES[0];
      const p = {
        id: uuid(),
        x: W * 0.3, y: H * 0.3,
        w: Math.min(200, W * 0.4), h: Math.min(200, H * 0.3),
        rotation: 0,
        style: style.id, bgColor: style.bg,
        text: '', textStyle: { fontSize: 16, color: '#2B2D42', align: 'left' },
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
      papers = papers.filter(p => p.id !== selected.id);
      selected = null;
      store.savePaper(imageId, papers);
      redraw();
    },
    duplicateSelected() {
      if (!selected) return;
      const copy = { ...selected, id: uuid(), x: selected.x + 20, y: selected.y + 20 };
      papers.push(copy);
      selected = copy;
      store.savePaper(imageId, papers);
      redraw();
    },
    hitTest(x, y) {
      for (let i = papers.length - 1; i >= 0; i--) {
        const p = papers[i];
        if (p.visible === false) continue;
        if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
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
    // 拖拽调整大小
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
        end() {
          store.savePaper(imageId, papers);
        },
      };
    },
    redraw,
    save() { store.savePaper(imageId, papers); },
  };
}

export function renderPaperToolbar(paperLayer) {
  const bar = el('div', { class: 'paper-toolbar' });

  // 样式
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

  // 自定义颜色
  const colorInput = el('input', {
    type: 'color', value: '#FFFFFF',
    style: { width: '32px', height: '32px', border: 'none', background: 'transparent', cursor: 'pointer' },
    onInput: (e) => {
      paperLayer.setStyle({ bgColor: e.target.value });
    },
  });
  bar.appendChild(el('div', { class: 'tape-row' }, [
    el('span', { class: 'tape-label', text: '背景色' }),
    colorInput,
  ]));

  // 文字样式
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
    el('input', {
      type: 'number', min: '10', max: '48', value: '16',
      style: { width: '56px', padding: '4px 6px', fontSize: '13px' },
      onInput: (e) => {
        const sel = paperLayer.getSelected();
        if (sel) paperLayer.setStyle({ textStyle: { ...sel.textStyle, fontSize: Number(e.target.value) } });
      },
    }),
    el('input', {
      type: 'color', value: '#2B2D42',
      style: { width: '32px', height: '32px', border: 'none', background: 'transparent', cursor: 'pointer' },
      onInput: (e) => {
        const sel = paperLayer.getSelected();
        if (sel) paperLayer.setStyle({ textStyle: { ...sel.textStyle, color: e.target.value } });
      },
    }),
  ]));

  // 操作
  bar.appendChild(el('div', { class: 'tape-row' }, [
    el('button', { class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => paperLayer.duplicateSelected() }),
    el('button', { class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: () => paperLayer.removeSelected() }),
  ]));

  return bar;
}