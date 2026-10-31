import { el } from '../utils/dom.js';
const root = () => document.getElementById('toast-root');
export function toast(message, opts = {}) {
  const { type = '', duration = 2500, action = null } = opts;
  const node = el('div', { class: `toast ${type}` }, [
    el('span', { text: message }),
    action ? el('button', { class: 'toast-action', text: action.label,
      onClick: () => { action.onClick(); remove(); } }) : null,
  ]);
  root().appendChild(node);
  let timer = setTimeout(remove, duration);
  function remove() {
    clearTimeout(timer); node.style.opacity = '0'; node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 200);
  }
  return { remove };
}
export function toastSuccess(msg, opts={}) { return toast(msg, { ...opts, type: 'success' }); }
export function toastError(msg, opts={}) { return toast(msg, { ...opts, type: 'error', duration: 3500 }); }