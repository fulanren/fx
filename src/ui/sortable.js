// 长按拖拽 + 上下移按钮兜底
export function makeSortable(container, itemSelector, onReorder) {
  let dragging = null;
  let startY = 0;
  let longPressTimer = null;
  let items = [];

  function refresh() {
    items = [...container.querySelectorAll(itemSelector)];
    items.forEach(item => {
      if (item.dataset.sortableBound) return;
      item.dataset.sortableBound = '1';
      item.addEventListener('pointerdown', onPointerDown);
    });
  }

  function onPointerDown(e) {
    if (e.target.closest('button, input, textarea, a')) return;
    const item = e.currentTarget;
    startY = e.clientY;
    longPressTimer = setTimeout(() => {
      dragging = item;
      item.style.opacity = '0.6';
      item.style.transform = 'scale(1.02)';
      item.style.zIndex = '10';
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    }, 300);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const y = e.clientY;
    const rect = dragging.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const target = items.find(it => it !== dragging && y > it.getBoundingClientRect().top && y < it.getBoundingClientRect().bottom);
    if (target) {
      const targetRect = target.getBoundingClientRect();
      if (midY < targetRect.top + targetRect.height / 2) {
        container.insertBefore(dragging, target);
      } else {
        container.insertBefore(dragging, target.nextSibling);
      }
      items = [...container.querySelectorAll(itemSelector)];
    }
  }

  function onPointerUp() {
    clearTimeout(longPressTimer);
    if (dragging) {
      dragging.style.opacity = '';
      dragging.style.transform = '';
      dragging.style.zIndex = '';
      const ids = [...container.querySelectorAll(itemSelector)].map(it => it.dataset.id).filter(Boolean);
      onReorder(ids);
      dragging = null;
    }
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  // 取消长按
  container.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  container.addEventListener('pointercancel', () => clearTimeout(longPressTimer));
  container.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientY - startY) > 10 && longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });

  refresh();
  return { refresh };
}