import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { dbPut } from '../db.js';

// 全局变量，防止重复解析
let isImporting = false;

// 选择导入方式
export function globalImportDocModal() {
  if (isImporting) return toastError('正在导入中，请稍候...');

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '440px' } }, [
      el('h3', { text: '📄 文档导入 / 批量解析' }),
      el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择导入模式：' }),

      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        // 直接批量解析
        el('button', {
          class: 'btn btn-primary', text: '⁂ 一键批量解析文本 (从 Excel/Word 复制)',
          onClick: () => {
            mask.remove();
            openDirectBatchParser();
          }
        }),

        el('button', {
          class: 'btn btn-ghost', text: '📑 智能解析大纲（导入文件）',
          onClick: () => {
            mask.remove();
            uploadFile(true);
          }
        }),

        el('button', {
          class: 'btn btn-ghost', text: '📄 全部作为纯知识点（导入文件到现有章节）',
          onClick: () => {
            mask.remove();
            chooseTargetChapter(false, (chapterId) => uploadFile(false, chapterId));
          }
        }),
      ]),
      el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
      ])
    ])
  ]);
  document.body.appendChild(mask);
}

// 创建带进度的等待遮罩
function createLoadingMask(title) {
  const textEl = el('div', { style: { marginTop: '12px', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }, text: title });
  const subTextEl = el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' }, text: '请勿关闭页面...' });
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, flexDirection: 'column' } }, [
    el('div', { style: { background: 'var(--card)', padding: '24px', borderRadius: '16px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center' } }, [
      el('div', { style: { fontSize: '32px', animation: 'spin 1s linear infinite' }, text: '⚙️' }),
      textEl,
      subTextEl
    ])
  ]);
  document.body.appendChild(mask);
  return {
    update: (msg) => { textEl.textContent = msg; },
    close: () => { mask.remove(); }
  };
}

// 智能解析纯文本大纲
async function parseOutlineToDB(text, onProgress) {
  let currentTask = null;
  let currentChapter = null;
  let countT = 0, countC = 0, countP = 0;

  // 正则匹配（兼容旧版 # 和新版 ## 章节：）
  const taskRegex = /^(#\s+|##\s+章节[：:]\s*)(.+)$/;
  const chapterRegex = /^(##\s+|###\s+知识点[：:]\s*)(.+)$/;
  const explanationRegex = /^(解释|解析)[：:]\s*(.*)$/;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // 检查是否是任务
    const taskMatch = line.match(taskRegex);
    if (taskMatch) {
      const name = taskMatch[2].trim();
      currentTask = store.createTask({ name });
      countT++;
      currentChapter = null;
      if (onProgress) onProgress(`正在创建任务：${name}`);
      continue;
    }

    // 检查是否是章节
    const chapterMatch = line.match(chapterRegex);
    if (chapterMatch) {
      const name = chapterMatch[2].trim();
      if (!currentTask) { currentTask = store.createTask({ name: '默认导入任务' }); countT++; }
      currentChapter = store.createChapter({ taskId: currentTask.id, name });
      countC++;
      if (onProgress) onProgress(`正在创建章节：${name}`);
      continue;
    }

    // 普通知识点（支持 - 或 1. 或纯文本）
    if (!currentTask) { currentTask = store.createTask({ name: '默认导入任务' }); countT++; }
    if (!currentChapter) { currentChapter = store.createChapter({ taskId: currentTask.id, name: '默认导入章节' }); countC++; }

    let content = line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '');
    let explanation = '';

    // 检查是否是解释（如果下一行有解释）
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const expMatch = nextLine.match(explanationRegex);
      if (expMatch) {
        explanation = expMatch[2].trim();
        i++; // 跳过下一行
      }
    }

    if (content) {
      store.createPoint({ chapterId: currentChapter.id, content, explanation });
      countP++;
      if (countP % 10 === 0 && onProgress) onProgress(`已处理 ${countP} 个知识点...`);
    }
  }
  return { countT, countC, countP };
}

// 读取文件
function uploadFile(isOutline, targetChapterId = null) {
  if (isImporting) return;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,.md,.docx';
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    isImporting = true;

    const loading = createLoadingMask('正在读取文件...');

    try {
      if (file.name.endsWith('.docx')) {
        if (!window.mammoth) { toastError('Word解析库未加载，请刷新页面'); return; }
        loading.update('正在解析 Word 文档（图文精准匹配）…');
        const arrayBuffer = await file.arrayBuffer();

        const result = await window.mammoth.convertToHtml({ arrayBuffer }, {
          convertImage: window.mammoth.images.imgElement(function (image) {
            return image.read("base64").then(function (imageBuffer) {
              return { src: "data:" + image.contentType + ";base64," + imageBuffer };
            });
          })
        });

        const html = result.value;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        let currentTask = null;
        let currentChapter = null;
        let countT = 0, countC = 0, countP = 0, countImg = 0;
        const nodes = Array.from(doc.body.children);

        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const tag = node.tagName.toLowerCase();
          const text = node.textContent.trim();
          const imgs = Array.from(node.querySelectorAll('img'));

          if (i % 10 === 0) loading.update(`正在解析第 ${i + 1} / ${nodes.length} 个段落...`);

          if (isOutline && (tag === 'h1' || tag === 'h2')) {
            if (tag === 'h1') {
              currentTask = store.createTask({ name: text || '默认导入任务' });
              countT++;
              currentChapter = null;
            } else if (tag === 'h2') {
              if (!currentTask) { currentTask = store.createTask({ name: '默认导入任务' }); countT++; }
              currentChapter = store.createChapter({ taskId: currentTask.id, name: text || '默认导入章节' });
              countC++;
            }
            continue;
          }

          if (text || imgs.length > 0) {
            if (!currentTask) { currentTask = store.createTask({ name: '默认导入任务' }); countT++; }
            if (!currentChapter) { currentChapter = store.createChapter({ taskId: currentTask.id, name: '默认导入章节' }); countC++; }

            const imageIds = [];
            for (const img of imgs) {
              const src = img.getAttribute('src');
              if (!src || !src.startsWith('data:image')) continue;
              const base64Data = src.split(',')[1];
              const mimeMatch = src.match(/data:([^;]+);/);
              const mime = mimeMatch ? mimeMatch[1] : 'image/png';
              const byteCharacters = atob(base64Data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let j = 0; j < byteCharacters.length; j++) {
                byteNumbers[j] = byteCharacters.charCodeAt(j);
              }
              const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });

              const imgId = crypto.randomUUID();
              const imgObj = new Image();
              imgObj.src = src;
              await new Promise(r => { imgObj.onload = r; imgObj.onerror = r; });

              await dbPut('images', {
                id: imgId,
                originalBlob: blob,
                annotatedBlob: blob,
                width: imgObj.width || 800,
                height: imgObj.height || 600,
                dpr: window.devicePixelRatio || 1,
                source: 'upload',
                createdAt: new Date().toISOString(),
              });
              imageIds.push(imgId);
              countImg++;
            }

            const point = store.createPoint({
              chapterId: currentChapter.id,
              content: text || `【图片附件】`
            });
            countP++;

            if (imageIds.length > 0) {
              store.updatePoint(point.id, { imageIds });
            }
          }
        }

        loading.close();
        toastSuccess(`导入完成！生成 ${countT} 任务，${countC} 章节，${countP} 知识点，${countImg} 张图片！`);
        setTimeout(() => location.reload(), 1500);
      } else {
        const text = await file.text();
        if (isOutline) {
          const res = await parseOutlineToDB(text, (msg) => loading.update(msg));
          loading.close();
          toastSuccess(`成功导入 ${res.countT} 个任务，${res.countC} 个章节，${res.countP} 个知识点`);
          setTimeout(() => location.reload(), 1000);
        } else {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length === 0) { loading.close(); toastError('文档为空'); return; }
          loading.update(`正在批量创建 ${lines.length} 个知识点...`);

          lines.forEach((content, idx) => {
            store.createPoint({ chapterId: targetChapterId, content });
            if (idx % 20 === 0) loading.update(`已处理 ${idx} / ${lines.length} 个...`);
          });

          loading.close();
          toastSuccess(`成功导入 ${lines.length} 个知识点`);
          setTimeout(() => location.reload(), 1000);
        }
      }
    } catch (err) {
      loading.close();
      console.error(err);
      toastError('读取失败：' + err.message);
    } finally {
      isImporting = false;
    }
  };
  fileInput.click();
}

// 选章节弹窗
function chooseTargetChapter(taskOnly, callback) {
  const tasks = store.getTasks();
  if (tasks.length === 0) { toastError('还没有任何任务，请先创建任务'); return; }

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '400px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' } }, [
      el('h3', { text: '选择导入到的章节' }),
      el('div', { style: { maxHeight: '50vh', overflowY: 'auto', margin: '8px 0' } },
        tasks.map(t => el('div', { style: { marginBottom: '10px' } }, [
          el('div', { style: { fontWeight: '600', fontSize: '14px', color: 'var(--primary-dark)', marginBottom: '4px', padding: '4px 8px', background: 'rgba(142,202,230,.1)', borderRadius: '4px' }, text: t.name }),
          (store.getChapters(t.id).length === 0
            ? [el('div', { style: { fontSize: '12px', color: 'var(--text-2)', padding: '4px 12px' }, text: '（无章节）' })]
            : store.getChapters(t.id).map(c => el('div', {
              style: { padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', marginBottom: '4px', fontSize: '13px', marginLeft: '8px' },
              text: `📄 ${c.name}`,
              onClick: () => { mask.remove(); callback(c.id); }
            }))
          )
        ]))
      ),
      el('div', { class: 'confirm-actions' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
      ])
    ])
  ]);
  document.body.appendChild(mask);
}

//把旧的调用名，自动转发给新的独立批量导入模块
export { batchImportModal as globalBatchImportModal } from './batchImport.js';

// ============ 通用：选择目标文件夹（支持粘贴、移动、嵌套新建） ============
export function showPasteOptionsModal(onConfirm, defaultChapterId, defaultTaskId, actionText = '粘贴') {
  let targetMode = (defaultChapterId || defaultTaskId) ? 'current' : 'other';
  let selectedOtherChapterId = null;
  let selectedOtherTaskId = null;
  let selectedOtherTaskName = '';

  let newFolderName = '';
  let newFolderParentTaskId = null;
  let newFolderParentTaskName = '根目录';

  const targetSection = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' } });

  const renderTargetOptions = () => {
    targetSection.innerHTML = '';

    // 1. 当前层级 / 根目录
    if (defaultChapterId || defaultTaskId) {
      targetSection.appendChild(el('div', {
        style: { padding: '12px', background: targetMode === 'current' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'current' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
        onClick: () => { targetMode = 'current'; renderTargetOptions(); }
      }, [
        el('input', { type: 'radio', checked: targetMode === 'current', style: { width: '18px', height: '18px' }, readOnly: true }),
        el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: `${actionText}到当前文件夹` })
      ]));
    } else {
      targetSection.appendChild(el('div', {
        style: { padding: '12px', background: targetMode === 'current' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'current' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
        onClick: () => { targetMode = 'current'; renderTargetOptions(); }
      }, [
        el('input', { type: 'radio', checked: targetMode === 'current', style: { width: '18px', height: '18px' }, readOnly: true }),
        el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: `${actionText}到当前根目录` })
      ]));
    }

    // 2. 其他文件夹
    targetSection.appendChild(el('div', {
      style: { padding: '12px', background: targetMode === 'other' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'other' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' },
      onClick: (e) => { if (e.target.tagName === 'BUTTON') return; targetMode = 'other'; renderTargetOptions(); }
    }, [
      el('input', { type: 'radio', checked: targetMode === 'other', style: { width: '18px', height: '18px' }, readOnly: true }),
      el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '120px' } }, [
        el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: `📂 ${actionText}到其他文件夹` }),
        targetMode === 'other' ? el('span', { style: { fontSize: '11px', color: selectedOtherTaskId ? 'var(--primary-dark)' : 'var(--danger)' }, text: selectedOtherTaskId ? `✅ 已选：${selectedOtherTaskName}` : '⚠️ 请点击右侧按钮选择' }) : null
      ]),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🔍 选择',
        onClick: (e) => {
          e.stopPropagation();
          const tasks = store.getTasks();
          if (tasks.length === 0) return toastError('还没有创建文件夹');

          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
          const list = el('div', { style: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });

          tasks.forEach(t => {
            // 过滤掉无效的卡片作为文件夹
            if (!t || t.type === 'point') return;

            list.appendChild(el('div', {
              style: { fontWeight: '600', fontSize: '13px', padding: '8px 12px', background: 'rgba(142,202,230,.1)', borderRadius: '6px', cursor: 'pointer', marginTop: '4px' },
              text: `📁 ${t.name}`,
              onClick: () => {
                const chapters = store.getChapters(t.id);
                if (chapters.length > 0) { selectedOtherChapterId = chapters[0].id; }
                else { selectedOtherChapterId = store.createChapter({ taskId: t.id, name: t.name }).id; }
                selectedOtherTaskId = t.id;
                selectedOtherTaskName = t.name;
                targetMode = 'other'; mask.remove(); renderTargetOptions();
              }
            }));
          });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
            el('h3', { text: '选择目标文件夹' }), list,
            el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })])
          ]);
          mask.appendChild(box); document.body.appendChild(mask);
        }
      })
    ]));

    // 3. 新建文件夹
    targetSection.appendChild(el('div', {
      style: { padding: '12px', background: targetMode === 'new' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'new' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px' },
      onClick: (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        targetMode = 'new'; renderTargetOptions();
      }
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        el('input', { type: 'radio', checked: targetMode === 'new', style: { width: '18px', height: '18px' }, readOnly: true }),
        el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: `➕ 新建文件夹并${actionText}` }),
      ]),
      targetMode === 'new' ? el('div', { style: { paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('input', {
          type: 'text', placeholder: '请输入新文件夹名称...',
          value: newFolderName,
          style: { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '13px', outline: 'none' },
          onClick: (e) => e.stopPropagation(),
          onFocus: (e) => e.stopPropagation(),
          onInput: (e) => { newFolderName = e.target.value; }
        }),
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--card)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.05)' } }, [
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: `父级位置：${newFolderParentTaskName}` }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '选择',
            onClick: (e) => {
              e.stopPropagation();
              const tasks = store.getTasks().filter(t => t && t.type !== 'point');
              const parentMask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999 } });
              const parentList = el('div', { style: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });

              parentList.appendChild(el('div', {
                style: { fontWeight: '600', fontSize: '13px', padding: '10px 12px', background: 'rgba(142,202,230,.15)', borderRadius: '6px', cursor: 'pointer', color: 'var(--primary-dark)', border: '1px solid var(--primary)' },
                text: `🌍 根目录（不放在现有文件夹内）`,
                onClick: (ev) => { ev.stopPropagation(); newFolderParentTaskId = null; newFolderParentTaskName = '根目录'; parentMask.remove(); renderTargetOptions(); }
              }));

              tasks.forEach(t => {
                parentList.appendChild(el('div', {
                  style: { fontWeight: '600', fontSize: '13px', padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', marginTop: '4px' },
                  text: `📁 ${t.name}`,
                  onClick: (ev) => { ev.stopPropagation(); newFolderParentTaskId = t.id; newFolderParentTaskName = t.name; parentMask.remove(); renderTargetOptions(); }
                }));
              });

              const parentBox = el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
                el('h3', { text: '选择父级位置' }),
                parentList,
                el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-ghost', text: '取消', onClick: (ev) => { ev.stopPropagation(); parentMask.remove(); } })])
              ]);
              parentMask.appendChild(parentBox);
              document.body.appendChild(parentMask);
            }
          })
        ])
      ]) : null
    ]));
  };

  renderTargetOptions();

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '500px' } }, [
      el('h3', { text: `📥 ${actionText}目标` }),
      el('p', { text: '请选择归档位置', style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '16px' } }),
      targetSection,
      el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: `确认${actionText}`,
          onClick: async () => {
            let finalChapterId = defaultChapterId;
            let finalTaskId = defaultTaskId;

            if (targetMode === 'current') {
              if (!finalTaskId && !finalChapterId) {
                return toastError('没有当前层级，请选择其他文件夹或新建');
              }
            } else if (targetMode === 'other') {
              if (!selectedOtherTaskId) return toastError('请先点击右侧「🔍 选择」挑选目标');
              finalTaskId = selectedOtherTaskId;
              finalChapterId = selectedOtherChapterId;
            } else if (targetMode === 'new') {
              if (!newFolderName.trim()) return toastError('请输入新文件夹名称');
              const newName = newFolderName.trim();

              const taskPatch = { name: newName };
              if (newFolderParentTaskId) taskPatch.parentId = newFolderParentTaskId;
              const newTask = store.createTask(taskPatch);
              const newChap = store.createChapter({ taskId: newTask.id, name: newName });

              finalTaskId = newTask.id;
              finalChapterId = newChap.id;
            }

            if (!finalTaskId) return toastError('请选择有效目标');

            mask.remove();
            onConfirm(finalChapterId, finalTaskId, '目标位置');
          }
        })
      ])
    ])
  ]);
  document.body.appendChild(mask);
}

// ============ 一键批量解析粘贴文本 ============
function openDirectBatchParser() {
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });

  // 状态变量
  let targetTaskId = ''; // 选中的目标文件夹 ID
  let newFolderName = ''; // 新建文件夹的名字
  let newFolderParentTaskId = ''; // 新建文件夹的父级 ID

  const tasks = store.getTasks();

  // 1. 下拉框
  const taskSelect = el('select', {
    style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '12px', fontSize: '14px', background: 'var(--bg)' }
  });

  // 2. 新建文件夹区域（初始隐藏）
  const newFolderArea = el('div', { style: { display: 'none', background: 'rgba(142,202,230,0.08)', padding: '12px', borderRadius: '8px', marginBottom: '12px', border: '1px dashed rgba(142,202,230,0.5)' } }, [
    el('div', { style: { fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--primary-dark)' }, text: '➕ 新建文件夹设置' }),
    el('input', {
      type: 'text', placeholder: '请输入新文件夹名称...',
      style: { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '13px', outline: 'none', marginBottom: '8px' },
      onInput: (e) => { newFolderName = e.target.value; }
    }),
    el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--card)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.05)' } }, [
      el('span', { id: 'parent-folder-display', style: { fontSize: '12px', color: 'var(--text-2)' }, text: '父级位置：🌍 根目录' }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '选择目录',
        onClick: () => {
          // 弹出小窗选父级
          const pMask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999 } });
          const pList = el('div', { style: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });

          pList.appendChild(el('div', {
            style: { fontWeight: '600', fontSize: '13px', padding: '10px 12px', background: 'rgba(142,202,230,.15)', borderRadius: '6px', cursor: 'pointer', color: 'var(--primary-dark)', border: '1px solid var(--primary)' },
            text: `🌍 根目录（不放在现有文件夹内）`,
            onClick: () => { newFolderParentTaskId = ''; document.getElementById('parent-folder-display').textContent = '父级位置：🌍 根目录'; pMask.remove(); }
          }));

          tasks.forEach(t => {
            pList.appendChild(el('div', {
              style: { fontWeight: '600', fontSize: '13px', padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', marginTop: '4px' },
              text: `📁 ${t.name}`,
              onClick: () => { newFolderParentTaskId = t.id; document.getElementById('parent-folder-display').textContent = `父级位置：${t.name}`; pMask.remove(); }
            }));
          });

          const pBox = el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
            el('h3', { text: '选择父级目录' }), pList,
            el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => pMask.remove() })])
          ]);
          pMask.appendChild(pBox); document.body.appendChild(pMask);
        }
      })
    ])
  ]);

  // 渲染下拉框选项
  const renderOptions = () => {
    taskSelect.innerHTML = '';
    taskSelect.appendChild(el('option', { value: '', text: '-- 存入散落卡片（不选文件夹） --' }));

    // 扁平化渲染所有文件夹，带上层级缩进
    const buildOptions = (parentId, depth) => {
      tasks.filter(t => (t.parentId || null) === parentId).forEach(t => {
        const prefix = '　'.repeat(depth);
        taskSelect.appendChild(el('option', { value: t.id, text: `${prefix}📁 ${t.name}` }));
        buildOptions(t.id, depth + 1);
      });
    };
    buildOptions(null, 0);

    // 加一个新建选项
    taskSelect.appendChild(el('option', { value: '__NEW__', text: '➕ 新建文件夹并导入...', style: { fontWeight: 'bold', color: 'var(--primary-dark)' } }));
  };

  renderOptions();

  // 监听下拉框切换
  taskSelect.onchange = (e) => {
    const val = e.target.value;
    if (val === '__NEW__') {
      newFolderArea.style.display = 'block';
      targetTaskId = '';
    } else {
      newFolderArea.style.display = 'none';
      targetTaskId = val;
    }
  };

  // 粘贴框
  const textarea = el('textarea', {
    placeholder: '支持多行批量导入！\n格式 1：词语 --- 解释\n格式 2：词语 | 解释\n格式 3：词语 制表符(Tab) 解释（直接从 Excel 复制默认就是这个）\n\n如果没有分隔符，将自动按每行生成一张纯内容卡片。',
    style: { width: '100%', minHeight: '200px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '12px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5', fontSize: '13px' }
  });

  const box = el('div', { class: 'confirm-box', style: { maxWidth: '650px', width: '90vw' } }, [
    el('h3', { text: '🍉 批量解析并生成卡片' }),
    el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px' }, text: '提示：你可以直接从 Excel 里复制“词语”和“解释”两列，粘贴进来。' }),

    el('div', { style: { fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }, text: '📁 选择导入到哪个文件夹：' }),
    taskSelect,
    newFolderArea, //  新建文件夹的 UI

    el('div', { style: { fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }, text: '📝 粘贴解析内容：' }),
    textarea,

    el('div', { class: 'confirm-actions' }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      el('button', {
        class: 'btn btn-primary', text: '🍉 立即解析并导入',
        onClick: () => {
          const val = textarea.value.trim();
          if (!val) return toastError('内容为空');

          let finalTaskId = targetTaskId;
          let chapterId = '';

          // 处理新建文件夹逻辑
          if (taskSelect.value === '__NEW__') {
            if (!newFolderName.trim()) return toastError('请输入新文件夹名称');
            const newTask = store.createTask({
              name: newFolderName.trim(),
              parentId: newFolderParentTaskId || null
            });
            finalTaskId = newTask.id;

            // 自动创建一个隐藏的占位章节
            const newChap = store.createChapter({ taskId: finalTaskId, name: newFolderName.trim() });
            chapterId = newChap.id;
          }
          // 处理选择已有文件夹逻辑
          else if (finalTaskId) {
            let chapters = store.getChapters(finalTaskId);
            if (chapters.length > 0) {
              chapterId = chapters[0].id;
            } else {
              const newChap = store.createChapter({ name: '批量导入', taskId: finalTaskId });
              chapterId = newChap.id;
            }
          }

          // 按行分割
          const lines = val.split('\n').filter(l => l.trim() !== '');
          let count = 0;

          lines.forEach(line => {
            // 支持：竖线、Tab、多空格、破折号 作为分隔符
            const match = line.split(/\s*(?:\||\t| {3,}|--|——)\s*/);
            const content = match[0] ? match[0].trim() : '';
            const explanation = match[1] ? match[1].trim() : '';

            if (content) {
              store.createPoint({
                chapterId: chapterId || null,
                content: content,
                explanation: explanation
              });
              count++;
            }
          });

          mask.remove();
          toastSuccess(`成功解析并导入了 ${count} 张卡片！`);

          if (finalTaskId) {
            if (location.hash !== `#/folder/${finalTaskId}`) {
              window.location.hash = `#/folder/${finalTaskId}`;
            } else {
              window.location.reload();
            }
          } else {
            if (location.hash === '#/' || location.hash === '') {
              window.location.reload();
            } else {
              window.location.hash = '#/';
            }
          }
        }
      })
    ])
  ]);

  mask.appendChild(box);
  document.body.appendChild(mask);
  setTimeout(() => textarea.focus(), 100);
}