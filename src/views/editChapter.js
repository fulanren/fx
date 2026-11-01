import { el, clear, debounce } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { saveDraft, loadDraft, clearDraft, hasChanges } from '../autosave.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';

export function renderEditChapter({ params, query }) {
  const isNew = params.id === 'new';
  const original = isNew ? { name: '', book: '', part: '', note: '' } : store.getChapter(params.id);
  if (!original) { navigate('#/'); return; }
  const taskId = isNew ? query.taskId : original.taskId;

  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = isNew ? '新建章节' : '编辑章节';
  document.getElementById('btn-back').classList.remove('hidden');

  const entityId = isNew ? 'new' : params.id;
  let form = { name: original.name, book: original.book, part: original.part, note: original.note };

  const draft = loadDraft('chapter', entityId);
  if (draft && hasChanges(original, draft.data)) {
    setTimeout(async () => {
      if (await confirmBox({ title: '恢复草稿', message: '检测到未保存的草稿，是否恢复？', confirmText: '恢复', cancelText: '放弃' })) {
        form = { ...form, ...draft.data };
        nameInput.value = form.name; bookInput.value = form.book;
        partInput.value = form.part; noteInput.value = form.note;
      } else clearDraft('chapter', entityId);
    }, 300);
  }

  const nameInput = el('input', { type: 'text', value: form.name, placeholder: '如：法律常识', onInput: e => { form.name = e.target.value; queueSave(); } });
  const bookInput = el('input', { type: 'text', value: form.book, placeholder: '如：《行测常识判断》', onInput: e => { form.book = e.target.value; queueSave(); } });
  const partInput = el('input', { type: 'text', value: form.part, placeholder: '如：P12-P45', onInput: e => { form.part = e.target.value; queueSave(); } });
  const noteInput = el('textarea', { placeholder: '备注（可选）', onInput: e => { form.note = e.target.value; queueSave(); } });
  noteInput.value = form.note;

  const queueSave = debounce(() => { saveDraft('chapter', entityId, form); setStatus('已保存草稿'); }, 300);

  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-body', style: { paddingTop: '16px' } }, [
      el('div', { class: 'field' }, [el('label', { text: '章节名称' }), nameInput]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { text: '书籍/来源' }), bookInput]),
        el('div', { class: 'field' }, [el('label', { text: '部分/页码' }), partInput]),
      ]),
      el('div', { class: 'field' }, [el('label', { text: '备注' }), noteInput]),
    ]),
  ]));

  // ============ 附件区块 ============
  if (!isNew) {
    const attBody = el('div', { class: 'section-body' });
    view.appendChild(el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [el('span', { text: '📎 附件' })]),
      attBody,
    ]));
    import('../ui/attachmentModal.js').then(({ attachmentModal, renderAttachmentList }) => {
      const refresh = () => {
        attBody.innerHTML = '';
        attBody.appendChild(renderAttachmentList('chapter', params.id, refresh));
        attBody.appendChild(el('div', { style: { marginTop: '8px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📎 添加附件',
            onClick: () => attachmentModal('chapter', params.id, refresh),
          }),
        ]));
      };
      refresh();
    });
  }

  const status = el('div', { class: 'save-status' });
  view.appendChild(el('div', { class: 'edit-footer' }, [
    status,
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => goBack() }),
    el('button', { class: 'btn btn-primary', text: '保存', onClick: doSave }),
  ]));

  function setStatus(text, type = '') { status.textContent = text ? `● ${text}` : ''; status.className = 'save-status ' + type; }

  function doSave() {
    if (!form.name.trim()) { setStatus('请填写名称', 'failed'); return; }
    if (isNew) store.createChapter({ taskId, name: form.name.trim(), book: form.book.trim(), part: form.part.trim(), note: form.note.trim() });
    else store.updateChapter(params.id, { name: form.name.trim(), book: form.book.trim(), part: form.part.trim(), note: form.note.trim() });
    clearDraft('chapter', entityId);
    toastSuccess('已保存');
    navigate(`#/chapter-list/${taskId}`);
  }

  async function goBack() {
    if (hasChanges(original, form)) {
      const r = await confirmBox({ title: '未保存', message: '有未保存的修改', confirmText: '保存草稿并离开', cancelText: '继续编辑', extra: { label: '放弃修改', value: 'discard' } });
      if (r === 'discard') { clearDraft('chapter', entityId); navigate(`#/chapter-list/${taskId}`); }
      else if (r === true) { saveDraft('chapter', entityId, form); navigate(`#/chapter-list/${taskId}`); }
    } else navigate(`#/chapter-list/${taskId}`);
  }
}