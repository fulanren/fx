// src/views/annotatorText.js
// 文字图层：独立 canvas，支持文字对象创建、编辑、拖动、缩放、旋转、锁定

import { dbGet, dbPut } from '../db.js';
import { el } from '../utils/dom.js';

export function createTextLayer({ canvas, width, height, imageId, store }) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    canvas = document.createElement('canvas');
    canvas.width = width || 1;
    canvas.height = height || 1;
  }

  const ctx = canvas.getContext('2d');
  const W = width;
  const H = height;

  let items = [];
  let selectedId = null;
  let showLockIcons = true;

  // ============ 加载 / 保存 ============
  function load() {
    const saved = store.getTextItems ? store.getTextItems(imageId) : null;
    if (saved && Array.isArray(saved)) {
      items = saved;
    } else {
      try {
        const raw = localStorage.getItem('kg_text_' + imageId);
        if (raw) items = JSON.parse(raw);
      } catch { items = []; }
    }
  }

  function save() {
    if (store.saveTextItems) {
      store.saveTextItems(imageId, items);
    } else {
      localStorage.setItem('kg_text_' + imageId, JSON.stringify(items));
    }
  }

  // ============ 换行拆分 ============
  function wrapLines(text, maxWidth, fontSize, fontFamily) {
    if (!text) return [];
    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily || 'sans-serif'}`;
    const rawLines = text.split('\n');
    const result = [];
    rawLines.forEach(line => {
      if (line.length === 0) { result.push(''); return; }
      let current = '';
      for (const ch of line) {
        const test = current + ch;
        if (ctx.measureText(test).width > maxWidth && current.length > 0) {
          result.push(current);
          current = ch;
        } else {
          current = test;
        }
      }
      if (current.length > 0) result.push(current);
    });
    ctx.restore();
    return result;
  }

  // ============ 绘制单个文字 ============
  function drawItem(item) {
    const fs = item.fontSize || 20;
    const fontFamily = item.fontFamily || 'sans-serif';
    const lineHeight = item.lineHeight || 1.5;
    const color = item.color || '#2B2D42';
    const align = item.align || 'left';
    const rotation = (item.rotation || 0) * Math.PI / 180;
    const opacity = item.opacity !== undefined ? item.opacity : 1;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(item.x + item.w / 2, item.y + item.h / 2);
    ctx.rotate(rotation);
    ctx.translate(-item.w / 2, -item.h / 2);

    // 阴影
    if (item.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
      if (!item.noBg) {
        ctx.fillStyle = item.bgColor || '#FFFFFF';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, 0, item.w, item.h, 6);
        else ctx.rect(0, 0, item.w, item.h);
        ctx.fill();
      }
      ctx.restore();
    }

    // 背景
    if (!item.noBg) {
      ctx.save();
      ctx.fillStyle = item.bgColor || '#FFFFFF';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, item.w, item.h, 6);
      else ctx.rect(0, 0, item.w, item.h);
      ctx.fill();
      ctx.restore();
    }

    // 边框
    if (item.borderWidth > 0 && item.borderColor) {
      ctx.save();
      ctx.strokeStyle = item.borderColor;
      ctx.lineWidth = item.borderWidth;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, item.w, item.h, 6);
      else ctx.rect(0, 0, item.w, item.h);
      ctx.stroke();
      ctx.restore();
    }

    // 文字
    const lines = wrapLines(item.text || '', item.w - 16, fs, fontFamily);
    const totalH = lines.length * fs * lineHeight;
    const startY = (item.h - totalH) / 2 + fs;

    ctx.save();
    ctx.font = `${fs}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      let tx = 8;
      if (align === 'center') tx = (item.w - ctx.measureText(line).width) / 2;
      else if (align === 'right') tx = item.w - 8 - ctx.measureText(line).width;
      const displayLine = line.replace(/ /g, '\u00A0');
      ctx.fillText(displayLine, tx, startY - fs + i * fs * lineHeight);
    });
    ctx.restore();

    // 选中框
        if (selectedId === item.id) {
      ctx.save();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(0, 0, item.w, item.h);
      ctx.setLineDash([]);
      // 四角控制点加大到 12px
      [[0, 0], [item.w, 0], [item.w, item.h], [0, item.h]].forEach(([hx, hy]) => {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2;
        ctx.fillRect(hx - 6, hy - 6, 12, 12);
        ctx.strokeRect(hx - 6, hy - 6, 12, 12);
      });
      // 旋转手柄
      ctx.beginPath();
      ctx.moveTo(item.w / 2, 0);
      ctx.lineTo(item.w / 2, -20);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(item.w / 2, -20, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3B82F6';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 锁定图标
    if (item.locked && showLockIcons) {
      ctx.save();
      ctx.fillStyle = '#EF476F';
      ctx.font = '14px sans-serif';
      ctx.fillText('🔒', item.w - 16, -4);
      ctx.restore();
    }

    ctx.restore();
  }

  // ============ 重绘 ============
  function redraw() {
    ctx.clearRect(0, 0, W, H);
    items.forEach(item => {
      if (item.visible === false) return;
      drawItem(item);
    });
  }

  // ============ 命中检测 ============
  function hitTest(x, y) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.visible === false) continue;
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      const angle = -(it.rotation || 0) * Math.PI / 180;
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle) + it.w / 2;
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle) + it.h / 2;
      if (lx >= 0 && lx <= it.w && ly >= 0 && ly <= it.h) return it;
    }
    return null;
  }

  function hitHandle(x, y) {
    if (!selectedId) return null;
    const it = items.find(t => t.id === selectedId);
    if (!it) return null;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const angle = (it.rotation || 0) * Math.PI / 180;
    const handleX = cx + Math.sin(angle) * (it.h / 2 + 20);
    const handleY = cy - Math.cos(angle) * (it.h / 2 + 20);
    if (Math.hypot(x - handleX, y - handleY) < 20) return { id: 'rotate', x: handleX, y: handleY };
    const local = [
      { id: 'nw', x: 0, y: 0 },
      { id: 'ne', x: it.w, y: 0 },
      { id: 'se', x: it.w, y: it.h },
      { id: 'sw', x: 0, y: it.h },
    ];
    for (const h of local) {
      const lx = h.x - it.w / 2;
      const ly = h.y - it.h / 2;
      const rx = lx * Math.cos(angle) - ly * Math.sin(angle) + cx;
      const ry = lx * Math.sin(angle) + ly * Math.cos(angle) + cy;
      if (Math.hypot(x - rx, y - ry) < 22) return { id: h.id, x: rx, y: ry };
    }
    return null;
  }

  // ============ 选中 ============
  function select(item) {
    selectedId = item ? item.id : null;
    redraw();
  }

  function getSelected() {
    return items.find(t => t.id === selectedId) || null;
  }

  // ============ 创建 / 更新 / 删除 ============
  function addText(data) {
    const fs = data.fontSize || 20;
    const lines = (data.text || '').split('\n');
    const defaultW = data.w || Math.max(120, Math.max(...lines.map(l => l.length * fs * 0.6), 100) + 16);
    const defaultH = data.h || Math.max(40, lines.length * fs * (data.lineHeight || 1.5) + 8);

    const item = {
      id: crypto.randomUUID(),
      x: data.x || 0,
      y: data.y || 0,
      w: defaultW,
      h: defaultH,
      text: data.text || '',
      fontSize: fs,
      fontFamily: data.fontFamily || 'sans-serif',
      lineHeight: data.lineHeight || 1.5,
      align: data.align || 'left',
      color: data.color || '#2B2D42',
      bgColor: data.bgColor || '#FFFFFF',
      noBg: data.noBg !== undefined ? data.noBg : true,
      borderColor: data.borderColor || '#2B2D42',
      borderWidth: data.borderWidth || 0,
      opacity: data.opacity !== undefined ? data.opacity : 1,
      shadow: data.shadow || false,
      rotation: data.rotation || 0,
      visible: true,
      locked: false,
    };
    items.push(item);
    save();
    redraw();
    return item;
  }

  function setText(item, text) {
    if (!item) return;
    item.text = text;
    const fs = item.fontSize || 20;
    const lines = text.split('\n');
    item.h = Math.max(40, lines.length * fs * (item.lineHeight || 1.5) + 8);
    save();
    redraw();
  }

  function removeText(item) {
    const idx = items.indexOf(item);
    if (idx >= 0) {
      items.splice(idx, 1);
      if (selectedId === item.id) selectedId = null;
      save();
      redraw();
    }
  }

  function bringToFront(item) {
    const idx = items.indexOf(item);
    if (idx < 0) return;
    items.splice(idx, 1);
    items.push(item);
    save();
    redraw();
  }

  function sendToBack(item) {
    const idx = items.indexOf(item);
    if (idx < 0) return;
    items.splice(idx, 1);
    items.unshift(item);
    save();
    redraw();
  }

  // ============ 拖动 / 缩放 / 旋转 ============
  function startDrag(item, startX, startY) {
    if (item.locked) return null;
    const dx = startX - item.x;
    const dy = startY - item.y;
    return {
      move(clientX, clientY) {
        item.x = clientX - dx;
        item.y = clientY - dy;
        redraw();
      },
      end() { save(); },
    };
  }

  function startResize(handleId, startX, startY) {
    const item = getSelected();
    if (!item || item.locked) return null;
    const orig = { x: item.x, y: item.y, w: item.w, h: item.h };
    return {
      move(clientX, clientY) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (handleId === 'se') {
          item.w = Math.max(60, orig.w + dx);
          item.h = Math.max(30, orig.h + dy);
        } else if (handleId === 'sw') {
          item.x = orig.x + dx;
          item.w = Math.max(60, orig.w - dx);
          item.h = Math.max(30, orig.h + dy);
        } else if (handleId === 'ne') {
          item.y = orig.y + dy;
          item.w = Math.max(60, orig.w + dx);
          item.h = Math.max(30, orig.h - dy);
        } else if (handleId === 'nw') {
          item.x = orig.x + dx;
          item.y = orig.y + dy;
          item.w = Math.max(60, orig.w - dx);
          item.h = Math.max(30, orig.h - dy);
        }
        redraw();
      },
      end() { save(); },
    };
  }

  function startRotate(startX, startY) {
    const item = getSelected();
    if (!item || item.locked) return null;
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const startAngle = Math.atan2(startY - cy, startX - cx);
    const origRotation = item.rotation || 0;
    return {
      move(clientX, clientY) {
        const angle = Math.atan2(clientY - cy, clientX - cx);
        let deg = origRotation + (angle - startAngle) * 180 / Math.PI;
        deg = Math.round(deg / 15) * 15;
        item.rotation = deg;
        redraw();
      },
      end() { save(); },
    };
  }

  // ============ 锁定图标开关 ============
  function setShowLockIcons(v) { showLockIcons = v; redraw(); }
  function getShowLockIcons() { return showLockIcons; }

  // ============ 导出 ============
  load();
  redraw();

    // ============ 文字列表管理 ============
  function openTextListManager() {
    const selected = new Set();
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

    function renderList() {
      list.innerHTML = '';
      if (items.length === 0) {
        list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '还没有文字' }));
        return;
      }
      items.forEach((item, i) => {
        const checked = selected.has(item.id);
        const isFav = (item.favorited === true);
        list.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--bg)', borderRadius: '8px' },
        }, [
          el('input', {
            type: 'checkbox',
            checked: checked,
            onChange: (e) => {
              if (e.target.checked) selected.add(item.id);
              else selected.delete(item.id);
            },
          }),
          el('span', { style: { flex: '1', fontSize: '12px', color: 'var(--text-2)' }, text: `${i + 1}. ${(item.text || '（空）').slice(0, 20)}` }),
          el('button', {
            class: 'tape-chip' + (isFav ? ' active' : ''),
            text: isFav ? '⭐ 已收藏' : '☆ 收藏',
            onClick: () => {
              item.favorited = !item.favorited;
              save();
              renderList();
            },
          }),
          el('button', {
            class: 'tape-chip', text: '✏️ 编辑',
            onClick: () => {
              select(item);
              redraw();
              mask.remove();
              if (typeof window.__openTextEditor === 'function') window.__openTextEditor(item);
            },
          }),
        ]));
      });
    }
    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
        el('h3', { text: '文字列表' }),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { items.forEach(it => selected.add(it.id)); renderList(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); renderList(); } }),
        ]),
        list,
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
          el('button', {
            class: 'btn btn-danger', text: '删除选中',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              if (!confirm(`删除 ${selected.size} 个文字？`)) return;
              selected.forEach(id => {
                const idx = items.findIndex(it => it.id === id);
                if (idx >= 0) items.splice(idx, 1);
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

  return {
    redraw,
    hitTest,
    hitHandle,
    select,
    getSelected,
    addText,
    setText,
    removeText,
    bringToFront,
    sendToBack,
    getItems: () => items,
    restore(newItems) { items = newItems; save(); redraw(); },
    startDrag,
    startResize,
    startRotate,
    save,
    setShowLockIcons,
    getShowLockIcons,
    openTextListManager,
  };
}