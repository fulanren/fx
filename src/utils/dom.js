export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  
  // 处理属性
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'text') {
      node.textContent = v;
    } else {
      node.setAttribute(k, v);
    }
  }

  // 👇 修复这里：处理子元素，过滤无效内容
  const appendChild = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      console.warn('el() 接收到了无效的子元素:', child);
    }
  };

  if (Array.isArray(children)) {
    children.forEach(appendChild);
  } else {
    appendChild(children);
  }

  return node;
}
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }