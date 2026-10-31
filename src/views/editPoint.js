import { el, clear, debounce } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { saveDraft, loadDraft, clearDraft, hasChanges } from '../autosave.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';
import { fmtDate } from '../utils/date.js';
import { attachSpeechButton } from '../ui/speech.js';
import { audioRecorderModal, getAudiosForPoint, renderAudioList } from './audio.js';

export function renderEditPoint({ params, query }) {
  const isNew = params.id === 'new';
  const original = isNew
    ? { content: '', explanation: '', difficulty: 5, isErrorProne: false, reviewCount: 0, nextReviewAt: '' }
    : store.getPoint(params.id);
  if (!original) { navigate('#/'); return; }
  const chapterId = isNew ? query.chapterId : original.chapterId;

  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = isNew ? '新建知识点' : '编辑知识点';
  document.getElementById('btn-back').classList.remove('hidden');

  const entityId = isNew ? 'new' : params.id;
  let form = {
    content: original.content || '',
    explanation: original.explanation || '',
    difficulty: original.difficulty || 5,
    isErrorProne: !!original.isErrorProne,
  };

  // 输入控件
  const contentInput = el('textarea', { placeholder: '知识点内容（必填）', onInput: e => { form.content = e.target.value; queueSave(); } });
  contentInput.value = form.content;
  const contentRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
    contentInput,
    attachSpeechButton(contentInput),
  ]);

  const explainInput = el('textarea', { placeholder: '文字解释（可选）', onInput: e => { form.explanation = e.target.value; queueSave(); } });
  explainInput.value = form.explanation;
  const explainRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
    explainInput,
    attachSpeechButton(explainInput),
  ]);

  const difficultyInput = el('input', { type: 'range', min: '1', max: '10', value: form.difficulty, style: { flex: '1' },
    onInput: e => { form.difficulty = Number(e.target.value); difficultyLabel.textContent = form.difficulty; queueSave(); } });
  const difficultyLabel = el('span', { text: form.difficulty, style: { fontWeight: '600', marginLeft: '12px', minWidth: '24px', textAlign: 'center' } });
  const errorInput = el('input', { type: 'checkbox', checked: form.isErrorProne, onChange: e => { form.isErrorProne = e.target.checked; queueSave(); } });

  // 草稿恢复
  const draft = loadDraft('point', entityId);
  if (draft && hasChanges(original, draft.data)) {
    setTimeout(async () => {
      if (await confirmBox({ title: '恢复草稿', message: '检测到未保存的草稿，是否恢复？', confirmText: '恢复', cancelText: '放弃' })) {
        form = { ...form, ...draft.data };
        contentInput.value = form.content; explainInput.value = form.explanation;
        difficultyInput.value = form.difficulty; difficultyLabel.textContent = form.difficulty;
        errorInput.checked = form.isErrorProne;
      } else clearDraft('point', entityId);
    }, 300);
  }

  const queueSave = debounce(() => { saveDraft('point', entityId, form); setStatus('已保存草稿', 'saved'); }, 300);
  const status = el('div', { class: 'save-status' });
  function setStatus(text, type = '') { status.textContent = text ? `● ${text}` : ''; status.className = 'save-status ' + type; }

  function makeSection(title, children) {
    let collapsed = false;
    const body = el('div', { class: 'section-body' }, children);
    const arrow = el('span', { class: 'section-arrow', text: '▾' });
    const head = el('div', { class: 'section-head', onClick: () => {
      collapsed = !collapsed; body.style.display = collapsed ? 'none' : 'block';
      arrow.textContent = collapsed ? '▸' : '▾';
    } }, [el('span', { text: title }), arrow]);
    return el('div', { class: 'section' }, [head, body]);
  }

  view.appendChild(makeSection('基本信息', [
    el('div', { class: 'field' }, [el('label', { text: '内容' }), contentRow]),
    el('div', { class: 'field' }, [el('label', { text: '文字解释' }), explainRow]),
  ]));

  // 图片 + PDF 导入 + 合成区块（编辑已有知识点时）
  if (!isNew) {
    const imgBody = el('div', { class: 'section-body' });
    const imgSection = el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [el('span', { text: '解释图片' })]),
      imgBody,
    ]);
    view.appendChild(imgSection);

    import('./imageList.js').then(({ renderImageList }) => {
      const refresh = () => {
        imgBody.innerHTML = '';
        const refreshed = store.getPoint(params.id);
        if (refreshed) imgBody.appendChild(renderImageList(refreshed, refresh));

        // 操作按钮：导入 PDF + 合成图片
        imgBody.appendChild(el('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📄 导入 PDF',
            onClick: async () => {
              const { pdfImportModal } = await import('../views/pdfImport.js');
              await pdfImportModal(params.id);
              refresh();
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '🖼 合成图片',
            onClick: () => {
              const pt = store.getPoint(params.id);
              const count = ((pt && pt.imageIds) ? pt.imageIds.length : 0);
              if (count < 2) { alert('至少需要 2 张图片才能合成，当前有 ' + count + ' 张'); return; }
              navigate(`#/compose?pointId=${params.id}`);
            },
          }),
        ]));
      };
      refresh();
    });
  }

  // 复习设置
  view.appendChild(makeSection('复习设置', [
    el('div', { class: 'field' }, [
      el('label', { text: '难记度（1=一看就会，10=反复记不住）' }),
      el('div', { style: { display: 'flex', alignItems: 'center' } }, [difficultyInput, difficultyLabel]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [errorInput, '标记为易错']),
    ]),
    !isNew ? el('div', { style: { fontSize: '13px', color: 'var(--text-2)' } }, [
      `已背 ${original.reviewCount} 遍 · 下次复习 ${fmtDate(original.nextReviewAt)}`,
    ]) : null,
  ]));

  // 录音区块
  if (!isNew) {
    const audioContainer = el('div', { class: 'section-body' });
    view.appendChild(el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [el('span', { text: '🎙 录音' })]),
      audioContainer,
    ]));

    function refreshAudios() {
      audioContainer.innerHTML = '';
      const audios = getAudiosForPoint(params.id);
      if (audios.length === 0) {
        audioContainer.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', padding: '0 16px 8px' }, text: '还没有录音' }));
      } else {
        const list = renderAudioList(audios, () => refreshAudios());
        if (list) { list.style.padding = '0 16px 8px'; audioContainer.appendChild(list); }
      }
      audioContainer.appendChild(el('div', { style: { padding: '0 16px 16px' } }, [
        el('button', {
          class: 'btn btn-sm btn-primary', text: '🎙 口述背诵',
          onClick: async () => {
            await audioRecorderModal({ pointId: params.id, name: '口述背诵' });
            refreshAudios();
          },
        }),
      ]));
    }
    refreshAudios();
  }

  // 底部操作
  view.appendChild(el('div', { class: 'edit-footer' }, [
    status,
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => goBack() }),
    el('button', { class: 'btn btn-primary', text: '保存', onClick: () => doSave() }),
  ]));

  function doSave() {
    if (!form.content.trim()) { setStatus('请填写内容', 'failed'); contentInput.focus(); return; }
    if (isNew) {
      store.createPoint({ chapterId, content: form.content.trim(), explanation: form.explanation.trim(), difficulty: form.difficulty });
    } else {
      store.updatePoint(params.id, { content: form.content.trim(), explanation: form.explanation.trim(), difficulty: form.difficulty, isErrorProne: form.isErrorProne });
    }
    clearDraft('point', entityId);
    toastSuccess('已保存');
    navigate(`#/chapter/${chapterId}`);
  }

  async function goBack() {
    if (hasChanges(original, form)) {
      const r = await confirmBox({ title: '未保存', message: '有未保存的修改', confirmText: '保存草稿并离开', cancelText: '继续编辑', extra: { label: '放弃修改', value: 'discard' } });
      if (r === 'discard') { clearDraft('point', entityId); navigate(`#/chapter/${chapterId}`); }
      else if (r === true) { saveDraft('point', entityId, form); navigate(`#/chapter/${chapterId}`); }
    } else navigate(`#/chapter/${chapterId}`);
  }
}