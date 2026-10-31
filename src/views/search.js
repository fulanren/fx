import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';

export function renderSearch({ query }) {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '搜索';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  const input = el('input', {
    type: 'search', placeholder: '搜索任务、章节、知识点…',
    value: query.q || '',
    style: { width: '100%', padding: '12px', fontSize: '16px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px', marginBottom: '16px' },
    onInput: debounce((e) => {
      navigate(`#/search?q=${encodeURIComponent(e.target.value)}`);
    }, 300),
  });
  view.appendChild(input);

  const q = query.q || '';
  if (!q.trim()) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '🔍' }),
      el('div', { text: '输入关键词搜索' }),
    ]));
    return;
  }

  const result = store.searchAll(q);
  const total = result.tasks.length + result.chapters.length + result.points.length;
  if (total === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '🤔' }),
      el('div', { text: '没有找到相关内容' }),
    ]));
    return;
  }

  view.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: `共 ${total} 条结果` }));

  if (result.tasks.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `任务（${result.tasks.length}）` }));
    result.tasks.forEach(t => view.appendChild(el('div', {
      class: 'card', onClick: () => navigate(`#/chapter-list/${t.id}`),
    }, [el('div', { class: 'card-title', text: t.name })])));
  }

  if (result.chapters.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `章节（${result.chapters.length}）` }));
    result.chapters.forEach(c => view.appendChild(el('div', {
      class: 'card', onClick: () => navigate(`#/chapter/${c.id}`),
    }, [el('div', { class: 'card-title', text: c.name })])));
  }

  if (result.points.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `知识点（${result.points.length}）` }));
    result.points.forEach(p => {
      const ch = store.getChapter(p.chapterId);
      view.appendChild(el('div', {
        class: 'card', onClick: () => navigate(`#/chapter/${p.chapterId}`),
      }, [
        el('div', { style: { fontWeight: '600' }, text: p.content.slice(0, 80) }),
        ch ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' }, text: ch.name }) : null,
      ]));
    });
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}