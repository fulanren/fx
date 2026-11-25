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
  document.getElementById('page-title').textContent = isNew ? '新建文件夹' : '编辑文件夹';
  document.getElementById('btn-back').classList.remove('hidden');

  const entityId = isNew ? 'new' : params.id;
  // 扩展表单字段
  let form = {
    name: original.name,
    note: original.note || '',
    autoNumber: original.autoNumber || 'none',
    customNumberPrefix: original.customNumberPrefix || '',
    customNumberSuffix: original.customNumberSuffix || '',
    orderMode: original.orderMode || 'manual',
    lockOrder: original.lockOrder || false,
  };

  const draft = loadDraft('task', entityId);
  if (draft && hasChanges(original, draft.data)) {
    setTimeout(async () => {
      if (await confirmBox({ title: '恢复草稿', message: '检测到未保存的草稿，是否恢复？', confirmText: '恢复', cancelText: '放弃' })) {
        form = { ...form, ...draft.data };
        renderFormUI();
      } else clearDraft('task', entityId);
    }, 300);
  }

  const nameInput = el('input', { type: 'text', value: form.name, placeholder: '如：行测常识、申论金句', onInput: (e) => { form.name = e.target.value; queueSave(); } });
  const noteInput = el('textarea', { placeholder: '文件夹备注（可选）', onInput: (e) => { form.note = e.target.value; queueSave(); } });
  noteInput.value = form.note;

  const queueSave = debounce(() => { saveDraft('task', entityId, form); setStatus('已保存草稿'); }, 300);

  //  自定义序号区域
  const customNumberArea = el('div', { style: { display: form.autoNumber === 'custom' ? 'flex' : 'none', gap: '8px', marginTop: '8px' } }, [
    el('input', { type: 'text', placeholder: '前缀 (如：第)', value: form.customNumberPrefix, onInput: (e) => { form.customNumberPrefix = e.target.value; queueSave(); }, style: { flex: '1', padding: '8px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '6px' } }),
    el('input', { type: 'text', placeholder: '后缀 (如：题)', value: form.customNumberSuffix, onInput: (e) => { form.customNumberSuffix = e.target.value; queueSave(); }, style: { flex: '1', padding: '8px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '6px' } })
  ]);

  const formContainer = el('div', { class: 'section' });

  function renderFormUI() {
    formContainer.innerHTML = '';
    formContainer.appendChild(el('div', { class: 'section-body', style: { paddingTop: '16px' } }, [
      el('div', { class: 'field' }, [el('label', { text: '文件夹名称' }), nameInput]),
      el('div', { class: 'field' }, [el('label', { text: '备注' }), noteInput]),
      !isNew ? el('div', { class: 'section', style: { background: 'var(--bg)', marginTop: '16px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } }, [
        el('div', { class: 'section-head', style: { padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,.05)' } }, [el('span', { text: '🔢 文件夹卡片编号与排序' })]),
        el('div', { class: 'section-body', style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 16px' } }, [
          el('div', { class: 'field' }, [
            el('label', { text: '自动生成序号' }),
            el('select', {
              value: form.autoNumber,
              onchange: (e) => {
                form.autoNumber = e.target.value;
                customNumberArea.style.display = form.autoNumber === 'custom' ? 'flex' : 'none';
                queueSave();
              },
              style: { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' }
            }, [
              el('option', { value: 'none', text: '不生成序号' }),
              el('option', { value: 'number', text: '数字 (1. 2. 3.)' }),
              el('option', { value: 'bracket', text: '括号数字 (1) (2) (3)' }),
              el('option', { value: 'chinese', text: '中文数字 (一、二、三、)' }),
              el('option', { value: 'alpha', text: '英文字母 (A. B. C.)' }),
              el('option', { value: 'custom', text: '自定义前缀/后缀' })
            ])
          ]),
          customNumberArea,
          el('div', { class: 'field' }, [
            el('label', { text: '卡片展示顺序' }),
            el('select', {
              value: form.orderMode,
              onchange: (e) => { form.orderMode = e.target.value; queueSave(); },
              style: { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' }
            }, [
              el('option', { value: 'manual', text: '按手动拖拽顺序' }),
              el('option', { value: 'time', text: '按生成时间 (新->旧)' }),
              el('option', { value: 'alpha', text: '按第一个字拼音首字母 (A-Z)' })
            ])
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' } }, [
            el('input', {
              type: 'checkbox', checked: form.lockOrder,
              onchange: (e) => { form.lockOrder = e.target.checked; queueSave(); }
            }),
            el('span', { text: '锁定排序（生成序号后，不随拖拽改变）' })
          ])
        ])
      ]) : null
    ]));
  }

  renderFormUI();
  view.appendChild(formContainer);

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
        attBody.appendChild(renderAttachmentList('task', params.id, refresh));
        attBody.appendChild(el('div', { style: { marginTop: '8px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📎 添加附件',
            onClick: () => attachmentModal('task', params.id, refresh),
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
    el('button', { class: 'btn btn-primary', text: '保存', onClick: () => doSave() }),
  ]));

  function setStatus(text, type = '') { status.textContent = text ? `● ${text}` : ''; status.className = 'save-status ' + type; }

  async function doSave() {
    if (!form.name.trim()) { setStatus('请填写名称', 'failed'); return; }

    const patch = {
      name: form.name.trim(),
      note: form.note.trim(),
      autoNumber: form.autoNumber,
      customNumberPrefix: form.customNumberPrefix,
      customNumberSuffix: form.customNumberSuffix,
      orderMode: form.orderMode,
      lockOrder: form.lockOrder,
    };

    if (isNew) store.createTask(patch);
    else store.updateTask(params.id, patch);

    clearDraft('task', entityId);
    toastSuccess('文件夹已保存');
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