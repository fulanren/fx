import { el, clear, debounce } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { saveDraft, loadDraft, clearDraft, hasChanges } from '../autosave.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { fmtDate } from '../utils/date.js';
import { attachSpeechButton } from '../ui/speech.js';
import { isMobile } from '../utils/platform.js';
import { audioRecorderModal, getAudiosForPoint, renderAudioList } from './audio.js';
import { renderImageList } from './imageList.js';

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

  // ============ 拍照识别按钮 ============
  const ocrBtn = el('button', {
    class: 'btn btn-ghost', title: '拍题识别',
    style: { padding: '8px', fontSize: '18px', borderRadius: '10px', background: 'rgba(142,202,230,.15)', height: '44px', flexShrink: '0' },
    text: '📷',
    onClick: () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      // 手机端唤起后置摄像头拍照，电脑端不受影响
      fileInput.capture = 'environment';
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        toastSuccess('正在识别文字，请稍候…');

        try {
          // 注意：如果你的 OCR 模块不是 '../utils/ocr.js'，请把这里改成你的真实路径
          const ocrModule = await import('../utils/ocr.js');
          // 尝试寻找识别方法（兼容不同的写法命名）
          const recognize = ocrModule.ocrImage || ocrModule.recognizeImage || ocrModule.default;

          if (typeof recognize !== 'function') {
            throw new Error('未找到 OCR 识别函数，请检查 utils/ocr.js 的导出名称');
          }

          const text = await recognize(file);
          if (text && text.trim()) {
            // 追加识别结果
            contentInput.value += (contentInput.value ? '\n' : '') + text.trim();
            form.content = contentInput.value;
            queueSave(); // 触发自动保存
            toastSuccess('文字识别成功');
          } else {
            toastError('未识别到文字内容');
          }
        } catch (err) {
          console.error('OCR 识别失败:', err);
          alert('识别失败，请重试。原因：' + err.message);
        }
      };
      fileInput.click();
    }
  });

  // 把 ocrBtn 加进 contentRow 里
  const contentRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
    contentInput,
    isMobile ? null : attachSpeechButton(contentInput),
    ocrBtn,
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
    const head = el('div', {
      class: 'section-head', onClick: () => {
        collapsed = !collapsed; body.style.display = collapsed ? 'none' : 'block';
        arrow.textContent = collapsed ? '▸' : '▾';
      }
    }, [el('span', { text: title }), arrow]);
    return el('div', { class: 'section' }, [head, body]);
  }

  view.appendChild(makeSection('基本信息', [
    el('div', { class: 'field' }, [el('label', { text: '内容' }), contentRow]),
    el('div', { class: 'field' }, [el('label', { text: '文字解释' }), explainRow]),
  ]));

  // ============ 图片 + PDF + 合成 ============
  {
    const imgBody = el('div', { class: 'section-body' });
    // 👇 必须要保留 const imgSection = ...
    const imgSection = el('div', { class: 'section' }, [
      el('div', { class: 'section-head' }, [el('span', { text: '图文附件' })]), // 这里改名字
      imgBody,
    ]);
    view.appendChild(imgSection);

    if (isNew) {
      imgBody.appendChild(el('div', {
        style: { fontSize: '13px', color: 'var(--text-2)', padding: '8px 0', marginBottom: '8px' },
        text: '先保存知识点，保存后可以在这里添加图片、导入 PDF 或合成图片。',
      }));
      imgBody.appendChild(el('button', {
        class: 'btn btn-sm btn-primary', text: '保存并继续',
        onClick: () => doSave(),
      }));
    } else {
      // ============ 图片列表（静态引入版） ============
      const refresh = () => {
        imgBody.innerHTML = '';
        const refreshed = store.getPoint(params.id);
        if (refreshed) imgBody.appendChild(renderImageList(refreshed, refresh));

        // 图片列表下方的操作按钮组
        imgBody.appendChild(el('div', { style: { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost',
            text: '📷 添加图片',
            style: { fontSize: '12px', padding: '4px 10px' },
            onClick: () => {
              const input = document.getElementById('hidden-image-input');
              if (input) input.click();
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost',
            text: '📄 挑选 PDF',
            style: { fontSize: '12px', padding: '4px 10px' },
            onClick: async () => {
              const { pdfImportModal } = await import('../views/pdfImport.js');
              await pdfImportModal(params.id);
              refresh();
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost',
            text: '🔗 合并',
            style: { fontSize: '12px', padding: '4px 10px' },
            onClick: () => {
              const pt = store.getPoint(params.id);
              const total = (pt.imageIds || []).length + (pt.compositeImageIds || []).length;
              if (total < 2) { alert('至少需要 2 个文件才能合并'); return; }
              navigate(`#/composer?pointId=${params.id}`);
            },
          }),
        ]));

        // 拖拽上传绑定
        imgBody.style.position = 'relative';
        // 移除旧的监听器（避免每次 refresh 重复绑定）
        imgBody.ondragover = (e) => {
          e.preventDefault();
          imgBody.style.boxShadow = 'inset 0 0 0 2px var(--primary)';
        };
        imgBody.ondragleave = (e) => {
          e.preventDefault();
          imgBody.style.boxShadow = 'none';
        };
        imgBody.ondrop = async (e) => {
          e.preventDefault();
          imgBody.style.boxShadow = 'none';

          const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
          if (files.length === 0) return;

          const pt = store.getPoint(params.id);
          if (!pt) { toastError('知识点未找到'); return; }

          const { dbPut } = await import('../db.js');
          if (!pt.imageIds) pt.imageIds = [];

          for (const f of files) {
            const img = new Image();
            const url = URL.createObjectURL(f);
            await new Promise(r => { img.onload = r; img.src = url; });

            const id = crypto.randomUUID();
            await dbPut('images', {
              id,
              originalBlob: f,
              annotatedBlob: f,
              width: img.width,
              height: img.height,
              dpr: window.devicePixelRatio || 1,
              source: 'upload',
              createdAt: new Date().toISOString(),
            });
            URL.revokeObjectURL(url);
            pt.imageIds.push(id);
          }

          store.updatePoint(pt.id, { imageIds: pt.imageIds });
          toastSuccess(`已添加 ${files.length} 张图片`);
          refresh();
        };
      };

      refresh(); // 直接执行一次
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