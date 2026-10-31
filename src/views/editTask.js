import { el, clear, debounce } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { saveDraft, loadDraft, clearDraft, hasChanges } from '../autosave.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';

export function renderEditTask({ params }) {
  const isNew = params.id === 'new';
  const original = isNew ? { name: '', note: '' } : store.getTask(params.id);
  if (!original) { navigate('#/'); return; }
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = isNew ? '新建任务' : '编辑任务';
  document.getElementById('btn-back').classList.remove('hidden');

  const entityId = isNew ? 'new' : params.id;
  let form = { name: original.name, note: original.note };

  const draft = loadDraft('task', entityId);
  if (draft && hasChanges(original, draft.data)) {
    setTimeout(async () => {
      if (await confirmBox({ title: '恢复草稿', message: '检测到未保存的草稿，是否恢复？', confirmText: '恢复', cancelText: '放弃' })) {
        form = { ...form, ...draft.data };
        nameInput.value = form.name;
        noteInput.value = form.note;
      } else clearDraft('task', entityId);
    }, 300);
  }

  const nameInput = el('input', { type: 'text', value: form.name, placeholder: '如：行测常识', onInput: (e) => { form.name = e.target.value; queueSave(); } });
  const noteInput = el('textarea', { placeholder: '备注（可选）', onInput: (e) => { form.note = e.target.value; queueSave(); } });
  noteInput.value = form.note;

  const queueSave = debounce(() => { saveDraft('task', entityId, form); setStatus('已保存草稿'); }, 300);

  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-body', style: { paddingTop: '16px' } }, [
      el('div', { class: 'field' }, [el('label', { text: '任务名称' }), nameInput]),
      el('div', { class: 'field' }, [el('label', { text: '备注' }), noteInput]),
    ]),
  ]));

  const status = el('div', { class: 'save-status' });
  view.appendChild(el('div', { class: 'edit-footer' }, [
    status,
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => goBack() }),
    el('button', { class: 'btn btn-primary', text: '保存', onClick: () => doSave() }),
  ]));

  function setStatus(text, type = '') { status.textContent = text ? `● ${text}` : ''; status.className = 'save-status ' + type; }

  async function doSave() {
    if (!form.name.trim()) { setStatus('请填写名称', 'failed'); return; }
    if (isNew) store.createTask({ name: form.name.trim(), note: form.note.trim() });
    else store.updateTask(params.id, { name: form.name.trim(), note: form.note.trim() });
    clearDraft('task', entityId);
    toastSuccess('已保存');
    navigate('#/');
  }

  async function goBack() {
    if (hasChanges(original, form)) {
      const r = await confirmBox({ title: '未保存', message: '有未保存的修改', confirmText: '保存草稿并离开', cancelText: '继续编辑', extra: { label: '放弃修改', value: 'discard' } });
      if (r === 'discard') { clearDraft('task', entityId); navigate('#/'); }
      else if (r === true) { saveDraft('task', entityId, form); navigate('#/'); }
    } else navigate('#/');
  }
}