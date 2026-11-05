export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'checked' || k === 'value' || k === 'selected' || k === 'disabled') node[k] = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  });
  if (Array.isArray(children)) {
    children.forEach(c => c && node.appendChild(c));
  } else if (children) {
    node.appendChild(children);
  }
  return node;
}
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }