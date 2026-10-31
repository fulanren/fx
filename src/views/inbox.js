import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';

export function renderInbox() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '速记收件箱';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate('#/');

  const input = el('textarea', {
    placeholder: '随手记一句…（Ctrl+Enter 保存）',
    style: { width: '100%', minHeight: '80px', padding: '12px', fontSize: '16px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px', marginBottom: '12px' },
    onKeydown: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { save(); }
    },
  });
  const save = () => {
    const content = input.value.trim();
    if (!content) return;
    store.addInbox(content);
    input.value = '';
    toastSuccess('已保存');
    renderInbox();
  };
  view.appendChild(input);
  view.appendChild(el('button', { class: 'btn btn-primary', text: '保存', onClick: save, style: { marginBottom: '16px' } }));

  const items = store.getInbox();
  if (items.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '📥' }),
      el('div', { text: '收件箱是空的' }),
    ]));
    return;
  }

  items.forEach(item => view.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
    el('div', { style: { whiteSpace: 'pre-wrap', marginBottom: '12px' }, text: item.content }),
    el('div', { class: 'card-actions' }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '归类',
        onClick: () => {
          const taskId = prompt('输入目标任务名称关键词（或留空）');
          // 简化：直接归类到第一个章节
          const tasks = store.getTasks();
          if (tasks.length === 0) { alert('请先创建任务和章节'); return; }
          const ch = store.getChapters(tasks[0].id)[0];
          if (!ch) { alert('请先创建章节'); return; }
          store.createPoint({ chapterId: ch.id, content: item.content });
          store.consumeInbox(item.id);
          toastSuccess('已归入知识点');
          renderInbox();
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除',
        onClick: async () => {
          if (await confirmBox({ title: '删除', message: '删除这条速记？', danger: true, confirmText: '删除' })) {
            store.deleteInbox(item.id);
            renderInbox();
          }
        },
      }),
    ]),
  ])));
}