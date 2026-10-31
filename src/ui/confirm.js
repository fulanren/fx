import { el } from '../utils/dom.js';
export function confirmBox({ title='确认', message='', confirmText='确定', cancelText='取消', danger=false, extra=null }) {
  return new Promise(resolve => {
    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box' }, [
        el('h3', { text: title }),
        message ? el('p', { text: message }) : null,
        el('div', { class: 'confirm-actions' }, [
          extra ? el('button', {
            class: 'btn btn-ghost', text: extra.label,
            onClick: () => { mask.remove(); resolve(extra.value); },
          }) : null,
          el('button', {
            class: 'btn btn-ghost', text: cancelText,
            onClick: () => { mask.remove(); resolve(false); },
          }),
          el('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            text: confirmText,
            onClick: () => { mask.remove(); resolve(true); },
          }),
        ]),
      ]),
    ]);
    mask.addEventListener('click', e => {
      if (e.target === mask) { mask.remove(); resolve(false); }
    });
    document.body.appendChild(mask);
  });
}