import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { fmtDate } from '../utils/date.js';
import { toastSuccess } from '../ui/toast.js';

export function renderReview({ query }) {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '复习';
  document.getElementById('btn-back').classList.add('hidden');

  const filter = query.filter || 'due';
  let points;
  if (filter === 'error') {
    points = store.getTasks().flatMap(t =>
      store.getChapters(t.id).flatMap(c => store.getPoints(c.id).filter(p => p.isErrorProne))
    );
  } else if (filter === 'all') {
    points = store.getTasks().flatMap(t =>
      store.getChapters(t.id).flatMap(c => store.getPoints(c.id))
    );
  } else {
    points = store.getDuePoints();
  }

  view.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } }, [
    tabBtn('今日待复习', 'due', filter),
    tabBtn('易错', 'error', filter),
    tabBtn('全部', 'all', filter),
  ]));

  const streak = store.getStreak();
  if (streak > 0) {
    view.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } }, [`🔥 连续打卡 ${streak} 天`]));
  }

  if (points.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '✅' }),
      el('div', { text: filter === 'due' ? '今日没有待复习的知识点' : '暂无数据' }),
    ]));
    return;
  }

  points.forEach(p => view.appendChild(reviewCard(p, filter)));
}

function tabBtn(label, value, current) {
  return el('button', {
    class: `btn btn-sm ${value === current ? 'btn-primary' : 'btn-ghost'}`,
    text: label,
    onClick: () => navigate(`#/review?filter=${value}`),
  });
}

function reviewCard(p, filter) {
  const chapter = store.getChapter(p.chapterId);
  const task = chapter ? store.getTask(chapter.taskId) : null;

  const answer = el('div', { class: 'hidden', style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,.06)' } }, [
    p.explanation ? el('div', { style: { marginBottom: '12px' } }, [
      el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: '解释' }),
      el('div', { text: p.explanation, style: { whiteSpace: 'pre-wrap' } }),
    ]) : null,

    // 【错题统计】加在这一整行前面
    p.isErrorProne ? el('div', { style: { fontSize: '13px', color: 'var(--danger)', marginBottom: '8px' } }, [
      (() => {
        const s = store.getErrorStats(p);
        return `❗ 易错知识点 · 共复习 ${s.totalCount} 次，忘了 ${s.forgotCount} 次，错误率 ${s.errorRate}%`;
      })(),
    ]) : null,

    el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px' } }, [
      [
        (p.manualReviewCount || p.reviewCount > 0) ? `已背 ${p.reviewCount} 遍` : null,
        `难度 ${p.difficulty}/10`,
        (p.manualNextReviewAt || p.reviewCount > 0) ? `下次 ${fmtDate(p.nextReviewAt)}` : null,
      ].filter(Boolean).join(' · '),
    ]),
    el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
      ratingBtn('😣 忘了', 'forgot', p, filter),
      ratingBtn('😐 模糊', 'vague', p, filter),
      ratingBtn('😊 记得', 'remember', p, filter),
    ]),
    // 推迟 / 排除的恢复按钮
    p.excluded ? el('div', { style: { marginTop: '12px', padding: '8px', background: 'rgba(239,71,111,.08)', borderRadius: '6px', fontSize: '13px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
      el('span', { text: '⛔ 已从待复习排除' }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '恢复',
        onClick: () => {
          store.unexcludePoint(p.id);
          toastSuccess('已恢复');
          renderReview({ query: { filter } });
        },
      }),
    ]) : null,
    (!p.excluded && p.snoozedUntil) ? el('div', { style: { marginTop: '12px', padding: '8px', background: 'rgba(255,209,102,.15)', borderRadius: '6px', fontSize: '13px', color: '#8A6D1B', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
      el('span', { text: `⏰ 已推迟到 ${fmtDate(p.snoozedUntil)}` }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '取消推迟',
        onClick: () => {
          store.snoozePoint(p.id, null);
          toastSuccess('已取消推迟');
          renderReview({ query: { filter } });
        },
      }),
    ]) : null,
  ]);

  return el('div', { class: 'card', style: { cursor: 'default' } }, [
    task ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: `${task.name} / ${chapter.name}` }) : null,
    el('div', { style: { fontWeight: '600', marginBottom: '12px', whiteSpace: 'pre-wrap' }, text: p.content }),
    el('button', {
      class: 'btn btn-ghost btn-sm', text: '👁 显示答案',
      onClick: (e) => {
        const hidden = answer.classList.toggle('hidden');
        e.target.textContent = hidden ? '👁 显示答案' : '🙈 收起';
      },
    }),
    answer,
  ]);
}

function ratingBtn(label, rating, point, filter) {
  return el('button', {
    class: 'btn btn-sm btn-ghost', text: label,
    onClick: () => {
      store.ratePoint(point.id, rating);
      // 自评「忘了」自动标记为易错
      if (rating === 'forgot') {
        store.incrementErrorCount(point.id);
      }
      toastSuccess('已记录');
      renderReview({ query: { filter } });
    },
  });
}