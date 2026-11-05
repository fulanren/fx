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
  let expanded = false; // 是否展开全部颜色

  const wrap = el('div', {
    class: 'color-picker',
    style: {
      display: 'flex',
      gap: '4px',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      alignItems: 'center',
      paddingBottom: '4px',
    },
  });

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

    // 预设色（5 个）+ 收藏色（去重）
    const presets = ['#EF476F', '#F78C6B', '#FFD166', '#06D6A0', '#118AB2'];
    const favs = getFavColors();
    const allColors = [...new Set([...presets, ...favs])];

    // 用户控制是否显示收藏色
    const showFavs = localStorage.getItem('kg_show_fav_colors') !== '0';

    const colorRow = el('div', { class: 'color-picker-row', style: { display: 'flex', gap: '6px', flexWrap: 'nowrap', alignItems: 'center' } });

    // 预设色
    presets.forEach(c => {
      const dot = el('button', {
        type: 'button',
        class: 'color-picker-dot' + (c === current ? ' active' : ''),
        style: { background: c },
      });
      bindColorDot(dot, c, false);
      colorRow.appendChild(dot);
    });

    // 收藏色（如果用户开启显示）
    if (showFavs && favs.length > 0) {
      // 分隔线
      colorRow.appendChild(el('div', {
        style: {
          width: '1px',
          height: '20px',
          background: 'rgba(0,0,0,.15)',
          margin: '0 4px',
          flexShrink: '0',
        },
      }));
      favs.forEach(c => {
        const dot = el('button', {
          type: 'button',
          class: 'color-picker-dot' + (c === current ? ' active' : ''),
          style: { background: c, position: 'relative' },
        });
        bindColorDot(dot, c, true);
        dot.appendChild(el('span', {
          style: {
            position: 'absolute',
            bottom: '-2px',
            right: '-2px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--primary-dark)',
            border: '1px solid #fff',
          },
        }));
        colorRow.appendChild(dot);
      });
    }

    // 自定义颜色
    const custom = el('label', {
      class: 'color-picker-dot',
      style: { background: 'rgba(142,202,230,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' },
      title: '自定义颜色',
    }, [
      el('span', { text: '🎨' }),
      el('input', {
        type: 'color', value: current === 'none' ? '#000000' : current,
        style: { width: '0', height: '0', opacity: '0', position: 'absolute' },
        onInput: (e) => { current = e.target.value; onChange(current); },
        onChange: (e) => { addFavColor(e.target.value); refresh(); },
      }),
    ]);
    colorRow.appendChild(custom);

    // 无色
    if (allowNone) {
      const noneBtn = el('button', {
        type: 'button',
        class: 'color-picker-dot' + (current === 'none' ? ' active' : ''),
        style: { background: 'linear-gradient(45deg, #fff 25%, #eee 25%, #eee 50%, #fff 50%, #fff 75%, #eee 75%)', backgroundSize: '8px 8px' },
        title: '无色',
        onClick: () => { current = 'none'; onChange('none'); refresh(); },
      });
      colorRow.appendChild(noneBtn);
    }

    // 收藏管理按钮
    if (favs.length > 0) {
      const manageBtn = el('button', {
        type: 'button',
        style: { padding: '2px 6px', borderRadius: '6px', fontSize: '11px', background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: '24px' },
        text: '管理',
        onClick: () => openFavManager(),
      });
      colorRow.appendChild(manageBtn);
    }

    // 显示/隐藏收藏色开关
    if (favs.length > 0) {
      const toggleBtn = el('button', {
        type: 'button',
        style: { padding: '2px 6px', borderRadius: '6px', fontSize: '11px', background: showFavs ? 'var(--primary)' : 'var(--bg)', color: showFavs ? '#fff' : 'var(--text-2)', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: '24px' },
        text: showFavs ? '隐藏收藏' : '显示收藏',
        onClick: () => {
          const cur = localStorage.getItem('kg_show_fav_colors');
          localStorage.setItem('kg_show_fav_colors', cur === '0' ? '1' : '0');
          refresh();
        },
      });
      colorRow.appendChild(toggleBtn);
    }

    wrap.appendChild(colorRow);
  }

  // ============ 收藏管理：多选/全选/删除 ============
  function openFavManager() {
    const favs = getFavColors();
    const selected = new Set();
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

    function renderList() {
      list.innerHTML = '';
      favs.forEach(c => {
        const checked = selected.has(c);
        const row = el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox',
            checked,
            onChange: (e) => {
              if (e.target.checked) selected.add(c);
              else selected.delete(c);
              renderList();
            },
          }),
          el('span', { style: { width: '24px', height: '24px', borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,.1)' } }),
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: c }),
        ]);
        list.appendChild(row);
      });
    }
    renderList();

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
        el('h3', { text: '管理收藏颜色' }),
        el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { favs.forEach(c => selected.add(c)); renderList(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); renderList(); } }),
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

  refresh();
  return wrap;
}