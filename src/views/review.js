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

  view.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px' } }, [
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

  points.forEach(p => view.appendChild(reviewCard(p)));
}

function tabBtn(label, value, current) {
  return el('button', {
    class: `btn btn-sm ${value === current ? 'btn-primary' : 'btn-ghost'}`,
    text: label,
    onClick: () => navigate(`#/review?filter=${value}`),
  });
}

function reviewCard(p) {
  const chapter = store.getChapter(p.chapterId);
  const task = chapter ? store.getTask(chapter.taskId) : null;
  const answer = el('div', { class: 'hidden', style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,.06)' } }, [
    p.explanation ? el('div', { style: { marginBottom: '12px' } }, [
      el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: '解释' }),
      el('div', { text: p.explanation, style: { whiteSpace: 'pre-wrap' } }),
    ]) : null,
    el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px' } }, [
      `已背 ${p.reviewCount} 遍 · 难度 ${p.difficulty}/10 · 下次 ${fmtDate(p.nextReviewAt)}`,
    ]),
    el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
      ratingBtn('😣 忘了', 'forgot', p),
      ratingBtn('😐 模糊', 'vague', p),
      ratingBtn('😊 记得', 'remember', p),
    ]),
  ]);

  return el('div', { class: 'card', style: { cursor: 'default' } }, [
    task ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: `${task.name} / ${chapter.name}` }) : null,
    el('div', { style: { fontWeight: '600', marginBottom: '12px', whiteSpace: 'pre-wrap' }, text: p.content }),
    el('button', { class: 'btn btn-ghost btn-sm', text: '👁 显示答案',
      onClick: (e) => {
        const hidden = answer.classList.toggle('hidden');
        e.target.textContent = hidden ? '👁 显示答案' : '🙈 收起';
      } }),
    answer,
  ]);
}

function ratingBtn(label, rating, point) {
  return el('button', {
    class: 'btn btn-sm btn-ghost', text: label,
    onClick: () => {
      store.ratePoint(point.id, rating);
      toastSuccess('已记录');
      renderReview({ query: { filter: 'due' } });
    },
  });
}