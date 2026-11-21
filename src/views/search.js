import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { createSearchEngine } from '../utils/searchEngine.js';

export function renderSearch({ query }) {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '🔍 搜索';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  // 1. 初始化搜索引擎并建索引
  const searchEngine = createSearchEngine();
  const allTasks = store.getTasks();
  const allChapters = [];
  allTasks.forEach(t => allChapters.push(...store.getChapters(t.id)));
  const allPoints = store.getPoints();

  // 构建毫秒级索引
  searchEngine.buildIndex(allPoints, allTasks, allChapters);

  // 2. 输入框
  const input = el('input', {
    type: 'search', placeholder: '毫秒级搜索文件夹、卡片内容…',
    value: query.q || '',
    style: { width: '100%', padding: '12px', fontSize: '16px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px', marginBottom: '16px', outline: 'none' },
    onInput: debounce((e) => {
      // 这里我们不再跳转路由，而是直接在本地重绘结果，速度极快！
      renderResults(e.target.value);
      // 顺手更新一下 URL，刷新后不会丢
      history.replaceState(null, '', `#/search?q=${encodeURIComponent(e.target.value)}`);
    }, 150),
  });
  view.appendChild(input);

  const resultWrap = el('div');
  view.appendChild(resultWrap);

  // 3. 高亮辅助函数（保留你原本的样式）
  function highlightText(text, keyword) {
    if (!keyword) return text;
    const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // 把关键词也用正则转义一下，防止搜 "(" 报错
    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeKeyword})`, 'gi');
    return safeText.replace(regex, `<mark style="background: #FFD166; color: #2B2D42; padding: 0 2px; border-radius: 2px;">$1</mark>`);
  }

  // 4. 核心渲染函数
  function renderResults(keyword) {
    resultWrap.innerHTML = '';
    const q = (keyword || '').trim();

    if (!q) {
      resultWrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-icon', text: '🔍' }),
        el('div', { text: '输入关键词搜索' }),
      ]));
      return;
    }

    // 毫秒级搜索
    const start = performance.now();
    const results = searchEngine.search(q);
    const time = (performance.now() - start).toFixed(2);

    if (results.length === 0) {
      resultWrap.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-icon', text: '🤔' }),
        el('div', { text: '没有找到相关内容' }),
      ]));
      return;
    }

    // 对结果进行分类
    const tasks = results.filter(r => r.type === 'task');
    const chapters = results.filter(r => r.type === 'chapter');
    const points = results.filter(r => r.type === 'point');

    resultWrap.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--primary-dark)', marginBottom: '12px', fontWeight: '600' }, text: `共找到 ${results.length} 条结果（耗时 ${time} ms）` }));

    //任务（文件夹）
    if (tasks.length) {
      resultWrap.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `📁 文件夹（${tasks.length}）` }));
      tasks.forEach(t => {
        const card = el('div', { class: 'card', onClick: () => navigate(`#/chapter-list/${t.id}`) });
        card.innerHTML = `<div class="card-title">${highlightText(t.title, q)}</div>`;
        resultWrap.appendChild(card);
      });
    }

    //章节（子文件夹）
    if (chapters.length) {
      resultWrap.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `📂 子文件夹（${chapters.length}）` }));
      chapters.forEach(c => {
        const card = el('div', { class: 'card', onClick: () => navigate(`#/chapter/${c.id}`) });
        card.innerHTML = `<div class="card-title">${highlightText(c.title, q)}</div>`;
        resultWrap.appendChild(card);
      });
    }

    //知识点（卡片）
    if (points.length) {
      resultWrap.appendChild(el('div', { style: { fontWeight: '600', margin: '12px 0 8px' }, text: `💡 卡片（${points.length}）` }));
      points.forEach(p => {
        const ch = store.getChapter(p.raw.chapterId);
        const subTitle = ch ? `📁 ${ch.name}` : '📄 散落卡片';
        const displayContent = p.title.replace(/<[^>]+>/g, '').slice(0, 100); // 去标签防错位

        const card = el('div', {
          class: 'card',
          onClick: () => {
            navigate(`#/edit-point/${p.id}?highlight=${encodeURIComponent(q)}`);
          },
        });

        card.innerHTML = `
          <div style="font-weight:600; white-space:pre-wrap;">${highlightText(displayContent, q)}</div>
          <div style="font-size:12px; color:var(--text-2); margin-top:4px;">${subTitle}</div>
        `;
        resultWrap.appendChild(card);
      });
    }
  }

  // 初始渲染
  if (query.q) {
    renderResults(query.q);
  } else {
    renderResults('');
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}