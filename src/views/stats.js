import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';

export function renderStats() {
    const view = document.getElementById('view');
    clear(view);
    document.getElementById('page-title').textContent = '学习统计';
    document.getElementById('btn-back').classList.remove('hidden');
    document.getElementById('btn-back').onclick = () => navigate('#/');

    const stats = store.getStats();

    // 顶部概览卡片
    view.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
        el('div', { class: 'card-title', text: '📊 学习概览' }),
        el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginTop: '12px' } }, [
            statItem('总知识点', stats.totalPoints),
            statItem('本周复习', stats.weekReviews),
            statItem('今日待复习', stats.dueCount),
            statItem('连续打卡', stats.streak + ' 天'),
        ]),
    ]));

    // 掌握度
    const total = stats.totalPoints || 1;
    view.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
        el('div', { class: 'card-title', text: '🎯 掌握度' }),
        el('div', { style: { marginTop: '12px' } }, [
            masteryBar('已掌握（≥3 遍）', stats.mastered, total, '#B5E48C'),
            masteryBar('学习中（1-2 遍）', stats.learning, total, '#FFD166'),
            masteryBar('未开始', stats.newPoints, total, '#EF476F'),
        ]),
    ]));

    // 难度分布
    const dTotal = stats.diffDist.low + stats.diffDist.mid + stats.diffDist.high || 1;
    view.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
        el('div', { class: 'card-title', text: '🔥 难度分布' }),
        el('div', { style: { marginTop: '12px' } }, [
            masteryBar('简单（1-3）', stats.diffDist.low, dTotal, '#B5E48C'),
            masteryBar('中等（4-7）', stats.diffDist.mid, dTotal, '#FFD166'),
            masteryBar('困难（8-10）', stats.diffDist.high, dTotal, '#EF476F'),
        ]),
    ]));

    // 最近 7 天复习柱状图
    const maxDaily = Math.max(...stats.dailyReviews.map(d => d.count), 1);
    view.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
        el('div', { class: 'card-title', text: '📈 最近 7 天复习' }),
        el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px', marginTop: '12px', padding: '0 8px' } },
            stats.dailyReviews.map(d => el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } }, [
                el('div', {
                    style: { width: '100%', height: Math.max(4, (d.count / maxDaily) * 100) + 'px', background: 'var(--primary)', borderRadius: '4px 4px 0 0', transition: 'height .3s' },
                }),
                el('div', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: d.date }),
                el('div', { style: { fontSize: '12px', fontWeight: '600' }, text: String(d.count) }),
            ]))
        ),
    ]));

    // 错题
    if (stats.errorCount > 0) {
        view.appendChild(el('div', { class: 'card', style: { cursor: 'pointer' }, onClick: () => navigate('#/review?filter=error') }, [
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                el('div', { class: 'card-title', text: '❗ 易错知识点' }),
                el('div', { style: { fontSize: '24px', fontWeight: '600', color: 'var(--danger)' }, text: String(stats.errorCount) }),
            ]),
        ]));
    }

    function statItem(label, value) {
        return el('div', { style: { textAlign: 'center' } }, [
            el('div', { style: { fontSize: '24px', fontWeight: '700', color: 'var(--primary-dark)' }, text: String(value) }),
            el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: label }),
        ]);
    }

    function masteryBar(label, count, total, color) {
        const pct = Math.round(count / total * 100);
        return el('div', { style: { marginBottom: '10px' } }, [
            el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' } }, [
                el('span', { text: label }),
                el('span', { text: `${count}（${pct}%）`, style: { color: 'var(--text-2)' } }),
            ]),
            el('div', { style: { height: '8px', background: 'rgba(0,0,0,.06)', borderRadius: '4px', overflow: 'hidden' } }, [
                el('div', { style: { height: '100%', width: pct + '%', background: color, transition: 'width .3s' } }),
            ]),
        ]);
    }
}