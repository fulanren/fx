import { ensurePdfJs } from '../utils/deps.js';

/**
 * 兼容 composer.js 的历史导入：已废弃“转图/原PDF/两者”三选弹窗
 */
export function chooseImportMode(opts = {}) {
  const mode = 'pdf-image';
  if (typeof opts.onPick === 'function') opts.onPick(mode);
  return Promise.resolve(mode);
}

/**
 * 渲染 PDF 导入视图（清晰度与选页统一交给 pdfImportModal 的选页框，此处不再内嵌清晰度）
 */
export function renderPdfImportMode(container, state = {}) {
  if (!container) return;
  const files = state.files || [];

  container.innerHTML = `
    <div class="pdf-import-mode">
      <h2>导入 PDF</h2>
      <p class="hint">选择本地 PDF 文件，可多选。</p>
      <input type="file" id="pdfFileInput" accept="application/pdf" multiple />
      <div class="file-list">
        ${files.length
      ? files.map((f, i) => `<div class="file-item">${esc(f.name || ('文件' + (i + 1)))}</div>`).join('')
      : '<div class="file-empty">尚未选择文件</div>'}
      </div>
      <div class="actions">
        <button id="pdfImportBack">返回</button>
        <button id="pdfImportConfirm" ${files.length ? '' : 'disabled'}>确认导入</button>
      </div>
    </div>
  `;

  const input = container.querySelector('#pdfFileInput');
  if (input) {
    input.addEventListener('change', async e => {
      const picked = [...e.target.files].filter(f => f.type === 'application/pdf');
      if (!picked.length) return;
      try { await ensurePdfJs(); }
      catch (err) { console.error('pdf.js 加载失败：', err); alert('PDF 组件加载失败，请检查网络后刷新。'); return; }
      renderPdfImportMode(container, { files: [...files, ...picked.map(f => ({ name: f.name, file: f }))] });
    });
  }

  const backBtn = container.querySelector('#pdfImportBack');
  if (backBtn) backBtn.addEventListener('click', () => {
    if (typeof state.onBack === 'function') state.onBack();
    else if (location.hash !== '#/') location.hash = '#/';
  });

  const confirmBtn = container.querySelector('#pdfImportConfirm');
  if (confirmBtn) confirmBtn.addEventListener('click', () => {
    if (!files.length) return;
    if (typeof state.onConfirm === 'function') state.onConfirm({ files });
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}