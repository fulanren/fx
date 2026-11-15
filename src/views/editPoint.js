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
import { dbPut, dbAll } from '../db.js';

export function renderEditPoint({ params, query }) {
  // 👇 核心兜底：只要进入编辑页，强行把画板残留的组件干掉
  const doneBtn = document.getElementById('btn-done');
  const prevBtn = document.getElementById('pdf-nav-prev');
  const nextBtn = document.getElementById('pdf-nav-next');
  const pageLabel = document.getElementById('pdf-nav-label');
  if (doneBtn) doneBtn.remove();
  if (prevBtn) prevBtn.remove();
  if (nextBtn) nextBtn.remove();
  if (pageLabel) pageLabel.remove();

  const isNew = params.id === 'new';
  const incomingImageId = query.imageId;

  const original = isNew
    ? { content: '', explanation: '', difficulty: 5, isErrorProne: false, reviewCount: 0, nextReviewAt: '' }
    : store.getPoint(params.id);

  if (!original) { navigate('#/'); return; }
  const chapterId = isNew ? query.chapterId : original.chapterId;
  // 记录各个模块的折叠状态（默认全收起）
  let isInfoCollapsed = false; // 基本信息还是默认展开，方便打字
  let isImgCollapsed = true;   // 图文附件默认收起
  let isAttCollapsed = true;   // 外部附件默认收起
  let isAudioCollapsed = true; // 录音默认收起
  let isReviewCollapsed = true; // 👈 复习设置也默认收起
  let isUnlocked = isNew;      // 编辑时锁定，新建时解锁
  let showDifficultyBeforeExpand = original?.showDifficultyBeforeExpand || false;
  let isDraftResolved = false; // 👈 新增：是否已经处理过草稿弹窗

  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = isNew ? '新建卡片' : '编辑卡片';
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

  const contentInput = el('textarea', { placeholder: '卡片内容（必填）', onInput: e => { form.content = e.target.value; queueSave(); } });
  // 如果是新建，自动聚焦到输入框
  if (isNew) {
    setTimeout(() => {
      contentInput.focus();
    }, 100);
  }
  contentInput.value = form.content;

  // 👇 核心新增：搜索高亮与自动定位功能
  const highlightWord = query.highlight;
  if (highlightWord) {
    setTimeout(() => {
      // 1. 自动把光标聚焦到内容框
      contentInput.focus();

      // 2. 平滑滚动到屏幕中央
      if (!window.__hasScrolledToSearch) {
        window.__hasScrolledToSearch = true; // 防止多次刷新重复乱滚
        contentInput.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 3. 如果输入框里真的有这个词，就把它选中（视觉效果更好）
        const pos = contentInput.value.indexOf(highlightWord);
        if (pos !== -1) {
          contentInput.setSelectionRange(pos, pos + highlightWord.length);
        }
      }
    }, 200); // 稍微延迟 200ms 等页面渲染完毕再滚
  }

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

  // 然后才是加载
  const draft = loadDraft('point', entityId);
  if (draft && hasChanges(original, draft.data)) {
    setTimeout(async () => {
      const restore = await confirmBox({
        title: '恢复草稿',
        message: '检测到未保存的草稿，是否恢复？',
        confirmText: '恢复',
        cancelText: '放弃'
      });

      if (restore) {
        // 恢复数据
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
      } else {
        // 如果点了放弃，把表单恢复成原始状态
        form.content = original ? original.content : '';
        form.explanation = original ? original.explanation : '';
        if (contentInput) contentInput.value = form.content;
        if (explainInput) explainInput.value = form.explanation;
      }

      // 1. 锁死标志位
      isDraftResolved = true;

      // 2. 👇 核心修复：不管选了什么，立刻销毁草稿！
      clearDraft('point', entityId);
      localStorage.removeItem(`kg_draft_point_${entityId}`);

    }, 300);
  }

  const status = el('div', { class: 'save-status' });
  function setStatus(text, type = '') { status.textContent = text ? `● ${text}` : ''; status.className = 'save-status ' + type; }

  const queueSave = debounce(() => {
    // 如果已经处理过弹窗（恢复了或者放弃了），就不准再自动存草稿了！
    if (isDraftResolved) return;

    saveDraft('point', entityId, form);
    setStatus('已保存草稿', 'saved');
  }, 300);


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

  // ============ 归档选择区（可折叠） ============
  // 读取折叠状态，默认折叠（true 表示收起）
  let isFolderCollapsed = localStorage.getItem('kg_folder_selector_collapsed') !== 'false';

  const folderSection = el('div', { class: 'section', style: { background: 'rgba(142, 202, 230, 0.05)', marginBottom: '16px', borderRadius: '8px', border: '1px solid rgba(142, 202, 230, 0.2)' } });

  function renderFolderSelector() {
    folderSection.innerHTML = '';

    // 头部（点击可折叠）
    const header = el('div', {
      class: 'section-head',
      style: { padding: '12px 16px', borderBottom: isFolderCollapsed ? 'none' : '1px solid rgba(0,0,0,.05)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      onClick: () => {
        isFolderCollapsed = !isFolderCollapsed;
        localStorage.setItem('kg_folder_selector_collapsed', isFolderCollapsed);
        renderFolderSelector();
      }
    }, [
      el('span', { text: '📁 归属文件夹', style: { fontWeight: '600' } }),
      el('span', { text: isFolderCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
    ]);

    folderSection.appendChild(header);

    if (isFolderCollapsed) return; // 如果折叠了，就不渲染下面内容了

    // 展开后的内容
    const body = el('div', { style: { padding: '12px 16px' } });

    const currentChapter = chapterId ? store.getChapter(chapterId) : null;
    const currentTask = currentChapter ? store.getTask(currentChapter.taskId) : null;

    const infoRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' } });
    if (currentTask) {
      infoRow.appendChild(el('span', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }, text: `📁 ${currentTask.name}` }));
    } else {
      infoRow.appendChild(el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '📄 散落卡片 (未分类)' }));
    }
    body.appendChild(infoRow);

    const actionRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
      // 新建文件夹
      el('button', {
        class: 'btn btn-sm btn-ghost',
        text: '+ 新建文件夹并归入',
        onClick: () => {
          const folderName = prompt('新建文件夹名称：');
          if (!folderName || !folderName.trim()) return;

          const finalName = folderName.trim();

          // 1. 把新文件夹加入系统的文件夹列表 (注意 key 是 kg_all_folders)
          let folders = [];
          try { folders = JSON.parse(localStorage.getItem('kg_all_folders') || '[]'); } catch { }
          if (!folders.includes(finalName)) {
            folders.push(finalName);
            localStorage.setItem('kg_all_folders', JSON.stringify(folders));
          }

          // 2. 把当前散落卡片里的图片归入文件夹
          const pt = store.getPoint(point.id);
          if (pt && pt.imageIds && pt.imageIds.length > 0) {
            toastSuccess(`正在将图片移入「${finalName}」...`);

            Promise.all(pt.imageIds.map(id => dbGet('images', id))).then(async recs => {
              for (const rec of recs) {
                if (rec) {
                  rec.group = finalName;
                  await dbPut('images', rec);
                }
              }
              toastSuccess(`已成功归入「${finalName}」`);
              if (typeof onRefresh === 'function') {
                onRefresh();
              } else {
                window.location.reload();
              }
            });
          } else {
            toastSuccess(`文件夹「${finalName}」已创建`);
            if (typeof onRefresh === 'function') onRefresh();
            else window.location.reload();
          }
        }
      }),
      // 选择已有文件夹
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🔍 选择已有文件夹',
        onClick: () => {
          openFolderSelectModal((selectedChapterId) => {
            chapterId = selectedChapterId;
            renderFolderSelector();
            toastSuccess('已切换归属文件夹');
          });
        }
      }),
      // 移出文件夹
      (currentTask) ? el('button', {
        class: 'btn btn-sm btn-ghost', text: '📤 移出文件夹', style: { color: 'var(--danger)' },
        onClick: () => {
          chapterId = null;
          renderFolderSelector();
          toastSuccess('已移出，保存后回到首页散落区');
        }
      }) : null
    ]);

    body.appendChild(actionRow);
    folderSection.appendChild(body);
  }

  renderFolderSelector();
  view.appendChild(folderSection);

  const basicSection = el('div', { class: 'section' });
  function renderBasicSection() {
    basicSection.innerHTML = '';
    basicSection.appendChild(el('div', {
      class: 'section-head', style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between' },
      onClick: () => { isInfoCollapsed = !isInfoCollapsed; renderBasicSection(); }
    }, [
      el('span', { text: '基本信息' }),
      el('span', { text: isInfoCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
    ]));
    if (!isInfoCollapsed) {
      basicSection.appendChild(el('div', { class: 'section-body' }, [
        el('div', { class: 'field' }, [el('label', { text: '内容' }), contentRow]),
        el('div', { class: 'field' }, [el('label', { text: '文字解释' }), explainRow]),
      ]));
    }
  }
  renderBasicSection();
  view.appendChild(basicSection);

  // 👇 插入：显示来自 PDF 的反向链接
  if (!isNew && original.linkedPdfs && original.linkedPdfs.length > 0) {
    const linksWrap = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 16px', marginBottom: '12px' }
    });
    original.linkedPdfs.forEach(pdf => {
      linksWrap.appendChild(el('button', {
        class: 'btn btn-sm',
        style: { background: 'rgba(142,202,230,0.15)', color: 'var(--primary-dark)', fontSize: '12px', border: '1px solid var(--primary)', borderRadius: '20px', padding: '4px 12px' },
        text: `🔗 来自资料: ${pdf.pdfName} (第 ${pdf.page} 页)`,
        onClick: () => {
          // 点击直接跳转到 PDF 的指定页
          window.location.hash = `#/pdf-viewer/${pdf.pdfId}?pointId=${params.id}&page=${pdf.page}`;
        }
      }));
    });
    view.appendChild(linksWrap);
  }

  // ============ 图文附件（可折叠） ============
  let isImgRendered = false; // 👈 记录是否已经渲染过内容
  const imgSection = el('div', { class: 'section' });

  function renderImgSection() {
    imgSection.innerHTML = '';

    // 头部
    imgSection.appendChild(el('div', {
      class: 'section-head',
      style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between', borderBottom: isImgCollapsed ? 'none' : '1px solid rgba(0,0,0,.06)' },
      onClick: () => {
        isImgCollapsed = !isImgCollapsed;
        renderImgSection();
      }
    }, [
      el('span', { text: '🖼 图文附件' }),
      el('span', { text: isImgCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
    ]));

    // 展开后的内容
    if (!isImgCollapsed) {
      const imgBody = el('div', { class: 'section-body' });
      imgSection.appendChild(imgBody);

      if (isNew) {
        imgBody.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', padding: '8px 0', marginBottom: '8px' }, text: '先保存知识点，保存后可以在这里添加图片、导入 PDF。' }));
        imgBody.appendChild(el('button', { class: 'btn btn-sm btn-primary', text: '保存并继续', onClick: () => doSave() }));
      } else {
        // 每次展开时，都重新渲染最新的列表
        const refresh = () => {
          imgBody.innerHTML = '';
          const refreshed = store.getPoint(params.id);
          if (refreshed) {
            imgBody.appendChild(renderImageList(refreshed, refresh));
          }
        };
        refresh();
      }
    }
  }

  renderImgSection();
  view.appendChild(imgSection);

  // ============ 附件（可折叠） ============
  if (!isNew) {
    const attSection = el('div', { class: 'section' });
    function renderAttSection() {
      attSection.innerHTML = '';
      attSection.appendChild(el('div', {
        class: 'section-head', style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between' },
        onClick: () => { isAttCollapsed = !isAttCollapsed; renderAttSection(); }
      }, [
        el('span', { text: '📎 外部附件' }),
        el('span', { text: isAttCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
      ]));

      if (!isAttCollapsed) {
        const attBody = el('div', { class: 'section-body' });
        attSection.appendChild(attBody);
        import('../ui/attachmentModal.js').then(({ attachmentModal, renderAttachmentList }) => {
          const refresh = () => {
            attBody.innerHTML = '';
            attBody.appendChild(renderAttachmentList('point', params.id, refresh));
            attBody.appendChild(el('div', { style: { marginTop: '8px' } }, [
              el('button', { class: 'btn btn-sm btn-ghost', text: '📎 添加附件', onClick: () => attachmentModal('point', params.id, refresh) }),
            ]));
          };
          refresh();
        });
      }
    }
    renderAttSection();
    view.appendChild(attSection);
  }

  // ============ 复习设置（可折叠） ============

  // 声明表单控件
  const diffInput = el('input', {
    type: 'number', min: '1', max: '10', value: String(original?.difficulty || 5),
    disabled: !isUnlocked,
    style: { width: '60px', padding: '4px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' }
  });

  const countInput = el('input', {
    type: 'number', min: '0', value: String(original?.reviewCount || 0),
    disabled: !isUnlocked,
    style: { width: '60px', padding: '4px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' }
  });

  const dateInput = el('input', {
    type: 'date',
    value: original?.nextReviewAt ? original.nextReviewAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
    disabled: !isUnlocked,
    style: { padding: '4px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' }
  });

  // 绑定输入事件
  diffInput.oninput = (e) => { form.difficulty = Number(e.target.value); queueSave(); };
  countInput.oninput = (e) => { form.reviewCount = Number(e.target.value); form.manualReviewCount = true; queueSave(); };
  dateInput.oninput = (e) => { form.nextReviewAt = e.target.value ? new Date(e.target.value).toISOString() : ''; form.manualNextReviewAt = true; queueSave(); };

  // 锁按钮
  const unlockBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    text: isUnlocked ? '🔓 已解锁' : '🔒 已锁定',
    style: { fontSize: '12px', padding: '2px 8px', color: isUnlocked ? 'var(--primary)' : 'inherit' },
    onClick: (e) => {
      e.stopPropagation(); // 阻止触发折叠
      isUnlocked = !isUnlocked;
      unlockBtn.textContent = isUnlocked ? '🔓 已解锁' : '🔒 已锁定';
      unlockBtn.style.color = isUnlocked ? 'var(--primary)' : 'inherit';
      diffInput.disabled = !isUnlocked;
      countInput.disabled = !isUnlocked;
      dateInput.disabled = !isUnlocked;
    }
  });

  // 组装 UI 容器
  const reviewSection = el('div', { class: 'section' });

  function renderReviewSection() {
    reviewSection.innerHTML = '';

    // ================= 头部 =================
    const head = el('div', {
      class: 'section-head',
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isReviewCollapsed ? 'none' : '1px solid rgba(0,0,0,.06)' },
      onClick: () => {
        isReviewCollapsed = !isReviewCollapsed;
        renderReviewSection();
      }
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
        el('span', { text: '📊' }), // 全局魔法会自动替换这个图标
        el('span', { text: '复习设置' }),
        el('span', { text: isReviewCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)', fontSize: '12px' } })
      ]),
      !isReviewCollapsed ? unlockBtn : el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '已收起' })
    ]);
    reviewSection.appendChild(head);

    // ================= 展开内容区 =================
    if (!isReviewCollapsed) {
      const body = el('div', { class: 'section-body', style: { display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '16px' } });

      // 第一排：三个输入框（使用原本的 input，保持事件绑定）
      const row1 = el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, [
        el('div', { class: 'field', style: { flex: '1', minWidth: '100px', margin: 0 } }, [
          el('label', { text: '难记度 (1-10)' }),
          diffInput
        ]),
        el('div', { class: 'field', style: { flex: '1', minWidth: '100px', margin: 0 } }, [
          el('label', { text: '已背遍数' }),
          countInput
        ]),
        el('div', { class: 'field', style: { flex: '1', minWidth: '120px', margin: 0 } }, [
          el('label', { text: '下次复习' }),
          dateInput
        ])
      ]);
      body.appendChild(row1);

      // 第二排：错题原因（下拉框）
      const row2 = el('div', { class: 'field', style: { margin: 0 } }, [
        el('label', { text: '错题原因 (错题本统计用)' }),
        el('select', {
          value: form.errorReason || '',
          disabled: !isUnlocked,
          style: { width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', background: 'var(--bg)' },
          onchange: (e) => { form.errorReason = e.target.value; queueSave(); }
        }, [
          el('option', { value: '', text: '未分类' }),
          el('option', { value: 'blind', text: '🚫 知识盲区' }),
          el('option', { value: 'careful', text: '💦 粗心大意' })
        ])
      ]);
      body.appendChild(row2);

      // 第三排：两个勾选项（合并成一行，更紧凑）
      const row3 = el('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' } }, [
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-2)' } }, [
          el('input', {
            type: 'checkbox',
            'data-key': 'showDiff',
            checked: original?.showDifficultyBeforeExpand || false,
            style: { width: '16px', height: '16px', accentColor: 'var(--primary)' },
            onChange: (e) => {
              if (!isUnlocked) {
                // 如果没解锁，先解锁
                unlockBtn.click();
              }
              // 状态后续由保存时统一读取
            }
          }),
          el('span', { text: '展开前显示难记度' })
        ]),
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-2)' } }, [
          el('input', {
            type: 'checkbox',
            'data-key': 'showCount',
            checked: original?.showReviewCountBeforeExpand || false,
            style: { width: '16px', height: '16px', accentColor: 'var(--primary)' },
            onChange: (e) => {
              if (!isUnlocked) {
                unlockBtn.click();
              }
            }
          }),
          el('span', { text: '展开前显示已背遍数' })
        ])
      ]);
      body.appendChild(row3);

      reviewSection.appendChild(body);
    }
  }

  renderReviewSection();
  view.appendChild(reviewSection);

  // ============ 录音（可折叠） ============
  if (!isNew) {
    const audioSection = el('div', { class: 'section' });
    function renderAudioSection() {
      audioSection.innerHTML = '';
      audioSection.appendChild(el('div', {
        class: 'section-head', style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between' },
        onClick: () => { isAudioCollapsed = !isAudioCollapsed; renderAudioSection(); }
      }, [
        el('span', { text: '🎙 录音' }),
        el('span', { text: isAudioCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
      ]));

      if (!isAudioCollapsed) {
        const audioContainer = el('div', { class: 'section-body' });
        audioSection.appendChild(audioContainer);

        const refreshAudios = () => {
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
              class: 'btn btn-sm btn-primary', text: '🎙 口述背诵', onClick: async () => {
                await audioRecorderModal({ pointId: params.id, name: '口述背诵' });
                refreshAudios();
              }
            }),
          ]));
        };
        refreshAudios();
      }
    }
    renderAudioSection();
    view.appendChild(audioSection);
  }

  view.appendChild(el('div', { class: 'edit-footer' }, [
    status,
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => goBack() }),
    el('button', { class: 'btn btn-primary', text: '保存', onClick: () => doSave() }),
  ]));

  function doSave() {
    if (!form.content.trim()) { setStatus('请填写内容', 'failed'); contentInput.focus(); return; }

    // 直接从 DOM 读取勾选框状态，不依赖 form 缓存
    const diffCheckbox = document.querySelector('input[type="checkbox"][data-key="showDiff"]');
    const countCheckbox = document.querySelector('input[type="checkbox"][data-key="showCount"]');

    const finalShowDiff = diffCheckbox ? diffCheckbox.checked : false;
    const finalShowCount = countCheckbox ? countCheckbox.checked : false;

    if (isNew) {
      store.createPoint({
        chapterId: chapterId,
        content: form.content.trim(),
        explanation: form.explanation.trim(),
        difficulty: form.difficulty,
        showDifficultyBeforeExpand: finalShowDiff,
        showReviewCountBeforeExpand: finalShowCount,
        imageIds: incomingImageId ? [incomingImageId] : []
      });
      toastSuccess('卡片已保存');
    } else {
      store.updatePoint(params.id, {
        chapterId: chapterId,
        content: form.content.trim(),
        explanation: form.explanation.trim(),
        difficulty: form.difficulty,
        isErrorProne: form.isErrorProne,
        reviewCount: form.reviewCount,
        nextReviewAt: form.nextReviewAt,
        manualReviewCount: form.manualReviewCount,
        manualNextReviewAt: form.manualNextReviewAt,
        showDifficultyBeforeExpand: finalShowDiff,
        showReviewCountBeforeExpand: finalShowCount
      });
      toastSuccess('已保存');
    }

    clearDraft('point', entityId);

    // 跳转逻辑
    if (chapterId) {
      const chapter = store.getChapter(chapterId);
      const task = chapter ? store.getTask(chapter.taskId) : null;
      const taskNameParam = task ? `?taskName=${encodeURIComponent(task.name)}` : '';
      navigate(`#/chapter/${chapterId}${taskNameParam}`);
    } else {
      navigate('#/');
    }
  }

  async function goBack() {
    // 👇 核心修复：如果已经处理过草稿弹窗，或者没有任何修改，绝对不准再存草稿！
    if (!isDraftResolved && hasChanges(original, form)) {
      saveDraft('point', entityId, form);
    }

    // 跳转回上一级
    if (chapterId) {
      const chapter = store.getChapter(chapterId);
      const task = chapter ? store.getTask(chapter.taskId) : null;
      const taskNameParam = task ? `?taskName=${encodeURIComponent(task.name)}` : '';
      navigate(`#/chapter/${chapterId}${taskNameParam}`);
    } else {
      navigate('#/');
    }
  }

  // ：将它暴露给全局
  window.__editPointGoBack = goBack;

  // 👇 强行绑定左上角返回按钮
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.onclick = (e) => {
      if (e) e.preventDefault();
      goBack();
    };
    btnBack.style.pointerEvents = 'auto';
    btnBack.style.zIndex = '9999';
  }
}

// ============ 选择已有文件夹弹窗 ============
function openFolderSelectModal(onSelect) {
  const tasks = store.getTasks();

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
    el('h3', { text: '选择归属文件夹' }),
    el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择要归入的文件夹：' }),
  ]);

  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' } });

  if (tasks.length === 0) {
    list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '暂无文件夹，请先新建' }));
  } else {
    // 递归渲染文件夹列表
    const renderFolderList = (parentId, depth) => {
      const currentLevel = tasks.filter(t => (t.parentId || null) === parentId);

      currentLevel.forEach(t => {
        list.appendChild(el('div', {
          style: { padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', marginLeft: (depth * 16) + 'px' },
          onClick: () => {
            const chapters = store.getChapters(t.id);
            if (chapters.length > 0) {
              mask.remove();
              onSelect(chapters[0].id);
            } else {
              const newChap = store.createChapter({ name: '默认', taskId: t.id });
              mask.remove();
              onSelect(newChap.id);
            }
          }
        }, [
          el('span', { text: '📁' }),
          el('span', { text: t.name, style: { fontWeight: '600' } })
        ]));

        // 递归子文件夹
        renderFolderList(t.id, depth + 1);
      });
    };

    renderFolderList(null, 0);
  }

  box.appendChild(list);

  box.appendChild(el('div', { class: 'confirm-actions', style: { justifyContent: 'flex-end' } }, [
    el('button', {
      class: 'btn btn-primary', text: '➕ 新建文件夹',
      onClick: () => {
        const newName = prompt('新建文件夹名称：', '未命名文件夹');
        if (!newName || !newName.trim()) return;

        // 建文件夹并自动生成子模块
        const newTask = store.createTask({ name: newName.trim() });

        // 👇 核心修改：把 '默认子模块' 改成 '📁'，这样界面上就像是一个图标，不再显示文字
        const newChap = store.createChapter({ name: '📁', taskId: newTask.id });

        mask.remove();
        onSelect(newChap.id);
        toastSuccess(`已新建并归入「${newName}」`);
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
  ]));

  mask.appendChild(box);
  document.body.appendChild(mask);
}

