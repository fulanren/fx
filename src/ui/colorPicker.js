import { el } from '../utils/dom.js';
import { toastSuccess } from './toast.js';

const FAV_KEY = 'kg_fav_colors';

export function getFavColors() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
    catch { return []; }
}

export function addFavColor(color) {
    const list = getFavColors();
    if (!list.includes(color)) {
        list.push(color);
        if (list.length > 20) list.shift();
        localStorage.setItem(FAV_KEY, JSON.stringify(list));
        toastSuccess('已收藏颜色');
    } else {
        toastSuccess('这个颜色已收藏');
    }
}

export function removeFavColor(color) {
    const list = getFavColors().filter(c => c !== color);
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
    toastSuccess('已取消收藏');
}

export function renderColorPicker({ current, onChange, allowNone = false }) {
    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' } });

    const presets = ['#EF476F', '#F78C6B', '#FFD166', '#06D6A0', '#118AB2', '#073B4C', '#2B2D42', '#FFFFFF'];

    function bindColorDot(dot, color, isFav) {
        let pressTimer = null;
        let longPressFired = false;

        dot.addEventListener('pointerdown', () => {
            longPressFired = false;
            pressTimer = setTimeout(() => {
                longPressFired = true;
                if (isFav) {
                    if (confirm(`取消收藏颜色 ${color}？`)) {
                        removeFavColor(color);
                        refresh();
                    }
                } else {
                    if (confirm(`收藏颜色 ${color}？`)) {
                        addFavColor(color);
                        refresh();
                    }
                }
            }, 600);
        });
        dot.addEventListener('pointerup', () => {
            clearTimeout(pressTimer);
            if (!longPressFired) {
                current = color;
                onChange(color);
                refresh();
            }
        });
        dot.addEventListener('pointerleave', () => clearTimeout(pressTimer));
        dot.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (longPressFired) { longPressFired = false; return; }
            if (isFav) {
                if (confirm(`取消收藏颜色 ${color}？`)) { removeFavColor(color); refresh(); }
            } else {
                if (confirm(`收藏颜色 ${color}？`)) { addFavColor(color); refresh(); }
            }
        });
    }

    function openFavManager() {
        const favs = getFavColors();
        const selected = new Set();
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } },
            favs.length > 0
                ? favs.map(c => el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer' } }, [
                    el('input', { type: 'checkbox', onChange: (e) => { if (e.target.checked) selected.add(c); else selected.delete(c); } }),
                    el('span', { style: { width: '24px', height: '24px', borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,.1)', flexShrink: '0' } }),
                    el('span', { style: { fontSize: '12px' }, text: c }),
                ]))
                : [el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '还没有收藏颜色' })]
        );
        const mask = el('div', { class: 'confirm-mask' }, [
            el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
                el('h3', { text: '管理收藏颜色' }),
                el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, [
                    el('button', {
                      class: 'btn btn-sm btn-ghost', text: '全选',
                      onClick: () => {
                        favs.forEach(c => selected.add(c));
                        list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                      },
                    }),
                    el('button', {
                      class: 'btn btn-sm btn-ghost', text: '全不选',
                      onClick: () => {
                        selected.clear();
                        list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                      },
                    }),
                  ]),
                list,
                el('div', { class: 'confirm-actions' }, [
                    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                    el('button', {
                        class: 'btn btn-danger', text: '删除选中',
                        onClick: () => {
                            if (selected.size === 0) { alert('请先勾选'); return; }
                            selected.forEach(c => removeFavColor(c));
                            mask.remove();
                            refresh();
                        },
                    }),
                ]),
            ]),
        ]);
        document.body.appendChild(mask);
    }

    function refresh() {
        wrap.innerHTML = '';
    
        // 预设色
        const presetRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
        presets.forEach(c => {
          const dot = el('button', {
            type: 'button',
            style: { width: '28px', height: '28px', borderRadius: '50%', background: c, border: c === current ? '3px solid var(--primary-dark)' : '2px solid rgba(0,0,0,.1)', cursor: 'pointer', flexShrink: '0' },
          });
          bindColorDot(dot, c, false);
          presetRow.appendChild(dot);
        });
        wrap.appendChild(presetRow);
    
        // 收藏色（可隐藏）
        const favs = getFavColors();
        if (favs.length > 0) {
          const favHidden = localStorage.getItem('kg_fav_hidden') === '1';
          const toggleBtn = el('button', {
            type: 'button',
            class: 'btn btn-sm btn-ghost',
            text: favHidden ? '👁 显示收藏' : '🙈 隐藏收藏',
            style: { fontSize: '11px', padding: '2px 8px', minHeight: '24px', marginTop: '4px' },
            onClick: () => {
              localStorage.setItem('kg_fav_hidden', favHidden ? '0' : '1');
              refresh();
            },
          });
          wrap.appendChild(toggleBtn);
    
          if (!favHidden) {
            const favRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' } }, [
              el('span', { style: { fontSize: '11px', color: 'var(--text-2)', marginRight: '4px' }, text: '收藏：' }),
            ]);
            favs.forEach(c => {
              const dot = el('button', {
                type: 'button',
                style: { width: '28px', height: '28px', borderRadius: '50%', background: c, border: c === current ? '3px solid var(--primary-dark)' : '2px solid rgba(0,0,0,.1)', cursor: 'pointer', flexShrink: '0' },
              });
              bindColorDot(dot, c, true);
              favRow.appendChild(dot);
            });
            favRow.appendChild(el('button', {
              type: 'button',
              class: 'btn btn-sm btn-ghost', text: '管理',
              style: { fontSize: '11px', padding: '2px 8px', minHeight: '24px', marginLeft: '4px' },
              onClick: () => openFavManager(),
            }));
            wrap.appendChild(favRow);
          }
        }
    
        // 自定义 + 无色
        const customRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } });
    
        const custom = el('label', {
          style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '8px', background: 'rgba(142,202,230,.15)', cursor: 'pointer', fontSize: '12px', color: 'var(--primary-dark)' },
        }, [
          el('span', { text: '🎨' }),
          el('span', { text: '自定义' }),
          el('input', {
            type: 'color', value: current,
            style: { width: '0', height: '0', opacity: '0', position: 'absolute' },
            onInput: (e) => { current = e.target.value; onChange(current); },
            onChange: (e) => { addFavColor(e.target.value); refresh(); },
          }),
        ]);
        customRow.appendChild(custom);
    
        if (allowNone) {
          const noneBtn = el('button', {
            type: 'button',
            style: { width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(45deg, #fff 25%, #eee 25%, #eee 50%, #fff 50%, #fff 75%, #eee 75%)', backgroundSize: '8px 8px', border: current === 'none' ? '3px solid var(--primary-dark)' : '2px solid rgba(0,0,0,.1)', cursor: 'pointer', flexShrink: '0' },
            title: '无色',
            onClick: () => { current = 'none'; onChange('none'); refresh(); },
          });
          customRow.appendChild(noneBtn);
        }
        wrap.appendChild(customRow);
      }

    refresh();
    return wrap;
}