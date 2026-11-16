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


function parseLinks(html) {
  if (!html) return html;
  
  // 1. 处理双向链接（保留你之前的逻辑）
  const regex = /<span class="editor-link"[^>]*data-link="(\[\[(?:folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\])"[^>]*>(.*?)<\/span>|\[\[(folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\]/g;
  
  // 👇 核心修复：一定要有 resultHtml 这个变量，并赋初始值
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
      // 【合并选中章节】
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并选中',
        onClick: async () => {
          // 至少选 2 个章节才能合并
          if (chSelected.size < 2) { alert('至少选择 2 个章节'); return; }
          const ids = [...chSelected];
          const targetId = ids[0];  // 第一个作为主章节
          const items = ids.map(id => store.getChapter(id));
          await mergeModal({
            title: '合并章节', items, targetId,
            // onConfirm 接收：源 id 列表、去重、新名称、排序方式、合并方式
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
    // 👇 章节专属附件提示区
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
      // 👇 删除按钮
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

export function renderChapterDetail({ params, query }) {
  const chapterId = params.id;
  const chapter = store.getChapter(chapterId);
  const safeQuery = query || {};

  localStorage.setItem('kg_last_chapter_id', chapterId);
  if (!chapter) { navigate('#/'); return; }

  const view = document.getElementById('view');
  clear(view);

  // 直接通过当前章节找到它所属的文件夹（Task），用文件夹的名字！
  const currentTask = store.getTask(chapter.taskId);
  const displayTitle = currentTask ? currentTask.name : chapter.name;

  document.getElementById('page-title').textContent = ptMulti ? '批量选择' : displayTitle;

  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => {
    if (ptMulti) { ptMulti = false; ptSelected.clear(); renderChapterDetail({ params, query }); }
    else navigate(`#/`);
  };



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
      // 合并选中的知识点
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并选中',
        onClick: async () => {
          // 至少选 2 个才能合并
          if (ptSelected.size < 2) { alert('至少选择 2 个知识点'); return; }
          const ids = [...ptSelected];
          const targetId = ids[0];  // 第一个作为主项
          const items = ids.map(id => store.getPoint(id));
          await mergeModal({
            title: '合并知识点', items, targetId,
            onConfirm: (sourceIds, dedupe, newName, sortMode, mergeMode) => {
              store.mergePoints(sourceIds, targetId, dedupe, newName, sortMode, mergeMode);
              toastSuccess('已合并');
              ptMulti = false; ptSelected.clear();
              renderChapterDetail({ params });
            },
          });
        },
      }),
      // 👇 新增：复制选中
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📋 复制',
        onClick: () => {
          if (ptSelected.size === 0) return toastError('请先勾选卡片');
          const points = [...ptSelected].map(id => store.getPoint(id)).filter(Boolean);
          localStorage.setItem('kg_clipboard_points', JSON.stringify(points));
          toastSuccess(`已复制 ${points.length} 张卡片`);
        }
      }),

      // 👇 新增：粘贴到当前
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 粘贴',
        onClick: async () => {
          const raw = localStorage.getItem('kg_clipboard_points');
          if (!raw) return toastError('剪贴板为空');
          const points = JSON.parse(raw);
          
          if (await confirmBox({ title: '粘贴卡片', message: `确定要将 ${points.length} 张卡片粘贴到当前文件夹吗？` })) {
            points.forEach(p => {
              // 生成新的 ID 和归属，避免覆盖原卡片
              store.createPoint({
                chapterId: chapterId,
                content: p.content,
                explanation: p.explanation,
                difficulty: p.difficulty,
                imageIds: p.imageIds
              });
            });
            toastSuccess('粘贴成功');
            ptMulti = false;
            ptSelected.clear();
            renderChapterDetail({ params });
          }
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
            toastSuccess('已更新难度');
            ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
          }
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '今天复习', onClick: () => {
          store.batchUpdatePoints([...ptSelected], { nextReviewAt: new Date().toISOString() });
          toastSuccess('已设为今天复习');
          ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除', onClick: async () => {
          if (ptSelected.size === 0) return;
          if (await confirmBox({ title: '删除', message: `删除 ${ptSelected.size} 个知识点？将进入回收站`, danger: true, confirmText: '删除' })) {
            store.batchDeletePoints([...ptSelected]);
            toastSuccess('已移入回收站');
            ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
          }
        }
      }),
    ]));
  } else {
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '🎯 开始复习',
        onClick: () => {
          // 👇 弹出模式选择
          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px', textAlign: 'center' } }, [
            el('h3', { text: '选择复习模式', style: { marginBottom: '16px' } }),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
              el('button', {
                class: 'btn btn-primary', text: '🖥️ 沉浸式模式 (全屏大字)', onClick: () => {
                  mask.remove();
                  startReviewMode(points, chapter.id);
                }
              }),
              el('button', {
                class: 'btn btn-ghost', text: '📋 专注列表模式 (在原列表操作)', onClick: () => {
                  mask.remove();
                  startFocusListMode(points, chapter.id);
                }
              }),
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
      sessionStorage.removeItem('scroll_y_chapter'); // 恢复完就清掉
    }, 50);
  }
}

// ============ 极简卡片渲染 ============
function pointCard(p, chapterId) {
  let isExpanded = false;
  const isSelected = ptSelected.has(p.id);

  // 展开的内容区（初始隐藏）
  const contentBox = el('div', {
    style: { display: 'none', marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(0,0,0,.1)' }
  });

  // 卡片主体
  const card = el('div', {
    class: 'card point-card-content' + (isSelected ? ' selected' : ''),
    style: {
      cursor: 'pointer',
      padding: '12px 16px',
      transition: 'all 0.2s',
      background: 'var(--card)',
      borderRadius: '10px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: 'auto'
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

      // 👇 切换折叠状态
      isExpanded = !isExpanded;
      contentBox.style.display = isExpanded ? 'block' : 'none';
    }
  }, [
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' } }, [
      // 左侧：多选框 + 内容标题
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', flex: '1' } }, [
        ptMulti ? el('input', {
          type: 'checkbox', checked: isSelected, style: { marginTop: '4px', flexShrink: '0' },
          onChange: (e) => {
            if (e.target.checked) ptSelected.add(p.id); else ptSelected.delete(p.id);
            renderChapterDetail({ params: { id: chapterId } });
          }
        }) : null,
        el('div', {
          style: {
            fontSize: '15px',
            fontWeight: '600',
            whiteSpace: 'pre-wrap',
            lineHeight: '1.5',
            wordBreak: 'break-word'
          },
          // 👇 这里保留 parseLinks，方便主标题如果有链接也能解析
          innerHTML: parseLinks(p.content) 
        })
      ]),

      // 右侧：标签（难记度、背记数）
      (() => {
        const allPts = JSON.parse(localStorage.getItem('kg_points') || '[]');
        const freshP = allPts.find(x => x.id === p.id) || p;
        const showDiff = freshP.showDifficultyBeforeExpand === true || freshP.showDifficultyBeforeExpand === 'true';
        const showCount = freshP.showReviewCountBeforeExpand === true || freshP.showReviewCountBeforeExpand === 'true';

        if (!showDiff && !showCount) return null;

        const tagBox = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'nowrap', flexShrink: '0', alignItems: 'center' } });

        if (showDiff) {
          const diff = freshP.difficulty || 5;
          tagBox.appendChild(el('span', {
            style: { padding: '2px 8px', background: diff >= 8 ? 'var(--danger)' : diff >= 5 ? 'var(--warn)' : 'var(--green)', color: '#fff', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' },
            text: `难:${diff}`
          }));
        }

        if (showCount) {
          tagBox.appendChild(el('span', {
            style: { padding: '2px 8px', background: 'var(--primary)', color: '#fff', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' },
            text: `背:${freshP.reviewCount || 0}`
          }));
        }

        return tagBox;
      })()
    ])
  ]);

  // 展开后的详细内容
  if (p.explanation) {
    const bgStyle = p.themeBg || 'rgba(0,0,0,0.02)';

    contentBox.appendChild(el('div', {
      style: {
        fontSize: '14px',
        color: 'var(--text-2)',
        marginBottom: '12px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: bgStyle,
        padding: '12px',
        borderRadius: '8px',
        lineHeight: '1.6'
      },
      innerHTML: parseLinks(p.explanation)
    }));
  }

  const footerRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', gap: '8px' } });

  if (p.imageIds && p.imageIds.length > 0) {
    footerRow.appendChild(el('div', {
      style: { fontSize: '13px', color: 'var(--primary)', fontWeight: '600' },
      text: `🖼 包含 ${p.imageIds.length} 张图文附件`
    }));
  } else {
    footerRow.appendChild(el('div'));
  }

  const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn btn-sm btn-ghost', text: '✏️ 编辑', onClick: (e) => { e.stopPropagation(); navigate(`#/edit-point/${p.id}`); } }),
    el('button', {
      class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async (e) => {
        e.stopPropagation();
        if (await confirmBox({ title: '删除卡片', message: '确定删除这张卡片吗？', danger: true, confirmText: '删除' })) {
          store.deletePoint(p.id);
          toastSuccess('已移入回收站');
          renderChapterDetail({ params: { id: chapterId } });
        }
      }
    }),
    el('button', { class: 'btn btn-sm btn-ghost', text: '⬆️', title: '上移', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'up'); renderChapterDetail({ params: { id: chapterId } }); } }),
    el('button', { class: 'btn btn-sm btn-ghost', text: '⬇️', title: '下移', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'down'); renderChapterDetail({ params: { id: chapterId } }); } })
  ]);

  footerRow.appendChild(actions);
  contentBox.appendChild(footerRow);

  card.appendChild(header);
  card.appendChild(contentBox);

  const container = el('div', {
    class: 'point-card-container',
    style: { marginBottom: '6px' }
  }, [card]);

  return container;
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

      // 👇 2. 打开 PDF 按钮
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
    // 👇 暂停复习快捷键，防止按 ESC 时直接退出复习
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

    // 👇 加入 ESC 监听
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
    
    // 👇 错题本联动：如果你之前在这个卡片里插入过 ❝ 引用块，那么它会被自动高亮或在错题本展示
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
    // 👇 暂停复习快捷键
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

    // 👇 加入 ESC 监听
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