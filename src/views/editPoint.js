import { el, clear, debounce } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { saveDraft, loadDraft, clearDraft, hasChanges } from '../autosave.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess } from '../ui/toast.js';
import { fmtDate } from '../utils/date.js';
import { attachSpeechButton } from '../ui/speech.js';
import { isMobile } from '../utils/platform.js';
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
    reviewCount: original.reviewCount || 0,
    nextReviewAt: original.nextReviewAt || '',
    manualReviewCount: !!original.manualReviewCount,
    manualNextReviewAt: !!original.manualNextReviewAt,
  };

  const contentInput = el('textarea', { placeholder: '知识点内容（必填）', onInput: e => { form.content = e.target.value; queueSave(); } });
  contentInput.value = form.content;
  const contentRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
    contentInput,
    isMobile ? null : attachSpeechButton(contentInput),
  ]);

  const explainInput = el('textarea', { placeholder: '文字解释（可选）', onInput: e => { form.explanation = e.target.value; queueSave(); } });
  explainInput.value = form.explanation;
  const explainRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
    explainInput,
    isMobile ? null : attachSpeechButton(explainInput),
  ]);

  const difficultyBtns = [];
  const difficultyRow = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
    Array.from({ length: 10 }, (_, i) => {
      const val = i + 1;
      const btn = el('button', {
        class: `btn btn-sm ${form.difficulty === val ? 'btn-primary' : 'btn-ghost'}`,
        text: String(val),
        style: { minWidth: '36px', padding: '4px 8px' },
        onClick: () => {
          form.difficulty = val;
          difficultyBtns.forEach((b, idx) => {
            b.className = `btn btn-sm ${idx + 1 === val ? 'btn-primary' : 'btn-ghost'}`;
          });
          queueSave();
        },
      });
      difficultyBtns.push(btn);
      return btn;
    })
  );

  const errorBtn = el('button', {
    class: `btn btn-sm ${form.isErrorProne ? 'btn-danger' : 'btn-ghost'}`,
    text: form.isErrorProne ? '❗ 易错' : '标记易错',
    style: { minHeight: '32px', padding: '4px 10px', fontSize: '13px' },
    onClick: () => {
      form.isErrorProne = !form.isErrorProne;
      errorBtn.className = `btn btn-sm ${form.isErrorProne ? 'btn-danger' : 'btn-ghost'}`;
      errorBtn.textContent = form.isErrorProne ? '❗ 易错' : '标记易错';
      queueSave();
    },
  });

  let showManual = !!(original.manualReviewCount || original.manualNextReviewAt);

  const manualRow = el('div', {
    class: 'field-row',
    style: { marginTop: '12px', display: showManual ? 'flex' : 'none' },
  }, [
    el('div', { class: 'field' }, [
      el('label', { text: '已背遍数' }),
      el('input', {
        type: 'number', min: '0', value: String(form.reviewCount),
        onInput: e => { form.reviewCount = Number(e.target.value); form.manualReviewCount = true; queueSave(); },
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: '下次复习日期' }),
      el('input', {
        type: 'date',
        value: form.nextReviewAt ? new Date(form.nextReviewAt).toISOString().slice(0, 10) : '',
        onInput: e => { form.nextReviewAt = e.target.value ? new Date(e.target.value).toISOString() : ''; form.manualNextReviewAt = true; queueSave(); },
      }),
    ]),
  ]);

  const manualBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    text: showManual ? '隐藏手动设置' : '手动设置遍数/日期',
    onClick: () => {
      showManual = !showManual;
      manualBtn.textContent = showManual ? '隐藏手动设置' : '手动设置遍数/日期';
      manualRow.style.display = showManual ? 'flex' : 'none';
    },
  });

  const draft = loadDraft('point', entityId);
  if (draft && hasChanges(original, draft.data)) {
    setTimeout(async () => {
      if (await confirmBox({ title: '恢复草稿', message: '检测到未保存的草稿，是否恢复？', confirmText: '恢复', cancelText: '放弃' })) {
        form = { ...form, ...draft.data };
        contentInput.value = form.content;
        explainInput.value = form.explanation;
        difficultyBtns.forEach((b, idx) => {
          b.className = `btn btn-sm ${idx + 1 === form.difficulty ? 'btn-primary' : 'btn-ghost'}`;
        });
        errorBtn.className = `btn btn-sm ${form.isErrorProne ? 'btn-danger' : 'btn-ghost'}`;
        errorBtn.textContent = form.isErrorProne ? '❗ 易错' : '标记易错';
        if (form.manualReviewCount || form.manualNextReviewAt) {
          showManual = true;
          manualRow.style.display = 'flex';
          manualBtn.textContent = '隐藏手动设置';
        }
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

  // ============ 图片 + PDF + 合成 ============
  {
    const imgBody = el('div', { class: 'section-body' });
    const imgSection = el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [el('span', { text: '解释图片' })]),
      imgBody,
    ]);
    view.appendChild(imgSection);

    if (isNew) {
      imgBody.appendChild(el('div', {
        style: { fontSize: '13px', color: 'var(--text-2)', padding: '8px 0' },
        text: '保存知识点后，可以在这里添加图片、导入 PDF 或合成图片。',
      }));
    } else {
      import('./imageList.js').then(({ renderImageList }) => {
        const refresh = () => {
          imgBody.innerHTML = '';
          const refreshed = store.getPoint(params.id);
          if (refreshed) imgBody.appendChild(renderImageList(refreshed, refresh));

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
              class: 'btn btn-sm btn-ghost', text: '📷 添加图片',
              onClick: () => {
                const input = document.getElementById('hidden-image-input');
                if (input) input.click();
                else alert('图片上传组件未加载，请刷新页面重试');
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
  }

  // ============ 附件 ============
  if (!isNew) {
    const attBody = el('div', { class: 'section-body' });
    view.appendChild(el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [el('span', { text: '📎 附件' })]),
      attBody,
    ]));
    import('../ui/attachmentModal.js').then(({ attachmentModal, renderAttachmentList }) => {
      const refresh = () => {
        attBody.innerHTML = '';
        attBody.appendChild(renderAttachmentList('point', params.id, refresh));
        attBody.appendChild(el('div', { style: { marginTop: '8px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📎 添加附件',
            onClick: () => attachmentModal('point', params.id, refresh),
          }),
        ]));
      };
      refresh();
    });
  }

  // ============ 复习设置 ============
  view.appendChild(makeSection('复习设置', [
    el('div', { class: 'field' }, [
      el('label', { text: '难记度' }),
      difficultyRow,
    ]),
    el('div', { style: { marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,.03)', borderRadius: '10px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' }, text: '复习状态（手动设置）' }),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, [
        errorBtn,
        manualBtn,
      ]),
      manualRow,
    ]),
  ]));

  // ============ 录音 ============
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
      store.updatePoint(params.id, {
        content: form.content.trim(),
        explanation: form.explanation.trim(),
        difficulty: form.difficulty,
        isErrorProne: form.isErrorProne,
        reviewCount: form.reviewCount,
        nextReviewAt: form.nextReviewAt,
        manualReviewCount: form.manualReviewCount,
        manualNextReviewAt: form.manualNextReviewAt,
      });
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