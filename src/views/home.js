import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { dbGet } from '../db.js';
import { showPasteOptionsModal } from './importDoc.js';

// ============ 文件夹折叠状态 ============
function getCollapsedFolders() {
  try { return new Set(JSON.parse(localStorage.getItem('kg_collapsed_folders') || '[]')); }
  catch { return new Set(); }
}
let collapsedFolders = getCollapsedFolders();

function toggleFolderCollapse(id) {
  if (collapsedFolders.has(id)) collapsedFolders.delete(id);
  else collapsedFolders.add(id);
  localStorage.setItem('kg_collapsed_folders', JSON.stringify([...collapsedFolders]));
  renderHome();
}

// ============ 散落卡片折叠状态 ============
function getInboxCollapsed() {
  return localStorage.getItem('kg_inbox_collapsed') === 'true';
}
function setInboxCollapsed(val) {
  localStorage.setItem('kg_inbox_collapsed', val);
}

// 全局（文件夹）多选状态
let multiSelectMode = false;
const selectedIds = new Set();

// 散落卡片独立的专属多选状态
let cardMultiMode = false;
const selectedCardIds = new Set();

export function renderHome() {
  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = multiSelectMode ? '选择任务' : '资料库';
  document.getElementById('btn-back').classList.add('hidden');

  // 1. 今日待复习
  const due = store.getDuePoints();
  if (!multiSelectMode && due.length > 0) {
    const isDueHidden = localStorage.getItem('kg_hide_due_banner') === 'true';
    if (!isDueHidden) {
      view.appendChild(el('div', { class: 'banner banner-warn', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } }, [
        el('span', { text: `📌 今日待复习 ${due.length} 个知识点`, style: { flex: '1', minWidth: '120px' } }),
        el('button', { class: 'btn btn-sm btn-primary', text: '待复习管理', onClick: () => navigate('#/review') }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '快速设置', onClick: () => openDueManager(due) }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '✕', title: '隐藏提示',
          style: { padding: '2px 8px', color: 'var(--text-2)' },
          onClick: () => {
            localStorage.setItem('kg_hide_due_banner', 'true');
            renderHome();
          }
        }),
      ]));
    }
  }

  // 2. 获取数据
  const tasks = store.getTasks();
  const scatteredPoints = store.getPoints(null).filter(p => !p.chapterId);

  if (!multiSelectMode) {
    // ================== 3. 渲染散落卡片 ==================
    if (scatteredPoints.length > 0) {
      const isCollapsed = getInboxCollapsed();

      // 标题栏 + 专属工具栏
      view.appendChild(el('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px', flexWrap: 'wrap', gap: '8px' }
      }, [
        el('div', {
          style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' },
          onClick: () => { setInboxCollapsed(!isCollapsed); renderHome(); }
        }, [
          el('span', { text: isCollapsed ? '▸' : '▾' }),
          el('span', { text: `📄 散落卡片 (${scatteredPoints.length})` })
        ]),

        // 散落卡片专属工具栏
        el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm ' + (cardMultiMode ? 'btn-danger' : 'btn-ghost'),
            text: cardMultiMode ? '✕ 退出多选' : '☑ 多选',
            onClick: () => {
              cardMultiMode = !cardMultiMode;
              if (!cardMultiMode) selectedCardIds.clear();
              renderHome();
            }
          }),

          cardMultiMode ? el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
            // 全选 / 全不选
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '全选',
              onClick: () => { scatteredPoints.forEach(p => selectedCardIds.add(p.id)); renderHome(); }
            }),
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '全不选',
              onClick: () => { scatteredPoints.forEach(p => selectedCardIds.delete(p.id)); renderHome(); }
            }),

            // 复制
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '📋 复制',
              onClick: () => {
                if (selectedCardIds.size === 0) return toastError('请先勾选卡片');
                const items = scatteredPoints.filter(p => selectedCardIds.has(p.id));
                localStorage.setItem('kg_clipboard_points', JSON.stringify(items));
                toastSuccess(`已复制 ${items.length} 张卡片`);
              }
            }),

            // 粘贴
            el('button', {
              class: 'btn btn-sm btn-ghost', text: '📥 粘贴',
              onClick: () => {
                const raw = localStorage.getItem('kg_clipboard_points');
                if (!raw) return toastError('剪贴板为空');
                const points = JSON.parse(raw);
                import('./importDoc.js').then(({ showPasteOptionsModal }) => {
                  showPasteOptionsModal(
                    async (finalChapterId, finalTaskId, targetName) => {
                      if (!finalChapterId) return toastError('请选择目标文件夹');
                      if (await confirmBox({ title: '粘贴卡片', message: `确定要将 ${points.length} 张卡片粘贴到「${targetName}」吗？` })) {
                        points.forEach(p => {
                          store.createPoint({ chapterId: finalChapterId, content: p.content, explanation: p.explanation, difficulty: p.difficulty, imageIds: p.imageIds });
                        });
                        toastSuccess('粘贴成功');
                        selectedCardIds.clear(); renderHome();
                      }
                    }, null, null, '粘贴'
                  );
                });
              }
            }),

            // 移入文件夹
            (selectedCardIds.size > 0) ? el('button', {
              class: 'btn btn-sm btn-primary', text: `📁 移入 (${selectedCardIds.size})`,
              onClick: () => {
                import('./importDoc.js').then(({ showPasteOptionsModal }) => {
                  showPasteOptionsModal(
                    async (finalChapterId, finalTaskId, targetName) => {
                      if (!finalChapterId) return toastError('请选择目标文件夹');
                      if (await confirmBox({ title: '移入', message: `确定将 ${selectedCardIds.size} 张卡片移入「${targetName}」吗？` })) {
                        selectedCardIds.forEach(id => store.updatePoint(id, { chapterId: finalChapterId }));
                        toastSuccess('已移入');
                        selectedCardIds.clear(); renderHome();
                      }
                    }, null, null, '移动'
                  );
                });
              }
            }) : null,

            // 删除
            (selectedCardIds.size > 0) ? el('button', {
              class: 'btn btn-sm btn-danger', text: `🗑 删除 (${selectedCardIds.size})`,
              onClick: async () => {
                if (!confirm(`确定删除选中的 ${selectedCardIds.size} 张散落卡片吗？`)) return;
                selectedCardIds.forEach(id => store.deletePoint(id));
                toastSuccess('已移入回收站');
                selectedCardIds.clear();
                cardMultiMode = false;
                renderHome();
              }
            }) : null
          ]) : null
        ])
      ]));

      // 散落卡片网格渲染
      if (!isCollapsed) {
        const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', marginBottom: '24px' } });

        scatteredPoints.forEach(p => {
          const isSelected = selectedCardIds.has(p.id);

          grid.appendChild(el('div', {
            class: 'card',
            style: {
              position: 'relative', cursor: 'pointer', padding: '16px', margin: '0',
              border: '1px solid rgba(0,0,0,.05)',
              display: 'flex', gap: '8px', alignItems: 'flex-start',
              opacity: (cardMultiMode && !isSelected) ? '0.6' : '1'
            },
            onClick: (e) => {
              if (e.target.closest('.del-btn') || e.target.closest('input')) return;

              if (cardMultiMode) {
                if (isSelected) selectedCardIds.delete(p.id); else selectedCardIds.add(p.id);
                renderHome();
              } else {
                navigate(`#/edit-point/${p.id}`);
              }
            }
          }, [
            // 专属多选框
            cardMultiMode ? el('input', {
              type: 'checkbox',
              checked: isSelected,
              style: { marginTop: '4px', width: '18px', height: '18px', accentColor: 'var(--danger)' },
              onClick: (e) => e.stopPropagation(),
              onChange: (e) => {
                if (e.target.checked) selectedCardIds.add(p.id);
                else selectedCardIds.delete(p.id);
                renderHome();
              }
            }) : null,

            // 内容
            el('div', { style: { flex: '1' } }, [
              el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px', whiteSpace: 'pre-wrap' }, text: p.content.replace(/<[^>]+>/g, '').slice(0, 100) + (p.content.length > 100 ? '...' : '') }),
              el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: new Date(p.createdAt).toLocaleDateString() })
            ]),

            // 悬浮删除按钮
            !cardMultiMode ? el('button', {
              class: 'btn btn-sm btn-ghost del-btn',
              style: { position: 'absolute', top: '8px', right: '8px', padding: '4px', color: 'var(--danger)', opacity: '0.6' },
              text: '🗑',
              title: '删除此卡片',
              onClick: async (e) => {
                e.stopPropagation();
                if (await confirmBox({ title: '删除卡片', message: '确定要删除这张散落卡片吗？', danger: true, confirmText: '删除' })) {
                  store.deletePoint(p.id);
                  toastSuccess('已删除');
                  renderHome();
                }
              }
            }) : null
          ]));
        });

        view.appendChild(grid);
      }
    }

    // ================== 4. 渲染文件夹（专题） ==================
    if (tasks.length > 0) {
      // 标题栏
      view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 6px' } }, [
        el('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-2)' }, text: '📁 我的文件夹' }),
        el('button', {
          class: `btn btn-sm ${multiSelectMode ? 'btn-danger' : 'btn-ghost'}`,
          text: multiSelectMode ? '✖ 退出管理' : '⚙️ 管理',
          onClick: () => {
            multiSelectMode = !multiSelectMode;
            selectedIds.clear();
            renderHome();
          }
        })
      ]));

      // 文件夹批量操作栏
      if (multiSelectMode) {
        view.appendChild(el('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', background: 'rgba(239,71,111,0.08)', borderRadius: '10px', marginBottom: '12px', border: '1px solid rgba(239,71,111,0.2)' }
        }, [
          el('div', { style: { width: '100%', fontSize: '13px', fontWeight: '600', color: 'var(--danger)', marginBottom: '4px' } }, [
            `已选中 ${selectedIds.size} 个文件夹`
          ]),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { tasks.forEach(t => selectedIds.add(t.id)); renderHome(); } }),
          el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selectedIds.clear(); renderHome(); } }),
          el('button', { class: 'btn btn-sm btn-danger', text: '✖ 退出管理', onClick: () => { multiSelectMode = false; selectedIds.clear(); renderHome(); } }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => {
              if (selectedIds.size === 0) return toastError('请先勾选文件夹');
              const items = tasks.filter(t => selectedIds.has(t.id));
              localStorage.setItem('kg_clipboard_folders', JSON.stringify(items));
              toastSuccess(`已复制 ${items.length} 个文件夹`);
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '📥 粘贴', onClick: () => {
              const raw = localStorage.getItem('kg_clipboard_folders');
              if (!raw) return toastError('剪贴板里没有文件夹');
              import('./importDoc.js').then(({ showPasteOptionsModal }) => {
                showPasteOptionsModal(
                  (finalChapterId, finalTaskId, targetName) => {
                    const folders = JSON.parse(raw);
                    toastSuccess(`正在粘贴到 ${targetName}...`);
                    folders.forEach(f => store.copyTask(f.id, finalTaskId));
                    setTimeout(() => { selectedIds.clear(); renderHome(); }, 500);
                  }, null, null, '粘贴'
                );
              });
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '🚚 移动', onClick: () => {
              if (selectedIds.size === 0) return toastError('请先勾选文件夹');
              import('./importDoc.js').then(({ showPasteOptionsModal }) => {
                showPasteOptionsModal(
                  (finalChapterId, finalTaskId, targetName) => {
                    selectedIds.forEach(id => {
                      if (id === finalTaskId) return;
                      store.updateTask(id, { parentId: finalTaskId });
                    });
                    toastSuccess(`已移动 ${selectedIds.size} 个文件夹到 ${targetName}`);
                    selectedIds.clear(); renderHome();
                  }, null, null, '移动'
                );
              });
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async () => {
              if (selectedIds.size === 0) return toastError('请先勾选');
              if (await confirmBox({ title: '删除文件夹', message: `确定删除选中的 ${selectedIds.size} 个文件夹吗？` })) {
                selectedIds.forEach(id => store.deleteTask(id));
                selectedIds.clear(); renderHome(); toastSuccess('已删除');
              }
            }
          })
        ]));
      }

      // 渲染文件夹列表
      const list = el('div', { id: 'task-list' });
      const renderTree = (parentId, depth) => {
        tasks.filter(t => (t.parentId || null) === parentId).forEach(t => {
          const wrapper = el('div', {
            style: {
              marginLeft: depth === 0 ? '0' : '24px',
              position: 'relative',
              borderLeft: depth > 0 ? '2px dashed rgba(142,202,230,0.3)' : 'none',
              paddingLeft: depth > 0 ? '12px' : '0',
              marginBottom: '4px'
            }
          });
          wrapper.appendChild(taskCard(t));
          list.appendChild(wrapper);
          if (!collapsedFolders.has(t.id)) renderTree(t.id, depth + 1);
        });
      };
      renderTree(null, 0);
      view.appendChild(list);
    }

    // 5. 全空占位图
    if (tasks.length === 0 && scatteredPoints.length === 0) {
      view.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-icon', text: '📚' }),
        el('div', { text: '资料库空空如也' }),
        el('div', { text: '点击右下角 + 新建卡片', style: { fontSize: '13px', marginTop: '8px' } }),
      ]));
    }
  } else {
    // ================== 6. 全局批量模式下的逻辑 ==================
    view.appendChild(el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', background: 'rgba(239,71,111,0.08)', borderRadius: '10px', marginBottom: '12px', border: '1px solid rgba(239,71,111,0.2)' }
    }, [
      el('div', { style: { width: '100%', fontSize: '13px', fontWeight: '600', color: 'var(--danger)', marginBottom: '4px' } }, [
        `已选中 ${selectedIds.size} 个文件夹`
      ]),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { tasks.forEach(t => selectedIds.add(t.id)); renderHome(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selectedIds.clear(); renderHome(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '✖ 取消', onClick: () => { multiSelectMode = false; selectedIds.clear(); renderHome(); } }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => {
          if (selectedIds.size === 0) return toastError('请先勾选文件夹');
          const items = tasks.filter(t => selectedIds.has(t.id));
          localStorage.setItem('kg_clipboard_folders', JSON.stringify(items));
          toastSuccess(`已复制 ${items.length} 个文件夹`);
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 粘贴', onClick: () => {
          const raw = localStorage.getItem('kg_clipboard_folders');
          if (!raw) return toastError('剪贴板里没有文件夹');
          import('./importDoc.js').then(({ showPasteOptionsModal }) => {
            showPasteOptionsModal((finalChapterId, finalTaskId, targetName) => {
              const folders = JSON.parse(raw);
              toastSuccess(`正在粘贴到 ${targetName}...`);
              folders.forEach(f => store.copyTask(f.id, finalTaskId));
              setTimeout(() => { selectedIds.clear(); renderHome(); }, 500);
            }, null, null, '粘贴');
          });
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🚚 移动', onClick: () => {
          if (selectedIds.size === 0) return toastError('请先勾选文件夹');
          import('./importDoc.js').then(({ showPasteOptionsModal }) => {
            showPasteOptionsModal((finalChapterId, finalTaskId, targetName) => {
              selectedIds.forEach(id => {
                if (id === finalTaskId) return;
                store.updateTask(id, { parentId: finalTaskId });
              });
              toastSuccess(`已移动 ${selectedIds.size} 个文件夹到 ${targetName}`);
              selectedIds.clear(); renderHome();
            }, null, null, '移动');
          });
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async () => {
          if (selectedIds.size === 0) return toastError('请先勾选');
          if (await confirmBox({ title: '删除文件夹', message: `确定删除选中的 ${selectedIds.size} 个文件夹吗？` })) {
            selectedIds.forEach(id => store.deleteTask(id));
            selectedIds.clear(); renderHome(); toastSuccess('已删除');
          }
        }
      })
    ]));

    const list = el('div', { id: 'task-list' });
    const renderTree = (parentId, depth) => {
      tasks.filter(t => (t.parentId || null) === parentId).forEach(t => {
        list.appendChild(taskCard(t));
        if (!collapsedFolders.has(t.id)) renderTree(t.id, depth + 1);
      });
    };
    renderTree(null, 0);
    view.appendChild(list);
  }

  // 7. 右下角 + 号（新建卡片）
  if (!multiSelectMode) {
    view.appendChild(el('button', {
      class: 'fab', text: '+', 'aria-label': '新建卡片',
      style: { zIndex: 99999, fontSize: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      onClick: () => navigate('#/edit-point/new'),
    }));
  }

  renderSidebar();
}

function taskCard(task) {
  const isSelected = selectedIds.has(task.id);
  const subFolders = store.getTasks().filter(t => t.parentId === task.id);
  const hasSub = subFolders.length > 0;
  const isCollapsed = collapsedFolders.has(task.id);

  const chapters = store.getChapters(task.id);
  const chapterIds = chapters.map(c => c.id);
  const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
  const pointCount = allPoints.filter(p => chapterIds.includes(p.chapterId) && !p.deletedAt).length;

  return el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': task.id,
    style: {
      display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'pointer', marginBottom: '8px',
      //在管理模式下，选中时给个红框
      border: (multiSelectMode && isSelected) ? '1px solid var(--danger)' : '',
      background: (multiSelectMode && isSelected) ? 'rgba(239,71,111,0.05)' : ''
    },
    onClick: (e) => {
      if (e.target.closest('.card-actions') || e.target.closest('.select-box') || e.target.closest('.toggle-btn')) return;

      if (multiSelectMode) {
        if (selectedIds.has(task.id)) selectedIds.delete(task.id);
        else selectedIds.add(task.id);
        renderHome();
      } else {
        // 👇 核心修改：点击文件夹时，永远抓取或创建一个“默认”章节，直接进去
        let targetChapterId;
        const defaultChapter = chapters.find(c => c.name === '默认' || c.name === '默认子模块' || c.name === '📁');

        if (defaultChapter) {
          targetChapterId = defaultChapter.id;
        } else if (chapters.length > 0) {
          // 如果没有默认章节，但里面已经有了旧章节，就顺延使用第一个
          targetChapterId = chapters[0].id;
        } else {
          // 如果是个空文件夹，自动建个不可见的“默认”章节
          targetChapterId = store.createChapter({ name: '默认', taskId: task.id }).id;
        }

        // 直接跳转，不提示什么子模块
        navigate(`#/chapter/${targetChapterId}?taskName=${encodeURIComponent(task.name)}`);
      }
    },
  }, [
    // 头部区（多选时隐藏右侧操作按钮）
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', flex: '1', minWidth: 0 } }, [

        // 多选模式下的勾选框
        multiSelectMode ? el('div', {
          class: 'select-box',
          style: { marginRight: '10px', display: 'flex', alignItems: 'center', height: '20px' }
        }, [
          el('input', {
            type: 'checkbox',
            checked: isSelected,
            style: {
              width: '18px', height: '18px',
              accentColor: 'var(--danger)',
              pointerEvents: 'none', // 让点击事件交给外层卡片，这里只负责显示
              margin: 0
            }
          }),
        ]) : (hasSub ? el('span', {
          class: 'toggle-btn',
          style: { cursor: 'pointer', color: 'var(--text-2)', fontSize: '14px', padding: '4px 8px 4px 0', userSelect: 'none' },
          text: isCollapsed ? '▸' : '▾',
          onClick: (e) => { e.stopPropagation(); toggleFolderCollapse(task.id); }
        }) : el('span', { style: { width: '22px', display: 'inline-block' } })),
        el('div', {
          class: 'card-title',
          style: {
            display: 'flex', alignItems: 'center', gap: '6px',
            overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: '600'
          }
        }, [
          // 渲染多个标签
          ...(task.statusTags || (task.statusIcon ? [{ text: task.statusIcon, color: task.statusColor }] : [])).map(tag =>
            el('span', {
              style: {
                color: tag.color || '#ff4757',
                fontSize: '12px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'transparent', // 👈 强制透明
                border: `1px solid ${tag.borderColor !== undefined ? tag.borderColor : (tag.color || '#ff4757')}`,
                flexShrink: 0,
                lineHeight: 1.2,
                fontWeight: '500'
              },
              innerHTML: tag.html || tag.text
            })
          ),

          // 标题文本
          el('span', { text: `📁 ${task.name}`, style: { overflow: 'hidden', textOverflow: 'ellipsis' } })
        ])
      ]),

      // 非多选模式下，才显示右侧的编辑、删除等按钮
      !multiSelectMode ? el('div', { class: 'card-actions', style: { display: 'flex', gap: '4px' } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '🏷️', title: '管理状态标签',
          onClick: (e) => {
            e.stopPropagation(); // 阻止触发卡片点击
            showStatusTagManager(task);
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '➕📁', title: '新建子文件夹',
          onClick: () => {
            const name = prompt('输入子文件夹名称：');
            if (name && name.trim()) {
              store.createTask({ name: name.trim(), parentId: task.id });
              toastSuccess('子文件夹已创建');
              renderHome();
            }
          }
        }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', title: '编辑文件夹', onClick: () => navigate(`#/edit-task/${task.id}`) }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '🗑', title: '删除文件夹', style: { color: 'var(--danger)' },
          onClick: async () => {
            if (await confirmBox({ title: '删除文件夹', message: `「${task.name}」及其卡片将进入回收站`, danger: true, confirmText: '删除' })) {
              store.deleteTask(task.id);
              toastSuccess('已移入回收站');
              renderHome();
            }
          },
        }),
      ]) : null
    ]),

    // 笔记
    task.note ? el('div', { style: { fontSize: '13px', color: 'var(--text-2)', paddingLeft: multiSelectMode ? '28px' : '0' }, text: task.note }) : null,

    // 底部统计（多选时如果觉得碍眼，也可以隐藏）
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', paddingLeft: multiSelectMode ? '28px' : '0' } }, [
      el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: `💡 ${pointCount} 张卡片` }),
      hasSub ? el('span', { style: { fontSize: '12px', color: 'var(--primary)' }, text: `📁 ${subFolders.length} 个子文件夹` }) : null
    ])
  ]);
}

// ================= 🏷️ 状态标签管理面板 =================
function showStatusTagManager(task) {
  // 颜色转换辅助函数
  function hexToRgb(hex) {
    if (!hex || hex === 'transparent') return '';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }

  // ==========================================
  // 1. 初始化数据（分离展示：自己的标签可编辑，子文件夹标签仅展示）
  // ==========================================
  let currentTags = [];
    let isListCollapsed = true; // 默认收起

  // ① 先加自己的标签
  if (Array.isArray(task.statusTags)) {
    currentTags = JSON.parse(JSON.stringify(task.statusTags)).map(t => ({
      html: t.html || null, text: t.text || '',
      color: t.color || '#ff4757',
      bgColor: t.bgColor || 'transparent',
      borderColor: t.borderColor || 'transparent',
      starred: t.starred || false,
      isSubTag: false, isCardTag: false
    }));
  } else if (task.statusIcon) {
    currentTags = [{ 
      text: task.statusIcon, color: task.statusColor || '#ff4757', 
      html: null, bgColor: 'transparent', borderColor: 'transparent', starred: false,
      isSubTag: false, isCardTag: false
    }];
  }

  // ② 深度遍历所有子孙文件夹
  let allRelatedTasks = [task];
  let queue = [task.id];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = store.getTasks().filter(t => t.parentId === currentId);
    children.forEach(child => {
      allRelatedTasks.push(child);
      queue.push(child.id);
    });
  }

    // ③ 收集子文件夹的标签
  let subTagsAdded = new Set(currentTags.map(t => t.text));
  allRelatedTasks.forEach(subTask => {
    if (subTask.id === task.id) return;
    if (Array.isArray(subTask.statusTags)) {
      subTask.statusTags.forEach(tag => {
        if (!subTagsAdded.has(tag.text)) {
          subTagsAdded.add(tag.text);
          currentTags.push({
            html: tag.html || null, text: tag.text || '',
            color: tag.color || '#ff4757',
            bgColor: tag.bgColor || 'transparent',
            borderColor: tag.borderColor || 'transparent',
            starred: tag.starred || false,
            isSubTag: true,
            isCardTag: false
          });
        }
      });
    }
  });

  // ④ 终极暴力收集：遍历所有未删除的卡片，只要卡片里有标签，就抓过来！
  const allPoints = store.getPoints();
  
  allPoints.forEach(p => {
    // 只要卡片没有被删除，且有标签数据
    if (!p.deletedAt && p.tags && Array.isArray(p.tags) && p.tags.length > 0) {
      p.tags.forEach(tag => {
        // 去重：如果这个标签还没加过
        if (!currentTags.some(t => t.text === tag.text)) {
          currentTags.push({
            html: tag.html || null, 
            text: tag.text || '',
            color: tag.color || '#ff4757',
            bgColor: tag.bgColor || 'transparent',
            borderColor: tag.borderColor || 'transparent',
            starred: tag.starred || false,
            isSubTag: false, 
            isCardTag: true // 👈 核心标记：这是来自卡片的标签
          });
        }
      });
    }
  });

  // ==========================================
  // 2. 颜色库初始化
  // ==========================================
  const defaultColors = [
    { c: '#ff4757', s: false }, { c: '#2ed573', s: false }, { c: '#1e90ff', s: true },
    { c: '#ffa502', s: false }, { c: '#8e44ad', s: false }, { c: '#747d8c', s: false },
    { c: '#ff9ff3', s: false }, { c: '#f368e0', s: false },
    { c: '#000000', s: false }, { c: '#000080', s: false },{ c: 'transparent', s: false },
  ];

   let presetColors = JSON.parse(localStorage.getItem('kg_tag_colors')) || [];
  if (!presetColors.some(p => p.c === '#000000')) presetColors.push({ c: '#000000', s: false });
  if (!presetColors.some(p => p.c === '#000080')) presetColors.push({ c: '#000080', s: false });
  //把 unshift 换成 push，让透明色跑到最后面
  if (!presetColors.some(p => p.c === 'transparent')) {
    presetColors.push({ c: 'transparent', s: false }); 
  }
  
  localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors));

  // 3. 状态变量
  let activeColorType = 'text'; // text | bg | border
  let selectedColor = '#ff4757';
  let selectedBgColor = 'transparent';
  let selectedBorderColor = 'transparent';

  let isColorManageMode = false;
  let isStarredExpanded = false;
  const selectedColorIndices = new Set();
  const selectedIndices = new Set();
  let editingIndex = -1;

  let currentHtmlContent = editingIndex > -1 ? (currentTags[editingIndex].html || '') : '';
  let savedRange = null;
  let editorRef = null;

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '460px', width: '95%', padding: '20px', maxHeight: '90vh', overflowY: 'auto' } });

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editorRef && editorRef.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (editorRef) {
      editorRef.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }
  };

  // ================= 统一刷新渲染 =================
  // 👇 接收一个回显内容参数
  const renderContent = (initialContent = null) => {
    console.log("=== 准备渲染 renderContent ===");
    console.log("接收到的 initialContent:", initialContent);
    clear(box);

    // 1. 顶部：仅标题
    box.appendChild(el('h3', { text: '🏷️ 状态标签管理', style: { marginTop: 0, marginBottom: '12px' } }));

    // ================= 2. 中部：输入区 =================
    // 👇 在最外层声明，避免弹窗内外作用域冲突
    const currentExternalChars = JSON.parse(localStorage.getItem('kg_external_chars')) || [];

    const toolbar = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' } }, [
      // 1. 常用字按钮（包含弹窗）
      (() => {
        const wrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });

        wrap.appendChild(el('button', {
          class: 'btn btn-sm btn-ghost',
          text: '📝 常用字',
          style: { fontWeight: 'bold', padding: '2px 8px' },
          onMousedown: e => e.preventDefault(),
          onClick: (e) => {
            e.preventDefault();

            // 弹窗读取最新数据
            const DEFAULT_WORDS = ['∵', '∴', '≈', '≠', '＜', '＞', '≤', '≥', '→', '←'];
            let allWords = JSON.parse(localStorage.getItem('kg_common_words')) || [];
            let presetWords = allWords.filter(w => DEFAULT_WORDS.includes(w));
            let customWords = allWords.filter(w => !DEFAULT_WORDS.includes(w));
            let externalChars = JSON.parse(localStorage.getItem('kg_external_chars')) || []; // 弹窗内单独的副本

            const mask = el('div', { class: 'confirm-mask', style: { zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center' } });
            const box = el('div', { class: 'confirm-box', style: { maxWidth: '380px', width: '90%', padding: '16px', display: 'flex', flexDirection: 'column' } });

            const insertChar = (w) => {
              mask.remove(); // 关闭弹窗

              // 给浏览器一丁点时间销毁弹窗，然后暴力抓取输入框
              setTimeout(() => {
                const realEditor = document.getElementById('tag-editor');
                if (!realEditor) return;

                realEditor.focus();
                const color = selectedColor === 'transparent' ? '#000000' : selectedColor;
                const htmlToInsert = `<span style="color:${color}">${w}</span>`;

                // 恢复选区（如果存在）
                const sel = window.getSelection();
                if (savedRange && realEditor.contains(savedRange.commonAncestorContainer)) {
                  try {
                    sel.removeAllRanges();
                    sel.addRange(savedRange);
                  } catch (err) { }
                }

                // 强行插入
                try {
                  if (sel.rangeCount > 0) {
                    document.execCommand('styleWithCSS', false, true);
                    document.execCommand('insertHTML', false, htmlToInsert);
                  } else {
                    realEditor.innerHTML += htmlToInsert;
                  }
                } catch (err) {
                  realEditor.innerHTML += htmlToInsert;
                }

                // 更新内容，并把光标塞到最后
                currentHtmlContent = realEditor.innerHTML;

                const finalSel = window.getSelection();
                if (finalSel.rangeCount > 0) {
                  const range = finalSel.getRangeAt(0);
                  const span = range.startContainer.previousSibling;
                  if (span && span.nodeType === 1 && span.tagName === 'SPAN') {
                    const newRange = document.createRange();
                    newRange.setStart(span.firstChild, span.firstChild.length);
                    newRange.collapse(true);
                    finalSel.removeAllRanges();
                    finalSel.addRange(newRange);
                  }
                }
                saveSelection();
              }, 20);
            };

            const renderMainPanel = () => {
              clear(box);
              box.appendChild(el('h4', { text: '选择常用字符', style: { marginTop: 0, marginBottom: '12px' } }));

              const createBlock = (title, wordsArr, defaultCollapsed = false) => {
                if (wordsArr.length === 0) return null;
                let isCollapsed = defaultCollapsed;
                const block = el('div', { style: { marginBottom: '12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '6px' } });
                const header = el('div', {
                  style: { padding: '8px', background: 'var(--bg)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px' },
                  onClick: () => { isCollapsed = !isCollapsed; renderGrid(); }
                }, [el('span', { text: title }), el('span', { text: isCollapsed ? '▸' : '▾' })]);

                const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px', maxHeight: '150px', overflowY: 'auto' } });
                const renderGrid = () => {
                  clear(grid);
                  header.lastChild.textContent = isCollapsed ? '▸' : '▾';
                  if (isCollapsed) return;
                  wordsArr.forEach(w => {
                    grid.appendChild(el('button', {
                      class: 'btn btn-sm btn-ghost', text: w, style: { fontSize: '16px', padding: '2px 10px', border: '1px solid #ccc' },
                      onMousedown: e => e.preventDefault(), onClick: () => insertChar(w)
                    }));
                  });
                };
                renderGrid();
                block.appendChild(header);
                block.appendChild(grid);
                return block;
              };

              const customBlock = createBlock('➕ 自定义字符', customWords);
              if (customBlock) box.appendChild(customBlock);
              const presetBlock = createBlock('🌟 预设字符', presetWords, true);
              if (presetBlock) box.appendChild(presetBlock);

              if (!customBlock && !presetBlock) {
                box.appendChild(el('div', { text: '暂无常用字符，请点击管理添加', style: { textAlign: 'center', color: 'var(--text-2)', padding: '20px' } }));
              }

              box.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '8px' } }, [
                el('button', { class: 'btn btn-sm btn-ghost', text: '⚙️ 管理', onClick: renderManagePanel }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '关闭', onClick: () => mask.remove() })
              ]));
            };

            const renderManagePanel = () => {
              clear(box);
              box.appendChild(el('h4', { text: '📝 管理常用字符', style: { marginTop: 0, marginBottom: '12px' } }));

              let selectedPreset = new Set();
              let selectedCustom = new Set();
              let selectedExternal = new Set();
              let externalCollapsed = true;

              const createManageBlock = (title, wordsArr, selectedSet, onDelete, collapsedState) => {
                const wrapper = el('div', { style: { marginBottom: '12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '6px' } });
                let isCollapsed = collapsedState.value;
                const header = el('div', {
                  style: { padding: '8px', background: 'var(--bg)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px' },
                  onClick: () => { isCollapsed = !isCollapsed; collapsedState.value = isCollapsed; renderAll(); }
                }, [el('span', { text: title }), el('span', { text: isCollapsed ? '▸' : '▾' })]);

                wrapper.appendChild(header);
                if (!isCollapsed) {
                  const tools = el('div', { style: { display: 'flex', gap: '6px', padding: '4px 8px', borderBottom: '1px solid rgba(0,0,0,0.05)', alignItems: 'center' } }, [
                    el('button', {
                      class: 'btn btn-sm btn-ghost', text: '📌 外置', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => {
                        if (selectedSet.size === 0) return;
                        selectedSet.forEach(i => {
                          if (!externalChars.includes(wordsArr[i])) externalChars.push(wordsArr[i]);
                        });
                        localStorage.setItem('kg_external_chars', JSON.stringify(externalChars));
                        renderAll();
                      }
                    }),
                    el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { wordsArr.forEach((_, i) => selectedSet.add(i)); renderAll(); } }),
                    el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { selectedSet.clear(); renderAll(); } }),
                    el('button', {
                      class: 'btn btn-sm btn-danger', text: '删除', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => {
                        if (selectedSet.size === 0) return;
                        onDelete();
                      }
                    })
                  ]);
                  wrapper.appendChild(tools);

                  const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', maxHeight: '120px', overflowY: 'auto' } });
                  wordsArr.forEach((w, i) => {
                    const isChecked = selectedSet.has(i);
                    grid.appendChild(el('div', {
                      style: { padding: '2px 8px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: isChecked ? 'var(--primary)' : 'transparent', color: isChecked ? '#fff' : 'inherit' },
                      onClick: () => { if (isChecked) selectedSet.delete(i); else selectedSet.add(i); renderAll(); }
                    }, [el('span', { text: w })]));
                  });
                  if (wordsArr.length === 0) grid.appendChild(el('div', { text: '暂无字符', style: { fontSize: '12px', color: 'var(--text-2)' } }));
                  wrapper.appendChild(grid);
                }
                return wrapper;
              };

              const presetCollapsed = { value: false };
              const customCollapsed = { value: false };

              const renderAll = () => {
                clear(box);
                box.appendChild(el('h4', { text: '📝 管理常用字符', style: { marginTop: 0, marginBottom: '12px' } }));

                box.appendChild(createManageBlock('➕ 自定义字符', customWords, selectedCustom, () => {
                  customWords = customWords.filter((_, i) => !selectedCustom.has(i));
                  selectedCustom.clear();
                  saveAllWords();
                  renderAll();
                }, customCollapsed));

                box.appendChild(createManageBlock('🌟 预设字符', presetWords, selectedPreset, () => {
                  presetWords = presetWords.filter((_, i) => !selectedPreset.has(i));
                  selectedPreset.clear();
                  saveAllWords();
                  renderAll();
                }, presetCollapsed));

                const renderExternalBlock = () => {
                  const wrapper = el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.1)', marginTop: '16px', paddingTop: '12px' } });
                  const header = el('div', {
                    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: '8px' },
                    onClick: () => { externalCollapsed = !externalCollapsed; renderAll(); }
                  }, [
                    el('span', { text: '📌 外置快捷列表', style: { fontWeight: 'bold', fontSize: '13px' } }),
                    el('span', { text: externalCollapsed ? '▸' : '▾', style: { fontSize: '14px' } })
                  ]);
                  wrapper.appendChild(header);

                  if (!externalCollapsed) {
                    const tools = el('div', { style: { display: 'flex', gap: '6px', padding: '4px 0', marginBottom: '8px' } }, [
                      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { externalChars.forEach((_, i) => selectedExternal.add(i)); renderAll(); } }),
                      el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => { selectedExternal.clear(); renderAll(); } }),
                      el('button', {
                        class: 'btn btn-sm btn-danger', text: '删除选中', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto' }, onClick: () => {
                          if (selectedExternal.size === 0) return;
                          externalChars = externalChars.filter((_, i) => !selectedExternal.has(i));
                          selectedExternal.clear();
                          localStorage.setItem('kg_external_chars', JSON.stringify(externalChars));
                          renderAll();
                        }
                      }),
                      el('div', { style: { flex: 1 } }),
                      el('button', {
                        class: 'btn btn-sm btn-ghost', text: '清空', style: { fontSize: '11px', padding: '2px 6px', height: '22px', minHeight: 'auto', color: 'var(--text-2)' }, onClick: () => {
                          if (!confirm('确定清空所有外置字符吗？')) return;
                          externalChars = [];
                          selectedExternal.clear();
                          localStorage.setItem('kg_external_chars', JSON.stringify(externalChars));
                          renderAll();
                        }
                      })
                    ]);
                    wrapper.appendChild(tools);

                    const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid rgba(0,0,0,.05)', minHeight: '40px' } });

                    if (externalChars.length === 0) {
                      grid.appendChild(el('span', { text: '暂无外置字符', style: { fontSize: '12px', color: 'var(--text-2)' } }));
                    } else {
                      externalChars.forEach((w, i) => {
                        const isChecked = selectedExternal.has(i);
                        grid.appendChild(el('div', {
                          style: { padding: '2px 8px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: isChecked ? 'var(--primary)' : 'transparent', color: isChecked ? '#fff' : 'inherit' },
                          onClick: () => { if (isChecked) selectedExternal.delete(i); else selectedExternal.add(i); renderAll(); }
                        }, [el('span', { text: w })]));
                      });
                    }
                    wrapper.appendChild(grid);
                  }
                  return wrapper;
                };
                box.appendChild(renderExternalBlock());

                const inputWrap = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } });
                const inputEl = el('input', { type: 'text', style: { flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }, placeholder: '输入自定义字符，回车添加' });
                const addBtn = el('button', {
                  class: 'btn btn-primary', text: '添加', onClick: () => {
                    const val = inputEl.value.trim();
                    if (!val) return;
                    if (presetWords.includes(val) || customWords.includes(val)) return toastError('该字符已存在');
                    customWords.push(val);
                    saveAllWords();
                    inputEl.value = '';
                    renderAll();
                  }
                });
                inputEl.onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
                inputWrap.appendChild(inputEl);
                inputWrap.appendChild(addBtn);
                box.appendChild(inputWrap);

                box.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', borderTop: '1px dashed rgba(0,0,0,.1)', paddingTop: '12px' } }, [
                  el('button', { class: 'btn btn-sm btn-ghost', text: '完成', onClick: renderMainPanel })
                ]));
              };

              const saveAllWords = () => {
                const finalWords = [...presetWords, ...customWords];
                localStorage.setItem('kg_common_words', JSON.stringify(finalWords));
              };

              renderAll();
            };

            renderMainPanel();
            mask.appendChild(box);
            mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
            document.body.appendChild(mask);
          }
        }));

        // 2. 渲染外置快捷字符
        if (currentExternalChars.length > 0) {
          currentExternalChars.forEach(w => {
            wrap.appendChild(el('button', {
              class: 'btn btn-sm btn-ghost',
              text: w,
              title: '快捷插入',
              style: {
                fontSize: '13px', padding: '0 5px', height: '22px', minHeight: 'auto',
                background: 'var(--bg)', border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: '4px', color: 'var(--text-1)', cursor: 'pointer'
              },
              // 阻止默认事件，防止按下鼠标时输入框失去焦点
              onMouseDown: (e) => e.preventDefault(),
              onClick: (e) => {
                e.preventDefault();

                // 1. 实时获取输入框
                const realEditor = document.getElementById('tag-editor');
                if (!realEditor) return;

                // 2. 强行抢焦点
                realEditor.focus();

                // 3. 获取当前颜色
                const currentColor = selectedColor === 'transparent' ? '#000000' : selectedColor;
                const htmlToInsert = `<span style="color:${currentColor}">${w}</span>`;

                // 4. 还原光标（如果之前的丢了，就放最后面）
                const sel = window.getSelection();
                if (savedRange && realEditor.contains(savedRange.commonAncestorContainer)) {
                  try {
                    sel.removeAllRanges();
                    sel.addRange(savedRange);
                  } catch (err) { }
                }

                // 5. 执行插入（暴力兜底版）
                try {
                  if (sel.rangeCount > 0) {
                    // 如果有选区，用 execCommand 插入
                    document.execCommand('styleWithCSS', false, true);
                    document.execCommand('insertHTML', false, htmlToInsert);
                  } else {
                    // 如果没有选区，直接拼接 HTML 到末尾
                    realEditor.innerHTML += htmlToInsert;
                  }
                } catch (err) {
                  // 如果 execCommand 报错，直接拼接
                  realEditor.innerHTML += htmlToInsert;
                }

                // 6. 更新缓存内容
                currentHtmlContent = realEditor.innerHTML;

                // 7. 强行把光标移动到插入的内容后面（极其重要，否则你接着打字会回到最前面）
                const finalSel = window.getSelection();
                if (finalSel.rangeCount > 0) {
                  const range = finalSel.getRangeAt(0);
                  const span = range.startContainer.previousSibling;
                  if (span && span.nodeType === 1 && span.tagName === 'SPAN') {
                    const newRange = document.createRange();
                    newRange.setStart(span.firstChild, span.firstChild.length);
                    newRange.collapse(true);
                    finalSel.removeAllRanges();
                    finalSel.addRange(newRange);
                  }
                }

                saveSelection();
              }
            }));
          });
        }

        return wrap;
      })(),

      // 3. 分隔竖线
      el('div', { style: { width: '1px', height: '16px', background: 'rgba(0,0,0,0.15)', margin: '0 4px' } }),

      // 4. 加粗、斜体
      el('button', { class: 'btn btn-sm btn-ghost', text: 'B', style: { fontWeight: 'bold' }, onMousedown: e => e.preventDefault(), onClick: () => { document.execCommand('bold'); editorRef?.focus(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: 'I', style: { fontStyle: 'italic' }, onMousedown: e => e.preventDefault(), onClick: () => { document.execCommand('italic'); editorRef?.focus(); } }),
      el('span', { style: { fontSize: '12px', color: 'var(--text-2)', marginLeft: 'auto' }, text: '选中文字后点击颜色即可变色' })
    ]);
    box.appendChild(toolbar);

    const editor = el('div', {
      id: 'tag-editor', contentEditable: true,
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

      // 1. 拦截英文、数字，强行染色（不拦截，不 preventDefault，让浏览器自己插字）
      onKeyDown: (e) => {
        if (e.isComposing || e.key === 'Process' || e.ctrlKey || e.metaKey) return;
        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') return;

        if (activeColorType === 'text' && selectedColor !== 'transparent' && e.key.length === 1) {
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, selectedColor);
        }
      },

      // 2. 拦截中文输入法上屏瞬间，强行刷色
      onCompositionEnd: (e) => {
        if (activeColorType === 'text' && selectedColor !== 'transparent') {
          // 直接触发原生命令，不需要 setTimeout，不需要替换节点
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, selectedColor);

          // 兜底：如果是极个别不听话的输入法，直接把纯文本替换掉
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

      // 3. 纯记录，不干预
      onInput: (e) => {
        currentHtmlContent = e.target.innerHTML;
        saveSelection();
      }
    });
    box.appendChild(editor);

    // 👇 👇 👇 终极必杀：如果传入了编辑内容，等 50 毫秒后用原生 API 强塞进去！
    if (initialContent !== null && initialContent !== '') {
      setTimeout(() => {
        const realEditor = document.getElementById('tag-editor');
        if (realEditor) {
          realEditor.innerHTML = initialContent;

          // 把光标强行移到文字最后面
          const range = document.createRange();
          range.selectNodeContents(realEditor);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 50);
    }

    // 3. 添加标签按钮（加入全局防报错兜底）
    const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary',
        text: editingIndex === -1 ? '添加标签' : '保存修改',
        style: { flex: '1' },
        onClick: () => {
          // 动态抓取真实的输入框
          const realEditor = document.getElementById('tag-editor');
          const text = (realEditor ? realEditor.textContent : '').trim();
          let html = realEditor ? realEditor.innerHTML : currentHtmlContent;

          if (!text) {
            if (typeof toastError === 'function') toastError('标签内容不能为空');
            else alert('标签内容不能为空');
            return;
          }

          if (!html.includes('color:') && selectedColor !== 'transparent') {
            html = `<span style="color:${selectedColor}">${text}</span>`;
          }

          const newTag = {
            html: html, text: text,
            color: selectedColor, bgColor: selectedBgColor, borderColor: selectedBorderColor, starred: false
          };

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

          // 清空状态
          currentHtmlContent = '';
          selectedBgColor = 'transparent';
          selectedBorderColor = 'transparent';

          // 👈 刷新界面，传入 null 避免把空字符串当成回显内容强行塞入
          renderContent(null);
        }
      }),
      editingIndex > -1 ? el('button', {
        class: 'btn btn-sm btn-ghost',
        text: '取消编辑',
        onClick: () => {
          editingIndex = -1;
          currentHtmlContent = '';
          selectedBgColor = 'transparent';
          selectedBorderColor = 'transparent';

          // 👈 刷新界面，传入 null 避免把空字符串当成回显内容强行塞入
          renderContent(null);
        }
      }) : null
    ]);
    box.appendChild(actions);

    // 4. 底部：颜色配置区
    const colorContainer = el('div', { id: 'color-manager-wrap', style: { marginTop: '16px' } });
    box.appendChild(colorContainer);
    renderColorPanel(colorContainer);

    // ================= 5. 标签列表（状态持久化折叠） =================
    // 注意：需要在你这个函数外面（比如 renderContent 上面）定义 let isListCollapsed = true; 
    // 这样才能在 renderContent 重绘时记住状态。

    const currentList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', marginTop: '16px', marginBottom: '12px' } });
    if (currentTags.length === 0) {
      currentList.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '13px', padding: '12px', border: '1px dashed rgba(0,0,0,.1)', borderRadius: '6px' }, text: '暂无标签' }));
    } else {
      currentTags.forEach((tag, index) => {
        const isSelected = selectedIndices.has(index);
        currentList.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid rgba(0,0,0,.04)' }
        }, [
          el('input', { type: 'checkbox', checked: isSelected, style: { margin: 0, width: '14px', height: '14px' }, onChange: (e) => { if (e.target.checked) selectedIndices.add(index); else selectedIndices.delete(index); renderContent(null); } }),
              el('span', {
            style: {
              color: tag.color,
              backgroundColor: tag.bgColor,
              border: tag.borderColor !== 'transparent' ? `1px solid ${tag.borderColor}` : 'none',
              padding: '2px 6px', borderRadius: '4px', fontSize: '13px', fontWeight: '600', flex: '1', lineHeight: '1.2'
            },
            // 👇 智能拼接：[卡] 或 [子] 标识 + 原本内容
            innerHTML: (tag.isCardTag ? '<span style="color:#999;font-size:10px;margin-right:2px;">[卡]</span>' : '') + 
                       (tag.isSubTag ? '<span style="color:#999;font-size:10px;margin-right:2px;">[子]</span>' : '') + 
                       (tag.html || tag.text)
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '✏️', style: { padding: '2px 6px', minHeight: 'auto' }, onClick: () => {
              // 👇 核心防护：如果这个标签属于子文件夹或卡片，就不允许在这里直接编辑
              if (tag.isCardTag) return toastError('这是卡片的专属标签，请去卡片内修改');
              if (tag.isSubTag) return toastError('这是子文件夹的专属标签，请去对应文件夹修改');
              
              editingIndex = index;
              currentHtmlContent = tag.html || tag.text;
              selectedColor = tag.color; selectedBgColor = tag.bgColor; selectedBorderColor = tag.borderColor;
              renderContent(currentHtmlContent);
            }
          }),
          el('button', { class: 'btn btn-sm btn-ghost', text: tag.starred ? '⭐' : '☆', style: { padding: '2px 6px', minHeight: 'auto' }, onClick: () => { currentTags[index].starred = !currentTags[index].starred; renderContent(null); } })
        ]));
      });
    }

    const currentActions = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { currentTags.forEach((_, i) => selectedIndices.add(i)); renderContent(null); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selectedIndices.clear(); renderContent(null); } }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除选中', disabled: selectedIndices.size === 0, onClick: () => {
          if (selectedIndices.size === 0) return;
          if (!confirm(`确定要删除选中的 ${selectedIndices.size} 个标签吗？`)) return;
          currentTags = currentTags.filter((_, i) => !selectedIndices.has(i));
          selectedIndices.clear(); renderContent(null);
        }
      })
    ]);

    // 👇 用 isListCollapsed 变量控制显示隐藏
    const listContainer = el('div', { style: { display: isListCollapsed ? 'none' : 'block' } }, [
      currentList,
      currentActions
    ]);
    // 阻止内部点击冒泡导致意外触发外部重绘
    listContainer.onclick = (e) => e.stopPropagation();

    const listHeader = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px dashed rgba(0,0,0,.1)' },
      onClick: (e) => {
        e.stopPropagation();
        isListCollapsed = !isListCollapsed; // 👈 修改状态
        renderContent(null); // 👈 重新渲染以应用状态
      }
    }, [
      el('span', { text: `📁 当前文件夹标签 (${currentTags.length})`, style: { fontWeight: 'bold', fontSize: '13px', color: 'var(--text-2)' } }),
      el('span', { text: isListCollapsed ? '▸' : '▾', style: { fontSize: '14px' } }) // 根据状态显示箭头
    ]);

    box.appendChild(listHeader);
    box.appendChild(listContainer);

    // 6. 保存/取消
    box.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,.1)', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' } }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
        class: 'btn btn-primary', text: '保存全部',
        onClick: () => {
          // 👈 过滤掉卡片和子文件夹的标签
          const ownTagsToSave = currentTags.filter(t => !t.isCardTag && !t.isSubTag).map(t => {
            const { isCardTag, isSubTag, ...rest } = t;
            return rest;
          });

          store.updateTask(task.id, { statusTags: ownTagsToSave });
          toastSuccess('标签已更新');
          if (typeof renderHome === 'function') renderHome();
          mask.remove();
        }
      })
    ]));
  };

  // ================= 颜色配置区渲染 =================
  const renderColorPanel = (container) => {
    clear(container);

    // 类型切换与工具栏
    const typeRow = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' } }, [
      el('button', { class: `btn btn-sm ${activeColorType === 'text' ? 'btn-primary' : 'btn-ghost'}`, text: '文字', style: { padding: '2px 10px', fontSize: '12px' }, onClick: () => { activeColorType = 'text'; renderContent(null); } }),
      el('button', { class: `btn btn-sm ${activeColorType === 'bg' ? 'btn-primary' : 'btn-ghost'}`, text: '背景', style: { padding: '2px 10px', fontSize: '12px' }, onClick: () => { activeColorType = 'bg'; renderContent(null); } }),
      el('button', { class: `btn btn-sm ${activeColorType === 'border' ? 'btn-primary' : 'btn-ghost'}`, text: '边框', style: { padding: '2px 10px', fontSize: '12px' }, onClick: () => { activeColorType = 'border'; renderContent(null); } }),

      el('div', { style: { width: '1px', height: '14px', background: 'rgba(0,0,0,0.1)', margin: '0 4px' } }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '⭐ 收藏当前颜色',
        style: { padding: '2px 8px', fontSize: '11px', height: '22px', minHeight: 'auto', border: '1px dashed rgba(0,0,0,0.2)', borderRadius: '12px', color: 'var(--primary)' },
        onClick: () => {
          const targetColor = activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor);

          if (targetColor === 'transparent') {
            if (typeof toastError === 'function') toastError('透明色无需收藏');
            else alert('透明色无需收藏');
            return;
          }

          const existingIndex = presetColors.findIndex(p => p.c.toLowerCase() === targetColor.toLowerCase());
          if (existingIndex > -1) {
            if (presetColors[existingIndex].s) {
              if (typeof toastError === 'function') toastError('该颜色已在收藏中');
              else alert('该颜色已在收藏中');
              return;
            }
            presetColors[existingIndex].s = true;
          } else {
            presetColors.push({ c: targetColor, s: true });
          }

          localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors));
          isStarredExpanded = true;
          renderContent(null);

          if (typeof toastSuccess === 'function') toastSuccess('已加入收藏');
          else alert('已加入收藏');
        }
      }),
      el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', fontSize: '11px', color: 'var(--text-2)' },
        title: '当前选中的颜色'
      }, [
        el('span', { text: '当前:' }),
        el('div', {
          id: 'current-color-preview',
          style: {
            width: '18px', height: '18px', borderRadius: '50%',
            background: activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor),
            border: '1px solid rgba(0,0,0,0.2)',
            backgroundImage: (activeColorType === 'bg' && selectedBgColor === 'transparent') || (activeColorType === 'border' && selectedBorderColor === 'transparent')
              ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)'
              : 'none',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 4px 4px'
          }
        })
      ])
    ]);
    container.appendChild(typeRow);

    // ================= 1. 预设颜色区 =================
    const colorsWrap = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '10px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } });

      presetColors.forEach(item => {
      const c = item.c;
      const isTransparent = c === 'transparent'; // 👈 核心补丁，必须放在最前面
      
      let isSelected = false;
      if (activeColorType === 'text') isSelected = (selectedColor === c);
      if (activeColorType === 'bg') isSelected = (selectedBgColor === c);
      if (activeColorType === 'border') isSelected = (selectedBorderColor === c);

      const colorCircle = el('div', {
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
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center'
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

          // 3. 局部更新所有颜色圆圈的选中状态
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
              class: 'check-icon', text: '✓',
              style: { color: '#fff', fontSize: '12px', fontWeight: 'bold', position: 'absolute', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }
            }));
          }
        }
      }, [
        isSelected ? el('span', {
          class: 'check-icon', text: '✓',
          style: { color: '#fff', fontSize: '12px', fontWeight: 'bold', position: 'absolute', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }
        }) : null
      ]);

      colorCircle.dataset.isColorBlock = 'true';
      colorsWrap.appendChild(colorCircle);
    });

    // 自定义颜色盘
    const currentDefault = activeColorType === 'text' ? selectedColor : (activeColorType === 'bg' ? selectedBgColor : selectedBorderColor);
    const customColorBox = el('div', {
      style: {
        width: '16px', height: '16px', borderRadius: '50%', position: 'relative',
        border: '1px dashed #999', cursor: 'pointer', background: 'var(--bg-card)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      },
      title: '自定义颜色'
    }, [
      el('div', { text: '🎨', style: { fontSize: '10px', pointerEvents: 'none' } }),
      el('input', {
        type: 'color',
        style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' },
        value: currentDefault === 'transparent' ? '#ffffff' : currentDefault,
        onInput: (e) => {
          const val = e.target.value;
          if (activeColorType === 'text') {
            selectedColor = val;
            if (editorRef) {
              editorRef.focus();
              if (savedRange) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange);
              }
              // 👇 纯净版：只调用原生命令
              document.execCommand('styleWithCSS', false, true);
              document.execCommand('foreColor', false, val);
              currentHtmlContent = editorRef.innerHTML;
              saveSelection();
            }
          } else if (activeColorType === 'bg') {
            selectedBgColor = val;
          } else if (activeColorType === 'border') {
            selectedBorderColor = val;
          }

          const previewEl = document.getElementById('current-color-preview');
          if (previewEl) {
            previewEl.style.background = val;
            previewEl.style.backgroundImage = 'none';
          }
        }
      })
    ]);
    colorsWrap.appendChild(customColorBox);

    if ((activeColorType === 'bg' || activeColorType === 'border')) {
      colorsWrap.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: '清除', style: { padding: '2px 6px', fontSize: '11px', height: '20px', minHeight: 'auto' },
                onClick: () => {
          if (activeColorType === 'bg') selectedBgColor = 'transparent';
          if (activeColorType === 'border') selectedBorderColor = 'transparent';

          const previewEl = document.getElementById('current-color-preview');
          if (previewEl) {
            previewEl.style.background = 'var(--bg)';
            previewEl.style.backgroundImage = 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)';
            previewEl.style.backgroundSize = '8px 8px';
            previewEl.style.backgroundPosition = '0 0, 4px 4px';
          }

          // 把颜色圆圈的高亮也清空
          Array.from(colorsWrap.children).forEach(child => {
            if (child.dataset.isColorBlock) {
              child.style.border = '2px solid transparent';
              child.style.boxShadow = 'none';
              child.style.transform = 'scale(1)';
              const oldCheck = child.querySelector('.check-icon');
              if (oldCheck) oldCheck.remove();
            }
          });
        }
      }));
    }
    colorsWrap.appendChild(el('div', { style: { width: '1px', height: '18px', background: 'rgba(0,0,0,0.1)', margin: '0 4px' } }));
    container.appendChild(colorsWrap);

        // ================= 2. 收藏颜色区 =================
    // 👇 核心修复：定义 starredColors
    const starredColors = presetColors.filter(item => item.s);

    // 分割线
    container.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,0.1)', marginTop: '8px', marginBottom: '8px' } }));

    const starHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-2)' } }, [
      el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 'bold' },
        onClick: () => { isStarredExpanded = !isStarredExpanded; renderContent(null); }
      }, [
        el('span', { text: `⭐ 收藏颜色 (${starredColors.length})` }),
        el('span', { text: isStarredExpanded ? '▾' : '▸' })
      ]),
      // 👇 管理工具条（带全选/非全选/删除/恢复默认/管理）
      el('div', { style: { display: 'flex', gap: '4px' } }, [
        isColorManageMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => { e.stopPropagation(); presetColors.forEach((item, i) => { if (item.s) selectedColorIndices.add(i); }); renderContent(null); } }) : null,
        isColorManageMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => { e.stopPropagation(); selectedColorIndices.clear(); renderContent(null); } }) : null,
        isColorManageMode ? el('button', { class: 'btn btn-sm btn-danger', text: `删除(${selectedColorIndices.size})`, style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => { 
          e.stopPropagation(); 
          if (selectedColorIndices.size === 0) return; 
          if (!confirm('确定删除选中的收藏颜色吗？')) return; 
          selectedColorIndices.forEach(i => { if (presetColors[i]) presetColors[i].s = false; }); 
          localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors)); 
          selectedColorIndices.clear(); 
          isColorManageMode = false; 
          renderContent(null); 
        } }) : null,
        isColorManageMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '恢复默认', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto', color: 'var(--primary)' }, onClick: (e) => { 
          e.stopPropagation(); 
          if (!confirm('确定要恢复系统默认吗？')) return; 
          const defaultColorValues = defaultColors.map(d => d.c.toLowerCase()); 
          const customColorsMap = new Map(); 
          presetColors.forEach(p => { if (!defaultColorValues.includes(p.c.toLowerCase())) customColorsMap.set(p.c.toLowerCase(), p); }); 
          presetColors = [...JSON.parse(JSON.stringify(defaultColors)), ...Array.from(customColorsMap.values())]; 
          localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors)); 
          selectedColorIndices.clear(); 
          isColorManageMode = false; 
          isStarredExpanded = true; 
          renderContent(null); 
          if (typeof toastSuccess === 'function') toastSuccess('已恢复默认颜色'); else alert('已恢复默认颜色'); 
        } }) : null,
        el('button', { class: 'btn btn-sm btn-primary', text: isColorManageMode ? '完成' : '管理', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => { e.stopPropagation(); isColorManageMode = !isColorManageMode; selectedColorIndices.clear(); renderContent(null); } })
      ])
    ]);
    container.appendChild(starHeader);

        if (isStarredExpanded) {
      const starBox = el('div', { style: { marginTop: '8px' } });
      if (starredColors.length === 0) {
        starBox.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', padding: '8px', background: 'var(--bg)', borderRadius: '6px', border: '1px dashed rgba(0,0,0,.1)' }, text: '暂无收藏颜色，请点击上方“恢复默认”或添加星标' }));
      } else {
        const starredWrap = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '10px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } });
        starredColors.forEach((item) => {
          const c = item.c;
          const isTransparent = c === 'transparent';
          const realIndex = presetColors.findIndex(p => p.c === c);
          const isChecked = selectedColorIndices.has(realIndex);

          let isSelected = false;
          if (activeColorType === 'text') isSelected = (selectedColor === c);
          if (activeColorType === 'bg') isSelected = (selectedBgColor === c);
          if (activeColorType === 'border') isSelected = (selectedBorderColor === c);

          const starCircle = el('div', {
            style: {
              width: '18px', height: '18px', borderRadius: '50%', 
              // 👇 透明色的渲染
              background: isTransparent ? 'var(--bg)' : c,
              backgroundImage: isTransparent 
                ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)' 
                : 'none',
              backgroundSize: '8px 8px', 
              backgroundPosition: '0 0, 4px 4px',
              cursor: 'pointer',
              border: isChecked ? '2px solid #fff' : (isSelected ? '2px solid var(--primary)' : '2px solid transparent'),
              boxShadow: isChecked ? '0 0 0 1px rgba(0,0,0,0.2)' : 'none',
              transform: isSelected ? 'scale(1.15)' : 'scale(1)', transition: 'all 0.15s',
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center'
            },
            onMouseDown: (e) => e.preventDefault(),
            onClick: () => {
              if (isColorManageMode) {
                // 👇 管理模式：只负责勾选
                if (selectedColorIndices.has(realIndex)) selectedColorIndices.delete(realIndex);
                else selectedColorIndices.add(realIndex);
                renderContent(null);
              } else {
                // 👇 普通模式：切换颜色
                if (editorRef) currentHtmlContent = editorRef.innerHTML;

                if (activeColorType === 'text') selectedColor = c;
                else if (activeColorType === 'bg') selectedBgColor = c;
                else if (activeColorType === 'border') selectedBorderColor = c;

                if (editorRef && activeColorType === 'text') {
                  restoreSelection();
                  const sel = window.getSelection();
                  if (sel.rangeCount > 0) {
                    document.execCommand('styleWithCSS', false, true);
                    document.execCommand('foreColor', false, isTransparent ? '#000000' : c);
                  }
                  currentHtmlContent = editorRef.innerHTML;
                  saveSelection();
                }

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

                Array.from(starredWrap.children).forEach(child => {
                  child.style.border = '2px solid transparent';
                  child.style.boxShadow = 'none';
                  child.style.transform = 'scale(1)';
                });
                starCircle.style.border = '2px solid var(--primary)';
                starCircle.style.transform = 'scale(1.15)';
              }
            }
          }, [
            isChecked ? el('span', { text: '✓', style: { color: '#fff', fontSize: '12px', fontWeight: 'bold', position: 'absolute', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } }) : null
          ]);
          starredWrap.appendChild(starCircle);
        });
        starBox.appendChild(starredWrap);
      }
      container.appendChild(starBox);
    }
  };

  renderContent(null);
  mask.appendChild(box);
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  document.body.appendChild(mask);
}

//补回了丢失的 swap 函数
function swap(ids, id, dir) {
  const idx = ids.indexOf(id);
  const target = idx + dir;
  if (target < 0 || target >= ids.length) return ids;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  return ids;
}

export function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (sidebar.classList.contains('collapsed')) return;
  sidebar.classList.remove('hidden');
  const tree = document.getElementById('sidebar-tree');
  if (!tree) return;

  let state;
  try { state = JSON.parse(localStorage.getItem('kg_sidebar_tree_state') || '{}'); } catch { state = {}; }
  if (!state.tasks) state.tasks = [];

  function saveState() { localStorage.setItem('kg_sidebar_tree_state', JSON.stringify(state)); }
  function toggleTask(id) {
    const i = state.tasks.indexOf(id);
    if (i >= 0) state.tasks.splice(i, 1); else state.tasks.push(id);
    saveState();
    renderSidebar();
  }

  clear(tree);

  // ================= 1. 获取侧边栏设置 =================
  let config = { errorBookPos: 'bottom', countdownPos: 'bottom', countdownSize: 'medium' };
  try {
    const saved = JSON.parse(localStorage.getItem('kg_sidebar_config'));
    if (saved) config = { ...config, ...saved };
  } catch (e) { }

  // ================= 2. 生成小组件 DOM =================
  const errorBookWidget = el('div', {
    style: {
      marginTop: '24px',
      paddingTop: '12px',
      borderTop: '1px dashed rgba(0,0,0,.08)'
    }
  }, [
    el('div', {
      style: {
        padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', color: 'var(--danger)',
        fontSize: '12px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.85
      },
      onClick: () => {
        navigate('#/error-book');
        if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
      }
    }, [
      el('span', { text: '❗', style: { fontSize: '10px' } }),
      el('span', { text: '错题本' })
    ])
  ]);

  // 生成倒计时组件 (支持多倒计时)
  const countdownWidget = el('div', { style: { marginTop: '12px', marginBottom: '12px' } });
  try {
    const countdowns = JSON.parse(localStorage.getItem('kg_exam_countdowns') || '[]');
    countdowns.forEach(cd => {
      //如果明确关闭了侧边栏显示（isPinned === false），直接跳过
      if (cd.isPinned === false) return;

      const diff = new Date(cd.date).getTime() - Date.now();
      if (diff > 0) {
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        countdownWidget.appendChild(el('div', {
          style: {
            padding: '8px', background: 'rgba(142,202,230,.15)', borderRadius: '8px', marginBottom: '6px',
            textAlign: 'center', fontWeight: '600', color: 'var(--primary-dark)',
            fontSize: config.countdownSize === 'small' ? '12px' : config.countdownSize === 'large' ? '18px' : '14px'
          }
        }, [
          el('div', { text: cd.name, style: { fontSize: '11px', color: 'var(--text-2)', marginBottom: '2px' } }),
          el('div', { text: `距离还有 ${days} 天` })
        ]));
      }
    });
  } catch (e) { }

  // ================= 3. 组装侧边栏 =================
  // 容器：用来放所有的文件夹
  const folderContainer = el('div', { style: { marginTop: '8px' } });

  // 根据配置决定组件的插入位置
  // 如果在顶部或中部，先插进去；如果在底部，等文件夹渲染完再插。

  const insertWidgets = (position, container) => {
    if (config.errorBookPos === position) container.appendChild(errorBookWidget);
    if (config.countdownPos === position) container.appendChild(countdownWidget);
  };

  // 顶部插入
  const topWrapper = el('div');
  insertWidgets('top', topWrapper);
  if (topWrapper.hasChildNodes()) tree.appendChild(topWrapper);

  // 中部插入（我们把它放在文件夹列表的中间，这里简化为放在文件夹列表的前面）
  const middleWrapper = el('div');
  insertWidgets('middle', middleWrapper);
  if (middleWrapper.hasChildNodes()) tree.appendChild(middleWrapper);

  // 渲染文件夹树
  const tasks = store.getTasks();
  const renderTree = (parentId, depth) => {
    const currentLevel = tasks.filter(t => (t.parentId || null) === parentId);
    currentLevel.forEach(task => {
      const taskOpen = state.tasks.includes(task.id);
      const subFolders = tasks.filter(t => t.parentId === task.id);
      const hasSub = subFolders.length > 0;

      const taskRow = el('div', {
        class: 'tree-task-name',
        style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', paddingLeft: (depth * 16) + 'px', paddingTop: '6px', paddingBottom: '6px' },
      }, [
        el('span', {
          style: { width: '18px', textAlign: 'center', flexShrink: '0', color: 'var(--text-2)', fontSize: '12px' },
          text: hasSub ? (taskOpen ? '▾' : '▸') : '',
          onClick: (e) => { e.stopPropagation(); if (hasSub) toggleTask(task.id); },
        }),
        el('span', {
          style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px' },
          text: `📁 ${task.name}`,
          onClick: () => {
            const chapters = store.getChapters(task.id);
            if (chapters.length > 0) {
              navigate(`#/chapter/${chapters[0].id}?taskName=${encodeURIComponent(task.name)}`);
            } else {
              const newChap = store.createChapter({ name: '默认', taskId: task.id });
              navigate(`#/chapter/${newChap.id}?taskName=${encodeURIComponent(task.name)}`);
            }
            if (window.innerWidth < 1024) document.body.classList.remove('sidebar-open');
          },
        }),
      ]);
      folderContainer.appendChild(taskRow);

      if (taskOpen && hasSub) renderTree(task.id, depth + 1);
    });
  };

  renderTree(null, 0);
  tree.appendChild(folderContainer);

  // 如果没有文件夹，显示空状态
  if (tasks.length === 0) {
    folderContainer.appendChild(el('div', {
      style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(0,0,0,.08)', fontSize: '12px', color: 'var(--text-2)', padding: '6px 10px' },
      text: '还没有文件夹'
    }));
  }

  // 底部插入
  const bottomWrapper = el('div');
  insertWidgets('bottom', bottomWrapper);
  if (bottomWrapper.hasChildNodes()) tree.appendChild(bottomWrapper);
}

function openDueManager(due) {
  const selected = new Set();
  const list = el('div', { style: { maxHeight: '50vh', overflowY: 'auto', margin: '12px 0' } },
    due.map(p => {
      const ch = store.getChapter(p.chapterId);
      return el('label', {
        style: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px', borderBottom: '1px solid rgba(0,0,0,.06)', cursor: 'pointer' },
      }, [
        el('input', {
          type: 'checkbox',
          onChange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); },
        }),
        el('div', { style: { flex: '1' } }, [
          el('div', { style: { fontSize: '14px', fontWeight: '600' }, text: p.content.slice(0, 50) }),
          ch ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: ch.name }) : null,
        ]),
      ]);
    })
  );

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '480px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' } }, [
      el('h3', { text: '管理今日待复习' }),
      el('p', { text: '勾选不想今天复习的知识点，选择处理方式', style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' } }),
      list,
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' } }, [
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全选',
            onClick: () => {
              due.forEach(p => selected.add(p.id));
              list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '全不选',
            onClick: () => {
              selected.clear();
              list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            },
          }),
        ]),
        el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
          el('button', {
            class: 'btn btn-sm btn-primary', text: '今天跳过',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(0, 0, 0, 0);
              selected.forEach(id => store.snoozePoint(id, tomorrow.toISOString()));
              mask.remove();
              toastSuccess(`已跳过 ${selected.size} 个知识点，明天再出现`);
              renderHome();
            },
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '3 天后',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              const d = new Date();
              d.setDate(d.getDate() + 3);
              d.setHours(0, 0, 0, 0);
              selected.forEach(id => store.snoozePoint(id, d.toISOString()));
              mask.remove();
              toastSuccess(`已推迟 ${selected.size} 个知识点 3 天`);
              renderHome();
            },
          }),
          (() => {
            const dayInput = el('input', { type: 'number', min: '1', max: '365', placeholder: '天数', style: { width: '60px', padding: '4px 6px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)', fontSize: '13px' } });
            const customBtn = el('button', {
              class: 'btn btn-sm btn-ghost', text: '推迟',
              onClick: () => {
                if (selected.size === 0) { alert('请先勾选'); return; }
                const days = parseInt(dayInput.value);
                if (!days || days < 1 || days > 365) { alert('请输入 1-365 之间的天数'); return; }
                const d = new Date();
                d.setDate(d.getDate() + days);
                d.setHours(0, 0, 0, 0);
                selected.forEach(id => store.snoozePoint(id, d.toISOString()));
                mask.remove();
                toastSuccess(`已推迟 ${selected.size} 个知识点 ${days} 天`);
                renderHome();
              }
            });
            return el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg)', padding: '2px 6px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)' } }, [dayInput, customBtn]);
          })(),
          el('button', {
            class: 'btn btn-sm btn-danger', text: '永久排除',
            onClick: () => {
              if (selected.size === 0) { alert('请先勾选'); return; }
              if (!confirm(`永久排除 ${selected.size} 个知识点，不再出现在待复习里？`)) return;
              selected.forEach(id => store.excludePoint(id));
              mask.remove();
              toastSuccess(`已排除 ${selected.size} 个知识点`);
              renderHome();
            },
          }),
        ]),
        el('div', { style: { textAlign: 'right' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => mask.remove() }),
        ]),
      ]),
    ]),
  ]);
  document.body.appendChild(mask);
}

function openCopyPasteModal() {
  const clipboardRaw = localStorage.getItem('kg_clipboard_copy');
  let clipboardName = '';
  if (clipboardRaw) {
    try {
      const data = JSON.parse(clipboardRaw);
      clipboardName = data.type === 'task' ? data.task.name : data.chapter.name;
    } catch { }
  }

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '340px' } }, [
      el('h3', { text: '📋 复制与粘贴' }),
      el('p', { style: { fontSize: '12px', color: 'var(--text-2)', margin: '8px 0 16px' }, text: '你可以复制当前任务列表里的某一个，或者把剪贴板里刚复制的内容粘贴出来。' }),
      el('button', {
        class: 'btn btn-primary', text: '📥 粘贴剪贴板内容', style: { width: '100%', marginBottom: '8px' },
        onClick: () => {
          if (!clipboardRaw) { alert('剪贴板为空'); return; }
          const res = store.pasteData();
          if (res.success) {
            toastSuccess(res.msg);
            mask.remove();
            if (multiSelectMode) { multiSelectMode = false; selectedIds.clear(); }
            renderHome();
          } else {
            alert(res.msg);
          }
        },
      }),
      clipboardName ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '16px', textAlign: 'center' }, text: `剪贴板当前内容：${clipboardName}` }) : null,
      el('div', { style: { borderTop: '1px solid rgba(0,0,0,.06)', paddingTop: '16px', marginTop: '8px' } }, [
        el('button', {
          class: 'btn btn-ghost', text: '📋 复制指定任务', style: { width: '100%' },
          onClick: () => {
            const tasks = store.getTasks();
            if (tasks.length === 0) { alert('没有任务可复制'); return; }
            const targetName = prompt('输入要复制的任务名称（需完全一致）：', tasks[0].name);
            if (!targetName) return;
            const target = tasks.find(t => t.name === targetName);
            if (target) {
              store.copyTask(target.id);
              toastSuccess(`已复制「${target.name}」`);
              mask.remove();
            } else {
              alert('未找到该名称的任务');
            }
          },
        }),
      ]),
      el('div', { style: { marginTop: '16px', textAlign: 'center' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '关闭', onClick: () => mask.remove() })
      ])
    ])
  ]);
  document.body.appendChild(mask);
}

//补回了丢失的快速预览图片方法
async function openQuickImagePreview(imageIds, title) {
  if (!imageIds || imageIds.length === 0) return;
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'rgba(0,0,0,0.9)' } });
  const imgWrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '20px', maxHeight: '80vh', overflowY: 'auto', justifyContent: 'center' } });
  mask.appendChild(el('h3', { text: title + ' - 附件预览', style: { color: '#fff', textAlign: 'center', marginTop: '20px' } }));
  mask.appendChild(imgWrap);
  for (const id of imageIds) {
    const rec = await store.dbGet('images', id);
    if (rec && (rec.annotatedBlob || rec.originalBlob)) {
      const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
      imgWrap.appendChild(el('img', { src: url, style: { maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px', objectFit: 'contain' }, onLoad: () => URL.revokeObjectURL(url) }));
    }
  }
  const closeBtn = el('button', { class: 'btn btn-primary', text: '关闭', style: { position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)' }, onClick: () => mask.remove() });
  mask.appendChild(closeBtn);
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  document.body.appendChild(mask);
}

//移入文件夹弹窗
function openMoveToFolderModal(selectedCardIds, onSuccess) {
  if (selectedCardIds.size === 0) return;

  const allFolders = store.getTasks();
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
    el('h3', { text: `移动 ${selectedCardIds.size} 张卡片` }),
    el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择要移动到的文件夹：' }),
  ]);
  mask.appendChild(box);

  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' } });

  if (allFolders.length === 0) {
    list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '暂无已有文件夹' }));
  } else {
    const folderContainer = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    allFolders.forEach(folder => {
      folderContainer.appendChild(el('div', {
        style: { padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.04)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' },
        onClick: () => executeMove(folder)
      }, [
        el('span', { text: '📁', style: { fontSize: '16px' } }),
        el('span', { text: folder.name, style: { fontWeight: '500' } })
      ]));
    });
    list.appendChild(folderContainer);
  }
  box.appendChild(list);

  // 底部操作区
  box.appendChild(el('div', { class: 'confirm-actions', style: { justifyContent: 'space-between' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📁+ 新建文件夹并移入',
      onClick: () => {
        const newName = prompt('输入新文件夹名称：');
        if (!newName || !newName.trim()) return;
        const finalName = newName.trim();

        // 建文件夹
        const newTask = store.createTask({ name: finalName });
        executeMove(newTask);
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
  ]));

  // 真正的执行移动逻辑
  function executeMove(targetTask) {
    let chapters = store.getChapters(targetTask.id);
    let targetChapterId = chapters.length > 0 ? chapters[0].id : store.createChapter({ name: '默认子模块', taskId: targetTask.id }).id;

    selectedCardIds.forEach(id => {
      const pt = store.getPoint(id);
      if (pt) store.updatePoint(id, { chapterId: targetChapterId });
    });

    toastSuccess(`已将 ${selectedCardIds.size} 张卡片移入「${targetTask.name}」`);
    mask.remove();

    // 清理状态并刷新
    selectedCardIds.clear();
    onSuccess();
  }

  document.body.appendChild(mask);
}