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
  let savedRange = null;
  let isPanelOpen = false;
  if (window.__editPointAbort) {
    window.__editPointAbort.abort();
  }
  window.__editPointAbort = new AbortController();
  const docSignal = window.__editPointAbort.signal;
  //清理上一次编辑页挂到 body 的面板，防止叠面板
  document.querySelectorAll('.edit-point-panel').forEach(p => p.remove());
  // 只要进入编辑页，强行把画板残留的组件干掉
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
  let isReviewCollapsed = true; // 复习设置也默认收起
  let isUnlocked = isNew;      // 编辑时锁定，新建时解锁
  let showDifficultyBeforeExpand = original?.showDifficultyBeforeExpand || false;
  let isDraftResolved = false; // 是否已经处理过草稿弹窗

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

  // 搜索高亮与自动定位功能
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

  // ============ 多源图片/OCR 导入逻辑 ============
  // 1. 通用处理函数：将图片入库、自动 OCR、插入目标框
  async function handleImageImport(file, targetInput, isExplanation) {
    if (isNew || !params || !params.id || params.id === 'new') {
      toastError('请先保存卡片，再添加图片');
      return;
    }

    toastSuccess('正在保存图片...');

    const pt = store.getPoint(params.id);
    if (!pt) return;
    if (!pt.imageIds) pt.imageIds = [];

    // 生成防重名文件名
    let baseName = file.name ? file.name.split('.')[0] : '截图_' + new Date().getTime();
    let ext = file.name && file.name.includes('.') ? '.' + file.name.split('.').pop() : '.png';
    let finalName = baseName + ext;
    let counter = 1;
    const existingRecs = await Promise.all(pt.imageIds.map(id => dbGet('images', id)));
    const usedNames = new Set(existingRecs.map(r => r && r.name).filter(Boolean));
    while (usedNames.has(finalName)) {
      finalName = `${baseName} (${counter})${ext}`;
      counter++;
    }

    // 获取图片尺寸
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise(r => { img.onload = r; img.src = url; });

    // 存入 IndexedDB
    const id = uuid();
    await dbPut('images', {
      id,
      name: finalName,
      originalBlob: file,
      annotatedBlob: file,
      width: img.width,
      height: img.height,
      dpr: 1,
      source: 'upload',
      createdAt: new Date().toISOString()
    });

    // 更新知识点，将 ID 加入关联数组
    pt.imageIds.push(id);
    store.updatePoint(pt.id, { imageIds: pt.imageIds });
    URL.revokeObjectURL(url);

    //自动调用你的 runOCR 识别
    toastSuccess('图片已保存，正在识别文字...');
    let text = '';
    try {
      const ocrModule = await import('./ocr.js');
      if (typeof ocrModule.runOCR === 'function') {
        const res = await ocrModule.runOCR(id);
        if (res && res.text) {
          text = res.text;
        }
      } else {
        console.warn('ocr.js 中没有找到 runOCR 函数');
      }
    } catch (err) {
      console.warn('OCR 模块加载失败:', err);
    }

    //将文字和图片插入到编辑框
    targetInput.focus();
    if (isExplanation) restoreExplainRange();

    if (text && text.trim()) {
      if (targetInput.isContentEditable) {
        document.execCommand('insertText', false, '\n' + text.trim());
      } else {
        targetInput.value += (targetInput.value ? '\n' : '') + text.trim();
      }
    }

    // 在“图文附件”区域插入图片（如果是富文本框）
    if (isExplanation) {
      // 为了让图片在解释框立即可见，转为 Base64 塞进去
      const reader = new FileReader();
      const base64 = await new Promise(resolve => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      document.execCommand('insertHTML', false, `<img src="${base64}" style="max-width:100%; border-radius:8px; margin:8px 0; display:block;" data-img-id="${id}" />`);

      form.explanation = explainInput.innerHTML;
      saveExplainRange();
    } else {
      form.content = targetInput.value || targetInput.innerHTML;
    }

    queueSave();
    toastSuccess(text ? '识别成功，文字已插入！' : '图片已导入（未识别到文字）');

    //强制刷新下方的“图文附件”区域
    if (typeof renderImgSection === 'function') {
      isImgCollapsed = false; // 自动展开附件区
      renderImgSection();
    }
  }

  // 2. 底部动作面板 (统一调用 handleImageImport)
  function showImageSourceSheet(targetInput, isExplanation = false) {
    const oldSheet = document.getElementById('import-source-sheet');
    if (oldSheet) oldSheet.remove();

    const sheet = el('div', {
      id: 'import-source-sheet',
      style: {
        position: 'fixed', bottom: '0', left: '0', right: '0', top: '0',
        background: 'rgba(0,0,0,0.4)', zIndex: '999999', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'
      },
      onClick: (e) => { if (e.target === sheet) sheet.remove(); }
    }, [
      el('div', {
        style: {
          background: 'var(--card)', borderTopLeftRadius: '16px', borderTopRightRadius: '16px',
          padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))'
        }
      }, [
        el('div', { style: { textAlign: 'center', color: 'var(--text-2)', marginBottom: '4px', fontSize: '13px', fontWeight: 'bold' } }, '选择图片来源'),

        // 拍照
        el('button', {
          class: 'btn btn-ghost', style: { padding: '12px', fontSize: '15px', background: 'var(--bg)' }, onClick: () => {
            sheet.remove();
            const fileInput = document.createElement('input');
            fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.capture = 'environment';
            fileInput.onchange = (e) => { const f = e.target.files[0]; if (f) handleImageImport(f, targetInput, isExplanation); };
            fileInput.click();
          }
        }, '📷 拍照识别文字'),

        // 本地图片
        el('button', {
          class: 'btn btn-ghost', style: { padding: '12px', fontSize: '15px', background: 'var(--bg)' }, onClick: () => {
            sheet.remove();
            const fileInput = document.createElement('input');
            fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true;
            fileInput.onchange = async (e) => {
              const files = Array.from(e.target.files);
              for (const f of files) {
                await handleImageImport(f, targetInput, isExplanation);
              }
            };
            fileInput.click();
          }
        }, '🖼️ 导入本地图片'),

        // PDF 选页
        el('button', {
          class: 'btn btn-ghost', style: { padding: '12px', fontSize: '15px', background: 'var(--bg)' }, onClick: async () => {
            sheet.remove();
            if (isNew || !params || !params.id || params.id === 'new') {
              toastError('请先点击保存按钮，保存卡片后再添加 PDF');
              return;
            }

            try {
              const module = await import('./pdfImport.js');
              const pdfImportModal = module.pdfImportModal;

              const oldPoint = store.getPoint(params.id);
              const oldImageIds = oldPoint && oldPoint.imageIds ? [...oldPoint.imageIds] : [];

              await pdfImportModal(params.id);

              // 刷新界面
              if (typeof renderImgSection === 'function') {
                isImgCollapsed = false;
                renderImgSection();
              }

              // 自动 OCR 提取
              const newPoint = store.getPoint(params.id);
              if (newPoint && newPoint.imageIds) {
                const newImageIds = newPoint.imageIds.filter(id => !oldImageIds.includes(id));
                if (newImageIds.length > 0) {
                  toastSuccess(`成功导入 ${newImageIds.length} 页，正在识别文字...`);
                  const ocrModule = await import('./ocr.js');

                  let allText = '';
                  for (const imgId of newImageIds) {
                    try {
                      //直接传入 imgId 调用你原本的 runOCR
                      const res = await ocrModule.runOCR(imgId);
                      if (res && res.text && res.text.trim()) {
                        allText += res.text.trim() + '\n\n';
                      }
                    } catch (e) {
                      console.warn('单页识别失败:', e);
                    }
                  }

                  if (allText.trim()) {
                    targetInput.focus();
                    if (isExplanation) restoreExplainRange();
                    if (targetInput.isContentEditable) {
                      document.execCommand('insertText', false, '\n' + allText.trim());
                      if (isExplanation) { form.explanation = explainInput.innerHTML; saveExplainRange(); }
                      else { form.content = targetInput.innerHTML; }
                    } else {
                      targetInput.value += (targetInput.value ? '\n' : '') + allText.trim();
                      form.content = targetInput.value;
                    }
                    queueSave();
                    toastSuccess('文字已提取并插入');
                  } else {
                    toastError('未从导入的页面中识别到文字');
                  }
                }
              }
            } catch (err) {
              console.error('PDF 导入失败:', err);
              toastError('加载失败：' + err.message);
            }
          }
        }, '📄 从 PDF 选页'),

        el('button', { class: 'btn btn-ghost', style: { padding: '12px', fontSize: '15px', marginTop: '8px', color: 'var(--text-2)' }, onClick: () => sheet.remove() }, '取消')
      ])
    ]);
    document.body.appendChild(sheet);
  }

  // 3. 实例化按钮
  const ocrBtn = el('button', {
    class: 'btn btn-ghost', title: '导入图片/识别',
    style: { padding: '8px', fontSize: '18px', borderRadius: '10px', background: 'rgba(142,202,230,.15)', height: '44px', flexShrink: '0' },
    text: '📷',
    onClick: () => showImageSourceSheet(contentInput, false) // 绑定内容框
  });

  const contentRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, [
    contentInput,
    isMobile ? null : attachSpeechButton(contentInput),
    ocrBtn,
  ]);

  // 使用 div 开启富文本编辑模式，并拦截回车键
  const explainInput = el('div', {
    contenteditable: 'true',
    placeholder: '文字解释（可选）',
    class: 'rich-text-editor',
    style: {
      width: '100%', minHeight: '100px', padding: '12px', border: '1px solid rgba(0,0,0,.1)',
      borderRadius: '10px',
      background: 'transparent',
      outline: 'none', overflowY: 'auto',
      whiteSpace: 'pre-wrap', fontSize: '15px', lineHeight: '1.6',
      userSelect: 'text', // 确保能选中文字
      pointerEvents: 'auto' // 确保能点击
    },

    //加上 onInput，让打字实时同步到表单数据
    onInput: (e) => {
      form.explanation = e.target.innerHTML;
      queueSave(); // 触发草稿自动保存
    },

    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertLineBreak', false, null);
        form.explanation = explainInput.innerHTML;
        saveExplainRange();
        queueSave();
      }
    },
    onPaste: (e) => {
      e.preventDefault();
      const text = (e.originalEvent || e).clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
      form.explanation = explainInput.innerHTML; // 粘贴后也同步一下
      queueSave();
    },
    onBlur: () => {
      // 失焦时再兜底同步一次
      form.explanation = explainInput.innerHTML;
    }
  });
  explainInput.innerHTML = form.explanation;

  // ==================== 公式双击编辑拦截 ====================
  explainInput.addEventListener('dblclick', (e) => {
    const mathNode = e.target.closest('.math-node');
    if (mathNode) {
      e.preventDefault();
      const latex = mathNode.getAttribute('data-latex');
      // 把渲染好的公式壳子替换回纯文本代码
      const textNode = document.createTextNode(` $${latex}$ `);
      mathNode.parentNode.replaceChild(textNode, mathNode);

      // 触发保存机制
      explainInput.dispatchEvent(new Event('input', { bubbles: true }));
      form.explanation = explainInput.innerHTML;
      queueSave();

      // 将光标移动到公式代码后面
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = document.createRange();
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });

  // ==================== 选区保护（解决改字号光标跳到开头 / 整段变） ====================

  function saveExplainRange() {
    if (isPanelOpen) return;   //面板打开期间不覆盖 savedRange
    const sel = window.getSelection();
    if (sel.rangeCount && explainInput.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreExplainRange() {
    if (!savedRange) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  }

  // 用 selectionchange 代替 keyup/mouseup，选区变化都能捕获
  document.addEventListener('selectionchange', saveExplainRange, { signal: docSignal });

  // 统一的“取当前有效选区”函数
  function getExplainRange() {
    const sel = window.getSelection();
    if (sel.rangeCount && explainInput.contains(sel.anchorNode)) {
      return sel.getRangeAt(0);
    }
    if (savedRange && explainInput.contains(savedRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return savedRange;
    }
    return null;
  }

  //拦截编辑器里的链接点击和长按
  // ==================== 编辑器内的链接长按拦截 ====================
  explainInput.addEventListener('pointerdown', (e) => {
    const linkEl = e.target.closest('.editor-link');
    if (!linkEl) return;

    // 阻止输入框的默认选择行为
    e.preventDefault();

    const placeholder = linkEl.getAttribute('data-link');
    const idMatch = placeholder.match(/:([a-zA-Z0-9-]+):/);
    const id = idMatch ? idMatch[1] : null;
    const route = placeholder.includes('folder') ? `#/chapter/${id}` : `#/edit-point/${id}`;

    const startX = e.clientX;
    const startY = e.clientY;

    const timer = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);

      // 清理可能存在的旧菜单
      const oldMenu = document.getElementById('global-link-menu');
      if (oldMenu) oldMenu.remove();

      const rect = linkEl.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.id = 'global-link-menu';
      // 菜单定位与样式
      menu.style.cssText = `
        position: fixed; top: ${rect.bottom + 8}px; left: ${Math.max(10, rect.left)}px;
        background: var(--card); border: 1px solid rgba(0,0,0,.1); box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        border-radius: 8px; padding: 4px; display: flex; flex-direction: column; z-index: 999999;
      `;

      const createBtn = (text, color, onClick) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-ghost';
        btn.textContent = text;
        btn.style.cssText = `justify-content: flex-start; color: ${color}; font-size: 13px; padding: 8px 16px; cursor: pointer;`;

        //mousedown 和 touchstart 全部拦截
        const handleAction = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onClick();
        };
        btn.onmousedown = handleAction;
        btn.ontouchstart = handleAction;

        return btn;
      };

      // 前往按钮的点击逻辑
      menu.appendChild(createBtn('🚀 前往', 'var(--primary)', () => {
        menu.remove();
        if (window.location.hash === route) {
          toastSuccess('你目前就在这个页面中');
          if (window.flashLink) {
            window.flashLink(id, true);
            setTimeout(() => window.flashLink(id, false), 1500);
          }
          return;
        }
        window.location.hash = route;
      }));

      // 2. 重置（带确认）
      menu.appendChild(createBtn('🔄 重置', '#B8860B', () => {
        if (confirm('确定要重置这个链接吗？\n它将变回 [[代码]] 格式，方便你重新编辑。')) {
          const textNode = document.createTextNode(placeholder);
          linkEl.parentNode.replaceChild(textNode, linkEl);
          explainInput.dispatchEvent(new Event('input', { bubbles: true }));
          toastSuccess('已重置为纯文本代码');
        }
      }));

      // 3. 删除（彻底拔掉链接外套，变成纯黑字）
      menu.appendChild(createBtn('🗑 删除', 'var(--danger)', () => {
        if (confirm('确定要删除这个链接吗？\n（文字会保留，变成普通文本）')) {
          //创建一个最干净的文字节点，把带颜色的外壳彻底替换掉
          const textNode = document.createTextNode(linkEl.textContent);
          linkEl.parentNode.replaceChild(textNode, linkEl);

          // 触发保存，让系统记住这个字已经不是链接了
          explainInput.dispatchEvent(new Event('input', { bubbles: true }));
          toastSuccess('已彻底删除链接');
        }
      }));

      // 4. 取消
      menu.appendChild(createBtn('✖ 取消', 'var(--text-2)', () => { }));

      document.body.appendChild(menu);

      // 点击空白处关闭菜单
      setTimeout(() => {
        document.addEventListener('pointerdown', (ev) => {
          if (!menu.contains(ev.target)) menu.remove();
        }, { once: true });
      }, 10);

    }, 500);

    // 如果手指移动或提前松开，取消长按
    const cancel = () => clearTimeout(timer);
    linkEl.addEventListener('pointerup', cancel, { once: true });
    linkEl.addEventListener('pointermove', (ev) => {
      if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) cancel();
    }, { once: true });
    linkEl.addEventListener('pointerleave', cancel, { once: true });
  });

  //让编辑器里的链接支持单击直接前往（如果你需要的话）
  explainInput.addEventListener('dblclick', (e) => {
    const linkEl = e.target.closest('.editor-link');
    if (linkEl) {
      const placeholder = linkEl.getAttribute('data-link');
      const idMatch = placeholder.match(/:([a-zA-Z0-9-]+):/);
      const id = idMatch ? idMatch[1] : null;
      const route = placeholder.includes('folder') ? `#/chapter/${id}` : `#/edit-point/${id}`;
      window.location.hash = route;
    }
  });

  // ==================== 文字格式工具栏（重写精简版） ====================
  const toolbarWrapper = el('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: '100%',
      marginBottom: '8px', background: 'var(--bg)', padding: '8px',
      borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)',
      boxSizing: 'border-box', position: 'relative'
    }
  });

  const toolbarHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '4px' } });
  const toolbarInner = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', flex: '1' } });

  let isToolbarExpanded = true;

  // ================== 先创建排在最前面的 4 个新按钮 ==================

  const copyBtn = el('button', {
    class: 'btn btn-sm btn-ghost', text: '📋',
    style: { padding: '0 6px', fontSize: '14px', color: 'var(--text-2)', flexShrink: '0' },
    title: '复制',
    onMousedown: (e) => e.preventDefault(),
    onClick: () => {
      // 1. 创建选择弹窗
      const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
      const box = el('div', { class: 'confirm-box', style: { maxWidth: '340px', width: '90%', padding: '20px', textAlign: 'center' } }, [
        el('h3', { text: '选择复制格式', style: { marginBottom: '16px', fontSize: '16px' } }),
        el('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center' } }, [
          //纯文本复制
          el('button', {
            class: 'btn btn-ghost', text: '纯文本',
            style: { flex: '1', padding: '12px' },
            onClick: () => {
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = explainInput.innerHTML;
              const plainText = tempDiv.textContent || tempDiv.innerText || '';
              navigator.clipboard.writeText(plainText)
                .then(() => toastSuccess('纯文本已复制'))
                .catch(() => toastError('复制失败'));
              mask.remove();
            }
          }),
          //带格式复制
          el('button', {
            class: 'btn btn-primary', text: '带格式文本',
            style: { flex: '1', padding: '12px' },
            onClick: () => {
              try {
                // 创建一个临时隐藏的 div，放入要复制的 HTML
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = explainInput.innerHTML;
                tempDiv.style.position = 'fixed';
                tempDiv.style.left = '-9999px';
                document.body.appendChild(tempDiv);

                // 选中这个 div 的内容
                const range = document.createRange();
                range.selectNodeContents(tempDiv);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);

                // 执行复制命令
                const success = document.execCommand('copy');

                // 清理现场
                sel.removeAllRanges();
                document.body.removeChild(tempDiv);

                if (success) {
                  toastSuccess('带格式文本已复制');
                } else {
                  toastError('复制失败，浏览器可能不支持');
                }
              } catch (err) {
                toastError('复制失败');
                console.error(err);
              }
              mask.remove();
            }
          })
        ]),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '取消',
          style: { marginTop: '16px', width: '100%' },
          onClick: () => mask.remove()
        })
      ]);
      mask.appendChild(box);
      document.body.appendChild(mask);
    }
  });

  // ② 引用块（支持列表管理与批量取消）
  const quoteBtn = el('button', {
    class: 'btn btn-sm btn-ghost', text: '❝',
    style: { padding: '0 6px', fontSize: '16px', color: 'var(--text-2)', flexShrink: '0' },
    title: '引用块',
    onMousedown: (e) => e.preventDefault(),
    onClick: () => {
      // 如果面板已存在，再次点击收回
      const existingPanel = document.getElementById('quote-panel');
      if (existingPanel) {
        existingPanel.remove();
        return;
      }
      if (typeof closePanels === 'function') closePanels();

      // 备份选区
      const sel = window.getSelection();
      let savedQuoteRange = null;
      if (sel.rangeCount > 0 && !sel.isCollapsed) {
        savedQuoteRange = sel.getRangeAt(0).cloneRange();
      }

      // 创建面板
      const quotePanel = el('div', {
        id: 'quote-panel',
        class: 'edit-point-panel',
        style: {
          display: 'flex', position: 'fixed', zIndex: '99999',
          background: 'var(--card)', padding: '12px', borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)', flexDirection: 'column',
          width: '240px', gap: '10px', border: '1px solid rgba(0,0,0,.08)'
        }
      });
      document.body.appendChild(quotePanel);

      // 定位
      const rect = quoteBtn.getBoundingClientRect();
      quotePanel.style.top = (rect.bottom + 8) + 'px';
      let left = rect.left;
      if (left + 240 > window.innerWidth) left = window.innerWidth - 250;
      quotePanel.style.left = left + 'px';

      // 点击外部关闭
      setTimeout(() => {
        document.addEventListener('pointerdown', function closeQuotePanel(ev) {
          if (!quotePanel.contains(ev.target) && ev.target !== quoteBtn && !quoteBtn.contains(ev.target)) {
            quotePanel.remove();
            document.removeEventListener('pointerdown', closeQuotePanel);
          }
        });
      }, 10);

      // ================= 1. 引用样式选择 =================
      if (savedQuoteRange) {
        quotePanel.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', fontWeight: 'bold' }, text: '添加引用样式' }));

        quotePanel.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '2px' } }, [
          el('button', {
            class: 'btn btn-sm btn-primary', text: '添加为引用块',
            style: { flex: '1', fontSize: '12px', padding: '0', height: '28px', minHeight: 'auto' },
            onClick: () => {
              const range = savedQuoteRange.cloneRange();
              const blockquote = document.createElement('blockquote');
              blockquote.style.cssText = 'border-left: 4px solid #ccc; margin: 8px 0; padding: 4px 12px; color: #666; background: rgba(0,0,0,0.03); border-radius: 0 4px 4px 0; font-size: 14px; display: block;';
              blockquote.appendChild(range.extractContents());
              range.insertNode(blockquote);

              explainInput.dispatchEvent(new Event('input', { bubbles: true }));
              form.explanation = explainInput.innerHTML;
              queueSave();

              quotePanel.remove();
            }
          })
        ]));
      } else {
        quotePanel.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', textAlign: 'center', padding: '4px 0' }, text: '请先选中文字' }));
      }

      // ================= 2. 引用列表管理 =================
      quotePanel.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.08)', marginTop: '4px', paddingTop: '6px' } }));
      const listWrap = el('div');
      quotePanel.appendChild(listWrap);

      let isListExpanded = false;
      const selectedQuotes = new Set();

      function renderQuoteList() {
        listWrap.innerHTML = '';
        const blocks = Array.from(explainInput.querySelectorAll('blockquote'));

        // 渲染展收头部
        const header = el('div', {
          style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', color: 'var(--text-2)' }
        }, [
          el('span', { text: `当前引用 (${blocks.length})` }),
          el('span', { text: isListExpanded ? '▾' : '▸' })
        ]);
        header.onclick = (e) => { e.stopPropagation(); isListExpanded = !isListExpanded; renderQuoteList(); };
        listWrap.appendChild(header);

        if (!isListExpanded) return;

        if (blocks.length === 0) {
          listWrap.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-3)', padding: '2px 0' }, text: '当前暂无引用块' }));
          return;
        }

        //管理工具条（全选/全不选/删除）
        listWrap.appendChild(el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); blocks.forEach(b => selectedQuotes.add(b)); renderQuoteList(); }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); selectedQuotes.clear(); renderQuoteList(); }
          }),
          el('button', {
            class: 'btn btn-sm btn-danger', text: `删除(${selectedQuotes.size})`,
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto' },
            onClick: (e) => {
              e.stopPropagation();
              if (selectedQuotes.size === 0) return;

              // 注意：删除引用块时，要把里面的文字“救”出来，变成普通文本，而不是直接删掉文字
              selectedQuotes.forEach(quoteEl => {
                if (quoteEl.parentNode) {
                  const frag = document.createDocumentFragment();
                  while (quoteEl.firstChild) {
                    frag.appendChild(quoteEl.firstChild);
                  }
                  quoteEl.parentNode.replaceChild(frag, quoteEl);
                }
              });
              selectedQuotes.clear();
              explainInput.dispatchEvent(new Event('input', { bubbles: true }));
              form.explanation = explainInput.innerHTML;
              queueSave();
              toastSuccess('已取消选中引用');
              renderQuoteList();
            }
          })
        ]));

        // 列表项（带勾选框）
        const listBox = el('div', { style: { maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' } });
        blocks.forEach((b) => {
          const isSelected = selectedQuotes.has(b);
          listBox.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px', borderRadius: '4px', background: isSelected ? 'rgba(142,202,230,0.2)' : 'transparent', cursor: 'pointer' },
            onClick: (e) => {
              e.stopPropagation();
              if (isSelected) selectedQuotes.delete(b); else selectedQuotes.add(b);
              renderQuoteList();
            }
          }, [
            el('input', { type: 'checkbox', checked: isSelected, style: { pointerEvents: 'none' } }),
            el('div', { style: { width: '4px', height: '12px', background: '#ccc', borderRadius: '2px' } }), // 用一个小竖条代表引用
            el('span', { text: b.textContent.substring(0, 15) || '(空)', style: { fontSize: '12px', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } })
          ]));
        });
        listWrap.appendChild(listBox);
      }

      renderQuoteList();
    }
  });

  // ③ 挖空遮挡（紧凑版 + 折叠颜色管理 + 遮挡列表）
  const maskBtn = el('button', {
    class: 'btn btn-sm btn-ghost', text: '⬛',
    style: { padding: '0 6px', fontSize: '14px', color: 'var(--text-2)', flexShrink: '0' },
    title: '挖空/遮挡',
    onMousedown: (e) => e.preventDefault(),
    onClick: () => {
      const sel = window.getSelection();

      // 备份选区
      let savedMaskRange = null;
      if (sel.rangeCount > 0 && !sel.isCollapsed) {
        savedMaskRange = sel.getRangeAt(0).cloneRange();
      }

      // 再次点击收回
      const existingPanel = document.getElementById('mask-panel');
      if (existingPanel) {
        existingPanel.remove();
        return;
      }
      if (typeof closePanels === 'function') closePanels();

      // 创建面板
      const maskPanel = el('div', {
        id: 'mask-panel',
        class: 'edit-point-panel',
        style: {
          display: 'flex', position: 'fixed', zIndex: '99999',
          background: 'var(--card)', padding: '12px', borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)', flexDirection: 'column',
          width: '220px', gap: '10px', border: '1px solid rgba(0,0,0,.08)'
        }
      });
      document.body.appendChild(maskPanel);

      // 定位
      const rect = maskBtn.getBoundingClientRect();
      maskPanel.style.top = (rect.bottom + 8) + 'px';
      let left = rect.left;
      if (left + 220 > window.innerWidth) left = window.innerWidth - 230;
      maskPanel.style.left = left + 'px';

      // 点击外部关闭
      setTimeout(() => {
        document.addEventListener('pointerdown', function closeMaskPanel(ev) {
          if (!maskPanel.contains(ev.target) && ev.target !== maskBtn && !maskBtn.contains(ev.target)) {
            maskPanel.remove();
            document.removeEventListener('pointerdown', closeMaskPanel);
          }
        });
      }, 10);

      // ================= 1. 颜色选择区 =================
      if (savedMaskRange) {
        maskPanel.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', fontWeight: 'bold' }, text: '遮挡颜色' }));

        const colors = ['#2B2D42', '#EF476F', '#FFD166', '#06D6A0', '#118AB2', '#9D4EDD', '#F4F4F5', 'transparent'];
        //压缩色块大小（repeat(8, 1fr)，尺寸约 18x18）
        const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '3px' } });

        colors.forEach(c => {
          grid.appendChild(el('div', {
            style: {
              width: '100%', aspectRatio: '1',
              background: c === 'transparent' ? 'repeating-linear-gradient(45deg, #eee, #eee 2px, #fff 2px, #fff 4px)' : c,
              borderRadius: '3px', border: '1px solid rgba(0,0,0,.1)', cursor: 'pointer'
            },
            onClick: () => { applyMask(c); maskPanel.remove(); }
          }));
        });
        maskPanel.appendChild(grid);

        // 自定义与收藏（按钮样式对齐图示）
        maskPanel.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '2px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '🎨 自定义',
            style: { flex: '1', fontSize: '11px', padding: '0', height: '24px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: () => {
              const picker = document.createElement('input');
              picker.type = 'color'; picker.value = '#2B2D42';
              picker.style.cssText = 'position:fixed; top:10px; left:10px; opacity:0;';
              picker.onchange = (e) => { applyMask(e.target.value); maskPanel.remove(); picker.remove(); };
              document.body.appendChild(picker); picker.click();
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '⭐ 收藏色',
            style: { flex: '1', fontSize: '11px', padding: '0', height: '24px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: () => {
              const c = prompt('输入颜色 HEX（如 #FF0000）', '#2B2D42');
              if (c) { applyMask(c); addFavoriteColor(c, 1); maskPanel.remove(); }
            }
          })
        ]));
      } else {
        maskPanel.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', textAlign: 'center', padding: '4px 0' }, text: '请先选中文字' }));
      }

      // ================= 2. 折叠的收藏颜色管理 =================
      const favWrap = el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.08)', paddingTop: '6px' } });
      let favExpanded = false;
      let favManageMode = false;
      const favSelected = new Set();
      const favHeader = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', color: 'var(--text-2)' }
      });
      const favBody = el('div');
      favWrap.appendChild(favHeader);
      favWrap.appendChild(favBody);
      maskPanel.appendChild(favWrap);

      function renderFav() {
        const customList = getFavoriteColors();
        favHeader.innerHTML = '';
        favHeader.appendChild(el('span', { text: `颜色管理 (${customList.length})` }));
        favHeader.appendChild(el('span', { text: favExpanded ? '▾' : '▸' }));
        favHeader.onclick = (e) => { e.stopPropagation(); favExpanded = !favExpanded; renderFav(); };

        if (!favExpanded) { favBody.innerHTML = ''; return; }
        favBody.innerHTML = '';

        const toolbar = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } });
        toolbar.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: favManageMode ? '完成' : '管理',
          style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
          onClick: (e) => { e.stopPropagation(); favManageMode = !favManageMode; favSelected.clear(); renderFav(); }
        }));
        if (favManageMode) {
          toolbar.appendChild(el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); customList.forEach(c => favSelected.add(c.id)); renderFav(); }
          }));
          toolbar.appendChild(el('button', {
            class: 'btn btn-sm btn-danger', text: `删除(${favSelected.size})`,
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto' },
            onClick: (e) => {
              e.stopPropagation(); if (favSelected.size === 0) return;
              removeFavoriteColors([...favSelected]); favSelected.clear(); renderFav(); toastSuccess('已删除');
            }
          }));
        }
        favBody.appendChild(toolbar);

        if (customList.length === 0) {
          favBody.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-3)', padding: '2px 0' }, text: '暂无收藏' }));
          return;
        }

        //压缩收藏色块
        const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '3px' } });
        customList.forEach(c => {
          const isSel = favSelected.has(c.id);
          const swatch = el('div', {
            style: {
              width: '100%', aspectRatio: '1', borderRadius: '3px', cursor: 'pointer',
              background: c.hex, opacity: c.alpha, position: 'relative',
              border: isSel ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.1)', boxSizing: 'border-box'
            },
            onClick: (e) => {
              e.stopPropagation();
              if (favManageMode) {
                if (favSelected.has(c.id)) favSelected.delete(c.id); else favSelected.add(c.id);
                renderFav();
              } else {
                applyMask(c.hex); maskPanel.remove();
              }
            }
          });
          if (isSel) swatch.appendChild(el('span', { text: '✓', style: { position: 'absolute', top: '-4px', right: '-4px', background: 'var(--primary)', color: '#fff', borderRadius: '50%', width: '10px', height: '10px', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' } }));
          grid.appendChild(swatch);
        });
        favBody.appendChild(grid);
      }
      renderFav();

      // ================= 3. 当前遮挡列表管理 =================
      maskPanel.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.08)', marginTop: '4px', paddingTop: '6px' } }));
      const listWrap = el('div');
      maskPanel.appendChild(listWrap);

      // ... 这里是你原本的 applyMask 函数 ...
      function applyMask(color) {
        if (!savedMaskRange) return toastError('选区已丢失，请重新选中文字');
        const range = savedMaskRange.cloneRange();
        const frag = range.extractContents();

        frag.querySelectorAll('.mask-block').forEach(el => {
          const text = document.createTextNode(el.textContent);
          el.parentNode.replaceChild(text, el);
        });
        range.insertNode(frag);

        const span = document.createElement('span');
        span.className = 'mask-block';
        span.style.cssText = `background: ${color === 'transparent' ? 'rgba(255,209,102,0.3)' : color}; color: transparent; cursor: pointer; border-radius: 3px; padding: 0 4px; transition: all 0.2s; user-select: none;`;
        span.dataset.originalColor = color;
        span.appendChild(range.extractContents());

        span.onclick = function () {
          if (this.style.color === 'transparent') {
            this.style.color = 'inherit';
            this.style.background = 'rgba(255, 209, 102, 0.3)';
          } else {
            this.style.color = 'transparent';
            this.style.background = this.dataset.originalColor === 'transparent' ? 'rgba(255,209,102,0.3)' : this.dataset.originalColor;
          }
        };

        range.insertNode(span);
        explainInput.dispatchEvent(new Event('input', { bubbles: true }));
        form.explanation = explainInput.innerHTML;
        queueSave();
      }

      //即使没有遮挡，也渲染列表头部
      let isListExpanded = false;
      const selectedMasks = new Set();

      function renderMaskList() {
        listWrap.innerHTML = '';
        const blocks = Array.from(explainInput.querySelectorAll('.mask-block'));

        // 无论 blocks 有多少个，都渲染头部展收
        const header = el('div', {
          style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', color: 'var(--text-2)' }
        }, [
          el('span', { text: `当前遮挡 (${blocks.length})` }),
          el('span', { text: isListExpanded ? '▾' : '▸' })
        ]);
        header.onclick = (e) => { e.stopPropagation(); isListExpanded = !isListExpanded; renderMaskList(); };
        listWrap.appendChild(header);

        if (!isListExpanded) return;

        if (blocks.length === 0) {
          listWrap.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-3)', padding: '2px 0' }, text: '当前暂无遮挡块' }));
          return;
        }

        // 工具条
        listWrap.appendChild(el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); blocks.forEach(b => selectedMasks.add(b)); renderMaskList(); }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); selectedMasks.clear(); renderMaskList(); }
          }),
          el('button', {
            class: 'btn btn-sm btn-danger', text: `删除(${selectedMasks.size})`,
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto' },
            onClick: (e) => {
              e.stopPropagation();
              if (selectedMasks.size === 0) return;
              selectedMasks.forEach(maskEl => {
                if (maskEl.parentNode) {
                  const text = document.createTextNode(maskEl.textContent);
                  maskEl.parentNode.replaceChild(text, maskEl);
                }
              });
              selectedMasks.clear();
              explainInput.dispatchEvent(new Event('input', { bubbles: true }));
              toastSuccess('已删除选中遮挡');
              renderMaskList();
            }
          })
        ]));

        // 遮挡列表项
        const listBox = el('div', { style: { maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' } });
        blocks.forEach((b) => {
          const isSelected = selectedMasks.has(b);
          listBox.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px', borderRadius: '4px', background: isSelected ? 'rgba(142,202,230,0.2)' : 'transparent', cursor: 'pointer' },
            onClick: (e) => {
              e.stopPropagation();
              if (isSelected) selectedMasks.delete(b); else selectedMasks.add(b);
              renderMaskList();
            }
          }, [
            el('input', { type: 'checkbox', checked: isSelected, style: { pointerEvents: 'none' } }),
            el('div', { style: { width: '12px', height: '12px', borderRadius: '3px', background: b.dataset.originalColor === 'transparent' ? 'rgba(255,209,102,0.3)' : (b.dataset.originalColor || '#2B2D42') } }),
            el('span', { text: b.textContent.substring(0, 15) || '(空)', style: { fontSize: '12px', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } })
          ]));
        });
        listWrap.appendChild(listBox);
      }

      renderMaskList();
    }
  });

  // ④ 数学公式（超全理工科公式、自定义、已使用、收藏管理）
  const formulaBtn = el('button', {
    class: 'btn btn-sm btn-ghost', text: '∑',
    style: { padding: '0 6px', fontSize: '16px', color: 'var(--primary)', flexShrink: '0' },
    title: '插入数学公式',
    onMousedown: (e) => e.preventDefault(),
    onClick: () => {
      const existingPanel = document.getElementById('formula-panel');
      if (existingPanel) { existingPanel.remove(); return; }
      if (typeof closePanels === 'function') closePanels();

      const sel = window.getSelection();
      let savedFormulaRange = null;
      if (sel.rangeCount > 0 && !sel.isCollapsed) {
        savedFormulaRange = sel.getRangeAt(0).cloneRange();
      }

      //自适应屏幕高度，智能向上/向下弹出
      const formulaPanel = el('div', {
        id: 'formula-panel',
        class: 'edit-point-panel',
        style: {
          display: 'flex', position: 'fixed', zIndex: '99999',
          background: 'var(--card)', padding: '12px', borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)', flexDirection: 'column',
          width: '340px', gap: '10px', border: '1px solid rgba(0,0,0,.08)',
          overflowY: 'auto', //内部滚动
          overscrollBehavior: 'contain' //防止滚动穿透到背后的网页
        }
      });
      document.body.appendChild(formulaPanel);

      // 定位与高度动态计算
      const rect = formulaBtn.getBoundingClientRect();
      let left = rect.left;
      if (left + 340 > window.innerWidth) left = window.innerWidth - 350;
      formulaPanel.style.left = left + 'px';

      // 智能判断：如果按钮下方空间足够，就向下弹；如果不够（比如在屏幕底部），就向上弹
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow > 450) {
        formulaPanel.style.top = (rect.bottom + 8) + 'px';
        formulaPanel.style.maxHeight = (spaceBelow - 20) + 'px';
      } else {
        formulaPanel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        formulaPanel.style.maxHeight = (rect.top - 20) + 'px';
      }

      // 点击外部关闭
      setTimeout(() => {
        document.addEventListener('pointerdown', function closeFormulaPanel(ev) {
          if (!formulaPanel.contains(ev.target) && ev.target !== formulaBtn && !formulaBtn.contains(ev.target)) {
            formulaPanel.remove();
            document.removeEventListener('pointerdown', closeFormulaPanel);
          }
        });
      }, 10);

      // ================= 公式渲染预览区 =================
      const previewBox = el('div', {
        style: {
          padding: '10px', background: 'rgba(142,202,230,0.1)', borderRadius: '6px',
          textAlign: 'center', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', color: 'var(--text)', border: '1px dashed var(--primary)', marginBottom: '4px', overflowX: 'auto'
        },
        innerHTML: '<span style="font-size:12px;color:#999">选择或输入公式进行预览</span>'
      });
      formulaPanel.appendChild(previewBox);

      const inputBox = el('input', {
        type: 'text', placeholder: '例如：\\frac{a}{b}',
        style: { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box', fontSize: '13px' }
      });

      const updatePreview = () => {
        const val = inputBox.value.trim();
        if (val && window.katex) {
          try {
            previewBox.innerHTML = window.katex.renderToString(val, { throwOnError: true });
            previewBox.style.color = 'var(--text)';
          } catch (e) {
            previewBox.innerHTML = '<span style="font-size:12px;color:var(--danger)">语法错误</span>';
          }
        } else {
          previewBox.innerHTML = '<span style="font-size:12px;color:#999">选择或输入公式进行预览</span>';
        }
      };
      inputBox.addEventListener('input', updatePreview);
      formulaPanel.appendChild(inputBox);

      // 插入公式的核心逻辑（渲染成可视化节点）
      function insertFormula(latexCode) {
        if (!latexCode.trim()) return;
        explainInput.focus();
        if (savedFormulaRange) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedFormulaRange);
        }

        // 1. 用 KaTeX 渲染出 HTML
        let renderedHtml = '';
        try {
          renderedHtml = window.katex.renderToString(latexCode, { throwOnError: false, displayMode: false });
        } catch (e) {
          renderedHtml = latexCode; // 如果渲染失败，直接显示源码
        }

        // 2. 构造一个“公式壳子”（不可编辑，内含源码供后续提取）
        const formulaHtml = `<span class="math-node" contenteditable="false" data-latex="${latexCode.replace(/"/g, '&quot;')}" style="display:inline-block; padding: 2px 4px; margin: 0 2px; background: rgba(142,202,230,0.15); border-radius: 4px; cursor: pointer; vertical-align: middle;">${renderedHtml}</span>&nbsp;`;

        document.execCommand('insertHTML', false, formulaHtml);
        explainInput.dispatchEvent(new Event('input', { bubbles: true }));
        form.explanation = explainInput.innerHTML;
        queueSave();
        formulaPanel.remove();
      }

      formulaPanel.appendChild(el('button', {
        class: 'btn btn-sm btn-primary', text: '插入到正文',
        style: { width: '100%', height: '28px', minHeight: 'auto', fontSize: '12px' },
        onClick: () => {
          if (inputBox.value.trim()) insertFormula(inputBox.value.trim());
          else toastError('公式不能为空');
        }
      }));

      // ================= 1. 海量常用公式（可展收） =================
      const commonWrap = el('div', { style: { marginTop: '4px' } });
      let commonExpanded = true;
      const commonHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '12px', color: 'var(--text-2)', fontWeight: 'bold' } });
      const commonBody = el('div', { style: { marginTop: '6px' } });
      commonWrap.appendChild(commonHeader);
      commonWrap.appendChild(commonBody);
      formulaPanel.appendChild(commonWrap);

      function renderCommon() {
        commonHeader.innerHTML = '';
        commonHeader.appendChild(el('span', { text: '📚 常用公式库' }));
        commonHeader.appendChild(el('span', { text: commonExpanded ? '▾' : '▸' }));
        commonHeader.onclick = (e) => { e.stopPropagation(); commonExpanded = !commonExpanded; renderCommon(); };
        if (!commonExpanded) { commonBody.innerHTML = ''; return; }
        commonBody.innerHTML = '';

        const categories = [
          {
            name: '基础与代数',
            items: [
              { label: '分数', latex: '\\frac{a}{b}' },
              { label: '根号', latex: '\\sqrt{x}' },
              { label: 'n次方', latex: 'x^{n}' },
              { label: '对数', latex: '\\log_{a}{b}' },
              { label: '极限', latex: '\\lim_{x \\to 0}' },
              { label: '组合数', latex: 'C_{n}^{m}' },
              { label: '阶乘', latex: 'n!' },
              { label: '求和', latex: '\\sum_{i=1}^{n}' }
            ]
          },
          {
            name: '微积分',
            items: [
              { label: '积分', latex: '\\int_{a}^{b}' },
              { label: '二重积', latex: '\\iint_{D}' },
              { label: '偏导', latex: '\\frac{\\partial y}{\\partial x}' },
              { label: '梯度', latex: '\\nabla f' },
              { label: '无穷', latex: '\\infty' }
            ]
          },
          {
            name: '线性代数',
            items: [
              { label: '矩阵', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
              { label: '行列式', latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}' },
              { label: '向量', latex: '\\vec{v}' },
              { label: '转置', latex: 'A^{T}' }
            ]
          },
          {
            name: '物理/工程',
            items: [
              { label: '矢量', latex: '\\mathbf{F}' },
              { label: '约等', latex: '\\approx' },
              { label: '正负', latex: '\\pm' },
              { label: '角度', latex: '\\theta' },
              { label: '阿尔法', latex: '\\alpha' },
              { label: '贝塔', latex: '\\beta' },
              { label: '德尔塔', latex: '\\Delta' }
            ]
          }
        ];

        categories.forEach(cat => {
          commonBody.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '4px', marginBottom: '2px' }, text: cat.name }));
          const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' } });
          cat.items.forEach(f => {
            grid.appendChild(el('div', {
              style: { padding: '4px 0', textAlign: 'center', fontSize: '11px', background: 'var(--bg)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.05)' },
              text: f.label,
              onClick: () => { inputBox.value = f.latex; inputBox.dispatchEvent(new Event('input')); }
            }));
          });
          commonBody.appendChild(grid);
        });
      }
      renderCommon();

      // ================= 2. 已使用公式列表 =================
      formulaPanel.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.08)', marginTop: '4px', paddingTop: '6px' } }));
      const usedWrap = el('div');
      let usedExpanded = false;
      const usedHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', color: 'var(--text-2)' } });
      const usedBody = el('div');
      usedWrap.appendChild(usedHeader);
      usedWrap.appendChild(usedBody);
      formulaPanel.appendChild(usedWrap);

      function renderUsedFormulas() {
        usedHeader.innerHTML = '';

        // 抓取最新数据
        let usedList = [];
        explainInput.querySelectorAll('.math-node').forEach(node => {
          const latex = node.getAttribute('data-latex');
          if (latex && !usedList.includes(latex)) usedList.push(latex);
        });
        const regex = /\$([^\$]+)\$/g;
        let match;
        while ((match = regex.exec(explainInput.innerText || '')) !== null) {
          if (!usedList.includes(match[1])) usedList.push(match[1]);
        }

        usedHeader.appendChild(el('span', { text: `📋 已使用公式 (${usedList.length})` }));
        usedHeader.appendChild(el('span', { text: usedExpanded ? '▾' : '▸' }));
        usedHeader.onclick = (e) => { e.stopPropagation(); usedExpanded = !usedExpanded; renderUsedFormulas(); };

        if (!usedExpanded) { usedBody.innerHTML = ''; return; }
        usedBody.innerHTML = '';

        if (usedList.length === 0) {
          usedBody.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', padding: '4px', textAlign: 'center' }, text: '暂无已使用的公式' }));
          return;
        }

        //批量操作栏
        let usedManageMode = false;
        let selectedUsed = new Set();
        const usedToolbar = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } });

        const renderUsedToolbar = () => {
          usedToolbar.innerHTML = '';
          usedToolbar.appendChild(el('button', {
            class: 'btn btn-sm btn-ghost', text: usedManageMode ? '完成' : '管理',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: () => { usedManageMode = !usedManageMode; selectedUsed.clear(); renderUsedFormulas(); }
          }));
          if (usedManageMode) {
            usedToolbar.appendChild(el('button', {
              class: 'btn btn-sm btn-ghost', text: '全选',
              style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
              onClick: () => { usedList.forEach(l => selectedUsed.add(l)); renderUsedFormulas(); }
            }));
            usedToolbar.appendChild(el('button', {
              class: 'btn btn-sm btn-danger', text: `删除(${selectedUsed.size})`,
              style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto' },
              onClick: () => {
                if (selectedUsed.size === 0) return;
                // 从 DOM 中删除对应的节点
                explainInput.querySelectorAll('.math-node').forEach(node => {
                  if (selectedUsed.has(node.getAttribute('data-latex'))) node.remove();
                });
                // 从纯文本中删除
                let newText = explainInput.innerText || '';
                selectedUsed.forEach(latex => {
                  newText = newText.replace(new RegExp(`\\$${latex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\$`, 'g'), '');
                });
                // 如果使用了富文本，删除纯文本稍微复杂，这里建议用户直接编辑
                if (explainInput.innerText !== newText) {
                  explainInput.innerText = newText;
                }

                form.explanation = explainInput.innerHTML;
                queueSave();
                selectedUsed.clear();
                renderUsedFormulas();
                toastSuccess('已删除选中公式');
              }
            }));
          }
        };

        renderUsedToolbar();
        usedBody.appendChild(usedToolbar);

        // 公式列表
        const listBox = el('div', { style: { maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' } });
        usedList.forEach(latex => {
          const isSel = selectedUsed.has(latex);
          listBox.appendChild(el('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px', background: isSel ? 'rgba(239,71,111,0.1)' : 'var(--bg)', borderRadius: '4px', cursor: 'pointer' },
            onClick: () => {
              if (usedManageMode) {
                if (isSel) selectedUsed.delete(latex); else selectedUsed.add(latex);
                renderUsedFormulas();
              } else {
                // 非管理模式下，点击直接预览
                inputBox.value = latex; inputBox.dispatchEvent(new Event('input'));
              }
            }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1', overflow: 'hidden' } }, [
              usedManageMode ? el('input', { type: 'checkbox', checked: isSel, style: { pointerEvents: 'none' } }) : null,
              el('span', {
                style: { fontSize: '12px', flex: '1', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
                innerHTML: window.katex ? window.katex.renderToString(latex, { throwOnError: false }) : latex
              })
            ]),
            //收藏按钮
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '⭐',
              style: { padding: '0 4px', fontSize: '12px', color: '#FFD166' },
              title: '收藏',
              onClick: (e) => {
                e.stopPropagation();
                const list = getFavFormulas();
                if (!list.some(f => f.latex === latex)) {
                  list.push({ id: Date.now(), latex });
                  saveFavFormulas(list);
                  renderFavFormulas(); // 刷新收藏列表
                  toastSuccess('已收藏');
                } else { toastError('已在收藏列表中'); }
              }
            })
          ]));
        });
        usedBody.appendChild(listBox);
      }
      renderUsedFormulas();

      // ================= 3. 公式收藏列表（带管理） =================
      formulaPanel.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.08)', marginTop: '4px', paddingTop: '6px' } }));
      const favWrap = el('div');
      let favExpanded = false;
      let favManageMode = false;
      const favSelected = new Set();
      const favHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '11px', color: 'var(--text-2)' } });
      const favBody = el('div');
      favWrap.appendChild(favHeader);
      favWrap.appendChild(favBody);
      formulaPanel.appendChild(favWrap);

      function getFavFormulas() { try { return JSON.parse(localStorage.getItem('kg_fav_formulas') || '[]'); } catch { return []; } }
      function saveFavFormulas(list) { localStorage.setItem('kg_fav_formulas', JSON.stringify(list)); }

      function renderFavFormulas() {
        const list = getFavFormulas();
        favHeader.innerHTML = '';
        favHeader.appendChild(el('span', { text: `⭐ 公式收藏 (${list.length})` }));
        favHeader.appendChild(el('span', { text: favExpanded ? '▾' : '▸' }));
        favHeader.onclick = (e) => { e.stopPropagation(); favExpanded = !favExpanded; renderFavFormulas(); };

        if (!favExpanded) { favBody.innerHTML = ''; return; }
        favBody.innerHTML = '';

        if (list.length === 0) {
          favBody.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', padding: '4px', textAlign: 'center' }, text: '暂无收藏' }));
          return;
        }

        //批量操作栏
        let favManageMode = false;
        let selectedFav = new Set();
        const favToolbar = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } });

        const renderFavToolbar = () => {
          favToolbar.innerHTML = '';
          favToolbar.appendChild(el('button', {
            class: 'btn btn-sm btn-ghost', text: favManageMode ? '完成' : '管理',
            style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: () => { favManageMode = !favManageMode; selectedFav.clear(); renderFavFormulas(); }
          }));
          if (favManageMode) {
            favToolbar.appendChild(el('button', {
              class: 'btn btn-sm btn-ghost', text: '全选',
              style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto', background: 'var(--bg)' },
              onClick: () => { list.forEach(f => selectedFav.add(f.id)); renderFavFormulas(); }
            }));
            favToolbar.appendChild(el('button', {
              class: 'btn btn-sm btn-danger', text: `删除(${selectedFav.size})`,
              style: { fontSize: '10px', padding: '0 6px', height: '20px', minHeight: 'auto' },
              onClick: () => {
                if (selectedFav.size === 0) return;
                const newList = list.filter(f => !selectedFav.has(f.id));
                saveFavFormulas(newList);
                selectedFav.clear();
                renderFavFormulas();
                toastSuccess('已删除选中收藏');
              }
            }));
          }
        };

        renderFavToolbar();
        favBody.appendChild(favToolbar);

        const listBox = el('div', { style: { maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' } });
        list.forEach((f) => {
          const isSel = selectedFav.has(f.id);
          listBox.appendChild(el('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px', background: isSel ? 'rgba(239,71,111,0.1)' : 'var(--bg)', borderRadius: '4px', cursor: 'pointer' },
            onClick: () => {
              if (favManageMode) {
                if (isSel) selectedFav.delete(f.id); else selectedFav.add(f.id);
                renderFavFormulas();
              } else {
                inputBox.value = f.latex; inputBox.dispatchEvent(new Event('input'));
              }
            }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1', overflow: 'hidden' } }, [
              favManageMode ? el('input', { type: 'checkbox', checked: isSel, style: { pointerEvents: 'none' } }) : null,
              el('span', {
                style: { fontSize: '12px', flex: '1', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
                innerHTML: window.katex ? window.katex.renderToString(f.latex, { throwOnError: false }) : f.latex
              })
            ])
          ]));
        });
        favBody.appendChild(listBox);
      }
      renderFavFormulas();
    }
  });

  // 把这 4 个按钮放进左侧滚动区
  toolbarInner.appendChild(copyBtn);
  toolbarInner.appendChild(quoteBtn);
  toolbarInner.appendChild(maskBtn);
  toolbarInner.appendChild(formulaBtn);

  // 分隔线
  toolbarInner.appendChild(el('div', { style: { width: '1px', height: '16px', background: 'rgba(0,0,0,.1)', margin: '0 4px' } }));

  // ================== 下面是你原本就有的排版按钮 ==================
  // (如果你原本后面还有加粗、斜体等按钮的 appendChild，由于这段替换没包含它们，
  // 请确保它们在代码的更下方没有被删掉)

  // 接下来是你的双向链接按钮 🔗
  const linkBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    style: { padding: '0 6px', fontSize: '14px', color: 'var(--primary)', flexShrink: '0', marginLeft: '4px' },
    text: '🔗',
    title: '插入双向链接',
    onMousedown: (e) => e.preventDefault(),
    onClick: (e) => {
      e.preventDefault();
      saveExplainRange(); // 保存当前光标位置

      // 弹出搜索选择框
      const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
      const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px', width: '90%' } });

      const searchInput = el('input', {
        placeholder: '搜索要链接的知识点或文件夹...',
        style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '12px', boxSizing: 'border-box', outline: 'none' }
      });

      const listWrap = el('div', { style: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });

      // 获取全站知识点和文件夹
      const allPoints = store.getPoints();
      const allTasks = store.getTasks();

      const allItems = [
        ...allTasks.map(t => ({ id: t.id, name: t.name, type: '📁 文件夹' })),
        ...allPoints.map(p => ({ id: p.id, name: p.content.substring(0, 30), type: '📄 卡片' }))
      ];

      const renderList = (kw = '') => {
        listWrap.innerHTML = '';
        const filtered = allItems.filter(item => item.name.includes(kw));
        if (filtered.length === 0) {
          listWrap.appendChild(el('div', { text: '没有找到匹配项', style: { textAlign: 'center', padding: '20px', color: '#999' } }));
          return;
        }
        filtered.forEach(item => {
          listWrap.appendChild(el('div', {
            style: { padding: '10px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' },
            onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(142,202,230,0.2)',
            onMouseLeave: (e) => e.currentTarget.style.background = 'var(--bg)',
            onMousedown: (e) => e.preventDefault(),
            onClick: () => {
              const placeholder = `[[${item.type.includes('文件夹') ? 'folder' : 'point'}:${item.id}:${item.name}]]`;
              explainInput.focus();
              const sel = window.getSelection();

              let textToInsert = item.name;
              let isTextSelected = false;

              if (savedRange && !savedRange.collapsed && explainInput.contains(savedRange.startContainer)) {
                sel.removeAllRanges();
                sel.addRange(savedRange);
                textToInsert = sel.toString();
                isTextSelected = true;
              }

              const linkSpan = document.createElement('span');
              linkSpan.className = 'editor-link';
              linkSpan.setAttribute('data-link', placeholder);
              linkSpan.textContent = textToInsert;
              linkSpan.style.cssText = 'color: #5C6BC0; font-size: inherit; line-height: inherit; font-weight: inherit; cursor: pointer;';

              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(linkSpan);

              range.setStartAfter(linkSpan);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);

              explainInput.dispatchEvent(new Event('input', { bubbles: true }));
              form.explanation = explainInput.innerHTML;
              saveExplainRange();
              queueSave();
              pushHistory();
              mask.remove();
              toastSuccess(isTextSelected ? `已将「${textToInsert}」设为链接` : '已插入链接');
            }
          }, [
            el('span', { text: `${item.type} ${item.name}`, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1' } }),
            el('span', { text: '🔗', style: { fontSize: '12px', marginLeft: '8px', opacity: 0.5 } })
          ]));
        });
      };

      searchInput.oninput = (e) => renderList(e.target.value);
      renderList();

      box.appendChild(el('h3', { text: '插入双向链接', style: { marginBottom: '12px', fontSize: '16px' } }));
      box.appendChild(searchInput);
      box.appendChild(listWrap);
      box.appendChild(el('button', { class: 'btn btn-ghost', text: '取消', style: { marginTop: '16px', width: '100%', padding: '10px' }, onClick: () => mask.remove() }));

      mask.appendChild(box);
      document.body.appendChild(mask);

      setTimeout(() => searchInput.focus(), 100);
    }
  });

  // 收起按钮
  const toggleToolbarBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    style: { padding: '0 8px', fontSize: '12px', color: 'var(--text-2)', flexShrink: '0', marginLeft: '4px', whiteSpace: 'nowrap' },
    text: '收起',
    onClick: (e) => {
      isToolbarExpanded = !isToolbarExpanded;
      toolbarInner.style.display = isToolbarExpanded ? 'flex' : 'none';
      e.target.textContent = isToolbarExpanded ? '收起' : '展开';
    }
  });

  // ================== 组装 Header ==================
  // 1. 把包含（复制、引用、挖空、公式、加粗...等）的 toolbarInner 塞进去
  toolbarHeader.appendChild(toolbarInner);

  // 2. 把链接按钮 🔗 固定在右侧
  toolbarHeader.appendChild(linkBtn);

  // 3. 把收起按钮固定在最右侧
  toolbarHeader.appendChild(toggleToolbarBtn);

  toolbarWrapper.appendChild(toolbarHeader);

  // 统一图标库
  const icons = {
    fontSize: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg>`,
    lineHeight: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="3" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line><polyline points="7 10 3 14 7 18"></polyline><polyline points="17 10 21 14 17 18"></polyline></svg>`,
    theme: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--primary-dark)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"></path></svg>`,
    bold: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path></svg>`,
    italic: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"></line><line x1="14" y1="20" x2="5" y2="20"></line><line x1="15" y1="4" x2="9" y2="20"></line></svg>`,
    underline: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"></path><line x1="4" y1="21" x2="20" y2="21"></line></svg>`,
    color: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--primary-dark)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.33-.08-.66-.22-.97-.14-.3-.22-.62-.22-.97 0-.83.67-1.5 1.5-1.5h3.5c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"></path><circle cx="6.5" cy="11.5" r="1.5"></circle><circle cx="9.5" cy="7.5" r="1.5"></circle><circle cx="14.5" cy="7.5" r="1.5"></circle><circle cx="17.5" cy="11.5" r="1.5"></circle></svg>`,
    highlight: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#FFD166" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"></path></svg>`,
    undo: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`,
    redo: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path></svg>`,
    clear: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--danger)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    eraseAll: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--danger)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`
  };

  // ==================== 按钮生成器（带平板防误触长按提示） ====================
  const createToolBtn = (svg, title, onClick) => {
    let pressTimer = null;
    let tooltipEl = null;

    // 显示提示气泡
    const showTooltip = () => {
      if (tooltipEl) return;
      const rect = b.getBoundingClientRect();
      tooltipEl = document.createElement('div');
      tooltipEl.style.cssText = `
        position: fixed; left: ${rect.left + rect.width / 2}px; top: ${rect.bottom + 8}px; 
        transform: translateX(-50%); background: rgba(43,45,66,.95); color: #fff; 
        padding: 6px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap; 
        pointer-events: none; z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      tooltipEl.textContent = title;
      document.body.appendChild(tooltipEl);
      if (navigator.vibrate) navigator.vibrate(30); // 平板震动反馈
    };

    // 隐藏提示气泡
    const hideTooltip = () => {
      if (tooltipEl) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    };

    const b = el('button', {
      class: 'btn btn-sm btn-ghost',
      style: { padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '28px', height: '28px' },
      title: title, // 保留自带的，电脑端悬停还能看
      onMousedown: (e) => {
        e.preventDefault(); // 防止点击时抢占富文本焦点
        // 电脑端：按住 500ms 触发
        if (e.pointerType === 'mouse') {
          pressTimer = setTimeout(showTooltip, 500);
        }
      },
      onMouseup: () => {
        clearTimeout(pressTimer);
        if (navigator.vibrate) navigator.vibrate(0);
        setTimeout(hideTooltip, 1000); // 延迟 1 秒消失
      },
      onMouseLeave: () => {
        clearTimeout(pressTimer);
        hideTooltip();
      },
      onClick: (e) => {
        e.preventDefault();
        clearTimeout(pressTimer);
        hideTooltip();
        onClick();
      },
      //针对平板触控的专属拦截与触发
      onTouchstart: (e) => {
        // 强制阻断 iPad 的放大镜和系统菜单
        if (e.cancelable) e.preventDefault();
        pressTimer = setTimeout(showTooltip, 400); // 平板上 400ms 触发
      },
      onTouchend: (e) => {
        if (e.cancelable) e.preventDefault();
        clearTimeout(pressTimer);
        setTimeout(hideTooltip, 1000);
      },
      onTouchmove: (e) => {
        // 如果手指滑动了，就取消长按
        if (e.cancelable) e.preventDefault();
        clearTimeout(pressTimer);
        hideTooltip();
      }
    });

    b.innerHTML = svg;

    // 关键 CSS 强杀系统菜单
    b.style.webkitTouchCallout = 'none';
    b.style.userSelect = 'none';
    b.style.touchAction = 'manipulation';

    return b;
  };

  const closePanels = () => {
    if (fontSizePanel) fontSizePanel.style.display = 'none';
    if (lineHeightPanel) lineHeightPanel.style.display = 'none';
    if (themePanel) themePanel.style.display = 'none';
    if (typeof alignmentPanel !== 'undefined' && alignmentPanel) alignmentPanel.style.display = 'none';
    if (typeof colorPanel !== 'undefined' && colorPanel) colorPanel.style.display = 'none';
    isPanelOpen = false;
    requestAnimationFrame(() => {
      try {
        if (typeof updateFormatStatus === 'function' && formatStatus && formatStatus.isConnected) {
          updateFormatStatus();
        }
      } catch (e) {
        //捕获异常，防止关闭面板时崩溃
        console.warn('关闭面板刷新状态时忽略错误:', e);
      }
    });
  };

  // 面板挂载到 body，绝对不受父级干扰
  const fontSizePanel = el('div', { class: 'edit-point-panel', style: { display: 'none', position: 'fixed', zIndex: '99999', background: 'var(--card)', padding: '10px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', flexDirection: 'column', width: '200px', gap: '8px', border: '1px solid rgba(0,0,0,.1)' } });
  document.body.appendChild(fontSizePanel);
  const lineHeightPanel = el('div', { class: 'edit-point-panel', style: { display: 'none', position: 'fixed', zIndex: '99999', background: 'var(--card)', padding: '10px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', flexDirection: 'column', width: '200px', gap: '8px', border: '1px solid rgba(0,0,0,.1)' } });
  document.body.appendChild(lineHeightPanel);
  const themePanel = el('div', { class: 'edit-point-panel', style: { display: 'none', position: 'fixed', zIndex: '99999', background: 'var(--card)', padding: '12px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', flexDirection: 'column', width: '220px', gap: '10px', border: '1px solid rgba(0,0,0,.1)' } });
  document.body.appendChild(themePanel);

  const showPanelAtBtn = (panel, btn, htmlBuilder) => {
    const isHidden = panel.style.display === 'none';
    closePanels();
    if (!isHidden) return;

    // 先保存选区，确保万无一失
    saveExplainRange();
    isPanelOpen = true;

    const rect = btn.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8) + 'px';
    let left = rect.left;
    if (left + 200 > window.innerWidth) left = window.innerWidth - 210; // 适配收窄后的面板
    panel.style.left = left + 'px';
    panel.style.display = 'flex'; // 注意这里改成 flex，配合你的面板样式
    panel.innerHTML = '';
    htmlBuilder(panel);
  };

  // ==================== 1. 字号 ====================
  const buildFontPanel = (panel) => {
    const fontSizes = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

    const fontCustomInput = el('input', {
      type: 'text', inputmode: 'decimal', value: '16',
      style: { flex: '1', minWidth: '60px', fontSize: '14px', padding: '6px 8px', border: '1px solid var(--primary)', background: 'var(--card)', borderRadius: '6px', outline: 'none', textAlign: 'center', color: 'var(--text)' }
    });

    //3.3 打开面板时：一致则填值，混合则留空显示“混合”
    try {
      if (savedRange && !savedRange.collapsed && explainInput.contains(savedRange.startContainer)) {
        const range = savedRange;
        const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        const sizes = new Set();
        let n;
        while ((n = walker.nextNode())) {
          const p = n.parentElement;
          if (p) sizes.add(Math.round(parseFloat(getComputedStyle(p).fontSize) || 15));
        }
        if (sizes.size === 1) {
          fontCustomInput.value = String([...sizes][0]);
        } else {
          fontCustomInput.value = '';
          fontCustomInput.placeholder = '混合';
        }
      } else {
        fontCustomInput.value = String(Math.round(parseFloat(getComputedStyle(explainInput).fontSize) || 15));
      }
    } catch { }

    //输入框获得焦点时不覆盖 savedRange
    fontCustomInput.addEventListener('focus', () => {
      // savedRange 已在 showPanelAtBtn 里保存，这里什么都不做
    });

    const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    fontSizes.forEach(s => {
      grid.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: s + 'px',
        style: { flex: '1 0 28%', padding: '6px 0', minWidth: '50px', justifyContent: 'center', background: 'var(--bg)' },
        onMousedown: (e) => { e.preventDefault(); e.stopPropagation(); fontCustomInput.value = s; }
      }));
    });

    let isGridExpanded = false;
    const toggleGridBtn = el('button', {
      class: 'btn btn-sm btn-ghost', text: '展开更多',
      style: { width: '100%', fontSize: '12px', padding: '4px', marginTop: '4px', color: 'var(--text-2)' },
      onMousedown: (e) => e.preventDefault(),
      onClick: (e) => {
        e.preventDefault();
        isGridExpanded = !isGridExpanded;
        grid.style.maxHeight = isGridExpanded ? '150px' : '60px';
        grid.style.overflowY = isGridExpanded ? 'auto' : 'hidden';
        e.target.textContent = isGridExpanded ? '收起' : '展开更多';
      }
    });

    grid.style.maxHeight = '60px';
    grid.style.overflowY = 'hidden';
    grid.style.transition = 'max-height 0.2s ease';

    panel.appendChild(grid);
    panel.appendChild(toggleGridBtn);

    panel.appendChild(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '-',
        style: { padding: '0 8px', minHeight: '28px', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: (e) => { e.preventDefault(); fontCustomInput.value = Math.max(1, Number(fontCustomInput.value || 12) - 1); }
      }),
      fontCustomInput,
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '+',
        style: { padding: '0 8px', minHeight: '28px', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: (e) => { e.preventDefault(); fontCustomInput.value = Number(fontCustomInput.value || 12) + 1; }
      })
    ]));

    panel.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '取消',
        style: { flex: '1', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: closePanels
      }),
      el('button', {
        class: 'btn btn-sm btn-primary', text: '确定', style: { flex: '1' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          const val = fontCustomInput.value;
          if (!val) return closePanels();

          // 先恢复 savedRange，再操作
          explainInput.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();

          if (savedRange && explainInput.contains(savedRange.startContainer)) {
            sel.addRange(savedRange);
          } else {
            closePanels();
            return;
          }

          const range = sel.getRangeAt(0);

          if (!range.collapsed) {
            // 1. 提取选区内容
            const frag = range.extractContents();

            // 2. 清除 fragment 内所有元素的内联 font-size 和 <font size>
            frag.querySelectorAll('*').forEach(node => {
              if (node.style && node.style.fontSize) node.style.removeProperty('font-size');
              if (node.tagName === 'FONT') node.removeAttribute('size');
            });

            // 3. 包新 span，设新字号（!important 确保覆盖）
            const span = document.createElement('span');
            span.style.setProperty('font-size', val + 'px', 'important');
            span.appendChild(frag);
            range.insertNode(span);

            // 4. 重新选中 span 内容
            const r = document.createRange();
            r.selectNodeContents(span);
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
          } else {
            // 折叠光标：插入零宽字符 span，只影响接下来输入的字
            const span = document.createElement('span');
            span.style.setProperty('font-size', val + 'px', 'important');
            span.appendChild(document.createTextNode('\u200b'));
            range.insertNode(span);

            const r = document.createRange();
            r.setStart(span.firstChild, 1);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
          }

          form.explanation = explainInput.innerHTML;
          queueSave();
          recordToolbarAction();
          requestAnimationFrame(() => updateFormatStatus());
          closePanels();
        }
      })
    ]));

    setTimeout(() => {
      fontCustomInput.focus();
      fontCustomInput.select();
    }, 50);
  };

  const btnFont = createToolBtn(icons.fontSize, '字号', () => showPanelAtBtn(fontSizePanel, btnFont, buildFontPanel));
  toolbarInner.appendChild(btnFont);

  // ==================== 2. 行距 ====================
  const buildLinePanel = (panel) => {
    const lineHeights = [1.0, 1.15, 1.5, 1.8, 2.0, 2.5, 3.0];

    const lineCustomInput = el('input', {
      type: 'text', inputmode: 'decimal', value: '1.5',
      style: { flex: '1', minWidth: '60px', fontSize: '14px', padding: '6px 8px', border: '1px solid var(--primary)', background: 'var(--card)', borderRadius: '6px', outline: 'none', textAlign: 'center', color: 'var(--text)' }
    });
    lineCustomInput.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.target.focus(); });

    const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    lineHeights.forEach(l => {
      grid.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: String(l),
        style: { flex: '1 0 28%', padding: '6px 0', minWidth: '50px', justifyContent: 'center', background: 'var(--bg)' },
        onMousedown: (e) => { e.preventDefault(); e.stopPropagation(); lineCustomInput.value = l; }
      }));
    });
    panel.appendChild(grid);

    panel.appendChild(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '-',
        style: { padding: '0 8px', minHeight: '28px', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: (e) => { e.preventDefault(); lineCustomInput.value = Math.max(0.1, Number(lineCustomInput.value || 1.5) - 0.1).toFixed(1); }
      }),
      lineCustomInput,
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '+',
        style: { padding: '0 8px', minHeight: '28px', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: (e) => { e.preventDefault(); lineCustomInput.value = (Number(lineCustomInput.value || 1.5) + 0.1).toFixed(1); }
      })
    ]));

    panel.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '取消',
        style: { flex: '1', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: closePanels
      }),
      el('button', {
        class: 'btn btn-sm btn-primary', text: '确定', style: { flex: '1' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          const val = lineCustomInput.value;
          if (!val) return closePanels();

          //先恢复 savedRange，再操作
          explainInput.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();

          if (savedRange && explainInput.contains(savedRange.startContainer)) {
            sel.addRange(savedRange);
          } else {
            closePanels();
            return;
          }

          const range = sel.getRangeAt(0);

          if (!range.collapsed) {
            // 有选中：只改选中部分
            const span = document.createElement('span');
            span.style.setProperty('line-height', val, 'important');
            span.appendChild(range.extractContents());
            range.insertNode(span);

            const r = document.createRange();
            r.selectNodeContents(span);
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
          } else {
            // 折叠光标：行距是块级属性，作用于整个输入框更合理
            explainInput.style.setProperty('line-height', val, 'important');
          }

          form.explanation = explainInput.innerHTML;
          queueSave();
          recordToolbarAction();
          requestAnimationFrame(() => updateFormatStatus());
          closePanels();
        }
      })
    ]));

    setTimeout(() => {
      lineCustomInput.focus();
      lineCustomInput.select();
    }, 50);
  };

  const btnLine = createToolBtn(icons.lineHeight, '行距', () => showPanelAtBtn(lineHeightPanel, btnLine, buildLinePanel));
  toolbarInner.appendChild(btnLine);

  // ==================== 2.5 对齐 ====================
  const alignmentPanel = el('div', {
    class: 'edit-point-panel',
    style: {
      display: 'none', position: 'fixed', zIndex: '99999', background: 'var(--card)',
      padding: '8px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      border: '1px solid rgba(0,0,0,.1)', gap: '4px'
    }
  });
  document.body.appendChild(alignmentPanel);

  const alignIcons = {
    left: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    center: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    right: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    justify: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`
  };

  const buildAlignPanel = (panel) => {
    panel.style.display = 'flex';
    panel.innerHTML = '';
    [
      ['left', '左对齐'],
      ['center', '居中'],
      ['right', '右对齐'],
      ['justify', '两端对齐']
    ].forEach(([cmd, title]) => {
      const b = el('button', {
        class: 'btn btn-sm btn-ghost', title,
        style: { padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '32px', height: '32px' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          //先恢复 savedRange，再操作
          explainInput.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();

          if (savedRange && explainInput.contains(savedRange.startContainer)) {
            sel.addRange(savedRange);
          } else {
            closePanels();
            return;
          }

          document.execCommand('justify' + cmd.charAt(0).toUpperCase() + cmd.slice(1), false, null);

          form.explanation = explainInput.innerHTML;
          saveExplainRange();
          queueSave();
          recordToolbarAction();
          requestAnimationFrame(() => updateFormatStatus());
          closePanels();
        }
      });
      b.innerHTML = alignIcons[cmd];
      panel.appendChild(b);
    });
  };

  const btnAlign = createToolBtn(
    `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    '对齐',
    () => showPanelAtBtn(alignmentPanel, btnAlign, buildAlignPanel)
  );
  toolbarInner.appendChild(btnAlign);

  // 颜色收藏工具
  const FAV_COLOR_KEY = 'kg_fav_colors';
  function getFavoriteColors() {
    try { return JSON.parse(localStorage.getItem(FAV_COLOR_KEY) || '[]'); } catch { return []; }
  }
  function saveFavoriteColors(list) {
    localStorage.setItem(FAV_COLOR_KEY, JSON.stringify(list));
  }
  function addFavoriteColor(hex, alpha = 1, bdHex = '') {
    const list = getFavoriteColors();
    if (list.some(c => c.hex === hex && Math.abs(c.alpha - alpha) < 0.01)) return;
    list.push({
      id: crypto.randomUUID ? crypto.randomUUID() : 'c_' + Date.now() + Math.random(),
      hex, alpha, bd: bdHex
    });
    saveFavoriteColors(list);
  }
  function removeFavoriteColors(ids) {
    const set = new Set(ids);
    saveFavoriteColors(getFavoriteColors().filter(c => !set.has(c.id)));
  }
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function applyThemeBgImage(dataUrl) {
    explainInput.style.backgroundImage = `url(${dataUrl})`;
    explainInput.style.backgroundSize = 'cover';
    explainInput.style.backgroundPosition = 'center';
    explainInput.style.backgroundColor = 'transparent'; // 清除纯色背景避免干扰

    form.explanation = explainInput.innerHTML;
    queueSave();
    closePanels();
    toastSuccess('背景已应用');
  }

  // ==================== 3. 主题 ====================
  const buildThemePanel = (panel) => {
    panel.style.padding = '10px';
    panel.style.width = '240px';
    panel.style.gap = '6px';

    const bgColorInput = el('input', { type: 'color', value: '#F0F5E9', style: { width: '28px', height: '24px', padding: '0', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent' } });
    const borderColorInput = el('input', { type: 'color', value: '#B5E48C', style: { width: '28px', height: '24px', padding: '0', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent' } });

    const bgAlphaInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', style: { flex: '1', margin: '0 6px' } });
    const bgAlphaLabel = el('span', { text: '100%', style: { fontSize: '12px', color: 'var(--text-2)', minWidth: '34px', textAlign: 'right' } });

    bgAlphaInput.addEventListener('input', () => {
      bgAlphaLabel.textContent = Math.round(Number(bgAlphaInput.value) * 100) + '%';
    });

    // 背景色 + 边框色 并排一行
    panel.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '4px' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
        el('span', { text: '背景', style: { fontSize: '12px', color: 'var(--text-2)' } }),
        bgColorInput,
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '透明',
          style: { padding: '0 4px', fontSize: '11px', height: '24px', minHeight: 'auto' },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => { bgColorInput.value = '#FFFFFF'; bgAlphaInput.value = '0'; bgAlphaLabel.textContent = '0%'; }
        })
      ]),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
        el('span', { text: '边框', style: { fontSize: '12px', color: 'var(--text-2)' } }),
        borderColorInput
      ])
    ]));

    // 透明度一行
    panel.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
      el('span', { text: '透明', style: { fontSize: '12px', color: 'var(--text-2)', minWidth: '28px' } }),
      bgAlphaInput,
      bgAlphaLabel
    ]));

    // 收藏按钮 + 导入
    panel.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '2px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '⭐ 收藏边框+背景',
        style: { flex: '1', fontSize: '12px', height: '28px', minHeight: 'auto' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          const bgHex = bgColorInput.value;
          const bdHex = borderColorInput.value;
          const alpha = Number(bgAlphaInput.value);
          addFavoriteColor(bgHex, alpha, bdHex);
          toastSuccess('已收藏');
          renderFav();
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 导入',
        style: { width: '70px', fontSize: '12px', height: '28px', minHeight: 'auto' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => { alert('导入功能接入这里'); }
      })
    ]));

    // ============ 颜色收藏夹 ============
    const favWrap = el('div', { style: { marginTop: '4px', borderTop: '1px dashed rgba(0,0,0,.1)', paddingTop: '6px' } });
    let favExpanded = false;
    let favManageMode = false;
    const favSelected = new Set();

    const favHeader = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: '12px', color: 'var(--text-2)' },
      onMousedown: (e) => e.preventDefault(),
      onClick: () => { favExpanded = !favExpanded; renderFav(); }
    });
    favWrap.appendChild(favHeader);
    const favBody = el('div', { style: { marginTop: '4px' } });
    favWrap.appendChild(favBody);
    panel.appendChild(favWrap);

    function renderFav() {
      //把马卡龙色和之前的预设合并
      const builtinPresets = [
        { id: 'preset_0', hex: '#FFB3BA', alpha: 1, bd: '#FFB3BA', isPreset: true },
        { id: 'preset_1', hex: '#FFDFBA', alpha: 1, bd: '#FFDFBA', isPreset: true },
        { id: 'preset_2', hex: '#FFFFBA', alpha: 1, bd: '#FFFFBA', isPreset: true },
        { id: 'preset_3', hex: '#BAFFC9', alpha: 1, bd: '#BAFFC9', isPreset: true },
        { id: 'preset_4', hex: '#BAE1FF', alpha: 1, bd: '#BAE1FF', isPreset: true },
        { id: 'preset_5', hex: '#B5B2FF', alpha: 1, bd: '#B5B2FF', isPreset: true },
        { id: 'preset_6', hex: '#E0BBE4', alpha: 1, bd: '#E0BBE4', isPreset: true },
        { id: 'preset_7', hex: '#F0F5E9', alpha: 1, bd: '#B5E48C', isPreset: true },
        { id: 'preset_8', hex: '#FFF9E6', alpha: 1, bd: '#FFD166', isPreset: true },
        { id: 'preset_9', hex: '#F4F4F5', alpha: 1, bd: '#D4D4D8', isPreset: true },
        { id: 'preset_10', hex: '#2B2D42', alpha: 1, bd: '#2B2D42', isPreset: true },
      ];
      const customList = getFavoriteColors();
      const allColors = [...builtinPresets, ...customList];

      favHeader.innerHTML = '';
      favHeader.appendChild(el('span', { text: `颜色管理 (${allColors.length})` }));
      favHeader.appendChild(el('span', { text: favExpanded ? '▾' : '▸' }));

      if (!favExpanded) { favBody.innerHTML = ''; return; }
      favBody.innerHTML = '';

      const toolbar = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } });
      toolbar.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: favManageMode ? '完成' : '管理',
        style: { fontSize: '11px', padding: '0 6px', height: '22px', minHeight: 'auto' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => { favManageMode = !favManageMode; favSelected.clear(); renderFav(); }
      }));
      if (favManageMode) {
        toolbar.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: '全选',
          style: { fontSize: '11px', padding: '0 6px', height: '22px', minHeight: 'auto' },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => { customList.forEach(c => favSelected.add(c.id)); renderFav(); }
        }));
        toolbar.appendChild(el('button', {
          class: 'btn btn-sm btn-danger', text: `删除(${favSelected.size})`,
          style: { fontSize: '11px', padding: '0 6px', height: '22px', minHeight: 'auto' },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => {
            if (favSelected.size === 0) return;
            removeFavoriteColors([...favSelected]);
            favSelected.clear();
            renderFav();
            toastSuccess('已删除');
          }
        }));
      }
      favBody.appendChild(toolbar);

      const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
      allColors.forEach(c => {
        const isSel = favSelected.has(c.id);
        const swatch = el('div', {
          style: {
            width: '24px', height: '24px', borderRadius: '4px', cursor: 'pointer',
            background: c.hex, opacity: c.alpha,
            border: isSel ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.15)',
            position: 'relative', boxSizing: 'border-box'
          },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => {
            if (favManageMode) {
              if (c.isPreset) return;
              if (favSelected.has(c.id)) favSelected.delete(c.id); else favSelected.add(c.id);
              renderFav();
            } else {
              bgColorInput.value = c.hex;
              if (c.bd) borderColorInput.value = c.bd;
              bgAlphaInput.value = String(c.alpha);
              bgAlphaLabel.textContent = Math.round(c.alpha * 100) + '%';
            }
          }
        });
        if (isSel) {
          swatch.appendChild(el('span', {
            text: '✓', style: { position: 'absolute', top: '-5px', right: '-5px', background: 'var(--primary)', color: '#fff', borderRadius: '50%', width: '12px', height: '12px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
          }));
        }
        grid.appendChild(swatch);
      });
      favBody.appendChild(grid);
    }
    renderFav();

    // 底部按钮
    panel.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '撤回',
        style: { flex: '1', height: '30px', minHeight: 'auto', fontSize: '12px', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => { doUndo(); closePanels(); }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '恢复默认',
        style: { flex: '1', height: '30px', minHeight: 'auto', fontSize: '12px', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          explainInput.style.background = '';
          explainInput.style.backgroundColor = 'transparent';
          explainInput.style.border = '1px solid rgba(0,0,0,.1)';
          form.explanation = explainInput.innerHTML;
          queueSave();
          pushHistory();
          closePanels();
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-primary', text: '应用',
        style: { flex: '1', height: '30px', minHeight: 'auto', fontSize: '12px' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          const alpha = Number(bgAlphaInput.value);
          explainInput.style.background = hexToRgba(bgColorInput.value, alpha);
          explainInput.style.border = '1px solid ' + borderColorInput.value;

          form.explanation = explainInput.innerHTML;
          queueSave();
          pushHistory();
          closePanels();
        }
      })
    ]));
  };

  const btnTheme = createToolBtn(icons.theme, '主题与背景', () => showPanelAtBtn(themePanel, btnTheme, buildThemePanel));
  toolbarInner.appendChild(btnTheme);

  // ==================== 4. 基础按钮 ====================
  // 1. 先创建颜色面板
  const colorPanel = el('div', { class: 'edit-point-panel', style: { display: 'none', position: 'fixed', zIndex: '99999', background: 'var(--card)', padding: '10px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' } });
  document.body.appendChild(colorPanel);

  const execFormat = (command, value = null) => {
    explainInput.focus();
    const sel = window.getSelection();

    //保证选区不丢失
    if (!sel.rangeCount || !explainInput.contains(sel.anchorNode)) {
      if (savedRange && explainInput.contains(savedRange.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } else if (command !== 'removeFormat') {
        return;
      }
    }

    document.execCommand('styleWithCSS', false, true);

    if (command === 'foreColor') document.execCommand('foreColor', false, value);
    else if (command === 'hiliteColor') document.execCommand('hiliteColor', false, value);
    else if (command === 'bold') document.execCommand('bold', false, null);
    else if (command === 'italic') document.execCommand('italic', false, null);
    else if (command === 'underline') document.execCommand('underline', false, null);
    else if (command === 'removeFormat') document.execCommand('removeFormat', false, null);
    else if (command === 'insertHTML') document.execCommand('insertHTML', false, value);

    form.explanation = explainInput.innerHTML;
    saveExplainRange();
    queueSave();

    // 操作后立即记录一步历史
    pushHistory();
    requestAnimationFrame(() => updateFormatStatus());
  };

  // --- 颜色选择面板 ---
  const buildColorPanel = (cmd) => (panel) => {
    panel.innerHTML = '';
    panel.style.width = '170px';
    panel.style.padding = '8px';
    panel.style.borderRadius = '10px';
    panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '6px';

    panel.appendChild(el('div', {
      style: { fontSize: '11px', color: 'var(--text-2)', fontWeight: 'bold' },
      text: cmd === 'foreColor' ? '🎨 文字颜色' : '🖍 背景高亮'
    }));

    const renderColorGrid = (colors, container) => {
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '3px' } });
      colors.forEach(c => {
        grid.appendChild(el('div', {
          style: {
            width: '100%', aspectRatio: '1',
            background: c === 'transparent' ? 'repeating-linear-gradient(45deg, #eee, #eee 2px, #fff 2px, #fff 4px)' : c,
            borderRadius: '3px', border: '1px solid rgba(0,0,0,.1)', cursor: 'pointer',
            transition: 'transform 0.1s', boxSizing: 'border-box'
          },
          title: c === 'transparent' ? '透明 / 清除' : c,
          onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.2)',
          onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
          //阻止默认行为保住选区，同时保留 onClick 响应
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => { execFormat(cmd, c); closePanels(); }
        }));
      });
      container.appendChild(grid);
    };

    // 1. 预设颜色
    const presetWrap = el('div');
    let presetExpanded = true;
    const presetHeader = el('div', {
      style: { fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
      onMousedown: (e) => e.preventDefault(),
      onClick: () => { presetExpanded = !presetExpanded; renderPreset(); }
    });
    const presetBody = el('div');
    presetWrap.appendChild(presetHeader);
    presetWrap.appendChild(presetBody);
    panel.appendChild(presetWrap);

    const presets = ['#EF476F', '#FFD166', '#06D6A0', '#118AB2', '#073B4C', '#2B2D42', '#F4F4F5', 'transparent',
      '#F94144', '#F3722C', '#F8961E', '#90BE6D', '#43AA8B', '#577590', '#9D4EDD', '#FF99C8'];

    function renderPreset() {
      presetHeader.innerHTML = '';
      presetHeader.appendChild(el('span', { text: '预设颜色' }));
      presetHeader.appendChild(el('span', { text: presetExpanded ? '▾' : '▸' }));
      presetBody.innerHTML = '';
      if (presetExpanded) renderColorGrid(presets, presetBody);
    }
    renderPreset();

    // 2. 收藏颜色
    const favWrap = el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.08)', paddingTop: '6px' } });
    let favExpanded = false;
    let favManageMode = false;
    const favSelected = new Set();

    const favHeader = el('div', {
      style: { fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
      onMousedown: (e) => e.preventDefault(),
      onClick: () => { favExpanded = !favExpanded; renderFav(); }
    });
    const favBody = el('div');
    favWrap.appendChild(favHeader);
    favWrap.appendChild(favBody);
    panel.appendChild(favWrap);

    function renderFav() {
      favHeader.innerHTML = '';
      favHeader.appendChild(el('span', { text: `⭐ 收藏颜色 (${getFavoriteColors().length})` }));
      favHeader.appendChild(el('span', { text: favExpanded ? '▾' : '▸' }));

      if (!favExpanded) { favBody.innerHTML = ''; return; }
      favBody.innerHTML = '';

      const customList = getFavoriteColors();
      const toolbar = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } });

      toolbar.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: favManageMode ? '完成' : '管理',
        style: { fontSize: '10px', padding: '0 4px', height: '18px', minHeight: 'auto', background: 'var(--bg)' },
        onMousedown: (e) => e.preventDefault(),
        onClick: () => { favManageMode = !favManageMode; favSelected.clear(); renderFav(); }
      }));

      if (favManageMode && customList.length > 0) {
        toolbar.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: '全选',
          style: { fontSize: '10px', padding: '0 4px', height: '18px', minHeight: 'auto', background: 'var(--bg)' },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => { customList.forEach(c => favSelected.add(c.id)); renderFav(); }
        }));
        toolbar.appendChild(el('button', {
          class: 'btn btn-sm btn-danger', text: `删除(${favSelected.size})`,
          style: { fontSize: '10px', padding: '0 4px', height: '18px', minHeight: 'auto' },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => {
            if (favSelected.size === 0) return;
            removeFavoriteColors([...favSelected]);
            favSelected.clear();
            renderFav();
            toastSuccess('已删除');
          }
        }));
      }
      favBody.appendChild(toolbar);

      if (customList.length === 0) {
        favBody.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-3)', padding: '2px 0' }, text: '暂无收藏' }));
        return;
      }

      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '3px' } });
      customList.forEach(c => {
        const isSel = favSelected.has(c.id);
        const swatch = el('div', {
          style: {
            width: '100%', aspectRatio: '1', borderRadius: '3px', cursor: 'pointer',
            background: c.hex, opacity: c.alpha, position: 'relative',
            border: isSel ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.1)',
            boxSizing: 'border-box'
          },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => {
            if (favManageMode) {
              if (favSelected.has(c.id)) favSelected.delete(c.id); else favSelected.add(c.id);
              renderFav();
            } else {
              execFormat(cmd, c.hex);
              closePanels();
            }
          }
        });
        if (isSel) {
          swatch.appendChild(el('span', {
            text: '✓', style: { position: 'absolute', top: '-4px', right: '-4px', background: 'var(--primary)', color: '#fff', borderRadius: '50%', width: '10px', height: '10px', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
          }));
        }
        grid.appendChild(swatch);
      });
      favBody.appendChild(grid);
    }
    renderFav();

    // 3. 底部操作栏（收藏 + 自定义）
    const customBar = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px dashed rgba(0,0,0,.08)', paddingTop: '6px', marginTop: '2px', gap: '4px' }
    });

    // 用变量记录当前选中的颜色
    let currentCustomColor = cmd === 'foreColor' ? '#EF476F' : '#FFD166';

    //点击自定义时，现场动态创建一个输入框（避开全局 CSS 污染）
    const openColorPicker = () => {
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = currentCustomColor;
      // 强行把它定位在屏幕外，确保能弹出系统取色盘
      picker.style.cssText = 'position:fixed; top:-100px; left:-100px; opacity:0;';

      picker.oninput = (e) => {
        currentCustomColor = e.target.value;
        execFormat(cmd, currentCustomColor);
      };

      picker.onchange = (e) => {
        currentCustomColor = e.target.value;
        execFormat(cmd, currentCustomColor);
        closePanels();
      };

      document.body.appendChild(picker);
      picker.click();
      setTimeout(() => picker.remove(), 1000); // 选完销毁
    };

    // 收藏按钮：加宽，设定马卡龙背景色
    customBar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '⭐ 收藏',
      title: '收藏当前选中的颜色',
      style: {
        flex: '1',               //与自定义按钮平分空间
        height: '26px',
        minHeight: 'auto',
        padding: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255, 209, 102, 0.2)', //浅黄色高亮背景
        color: '#B8860B',        //深金色文字
        fontSize: '11px',
        border: '1px solid rgba(255, 209, 102, 0.4)',
        borderRadius: '6px'
      },
      onMousedown: (e) => e.preventDefault(),
      onClick: () => {
        addFavoriteColor(currentCustomColor, 1);
        toastSuccess('已收藏当前颜色');
        renderFav();
      }
    }));

    // 自定义按钮：平分空间，设定马卡龙背景色
    customBar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost', text: '🎨 自定义',
      style: {
        flex: '1',               //与收藏按钮平分空间
        fontSize: '11px',
        padding: '0',
        height: '26px',
        minHeight: 'auto',
        background: 'rgba(186, 225, 255, 0.3)', //浅蓝色高亮背景
        color: 'var(--primary-dark)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(186, 225, 255, 0.6)',
        borderRadius: '6px'
      },
      onMousedown: (e) => e.preventDefault(),
      onClick: openColorPicker
    }));

    panel.appendChild(customBar);
  };

  // 3. 声明按钮变量与历史记录系统
  let btnColor, btnHighLight;
  let historyStack = [explainInput.innerHTML];
  let historyIndex = 0;
  let isUndoRedoAction = false;

  function pushHistory() {
    if (isUndoRedoAction) return;
    const html = explainInput.innerHTML;
    if (html === historyStack[historyIndex]) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(html);
    if (historyStack.length > 50) historyStack.shift();
    else historyIndex++;
  }

  // 绑定输入监听（延迟记录，避免频繁打字撑爆，并支持快捷 [[ 触发）
  explainInput.addEventListener('input', () => {
    setTimeout(pushHistory, 100);

    // 快捷输入 [[ 触发插入链接弹窗
    const sel = window.getSelection();
    if (sel.rangeCount && sel.getRangeAt(0).collapsed) {
      const range = sel.getRangeAt(0);
      const textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        const textBefore = textNode.textContent.slice(0, range.startOffset);
        if (textBefore.endsWith('[[')) {
          // 删掉刚才打的两个括号
          range.setStart(textNode, range.startOffset - 2);
          range.deleteContents();

          // 触发链接弹窗（前提是你在工具栏绑定了 linkBtn）
          if (typeof linkBtn !== 'undefined' && linkBtn) {
            setTimeout(() => linkBtn.click(), 50); // 延迟一点触发，防止按键冲突
          }
        }
      }
    }
  });

  const doUndo = () => {
    if (historyIndex > 0) {
      isUndoRedoAction = true;
      historyIndex--;
      explainInput.innerHTML = historyStack[historyIndex];
      form.explanation = explainInput.innerHTML;
      queueSave();
      isUndoRedoAction = false;
    }
  };

  const doRedo = () => {
    if (historyIndex < historyStack.length - 1) {
      isUndoRedoAction = true;
      historyIndex++;
      explainInput.innerHTML = historyStack[historyIndex];
      form.explanation = explainInput.innerHTML;
      queueSave();
      isUndoRedoAction = false;
    }
  };

  // 5. 渲染工具栏按钮
  toolbarInner.appendChild(el('div', { style: { width: '1px', height: '16px', background: 'rgba(0,0,0,.1)', margin: '0 4px' } }));

  toolbarInner.appendChild(createToolBtn(icons.bold, '加粗', () => execFormat('bold')));
  toolbarInner.appendChild(createToolBtn(icons.italic, '斜体', () => execFormat('italic')));
  toolbarInner.appendChild(createToolBtn(icons.underline, '下划线', () => execFormat('underline')));

  btnColor = createToolBtn(icons.color, '文字颜色', () => showPanelAtBtn(colorPanel, btnColor, buildColorPanel('foreColor')));
  btnHighLight = createToolBtn(icons.highlight, '背景高亮', () => showPanelAtBtn(colorPanel, btnHighLight, buildColorPanel('hiliteColor')));
  toolbarInner.appendChild(btnColor);
  toolbarInner.appendChild(btnHighLight);

  toolbarInner.appendChild(el('div', { style: { width: '1px', height: '16px', background: 'rgba(0,0,0,.1)', margin: '0 4px' } }));

  toolbarInner.appendChild(createToolBtn(icons.undo, '撤销', doUndo));
  toolbarInner.appendChild(createToolBtn(icons.redo, '重做', doRedo));
  toolbarInner.appendChild(createToolBtn(icons.clear, '清除格式', () => execFormat('removeFormat')));
  toolbarInner.appendChild(createToolBtn(icons.eraseAll, '清空全部', () => {
    if (confirm('⚠️ 确定要清空所有文字吗？')) {
      explainInput.innerHTML = '';
      form.explanation = '';
      explainInput.style.removeProperty('font-size');
      queueSave();
      pushHistory();
    }

    //插入双向链接按钮
    toolbarInner.appendChild(el('div', { style: { width: '1px', height: '16px', background: 'rgba(0,0,0,.1)', margin: '0 4px' } }));
    toolbarInner.appendChild(createToolBtn(icons.bold /* 如果有专门图标可以用那个 */, '插入双向链接', () => {
      const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
      const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px', width: '90%' } });

      const searchInput = el('input', {
        placeholder: '搜索知识点或文件夹...',
        style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '12px', boxSizing: 'border-box' }
      });

      const listWrap = el('div', { style: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });

      // 获取真实数据
      const allPoints = store.getPoints(); // 所有知识点
      const allTasks = store.getTasks();   // 所有文件夹

      // 合并列表
      const allItems = [
        ...allTasks.map(t => ({ id: t.id, name: t.name, type: '📁 文件夹' })),
        ...allPoints.map(p => ({ id: p.id, name: p.content.substring(0, 30), type: '📄 卡片' }))
      ];

      const renderList = (kw = '') => {
        listWrap.innerHTML = '';
        const filtered = allItems.filter(item => item.name.includes(kw));
        if (filtered.length === 0) {
          listWrap.appendChild(el('div', { text: '没有找到匹配项', style: { textAlign: 'center', padding: '20px', color: '#999' } }));
          return;
        }
        filtered.forEach(item => {
          listWrap.appendChild(el('div', {
            style: { padding: '10px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' },
            onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(142,202,230,0.2)',
            onMouseLeave: (e) => e.currentTarget.style.background = 'var(--bg)',
            onMouseDown: (e) => e.preventDefault(),
            onClick: () => {
              const placeholder = `[[${item.type.includes('文件夹') ? 'folder' : 'point'}:${item.id}:${item.name}]]`;
              explainInput.focus();
              const sel = window.getSelection();

              let textToInsert = item.name;
              let isTextSelected = false;

              if (savedRange && !savedRange.collapsed && explainInput.contains(savedRange.startContainer)) {
                sel.removeAllRanges();
                sel.addRange(savedRange);
                textToInsert = sel.toString();
                isTextSelected = true;
              }

              const linkSpan = document.createElement('span');
              linkSpan.className = 'editor-link';
              linkSpan.setAttribute('data-link', placeholder);
              linkSpan.textContent = textToInsert;
              linkSpan.style.cssText = 'color: #5C6BC0; font-size: inherit; line-height: inherit; font-weight: inherit; cursor: pointer;';

              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(linkSpan);

              range.setStartAfter(linkSpan);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);

              explainInput.dispatchEvent(new Event('input', { bubbles: true }));
              form.explanation = explainInput.innerHTML;
              saveExplainRange();
              queueSave();
              pushHistory();
              mask.remove();
              toastSuccess(isTextSelected ? `已将「${textToInsert}」设为链接` : '已插入链接');
            }
          }, [
            el('span', { text: `${item.type} ${item.name}`, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1' } }),
            el('span', { text: '🔗', style: { fontSize: '12px', marginLeft: '8px', opacity: 0.5 } })
          ]));
        });
      };

      searchInput.oninput = (e) => renderList(e.target.value);
      renderList();

      box.appendChild(el('h3', { text: '插入双向链接', style: { marginBottom: '12px' } }));
      box.appendChild(searchInput);
      box.appendChild(listWrap);
      box.appendChild(el('button', { class: 'btn btn-primary', text: '取消', style: { marginTop: '16px', width: '100%' }, onClick: () => mask.remove() }));

      mask.appendChild(box);
      document.body.appendChild(mask);
    }));
  }));

  // ==================== 5. 格式状态显示 ====================
  const formatStatus = el('div', {
    style: {
      display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
      fontSize: '11px', color: 'var(--text-2)', padding: '2px 6px',
      borderLeft: '1px solid rgba(0,0,0,.1)', marginLeft: '4px', minHeight: '20px'
    }
  });
  toolbarInner.appendChild(formatStatus);

  function updateFormatStatus() {
    requestAnimationFrame(() => {
      try {
        if (!formatStatus || !formatStatus.isConnected) return;
        formatStatus.innerHTML = '';

        const sel = window.getSelection();
        const inExplain = sel.rangeCount && explainInput.contains(sel.anchorNode);
        const node = inExplain ? sel.anchorNode : explainInput;

        const elNode = node.nodeType === 1 ? node : node.parentElement;
        const cs = window.getComputedStyle(elNode || explainInput);

        const fs = Math.round(parseFloat(cs.fontSize) || 15);
        const lh = cs.lineHeight === 'normal' ? '默认' : (parseFloat(cs.lineHeight) / fs).toFixed(2);
        const ta = cs.textAlign || 'left';
        const taMap = { left: '左', center: '中', right: '右', justify: '两端' };

        const chip = (txt) => el('span', {
          text: txt,
          style: { background: 'rgba(142,202,230,.18)', color: 'var(--primary-dark)', padding: '1px 6px', borderRadius: '10px', whiteSpace: 'nowrap' }
        });

        formatStatus.appendChild(chip(`${fs}px`));
        formatStatus.appendChild(chip(`行距 ${lh}`));
        formatStatus.appendChild(chip(`对齐 ${taMap[ta] || '左'}`));
      } catch (e) {
        //捕获异常，防止触发系统级错误弹窗
        console.warn('刷新状态栏时被忽略的小错误:', e);
      }
    });
  }

  function renderChips(texts) {
    texts.forEach(txt => {
      formatStatus.appendChild(el('span', {
        text: txt,
        style: {
          background: txt.includes('—') ? 'rgba(255,209,102,.25)' : 'rgba(142,202,230,.18)',
          color: txt.includes('—') ? '#B8860B' : 'var(--primary-dark)',
          padding: '1px 6px', borderRadius: '10px', whiteSpace: 'nowrap'
        }
      }));
    });
  }

  // 选区变化 / 输入时刷新状态
  document.addEventListener('selectionchange', updateFormatStatus, { signal: docSignal });

  explainInput.addEventListener('input', () => {
    //在此处统一清理空壳，保证每次打字/删除都能生效
    let hasEmptyLink = false;
    explainInput.querySelectorAll('.editor-link').forEach(linkEl => {
      if (!linkEl.textContent.trim()) {
        linkEl.remove(); // 彻底扬掉空壳
        hasEmptyLink = true;
      }
    });

    if (hasEmptyLink) {
      form.explanation = explainInput.innerHTML;
      saveExplainRange();
      queueSave();
    }

    // 检测是否输入了 [[
    const sel = window.getSelection();
    if (sel.rangeCount && sel.getRangeAt(0).collapsed) {
      const range = sel.getRangeAt(0);
      const textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        const textBefore = textNode.textContent.slice(0, range.startOffset);
        if (textBefore.endsWith('[[')) {
          // 删掉输入的两个括号
          range.setStart(textNode, range.startOffset - 2);
          range.deleteContents();

          // 触发你的弹窗（调用你工具栏绑定的那个链接弹窗函数）
          // 假设你的按钮变量叫 linkBtn
          if (typeof linkBtn !== 'undefined') {
            linkBtn.click();
          }
        }
      }
    }

    updateFormatStatus();
  });

  // 首次渲染后刷新一次
  setTimeout(updateFormatStatus, 100);

  // 解释框专属的相机按钮
  const explainOcrBtn = el('button', {
    class: 'btn btn-ghost', title: '导入图片/识别到解释',
    style: { padding: '8px', fontSize: '18px', borderRadius: '10px', background: 'rgba(142,202,230,.15)', height: '44px', flexShrink: '0' },
    text: '📷',
    onMousedown: (e) => e.preventDefault(), // 防止富文本失焦
    onClick: (e) => {
      e.preventDefault();
      saveExplainRange();
      showImageSourceSheet(explainInput, true); // 绑定解释框，并传入 true
    }
  });

  // 最终组装
  const explainRow = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' } }, [
    toolbarWrapper,
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', width: '100%' } }, [
      explainInput,
      isMobile ? null : attachSpeechButton(explainInput),
      explainOcrBtn //把新按钮放进去
    ])
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
        explainInput.innerHTML = form.explanation;
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
        if (explainInput) explainInput.innerHTML = form.explanation;
      }

      // 1. 锁死标志位
      isDraftResolved = true;

      // 2.不管选了什么，立刻销毁草稿！
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

  //全局关联按钮
  view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } }, [
    el('button', {
      class: 'btn btn-sm btn-ghost', text: '🔗 连接与关系管理',
      style: { color: 'var(--primary-dark)', background: 'rgba(142,202,230,.15)' },
      onClick: () => {
        if (isNew) return toastError('请先保存卡片，再进行关联');

        // 先保存最新内容到 store
        store.updatePoint(params.id, { explanation: explainInput.innerHTML });

        // 打开连接管理弹窗
        openConnectionManager(store.getPoint(params.id));
      }
    })
  ]));

  const basicSection = el('div', { class: 'section' });
  function renderBasicSection() {
    basicSection.innerHTML = '';

    // 修改标题栏，加入搜索/替换按钮
    basicSection.appendChild(el('div', {
      class: 'section-head',
      style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      onClick: (e) => {
        //如果点的是按钮，不触发折叠
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        isInfoCollapsed = !isInfoCollapsed;
        renderBasicSection();
      }
    }, [
      el('span', { text: '基本信息' }),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost',
          text: '🔍 搜索/替换',
          style: { padding: '2px 8px', fontSize: '12px' },
          onClick: (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            openSearchReplaceModal(); // 调用替换弹窗
          }
        }),
        el('span', { text: isInfoCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
      ])
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

  // ==================== 搜索/替换功能（终极完全体） ====================
  function openSearchReplaceModal() {
    const mask = el('div', { style: { position: 'fixed', inset: 0, zIndex: 999998 } });
    const panel = el('div', {
      class: 'edit-point-panel',
      style: {
        position: 'fixed', top: '0', left: '0', background: 'var(--card)', padding: '12px',
        borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)', zIndex: 999999,
        width: '95%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '8px',
        border: '1px solid rgba(0,0,0,0.08)', maxHeight: '90vh', overflowY: 'auto'
      }
    });

    // 拖拽逻辑
    let isDragging = false, startX = 0, startY = 0, panelX = 0, panelY = 0;
    const header = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'move' },
      onPointerDown: (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        isDragging = true; startX = e.clientX - panelX; startY = e.clientY - panelY;
        panel.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e) => {
        if (!isDragging) return;
        panelX = e.clientX - startX; panelY = e.clientY - startY;
        panel.style.transform = `translate(${panelX}px, ${panelY}px)`;
      },
      onPointerUp: (e) => { isDragging = false; panel.releasePointerCapture(e.pointerId); }
    }, [
      el('h3', { text: '🔍 搜索与替换', style: { margin: 0, fontSize: '15px', userSelect: 'none' } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '✖', onClick: () => { clearHighlight(); panel.remove(); mask.remove(); } })
    ]);

    const searchInput = el('input', {
      type: 'text', placeholder: '查找内容...',
      style: { width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none', boxSizing: 'border-box', fontSize: '13px' }
    });

    // ================= 历史记录 =================
    let searchHistory = JSON.parse(localStorage.getItem('kg_search_history') || '[]');
    let historyExpanded = false;
    let historyManageMode = false;
    let selectedHistory = new Set();

    const historyContainer = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    const historyList = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } });

    const renderHistory = () => {
      historyContainer.innerHTML = '';
      if (searchHistory.length === 0) return;

      // 头部：展收控制
      const historyHeader = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-2)', cursor: 'pointer', paddingBottom: '2px', userSelect: 'none' },
        onClick: () => { historyExpanded = !historyExpanded; renderHistory(); }
      }, [
        el('span', { text: `历史记录 (${searchHistory.length})` }),
        el('span', { text: historyExpanded ? '▾' : '▸' })
      ]);
      historyContainer.appendChild(historyHeader);

      // 如果展开了，就渲染列表和管理工具栏
      if (historyExpanded) {
        // 1. 工具栏（管理/全选/删除）
        const hToolbar = el('div', { style: { display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost',
            text: historyManageMode ? '完成' : '管理',
            style: { fontSize: '10px', padding: '0 6px', height: '22px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); historyManageMode = !historyManageMode; selectedHistory.clear(); renderHistory(); }
          }),
          historyManageMode ? el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选',
            style: { fontSize: '10px', padding: '0 6px', height: '22px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); searchHistory.forEach(h => selectedHistory.add(h)); renderHistory(); }
          }) : null,
          historyManageMode ? el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选',
            style: { fontSize: '10px', padding: '0 6px', height: '22px', minHeight: 'auto', background: 'var(--bg)' },
            onClick: (e) => { e.stopPropagation(); selectedHistory.clear(); renderHistory(); }
          }) : null,
          historyManageMode ? el('button', {
            class: 'btn btn-sm btn-danger', text: `删除(${selectedHistory.size})`,
            style: { fontSize: '10px', padding: '0 6px', height: '22px', minHeight: 'auto' },
            onClick: (e) => {
              e.stopPropagation();
              if (selectedHistory.size === 0) return;
              searchHistory = searchHistory.filter(h => !selectedHistory.has(h));
              localStorage.setItem('kg_search_history', JSON.stringify(searchHistory));
              selectedHistory.clear();
              // 如果删完了，退出管理模式
              if (searchHistory.length === 0) historyManageMode = false;
              renderHistory();
            }
          }) : null
        ]);
        historyContainer.appendChild(hToolbar);

        // 2. 标签列表
        historyList.innerHTML = '';
        searchHistory.forEach(kw => {
          const isSel = selectedHistory.has(kw);
          historyList.appendChild(el('span', {
            class: 'tape-chip', text: kw,
            style: {
              fontSize: '11px', padding: '4px 10px', cursor: 'pointer',
              background: isSel ? 'rgba(239,71,111,0.1)' : 'var(--bg)',
              border: isSel ? '1px solid var(--danger)' : '1px solid rgba(0,0,0,.05)',
              color: isSel ? 'var(--danger)' : 'var(--text)',
              borderRadius: '20px'
            },
            onClick: (e) => {
              if (historyManageMode) {
                if (isSel) selectedHistory.delete(kw); else selectedHistory.add(kw);
                renderHistory();
              } else {
                searchInput.value = kw;
                searchIndex = 1;
                doSearch(false);
                // 选完历史后顺便收起列表
                historyExpanded = false;
                renderHistory();
              }
            }
          }));
        });
        historyContainer.appendChild(historyList);
      }
    };

    // ================= 选项配置 =================
    const replaceInput = el('input', {
      type: 'text', placeholder: '替换为...',
      style: { width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none', boxSizing: 'border-box', fontSize: '13px' }
    });

    let targetScope = 'content';
    let isCaseSensitive = false;
    let isWholeWord = false;

    const optionRow = el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', alignItems: 'center' } }, [
      el('label', { style: { cursor: 'pointer', display: 'flex', gap: '4px' } }, [
        el('input', { type: 'checkbox', onChange: (e) => { isCaseSensitive = e.target.checked; doSearch(false); } }), '区分大小写'
      ]),
      el('label', { style: { cursor: 'pointer', display: 'flex', gap: '4px' } }, [
        el('input', { type: 'checkbox', onChange: (e) => { isWholeWord = e.target.checked; doSearch(false); } }), '全词匹配'
      ])
    ]);

    const scopeRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px' } }, [
      el('label', { style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' } }, [
        el('input', { type: 'radio', name: 'search-scope', value: 'content', checked: true, onChange: (e) => { targetScope = e.target.value; renderGlobalList(); } }), '当前内容'
      ]),
      el('label', { style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' } }, [
        el('input', { type: 'radio', name: 'search-scope', value: 'both', onChange: (e) => { targetScope = e.target.value; renderGlobalList(); } }), '内容+解释'
      ]),
      el('label', { style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary-dark)', fontWeight: '600' } }, [
        el('input', { type: 'radio', name: 'search-scope', value: 'global', onChange: (e) => { targetScope = e.target.value; doSearch(false); } }), '🌍 全局资料库'
      ])
    ]);

    // ================= 历史栈 =================
    const undoBtn = el('button', { class: 'btn btn-sm btn-ghost', text: '↶', onClick: () => doUndo(), style: { fontSize: '14px', padding: '2px 6px' } });
    const redoBtn = el('button', { class: 'btn btn-sm btn-ghost', text: '↷', onClick: () => doRedo(), style: { fontSize: '14px', padding: '2px 6px' } });
    let historyStack = [], historyIndex = -1;
    const updateUndoRedoState = () => {
      if (!undoBtn || !redoBtn) return;
      undoBtn.style.opacity = historyIndex > 0 ? '1' : '0.4';
      redoBtn.style.opacity = historyIndex < historyStack.length - 1 ? '1' : '0.4';
    };
    const pushHistory = () => {
      const state = { content: contentInput.tagName === 'TEXTAREA' ? contentInput.value : contentInput.innerHTML, explanation: explainInput.innerHTML };
      if (historyIndex >= 0 && JSON.stringify(historyStack[historyIndex]) === JSON.stringify(state)) return;
      historyStack = historyStack.slice(0, historyIndex + 1);
      historyStack.push(state); historyIndex++;
      if (historyStack.length > 20) { historyStack.shift(); historyIndex--; }
      updateUndoRedoState();
    };
    const applyState = (state) => {
      if (contentInput.tagName === 'TEXTAREA') contentInput.value = state.content; else contentInput.innerHTML = state.content;
      form.content = contentInput.value || contentInput.innerHTML;
      explainInput.innerHTML = state.explanation; form.explanation = state.explanation;
      queueSave();
    };
    const doUndo = () => { if (historyIndex > 0) { historyIndex--; applyState(historyStack[historyIndex]); updateUndoRedoState(); } };
    const doRedo = () => { if (historyIndex < historyStack.length - 1) { historyIndex++; applyState(historyStack[historyIndex]); updateUndoRedoState(); } };
    pushHistory();

    // ================= 核心正则 =================
    let searchIndex = -1, currentMark = null, globalMatches = [];

    const buildRegex = (kw) => {
      let pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (isWholeWord) pattern = `\\b${pattern}\\b`;
      return new RegExp(`(${pattern})`, isCaseSensitive ? 'g' : 'gi');
    };

    const clearHighlight = () => {
      const clean = (domNode) => {
        if (domNode && domNode.isContentEditable) {
          domNode.querySelectorAll('mark.search-highlight').forEach(m => {
            const parent = m.parentNode;
            while (m.firstChild) parent.insertBefore(m.firstChild, m);
            parent.removeChild(m);
          });
        }
      };
      clean(contentInput); clean(explainInput);
      if (contentInput.isContentEditable) form.content = contentInput.innerHTML;
      if (explainInput) form.explanation = explainInput.innerHTML;
      currentMark = null; globalMatches = [];
    };

    const highlightRichText = (domNode, keyword, isAll) => {
      if (!domNode || !domNode.isContentEditable) return 0;
      const regex = buildRegex(keyword);
      const walker = document.createTreeWalker(domNode, NodeFilter.SHOW_TEXT, null, false);
      const textNodes = []; let node;
      while (node = walker.nextNode()) {
        if (regex.test(node.textContent)) { textNodes.push(node); regex.lastIndex = 0; }
      }

      let count = 0;
      textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const parts = text.split(regex);
        if (parts.length > 1) {
          const fragment = document.createDocumentFragment();
          parts.forEach(part => {
            if (regex.test(part) && part.length > 0) {
              count++;
              const shouldHighlight = isAll || (count === searchIndex);
              if (shouldHighlight) {
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.style.cssText = 'background-color: #FFD166; color: #2B2D42; border-radius: 2px; padding: 0 2px; transition: background 0.2s;';
                mark.textContent = part;
                fragment.appendChild(mark);
                if (!isAll && !currentMark) {
                  currentMark = mark;
                  setTimeout(() => { mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); mark.style.backgroundColor = '#FF9F1C'; }, 50);
                }
              } else {
                fragment.appendChild(document.createTextNode(part));
              }
            } else {
              if (part.length > 0) fragment.appendChild(document.createTextNode(part));
            }
          });
          textNode.parentNode.replaceChild(fragment, textNode);
        }
      });
      return count;
    };

    const doSearch = (findAll = false) => {
      const keyword = searchInput.value.trim();
      if (!keyword) return;

      if (findAll) searchIndex = -1;
      clearHighlight();

      if (!searchHistory.includes(keyword)) {
        searchHistory.unshift(keyword);
        searchHistory = searchHistory.slice(0, 10);
        localStorage.setItem('kg_search_history', JSON.stringify(searchHistory));
        renderHistory();
      }

      let totalCount = 0;

      if (targetScope === 'global') {
        const allPoints = store.getPoints();
        const regex = buildRegex(keyword);
        allPoints.forEach(p => {
          if (p.id === params.id) return;
          const contentMatches = (p.content.match(regex) || []).length;
          const expMatches = (p.explanation || '').match(regex) || [];
          if (contentMatches > 0 || expMatches.length > 0) {
            globalMatches.push({ id: p.id, content: p.content, explanation: p.explanation, count: contentMatches + expMatches.length });
            totalCount += contentMatches + expMatches.length;
          }
        });
        renderGlobalList();
        return;
      }

      const highlightSingle = (domNode, isContent) => {
        if (!domNode) return;
        if (isContent && domNode.tagName === 'TEXTAREA') {
          const regex = buildRegex(keyword);
          const matches = domNode.value.match(regex);
          if (matches) {
            totalCount += matches.length;
            if (!findAll && searchIndex === 1) {
              const pos = domNode.value.search(regex);
              if (pos !== -1) { domNode.focus(); domNode.setSelectionRange(pos, pos + keyword.length); }
            }
          }
        } else if (domNode.isContentEditable) {
          totalCount += highlightRichText(domNode, keyword, findAll);
        }
      };

      if (targetScope === 'both') { highlightSingle(contentInput, true); highlightSingle(explainInput, false); }
      else if (targetScope === 'content') { highlightSingle(contentInput, true); }
      else if (targetScope === 'explanation') { highlightSingle(explainInput, false); }

      if (contentInput.isContentEditable) form.content = contentInput.innerHTML;
      if (explainInput) form.explanation = explainInput.innerHTML;

      if (totalCount > 0 && !findAll) {
        toastSuccess(`找到第 ${searchIndex} / ${totalCount} 处`);
      }
    };

    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchIndex = 1; doSearch(false); }, 400);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchIndex = e.shiftKey ? Math.max(1, searchIndex - 1) : searchIndex + 1;
        doSearch(false);
      }
    });

    // ================= 全局结果与操作 =================
    const globalListContainer = el('div', { style: { display: 'none', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', borderTop: '1px dashed rgba(0,0,0,0.1)', paddingTop: '8px' } });
    let selectedGlobalIds = new Set();

    function renderGlobalList() {
      if (targetScope !== 'global' || globalMatches.length === 0) {
        globalListContainer.style.display = 'none';
        return;
      }
      globalListContainer.style.display = 'flex';
      globalListContainer.innerHTML = '';

      globalListContainer.appendChild(el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px', alignItems: 'center' } }, [
        el('span', { text: `找到 ${globalMatches.length} 张卡片:`, style: { fontSize: '12px', fontWeight: '600', flex: '1' } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { fontSize: '11px', padding: '2px 6px' }, onClick: () => { globalMatches.forEach(m => selectedGlobalIds.add(m.id)); renderGlobalList(); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', style: { fontSize: '11px', padding: '2px 6px' }, onClick: () => { selectedGlobalIds.clear(); renderGlobalList(); } }),
        el('button', { class: 'btn btn-sm btn-danger', text: '全部替换', style: { fontSize: '11px', padding: '2px 6px' }, onClick: doReplaceAll })
      ]));

      globalMatches.forEach(m => {
        const isSel = selectedGlobalIds.has(m.id);
        globalListContainer.appendChild(el('label', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', background: isSel ? 'rgba(239,71,111,0.05)' : 'var(--bg)', borderRadius: '6px', cursor: 'pointer' },
          onClick: (e) => { if (e.target.tagName === 'BUTTON') return; if (isSel) selectedGlobalIds.delete(m.id); else selectedGlobalIds.add(m.id); renderGlobalList(); }
        }, [
          el('input', { type: 'checkbox', checked: isSel, style: { pointerEvents: 'none', width: '14px', height: '14px' } }),
          el('div', { style: { flex: '1', overflow: 'hidden' } }, [
            el('div', { text: m.content.replace(/<[^>]+>/g, '').slice(0, 30) + '...', style: { fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
            el('div', { text: `匹配 ${m.count} 处`, style: { fontSize: '10px', color: 'var(--text-2)' } })
          ]),
          el('button', { class: 'btn btn-sm btn-ghost', text: '🚀 前往', style: { flexShrink: '0', padding: '2px 6px', fontSize: '11px' }, onClick: (e) => { e.preventDefault(); e.stopPropagation(); clearHighlight(); panel.remove(); mask.remove(); window.location.hash = `#/edit-point/${m.id}?highlight=${encodeURIComponent(searchInput.value)}`; } })
        ]));
      });
    }

    // ================= 替换逻辑 =================
    const doReplaceCurrent = () => {
      if (targetScope === 'global') return toastError('全局模式下不支持单点替换');
      if (!currentMark) return toastError('请先点击查找定位');
      pushHistory();
      const replacement = replaceInput.value;
      const textNode = document.createTextNode(replacement);
      currentMark.parentNode.replaceChild(textNode, currentMark);
      if (contentInput.isContentEditable && contentInput.contains(textNode)) form.content = contentInput.innerHTML;
      if (explainInput.contains(textNode)) form.explanation = explainInput.innerHTML;
      queueSave();
      toastSuccess('已替换当前处');
      setTimeout(() => { searchIndex++; doSearch(false); }, 100);
    };

    const doReplaceAll = async () => {
      const keyword = searchInput.value.trim();
      const replacement = replaceInput.value;
      if (!keyword) return toastError('请输入查找内容');

      const confirmMsg = targetScope === 'global' ? `确定要在整个资料库中，把「${keyword}」全部替换为「${replacement}」吗？` : `确定要将所有的「${keyword}」替换为「${replacement}」吗？`;
      const confirm = await new Promise(resolve => {
        const cMask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999 } });
        const cBox = el('div', { class: 'confirm-box', style: { maxWidth: '320px', textAlign: 'center' } }, [
          el('h3', { text: '确认替换' }),
          el('p', { text: confirmMsg, style: { whiteSpace: 'pre-wrap', fontSize: '13px' } }),
          el('div', { class: 'confirm-actions', style: { justifyContent: 'center', marginTop: '16px' } }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { cMask.remove(); resolve(false); } }),
            el('button', { class: 'btn btn-danger', text: '确认替换', onClick: () => { cMask.remove(); resolve(true); } })
          ])
        ]);
        cMask.appendChild(cBox); document.body.appendChild(cMask);
      });
      if (!confirm) return;

      const regex = buildRegex(keyword);
      if (targetScope === 'global') {
        let count = 0;
        store.getPoints().forEach(p => {
          if (p.content.includes(keyword) || p.explanation.includes(keyword)) {
            const newContent = p.content.replace(regex, replacement);
            const newExp = (p.explanation || '').replace(regex, replacement);
            store.updatePoint(p.id, { content: newContent, explanation: newExp });
            count++;
          }
        });
        toastSuccess(`全站共更新 ${count} 张卡片`);
        renderGlobalList();
        return;
      }

      clearHighlight();
      pushHistory();

      let replacedCount = 0;
      const replaceText = (html) => {
        if (!html) return html;
        const count = (html.match(regex) || []).length;
        replacedCount += count;
        return html.replace(regex, replacement);
      };

      if (targetScope === 'content' || targetScope === 'both') {
        if (contentInput.tagName === 'TEXTAREA') { contentInput.value = replaceText(contentInput.value); form.content = contentInput.value; }
        else { contentInput.innerHTML = replaceText(contentInput.innerHTML); form.content = contentInput.innerHTML; }
      }
      if (targetScope === 'explanation' || targetScope === 'both') {
        explainInput.innerHTML = replaceText(explainInput.innerHTML);
        form.explanation = explainInput.innerHTML;
      }

      if (replacedCount > 0) { toastSuccess(`成功替换 ${replacedCount} 处`); queueSave(); searchIndex = -1; }
      else { toastError('没有找到可替换的内容'); historyStack.pop(); historyIndex--; updateUndoRedoState(); }
    };

    // ================= 底部按钮组 =================
    const actionRow = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap', borderTop: '1px dashed rgba(0,0,0,0.1)', paddingTop: '8px' } }, [
      el('div', { style: { display: 'flex', gap: '4px' } }, [undoBtn, redoBtn]),
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', flex: '1' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '查找全部', style: { fontSize: '12px', padding: '4px 8px' }, onClick: () => { searchIndex = -1; doSearch(true); } }),
        el('button', { class: 'btn btn-sm btn-primary', text: '下一处', style: { fontSize: '12px', padding: '4px 8px' }, onClick: () => { searchIndex++; doSearch(false); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '替换', style: { fontSize: '12px', padding: '4px 8px', color: 'var(--primary-dark)' }, onClick: doReplaceCurrent }),
        el('button', { class: 'btn btn-sm btn-danger', text: '全部替换', style: { fontSize: '12px', padding: '4px 8px' }, onClick: doReplaceAll }),
      ])
    ]);

    // 组装面板
    panel.appendChild(header);
    panel.appendChild(scopeRow);
    panel.appendChild(optionRow);
    panel.appendChild(searchInput);
    renderHistory(); // 渲染历史
    panel.appendChild(historyContainer);
    panel.appendChild(replaceInput);
    panel.appendChild(globalListContainer); // 全局列表容器
    panel.appendChild(actionRow);

    document.body.appendChild(mask);
    document.body.appendChild(panel);

    setTimeout(() => {
      const rect = panel.getBoundingClientRect();
      panelX = (window.innerWidth - rect.width) / 2; panelY = 100;
      panel.style.transform = `translate(${panelX}px, ${panelY}px)`;
      searchInput.focus();
    }, 10);
  }

  //显示来自 PDF 的反向链接
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
  let isImgRendered = false; //记录是否已经渲染过内容
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
    el('button', {
      class: 'btn btn-ghost',
      text: '📸 生成分享图/PDF',
      style: { flex: '0 1 auto', padding: '0 12px', color: 'var(--primary-dark)' },
      onClick: async () => {
        if (!form.content.trim()) {
          toastError('内容为空，无法生成');
          return;
        }

        toastSuccess('正在组装图文附件，请稍候...');

        try {
          let imagesHtml = '';
          const currentPoint = !isNew ? store.getPoint(params.id) : null;
          const imageIds = currentPoint && currentPoint.imageIds ? currentPoint.imageIds : [];

          if (imageIds.length > 0) {
            const { dbGet } = await import('../db.js');
            for (const id of imageIds) {
              const rec = await dbGet('images', id);
              if (rec && (rec.annotatedBlob || rec.originalBlob)) {
                const blob = rec.annotatedBlob || rec.originalBlob;
                const base64 = await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                });
                imagesHtml += `<div class="img-box"><img src="${base64}" crossorigin="anonymous"></div>`;
              }
            }
          }

          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = form.explanation || '';
          const plainExplanation = tempDiv.textContent || tempDiv.innerText || '';

          // 创建一个隐藏的 DOM 作为渲染源
          const renderBox = document.createElement('div');
          renderBox.style.position = 'fixed';
          renderBox.style.left = '-9999px';
          renderBox.style.top = '0';
          renderBox.innerHTML = `
            <div class="share-card" id="print-target-box" style="width: 600px; background: linear-gradient(135deg, #FAFAFB 0%, #F0F5E9 100%); border: 2px solid #B5E48C; border-radius: 12px; padding: 30px; box-sizing: border-box; font-family: sans-serif; color: #2B2D42;">
              <div style="font-size: 20px; font-weight: 900; margin-bottom: 8px; border-bottom: 2px solid #8ECAE6; padding-bottom: 12px;">📚 知识卡片</div>
              <div style="font-size: 18px; font-weight: bold; line-height: 1.6; margin: 20px 0; white-space: pre-wrap;">${form.content.trim()}</div>
              ${plainExplanation ? `<div style="font-size: 15px; color: #5C667A; background: rgba(255,255,255,0.8); padding: 16px; border-radius: 8px; border-left: 4px solid #FFB5A7; line-height: 1.6; white-space: pre-wrap;">${plainExplanation}</div>` : ''}
              <div class="images-container">${imagesHtml}</div>
              <div style="margin-top: 30px; text-align: right; font-size: 12px; color: #8D99AE;">- 来自个人专属复习系统 -</div>
            </div>
          `;
          document.body.appendChild(renderBox);

          //等待所有图片加载完毕
          const imgs = renderBox.querySelectorAll('img');
          await Promise.all(Array.from(imgs).map(img => {
            return new Promise(resolve => {
              if (img.complete) resolve();
              else {
                img.onload = resolve;
                img.onerror = resolve;
              }
            });
          }));

          // 等待浏览器渲染一帧
          await new Promise(r => setTimeout(r, 100));

          // 弹出选择面板
          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
          const box = el('div', { class: 'confirm-box', style: { textAlign: 'center', padding: '20px' } }, [
            el('h3', { text: '选择导出格式', style: { marginBottom: '20px' } }),
            el('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center' } }, [
              el('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center', width: '100%' } }, [
                el('button', {
                  class: 'btn btn-primary',
                  text: '保存为图片 (PNG)',
                  style: { flex: '1', padding: '12px 0', fontSize: '14px', borderRadius: '8px' },
                  onClick: async () => {
                    mask.remove();
                    if (typeof window.html2canvas === 'undefined') {
                      toastError('图片库未加载，请检查网络');
                      return;
                    }
                    try {
                      const canvas = await window.html2canvas(renderBox.firstElementChild, { scale: 2 });
                      canvas.toBlob(async (blob) => {
                        const fileName = `知识卡片_${new Date().getTime()}.png`;
                        if (window.showSaveFilePicker) {
                          try {
                            const handle = await window.showSaveFilePicker({
                              suggestedName: fileName,
                              types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }]
                            });
                            const writable = await handle.createWritable();
                            await writable.write(blob);
                            await writable.close();
                            toastSuccess('图片已保存');
                          } catch (e) {
                            if (e.name !== 'AbortError') toastError('保存失败：' + e.message);
                          }
                        } else {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = fileName;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                          toastSuccess('图片已下载');
                        }
                        document.body.removeChild(renderBox);
                      }, 'image/png');
                    } catch (err) {
                      toastError('生成图片失败：' + err.message);
                    }
                  }
                }),

                el('button', {
                  class: 'btn btn-ghost',
                  text: '保存为 PDF',
                  style: { flex: '1', padding: '12px 0', fontSize: '14px', borderRadius: '8px', background: 'var(--bg)', border: '1px solid rgba(0,0,0,.1)' },
                  onClick: () => {
                    mask.remove();
                    if (typeof window.html2pdf === 'undefined') {
                      toastError('PDF 库未加载，请检查网络');
                      return;
                    }

                    toastSuccess('正在生成 PDF，请稍候...');

                    //拦截生成结果，转为 Blob 后用原生 API 选路径
                    window.html2pdf().set({
                      margin: 10,
                      filename: `知识卡片_${new Date().getTime()}.pdf`,
                      image: { type: 'jpeg', quality: 0.98 },
                      html2canvas: { scale: 2, useCORS: true },
                      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                    }).from(renderBox.firstElementChild).outputPdf('blob')
                      .then(async (pdfBlob) => {
                        const fileName = `知识卡片_${new Date().getTime()}.pdf`;

                        if (window.showSaveFilePicker) {
                          try {
                            const handle = await window.showSaveFilePicker({
                              suggestedName: fileName,
                              types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }]
                            });
                            const writable = await handle.createWritable();
                            await writable.write(pdfBlob);
                            await writable.close();
                            toastSuccess('PDF 已保存');
                          } catch (e) {
                            if (e.name !== 'AbortError') toastError('保存失败：' + e.message);
                          }
                        } else {
                          // 如果浏览器不支持原生另存为，退回默认下载
                          const url = URL.createObjectURL(pdfBlob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = fileName;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                          toastSuccess('PDF 已下载');
                        }
                        document.body.removeChild(renderBox);
                      })
                      .catch((err) => {
                        toastError('生成失败：' + err.message);
                        document.body.removeChild(renderBox);
                      });
                  }
                })
              ]),
            ]),
            el('button', { class: 'btn btn-sm btn-ghost', text: '取消', style: { marginTop: '16px', width: '100%' }, onClick: () => { mask.remove(); document.body.removeChild(renderBox); } })
          ]);
          mask.appendChild(box);
          document.body.appendChild(mask);

        } catch (err) {
          console.error(err);
          toastError('生成失败：' + err.message);
        }
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => goBack() }),
    el('button', { class: 'btn btn-primary', text: '保存', onClick: () => doSave() }),
  ]));

  async function doSave() {
    // 对于富文本，content 依然可以是纯文本，但 explanation 是 HTML
    if (!form.content.trim()) { setStatus('请填写内容', 'failed'); contentInput.focus(); return; }

    // 直接从 DOM 读取勾选框状态，不依赖 form 缓存
    const diffCheckbox = document.querySelector('input[type="checkbox"][data-key="showDiff"]');
    const countCheckbox = document.querySelector('input[type="checkbox"][data-key="showCount"]');

    const finalShowDiff = diffCheckbox ? diffCheckbox.checked : false;
    const finalShowCount = countCheckbox ? countCheckbox.checked : false;

    // 简单清洗一下富文本里的垃圾标签
    // 强行从 DOM 抓取最新的内容，防止 onInput 偶尔失灵
    if (explainInput) {
      form.explanation = explainInput.innerHTML;
    }
    let cleanExplanation = form.explanation || '';

    //保存时，把可视化的公式节点洗回纯文本的 $...$ 格式
    cleanExplanation = cleanExplanation.replace(/<span class="math-node"[^>]*data-latex="([^"]+)"[^>]*>.*?<\/span>/g, (match, latex) => {
      // 把转义的引号还原
      const decodedLatex = latex.replace(/&quot;/g, '"');
      return ` $${decodedLatex}$ `;
    });

    // 将 <img> 标签里的 blob 链接转为 Base64，防止刷新后图片丢失
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
    let match;
    while ((match = imgRegex.exec(cleanExplanation)) !== null) {
      const src = match[1];
      // 如果已经是 base64 或者 http 链接，就跳过
      if (!src.startsWith('blob:')) continue;

      try {
        // 从我们刚才存的 blob url 提取出 Blob
        const blob = await fetch(src).then(r => r.blob());
        // 转成 Base64
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        // 替换 HTML 中的 blob 链接
        cleanExplanation = cleanExplanation.replace(src, base64);
      } catch (e) {
        console.warn('图片转 Base64 失败', e);
      }
    }

    //提取纯背景色，存入独立字段（不再包裹 div 造成视觉套娃）
    const currentBg = explainInput.style.backgroundColor;
    const finalBg = (currentBg && currentBg !== 'var(--card)' && currentBg !== 'transparent' && currentBg !== 'rgba(0, 0, 0, 0)') ? currentBg : '';

    if (isNew) {
      store.createPoint({
        chapterId: chapterId,
        content: form.content.trim(),
        explanation: cleanExplanation, //保存纯净的富文本 HTML
        themeBg: finalBg,              //独立保存主题背景色
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
        explanation: cleanExplanation, //保存纯净的富文本 HTML
        themeBg: finalBg,              //独立保存主题背景色
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

    //主动释放本页的 document 级监听与面板
    if (window.__editPointAbort) {
      window.__editPointAbort.abort();
      window.__editPointAbort = null;
    }
    document.querySelectorAll('.edit-point-panel').forEach(p => p.remove());

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
    if (!isDraftResolved && hasChanges(original, form)) {
      saveDraft('point', entityId, form);
    }

    //主动释放本页的 document 级监听与面板
    if (window.__editPointAbort) {
      window.__editPointAbort.abort();
      window.__editPointAbort = null;
    }
    document.querySelectorAll('.edit-point-panel').forEach(p => p.remove());

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

  //强行绑定左上角返回按钮
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.onclick = (e) => {
      if (e) e.preventDefault();
      goBack();
    };
    btnBack.style.pointerEvents = 'auto';
    btnBack.style.zIndex = '9999';
  }

  // ============ 连接管理弹窗（包含批量操作） ============
  function openConnectionManager(point) {
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
    const box = el('div', { class: 'confirm-box', style: { maxWidth: '600px', width: '95%', padding: '20px' } });

    // 1. 获取关系数据
    const allPoints = store.getPoints();
    const allTasks = store.getTasks();

    //统一解析出链：同时匹配纯文本和带有 data-link 的 span
    const explanationHtml = point.explanation || '';
    const outLinks = [];
    // 匹配出 span 里的 data-link 属性，或者纯文本的 [[...]]
    const regex = /data-link="\[\[(folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\]"|\[\[(folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\]/g;
    let match;
    while ((match = regex.exec(explanationHtml)) !== null) {
      // 如果是匹配到了 span 属性（match[1]存在），否则是纯文本（match[4]存在）
      const type = match[1] || match[4];
      const id = match[2] || match[5];
      const name = match[3] || match[6];
      outLinks.push({ type, id, name });
    }
    // 去重
    const uniqueOutLinks = Array.from(new Set(outLinks.map(l => l.id))).map(id => outLinks.find(l => l.id === id));

    //获取入链：找所有说明里包含当前卡片 ID 的其他卡片
    const inLinks = allPoints.filter(p => p.id !== point.id && p.explanation && p.explanation.includes(`:${point.id}:`));

    // ================= 渲染出链列表带管理 =================
    let selectedOutIds = new Set();
    const outlistContainer = el('div', { class: 'outlist-container' });

    const renderOutList = () => {
      outlistContainer.innerHTML = '';
      const wrap = el('div');

      //工具栏：全选/全不选/删除/复制/粘贴
      const toolbar = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => {
            uniqueOutLinks.forEach(l => selectedOutIds.add(l.id));
            renderOutList();
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => {
            selectedOutIds.clear();
            renderOutList();
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-danger', text: `删除(${selectedOutIds.size})`, onClick: () => {
            if (selectedOutIds.size === 0) return;
            let newHtml = point.explanation || '';

            selectedOutIds.forEach(id => {
              const raw = `\\[\\[(?:folder|point):${id}:[^\\]]+\\]\\]`;
              //扒掉 span 的外壳，保留里面的文字
              const spanRegex = new RegExp(`<span class="editor-link"[^>]*data-link="${raw}"[^>]*>(.*?)<\\/span>`, 'g');
              newHtml = newHtml.replace(spanRegex, '$1');

              // 清理纯文本
              const textRegex = new RegExp(raw, 'g');
              newHtml = newHtml.replace(textRegex, '');
            });

            store.updatePoint(point.id, { explanation: newHtml });
            toastSuccess('批量删除成功');
            mask.remove();
            renderEditPoint({ params, query });
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '复制', onClick: () => {
            if (selectedOutIds.size === 0) return toastError('请先勾选要复制的连接');
            const copyData = uniqueOutLinks.filter(l => selectedOutIds.has(l.id));
            localStorage.setItem('kg_clipboard_links', JSON.stringify(copyData));
            toastSuccess('已复制选中连接');
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '粘贴', onClick: () => {
            const raw = localStorage.getItem('kg_clipboard_links');
            if (!raw) return toastError('剪贴板为空');
            const copyData = JSON.parse(raw);
            let newHtml = point.explanation || '';
            copyData.forEach(l => {
              const str = `[[${l.type}:${l.id}:${l.name}]]`;
              if (!newHtml.includes(str)) {
                newHtml += `<br>关联：${str}`;
              }
            });
            store.updatePoint(point.id, { explanation: newHtml });
            toastSuccess('粘贴成功');
            mask.remove();
            renderEditPoint({ params, query });
          }
        })
      ]);
      wrap.appendChild(toolbar);

      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' } });
      if (uniqueOutLinks.length === 0) {
        list.appendChild(el('div', { text: '暂无出链', style: { fontSize: '13px', color: '#999' } }));
      }

      uniqueOutLinks.forEach(l => {
        const isSel = selectedOutIds.has(l.id);
        list.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', background: isSel ? 'rgba(142,202,230,0.2)' : 'var(--bg)', padding: '8px', borderRadius: '6px', border: '1px solid ' + (isSel ? 'var(--primary)' : 'transparent') } }, [
          el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }, onClick: () => {
              if (isSel) selectedOutIds.delete(l.id); else selectedOutIds.add(l.id);
              renderOutList();
            }
          }, [
            el('input', { type: 'checkbox', checked: isSel, style: { pointerEvents: 'none' } }),
            el('span', { text: (l.type === 'folder' ? '📁 ' : '📄 ') + l.name, style: { fontSize: '13px' } })
          ]),
          el('div', { style: { display: 'flex', gap: '4px' } }, [
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '🔦 高亮',
              //改用 onMouseDown
              onMouseDown: (e) => { e.preventDefault(); e.stopPropagation(); if (window.flashLink) window.flashLink(l.id, true); },
              onMouseUp: (e) => { e.preventDefault(); if (window.flashLink) window.flashLink(l.id, false); },
              onMouseLeave: () => { if (window.flashLink) window.flashLink(l.id, false); }
            }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '前往',
              onMouseDown: (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = l.type === 'folder' ? `#/chapter/${l.id}` : `#/edit-point/${l.id}`;

                mask.remove();
                if (window.location.hash === url) {
                  toastSuccess('你目前就在这个页面中');
                  if (window.flashLink) {
                    window.flashLink(l.id, true);
                    setTimeout(() => window.flashLink(l.id, false), 1500);
                  }
                  return;
                }
                window.location.hash = url;
              }
            }),
            el('button', {
              class: 'btn btn-sm btn-danger', text: '删',
              onMouseDown: (e) => {
                e.preventDefault(); e.stopPropagation();
                const raw = `[[${l.type}:${l.id}:${l.name}]]`;
                let newHtml = point.explanation || '';

                // 匹配带 span 的，脱壳保留文字
                const spanRegex = new RegExp(`<span class="editor-link"[^>]*data-link="${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>(.*?)<\\/span>`, 'g');
                newHtml = newHtml.replace(spanRegex, '$1');

                // 匹配纯文本，直接删掉
                newHtml = newHtml.replace(raw, '');

                store.updatePoint(point.id, { explanation: newHtml });
                mask.remove();
                toastSuccess('已删除出链');
                renderEditPoint({ params, query });
              }
            })
          ])
        ]));
      });

      wrap.appendChild(list);
      outlistContainer.appendChild(wrap);
    };

    renderOutList();

    // ================= 渲染入链列表 =================
    const renderInList = () => {
      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      if (inLinks.length === 0) list.appendChild(el('div', { text: '暂无入链（没人链接到这里）', style: { fontSize: '13px', color: '#999' } }));

      inLinks.forEach(p => {
        list.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', background: 'var(--bg)', padding: '8px', borderRadius: '6px' } }, [
          el('span', { text: '📄 ' + (p.content.substring(0, 20) || '未命名'), style: { fontSize: '13px' } }),
          el('div', { style: { display: 'flex', gap: '4px' } }, [
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '🔦 高亮',
              //改用 onMouseDown 防止焦点丢失，同时高亮 point.id（当前卡片）
              onMouseDown: (e) => { e.preventDefault(); e.stopPropagation(); if (window.flashLink) window.flashLink(point.id, true); },
              onMouseUp: (e) => { e.preventDefault(); if (window.flashLink) window.flashLink(point.id, false); },
              onMouseLeave: () => { if (window.flashLink) window.flashLink(point.id, false); }
            }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '前往',
              onMouseDown: (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = `#/edit-point/${p.id}`;

                mask.remove();
                if (window.location.hash === url) {
                  toastSuccess('你目前就在这个页面中');
                  if (window.flashLink) {
                    window.flashLink(point.id, true); // 高亮当前卡片
                    setTimeout(() => window.flashLink(point.id, false), 1500);
                  }
                  return;
                }
                window.location.hash = url;
              }
            })
          ])
        ]));
      });
      return list;
    };

    // ================= 创建新连接搜索框 =================
    const searchInput = el('input', { placeholder: '搜索要连接的卡片或文件夹（点击结果即可创建）...', style: { width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '6px', marginBottom: '8px' } });
    const createList = el('div', { style: { maxHeight: '150px', overflowY: 'auto', display: 'none', background: 'var(--card)', border: '1px solid #ccc', borderRadius: '6px', position: 'absolute', zIndex: 10, width: 'calc(100% - 40px)' } });

    const allItems = [
      ...allTasks.map(t => ({ id: t.id, name: t.name, type: 'folder' })),
      ...allPoints.filter(p => p.id !== point.id).map(p => ({ id: p.id, name: p.content.substring(0, 20), type: 'point' }))
    ];

    searchInput.oninput = (e) => {
      const kw = e.target.value;
      if (!kw) { createList.style.display = 'none'; return; }
      createList.style.display = 'block';
      createList.innerHTML = '';
      const filtered = allItems.filter(item => item.name.includes(kw)).slice(0, 10);
      filtered.forEach(item => {
        createList.appendChild(el('div', {
          style: { padding: '8px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid rgba(0,0,0,0.05)' },
          onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(142,202,230,0.2)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
          onClick: () => {
            //点击搜索结果时：直接追加到编辑器末尾，并同步保存
            const raw = `[[${item.type}:${item.id}:${item.name}]]`;
            const newHtml = (explainInput.innerHTML || '') + `<br>关联：<span class="editor-link" data-link="${raw}" style="color: #5C6BC0; font-weight: 500; cursor: pointer;">${item.name}</span>&nbsp;`;

            explainInput.innerHTML = newHtml;
            form.explanation = newHtml;
            store.updatePoint(point.id, { explanation: newHtml }); // 存进数据库

            toastSuccess('关联已追加到卡片末尾');
            mask.remove();
            renderEditPoint({ params, query }); // 刷新页面刷新列表
          }
        }, [el('span', { text: (item.type === 'folder' ? '📁 ' : '📄 ') + item.name })]));
      });
    };

    // ================= 组装 Box =================
    box.appendChild(el('h3', { text: '🔗 双向连接管理', style: { marginBottom: '16px' } }));

    box.appendChild(el('div', { style: { position: 'relative', marginBottom: '16px' } }, [
      el('div', { text: '创建一个新的连接（将添加到末尾）：', style: { fontSize: '12px', color: 'var(--primary-dark)', marginBottom: '4px' } }),
      searchInput,
      createList
    ]));

    box.appendChild(el('h4', { text: '本卡片关联出去的（出链）', style: { fontSize: '14px', marginBottom: '8px', color: 'var(--primary-dark)' } }));
    box.appendChild(outlistContainer);

    box.appendChild(el('h4', { text: '关联到本卡片的（入链）', style: { fontSize: '14px', marginBottom: '8px', color: 'var(--accent)' } }));
    box.appendChild(renderInList());

    box.appendChild(el('button', { class: 'btn btn-ghost', text: '关闭', style: { width: '100%', marginTop: '16px' }, onClick: () => mask.remove() }));

    mask.appendChild(box);
    document.body.appendChild(mask);
  }
}

// ============ 辅助函数（放在 generateShareImage 下方） ============
function getWrapLines(ctx, text, maxWidth) {
  const words = text.split('');
  let lines = [];
  let currentLine = '';
  for (let n = 0; n < words.length; n++) {
    const testLine = currentLine + words[n];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(currentLine);
      currentLine = words[n];
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  return lines;
}

// ============ 辅助函数：圆角矩形 ============
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof radius === 'number') {
    radius = { tl: radius, tr: radius, br: radius, bl: radius };
  } else {
    radius = Object.assign({ tl: 0, tr: 0, br: 0, bl: 0 }, radius);
  }
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
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

        // 把 '默认子模块' 改成 '📁'，这样界面上就像是一个图标，不再显示文字
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

