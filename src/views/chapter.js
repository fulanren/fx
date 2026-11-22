import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { fmtDate } from '../utils/date.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { mergeModal } from '../ui/mergeModal.js';
import { makeSortable } from '../ui/sortable.js';
import { getImageCached } from '../db.js';
import { globalImportDocModal } from './importDoc.js';
import { showPasteOptionsModal } from './importDoc.js';


function parseLinks(html) {
  if (!html) return html;

  // 1. 处理双向链接（保留你之前的逻辑）
  const regex = /<span class="editor-link"[^>]*data-link="(\[\[(?:folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\])"[^>]*>(.*?)<\/span>|\[\[(folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\]/g;

  //一定要有 resultHtml 这个变量，并赋初始值
  let resultHtml = html.replace(regex, (match, dataLink, id1, name1, type2, id2, name2, spanText) => {
    const type = type2 || (id1 ? dataLink.split(':')[0].replace('[[', '') : 'point');
    const id = id2 || id1;

    let displayName = "";
    if (spanText !== undefined) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = spanText;
      displayName = tempDiv.textContent || tempDiv.innerText || spanText;
    } else {
      displayName = name1 || name2;
    }

    if (!displayName || !displayName.trim()) return '';

    const route = type === 'folder' ? `#/chapter/${id}` : `#/edit-point/${id}`;
    return `<span class="knowledge-link" data-link-url="${route}" data-link-id="${id}" style="
      color: #5C6BC0; cursor: pointer; font-size: inherit; font-weight: inherit; border-bottom: none;
    ">${displayName}</span>`;
  });

  // 2. 处理数学公式（渲染 $ ... $）
  if (window.katex) {
    resultHtml = resultHtml.replace(/\$([^\$]+)\$/g, (match, formula) => {
      try {
        // 渲染公式，并且为了不让长公式撑破卡片，套一层 inline-block
        return `<span class="math-rendered" style="display:inline-block; vertical-align:middle; margin: 0 2px;">${window.katex.renderToString(formula, { throwOnError: false })}</span>`;
      } catch (e) {
        return match; // 如果语法错误，就原样返回
      }
    });
  }

  return resultHtml;
}

// ============ 导出格式选择菜单 ============
function showExportMenu(scope, id) {
  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '340px' } }, [
      el('h3', { text: '选择导出格式' }),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' } }, [
        fmtBtn('📄 PDF（打印/阅读）', 'pdf'),
        fmtBtn('📝 纯文本 .txt', 'txt'),
        fmtBtn('📋 Markdown .md', 'md'),
        fmtBtn('🌐 HTML 单文件', 'html'),
        fmtBtn('📦 ZIP 完整归档', 'zip'),
        fmtBtn('🃏 Anki 格式（.txt）', 'anki'),
      ]),
      el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      ]),
    ]),
  ]);
  document.body.appendChild(mask);

  function fmtBtn(label, format) {
    return el('button', {
      class: 'btn btn-ghost', text: label,
      onClick: async () => {
        mask.remove();
        try {
          // 【Anki 格式单独处理】
          if (format === 'anki') {
            const { exportToAnki } = await import('../views/ankiExport.js');
            await exportToAnki(scope, id);
            return;
          }
          const { exportContent } = await import('../views/exporter.js');
          await exportContent(scope, id, { format, includeImages: true });
          toastSuccess('已导出');
        } catch (err) { toastError('导出失败：' + err.message); }
      },
    });
  }
}

// ============ 章节列表 ============
let chMulti = false;
const chSelected = new Set();

export function renderChapterList({ params }) {
  const task = store.getTask(params.taskId);
  if (!task) { navigate('#/'); return; }
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = chMulti ? '选择章节' : task.name;
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => {
    if (ptMulti) { ptMulti = false; ptSelected.clear(); renderChapterDetail({ params, query }); }
    else navigate(`#/`);
  };

  const chapters = store.getChapters(task.id);

  if (chMulti) {
    view.appendChild(el('div', { class: 'batch-bar' }, [
      el('span', { text: `已选 ${chSelected.size} 项` }),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        text: chapters.length > 0 && chSelected.size === chapters.length ? '取消全选' : '全选',
        onClick: () => {
          if (chapters.length > 0 && chSelected.size === chapters.length) {
            chSelected.clear();
          } else {
            chapters.forEach(c => chSelected.add(c.id));
          }
          renderChapterList({ params });
        },
      }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => { chMulti = false; chSelected.clear(); renderChapterList({ params }); } }),
    ]));
    view.appendChild(el('div', { class: 'batch-bar-actions' }, [
      // 【粘贴章节】
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 粘贴章节',
        onClick: () => {
          // 假设你复制章节时，存入的 key 叫 kg_clipboard_chapters
          const raw = localStorage.getItem('kg_clipboard_chapters');
          if (!raw) return toastError('剪贴板里没有章节');

          let chapters = [];
          try {
            chapters = JSON.parse(raw);
          } catch (e) { }

          if (!chapters || chapters.length === 0) return toastError('剪贴板为空');

          // 呼出通用弹窗
          showPasteOptionsModal(
            async (finalChapterId, targetName) => {
              if (!finalChapterId) return toastError('请选择目标文件夹');

              if (await confirmBox({ title: '粘贴章节', message: `确定要将 ${chapters.length} 个章节粘贴到「${targetName}」吗？` })) {
                toastSuccess('正在粘贴...');

                for (const c of chapters) {
                  // 1. 在目标文件夹下创建新章节
                  const newChapter = store.createChapter({
                    taskId: store.getChapter(finalChapterId).taskId,
                    name: c.name + ' (副本)'
                  });

                  // 2. 将原章节下的所有知识点复制到新章节
                  const points = store.getPoints(c.id);
                  points.forEach(p => {
                    store.createPoint({
                      chapterId: newChapter.id,
                      content: p.content,
                      explanation: p.explanation,
                      difficulty: p.difficulty,
                      imageIds: p.imageIds
                    });
                  });
                }

                toastSuccess(`成功粘贴 ${chapters.length} 个章节！`);
                chMulti = false;
                chSelected.clear();

                // 粘贴完毕，重新刷新当前页面
                renderChapterList({ params });
              }
            },
            null // 章节批量选择时，通常没有当前章节 ID，传 null
          );
        }
      }),

      // 【合并选中章节】（保留你原来的）
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并选中',
        onClick: async () => {
          if (chSelected.size < 2) { alert('至少选择 2 个章节'); return; }
          const ids = [...chSelected];
          const targetId = ids[0];
          const items = ids.map(id => store.getChapter(id));
          await mergeModal({
            title: '合并章节', items, targetId,
            onConfirm: (sourceIds, dedupe, newName, sortMode, mergeMode) => {
              store.mergeChapters(sourceIds, targetId, dedupe, newName, sortMode);
              toastSuccess('已合并');
              chMulti = false;
              chSelected.clear();
              renderChapterList({ params });
            },
          });
        },
      }),

      // 【删除选中】
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除选中',
        onClick: async () => {
          if (chSelected.size === 0) return;
          if (await confirmBox({ title: '删除', message: `删除 ${chSelected.size} 个章节？将进入回收站`, danger: true, confirmText: '删除' })) {
            chSelected.forEach(id => store.deleteChapter(id));
            toastSuccess('已移入回收站');
            chMulti = false; chSelected.clear();
            renderChapterList({ params });
          }
        },
      }),
    ]));
  } else {
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' } }, [
      // 【按模板导入：自动识别章节和知识点】
      el('button', { class: 'btn btn-sm btn-ghost', text: '☑ 批量', onClick: () => { chMulti = true; renderChapterList({ params }); } }),
    ]));
  }

  if (chapters.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '📖' }),
      el('div', { text: '还没有章节' }),
    ]));
  } else {
    const list = el('div', { id: 'chapter-list' });
    chapters.forEach(c => list.appendChild(chapterCard(c, task.id)));
    view.appendChild(list);
    if (!chMulti) {
      makeSortable(list, '.card', (orderedIds) => {
        store.reorderChapters(task.id, orderedIds);
        toastSuccess('顺序已保存');
      });
    }
  }

  if (!chMulti) {
    view.appendChild(el('button', {
      class: 'fab', text: '+', 'aria-label': '新建章节',
      onClick: () => navigate(`#/edit-chapter/new?taskId=${task.id}`),
    }));
  }
}

function chapterCard(c, taskId) {
  const points = store.getPoints(c.id);
  const isSelected = chSelected.has(c.id);
  return el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': c.id,
    // 强制覆盖全局样式，去掉多余留白
    style: { padding: '12px 16px', minHeight: 'auto', marginBottom: '6px' },
    onClick: (e) => {
      if (e.target.closest('.card-actions') || e.target.closest('.move-btns') || e.target.closest('.select-box')) return;
      if (chMulti) {
        if (chSelected.has(c.id)) chSelected.delete(c.id); else chSelected.add(c.id);
        renderChapterList({ params: { taskId } });
      } else {
        navigate(`#/chapter/${c.id}`);
      }
    },
  }, [
    chMulti ? el('div', { class: 'select-box' }, [
      el('input', {
        type: 'checkbox', checked: isSelected, onChange: (e) => {
          if (e.target.checked) chSelected.add(c.id); else chSelected.delete(c.id);
          renderChapterList({ params: { taskId } });
        }
      }),
    ]) : null,
    el('div', { class: 'card-title', text: c.name }),
    el('div', { class: 'card-meta' }, [
      c.book ? el('span', { text: `📚 ${c.book}` }) : null,
      c.part ? el('span', { text: `📄 ${c.part}` }) : null,
      el('span', { text: `💡 ${points.length} 知识点` }),
    ]),
    //章节专属附件提示区
    (c.imageIds && c.imageIds.length > 0) || (c.pdfFiles && c.pdfFiles.length > 0)
      ? el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
        c.imageIds && c.imageIds.length > 0 ? el('div', {
          class: 'btn btn-sm btn-ghost',
          style: { padding: '2px 8px', fontSize: '12px', background: 'rgba(142,202,230,0.15)', color: 'var(--primary-dark)' },
          text: `🖼 ${c.imageIds.length} 图`,
          onClick: (e) => { e.stopPropagation(); navigate(`#/edit-chapter/${c.id}`); }
        }) : null,
        c.pdfFiles && c.pdfFiles.length > 0 ? el('div', {
          class: 'btn btn-sm btn-ghost',
          style: { padding: '2px 8px', fontSize: '12px', background: 'rgba(255,181,167,0.15)', color: 'var(--accent)' },
          text: `📄 ${c.pdfFiles.length} PDF`,
          onClick: (e) => { e.stopPropagation(); navigate(`#/edit-chapter/${c.id}`); }
        }) : null
      ])
      : null,
    !chMulti ? el('div', { class: 'card-actions' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '编辑', onClick: () => navigate(`#/edit-chapter/${c.id}`) }),
      //删除按钮
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除',
        onClick: async () => {
          if (await confirmBox({ title: '删除章节', message: `「${c.name}」及其知识点将进入回收站`, danger: true, confirmText: '删除' })) {
            store.deleteChapter(c.id);
            toastSuccess('已移入回收站');
            renderChapterList({ params: { taskId } });
          }
        },
      }),
      // 缩小版的上下移按钮
      el('button', { class: 'btn btn-sm btn-ghost', text: '⬆️', title: '上移', style: { minWidth: '36px', padding: '0 8px' }, onClick: (e) => { e.stopPropagation(); store.moveChapter(c.id, 'up'); renderChapterList({ params: { taskId } }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '⬇️', title: '下移', style: { minWidth: '36px', padding: '0 8px' }, onClick: (e) => { e.stopPropagation(); store.moveChapter(c.id, 'down'); renderChapterList({ params: { taskId } }); } }),
    ]) : null,
  ]);
}

// ============ 章节详情 / 知识点列表 ============
let ptMulti = false;
const ptSelected = new Set();
let activeFilterTag = null; // 👈 记录当前选中的过滤标签

export function renderChapterDetail({ params, query }) {
  const chapterId = params.id;
  const chapter = store.getChapter(chapterId);
  const safeQuery = query || {};

  localStorage.setItem('kg_last_chapter_id', chapterId);
  if (!chapter) { navigate('#/'); return; }

  const view = document.getElementById('view');
  clear(view);

  // 直接通过当前章节找到它所属的文件夹（Task）
  const currentTask = store.getTask(chapter.taskId);
  const displayTitle = currentTask ? currentTask.name : chapter.name;

  document.getElementById('page-title').textContent = ptMulti ? '批量选择' : displayTitle;

  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => {
    if (ptMulti) { ptMulti = false; ptSelected.clear(); renderChapterDetail({ params, query }); }
    else navigate(`#/`);
  };

  // 👇 修复：统一变量名为 points，并且放在最外层
  const points = store.getPoints(chapter.id);

  if (ptMulti) {
    view.appendChild(el('div', { class: 'batch-bar' }, [
      el('span', { text: `已选 ${ptSelected.size} 项` }),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        text: points.length > 0 && ptSelected.size === points.length ? '取消全选' : '全选',
        onClick: () => {
          if (points.length > 0 && ptSelected.size === points.length) {
            ptSelected.clear();
          } else {
            points.forEach(p => ptSelected.add(p.id));
          }
          renderChapterDetail({ params });
        },
      }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => { ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
    ]));
    view.appendChild(el('div', { class: 'batch-bar-actions', style: { flexWrap: 'wrap' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并选中',
        onClick: async () => {
          if (ptSelected.size < 2) { alert('至少选择 2 个知识点'); return; }
          const ids = [...ptSelected];
          const targetId = ids[0];
          const items = ids.map(id => store.getPoint(id));
          await mergeModal({
            title: '合并知识点', items, targetId,
            onConfirm: (sourceIds, dedupe, newName, sortMode, mergeMode, saveMode, customExplanation) => {
              store.mergePoints(sourceIds, targetId, dedupe, newName, sortMode, mergeMode, saveMode, customExplanation);
              toastSuccess('合并成功！');
              ptMulti = false; ptSelected.clear();
              renderChapterDetail({ params });
            },
          });
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📋 复制',
        onClick: () => {
          if (ptSelected.size === 0) return toastError('请先勾选卡片');
          const selectedPoints = [...ptSelected].map(id => store.getPoint(id)).filter(Boolean);
          localStorage.setItem('kg_clipboard_points', JSON.stringify(selectedPoints));
          toastSuccess(`已复制 ${selectedPoints.length} 张卡片`);
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 粘贴',
        onClick: async () => {
          const raw = localStorage.getItem('kg_clipboard_points');
          if (!raw) return toastError('剪贴板为空');
          const copiedPoints = JSON.parse(raw);
          if (copiedPoints.length === 0) return toastError('剪贴板为空');

          showPasteOptionsModal(
            async (finalChapterId, targetName) => {
              if (!finalChapterId) return toastError('请选择目标文件夹');
              if (await confirmBox({ title: '粘贴卡片', message: `确定要将 ${copiedPoints.length} 张卡片粘贴到「${targetName}」吗？` })) {
                copiedPoints.forEach(p => {
                  store.createPoint({
                    chapterId: finalChapterId, content: p.content, explanation: p.explanation,
                    difficulty: p.difficulty, imageIds: p.imageIds
                  });
                });
                toastSuccess('粘贴成功');
                ptMulti = false; ptSelected.clear();
                if (finalChapterId !== chapterId) navigate(`#/chapter/${finalChapterId}`);
                else renderChapterDetail({ params });
              }
            }, chapterId
          );
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🚚 移动到...',
        onClick: () => {
          if (ptSelected.size === 0) return toastError('请先勾选要移动的卡片');
          showPasteOptionsModal(
            async (finalChapterId, targetName) => {
              if (!finalChapterId) return;
              if (finalChapterId === chapterId) return toastSuccess('它们已经在当前文件夹了');
              if (await confirmBox({ title: '移动卡片', message: `确定将 ${ptSelected.size} 张卡片移动到「${targetName}」吗？` })) {
                ptSelected.forEach(id => { store.updatePoint(id, { chapterId: finalChapterId }); });
                toastSuccess('移动成功');
                ptMulti = false; ptSelected.clear();
                renderChapterDetail({ params });
              }
            }, chapterId, '移动'
          );
        }
      }),
      el('button', { class: 'btn btn-sm btn-primary', text: '全部记得', onClick: () => { store.batchRatePoints([...ptSelected], 'remember'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全部模糊', onClick: () => { store.batchRatePoints([...ptSelected], 'vague'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全部忘了', onClick: () => { store.batchRatePoints([...ptSelected], 'forgot'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '设难度', onClick: () => {
          const d = prompt('输入难记度 1-10', '5');
          if (d && Number(d) >= 1 && Number(d) <= 10) {
            store.batchUpdatePoints([...ptSelected], { difficulty: Number(d) });
            toastSuccess('已更新难度'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
          }
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '今天复习', onClick: () => {
          store.batchUpdatePoints([...ptSelected], { nextReviewAt: new Date().toISOString() });
          toastSuccess('已设为今天复习'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除', onClick: async () => {
          if (ptSelected.size === 0) return;
          if (await confirmBox({ title: '删除', message: `删除 ${ptSelected.size} 个知识点？将进入回收站`, danger: true, confirmText: '删除' })) {
            store.batchDeletePoints([...ptSelected]);
            toastSuccess('已移入回收站'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
          }
        }
      }),
    ]));
  } else {
    // 👇 在这里加回了标签管理按钮
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '🎯 开始复习',
        onClick: () => {
          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px', textAlign: 'center' } }, [
            el('h3', { text: '选择复习模式', style: { marginBottom: '16px' } }),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
              el('button', { class: 'btn btn-primary', text: '🖥️ 沉浸式模式 (全屏大字)', onClick: () => { mask.remove(); startReviewMode(points, chapter.id); } }),
              el('button', { class: 'btn btn-ghost', text: '📋 专注列表模式 (在原列表操作)', onClick: () => { mask.remove(); startFocusListMode(points, chapter.id); } }),
              el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
            ])
          ]);
          mask.appendChild(box);
          document.body.appendChild(mask);
        }
      }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '☑ 批量', onClick: () => { ptMulti = true; renderChapterDetail({ params, query }); } }),
    ]));
  }

  if (points.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '📄' }),
      el('div', { text: '文件夹空空如也' }),
      el('div', { text: '点击右下角 + 新建卡片', style: { fontSize: '13px', marginTop: '8px' } })
    ]));
  } else {
    const list = el('div', { id: 'point-list' });
    points.forEach(p => list.appendChild(pointCard(p, chapter.id)));
    view.appendChild(list);
    if (!ptMulti) {
      makeSortable(list, '.card', (orderedIds) => {
        store.reorderPoints(chapter.id, orderedIds);
        toastSuccess('顺序已保存');
      });
    }
  }

  if (!ptMulti) {
    view.appendChild(el('button', {
      class: 'fab', text: '+', 'aria-label': '新建卡片',
      onClick: () => navigate(`#/edit-point/new?chapterId=${chapter.id}`),
    }));
  }

  const savedScroll = sessionStorage.getItem('scroll_y_chapter');
  if (savedScroll) {
    setTimeout(() => {
      window.scrollTo(0, parseInt(savedScroll));
      sessionStorage.removeItem('scroll_y_chapter');
    }, 50);
  }
}

// ============ 极简卡片渲染 ============
function pointCard(p, chapterId) {
  let isExpanded = false;
  const isSelected = ptSelected.has(p.id);

  // 👇 获取当前卡片的专属标签
  const allPts = JSON.parse(localStorage.getItem('kg_points') || '[]');
  const freshP = allPts.find(x => x.id === p.id) || p;
  const cardTags = freshP.tags || [];

  // 展开的内容区（初始隐藏）
  const contentBox = el('div', {
    style: { display: 'none', marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(0,0,0,.1)' }
  });

  // 卡片主体
    const card = el('div', {
    class: 'card point-card-content' + (isSelected ? ' selected' : ''),
    style: {
      cursor: 'pointer',
      padding: '4px 8px', // 👈 极限压缩：上下 4px，左右 8px
      transition: 'all 0.2s',
      background: 'var(--card)',
      borderRadius: '6px', // 👈 圆角改小一点，显得更紧凑
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: 'auto',
      marginBottom: '2px' // 👈 卡片与卡片之间的间距也压到极低
    }
  });

      const header = el('div', {
    onClick: (e) => {
      if (e.target.closest('input') || e.target.closest('button')) return;

      if (ptMulti) {
        if (isSelected) ptSelected.delete(p.id); else ptSelected.add(p.id);
        renderChapterDetail({ params: { id: chapterId } });
        return;
      }

      isExpanded = !isExpanded;
      contentBox.style.display = isExpanded ? 'block' : 'none';
    },
    // 👇 极限压缩：去掉所有上下间距，让标签和文字无缝贴合
    style: { display: 'flex', flexDirection: 'column', gap: '0px' } 
  }, [
    // 标签区域
    cardTags.length > 0 ? el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '2px', margin: '0', padding: '0' }
    }, cardTags.map(tag => el('span', {
      style: {
        color: tag.color || '#ff4757', 
        backgroundColor: tag.bgColor || 'transparent',
        border: tag.borderColor !== 'transparent' ? `1px solid ${tag.borderColor}` : 'none',
        padding: '0px 4px', 
        borderRadius: '2px', 
        fontSize: '11px', 
        fontWeight: 'bold', 
        lineHeight: '1', // 👈 极限压缩行高
        margin: '0'
      },
      innerHTML: tag.html || tag.text
    }))) : null,

    // 内容区域
    el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'space-between', marginTop: cardTags.length > 0 ? '2px' : '0' } }, [
      el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', flex: '1' } }, [
        ptMulti ? el('input', {
          type: 'checkbox', checked: isSelected, style: { margin: 0, flexShrink: '0' },
          onChange: (e) => {
            if (e.target.checked) ptSelected.add(p.id); else ptSelected.delete(p.id);
            renderChapterDetail({ params: { id: chapterId } });
          }
        }) : null,
        el('div', {
          style: { fontSize: '14px', fontWeight: '600', whiteSpace: 'pre-wrap', lineHeight: '1.2', wordBreak: 'break-word' },
          innerHTML: parseLinks(p.content)
        })
      ]),

      // 右侧组件
      el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'nowrap', flexShrink: '0', alignItems: 'center' } }, [
        (() => {
          const showDiff = freshP.showDifficultyBeforeExpand === true || freshP.showDifficultyBeforeExpand === 'true';
          const showCount = freshP.showReviewCountBeforeExpand === true || freshP.showReviewCountBeforeExpand === 'true';
          if (!showDiff && !showCount) return null;
          const tagBox = el('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } });
          if (showDiff) {
            const diff = freshP.difficulty || 5;
            tagBox.appendChild(el('span', {
              style: { padding: '0px 4px', background: diff >= 8 ? 'var(--danger)' : diff >= 5 ? 'var(--warn)' : 'var(--green)', color: '#fff', borderRadius: '8px', fontSize: '10px', fontWeight: 'bold', lineHeight: '1.2' },
              text: `难:${diff}`
            }));
          }
          if (showCount) {
            tagBox.appendChild(el('span', {
              style: { padding: '0px 4px', background: 'var(--primary)', color: '#fff', borderRadius: '8px', fontSize: '10px', fontWeight: 'bold', lineHeight: '1.2' },
              text: `背:${freshP.reviewCount || 0}`
            }));
          }
          return tagBox;
        })(),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '🏷️', title: '管理卡片专属标签',
          style: { padding: '0 2px', height: '18px', minHeight: 'auto', fontSize: '12px', opacity: '0.6' },
          onClick: (e) => {
            e.stopPropagation();
            showCardTagManager(p.id);
          }
        })
      ])
    ])
  ]);

  // 展开后的详细内容
  if (p.explanation) {
    const bgStyle = p.themeBg || 'rgba(0,0,0,0.02)';
    contentBox.appendChild(el('div', {
      style: { fontSize: '14px', color: 'var(--text-2)', marginBottom: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: bgStyle, padding: '12px', borderRadius: '8px', lineHeight: '1.6' },
      innerHTML: parseLinks(p.explanation)
    }));
  }

  const footerRow = el('div', { 
    style: { 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      marginTop: '4px', // 👈 从原来的 12px 压缩到 4px
      flexWrap: 'wrap', 
      gap: '4px' 
    } 
  });  if (p.imageIds && p.imageIds.length > 0) {
    footerRow.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--primary)', fontWeight: '600' }, text: `🖼 包含 ${p.imageIds.length} 张图文附件` }));
  } else {
    footerRow.appendChild(el('div'));
  }

  const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn btn-sm btn-ghost', text: '✏️ 编辑', onClick: (e) => { e.stopPropagation(); navigate(`#/edit-point/${p.id}`); } }),
    el('button', { class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async (e) => { e.stopPropagation(); if (await confirmBox({ title: '删除卡片', message: '确定删除这张卡片吗？', danger: true, confirmText: '删除' })) { store.deletePoint(p.id); toastSuccess('已移入回收站'); renderChapterDetail({ params: { id: chapterId } }); } } }),
    el('button', { class: 'btn btn-sm btn-ghost', text: '⬆️', title: '上移', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'up'); renderChapterDetail({ params: { id: chapterId } }); } }),
    el('button', { class: 'btn btn-sm btn-ghost', text: '⬇️', title: '下移', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'down'); renderChapterDetail({ params: { id: chapterId } }); } })
  ]);

  footerRow.appendChild(actions);
  contentBox.appendChild(footerRow);

    card.appendChild(header);
  card.appendChild(contentBox);

  // 👇 在卡片最外层包裹一个带蓝条的容器
  const container = el('div', { 
    class: 'point-card-container', 
    style: { 
      marginBottom: '6px',
      position: 'relative', // 为了绝对定位底部的色条
      overflow: 'hidden', // 裁剪圆角
      borderRadius: '6px',
      background: 'var(--card)' // 保持原底色
    } 
  }, [
    card,
    // 👇 底部马卡龙蓝装饰条
    el('div', {
      style: {
        position: 'absolute',
        bottom: '0',
        left: '0',
        width: '100%',
        height: '4px', // 高度，觉得细可以改大
        background: '#8ECAE6', // 马卡龙蓝
        opacity: '0.6' // 透明度，觉得不够亮可以改1
      }
    })
  ]);

  return container;
}

export function showCardTagManager(pointId) {
    const point = store.getPoint(pointId);
  if (!point) return toastError('找不到该卡片');

  // 👇 直接读取当前卡片自己的专属标签 (point.tags)
  let currentTags = [];
  if (Array.isArray(point.tags)) {
    currentTags = JSON.parse(JSON.stringify(point.tags));
  }
  
  currentTags = currentTags.map(t => ({
    html: t.html || null, text: t.text || '',
    color: t.color || '#ff4757',
    bgColor: t.bgColor || 'transparent',
    borderColor: t.borderColor || 'transparent',
    starred: t.starred || false
  }));

  const defaultColors = [
    { c: '#ff4757', s: false }, { c: '#2ed573', s: false }, { c: '#1e90ff', s: true },
    { c: '#ffa502', s: false }, { c: '#8e44ad', s: false }, { c: '#747d8c', s: false },
    { c: '#ff9ff3', s: false }, { c: '#f368e0', s: false },
    { c: '#000000', s: false }, { c: '#000080', s: false }, { c: 'transparent', s: false }
  ];

 let presetColors = JSON.parse(localStorage.getItem('kg_tag_colors')) || [];
  if (!presetColors.some(p => p.c === '#000000')) presetColors.push({ c: '#000000', s: false });
  if (!presetColors.some(p => p.c === '#000080')) presetColors.push({ c: '#000080', s: false });
  //把 unshift 换成 push，让透明色跑到最后面
  if (!presetColors.some(p => p.c === 'transparent')) {
    presetColors.push({ c: 'transparent', s: false }); 
  }
  
  localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors));

  let activeColorType = 'text';
  let selectedColor = '#ff4757';
  let selectedBgColor = 'transparent';
  let selectedBorderColor = 'transparent';

  let isColorManageMode = false;
  let isStarredExpanded = false; // 收藏颜色默认收起
  let isTagListCollapsed = true; // 标签列表默认收起

  const selectedColorIndices = new Set();
  const selectedIndices = new Set();
  let editingIndex = -1;

  let currentHtmlContent = editingIndex > -1 ? (currentTags[editingIndex].html || '') : '';
  let savedRange = null;
  let editorRef = null;

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center' } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '460px', width: '95%', padding: '20px', maxHeight: '90vh', overflowY: 'auto' } });

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editorRef && editorRef.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };

  const renderContent = (initialContent = null) => {
    clear(box);
    box.appendChild(el('h3', { text: '🏷️ 管理卡片标签', style: { marginTop: 0, marginBottom: '12px' } }));

    // ================= 输入区（完全复刻 showStatusTagManager） =================
    const currentExternalChars = JSON.parse(localStorage.getItem('kg_external_chars')) || [];

    // 1. 工具栏（含常用字、外置快捷按钮）
    const toolbar = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' } }, [
      (() => {
        const wrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });

        // 常用字按钮
        wrap.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: '📝 常用字', style: { fontWeight: 'bold', padding: '2px 8px' },
          onMousedown: e => e.preventDefault(),
          onClick: (e) => {
            e.preventDefault();

            const DEFAULT_WORDS = ['∵', '∴', '≈', '≠', '＜', '＞', '≤', '≥', '→', '←'];
            let allWords = JSON.parse(localStorage.getItem('kg_common_words')) || [];
            let presetWords = allWords.filter(w => DEFAULT_WORDS.includes(w));
            let customWords = allWords.filter(w => !DEFAULT_WORDS.includes(w));

            const wordMask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' } });
            const wordBox = el('div', { class: 'confirm-box', style: { maxWidth: '380px', width: '90%', padding: '16px', display: 'flex', flexDirection: 'column', background: 'var(--bg)' } });

            const insertChar = (w) => {
              wordMask.remove();
              setTimeout(() => {
                const realEditor = document.getElementById('card-tag-editor');
                if (realEditor) {
                  realEditor.focus();
                  if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
                  const color = selectedColor === 'transparent' ? '#000000' : selectedColor;
                  document.execCommand('styleWithCSS', false, true);
                  document.execCommand('insertHTML', false, `<span style="color:${color}">${w}</span>`);
                  currentHtmlContent = realEditor.innerHTML; saveSelection();
                }
              }, 10);
            };

            const renderWordPanel = () => {
              clear(wordBox);
              wordBox.appendChild(el('h4', { text: '选择常用字符', style: { marginTop: 0, marginBottom: '12px' } }));

              const createBlock = (title, wordsArr, defaultCollapsed = false) => {
                if (wordsArr.length === 0) return null;
                let isCollapsed = defaultCollapsed;
                const block = el('div', { style: { marginBottom: '12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '6px' } });
                const header = el('div', { style: { padding: '8px', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px' }, onClick: () => { isCollapsed = !isCollapsed; renderGrid(); } }, [el('span', { text: title }), el('span', { text: isCollapsed ? '▸' : '▾' })]);

                const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px', maxHeight: '150px', overflowY: 'auto' } });
                const renderGrid = () => {
                  clear(grid); header.lastChild.textContent = isCollapsed ? '▸' : '▾';
                  if (isCollapsed) return;
                  wordsArr.forEach(w => { grid.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: w, style: { fontSize: '16px', padding: '2px 10px', border: '1px solid #ccc' }, onMousedown: e => e.preventDefault(), onClick: () => insertChar(w) })); });
                };
                renderGrid(); block.appendChild(header); block.appendChild(grid); return block;
              };

              const customBlock = createBlock('➕ 自定义字符', customWords);
              if (customBlock) wordBox.appendChild(customBlock);
              const presetBlock = createBlock('🌟 预设字符', presetWords, true);
              if (presetBlock) wordBox.appendChild(presetBlock);

              if (!customBlock && !presetBlock) {
                wordBox.appendChild(el('div', { text: '暂无常用字符，请点击管理添加', style: { textAlign: 'center', color: 'var(--text-2)', padding: '20px' } }));
              }

              wordBox.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '8px' } }, [
                el('button', { class: 'btn btn-sm btn-ghost', text: '⚙️ 管理', onClick: renderManagePanel }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '关闭', onClick: () => wordMask.remove() })
              ]));
            };

            const renderManagePanel = () => {
              clear(wordBox);
              wordBox.appendChild(el('h4', { text: '📝 管理常用字符', style: { marginTop: 0, marginBottom: '12px' } }));

              let selectedPreset = new Set();
              let selectedCustom = new Set();
              let selectedExternal = new Set();
              let externalCollapsed = true;

              const createManageBlock = (title, wordsArr, selectedSet, onDelete, collapsedState) => {
                const wrapper = el('div', { style: { marginBottom: '12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '6px' } });
                let isCollapsed = collapsedState.value;
                const header = el('div', { style: { padding: '8px', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px' }, onClick: () => { isCollapsed = !isCollapsed; collapsedState.value = isCollapsed; renderAll(); } }, [el('span', { text: title }), el('span', { text: isCollapsed ? '▸' : '▾' })]);

                wrapper.appendChild(header);
                if (!isCollapsed) {
                  const tools = el('div', { style: { display: 'flex', gap: '6px', padding: '4px 8px', borderBottom: '1px solid rgba(0,0,0,0.05)', alignItems: 'center' } }, [
                    el('button', {
                      class: 'btn btn-sm btn-ghost', text: '📌 外置', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => {
                        if (selectedSet.size === 0) return;
                        selectedSet.forEach(i => {
                          let ext = JSON.parse(localStorage.getItem('kg_external_chars')) || [];
                          if (!ext.includes(wordsArr[i])) ext.push(wordsArr[i]);
                          localStorage.setItem('kg_external_chars', JSON.stringify(ext));
                        });
                        renderAll(); // 刷新管理面板
                        renderContent(currentHtmlContent); // 刷新外面工具栏（外置按钮立刻出现）
                      }
                    }),
                    el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { wordsArr.forEach((_, i) => selectedSet.add(i)); renderAll(); } }),
                    el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { selectedSet.clear(); renderAll(); } }),
                    el('button', { class: 'btn btn-sm btn-danger', text: '删除', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { if (selectedSet.size === 0) return; onDelete(); } })
                  ]);
                  wrapper.appendChild(tools);

                  const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', maxHeight: '120px', overflowY: 'auto' } });
                  wordsArr.forEach((w, i) => {
                    const isChecked = selectedSet.has(i);
                    grid.appendChild(el('div', { style: { padding: '2px 8px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: isChecked ? 'var(--primary)' : 'transparent', color: isChecked ? '#fff' : 'inherit' }, onClick: () => { if (isChecked) selectedSet.delete(i); else selectedSet.add(i); renderAll(); } }, [el('span', { text: w })]));
                  });
                  if (wordsArr.length === 0) grid.appendChild(el('div', { text: '暂无字符', style: { fontSize: '12px', color: 'var(--text-2)' } }));
                  wrapper.appendChild(grid);
                }
                return wrapper;
              };

              const presetCollapsed = { value: false };
              const customCollapsed = { value: false };

              const renderAll = () => {
                clear(wordBox);
                wordBox.appendChild(el('h4', { text: '📝 管理常用字符', style: { marginTop: 0, marginBottom: '12px' } }));

                wordBox.appendChild(createManageBlock('➕ 自定义字符', customWords, selectedCustom, () => {
                  customWords = customWords.filter((_, i) => !selectedCustom.has(i));
                  selectedCustom.clear(); saveAllWords(); renderAll();
                }, customCollapsed));

                wordBox.appendChild(createManageBlock('🌟 预设字符', presetWords, selectedPreset, () => {
                  presetWords = presetWords.filter((_, i) => !selectedPreset.has(i));
                  selectedPreset.clear(); saveAllWords(); renderAll();
                }, presetCollapsed));

                const renderExternalBlock = () => {
                  // 实时读取
                  let localExt = JSON.parse(localStorage.getItem('kg_external_chars')) || [];
                  const wrapper = el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.1)', marginTop: '16px', paddingTop: '12px' } });
                  const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: '8px' }, onClick: () => { externalCollapsed = !externalCollapsed; renderAll(); } }, [
                    el('span', { text: '📌 外置快捷列表', style: { fontWeight: 'bold', fontSize: '13px' } }),
                    el('span', { text: externalCollapsed ? '▸' : '▾', style: { fontSize: '14px' } })
                  ]);
                  wrapper.appendChild(header);

                  if (!externalCollapsed) {
                    const tools = el('div', { style: { display: 'flex', gap: '6px', padding: '4px 0', marginBottom: '8px' } }, [
                      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { localExt.forEach((_, i) => selectedExternal.add(i)); renderAll(); } }),
                      el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { selectedExternal.clear(); renderAll(); } }),
                      el('button', {
                        class: 'btn btn-sm btn-danger', text: '删除选中', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => {
                          if (selectedExternal.size === 0) return;
                          let finalExt = localExt.filter((_, i) => !selectedExternal.has(i));
                          localStorage.setItem('kg_external_chars', JSON.stringify(finalExt));
                          selectedExternal.clear();
                          renderAll(); renderContent(currentHtmlContent);
                        }
                      }),
                      el('div', { style: { flex: 1 } }),
                      el('button', {
                        class: 'btn btn-sm btn-ghost', text: '清空', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto', color: 'var(--text-2)' }, onClick: () => {
                          if (!confirm('确定清空所有外置字符吗？')) return;
                          localStorage.setItem('kg_external_chars', JSON.stringify([]));
                          selectedExternal.clear();
                          renderAll(); renderContent(currentHtmlContent);
                        }
                      })
                    ]);
                    wrapper.appendChild(tools);

                    const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid rgba(0,0,0,.05)', minHeight: '40px' } });
                    if (localExt.length === 0) {
                      grid.appendChild(el('span', { text: '暂无外置字符', style: { fontSize: '12px', color: 'var(--text-2)' } }));
                    } else {
                      localExt.forEach((w, i) => {
                        const isChecked = selectedExternal.has(i);
                        grid.appendChild(el('div', { style: { padding: '2px 8px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: isChecked ? 'var(--primary)' : 'transparent', color: isChecked ? '#fff' : 'inherit' }, onClick: () => { if (isChecked) selectedExternal.delete(i); else selectedExternal.add(i); renderAll(); } }, [el('span', { text: w })]));
                      });
                    }
                    wrapper.appendChild(grid);
                  }
                  return wrapper;
                };
                wordBox.appendChild(renderExternalBlock());

                const inputWrap = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } });
                const inputEl = el('input', { type: 'text', style: { flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }, placeholder: '输入自定义字符，回车添加' });
                const addBtn = el('button', {
                  class: 'btn btn-primary', text: '添加', onClick: () => {
                    const val = inputEl.value.trim();
                    if (!val) return;
                    if (presetWords.includes(val) || customWords.includes(val)) return toastError('该字符已存在');
                    customWords.push(val); saveAllWords(); inputEl.value = ''; renderAll();
                  }
                });
                inputEl.onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
                inputWrap.appendChild(inputEl); inputWrap.appendChild(addBtn); wordBox.appendChild(inputWrap);

                wordBox.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', borderTop: '1px dashed rgba(0,0,0,.1)', paddingTop: '12px' } }, [
                  el('button', { class: 'btn btn-sm btn-ghost', text: '完成', onClick: renderWordPanel })
                ]));
              };

              const saveAllWords = () => { const finalWords = [...presetWords, ...customWords]; localStorage.setItem('kg_common_words', JSON.stringify(finalWords)); };
              renderAll();
            };

            renderWordPanel();
            wordMask.appendChild(wordBox);
            wordMask.onclick = (e) => { if (e.target === wordMask) wordMask.remove(); };
            document.body.appendChild(wordMask);
          }
        }));

        // 👇 2. 渲染外置快捷字符（实时从 localStorage 读取）
        const currentExternalChars = JSON.parse(localStorage.getItem('kg_external_chars')) || [];
        if (currentExternalChars.length > 0) {
          currentExternalChars.forEach(w => {
            wrap.appendChild(el('button', {
              class: 'btn btn-sm btn-ghost', text: w, title: '快捷插入',
              style: { fontSize: '13px', padding: '0 5px', height: '22px', minHeight: 'auto', background: 'var(--bg)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '4px', color: 'var(--text-1)', cursor: 'pointer' },
              onMouseDown: (e) => e.preventDefault(),
              onClick: (e) => {
                e.preventDefault();
                const realEditor = document.getElementById('card-tag-editor');
                if (realEditor) {
                  realEditor.focus();
                  const sel = window.getSelection();
                  if (savedRange) { try { sel.removeAllRanges(); sel.addRange(savedRange); } catch (err) { } }
                  if (sel.rangeCount === 0) {
                    const range = document.createRange(); range.selectNodeContents(realEditor); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
                  }
                  const currentColor = selectedColor === 'transparent' ? '#000000' : selectedColor;
                  document.execCommand('styleWithCSS', false, true);
                  document.execCommand('insertHTML', false, `<span style="color:${currentColor}">${w}</span>`);
                  currentHtmlContent = realEditor.innerHTML; saveSelection();
                }
              }
            }));
          });
        }

        return wrap;
      })(),

      // 👇 3. 分割线和 B、I 按钮
      el('div', { style: { width: '1px', height: '16px', background: 'rgba(0,0,0,0.15)', margin: '0 4px' } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: 'B', style: { fontWeight: 'bold' }, onMousedown: e => e.preventDefault(), onClick: () => { document.execCommand('bold'); editorRef?.focus(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: 'I', style: { fontStyle: 'italic' }, onMousedown: e => e.preventDefault(), onClick: () => { document.execCommand('italic'); editorRef?.focus(); } }),
      el('span', { style: { fontSize: '12px', color: 'var(--text-2)', marginLeft: 'auto' }, text: '选中文字后点击颜色即可变色' })
    ]);
    box.appendChild(toolbar);

    // 2. 输入框
    const editor = el('div', {
      id: 'card-tag-editor', contentEditable: true,
      style: {
        width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: '6px',
        border: '1px solid rgba(0,0,0,0.15)', backgroundColor: 'var(--bg)',
        outline: 'none', minHeight: '60px', maxHeight: '120px', overflowY: 'auto',
        fontSize: '14px', fontWeight: 'bold', transition: 'border-color 0.2s'
      },
      onFocus: (e) => { e.target.style.borderColor = 'var(--primary)'; },
      onBlur: (e) => { e.target.style.borderColor = 'rgba(0,0,0,0.15)'; },
      onMouseUp: saveSelection,
      onKeyUp: saveSelection,
      ref: (el) => { editorRef = el; },

      onKeyDown: (e) => {
        if (e.isComposing || e.key === 'Process' || e.ctrlKey || e.metaKey) return;
        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') return;

        if (activeColorType === 'text' && selectedColor !== 'transparent' && e.key.length === 1) {
          const color = selectedColor === 'transparent' ? '#000000' : selectedColor;
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, color);
        }
      },

      onCompositionEnd: (e) => {
        if (activeColorType === 'text' && selectedColor !== 'transparent') {
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, selectedColor);
          setTimeout(() => {
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            let node = range.startContainer;
            if (node.nodeType === 3 && node.parentNode === e.target) {
              const textContent = node.textContent;
              const offset = range.startOffset;
              const span = document.createElement('span');
              span.style.color = selectedColor;
              span.textContent = textContent;
              node.parentNode.replaceChild(span, node);
              const newRange = document.createRange();
              newRange.setStart(span.firstChild, offset);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }, 0);
        }
      },

      onInput: (e) => {
        currentHtmlContent = e.target.innerHTML;
        saveSelection();
      }
    });
    box.appendChild(editor);

    // 3. 回显
    if (initialContent !== null && initialContent !== '') {
      setTimeout(() => {
        const realEditor = document.getElementById('card-tag-editor');
        if (realEditor) {
          realEditor.innerHTML = initialContent;
          const range = document.createRange();
          range.selectNodeContents(realEditor);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 50);
    }

    // ================= 2. 添加/保存按钮 =================
    const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: editingIndex === -1 ? '添加标签' : '保存修改', style: { flex: '1' },
        onClick: () => {
          const realEditor = document.getElementById('card-tag-editor');
          const text = (realEditor ? realEditor.textContent : '').trim();
          let html = realEditor ? realEditor.innerHTML : currentHtmlContent;
          if (!text) return toastError('标签内容不能为空');
          if (!html.includes('color:') && selectedColor !== 'transparent') html = `<span style="color:${selectedColor}">${text}</span>`;

          const newTag = { html: html, text: text, color: selectedColor, bgColor: selectedBgColor, borderColor: selectedBorderColor, starred: false };
                    if (editingIndex > -1) {
            newTag.starred = currentTags[editingIndex].starred;
            currentTags[editingIndex] = newTag;
            editingIndex = -1;
          } else {
            if (!currentTags.some(t => t.text === text)) currentTags.push(newTag);
            else {
              if (typeof toastError === 'function') toastError('标签内容不能重复');
              else alert('标签内容不能重复');
              return;
            }
          }
          
          // 👇 关键：立刻把 currentTags 存到 localStorage 里！
          store.updateTask(task.id, { statusTags: currentTags });
          
          currentHtmlContent = '';
          selectedBgColor = 'transparent';
          selectedBorderColor = 'transparent';
          renderContent(null);
        }
      }),
      editingIndex > -1 ? el('button', { class: 'btn btn-sm btn-ghost', text: '取消编辑', onClick: () => { editingIndex = -1; currentHtmlContent = ''; selectedBgColor = 'transparent'; selectedBorderColor = 'transparent'; renderContent(null); } }) : null
    ]);
    box.appendChild(actions);

    // ================= 3. 颜色配置区 =================
    const colorContainer = el('div', { style: { marginTop: '16px' } });
    box.appendChild(colorContainer);

    const typeRow = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' } }, [
      el('button', { class: `btn btn-sm ${activeColorType === 'text' ? 'btn-primary' : 'btn-ghost'}`, text: '文字', style: { padding: '2px 10px', fontSize: '12px' }, onClick: () => { activeColorType = 'text'; renderContent(); } }),
      el('button', { class: `btn btn-sm ${activeColorType === 'bg' ? 'btn-primary' : 'btn-ghost'}`, text: '背景', style: { padding: '2px 10px', fontSize: '12px' }, onClick: () => { activeColorType = 'bg'; renderContent(); } }),
      el('button', { class: `btn btn-sm ${activeColorType === 'border' ? 'btn-primary' : 'btn-ghost'}`, text: '边框', style: { padding: '2px 10px', fontSize: '12px' }, onClick: () => { activeColorType = 'border'; renderContent(); } }),
      el('div', { style: { width: '1px', height: '14px', background: 'rgba(0,0,0,0.1)', margin: '0 4px' } }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '⭐ 收藏当前颜色', style: { padding: '2px 8px', fontSize: '11px', height: '22px', minHeight: 'auto', border: '1px dashed rgba(0,0,0,0.2)', borderRadius: '12px', color: 'var(--primary)' },
        onClick: () => {
          const targetColor = activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor);
          if (targetColor === 'transparent') return toastError('透明色无需收藏');
          const existingIndex = presetColors.findIndex(p => p.c.toLowerCase() === targetColor.toLowerCase());
          if (existingIndex > -1) { if (presetColors[existingIndex].s) return toastError('该颜色已在收藏中'); presetColors[existingIndex].s = true; }
          else presetColors.push({ c: targetColor, s: true });
          localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors));
          isStarredExpanded = true; renderContent(); toastSuccess('已加入收藏');
        }
      }),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', fontSize: '11px', color: 'var(--text-2)' } }, [
        el('span', { text: '当前:' }),
        el('div', {
          id: 'current-color-preview',
          style: {
            width: '18px', height: '18px', borderRadius: '50%',
            background: (activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor)) === 'transparent' ? 'var(--bg)' : (activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor)),
            backgroundImage: (activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor)) === 'transparent'
              ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)'
              : 'none',
            backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px',
            border: '1px solid rgba(0,0,0,0.2)'
          }
        })
      ])
    ]);
    colorContainer.appendChild(typeRow);

    // 预设颜色
    const colorsWrap = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '10px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } });
    presetColors.forEach(item => {
      const c = item.c;
      const isTransparent = c === 'transparent'; // 👈 补上这个定义！

      let isSelected = false;
      if (activeColorType === 'text') isSelected = (selectedColor === c);
      if (activeColorType === 'bg') isSelected = (selectedBgColor === c);
      if (activeColorType === 'border') isSelected = (selectedBorderColor === c);

      // 👇 把 el 赋给变量 colorCircle
      const colorCircle = el('div', {
        class: 'color-block', 
        style: {
          width: '18px', height: '18px', borderRadius: '50%',
          background: isTransparent ? 'var(--bg)' : c,
          backgroundImage: isTransparent
            ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)'
            : 'none',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 4px 4px',
          cursor: 'pointer',
          border: isSelected ? '2px solid var(--primary)' : '2px solid transparent',
          boxShadow: isSelected ? '0 0 0 1px rgba(0,0,0,0.1)' : 'none',
          transform: isSelected ? 'scale(1.15)' : 'scale(1)',
          transition: 'all 0.15s',
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        },
        onMouseDown: e => e.preventDefault(),
        onClick: () => {
          // 1. 更新颜色状态
          if (activeColorType === 'text') selectedColor = c;
          if (activeColorType === 'bg') selectedBgColor = c;
          if (activeColorType === 'border') selectedBorderColor = c;

          // 2. 局部更新右上角预览球
          const previewEl = document.getElementById('current-color-preview');
          if (previewEl) {
            if (isTransparent) {
              previewEl.style.background = 'var(--bg)';
              previewEl.style.backgroundImage = 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)';
              previewEl.style.backgroundSize = '8px 8px';
              previewEl.style.backgroundPosition = '0 0, 4px 4px';
            } else {
              previewEl.style.background = c;
              previewEl.style.backgroundImage = 'none';
            }
          }

          // 3. 局部更新所有颜色圆圈的选中状态（去掉之前的边框和勾）
          Array.from(colorsWrap.children).forEach(child => {
            if (child.dataset.isColorBlock) {
              child.style.border = '2px solid transparent';
              child.style.boxShadow = 'none';
              child.style.transform = 'scale(1)';
              const oldCheck = child.querySelector('.check-icon');
              if (oldCheck) oldCheck.remove();
            }
          });

          // 4. 给当前选中的圆圈加框和打勾
          colorCircle.style.border = '2px solid var(--primary)';
          colorCircle.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.1)';
          colorCircle.style.transform = 'scale(1.15)';
          
          if (!colorCircle.querySelector('.check-icon')) {
            colorCircle.appendChild(el('span', {
              class: 'check-icon',
              text: '✓',
              style: { color: '#fff', fontSize: '12px', fontWeight: 'bold', position: 'absolute', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }
            }));
          }
        }
      }, [
        isSelected ? el('span', { class: 'check-icon', text: '✓', style: { color: '#fff', fontSize: '12px', fontWeight: 'bold', position: 'absolute', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } }) : null
      ]);

      // 👇 加上标记并挂载
      colorCircle.dataset.isColorBlock = 'true';
      colorsWrap.appendChild(colorCircle);
    });

    // 自定义颜色盘
    const currentDefault = activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor);
    colorsWrap.appendChild(el('div', { style: { width: '16px', height: '16px', borderRadius: '50%', position: 'relative', border: '1px dashed #999', cursor: 'pointer', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, title: '自定义颜色' }, [
      el('div', { text: '🎨', style: { fontSize: '10px', pointerEvents: 'none' } }),
      el('input', {
        type: 'color', style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }, value: currentDefault === 'transparent' ? '#ffffff' : currentDefault, onInput: (e) => {
          const val = e.target.value;
          if (activeColorType === 'text') selectedColor = val;
          else if (activeColorType === 'bg') selectedBgColor = val;
          else if (activeColorType === 'border') selectedBorderColor = val;

          // 👈 局部更新 UI
          const previewEl = document.getElementById('current-color-preview');
          if (previewEl) { previewEl.style.background = val; previewEl.style.backgroundImage = 'none'; }
        }
      })
    ]));
    colorContainer.appendChild(colorsWrap);

      // ================= 4. 收藏颜色区（带管理） =================
    const starredColors = presetColors.filter(item => item.s);
    colorContainer.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,0.1)', marginTop: '8px', marginBottom: '8px' } }));
    
    // 👇 收藏颜色标题区 + 管理按钮
    const starHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-2)' } }, [
      el('div', { 
        style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 'bold' }, 
        onClick: () => { isStarredExpanded = !isStarredExpanded; renderContent(null); } 
      }, [
        el('span', { text: `⭐ 收藏颜色 (${starredColors.length})` }),
        el('span', { text: isStarredExpanded ? '▾' : '▸' })
      ]),
      // 👇 管理工具条
      el('div', { style: { display: 'flex', gap: '4px' } }, [
        isColorManageMode ? el('button', { 
          class: 'btn btn-sm btn-ghost', text: '全选', 
          style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, 
          onClick: (e) => { 
            e.stopPropagation(); 
            presetColors.forEach((item, i) => { if (item.s) selectedColorIndices.add(i); }); 
            renderContent(null); 
          } 
        }) : null,
        isColorManageMode ? el('button', { 
          class: 'btn btn-sm btn-ghost', text: '非全选', 
          style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, 
          onClick: (e) => { 
            e.stopPropagation(); 
            selectedColorIndices.clear(); 
            renderContent(null); 
          } 
        }) : null,
        isColorManageMode ? el('button', { 
          class: 'btn btn-sm btn-danger', text: `删除(${selectedColorIndices.size})`, 
          style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, 
          onClick: (e) => { 
            e.stopPropagation(); 
            if (selectedColorIndices.size === 0) return; 
            if (!confirm('确定删除选中的收藏颜色吗？')) return; 
            selectedColorIndices.forEach(i => { if (presetColors[i]) presetColors[i].s = false; }); 
            localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors)); 
            selectedColorIndices.clear(); 
            isColorManageMode = false; 
            renderContent(null); 
          } 
        }) : null,
        el('button', { 
          class: 'btn btn-sm btn-primary', text: isColorManageMode ? '完成' : '管理', 
          style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, 
          onClick: (e) => { 
            e.stopPropagation(); 
            isColorManageMode = !isColorManageMode; 
            selectedColorIndices.clear(); 
            renderContent(null); 
          } 
        })
      ])
    ]);
    colorContainer.appendChild(starHeader);

        if (isStarredExpanded) {
      const starBox = el('div', { style: { marginTop: '8px' } });
      if (starredColors.length === 0) {
        starBox.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', padding: '8px', background: 'var(--bg)', borderRadius: '6px', border: '1px dashed rgba(0,0,0,.1)' }, text: '暂无收藏颜色' }));
      } else {
        const starredWrap = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '10px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } });
        starredColors.forEach((item) => {
          const c = item.c;
          const realIndex = presetColors.findIndex(p => p.c === c);
          const isChecked = selectedColorIndices.has(realIndex);
          const isTransparent = c === 'transparent';

          let isSelected = false;
          if (activeColorType === 'text') isSelected = (selectedColor === c);
          if (activeColorType === 'bg') isSelected = (selectedBgColor === c);
          if (activeColorType === 'border') isSelected = (selectedBorderColor === c);

          const starCircle = el('div', {
            style: { width: '18px', height: '18px', borderRadius: '50%', background: isTransparent ? 'var(--bg)' : c, backgroundImage: isTransparent ? 'linear-gradient(...)' : 'none', cursor: 'pointer', border: isChecked ? '2px solid #fff' : (isSelected ? '2px solid var(--primary)' : '2px solid transparent'), boxShadow: isChecked ? '0 0 0 1px rgba(0,0,0,0.2)' : 'none', transform: isSelected ? 'scale(1.15)' : 'scale(1)', transition: 'all 0.15s', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' },
            onMouseDown: (e) => e.preventDefault(),
            onClick: () => {
              if (isColorManageMode) {
                // 👇 管理模式：点击是勾选
                if (selectedColorIndices.has(realIndex)) selectedColorIndices.delete(realIndex); else selectedColorIndices.add(realIndex);
                renderContent(null);
              } else {
                // 👇 普通模式：点击是选色
                if (activeColorType === 'text') selectedColor = c;
                else if (activeColorType === 'bg') selectedBgColor = c;
                else if (activeColorType === 'border') selectedBorderColor = c;
                renderContent(null);
              }
            }
          }, [isChecked ? el('span', { text: '✓', style: { color: '#fff', fontSize: '12px', fontWeight: 'bold', position: 'absolute', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } }) : null]);
          starredWrap.appendChild(starCircle);
        });
        starBox.appendChild(starredWrap);
      }
      colorContainer.appendChild(starBox);
    }

        // ================= 5. 卡片标签列表（状态持久化折叠） =================
    const currentList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' } });
    if (currentTags.length === 0) {
      currentList.appendChild(el('div', { text: '暂无标签', style: { textAlign: 'center', padding: '12px', color: 'var(--text-2)', fontSize: '13px' } }));
    } else {
      currentTags.forEach((tag, index) => {
        const isSelected = selectedIndices.has(index);
        currentList.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid rgba(0,0,0,.04)' } }, [
          el('input', { 
            type: 'checkbox', checked: isSelected, style: { margin: 0, width: '14px', height: '14px' }, 
            onChange: (e) => { if (e.target.checked) selectedIndices.add(index); else selectedIndices.delete(index); renderContent(); } 
          }),
          el('span', { style: { color: tag.color, backgroundColor: tag.bgColor, border: tag.borderColor !== 'transparent' ? `1px solid ${tag.borderColor}` : 'none', padding: '2px 6px', borderRadius: '4px', fontSize: '13px', fontWeight: '600', flex: '1' }, innerHTML: tag.html || tag.text }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', style: { padding: '2px 6px', minHeight: 'auto' }, onClick: () => { editingIndex = index; currentHtmlContent = tag.html || ''; selectedColor = tag.color; selectedBgColor = tag.bgColor; selectedBorderColor = tag.borderColor; renderContent(currentHtmlContent); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: tag.starred ? '⭐' : '☆', style: { padding: '2px 6px', minHeight: 'auto' }, onClick: () => { currentTags[index].starred = !currentTags[index].starred; renderContent(); } })
        ]));
      });
    }

    const listActions = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { currentTags.forEach((_, i) => selectedIndices.add(i)); renderContent(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', onClick: () => { selectedIndices.clear(); renderContent(); } }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除选中', disabled: selectedIndices.size === 0, onClick: () => {
          if (selectedIndices.size === 0) return;
          if (!confirm(`确定要删除选中的 ${selectedIndices.size} 个标签吗？`)) return;
          currentTags = currentTags.filter((_, i) => !selectedIndices.has(i));
          selectedIndices.clear(); renderContent();
        }
      })
    ]);

    // 👇 根据 isTagListCollapsed 的状态决定是否显示
    const listContainer = el('div', { 
      style: { display: isTagListCollapsed ? 'none' : 'block' } 
    }, [currentList, listActions]);
    
    // 阻止内部点击冒泡，防止误触外部重绘
    listContainer.onclick = (e) => e.stopPropagation();

    const listHeader = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px dashed rgba(0,0,0,.1)' },
      onClick: (e) => {
        e.stopPropagation();
        isTagListCollapsed = !isTagListCollapsed; // 👈 切换状态
        renderContent(); // 👈 重绘应用状态
      }
    }, [
      el('span', { text: `📁 当前卡片标签 (${currentTags.length})`, style: { fontWeight: 'bold', fontSize: '13px', color: 'var(--text-2)' } }),
      el('span', { text: isTagListCollapsed ? '▸' : '▾', style: { fontSize: '14px' } })
    ]);

    box.appendChild(listHeader);
    box.appendChild(listContainer);

    // ================= 6. 底部保存 =================
    box.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.1)', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' } }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      el('button', {
        class: 'btn btn-primary', text: '保存',
        onClick: () => {
          // 👈 必须是 updatePoint，而不是 updateTask
          store.updatePoint(pointId, { tags: currentTags });
          toastSuccess('卡片标签已更新');
          mask.remove();
          renderChapterDetail({ params: { id: point.chapterId } });
        }
      })    ]));
  };

  renderContent(null);
  mask.appendChild(box);
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  document.body.appendChild(mask);
}

// ============ 沉浸式极速复习模式 ============
function startReviewMode(points, chapterId) {
  if (!points || points.length === 0) {
    alert('当前文件夹没有卡片，无法复习');
    return;
  }

  let currentIndex = 0;
  let isExpanded = false;

  // 1. 创建全屏遮罩
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'var(--bg)', display: 'flex', flexDirection: 'column' } });

  // 顶部进度条
  const progressBar = el('div', { style: { height: '4px', background: 'rgba(0,0,0,0.05)', width: '100%' } });
  const progressFill = el('div', { style: { height: '100%', width: '0%', background: 'var(--primary)', transition: 'width 0.3s' } });
  progressBar.appendChild(progressFill);
  mask.appendChild(progressBar);

  // 顶部信息栏
  const topBar = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px' } }, [
    el('span', { style: { fontSize: '14px', color: 'var(--text-2)' }, text: `复习模式 - ${points.length} 张卡片` }),
    el('button', {
      class: 'btn btn-sm btn-ghost', text: '✕ 退出', onClick: () => {
        mask.remove();
        window.onkeydown = null;
        document.body.style.overflow = ''; // 恢复滚动
      }
    })
  ]);
  mask.appendChild(topBar);

  // 卡片展示区
  const cardArea = el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '20px', maxWidth: '800px', margin: '0 auto', width: '100%' } });
  mask.appendChild(cardArea);

  // 底部悬浮触控栏（平板专属）
  const touchBar = el('div', {
    id: 'review-touch-bar',
    style: { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(43, 45, 66, 0.85)', backdropFilter: 'blur(10px)', padding: '8px 16px', borderRadius: '30px', display: 'flex', gap: '12px', zIndex: 100000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', alignItems: 'center' }
  }, [
    // 上一个
    el('button', {
      class: 'btn btn-ghost', style: { color: '#fff', fontSize: '20px', padding: '8px 16px' }, text: '⬆️',
      title: '快捷键: ↑',
      onClick: () => { if (currentIndex > 0) { currentIndex--; isExpanded = false; renderCard(); } }
    }),

    // 翻开答案
    el('button', {
      class: 'btn btn-primary', style: { fontSize: '16px', padding: '8px 24px', borderRadius: '20px' }, text: '翻开答案 (空格)',
      onClick: () => { isExpanded = !isExpanded; renderCard(); }
    }),

    // 图片
    el('button', {
      class: 'btn btn-ghost', style: { color: '#fff' }, text: '🖼 图片 (I)',
      title: '快捷键: I',
      onClick: () => {
        const p = points[currentIndex];
        if (p.imageIds && p.imageIds.length > 0) openQuickImages(p.imageIds);
        else toastSuccess('当前卡片无图片');
      }
    }),

    // PDF
    el('button', {
      class: 'btn btn-ghost', style: { color: '#fff' }, text: '📄 PDF (P)',
      title: '快捷键: P',
      onClick: () => {
        const p = points[currentIndex];
        const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
        const realPoint = allPoints.find(x => x.id === p.id) || p;
        const pdfId = findPdfId(realPoint);

        if (pdfId) {
          window.location.hash = `#/pdf-viewer/${pdfId}?pointId=${p.id}`;
          mask.remove(); window.onkeydown = null; document.body.style.overflow = '';
        } else {
          toastSuccess('当前卡片无 PDF');
        }
      }
    }),

    // 下一个
    el('button', {
      class: 'btn btn-ghost', style: { color: '#fff', fontSize: '20px', padding: '8px 16px' }, text: '⬇️',
      title: '快捷键: ↓',
      onClick: () => { if (currentIndex < points.length - 1) { currentIndex++; isExpanded = false; renderCard(); } }
    })
  ]);
  mask.appendChild(touchBar);

  document.body.appendChild(mask);
  document.body.style.overflow = 'hidden'; // 防止背景滚动

  // ============ 渲染卡片逻辑 ============
  function renderCard() {
    const p = points[currentIndex];
    progressFill.style.width = `${((currentIndex + 1) / points.length) * 100}%`;
    cardArea.innerHTML = '';

    // 主卡片
    const card = el('div', {
      class: 'card',
      style: { padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', position: 'relative' },
      onClick: (e) => {
        // 点击空白处也能翻转
        if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('.hidden')) return;
        isExpanded = !isExpanded;
        renderCard();
      }
    });

    // 卡片内容
    card.appendChild(el('div', { style: { fontSize: '22px', fontWeight: '600', textAlign: 'center', lineHeight: '1.6', whiteSpace: 'pre-wrap' }, innerHTML: parseLinks(p.content) }));

    // 判断是否显示提示
    const freshP = JSON.parse(localStorage.getItem('kg_points') || '[]').find(x => x.id === p.id) || p;

    const tagBox = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'center' } });

    if (freshP.showDifficultyBeforeExpand) {
      const diff = freshP.difficulty || 5;
      tagBox.appendChild(el('div', {
        style: { padding: '4px 12px', background: diff >= 8 ? 'var(--danger)' : diff >= 5 ? 'var(--warn)' : 'var(--green)', color: '#fff', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold' },
        text: `难记度: ${diff} / 10`
      }));
    }

    if (freshP.showReviewCountBeforeExpand) {
      tagBox.appendChild(el('div', {
        style: { padding: '4px 12px', background: 'var(--primary)', color: '#fff', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold' },
        text: `已背: ${freshP.reviewCount || 0} 遍`
      }));
    }

    // 如果标签框里有东西，才添加到卡片里
    if (tagBox.children.length > 0) {
      card.appendChild(tagBox);
    }

    // 展开后的内容
    if (isExpanded) {
      const expandBox = el('div', { style: { width: '100%', marginTop: '24px', paddingTop: '24px', borderTop: '1px dashed rgba(0,0,0,0.1)' } });

      if (p.explanation) {
        // 这里使用的 parseLinks 就是点击展开后看到的文字
        expandBox.appendChild(el('div', {
          style: {
            fontSize: '14px',
            color: 'var(--text-2)',
            marginBottom: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'rgba(0,0,0,0.02)',
            padding: '8px',
            borderRadius: '6px'
          },
          innerHTML: parseLinks(p.explanation)
        }));
      }

      // 附件快捷入口
      const btnRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '16px' } });

      // 1. 查看图片按钮
      if (p.imageIds && p.imageIds.length > 0) {
        btnRow.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: '🖼 查看图片',
          onClick: () => openQuickImages(p.imageIds)
        }));
      }

      //2. 打开 PDF 按钮
      if (p.pdfFiles && p.pdfFiles.length > 0) {
        btnRow.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: '📄 打开 PDF',
          onClick: () => {
            // 如果有多个 PDF，默认打开第一个
            window.location.hash = `#/pdf-viewer/${p.pdfFiles[0].id}?pointId=${p.id}`;
            mask.remove();
            window.onkeydown = null;
            document.body.style.overflow = ''; // 退出复习模式，进入 PDF 页面
          }
        }));
      }

      if (btnRow.children.length > 0) expandBox.appendChild(btnRow);

      // 自评按钮（带次数统计）
      const freshP = JSON.parse(localStorage.getItem('kg_points') || '[]').find(x => x.id === p.id) || p;
      const history = freshP.reviewHistory || [];
      const forgotC = history.filter(h => h.rating === 'forgot').length;
      const vagueC = history.filter(h => h.rating === 'vague').length;
      const rememberC = history.filter(h => h.rating === 'remember').length;

      expandBox.appendChild(el('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn btn-sm btn-danger', text: `1. 忘了 (${forgotC})`, onClick: () => ratePoint('forgot') }),
        el('button', { class: 'btn btn-sm btn-warning', text: `2. 模糊 (${vagueC})`, onClick: () => ratePoint('vague') }),
        el('button', { class: 'btn btn-sm btn-success', text: `3. 记得 (${rememberC})`, onClick: () => ratePoint('remember') }),
      ]));

      card.appendChild(expandBox);
    }

    cardArea.appendChild(card);
  }

  // 评分并切下一题
  function ratePoint(rating) {
    const p = points[currentIndex];
    store.ratePoint(p.id, rating);
    toastSuccess('已记录');
    if (currentIndex < points.length - 1) {
      currentIndex++;
      isExpanded = false;
      renderCard();
    } else {
      // 最后一张：把界面关掉并刷新列表
      alert('太棒了，该文件夹已复习完毕！');
      mask.remove(); // 沉浸式用这个
      // touchBar.remove(); // 专注列表模式用这个
      window.onkeydown = null;
      renderChapterDetail({ params: { id: chapterId } });
    }
  }

  // 图片预览弹窗
  async function openQuickImages(imageIds) {
    //暂停复习快捷键，防止按 ESC 时直接退出复习
    const oldKeyDown = window.onkeydown;
    window.onkeydown = null;

    const imgMask = el('div', { class: 'confirm-mask', style: { zIndex: 999999, background: 'rgba(0,0,0,0.9)' } });
    const imgWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '20px', maxHeight: '80vh', overflowY: 'auto', justifyContent: 'center' } });
    imgMask.appendChild(el('h3', { text: '附件预览', style: { color: '#fff', textAlign: 'center', marginTop: '20px' } }));
    imgMask.appendChild(imgWrap);

    const { dbGet } = await import('../db.js');
    for (const id of imageIds) {
      const rec = await dbGet('images', id);
      if (rec && (rec.annotatedBlob || rec.originalBlob)) {
        const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
        imgWrap.appendChild(el('img', { src: url, style: { maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px', objectFit: 'contain' }, onLoad: () => URL.revokeObjectURL(url) }));
      }
    }

    const closeMask = () => {
      imgMask.remove();
      window.onkeydown = oldKeyDown; // 恢复复习快捷键
    };

    const closeBtn = el('button', { class: 'btn btn-primary', text: '关闭 (Esc)', style: { position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)' }, onClick: closeMask });
    imgMask.appendChild(closeBtn);
    document.body.appendChild(imgMask);

    //加入 ESC 监听
    window.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMask();
      }
    };
  }

  // ============ 键盘快捷键拦截 ============
  window.onkeydown = (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault(); isExpanded = !isExpanded; renderCard();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isExpanded) { ratePoint('forgot'); }
      else { ratePoint('remember'); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentIndex > 0) { currentIndex--; isExpanded = false; renderCard(); }
    } else if (e.key === 'Escape') {
      mask.remove(); window.onkeydown = null; document.body.style.overflow = '';
    } else if (e.key === '1' && isExpanded) { ratePoint('forgot'); }
    else if (e.key === '2' && isExpanded) { ratePoint('vague'); }
    else if (e.key === '3' && isExpanded) { ratePoint('remember'); }
    else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      if (!isExpanded) { isExpanded = true; renderCard(); return; }
      const p = points[currentIndex];
      if (p.imageIds?.length) openQuickImages(p.imageIds);
      else toastSuccess('无图片');
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (!isExpanded) { isExpanded = true; renderCard(); return; }

      // 智能读取 PDF
      const p = points[currentIndex];
      const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
      const realPoint = allPoints.find(x => x.id === p.id) || p;
      const pdfId = findPdfId(realPoint);

      if (pdfId) {
        window.location.hash = `#/pdf-viewer/${pdfId}?pointId=${p.id}`;
        mask.remove(); window.onkeydown = null; document.body.style.overflow = '';
      } else {
        toastSuccess('无 PDF');
      }
    }
  };

  // 初始化渲染第一张
  renderCard();
}

// ============ 专注列表复习模式 (Focus List) ============
function startFocusListMode(points, chapterId) {
  if (!points || points.length === 0) return;

  let currentIndex = 0;
  let isExpanded = false;

  // 1. 获取当前页面所有的卡片 DOM
  // 因为我们是基于列表模式，所以直接找页面上的 .card 元素
  const cardElements = Array.from(document.querySelectorAll('#point-list .card'));

  if (cardElements.length === 0) return;

  // 2. 创建底部悬浮条
  const touchBar = el('div', {
    id: 'review-touch-bar',
    style: { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(43, 45, 66, 0.95)', backdropFilter: 'blur(10px)', padding: '8px 16px', borderRadius: '30px', display: 'flex', gap: '8px', zIndex: 100000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }
  }, [
    el('button', {
      class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '✕ 退出', onClick: () => {
        cardElements.forEach(el => el.style.border = '1px solid rgba(0,0,0,.05)');
        touchBar.remove(); window.onkeydown = null;
      }
    }),
    el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' } }),
    el('button', {
      class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '⬆️', title: '快捷键: ↑', onClick: () => {
        if (currentIndex > 0) { currentIndex--; highlightCard(); }
      }
    }),
    el('button', {
      class: 'btn btn-sm btn-primary', style: { padding: '4px 16px' }, text: '翻转 (空格)', onClick: () => {
        isExpanded = !isExpanded; highlightCard();
      }
    }),
    el('button', {
      class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '🖼 图片 (I)', onClick: () => {
        const p = points[currentIndex];
        if (p.imageIds && p.imageIds.length > 0) openQuickImages(p.imageIds);
        else toastSuccess('当前无图片');
      }
    }),
    el('button', {
      class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '📄 PDF (P)',
      onClick: () => {
        const p = points[currentIndex];
        const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
        const realPoint = allPoints.find(x => x.id === p.id) || p;
        const pdfId = findPdfId(realPoint);

        if (pdfId) {
          window.location.hash = `#/pdf-viewer/${pdfId}?pointId=${p.id}`;
          touchBar.remove(); window.onkeydown = null;
        } else {
          toastSuccess('当前无 PDF');
        }
      }
    }),
    el('button', {
      class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '⬇️', title: '快捷键: ↓', onClick: () => {
        if (currentIndex < points.length - 1) { currentIndex++; highlightCard(); }
      }
    }),
    el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' } }),
    // 快速评分按钮
    el('button', { class: 'btn btn-sm btn-danger', text: '1.忘了', onClick: () => rateCurrent('forgot') }),
    el('button', { class: 'btn btn-sm btn-warning', text: '2.模糊', onClick: () => rateCurrent('vague') }),
    el('button', { class: 'btn btn-sm btn-success', text: '3.记得', onClick: () => rateCurrent('remember') })
  ]);

  document.body.appendChild(touchBar);

  // 3. 高亮并滚动到当前卡片
  function highlightCard() {
    cardElements.forEach(el => el.style.border = '1px solid rgba(0,0,0,.05)'); // 重置所有卡片边框

    const el = cardElements[currentIndex];
    if (el) {
      el.style.border = '2px solid var(--primary)'; // 高亮当前卡片
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 直接通过 DOM 找到解释框并控制它
      // 因为解释框是卡片里的第二个子元素（header 是第一个）
      const header = el.children[0];
      const contentBox = el.children[1];

      if (contentBox) {
        if (isExpanded) {
          contentBox.style.display = 'block'; // 强行展开
        } else {
          contentBox.style.display = 'none';  // 强行收起
        }
      }
    }
  }

  // 4. 评分并切下一题
  function rateCurrent(rating) {
    const p = points[currentIndex];
    store.ratePoint(p.id, rating);
    if (rating === 'forgot') {
      store.incrementErrorCount(p.id);

      //错题本联动：如果你之前在这个卡片里插入过 ❝ 引用块，那么它会被自动高亮或在错题本展示
      // 如果你希望“忘了”时自动在卡片末尾补一个“🚨 易错点：”的引用块：
      if (!p.explanation || !p.explanation.includes('🚨 易错点')) {
        const newHtml = (p.explanation || '') + `<br><blockquote style="border-left: 4px solid #FFB5A7; margin: 8px 0; padding: 4px 12px; color: #EF476F; background: rgba(255,181,167,0.1); border-radius: 0 4px 4px 0;"><strong>🚨 易错点总结：</strong><br>请在编辑页补充这道题的错因...</blockquote>`;
        store.updatePoint(p.id, { explanation: newHtml });
      }
    }
    toastSuccess('已记录');

    if (currentIndex < points.length - 1) {
      currentIndex++;
      isExpanded = false;
      highlightCard();
    } else {
      toastSuccess('复习完毕！');
      cardElements.forEach(el => el.style.border = '1px solid rgba(0,0,0,.05)');
      touchBar.remove();
      window.onkeydown = null;
      renderChapterDetail({ params: { id: chapterId } });
    }
  }

  // 5. 图片预览复用
  async function openQuickImages(imageIds) {
    //暂停复习快捷键
    const oldKeyDown = window.onkeydown;
    window.onkeydown = null;

    const imgMask = el('div', { class: 'confirm-mask', style: { zIndex: 999999, background: 'rgba(0,0,0,0.9)' } });
    const imgWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '20px', maxHeight: '80vh', overflowY: 'auto', justifyContent: 'center' } });
    imgMask.appendChild(el('h3', { text: '附件预览', style: { color: '#fff', textAlign: 'center', marginTop: '20px' } }));
    imgMask.appendChild(imgWrap);

    const { dbGet } = await import('../db.js');
    for (const id of imageIds) {
      const rec = await dbGet('images', id);
      if (rec && (rec.annotatedBlob || rec.originalBlob)) {
        const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
        imgWrap.appendChild(el('img', { src: url, style: { maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px', objectFit: 'contain' }, onLoad: () => URL.revokeObjectURL(url) }));
      }
    }

    const closeMask = () => {
      imgMask.remove();
      window.onkeydown = oldKeyDown; // 恢复复习快捷键
    };

    const closeBtn = el('button', { class: 'btn btn-primary', text: '关闭 (Esc)', style: { position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)' }, onClick: closeMask });
    imgMask.appendChild(closeBtn);
    document.body.appendChild(imgMask);

    //加入 ESC 监听
    window.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMask();
      }
    };
  }

  // 6. 键盘快捷键拦截
  window.onkeydown = (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault(); isExpanded = !isExpanded; highlightCard();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); rateCurrent(isExpanded ? 'remember' : 'forgot');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); if (currentIndex > 0) { currentIndex--; isExpanded = false; highlightCard(); }
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault(); if (!isExpanded) { isExpanded = true; highlightCard(); return; }
      const p = points[currentIndex]; if (p.imageIds?.length) openQuickImages(p.imageIds); else toastSuccess('无图片');
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (!isExpanded) { isExpanded = true; highlightCard(); return; }

      const p = points[currentIndex];
      // 直接从 localStorage 抓取最新数据，不管内存里有没有
      const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
      const realPoint = allPoints.find(x => x.id === p.id) || p;

      let pdfId = null;
      // 兼容多种可能的存储字段名
      if (realPoint.pdfFiles && realPoint.pdfFiles.length > 0) {
        pdfId = realPoint.pdfFiles[0].id;
      } else if (realPoint.pdfs && realPoint.pdfs.length > 0) {
        pdfId = realPoint.pdfs[0].id;
      } else if (realPoint.attachments) {
        const pdfAttach = realPoint.attachments.find(a => a.type === 'pdf' || (a.name && a.name.endsWith('.pdf')));
        if (pdfAttach) pdfId = pdfAttach.id || pdfAttach.pdfId;
      }

      if (pdfId) {
        window.location.hash = `#/pdf-viewer/${pdfId}?pointId=${p.id}`;
        touchBar.remove();
        window.onkeydown = null;
      } else {
        toastSuccess('当前卡片无 PDF');
      }
    } else if (e.key === '1' && isExpanded) { rateCurrent('forgot'); }
    else if (e.key === '2' && isExpanded) { rateCurrent('vague'); }
    else if (e.key === '3' && isExpanded) { rateCurrent('remember'); }
    else if (e.key === 'Escape') {
      cardElements.forEach(el => el.style.border = '1px solid rgba(0,0,0,.05)');
      touchBar.remove(); window.onkeydown = null;
    }
  };

  // 初始化高亮第一张
  highlightCard();
}

// ============ 万能 PDF 抓取 ============
function findPdfId(point) {
  if (!point) return null;

  // 1. 查老字段 pdfFiles
  if (point.pdfFiles && point.pdfFiles.length > 0) return point.pdfFiles[0].id;

  // 2. 查 pdfs 字段
  if (point.pdfs && point.pdfs.length > 0) return point.pdfs[0].id;

  // 3. 查 attachments
  if (point.attachments && point.attachments.length > 0) {
    const found = point.attachments.find(a => {
      const isPdfName = a.name && a.name.toLowerCase().endsWith('.pdf');
      const isPdfType = a.type === 'pdf';
      return isPdfName || isPdfType;
    });
    if (found) return found.id || found.pdfId;
  }

  // 4. 查 files（如果你的文件是存这里的）
  if (point.files && point.files.length > 0) {
    const found = point.files.find(a => {
      const isPdfName = a.name && a.name.toLowerCase().endsWith('.pdf');
      const isPdfType = a.type === 'pdf';
      return isPdfName || isPdfType;
    });
    if (found) return found.id || found.pdfId;
  }

  return null;
}