import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { openExportModal } from './settings.js';
import { dbPut, dbGet, dbDelete } from '../db.js';

export function renderErrorBook() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '❗ 错题本';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  // 获取所有易错知识点
  const allPoints = [];
  store.getTasks().forEach(t => {
    store.getChapters(t.id).forEach(c => {
      store.getPoints(c.id).forEach(p => {
        if (p.isErrorProne) {
          allPoints.push({ ...p, taskName: t.name, chapterName: c.name });
        }
      });
    });
  });

  // ================= 状态管理 =================
  let currentFilter = 'all'; // 错因过滤
  const collapsedChapters = new Set();

  function renderMain() {
    view.innerHTML = '';

    // ================= 1. 顶部工具栏（无论有没有错题，都要先渲染出来） =================
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' } }, [
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
        // 自行添加错题专属弹窗
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '➕ 新增错题', onClick: () => {
            const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
            const contentInput = el('textarea', { placeholder: '请输入错题内容（题目）...', style: { width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '10px', outline: 'none', resize: 'vertical' } });
            const explainInput = el('textarea', { placeholder: '请输入解析/答案（可选）...', style: { width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '10px', outline: 'none', resize: 'vertical' } });

            const box = el('div', { class: 'confirm-box', style: { maxWidth: '450px' } }, [
              el('h3', { text: '➕ 新增错题' }),
              el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '错题会自动进入专属收集箱，并打上易错标记。' }),
              contentInput,
              explainInput,
              el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                el('button', {
                  class: 'btn btn-primary', text: '保存到错题本',
                  onClick: async () => {
                    const val = contentInput.value.trim();
                    const exp = explainInput.value.trim();
                    if (!val) return toastError('错题内容不能为空');

                    // 1. 自动建任务和章节
                    let task = store.getTasks().find(t => t.name === '📥 错题收集箱');
                    if (!task) task = store.createTask({ name: '📥 错题收集箱' });

                    let chapter = store.getChapters(task.id)[0];
                    if (!chapter) chapter = store.createChapter({ name: '默认错题', taskId: task.id });

                    // 2. 创建知识点，并标记为易错
                    const newPoint = store.createPoint({
                      chapterId: chapter.id,
                      content: val,
                      explanation: exp,
                      isErrorProne: true,
                      errorReason: 'blind'
                    });

                    // 👇 核心修复：同步将这道错题生成为“资源总览”里的一个文本文档占位图
                    try {
                      const fakeImgId = crypto.randomUUID();
                      const textContent = `【错题】\n${val}\n\n【解析】\n${exp || '暂无解析'}`;
                      const blob = new Blob([textContent], { type: 'text/plain' });

                      // 存入 IndexedDB（直接调用 dbPut）
                      await dbPut('images', {
                        id: fakeImgId,
                        type: 'text_note',
                        name: `错题_${val.slice(0, 10)}...`,
                        originalBlob: blob,
                        annotatedBlob: blob,
                        width: 400, height: 300, dpr: 1,
                        group: '错题收集箱',
                        createdAt: new Date().toISOString()
                      });

                      // 关联到知识点
                      store.addImageToPoint(newPoint.id, fakeImgId);
                    } catch (err) {
                      console.error('同步到资源总览失败', err);
                      toastError('错题已保存，但同步资源库失败');
                    }

                    mask.remove();
                    toastSuccess('已保存到错题本');

                    // 👇 核心改动：不要用 location.reload()，而是重新渲染当前页面数据
                    renderErrorBook();
                  }
                })
              ])
            ]);
            mask.appendChild(box);
            document.body.appendChild(mask);
            setTimeout(() => contentInput.focus(), 100);
          }
        }),
        allPoints.length > 0 ? el('button', { class: 'btn btn-sm btn-primary', text: '🎯 开始重练', onClick: () => startRetrainMode() }) : null,
        allPoints.length > 0 ? el('button', { class: 'btn btn-sm btn-ghost', text: '🖨️ 导出打印', onClick: () => openExportModal(null, null, true) }) : null,
      ]),

      // 错因过滤器（如果没有错题，隐藏它）
      allPoints.length > 0 ? el('div', { style: { display: 'flex', gap: '4px', background: 'var(--bg)', padding: '4px', borderRadius: '8px' } }, [
        el('button', { class: 'btn btn-sm ' + (currentFilter === 'all' ? 'btn-primary' : 'btn-ghost'), text: '全部', onClick: () => { currentFilter = 'all'; renderMain(); } }),
        el('button', { class: 'btn btn-sm ' + (currentFilter === 'blind' ? 'btn-primary' : 'btn-ghost'), text: '盲区', onClick: () => { currentFilter = 'blind'; renderMain(); } }),
        el('button', { class: 'btn btn-sm ' + (currentFilter === 'careless' ? 'btn-primary' : 'btn-ghost'), text: '粗心', onClick: () => { currentFilter = 'careless'; renderMain(); } }),
      ]) : null
    ]));

    // ================= 2. 空状态处理 =================
    if (allPoints.length === 0) {
      view.appendChild(el('div', {
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          marginTop: '10vh', textAlign: 'center', color: 'var(--text-2)'
        }
      }, [
        el('div', { style: { fontSize: '48px', marginBottom: '16px', opacity: '0.8' }, text: '🎉' }),
        el('div', { style: { fontSize: '16px', fontWeight: '600', color: 'var(--text)' }, text: '太棒了！目前没有错题' }),
        el('div', { style: { fontSize: '13px', marginTop: '8px' }, text: '你可以去编辑卡片时，点击「❗ 标记易错」来收集错题。' })
      ]));
      return; // 空状态渲染完就结束
    }

    // ================= 3. 正常列表渲染 =================
    let filteredPoints = allPoints;
    if (currentFilter !== 'all') {
      filteredPoints = allPoints.filter(p => p.errorReason === currentFilter);
    }

    const grouped = {};
    filteredPoints.forEach(p => {
      const key = `${p.taskName} || ${p.chapterName}`;
      if (!grouped[key]) grouped[key] = { task: p.taskName, chapter: p.chapterName, items: [] };
      grouped[key].items.push(p);
    });

    if (Object.keys(grouped).length === 0) {
      view.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', padding: '40px' }, text: '当前分类下没有错题' }));
      return;
    }

    Object.values(grouped).forEach(group => {
      const isCollapsed = collapsedChapters.has(group.chapter);

      const section = el('div', { class: 'section', style: { marginBottom: '8px', border: '1px solid rgba(0,0,0,.04)' } });

      section.appendChild(el('div', {
        class: 'section-head',
        style: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between', padding: '10px 14px', minHeight: 'auto' },
        onClick: () => {
          if (isCollapsed) collapsedChapters.delete(group.chapter);
          else collapsedChapters.add(group.chapter);
          renderMain();
        }
      }, [
        el('span', { style: { fontSize: '14px', fontWeight: '600' }, text: `📖 ${group.task} - ${group.chapter} (${group.items.length})` }),
        el('span', { text: isCollapsed ? '▸' : '▾', style: { color: 'var(--text-2)' } })
      ]));

      if (!isCollapsed) {
        const body = el('div', { class: 'section-body', style: { padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' } });
        group.items.forEach(p => {
          body.appendChild(renderErrorCard(p));
        });
        section.appendChild(body);
      }

      view.appendChild(section);
    });
  }

  // ================= 4. 卡片渲染（极度紧凑版） =================
  // ================= 卡片渲染（错题专属紧凑版） =================
  function renderErrorCard(p) {
    let isExpanded = false;

    const card = el('div', {
      class: 'card',
      style: { padding: '10px 12px', marginBottom: '0', borderLeft: '3px solid var(--danger)', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg)' }
    });

    // 题目内容
    const titleEl = el('div', {
      style: { fontWeight: '600', fontSize: '14px', cursor: 'pointer', whiteSpace: 'pre-wrap', lineHeight: '1.4' },
      text: p.content,
      onClick: () => {
        isExpanded = !isExpanded;
        expandBox.style.display = isExpanded ? 'block' : 'none';
        toggleIcon.textContent = isExpanded ? '▾' : '▸';
      }
    });

    // 展开后的解析
    const expandBox = el('div', {
      style: { display: 'none', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(0,0,0,.1)' }
    });

    if (p.explanation) {
      expandBox.appendChild(el('div', {
        style: { fontSize: '13px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.02)', padding: '6px', borderRadius: '6px' },
        text: p.explanation
      }));
    } else {
      expandBox.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '（这道题还没有写解析，可以点下方“编辑”去补充）' }));
    }

    const toggleIcon = el('span', { text: '▸', style: { fontSize: '14px', color: 'var(--text-2)', marginLeft: '4px' } });

    // 顶部行
    const headerRow = el('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' } }, [
      el('div', { style: { display: 'flex', gap: '6px', flex: '1' } }, [titleEl, toggleIcon]),
      el('div', { style: { display: 'flex', gap: '4px' } }, [
        p.errorReason === 'blind' ? el('span', { style: { fontSize: '11px', background: 'rgba(142,202,230,0.2)', color: 'var(--primary-dark)', padding: '2px 6px', borderRadius: '4px' }, text: '📚' }) : null,
        p.errorReason === 'careless' ? el('span', { style: { fontSize: '11px', background: 'rgba(255,209,102,0.3)', color: '#B8860B', padding: '2px 6px', borderRadius: '4px' }, text: '✏️' }) : null
      ])
    ]);

    card.appendChild(headerRow);
    card.appendChild(expandBox);

    // 底部操作行
    card.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' } }, [
      el('div', { style: { display: 'flex', gap: '4px' } }, [
        // 这里放你之前写的“忘了”和“记得并消除”
        el('button', { class: 'btn btn-sm btn-ghost', style: { padding: '2px 8px', minHeight: '24px', fontSize: '12px' }, text: '😵 忘了', onClick: () => { store.ratePoint(p.id, 'forgot'); toastSuccess('已记录'); } }),
        el('button', {
          class: 'btn btn-sm btn-primary', style: { padding: '2px 8px', minHeight: '24px', fontSize: '12px' }, text: '😎 消除', onClick: () => {
            store.ratePoint(p.id, 'remember');
            store.updatePoint(p.id, { isErrorProne: false });
            toastSuccess('已移出错题本');
            allPoints.splice(allPoints.findIndex(item => item.id === p.id), 1);
            renderMain();
          }
        })
      ]),
      // 去详细编辑页（用于补充图片、录音等）
      el('button', { class: 'btn btn-sm btn-ghost', style: { padding: '2px 8px', minHeight: '24px', fontSize: '12px' }, text: '✏️ 编辑', onClick: () => navigate(`#/edit-point/${p.id}`) })
    ]));

    return card;
  }

  // ================= 沉浸式重练模式（保持不变） =================
  function startRetrainMode() {
    if (allPoints.length === 0) return;

    let idx = 0;
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'var(--bg)' } });
    const container = el('div', { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '20px', maxWidth: '800px', margin: '0 auto' } });
    mask.appendChild(container);

    function renderCard() {
      container.innerHTML = '';
      if (idx >= allPoints.length) {
        container.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: '1' } }, [
          el('div', { style: { fontSize: '48px', marginBottom: '16px' }, text: '👏' }),
          el('div', { style: { fontSize: '18px', fontWeight: '600' }, text: '错题重练完毕！' }),
          el('button', { class: 'btn btn-primary', style: { marginTop: '20px' }, text: '返回列表', onClick: () => { mask.remove(); renderMain(); } })
        ]));
        return;
      }

      const p = allPoints[idx];

      container.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px', textAlign: 'center' }, text: `第 ${idx + 1} / ${allPoints.length} 题` }));

      container.appendChild(el('div', { class: 'card', style: { flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center', fontSize: '20px', fontWeight: '600', whiteSpace: 'pre-wrap' }, text: p.content }));

      const actionArea = el('div', { style: { marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' } });
      container.appendChild(actionArea);

      let isAnswerShown = false;

      const showAnswerBtn = el('button', {
        class: 'btn btn-primary', text: '👁️ 显示解析 / 回忆答案',
        style: { padding: '16px', fontSize: '16px' },
        onClick: () => {
          isAnswerShown = true;
          actionArea.innerHTML = '';

          if (p.explanation) {
            container.appendChild(el('div', { style: { marginTop: '16px', padding: '16px', background: 'var(--bg)', borderRadius: '8px', fontSize: '15px', whiteSpace: 'pre-wrap' }, text: p.explanation }));
          }

          actionArea.appendChild(el('div', { style: { display: 'flex', gap: '10px' } }, [
            el('button', { class: 'btn btn-danger', text: '😵 忘了', style: { flex: '1' }, onClick: () => { store.ratePoint(p.id, 'forgot'); idx++; renderCard(); } }),
            el('button', {
              class: 'btn btn-primary', text: '😎 记得并消除', style: { flex: '1' }, onClick: () => {
                store.ratePoint(p.id, 'remember');
                store.updatePoint(p.id, { isErrorProne: false });
                idx++; renderCard();
              }
            })
          ]));
        }
      });

      if (!isAnswerShown) {
        actionArea.appendChild(showAnswerBtn);
      }

      container.appendChild(el('div', { style: { marginTop: 'auto', paddingTop: '20px', textAlign: 'center' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '退出重练', onClick: () => { mask.remove(); renderMain(); } })
      ]));
    }

    renderCard();
    document.body.appendChild(mask);
  }

  renderMain();
}