import { navigate } from '../router.js';

export function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

    // Ctrl+K 搜索
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      navigate('#/search');
      return;
    }

    // Esc 关闭弹窗
    if (e.key === 'Escape') {
      const mask = document.querySelector('.confirm-mask');
      if (mask) { mask.click(); return; }
      const modal = document.querySelector('.modal-mask');
      if (modal) { modal.click(); return; }
    }

    // 输入框内不触发下面快捷键
    if (isInput) return;

    // N 新建
    if (e.key === 'n' || e.key === 'N') {
      const hash = location.hash;
      if (hash === '#/' || hash === '') navigate('#/edit/task/new');
    }
  });
}