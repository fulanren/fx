import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

export function renderCountdownPage() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '考试倒计时';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate('#/');

  const data = store.getExamCountdown() || {};
  const nameInput = el('input', { type: 'text', value: data.name || '', placeholder: '如：2026 国考', style: { width: '100%' } });
  const dateInput = el('input', { type: 'date', value: data.date || '', style: { width: '100%' } });
  const targetInput = el('input', { type: 'text', value: data.target || '', placeholder: '如：行测 70+，申论 65+', style: { width: '100%' } });

  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '⏰ 考试倒计时设置' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { class: 'field' }, [el('label', { text: '考试名称' }), nameInput]),
      el('div', { class: 'field' }, [el('label', { text: '考试日期' }), dateInput]),
      el('div', { class: 'field' }, [el('label', { text: '目标分数' }), targetInput]),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        data.date ? el('button', {
          class: 'btn btn-danger', text: '删除倒计时',
          onClick: async () => {
            if (await confirmBox({ title: '删除', message: '删除倒计时？', danger: true, confirmText: '删除' })) {
              store.clearExamCountdown();
              toastSuccess('已删除');
              navigate('#/');
            }
          },
        }) : null,
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onClick: () => {
            if (!dateInput.value) { alert('请选考试日期'); return; }
            store.saveExamCountdown({
              name: nameInput.value.trim() || '目标考试',
              date: dateInput.value,
              target: targetInput.value.trim(),
            });
            toastSuccess('已保存');
            navigate('#/');
          },
        }),
      ]),
    ]),
  ]));
}