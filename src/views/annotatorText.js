import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { uuid } from '../utils/id.js';

export function createTextLayer(canvas, W, H, imageId) {
    const ctx = canvas.getContext('2d');
    let items = store.getTextItems(imageId);
    let selected = null;

    function redraw() {
        ctx.clearRect(0, 0, W, H);
        items.forEach(t => drawText(ctx, t));
        if (selected) drawSelection(ctx, selected);
    }

    function drawText(ctx, t) {
        ctx.save();
        if (!t.noBg) {
          ctx.fillStyle = t.bgColor || '#FFFFFF';
          ctx.fillRect(t.x, t.y, t.w, t.h);
        }
        ctx.fillStyle = t.color || '#2B2D42';
        const fs = t.fontSize || 20;
        ctx.font = `${fs}px ${t.fontFamily || 'sans-serif'}`;
        ctx.textAlign = t.align || 'left';
        ctx.textBaseline = 'top';
        const lines = wrapText(ctx, t.text || '', t.w - 8);
        const lineH = fs * (t.lineHeight || 1.5);
        let tx = t.x + 4;
        if (t.align === 'center') tx = t.x + t.w / 2;
        else if (t.align === 'right') tx = t.x + t.w - 4;
        lines.forEach((line, i) => {
          const displayLine = line.replace(/ /g, '\u00A0');
          ctx.fillText(displayLine, tx, t.y + 4 + i * lineH);
        });
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

    function drawSelection(ctx, t) {
        ctx.save();
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        ctx.setLineDash([]);
        [[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]].forEach(([x, y]) => {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#3B82F6';
            ctx.fillRect(x - 4, y - 4, 8, 8);
            ctx.strokeRect(x - 4, y - 4, 8, 8);
        });
        ctx.restore();
    }

    return {
        getItems() { return items; },
        addText(patch) {
            const t = {
                id: uuid(),
                x: patch.x, y: patch.y,
                w: patch.w || 200, h: patch.h || 80,
                text: patch.text || '',
                fontSize: patch.fontSize || 20,
                fontFamily: patch.fontFamily || 'sans-serif',
                color: patch.color || '#2B2D42',
                bgColor: patch.bgColor || '#FFFFFF',
                noBg: patch.noBg || false,
                lineHeight: patch.lineHeight || 1.5,
                align: patch.align || 'left',
                lineHeight: patch.lineHeight || 1.5,
                align: patch.align || 'left',
                padding: patch.padding || 4,
            };
            items.push(t);
            store.saveTextItems(imageId, items);
            selected = t;
            redraw();
            return t;
        },
        removeSelected() {
            if (!selected) return;
            items = items.filter(x => x.id !== selected.id);
            selected = null;
            store.saveTextItems(imageId, items);
            redraw();
        },
        hitTest(x, y) {
            for (let i = items.length - 1; i >= 0; i--) {
                const t = items[i];
                if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t;
            }
            return null;
        },
        select(t) { selected = t; redraw(); },
        getSelected() { return selected; },
        moveSelected(dx, dy) {
            if (!selected) return;
            selected.x += dx; selected.y += dy;
            store.saveTextItems(imageId, items);
            redraw();
        },
        setText(t, text) {
            t.text = text;
            store.saveTextItems(imageId, items);
            redraw();
        },
        startResize(handle, startX, startY) {
            if (!selected) return null;
            const orig = { x: selected.x, y: selected.y, w: selected.w, h: selected.h };
            const self = {};
            return {
                move(clientX, clientY) {
                    const dx = clientX - startX;
                    const dy = clientY - startY;
                    let { x, y, w, h } = orig;
                    if (handle.includes('e')) w = Math.max(80, orig.w + dx);
                    if (handle.includes('s')) h = Math.max(40, orig.h + dy);
                    if (handle.includes('w')) { w = Math.max(80, orig.w - dx); x = orig.x + (orig.w - w); }
                    if (handle.includes('n')) { h = Math.max(40, orig.h - dy); y = orig.y + (orig.h - h); }
                    selected.x = x; selected.y = y; selected.w = w; selected.h = h;
                    if (!self._raf) {
                        self._raf = requestAnimationFrame(() => {
                            redraw();
                            self._raf = null;
                        });
                    }
                },
                end() {
                    if (self._raf) { cancelAnimationFrame(self._raf); self._raf = null; }
                    store.saveTextItems(imageId, items);
                },
            };
        },
        redraw,
        save() { store.saveTextItems(imageId, items); },
    };
}