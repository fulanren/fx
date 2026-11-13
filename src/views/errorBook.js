import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { openExportModal } from './settings.js';

export function renderErrorBook() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '❗ 错题本';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  // 获取所有易错知识点
  const allPoints = [];
  store.getTasks().forEach(t => {
    store.getChapters(t.id).forEach(c => {
      store.getPoints(c.id).forEach(p => {
        if (p.isErrorProne) {
          allPoints.push({ ...p, taskName: t.name, chapterName: c.name });
        }
      });
    });
  });

  // ================= 状态管理 =================
  let currentFilter = 'all'; // 错因过滤
  const collapsedChapters = new Set();

  function renderMain() {
    view.innerHTML = '';
    
    if (allPoints.length === 0) {
      view.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-icon', text: '🎉' }),
        el('div', { text: '太棒了，目前没有标记为易错的知识点！' }),
      ]));
      return;
    }

    // ================= 1. 顶部工具栏 =================
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' } }, [
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn btn-sm btn-primary', text: '🎯 开始重练', onClick: () => startRetrainMode() }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '🖨️ 导出打印', onClick: () => openExportModal(null, null, true) }),
      ]),
      
      // 错因过滤器
      el('div', { style: { display: 'flex', gap: '4px', background: 'var(--bg)', padding: '4px', borderRadius: '8px' } }, [
        el('button', { class: 'btn btn-sm ' + (currentFilter === 'all' ? 'btn-primary' : 'btn-ghost'), text: '全部', onClick: () => { currentFilter = 'all'; renderMain(); } }),
        el('button', { class: 'btn btn-sm ' + (currentFilter === 'blind' ? 'btn-primary' : 'btn-ghost'), text: '盲区', onClick: () => { currentFilter = 'blind'; renderMain(); } }),
        el('button', { class: 'btn btn-sm ' + (currentFilter === 'careless' ? 'btn-primary' : 'btn-ghost'), text: '粗心', onClick: () => { currentFilter = 'careless'; renderMain(); } }),
      ])
    ]));

    // 应用过滤
    let filteredPoints = allPoints;
    if (currentFilter !== 'all') {
      filteredPoints = allPoints.filter(p => p.errorReason === currentFilter);
    }

    // ================= 2. 按章节分组渲染 =================
    const grouped = {};
    filteredPoints.forEach(p => {
      const key = `${p.taskName} || ${p.chapterName}`;
      if (!grouped[key]) grouped[key] = { task: p.taskName, chapter: p.chapterName, items: [] };
      grouped[key].items.push(p);
    });

    if (Object.keys(grouped).length === 0) {
      view.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', padding: '40px' }, text: '当前分类下没有错题' }));
      return;
    }

    Object.values(grouped).forEach(group => {
      const isCollapsed = collapsedChapters.has(group.chapter);
      
      const section = el('div', { class: 'section', style: { marginBottom: '12px' } });
      
      // 章节头部（折叠）
      section.appendChild(el('div', {
        class: 'section-head', style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between' },
        onClick: () => {
          if (isCollapsed) collapsedChapters.delete(group.chapter);
          else collapsedChapters.add(group.chapter);
          renderMain();
        }
      }, [
        el('span', { text: `📖 ${group.task} - ${group.chapter} (${group.items.length})` }),
        el('span', { text: isCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
      ]));

      // 错题列表
      if (!isCollapsed) {
        const body = el('div', { class: 'section-body', style: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } });
        group.items.forEach(p => {
          body.appendChild(renderErrorCard(p));
        });
        section.appendChild(body);
      }
      
      view.appendChild(section);
    });
  }

  // ================= 卡片渲染 =================
  function renderErrorCard(p) {
    const card = el('div', { class: 'card', style: { padding: '12px', marginBottom: '0', borderLeft: '3px solid var(--danger)', display: 'flex', flexDirection: 'column', gap: '8px' } });
    
    card.appendChild(el('div', { 
      style: { fontWeight: '600', fontSize: '15px', cursor: 'pointer', whiteSpace: 'pre-wrap' },
      text: p.content,
      onClick: () => navigate(`#/edit-point/${p.id}`)
    }));

    // 错因标签 & 自评按钮
    card.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } }, [
      el('div', { style: { display: 'flex', gap: '6px' } }, [
        p.errorReason === 'blind' ? el('span', { style: { fontSize: '11px', background: 'rgba(142,202,230,0.2)', color: 'var(--primary-dark)', padding: '2px 6px', borderRadius: '4px' }, text: '📚 知识盲区' }) : null,
        p.errorReason === 'careless' ? el('span', { style: { fontSize: '11px', background: 'rgba(255,209,102,0.3)', color: '#B8860B', padding: '2px 6px', borderRadius: '4px' }, text: '✏️ 粗心大意' }) : null
      ]),
      
      el('div', { style: { display: 'flex', gap: '6px' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '😵 忘了', onClick: () => { store.ratePoint(p.id, 'forgot'); toastSuccess('已记录'); } }),
        el('button', { class: 'btn btn-sm btn-primary', text: '😎 记得并消除', onClick: () => { 
          store.ratePoint(p.id, 'remember'); 
          store.updatePoint(p.id, { isErrorProne: false }); 
          toastSuccess('太棒了！已移出错题本'); 
          allPoints.splice(allPoints.findIndex(item => item.id === p.id), 1);
          renderMain(); 
        } })
      ])
    ]));

    return card;
  }

  // ================= 沉浸式重练模式 =================
  function startRetrainMode() {
    if (allPoints.length === 0) return;
    
    let idx = 0;
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'var(--bg)' } });
    const container = el('div', { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '20px', maxWidth: '800px', margin: '0 auto' } });
    mask.appendChild(container);

    function renderCard() {
      container.innerHTML = '';
      if (idx >= allPoints.length) {
        container.appendChild(el('div', { class: 'empty', style: { marginTop: '40px' } }, [
          el('div', { class: 'empty-icon', text: '👏' }),
          el('div', { text: '错题重练完毕！' }),
          el('button', { class: 'btn btn-primary', style: { marginTop: '20px' }, text: '返回列表', onClick: () => { mask.remove(); renderMain(); } })
        ]));
        return;
      }

      const p = allPoints[idx];
      
      // 进度条
      container.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px', textAlign: 'center' }, text: `第 ${idx + 1} / ${allPoints.length} 题` }));

      // 题干
      container.appendChild(el('div', { class: 'card', style: { flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center', fontSize: '20px', fontWeight: '600', whiteSpace: 'pre-wrap' }, text: p.content }));

      const actionArea = el('div', { style: { marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' } });
      container.appendChild(actionArea);

      let isAnswerShown = false;
      
      const showAnswerBtn = el('button', {
        class: 'btn btn-primary', text: '👁️ 显示解析 / 回忆答案',
        style: { padding: '16px', fontSize: '16px' },
        onClick: () => {
          isAnswerShown = true;
          actionArea.innerHTML = '';
          
          // 显示解释
          if (p.explanation) {
            container.appendChild(el('div', { style: { marginTop: '16px', padding: '16px', background: 'var(--bg)', borderRadius: '8px', fontSize: '15px', whiteSpace: 'pre-wrap' }, text: p.explanation }));
          }
          
          // 显示自评
          actionArea.appendChild(el('div', { style: { display: 'flex', gap: '10px' } }, [
            el('button', { class: 'btn btn-danger', text: '😵 忘了', style: { flex: '1' }, onClick: () => { store.ratePoint(p.id, 'forgot'); idx++; renderCard(); } }),
            el('button', { class: 'btn btn-primary', text: '😎 记得并消除', style: { flex: '1' }, onClick: () => { 
              store.ratePoint(p.id, 'remember'); 
              store.updatePoint(p.id, { isErrorProne: false }); 
              idx++; renderCard(); 
            } })
          ]));
        }
      });
      
      if (!isAnswerShown) {
        actionArea.appendChild(showAnswerBtn);
      }

      // 退出按钮
      container.appendChild(el('div', { style: { marginTop: 'auto', paddingTop: '20px', textAlign: 'center' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '退出重练', onClick: () => { mask.remove(); renderMain(); } })
      ]));
    }

    renderCard();
    document.body.appendChild(mask);
  }

  renderMain();
}