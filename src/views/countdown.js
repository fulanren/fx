import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

export function renderCountdownCard() {
    const data = store.getExamCountdown();
    if (!data || !data.date) return null;

    const now = new Date();
    const target = new Date(data.date);
    target.setHours(0, 0, 0, 0);
    const days = Math.ceil((target - now) / 86400000);

    if (days < 0) {
        return el('div', { class: 'card', style: { cursor: 'pointer', background: 'linear-gradient(135deg, #FFB5A7, #FFD166)' }, onClick: () => editCountdown() }, [
            el('div', { style: { textAlign: 'center', color: '#8A6D1B' } }, [
                el('div', { style: { fontSize: '13px' }, text: data.name || '目标考试' }),
                el('div', { style: { fontSize: '32px', fontWeight: '700' }, text: '已结束' }),
            ]),
        ]);
    }

    return el('div', {
        class: 'card',
        style: { cursor: 'pointer', background: 'linear-gradient(135deg, #8ECAE6, #CDB4DB)' },
        onClick: () => editCountdown(),
    }, [
        el('div', { style: { textAlign: 'center', color: '#fff' } }, [
            el('div', { style: { fontSize: '14px', opacity: '0.9' }, text: data.name || '目标考试' }),
            el('div', { style: { fontSize: '48px', fontWeight: '700', lineHeight: '1.2' }, text: String(days) }),
            el('div', { style: { fontSize: '14px', opacity: '0.9' }, text: '天后' }),
            data.target ? el('div', { style: { fontSize: '12px', opacity: '0.8', marginTop: '4px' }, text: `目标：${data.target}` }) : null,
        ]),
    ]);
}

export function editCountdown() {
    const data = store.getExamCountdown() || {};
    const nameInput = el('input', { type: 'text', value: data.name || '', placeholder: '如：2026 国考', style: { width: '100%' } });
    const dateInput = el('input', { type: 'date', value: data.date || '', style: { width: '100%' } });
    const targetInput = el('input', { type: 'text', value: data.target || '', placeholder: '如：行测 70+，申论 65+', style: { width: '100%' } });

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
            el('h3', { text: '考试倒计时' }),
            el('div', { class: 'field' }, [el('label', { text: '考试名称' }), nameInput]),
            el('div', { class: 'field' }, [el('label', { text: '考试日期' }), dateInput]),
            el('div', { class: 'field' }, [el('label', { text: '目标分数' }), targetInput]),
            el('div', { class: 'confirm-actions', style: { flexWrap: 'wrap' } }, [
                data.date ? el('button', {
                    class: 'btn btn-danger', text: '删除倒计时',
                    onClick: async () => {
                        if (await confirmBox({ title: '删除', message: '删除倒计时？', danger: true, confirmText: '删除' })) {
                            store.clearExamCountdown();
                            mask.remove();
                            navigate('#/');
                        }
                    },
                }) : null,
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
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
                        mask.remove();
                        navigate('#/');
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);
}