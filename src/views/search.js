import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';

export function renderSearch({ query }) {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '🔍 搜索';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  const input = el('input', {
    type: 'search', placeholder: '搜索文件夹、卡片内容…',
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

  // 👇 任务（文件夹）
  if (result.tasks.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `📁 文件夹（${result.tasks.length}）` }));
    result.tasks.forEach(t => view.appendChild(el('div', {
      class: 'card', onClick: () => navigate(`#/chapter-list/${t.id}`),
    }, [el('div', { class: 'card-title', text: t.name })])));
  }

  // 👇 章节（子模块）- 虽然界面上不直接展示了，但如果是老数据还是能搜到
  if (result.chapters.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `📂 子文件夹（${result.chapters.length}）` }));
    result.chapters.forEach(c => view.appendChild(el('div', {
      class: 'card', onClick: () => navigate(`#/chapter/${c.id}`),
    }, [el('div', { class: 'card-title', text: c.name })])));
  }

  // 👇 知识点（卡片）
  if (result.points.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `💡 卡片（${result.points.length}）` }));
    result.points.forEach(p => {
      const ch = store.getChapter(p.chapterId);
      // 如果没章节了，说明是散落卡片
      const subTitle = ch ? `📁 ${ch.name}` : '📄 散落卡片';
      
      view.appendChild(el('div', {
        class: 'card', onClick: () => navigate(`#/edit-point/${p.id}`), // 👈 修改：点击直接进卡片编辑页
      }, [
        el('div', { style: { fontWeight: '600' }, text: p.content.slice(0, 80) }),
        el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' }, text: subTitle }),
      ]));
    });
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}