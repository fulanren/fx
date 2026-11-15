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

  // 👇 核心高亮辅助函数
  function highlightText(text, keyword) {
    if (!keyword) return text;
    const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const regex = new RegExp(`(${keyword})`, 'gi');
    return safeText.replace(regex, `<mark style="background: #FFD166; color: #2B2D42; padding: 0 2px; border-radius: 2px;">$1</mark>`);
  }

  view.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: `共 ${total} 条结果` }));

  // 👇 任务（文件夹）
  if (result.tasks.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `📁 文件夹（${result.tasks.length}）` }));
    result.tasks.forEach(t => {
      const card = el('div', { class: 'card', onClick: () => navigate(`#/chapter-list/${t.id}`) });
      card.innerHTML = `<div class="card-title">${highlightText(t.name, q)}</div>`;
      view.appendChild(card);
    });
  }

  // 👇 章节（子模块）
  if (result.chapters.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `📂 子文件夹（${result.chapters.length}）` }));
    result.chapters.forEach(c => {
      const card = el('div', { class: 'card', onClick: () => navigate(`#/chapter/${c.id}`) });
      card.innerHTML = `<div class="card-title">${highlightText(c.name, q)}</div>`;
      view.appendChild(card);
    });
  }

  // 👇 知识点（卡片）
  if (result.points.length) {
    view.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `💡 卡片（${result.points.length}）` }));
    result.points.forEach(p => {
      const ch = store.getChapter(p.chapterId);
      const subTitle = ch ? `📁 ${ch.name}` : '📄 散落卡片';

      const card = el('div', {
        class: 'card',
        onClick: () => {
          // 👈 核心修复：把关键词带进编辑页
          navigate(`#/edit-point/${p.id}?highlight=${encodeURIComponent(q)}`);
        },
      });

      card.innerHTML = `
        <div style="font-weight:600; white-space:pre-wrap;">${highlightText(p.content.slice(0, 100), q)}</div>
        <div style="font-size:12px; color:var(--text-2); margin-top:4px;">${subTitle}</div>
      `;
      view.appendChild(card);
    });
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}