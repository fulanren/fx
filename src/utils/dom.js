export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  
  // 处理属性
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue; // 跳过 undefined/null

    if (k === 'class' || k === 'className') {
      node.className = v;
    } 
    else if (k === 'style') {
      if (typeof v === 'string') {
        node.style.cssText = v;
      } else if (typeof v === 'object') {
        Object.assign(node.style, v);
      }
    } 
    else if (k === 'text' || k === 'textContent') {
      node.textContent = v;
    } 
    // 👇 核心修复：补上对 innerHTML 的支持
    else if (k === 'innerHTML') {
      node.innerHTML = v;
    }
    // 👇 核心修复：安全处理事件监听
    else if (k.startsWith('on') && typeof v === 'function') {
      // 将 onClick 转换为 click，onTouchStart 转换为 touchstart
      const eventName = k.slice(2).toLowerCase();
      node.addEventListener(eventName, v);
    } 
    // 处理其他 DOM 属性（如 disabled, checked 等）
    else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
      else node.removeAttribute(k);
    } 
    else {
      node.setAttribute(k, v);
    }
  }

  // 处理子元素
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

export function clear(node) { 
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild); 
}