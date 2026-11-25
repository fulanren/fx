/**
 * PDF 转图清晰度档位
 * - 供 views/pdfImport.js 的选页框内嵌使用：buildQualityPicker({el, collapsed}) -> { box, getScale }
 * - 同时导出档位表 / 默认档 / 查找函数
 */

export const QUALITY_LEVELS = [
  { scale: 2.0, name: '超清 2.0x', desc: '打印级清晰度，文字锐利可放大查看', size: '体积最大' },
  { scale: 1.5, name: '高清 1.5x', desc: '推荐日常使用，清晰度与体积平衡', size: '体积适中', def: true },
  { scale: 1.4, name: '很清 1.4x', desc: '接近超清，比 2.0x 省约 30% 空间', size: '体积适中' },
  { scale: 1.3, name: '清晰 1.3x', desc: '与阅读端默认清晰度一致，性价比高', size: '体积较小' },
  { scale: 1.2, name: '清晰 1.2x', desc: '屏幕阅读足够清晰', size: '体积较小' },
  { scale: 1.1, name: '轻清 1.1x', desc: '轻微压缩，肉眼几乎无差别', size: '体积小' },
  { scale: 1.0, name: '标准 1.0x', desc: '原始比例，适合纯预览', size: '体积小' },
  { scale: 0.8, name: '流畅 0.8x', desc: '大幅节省空间，适合页数很多的文档', size: '体积最小' }
];

export const DEFAULT_SCALE = 1.5;

export function getQuality(scale) {
  const n = Number(scale);
  return QUALITY_LEVELS.find(q => q.scale === n) ||
    QUALITY_LEVELS.find(q => q.def) ||
    QUALITY_LEVELS[1];
}

/**
 * 构建内嵌式清晰度选择器
 * @param {{el?:Function, collapsed?:boolean}} [opts]
 * @returns {{box: HTMLElement, getScale: () => number}}
 */
export function buildQualityPicker(opts = {}) {
  const collapsed = !!opts.collapsed;

  const box = document.createElement('div');
  box.className = 'pq-quality';
  box.style.cssText = 'margin:6px 0 10px;border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:8px 10px;background:var(--bg-soft,#f7fafc);';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;';
  const title = document.createElement('span');
  title.textContent = '导出清晰度';
  title.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-1,#243447);';
  const cur = document.createElement('span');
  cur.style.cssText = 'flex:1;font-size:12px;color:var(--text-2,#64748b);';
  const caret = document.createElement('span');
  caret.textContent = collapsed ? '▸' : '▾';
  caret.style.cssText = 'font-size:12px;color:#94a3b8;';
  head.append(title, cur, caret);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px;';
  if (collapsed) list.style.display = 'none';

  let checkedScale = DEFAULT_SCALE;

  QUALITY_LEVELS.forEach(q => {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:2px 10px;align-items:center;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fff;transition:.15s;';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'pqScale';
    radio.value = String(q.scale);
    radio.style.accentColor = '#3d9bbd';
    if (q.def) radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked) { checkedScale = Number(radio.value); cur.textContent = q.name; }
    });

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-size:13px;font-weight:600;color:#243447;';
    const defTag = q.def
      ? ' <em style="font-style:normal;font-size:10px;color:#fff;background:#3d9bbd;border-radius:3px;padding:1px 4px;margin-left:4px;">推荐</em>'
      : '';
    nameEl.innerHTML = q.name + defTag;

    const sizeEl = document.createElement('span');
    sizeEl.textContent = q.size;
    sizeEl.style.cssText = 'font-size:11px;color:#94a3b8;white-space:nowrap;';

    const descEl = document.createElement('span');
    descEl.textContent = q.desc;
    descEl.style.cssText = 'grid-column:2 / 4;font-size:11px;color:#64748b;line-height:1.4;';

    row.append(radio, nameEl, sizeEl, descEl);
    row.addEventListener('click', (e) => { if (e.target !== radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); } });
    list.append(row);
  });

  cur.textContent = getQuality(checkedScale).name;

  head.addEventListener('click', () => {
    const open = list.style.display !== 'none';
    list.style.display = open ? 'none' : 'flex';
    caret.textContent = open ? '▸' : '▾';
  });

  box.append(head, list);
  return { box, getScale: () => checkedScale };
}