import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { fmtDate } from '../utils/date.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { mergeModal } from '../ui/mergeModal.js';
import { makeSortable } from '../ui/sortable.js';
import { dbGet } from '../db.js';

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
    if (chMulti) { chMulti = false; chSelected.clear(); renderChapterList({ params }); }
    else navigate('#/');
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
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并选中',
        onClick: async () => {
          if (chSelected.size < 2) { alert('至少选择 2 个章节'); return; }
          const ids = [...chSelected];
          const targetId = ids[0];
          const items = ids.map(id => store.getChapter(id));
          await mergeModal({
            title: '合并章节', items, targetId,
            onConfirm: (sourceIds, dedupe) => {
              store.mergeChapters(sourceIds, targetId, dedupe);
              toastSuccess('已合并');
              chMulti = false; chSelected.clear();
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
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📤 导出任务',
        onClick: () => showExportMenu('task', task.id),
      }),
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
      onClick: () => navigate(`#/edit/chapter/new?taskId=${task.id}`),
    }));
  }
}

function chapterCard(c, taskId) {
  const points = store.getPoints(c.id);
  const isSelected = chSelected.has(c.id);
  return el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': c.id,
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
      el('input', { type: 'checkbox', checked: isSelected, onChange: (e) => {
        if (e.target.checked) chSelected.add(c.id); else chSelected.delete(c.id);
        renderChapterList({ params: { taskId } });
      } }),
    ]) : null,
    el('div', { class: 'card-title', text: c.name }),
    el('div', { class: 'card-meta' }, [
      c.book ? el('span', { text: `📚 ${c.book}` }) : null,
      c.part ? el('span', { text: `📄 ${c.part}` }) : null,
      el('span', { text: `💡 ${points.length} 知识点` }),
    ]),
    !chMulti ? el('div', { class: 'card-actions' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '编辑', onClick: () => navigate(`#/edit/chapter/${c.id}`) }),
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
    ]) : null,
    !chMulti ? el('div', { class: 'move-btns' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '↑', onClick: (e) => { e.stopPropagation(); store.moveChapter(c.id, 'up'); renderChapterList({ params: { taskId } }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '↓', onClick: (e) => { e.stopPropagation(); store.moveChapter(c.id, 'down'); renderChapterList({ params: { taskId } }); } }),
    ]) : null,
  ]);
}

// ============ 章节详情 / 知识点列表 ============
let ptMulti = false;
const ptSelected = new Set();

export function renderChapterDetail({ params }) {
  const chapter = store.getChapter(params.id);
  if (!chapter) { navigate('#/'); return; }
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = ptMulti ? '选择知识点' : chapter.name;
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => {
    if (ptMulti) { ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); }
    else navigate(`#/chapter-list/${chapter.taskId}`);
  };

  view.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
    el('div', { class: 'card-title', text: chapter.name }),
    el('div', { class: 'card-meta' }, [
      chapter.book ? el('span', { text: `📚 ${chapter.book}` }) : null,
      chapter.part ? el('span', { text: `📄 ${chapter.part}` }) : null,
    ]),
    chapter.note ? el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginTop: '8px' }, text: chapter.note }) : null,
  ]));

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
      el('button', { class: 'btn btn-sm btn-primary', text: '全部记得', onClick: () => { store.batchRatePoints([...ptSelected], 'remember'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全部模糊', onClick: () => { store.batchRatePoints([...ptSelected], 'vague'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全部忘了', onClick: () => { store.batchRatePoints([...ptSelected], 'forgot'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderChapterDetail({ params }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '设难度', onClick: () => {
        const d = prompt('输入难记度 1-10', '5');
        if (d && Number(d) >= 1 && Number(d) <= 10) {
          store.batchUpdatePoints([...ptSelected], { difficulty: Number(d) });
          toastSuccess('已更新难度');
          ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
        }
      } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '今天复习', onClick: () => {
        store.batchUpdatePoints([...ptSelected], { nextReviewAt: new Date().toISOString() });
        toastSuccess('已设为今天复习');
        ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
      } }),
      el('button', { class: 'btn btn-sm btn-danger', text: '删除', onClick: async () => {
        if (ptSelected.size === 0) return;
        if (await confirmBox({ title: '删除', message: `删除 ${ptSelected.size} 个知识点？将进入回收站`, danger: true, confirmText: '删除' })) {
          store.batchDeletePoints([...ptSelected]);
          toastSuccess('已移入回收站');
          ptMulti = false; ptSelected.clear(); renderChapterDetail({ params });
        }
      } }),
    ]));
  } else {
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📤 导出本章',
        onClick: () => showExportMenu('chapter', chapter.id),
      }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '☑ 批量', onClick: () => { ptMulti = true; renderChapterDetail({ params }); } }),
    ]));
  }

  if (points.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '💡' }),
      el('div', { text: '还没有知识点' }),
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
      class: 'fab', text: '+', 'aria-label': '新建知识点',
      onClick: () => navigate(`#/edit/point/new?chapterId=${chapter.id}`),
    }));
  }
}

function pointCard(p, chapterId) {
  let expanded = false;
  const isSelected = ptSelected.has(p.id);

  // 图片缩略图
  const imageRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } });
  const allImageIds = [...(p.imageIds || []), ...(p.compositeImageIds || [])];
  if (allImageIds.length > 0) {
    allImageIds.forEach(imageId => {
      const thumb = el('div', {
        style: { width: '80px', height: '80px', borderRadius: '6px', overflow: 'hidden', background: '#f0f0f0', cursor: 'pointer', flexShrink: '0', position: 'relative' },
        onClick: async (e) => {
          e.stopPropagation();
          const img = await dbGet('images', imageId);
          if (!img) return;

          const mask = el('div', { class: 'confirm-mask' }, [
            el('div', { class: 'confirm-box', style: { maxWidth: '300px' } }, [
              el('h3', { text: '操作图片' }),
              el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' } }, [
                img.type === 'composite'
                  ? el('button', {
                      class: 'btn btn-ghost', text: '👁 预览',
                      onClick: () => {
                        mask.remove();
                        const blob = img.annotatedBlob || img.blob;
                        if (!blob) return;
                        const url = URL.createObjectURL(blob);
                        const preview = el('div', {
                          class: 'confirm-mask',
                          style: { zIndex: '500' },
                          onClick: () => { preview.remove(); URL.revokeObjectURL(url); },
                        }, [
                          el('img', { src: url, style: { maxWidth: '95vw', maxHeight: '95vh', borderRadius: '8px', objectFit: 'contain' } }),
                        ]);
                        document.body.appendChild(preview);
                      },
                    })
                  : el('button', {
                      class: 'btn btn-ghost', text: '✏️ 标注',
                      onClick: () => { mask.remove(); navigate(`#/annotate/${imageId}?pointId=${p.id}`); },
                    }),
                img.type !== 'composite' ? el('button', {
                  class: 'btn btn-ghost', text: '🔤 提取文字',
                  onClick: async () => {
                    mask.remove();
                    const { runOCR, renderOcrResult } = await import('../views/ocr.js');
                    const result = await runOCR(imageId);
                    if (result) await renderOcrResult(imageId, result.text, p.id);
                  },
                }) : null,
              ]),
              el('div', { class: 'confirm-actions', style: { marginTop: '12px' } }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
              ]),
            ]),
          ]);
          document.body.appendChild(mask);
        },
      });
      dbGet('images', imageId).then(img => {
        if (!img) return;
        const blob = img.annotatedBlob || img.originalBlob;
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        thumb.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) }));
        if (img.type === 'composite') {
          thumb.appendChild(el('div', { style: { position: 'absolute', top: '2px', left: '2px', background: 'rgba(59,130,246,.9)', color: '#fff', fontSize: '10px', padding: '1px 4px', borderRadius: '3px' }, text: '合成' }));
        }
      }).catch(() => {
        thumb.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '24px', color: '#ccc' }, text: '🖼' }));
      });
      imageRow.appendChild(thumb);
    });
  }

  // 录音列表
  const audioBlock = (p.audioIds && p.audioIds.length > 0)
    ? el('div', { style: { marginBottom: '8px' } }, [
      el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: '🎙 录音' }),
      ...p.audioIds.map(audioId => {
        const item = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', background: '#f9f9f9', borderRadius: '6px', marginBottom: '4px', fontSize: '13px' } });
        item.appendChild(el('span', { text: '🎙' }));
        item.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost', text: '▶ 播放',
          onClick: async (e) => {
            e.stopPropagation();
            try {
              const { dbGet } = await import('../db.js');
              const audio = await dbGet('audios', audioId);
              if (!audio || !audio.blob) {
                toastError('音频文件缺失，请重新录音');
                return;
              }
              const url = URL.createObjectURL(audio.blob);
              const player = new Audio();
              player.src = url;
              player.volume = 1;
              player.muted = true;
              try { await player.play(); } catch { }
              player.muted = false;
              player.currentTime = 0;
              await player.play().catch(err => toastError('播放失败：' + err.message));
            } catch (err) {
              toastError('播放出错：' + err.message);
            }
          },
        }));
        item.appendChild(el('button', {
          class: 'btn btn-sm btn-danger', text: '删除',
          onClick: async (e) => {
            e.stopPropagation();
            if (await confirmBox({ title: '删除录音', message: '删除后无法恢复', danger: true, confirmText: '删除' })) {
              const { removeAudio } = await import('./audio.js');
              removeAudio(audioId, p.id);
              renderChapterDetail({ params: { id: chapterId } });
            }
          },
        }));
        return item;
      }),
    ])
    : null;

  const detail = el('div', { class: 'point-detail hidden', style: { marginTop: '12px', borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: '12px' } }, [
    p.explanation ? el('div', { style: { marginBottom: '8px' } }, [
      el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: '解释' }),
      el('div', { text: p.explanation, style: { whiteSpace: 'pre-wrap' } }),
    ]) : null,
    allImageIds.length > 0 ? imageRow : null,
    el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📤 导出此知识点',
        onClick: (e) => { e.stopPropagation(); showExportMenu('point', p.id); },
      }),
    ]),
    audioBlock,
    el('div', { class: 'card-meta', style: { marginBottom: '8px' } }, [
      (p.manualReviewCount || p.reviewCount > 0) ? el('span', { text: `📚 已背 ${p.reviewCount} 遍` }) : null,
      el('span', { text: `🔥 难记度 ${p.difficulty}` }),
      (p.manualNextReviewAt || p.reviewCount > 0) ? el('span', { text: `📅 下次 ${fmtDate(p.nextReviewAt)}` }) : null,
      p.isErrorProne ? el('span', { text: '❗ 易错', style: { color: 'var(--danger)' } }) : null,
    ]),
    el('div', { class: 'card-actions' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '编辑', onClick: (e) => { e.stopPropagation(); navigate(`#/edit/point/${p.id}`); } }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: p.isErrorProne ? '取消易错' : '标记易错',
        onClick: (e) => { e.stopPropagation(); store.updatePoint(p.id, { isErrorProne: !p.isErrorProne }); renderChapterDetail({ params: { id: chapterId } }); },
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除',
        onClick: async (e) => {
          e.stopPropagation();
          if (await confirmBox({ title: '删除知识点', message: '将进入回收站，30 天内可恢复', danger: true, confirmText: '删除' })) {
            store.deletePoint(p.id);
            toastSuccess('已移入回收站');
            renderChapterDetail({ params: { id: chapterId } });
          }
        },
      }),
    ]),
  ]);

  const card = el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': p.id,
  }, [
    ptMulti ? el('div', { class: 'select-box' }, [
      el('input', { type: 'checkbox', checked: isSelected, onChange: (e) => {
        if (e.target.checked) ptSelected.add(p.id); else ptSelected.delete(p.id);
        renderChapterDetail({ params: { id: chapterId } });
      } }),
    ]) : null,
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' } }, [
      el('div', { style: { flex: 1, fontWeight: '600', whiteSpace: 'pre-wrap' }, text: p.content }),
      !ptMulti ? el('span', { style: { color: 'var(--text-2)', fontSize: '18px' }, text: '▾' }) : null,
    ]),
    (!ptMulti && allImageIds.length > 0) ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' }, text: `🖼 ${allImageIds.length} 张图片` }) : null,
    (!ptMulti && p.audioIds && p.audioIds.length > 0) ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: `🎙 ${p.audioIds.length} 条录音` }) : null,
    detail,
    !ptMulti ? el('div', { class: 'move-btns' }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '↑', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'up'); renderChapterDetail({ params: { id: chapterId } }); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '↓', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'down'); renderChapterDetail({ params: { id: chapterId } }); } }),
    ]) : null,
  ]);

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-actions') || e.target.closest('.point-detail') || e.target.closest('.move-btns') || e.target.closest('.select-box')) return;
    if (ptMulti) {
      if (ptSelected.has(p.id)) ptSelected.delete(p.id); else ptSelected.add(p.id);
      renderChapterDetail({ params: { id: chapterId } });
    } else {
      expanded = !expanded;
      detail.classList.toggle('hidden', !expanded);
    }
  });

  return card;
}