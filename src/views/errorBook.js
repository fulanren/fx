import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';

export function renderErrorBook() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '❗ 错题本';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  const allPoints = [];
  // 遍历所有任务、章节，收集易错知识点
  store.getTasks().forEach(t => {
    store.getChapters(t.id).forEach(c => {
      store.getPoints(c.id).forEach(p => {
        if (p.isErrorProne) {
          allPoints.push({ ...p, taskName: t.name, chapterName: c.name });
        }
      });
    });
  });

  if (allPoints.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '🎉' }),
      el('div', { text: '太棒了，目前没有标记为易错的知识点！' }),
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginTop: '8px' }, text: '继续加油背诵吧~' })
    ]));
    return;
  }

  view.appendChild(el('div', { style: { color: 'var(--text-2)', fontSize: '13px', marginBottom: '12px' }, text: `共找到 ${allPoints.length} 个易错知识点` }));

  allPoints.forEach(p => {
    const card = el('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
      // 标题和来源
      el('div', { 
        style: { cursor: 'pointer' },
        onClick: () => navigate(`#/edit-point/${p.id}`) 
      }, [
        el('div', { style: { fontWeight: '600', marginBottom: '8px', whiteSpace: 'pre-wrap' }, text: p.content }),
        el('div', { style: { fontSize: '12px', color: 'var(--text-2)', display: 'flex', gap: '8px' } }, [
          el('span', { text: `📚 ${p.taskName}` }),
          el('span', { text: `📖 ${p.chapterName}` })
        ])
      ]),
      
      // 👇 新增：一键消灭错题区
      el('div', { style: { display: 'flex', gap: '8px', borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: '12px' } }, [
        el('span', { style: { fontSize: '13px', color: 'var(--text-2)', alignSelf: 'center' }, text: '自评：' }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '😵 忘了',
          style: { flex: '1', color: 'var(--danger)', background: 'rgba(239,71,111,.1)' },
          onClick: () => {
            store.ratePoint(p.id, 'forgot');
            toastSuccess('已记录：忘了（继续保持易错）');
            // 不刷新页面，直接视觉反馈
            card.style.opacity = '0.5';
            setTimeout(() => card.style.opacity = '1', 300);
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '🤔 模糊',
          style: { flex: '1', color: 'var(--warn)', background: 'rgba(255,209,102,.2)' },
          onClick: () => {
            store.ratePoint(p.id, 'vague');
            toastSuccess('已记录：模糊');
            card.style.opacity = '0.5';
            setTimeout(() => card.style.opacity = '1', 300);
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-primary', text: '😎 记得',
          style: { flex: '1' },
          onClick: () => {
            // 记录自评
            store.ratePoint(p.id, 'remember');
            // 关键：自动取消易错标记
            store.updatePoint(p.id, { isErrorProne: false });
            toastSuccess('太棒了！已从错题本中移除');
            // 直接从DOM移除该卡片
            card.style.transform = 'scale(0.9)';
            card.style.opacity = '0';
            setTimeout(() => {
              card.remove();
              // 如果全移除了，刷新页面
              if (document.querySelectorAll('.card').length === 0) {
                renderErrorBook();
              }
            }, 300);
          }
        })
      ])
    ]);
    view.appendChild(card);
  });
}