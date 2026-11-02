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
  const wrap = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });

  const presets = ['#EF476F', '#F78C6B', '#FFD166', '#06D6A0', '#118AB2', '#073B4C', '#2B2D42', '#FFFFFF'];

  let pressTimer = null;
  let longPressFired = false;

  function bindColorDot(dot, color, isFav) {
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
      if (isFav) {
        if (confirm(`取消收藏颜色 ${color}？`)) { removeFavColor(color); refresh(); }
      } else {
        if (confirm(`收藏颜色 ${color}？`)) { addFavColor(color); refresh(); }
      }
    });
  }

  function refresh() {
    wrap.innerHTML = '';

    presets.forEach(c => {
      const dot = el('button', {
        style: { width: '28px', height: '28px', borderRadius: '50%', background: c, border: c === current ? '3px solid var(--primary-dark)' : '2px solid rgba(0,0,0,.1)', cursor: 'pointer', flexShrink: '0' },
      });
      bindColorDot(dot, c, false);
      wrap.appendChild(dot);
    });

    const favs = getFavColors();
    if (favs.length > 0) {
      wrap.appendChild(el('span', { style: { width: '1px', height: '20px', background: 'rgba(0,0,0,.1)', margin: '0 4px' } }));
      favs.forEach(c => {
        const dot = el('button', {
          style: { width: '28px', height: '28px', borderRadius: '50%', background: c, border: c === current ? '3px solid var(--primary-dark)' : '2px solid rgba(0,0,0,.1)', cursor: 'pointer', flexShrink: '0' },
        });
        bindColorDot(dot, c, true);
        wrap.appendChild(dot);
      });
    }

    const custom = el('input', {
      type: 'color', value: current,
      style: { width: '32px', height: '32px', border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: '0' },
      onInput: (e) => { current = e.target.value; onChange(current); },
      onChange: (e) => { addFavColor(e.target.value); refresh(); },
    });
    wrap.appendChild(custom);

    if (allowNone) {
      const noneBtn = el('button', {
        style: { width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(45deg, #fff 25%, #eee 25%, #eee 50%, #fff 50%, #fff 75%, #eee 75%)', backgroundSize: '8px 8px', border: current === 'none' ? '3px solid var(--primary-dark)' : '2px solid rgba(0,0,0,.1)', cursor: 'pointer', flexShrink: '0' },
        title: '无色',
        onClick: () => { current = 'none'; onChange('none'); refresh(); },
      });
      wrap.appendChild(noneBtn);
    }
  }

  refresh();
  return wrap;
}