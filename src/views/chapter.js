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
import { renderFAB } from '../main.js';


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


// ============ 文件夹详情（子文件夹 + 卡片 + 全功能批量） ============
let ptMulti = false;
const ptSelected = new Set();
let globalUndoStack = JSON.parse(localStorage.getItem('kg_undo_stack') || '[]'); //  多步撤销历史记录

try {
  globalUndoStack = JSON.parse(localStorage.getItem('kg_undo_stack') || '[]');
} catch (e) { globalUndoStack = []; }

// 辅助保存函数
function saveUndoStack() {
  localStorage.setItem('kg_undo_stack', JSON.stringify(globalUndoStack));
}

export function renderFolderDetail({ params, query }) {
  // 把当前页面的刷新能力暴露给全局
  window.renderFolderGlobal = () => renderFolderDetail({ params, query });
  const folderId = params.taskId;
  const currentFolder = store.getTask(folderId);
  if (!currentFolder) { navigate('#/'); return; }

  const view = document.getElementById('view');
  clear(view);

  document.getElementById('page-title').textContent = ptMulti ? '批量选择' : currentFolder.name;
  document.getElementById('btn-back').classList.remove('hidden');

  // 返回上一级逻辑
  document.getElementById('btn-back').onclick = () => {
    if (ptMulti) {
      ptMulti = false;
      ptSelected.clear();
      renderFolderDetail({ params, query });
    } else {
      if (currentFolder.parentId) {
        navigate(`#/folder/${currentFolder.parentId}`);
      } else {
        navigate('#/');
      }
    }
  };

  const points = store.getPoints(folderId);
  const subFolders = store.getTasks().filter(t => t.parentId === folderId);

  // ================= 顶部操作区 =================
  if (ptMulti) {
    // 1. 左侧的操作按钮横向滚动区
    const actionBar = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px',
        overflowX: 'auto', scrollbarWidth: 'none', flexShrink: '1',
        paddingBottom: '2px'
      }
    }, [
      // 撤销组
      el('div', { style: { display: 'flex', alignItems: 'center', marginRight: '4px', flexShrink: 0 } }, [
        globalUndoStack.length > 0 ? el('button', {
          class: 'btn btn-sm',
          style: {
            borderTopRightRadius: '0', borderBottomRightRadius: '0',
            padding: '0 6px', fontSize: '11px', minHeight: '24px', height: '24px',
            background: 'rgba(239,71,111,0.1)', color: 'var(--danger)',
            border: '1px solid rgba(239,71,111,0.2)', borderRight: 'none',
            fontWeight: '600', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center'
          },
          title: '打开撤销历史列表',
          onClick: () => {
            const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
            const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' } }, [
              el('h3', { text: '↩️ 排版历史记录', style: { marginBottom: '12px', fontSize: '16px' } }),
              el('div', { style: { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' } },
                globalUndoStack.map((snapshot, idx) => {
                  const timeStr = snapshot.time || '记录';
                  const actionName = snapshot.action || '样式';
                  return el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.05)' } }, [
                    el('span', { text: `${idx + 1}. [${actionName}] (${timeStr})`, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text)' } }),
                    el('button', {
                      class: 'btn btn-sm btn-danger', style: { padding: '4px 12px', fontSize: '12px', minHeight: '26px', whiteSpace: 'nowrap' },
                      onClick: async () => {
                        if (await confirmBox({ title: '确认回滚', message: `确定要回滚到第 ${idx + 1} 步吗？\n此操作将撤销之后的排版。`, danger: true })) {
                          snapshot.forEach(item => store.updatePoint(item.id, { content: item.oldContent, order: item.oldOrder }));
                          globalUndoStack = globalUndoStack.slice(0, idx);
                          localStorage.setItem('kg_undo_stack', JSON.stringify(globalUndoStack));
                          toastSuccess(`已回滚至第 ${idx + 1} 步`);
                          mask.remove();
                          if (typeof window.renderFolderGlobal === 'function') window.renderFolderGlobal();
                        }
                      }
                    }, [el('span', { text: '回滚至此处' })])
                  ]);
                })
              ),
              el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })])
            ]);
            mask.appendChild(box); document.body.appendChild(mask);
          }
        }, [el('span', { text: `↩️ 撤销 (${globalUndoStack.length})` })]) : null,

        // 收起/展开箭头
        el('button', {
          class: 'btn btn-sm',
          style: { padding: '0', width: '24px', height: '24px', minHeight: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', borderTopLeftRadius: globalUndoStack.length > 0 ? '0' : '4px', borderBottomLeftRadius: globalUndoStack.length > 0 ? '0' : '4px', background: 'rgba(239,71,111,0.05)', color: 'var(--danger)', border: '1px solid rgba(239,71,111,0.2)' },
          onClick: (e) => {
            const btn = e.target.closest('button').previousElementSibling;
            if (btn) { if (btn.style.display === 'none') { btn.style.display = 'flex'; e.target.textContent = '◀'; } else { btn.style.display = 'none'; e.target.textContent = '▶'; } }
          }
        }, [el('span', { text: '◀' })])
      ]),

      // 2. 排序按钮
      el('button', { class: 'btn btn-sm btn-primary', text: '🔢 排序', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' }, onClick: () => openSortManager() }),

      // 3. 合并按钮
      el('button', {
        class: 'btn btn-sm btn-primary', text: '合并', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
        onClick: async () => {
          if (ptSelected.size < 2) { alert('至少选择 2 个知识点'); return; }
          const ids = [...ptSelected]; const targetId = ids[0]; const items = ids.map(id => store.getPoint(id));
          if (typeof mergeModal === 'function') {
            await mergeModal({
              title: '合并知识点', items, targetId, onConfirm: (sourceIds, dedupe, newName, sortMode, mergeMode, saveMode, customExplanation) => {
                store.mergePoints(sourceIds, targetId, dedupe, newName, sortMode, mergeMode, saveMode, customExplanation); toastSuccess('合并成功！'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query });
              }
            });
          }
        },
      }),

      // 4. 查找替换按钮（把你之前粘贴的长代码放在这里）
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🔍 查找替换', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
        onClick: () => {
          if (ptSelected.size === 0) return toastError('请先勾选要操作的卡片');
          const selectedPoints = [...ptSelected].map(id => store.getPoint(id)).filter(Boolean);

          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '420px', width: '95%', padding: '12px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: '8px' } }, [

            // 1. 头部
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '4px' } }, [
              el('h3', { text: '🔍 批量查找替换', style: { margin: 0, fontSize: '15px', color: 'var(--text)' } }),
              el('button', { class: 'btn btn-sm btn-ghost', text: '✖', onClick: () => mask.remove(), style: { padding: '2px 6px', fontSize: '12px' } })
            ]),

            // 2. 模式切换
            el('div', { style: { display: 'flex', gap: '4px', background: 'var(--bg)', padding: '2px', borderRadius: '6px' } }, [
              el('label', { style: { flex: '1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '12px', padding: '4px', borderRadius: '4px', background: 'var(--card)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' } }, [
                el('input', { type: 'radio', name: 'replace-mode', value: 'normal', checked: true, onChange: () => { switchTab('normal'); } }),
                '普通文本'
              ]),
              el('label', { style: { flex: '1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '12px', padding: '4px', borderRadius: '4px' } }, [
                el('input', { type: 'radio', name: 'replace-mode', value: 'sequence', onChange: () => { switchTab('seq'); } }),
                '序列替换'
              ])
            ]),

            // 3. 输入框
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                el('span', { text: '查找', style: { fontSize: '12px', color: 'var(--text-2)', width: '32px' } }),
                el('input', { type: 'text', id: 'batch-search-input', placeholder: '支持正则，如：\\d+\\.', style: { flex: '1', padding: '4px 8px', borderRadius: '6px', border: '1px solid #ccc', outline: 'none', fontSize: '12px' } })
              ]),
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                el('span', { text: '替换', style: { fontSize: '12px', color: 'var(--text-2)', width: '32px' } }),
                el('input', { type: 'text', id: 'batch-replace-input', placeholder: '留空则删除，可用 $1 占位', style: { flex: '1', padding: '4px 8px', borderRadius: '6px', border: '1px solid #ccc', outline: 'none', fontSize: '12px' } })
              ])
            ]),

            // 4. 序列生成规则（极简折叠）
            el('div', { id: 'seq-config', style: { display: 'none', flexDirection: 'column', gap: '6px', padding: '8px', background: 'rgba(142,202,230,0.08)', borderRadius: '6px', border: '1px dashed var(--primary)' } }, [
              el('div', {
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' },
                onClick: (e) => {
                  const content = document.getElementById('seq-config-content');
                  const arrow = e.currentTarget.querySelector('.arrow');
                  if (content.style.display === 'none') { content.style.display = 'flex'; arrow.textContent = '▾'; }
                  else { content.style.display = 'none'; arrow.textContent = '▸'; }
                }
              }, [
                el('div', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary-dark)', display: 'flex', alignItems: 'center', gap: '4px' } }, [
                  el('span', { text: '⚙️ 序列生成规则' }),
                  el('span', { text: '（点击展开/收起）', style: { fontSize: '11px', fontWeight: 'normal', color: 'var(--text-2)' } })
                ]),
                el('span', { class: 'arrow', text: '▸', style: { fontSize: '12px', color: 'var(--primary-dark)' } })
              ]),
              el('div', { id: 'seq-config-content', style: { display: 'none', flexDirection: 'column', gap: '6px', paddingTop: '4px' } }, [
                el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, [
                  el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' } }, [el('input', { type: 'radio', name: 'seq-type', value: 'number' }), '数字']),
                  el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' } }, [el('input', { type: 'radio', name: 'seq-type', value: 'chinese', checked: true }), '中文']),
                  el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' } }, [el('input', { type: 'radio', name: 'seq-type', value: 'letter' }), '字母'])
                ]),
                el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
                  el('span', { text: '范围', style: { fontSize: '12px', color: 'var(--text-2)' } }),
                  el('input', { type: 'number', id: 'batch-seq-start', value: '1', style: { width: '40px', padding: '3px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none', fontSize: '12px', textAlign: 'center' } }),
                  el('span', { text: '-', style: { fontSize: '12px', color: 'var(--text-2)' } }),
                  el('input', { type: 'number', id: 'batch-seq-end', value: '20', style: { width: '40px', padding: '3px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none', fontSize: '12px', textAlign: 'center' } }),
                  el('span', { text: '指定', style: { fontSize: '12px', color: 'var(--text-2)', marginLeft: '4px' } }),
                  el('input', { type: 'text', id: 'batch-seq-specific', placeholder: '如 4,6,7', style: { width: '60px', padding: '3px 6px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none', fontSize: '12px' } })
                ]),
                el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
                  el('span', { text: '加符号', style: { fontSize: '12px', color: 'var(--text-2)' } }),
                  el('input', { type: 'text', id: 'batch-seq-prefix', placeholder: '前缀', style: { width: '45px', padding: '3px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none', fontSize: '12px', textAlign: 'center' } }),
                  el('span', { text: '数字', style: { fontSize: '12px', color: 'var(--text-3)' } }),
                  el('input', { type: 'text', id: 'batch-seq-suffix', placeholder: '后缀', style: { width: '45px', padding: '3px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none', fontSize: '12px', textAlign: 'center' } })
                ])
              ])
            ]),

            // 5. 场景一键套用（超薄卡片）
            el('div', { style: { flexShrink: '0', display: 'flex', flexDirection: 'column', gap: '4px' } }, [
              el('div', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--text)' }, text: '💡 常用场景一键套用' }),
              el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto', paddingRight: '2px' } }, [

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: '彻底删除所有混合序号', style: { fontSize: '12px', fontWeight: '600', color: 'var(--danger)' } }),
                    el('span', { text: '查找：^[\\d\\u4e00-\\u9fa5A-Za-z①-⑳]+[\\.\\、\\s]*', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => applyScenario('^[\\d\\u4e00-\\u9fa5A-Za-z①-⑳]+[\\.\\、\\s]*', '') })
                ]),

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: '删除纯数字序号', style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary-dark)' } }),
                    el('span', { text: '查找：^\\d+\\.\\s*', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => applyScenario('^\\d+\\.\\s*', '') })
                ]),

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: '1. 变 一、 (序列转中文)', style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary)' } }),
                    el('span', { text: '查找：^\\d+\\.', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => { applyScenario('^\\d+\\.', ''); switchTab('seq'); } })
                ]),

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: '1. 变 A. (数字转字母)', style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary)' } }),
                    el('span', { text: '查找：^\\d+\\.', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => { applyScenario('^\\d+\\.', ''); switchTab('seq'); document.querySelector('input[name="seq-type"][value="letter"]').checked = true; } })
                ]),

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: 'A. 变 1. (字母转数字)', style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary)' } }),
                    el('span', { text: '查找：^[A-Z]+\\.', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => { applyScenario('^[A-Z]+\\.', ''); switchTab('seq'); document.querySelector('input[name="seq-type"][value="number"]').checked = true; } })
                ]),

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: 'A. 变 一、 (字母转中文)', style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary)' } }),
                    el('span', { text: '查找：^[A-Z]+\\.', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => { applyScenario('^[A-Z]+\\.', ''); switchTab('seq'); document.querySelector('input[name="seq-type"][value="chinese"]').checked = true; } })
                ]),

                el('div', { style: { background: 'var(--bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } }, [
                    el('span', { text: '(1) 变 1. (去括号)', style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary)' } }),
                    el('span', { text: '查找：^\\((\\d+)\\)', style: { fontSize: '10px', color: 'var(--text-2)' } })
                  ]),
                  el('button', { class: 'btn btn-sm btn-ghost', text: '📋 套用', style: { padding: '0 4px', height: '18px', fontSize: '11px' }, onClick: () => applyScenario('^\\((\\d+)\\)', '$1') })
                ])

              ])
            ]),

            // 6. 预览区（紧凑）
            el('div', {
              id: 'batch-preview-box',
              style: { padding: '8px', background: 'var(--bg)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-2)', border: '1px dashed rgba(0,0,0,0.1)', flex: '1', overflowY: 'auto', minHeight: '60px' }
            }, '实时预览效果...'),

            // 7. 底部按钮
            el('div', { class: 'confirm-actions', style: { justifyContent: 'flex-end', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.05)' } }, [
              el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove(), style: { padding: '4px 12px', minHeight: '28px', fontSize: '13px' } }),
              el('button', {
                class: 'btn btn-primary', text: '确认替换', style: { padding: '4px 12px', minHeight: '28px', fontSize: '13px' },
                onClick: async () => {
                  // ... 你的确认替换逻辑完全保持不变 ...
                  const keyword = document.getElementById('batch-search-input').value;
                  const replacement = document.getElementById('batch-replace-input').value;
                  const isSeqMode = document.querySelector('input[name="replace-mode"]:checked').value === 'sequence';

                  if (!keyword) return toastError('请输入查找内容');
                  if (!await confirmBox({ title: '确认替换', message: `确定要执行批量替换吗？`, confirmText: '替换' })) return;

                  const snapshot = selectedPoints.map(p => ({ id: p.id, oldContent: p.content, oldOrder: p.order }));
                  snapshot.action = '查找替换';
                  snapshot.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  globalUndoStack.push(snapshot);
                  if (globalUndoStack.length > 20) globalUndoStack.shift();
                  saveUndoStack();

                  let count = 0;
                  if (isSeqMode) {
                    // ... (你刚才的序列替换代码) ...
                  } else {
                    selectedPoints.forEach(p => {
                      let newContent = (p.content || '').replace(new RegExp(keyword, 'gi'), replacement);
                      if (newContent !== p.content) { store.updatePoint(p.id, { content: newContent }); count++; }
                    });
                  }
                  toastSuccess(`已成功替换 ${count} 张卡片的内容`);
                  mask.remove(); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query });
                }
              })
            ])
          ]);

          // 辅助方法
          const switchTab = (type) => {
            if (type === 'normal') {
              box.querySelectorAll('input[name="replace-mode"]')[0].checked = true;
              document.getElementById('seq-config').style.display = 'none';
            } else {
              box.querySelectorAll('input[name="replace-mode"]')[1].checked = true;
              document.getElementById('seq-config').style.display = 'flex';
            }
            updatePreview();
          };

          const applyScenario = (search, replace) => {
            document.getElementById('batch-search-input').value = search;
            document.getElementById('batch-replace-input').value = replace;
            updatePreview();
            toastSuccess('已套用');
          };

          // 完整的预览更新逻辑
          const updatePreview = () => {
            const keyword = document.getElementById('batch-search-input').value;
            const replacement = document.getElementById('batch-replace-input').value;
            const previewBox = document.getElementById('batch-preview-box');
            const isSeqMode = document.querySelector('input[name="replace-mode"]:checked').value === 'sequence';

            if (!keyword) { previewBox.innerHTML = '输入查找词以预览...'; return; }

            let regex;
            try {
              // 防御性清理正则输入
              let cleanKeyword = keyword.trim();
              if (cleanKeyword.startsWith('/') && cleanKeyword.lastIndexOf('/') > 0) {
                cleanKeyword = cleanKeyword.slice(1, cleanKeyword.lastIndexOf('/'));
              }
              cleanKeyword = cleanKeyword.replace(/[\\\|\s]+$/, ''); // 清理末尾垃圾
              regex = new RegExp(cleanKeyword, 'gi');
            } catch (e) {
              previewBox.innerHTML = `<span style="color:var(--danger)">❌ 正则语法错误：${e.message}</span>`;
              return;
            }

            let previewHtml = '';
            let matchCount = 0;

            if (isSeqMode) {
              // 序列模式预览
              const seqType = document.querySelector('input[name="seq-type"]:checked').value;
              let currentNum = Number(document.getElementById('batch-seq-start').value) || 1;
              const prefix = document.getElementById('batch-seq-prefix').value || '';
              const suffix = document.getElementById('batch-seq-suffix').value || '';
              const cnNums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];

              selectedPoints.forEach(p => {
                regex.lastIndex = 0;
                if (regex.test(p.content)) {
                  regex.lastIndex = 0;
                  const newStr = p.content.replace(regex, () => {
                    let res = '';
                    if (seqType === 'number') res = String(currentNum);
                    else if (seqType === 'chinese') res = cnNums[currentNum] || String(currentNum);
                    else if (seqType === 'letter') res = String.fromCharCode(64 + currentNum);
                    currentNum++;
                    return `<span style="background:var(--primary); color:#fff; padding:0 2px; border-radius:2px">${prefix + res + suffix}</span>`;
                  });
                  if (previewHtml.length < 500) previewHtml += `<div style="margin-bottom:4px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">• ${newStr}</div>`;
                  matchCount++;
                }
              });
            } else {
              // 普通替换预览
              selectedPoints.forEach(p => {
                regex.lastIndex = 0;
                if (regex.test(p.content)) {
                  regex.lastIndex = 0;
                  const newStr = p.content.replace(regex, `<span style="background:var(--danger); color:#fff; padding:0 2px; border-radius:2px">${replacement || '删'}</span>`);
                  if (previewHtml.length < 500) previewHtml += `<div style="margin-bottom:4px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">• ${newStr}</div>`;
                  matchCount++;
                }
              });
            }

            if (matchCount === 0) {
              previewBox.innerHTML = '<span style="color:var(--danger); font-size:12px;">没有匹配到内容，请检查正则语法或关键词</span>';
            } else {
              previewBox.innerHTML = `<div style="font-weight:600; margin-bottom:4px; font-size:12px; color:var(--primary-dark)">✨ 找到 ${matchCount} 张卡片，效果预览：</div><div style="max-height:80px; overflow-y:auto;">${previewHtml}</div>`;
            }
          };

          // 绑定所有相关输入事件，确保实时触发
          box.querySelectorAll('input[name="replace-mode"]').forEach(r => r.addEventListener('change', updatePreview));
          box.querySelector('#batch-search-input').addEventListener('input', updatePreview);
          box.querySelector('#batch-replace-input').addEventListener('input', updatePreview);
          box.querySelectorAll('input[name="seq-type"]').forEach(r => r.addEventListener('change', updatePreview));

          // 绑定序列配置中的输入框和下拉，保证调参时预览也能变
          ['batch-seq-start', 'batch-seq-end', 'batch-seq-prefix', 'batch-seq-suffix'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.addEventListener('input', updatePreview);
          });

          mask.appendChild(box);
          document.body.appendChild(mask);

          // 延迟聚焦
          setTimeout(() => document.getElementById('batch-search-input').focus(), 100);
        }
      }),
      // 5. 其他按钮
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📋 复制', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
        onClick: () => { if (ptSelected.size === 0) return toastError('请先勾选卡片'); const pts = [...ptSelected].map(id => store.getPoint(id)).filter(Boolean); localStorage.setItem('kg_clipboard_points', JSON.stringify(pts)); toastSuccess(`已复制 ${pts.length} 张卡片`); }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '📥 粘贴', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
        onClick: async () => { /* 保留你的粘贴逻辑 */ }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🚚 移动', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
        onClick: () => { /* 保留你的移动逻辑 */ }
      }),
      // 纯小箭头下拉菜单（支持展开/收起切换）
      el('div', { style: { position: 'relative', flexShrink: 0 } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '▼', id: 'batch-more-arrow',
          style: { padding: '0 6px', fontSize: '10px', minHeight: '24px', height: '24px', whiteSpace: 'nowrap', color: 'var(--primary-dark)' },
          onClick: (e) => {
            e.stopPropagation();
            const arrow = e.target.closest('button');
            const existing = document.getElementById('batch-more-menu');

            // 如果已经打开，点击就关闭
            if (existing) {
              existing.remove();
              arrow.textContent = '▼';
              return;
            }

            // 如果没打开，就打开，并变箭头
            arrow.textContent = '▲';
            const rect = arrow.getBoundingClientRect();
            const menu = el('div', {
              id: 'batch-more-menu',
              style: {
                position: 'fixed', top: (rect.bottom + 4) + 'px', right: (window.innerWidth - rect.right) + 'px',
                background: 'var(--card)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '6px', zIndex: 99999,
                display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '120px'
              }
            }, [
              el('button', { class: 'btn btn-sm btn-ghost', text: '✅ 记得', style: { justifyContent: 'flex-start', padding: '6px 12px', fontSize: '13px' }, onClick: () => { store.batchRatePoints([...ptSelected], 'remember'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); menu.remove(); arrow.textContent = '▼'; } }),
              el('button', { class: 'btn btn-sm btn-ghost', text: '🤔 模糊', style: { justifyContent: 'flex-start', padding: '6px 12px', fontSize: '13px' }, onClick: () => { store.batchRatePoints([...ptSelected], 'vague'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); menu.remove(); arrow.textContent = '▼'; } }),
              el('button', { class: 'btn btn-sm btn-ghost', text: '❌ 忘了', style: { justifyContent: 'flex-start', padding: '6px 12px', fontSize: '13px' }, onClick: () => { store.batchRatePoints([...ptSelected], 'forgot'); toastSuccess('已标记'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); menu.remove(); arrow.textContent = '▼'; } }),
              el('div', { style: { height: '1px', background: 'rgba(0,0,0,0.05)', margin: '4px 0' } }),
              el('button', { class: 'btn btn-sm btn-ghost', text: '📊 设置难度', style: { justifyContent: 'flex-start', padding: '6px 12px', fontSize: '13px' }, onClick: () => { const d = prompt('输入难记度 1-10', '5'); if (d && Number(d) >= 1 && Number(d) <= 10) { store.batchUpdatePoints([...ptSelected], { difficulty: Number(d) }); toastSuccess('已更新难度'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); } menu.remove(); arrow.textContent = '▼'; } }),
              el('button', { class: 'btn btn-sm btn-ghost', text: '📅 今天复习', style: { justifyContent: 'flex-start', padding: '6px 12px', fontSize: '13px' }, onClick: () => { store.batchUpdatePoints([...ptSelected], { nextReviewAt: new Date().toISOString() }); toastSuccess('已设为今天复习'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); menu.remove(); arrow.textContent = '▼'; } })
            ]);

            document.body.appendChild(menu);

            // 点击页面其他区域，关闭菜单并恢复箭头
            setTimeout(() => {
              document.addEventListener('pointerdown', function close(e) {
                if (!menu.contains(e.target) && !e.target.closest('button')) {
                  menu.remove();
                  arrow.textContent = '▼';
                  document.removeEventListener('pointerdown', close);
                }
              });
            }, 10);
          }
        })
      ]),

      // 删除按钮
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除', style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
        onClick: async () => { if (ptSelected.size === 0) return; if (await confirmBox({ title: '删除', message: `删除 ${ptSelected.size} 个知识点？将进入回收站`, danger: true, confirmText: '删除' })) { store.batchDeletePoints([...ptSelected]); toastSuccess('已移入回收站'); ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); } }
      })
    ]);

    // 2. 最终组装在一行（极低高度，微灰色背景）
    view.appendChild(el('div', {
      style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '4px 10px', // 极薄
        background: 'rgba(0,0,0,0.02)', // 极其低调的微灰色，抛弃红色
        borderRadius: '8px',
        marginBottom: '10px',
        border: '1px solid rgba(0,0,0,0.04)',
        flexWrap: 'nowrap',
        height: '40px' // 锁定高度
      }
    }, [
      // 左侧：已选数量 + 操作按钮
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flex: '1', minWidth: '0' } }, [
        el('span', { text: `已选 ${ptSelected.size} 项`, style: { fontWeight: '600', color: 'var(--primary-dark)', whiteSpace: 'nowrap', flexShrink: '0', fontSize: '13px' } }),
        actionBar
      ]),

      // 右侧：取消按钮
      el('div', { style: { display: 'flex', gap: '6px', flexShrink: '0' } }, [
        // 全选按钮
        el('button', {
          class: 'btn btn-sm btn-ghost',
          text: (points.length > 0 && ptSelected.size === points.length) ? '全不选' : '全选',
          style: { padding: '0 8px', fontSize: '12px', minHeight: '24px', height: '24px', flexShrink: 0, whiteSpace: 'nowrap' },
          onClick: () => {
            if (points.length > 0 && ptSelected.size === points.length) {
              ptSelected.clear();
            } else {
              points.forEach(p => ptSelected.add(p.id));
            }
            renderFolderDetail({ params, query });
          }
        }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '取消', style: { height: '24px', minHeight: '24px', fontSize: '12px', padding: '0 8px' }, onClick: () => { ptMulti = false; ptSelected.clear(); renderFolderDetail({ params, query }); } })
      ])

    ]));

  } else {
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary', text: '🎯 开始复习',
        onClick: () => {
          if (points.length === 0) return toastError('当前文件夹没有卡片，无法复习');
          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px', textAlign: 'center' } }, [
            el('h3', { text: '选择复习模式', style: { marginBottom: '16px' } }),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
              el('button', { class: 'btn btn-primary', text: '🖥️ 沉浸式模式 (全屏大字)', onClick: () => { mask.remove(); if (typeof startReviewMode === 'function') startReviewMode(points, folderId); } }),
              el('button', { class: 'btn btn-ghost', text: '📋 专注列表模式 (在原列表操作)', onClick: () => { mask.remove(); if (typeof startFocusListMode === 'function') startFocusListMode(points, folderId); } }),
              el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
            ])
          ]);
          mask.appendChild(box);
          document.body.appendChild(mask);
        }
      }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '☑ 批量', onClick: () => { ptMulti = true; renderFolderDetail({ params, query }); } }),
    ]));
  }

  // ================= 渲染子文件夹（直接一键递归） =================
  if (subFolders.length > 0) {
    const folderList = el('div', { style: { marginBottom: '20px' } });
    // 我们只遍历当前文件夹的直接子级，更深的层级由 taskCard 里的递归自动处理
    subFolders.forEach(sub => {
      folderList.appendChild(taskCard(sub, folderId));
    });
    view.appendChild(folderList);
  }

  // ================= 渲染卡片 =================
  if (points.length === 0 && subFolders.length === 0) {
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '📂' }),
      el('div', { text: '文件夹空空如也' }),
      el('div', { text: '点击右下角 + 新建文件夹或卡片', style: { fontSize: '13px', marginTop: '8px' } })
    ]));
  } else if (points.length > 0) {
    const list = el('div', { id: 'point-list' });
    points.forEach(p => list.appendChild(pointCard(p, folderId)));
    view.appendChild(list);
    if (!ptMulti && typeof makeSortable === 'function') {
      makeSortable(list, '.card', (orderedIds) => {
        store.reorderPoints(folderId, orderedIds);
        toastSuccess('顺序已保存');
      });
    }
  }

  // ================= 悬浮球 =================
  if (!ptMulti) {
    renderFAB(view, folderId);
  }
}

// ============ 极简卡片渲染 ============
function pointCard(p, folderId) {
  let isExpanded = false;
  const isSelected = ptSelected.has(p.id);

  const allPts = JSON.parse(localStorage.getItem('kg_points') || '[]');
  const freshP = allPts.find(x => x.id === p.id) || p;
  const cardTags = freshP.tags || [];

  const contentBox = el('div', {
    style: { display: 'none', marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(0,0,0,.1)' }
  });

  const card = el('div', {
    class: 'card point-card-content' + (isSelected ? ' selected' : ''),
    style: {
      cursor: 'pointer', padding: '4px 8px', transition: 'all 0.2s', background: 'var(--card)',
      borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      minHeight: 'auto', marginBottom: '2px'
    }
  });

  const header = el('div', {
    onClick: (e) => {
      if (e.target.closest('input') || e.target.closest('button')) return;
      if (ptMulti) {
        if (isSelected) ptSelected.delete(p.id); else ptSelected.add(p.id);
        renderFolderDetail({ params: { taskId: folderId } });
        return;
      }
      isExpanded = !isExpanded;
      contentBox.style.display = isExpanded ? 'block' : 'none';
    },
    style: { display: 'flex', flexDirection: 'column', gap: '0px' }
  }, [
    cardTags.length > 0 ? el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '2px', margin: '0', padding: '0' }
    }, cardTags.map(tag => el('span', {
      style: {
        color: tag.color || '#ff4757', backgroundColor: tag.bgColor || 'transparent',
        border: tag.borderColor !== 'transparent' ? `1px solid ${tag.borderColor}` : 'none',
        padding: '0px 4px', borderRadius: '2px', fontSize: '11px', fontWeight: 'bold', lineHeight: '1', margin: '0'
      },
      innerHTML: tag.html || tag.text
    }))) : null,

    el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'space-between', marginTop: cardTags.length > 0 ? '2px' : '0' } }, [
      el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', flex: '1' } }, [
        ptMulti ? el('input', {
          type: 'checkbox', checked: isSelected, style: { margin: 0, flexShrink: '0' },
          onChange: (e) => {
            if (e.target.checked) ptSelected.add(p.id); else ptSelected.delete(p.id);
            renderFolderDetail({ params: { taskId: folderId } });
          }
        }) : null,
        el('div', {
          style: { fontSize: '14px', fontWeight: '600', whiteSpace: 'pre-wrap', lineHeight: '1.2', wordBreak: 'break-word' },
          innerHTML: typeof parseLinks === 'function' ? parseLinks(p.content) : p.content
        })
      ]),
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
          onClick: (e) => { e.stopPropagation(); if (typeof showCardTagManager === 'function') showCardTagManager(p.id); }
        })
      ])
    ])
  ]);

  if (p.explanation) {
    const bgStyle = p.themeBg || 'rgba(0,0,0,0.02)';
    contentBox.appendChild(el('div', {
      style: { fontSize: '14px', color: 'var(--text-2)', marginBottom: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: bgStyle, padding: '12px', borderRadius: '8px', lineHeight: '1.6' },
      innerHTML: typeof parseLinks === 'function' ? parseLinks(p.explanation) : p.explanation
    }));
  }

  const footerRow = el('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap', gap: '4px' }
  });

  if (p.imageIds && p.imageIds.length > 0) {
    footerRow.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--primary)', fontWeight: '600' }, text: `🖼 包含 ${p.imageIds.length} 张图文附件` }));
  } else {
    footerRow.appendChild(el('div'));
  }

  const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn btn-sm btn-ghost', text: '✏️ 编辑', onClick: (e) => { e.stopPropagation(); navigate(`#/edit-point/${p.id}`); } }),
    el('button', { class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async (e) => { e.stopPropagation(); if (await confirmBox({ title: '删除卡片', message: '确定删除这张卡片吗？', danger: true, confirmText: '删除' })) { store.deletePoint(p.id); toastSuccess('已移入回收站'); renderFolderDetail({ params: { taskId: folderId } }); } } }),
    el('button', { class: 'btn btn-sm btn-ghost', text: '⬆️', title: '上移', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'up'); renderFolderDetail({ params: { taskId: folderId } }); } }),
    el('button', { class: 'btn btn-sm btn-ghost', text: '⬇️', title: '下移', onClick: (e) => { e.stopPropagation(); store.movePoint(p.id, 'down'); renderFolderDetail({ params: { taskId: folderId } }); } })
  ]);

  footerRow.appendChild(actions);
  contentBox.appendChild(footerRow);

  card.appendChild(header);
  card.appendChild(contentBox);

  const container = el('div', {
    class: 'point-card-container',
    style: { marginBottom: '6px', position: 'relative', overflow: 'hidden', borderRadius: '6px', background: 'var(--card)' }
  }, [
    card,
    el('div', {
      style: { position: 'absolute', bottom: '0', left: '0', width: '100%', height: '4px', background: '#8ECAE6', opacity: '0.6' }
    })
  ]);

  return container;
}

export function showCardTagManager(pointId) {
  const point = store.getPoint(pointId);
  if (!point) return toastError('找不到该卡片');

  //直接读取当前卡片自己的专属标签 (point.tags)
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

  // 1. 基础预设与本地存储读取
  const defaultColors = [
    { c: '#ff4757', s: false }, { c: '#2ed573', s: false }, { c: '#1e90ff', s: true },
    { c: '#ffa502', s: false }, { c: '#8e44ad', s: false }, { c: '#747d8c', s: false },
    { c: '#ff9ff3', s: false }, { c: '#f368e0', s: false },
    { c: '#000000', s: false }, { c: '#000080', s: false }, { c: 'transparent', s: false }
  ];

  let storedColors = [];
  try {
    storedColors = JSON.parse(localStorage.getItem('kg_tag_colors')) || [];
  } catch (e) {
    storedColors = [];
  }

  // 如果读取出来是空数组，强制使用默认颜色，并写回本地存储
  let presetColors = storedColors.length > 0 ? storedColors : JSON.parse(JSON.stringify(defaultColors));
  if (storedColors.length === 0) {
    localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors));
  }

  // 2. 定义你需要的 8 个「绝对防删」强制色
  const forcedColors = [
    { c: '#000000', s: true, isForced: true }, // 黑
    { c: '#000080', s: true, isForced: true }, // 藏青
    { c: 'transparent', s: true, isForced: true }, // 透明
    { c: '#1e90ff', s: true, isForced: true }, // 亮蓝
    { c: '#ff4757', s: true, isForced: true }, // 红
    { c: '#2ed573', s: true, isForced: true }, // 绿
    { c: '#8e44ad', s: true, isForced: true }, // 紫
    { c: '#f368e0', s: true, isForced: true }  // 粉
  ];

  // 3. 合并去重：确保强制色在最前面，且带保护标记
  forcedColors.forEach(fc => {
    // 移除本地存储中可能与强制色冲突的旧数据
    presetColors = presetColors.filter(p => p.c !== fc.c);
    presetColors.unshift(fc); // 强制色插入到最前面
  });

  // 4. 兜底逻辑：如果本地存储是空的，或者为了兼容你原来的 defaultColors
  // 把原本不在列表里的普通颜色（非强制色）补齐，以防数据为空时色盘太少
  defaultColors.forEach(dc => {
    if (!presetColors.some(p => p.c === dc.c)) {
      presetColors.push(dc);
    }
  });

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

            // 1. 安全读取本地存储
            let allWords = [];
            try {
              allWords = JSON.parse(localStorage.getItem('kg_common_words')) || [];
            } catch (e) {
              allWords = [];
            }

            // 2. 拆分预设与自定义
            let presetWords = allWords.filter(w => DEFAULT_WORDS.includes(w));
            let customWords = allWords.filter(w => !DEFAULT_WORDS.includes(w));

            // 如果预设字符被清空了，自动补全默认数学符号
            if (presetWords.length === 0) {
              presetWords = [...DEFAULT_WORDS];
              allWords = [...presetWords, ...customWords];
              localStorage.setItem('kg_common_words', JSON.stringify(allWords));
            }

            const wordMask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' } });
            const wordBox = el('div', { class: 'confirm-box', style: { maxWidth: '380px', width: '90%', padding: '16px', display: 'flex', flexDirection: 'column', background: 'var(--bg)' } });

            const insertChar = (w) => {
              wordMask.remove();
              setTimeout(() => {
                // 这里把 card-tag-editor 改成了 tag-editor，才能抓取到正确的富文本框
                const realEditor = document.getElementById('tag-editor');
                if (realEditor) {
                  realEditor.focus();
                  if (savedRange) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(savedRange);
                  }
                  const color = selectedColor === 'transparent' ? '#000000' : selectedColor;
                  document.execCommand('styleWithCSS', false, true);
                  document.execCommand('insertHTML', false, `<span style="color:${color}">${w}</span>`);
                  currentHtmlContent = realEditor.innerHTML;
                  saveSelection();
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
                  clear(grid);
                  header.lastChild.textContent = isCollapsed ? '▸' : '▾';
                  if (isCollapsed) return;

                  wordsArr.forEach(w => {
                    grid.appendChild(el('button', {
                      class: 'btn btn-sm btn-ghost',
                      text: w,
                      style: { fontSize: '16px', padding: '2px 10px', border: '1px solid #ccc' },
                      onMousedown: e => e.preventDefault(),
                      onClick: () => insertChar(w)
                    }));
                  });
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

        //2. 渲染外置快捷字符（实时从 localStorage 读取）
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

      //3. 分割线和 B、I 按钮
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

          //立刻把 currentTags 存到 localStorage 里！
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
      const isTransparent = c === 'transparent'; //  补上这个定义！

      let isSelected = false;
      if (activeColorType === 'text') isSelected = (selectedColor === c);
      if (activeColorType === 'bg') isSelected = (selectedBgColor === c);
      if (activeColorType === 'border') isSelected = (selectedBorderColor === c);

      //把 el 赋给变量 colorCircle
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

      //加上标记并挂载
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

          //  局部更新 UI
          const previewEl = document.getElementById('current-color-preview');
          if (previewEl) { previewEl.style.background = val; previewEl.style.backgroundImage = 'none'; }
        }
      })
    ]));
    colorContainer.appendChild(colorsWrap);

    // ================= 4. 收藏颜色区（带管理） =================
    const starredColors = presetColors.filter(item => item.s);
    colorContainer.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,0.1)', marginTop: '8px', marginBottom: '8px' } }));

    //收藏颜色标题区 + 管理按钮
    const starHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-2)' } }, [
      el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 'bold' },
        onClick: () => { isStarredExpanded = !isStarredExpanded; renderContent(null); }
      }, [
        el('span', { text: `⭐ 收藏颜色 (${starredColors.length})` }),
        el('span', { text: isStarredExpanded ? '▾' : '▸' })
      ]),
      //管理工具条
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
                //管理模式：点击是勾选
                if (selectedColorIndices.has(realIndex)) selectedColorIndices.delete(realIndex); else selectedColorIndices.add(realIndex);
                renderContent(null);
              } else {
                //普通模式：点击是选色
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

    //根据 isTagListCollapsed 的状态决定是否显示
    const listContainer = el('div', {
      style: { display: isTagListCollapsed ? 'none' : 'block' }
    }, [currentList, listActions]);

    // 阻止内部点击冒泡，防止误触外部重绘
    listContainer.onclick = (e) => e.stopPropagation();

    const listHeader = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginTop: '16px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px dashed rgba(0,0,0,.1)' },
      onClick: (e) => {
        e.stopPropagation();
        isTagListCollapsed = !isTagListCollapsed; //  切换状态
        renderContent(); //  重绘应用状态
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
          //  必须是 updatePoint，而不是 updateTask
          store.updatePoint(pointId, { tags: currentTags });
          toastSuccess('卡片标签已更新');
          mask.remove();
          renderChapterDetail({ params: { id: point.chapterId } });
        }
      })]));
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
  let isBarExpanded = false; //  控制是否展开

  const renderTouchBar = () => {
    const oldBar = document.getElementById('review-touch-bar');
    if (oldBar) oldBar.remove();

    const touchBar = el('div', {
      id: 'review-touch-bar',
      style: { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(43, 45, 66, 0.9)', backdropFilter: 'blur(10px)', padding: '6px 12px', borderRadius: '30px', display: 'flex', gap: '8px', zIndex: 100000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', alignItems: 'center', maxWidth: '95vw', overflowX: 'auto' }
    }, [
      // 跳转输入框（始终显示，可以直接跳到某题）
      el('input', {
        type: 'number', min: 1, max: points.length, placeholder: `${currentIndex + 1}/${points.length}`,
        style: { width: '60px', height: '28px', padding: '2px 6px', borderRadius: '14px', border: 'none', textAlign: 'center', fontSize: '12px', color: '#333', outline: 'none' },
        onKeyDown: (e) => {
          if (e.key === 'Enter') {
            const val = parseInt(e.target.value);
            if (val >= 1 && val <= points.length) {
              currentIndex = val - 1;
              isExpanded = false;
              renderCard();
              e.target.value = ''; // 清空
              e.target.blur(); // 收起键盘
            } else {
              toastError('超出范围');
            }
          }
        }
      }),

      // 翻转（始终显示）
      el('button', {
        class: 'btn btn-sm btn-primary', style: { fontSize: '14px', padding: '6px 16px', borderRadius: '20px' }, text: '翻转',
        onClick: () => { isExpanded = !isExpanded; renderCard(); }
      }),

      // 展开/收起按钮
      el('button', {
        class: 'btn btn-sm btn-ghost', style: { color: '#fff', fontSize: '14px', padding: '4px 8px', fontWeight: 'bold' }, text: isBarExpanded ? '收起' : '展开',
        onClick: () => { isBarExpanded = !isBarExpanded; renderTouchBar(); }
      }),

      // 展开后的按钮组
      ...(isBarExpanded ? [
        el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' } }),

        // 上一个
        el('button', { class: 'btn btn-sm btn-ghost', style: { color: '#fff', fontSize: '18px', padding: '4px 8px' }, text: '⬆️', title: '上一个', onClick: () => { if (currentIndex > 0) { currentIndex--; isExpanded = false; renderCard(); } } }),
        // 下一个
        el('button', { class: 'btn btn-sm btn-ghost', style: { color: '#fff', fontSize: '18px', padding: '4px 8px' }, text: '⬇️', title: '下一个', onClick: () => { if (currentIndex < points.length - 1) { currentIndex++; isExpanded = false; renderCard(); } } }),

        el('button', { class: 'btn btn-sm btn-ghost', style: { color: '#fff', fontSize: '16px', padding: '4px 8px' }, text: '🖼', title: '图片', onClick: () => { const p = points[currentIndex]; if (p.imageIds?.length) openQuickImages(p.imageIds); else toastSuccess('当前无图片'); } }),
        el('button', { class: 'btn btn-sm btn-ghost', style: { color: '#fff', fontSize: '16px', padding: '4px 8px' }, text: '📄', title: 'PDF', onClick: () => { const p = points[currentIndex]; const realPoint = JSON.parse(localStorage.getItem('kg_points') || '[]').find(x => x.id === p.id) || p; const pdfId = findPdfId(realPoint); if (pdfId) { window.location.hash = `#/pdf-viewer/${pdfId}?pointId=${p.id}`; mask.remove(); } else toastSuccess('当前无 PDF'); } }),

        el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' } }),

        // 打分按钮
        el('button', { class: 'btn btn-sm btn-danger', style: { padding: '4px 8px', fontSize: '13px' }, text: '忘了', onClick: () => ratePoint('forgot') }),
        el('button', { class: 'btn btn-sm btn-warning', style: { padding: '4px 8px', fontSize: '13px' }, text: '模糊', onClick: () => ratePoint('vague') }),
        el('button', { class: 'btn btn-sm btn-success', style: { padding: '4px 8px', fontSize: '13px' }, text: '记得', onClick: () => ratePoint('remember') })
      ] : [])
    ]);

    document.body.appendChild(touchBar);
  };

  renderTouchBar(); // 初始化

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
      // 复习到最后一张时，询问是否循环
      if (confirm('太棒了，该文件夹已复习完毕！\n点击“确定”从头循环复习，点击“取消”退出。')) {
        currentIndex = 0;
        isExpanded = false;
        renderCard();
      } else {
        mask.remove(); // 沉浸式退出
        window.onkeydown = null;
        document.body.style.overflow = '';
        // 改为调用新的文件夹渲染函数
        if (typeof renderFolderDetail === 'function') {
          renderFolderDetail({ params: { taskId: chapterId } });
        } else {
          window.location.reload();
        }
      }
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
  let isBarExpanded = false; //  控制是否展开

  // 轻黄高亮：只用边框 + 光晕，背景保持原样
  const HL_BORDER = '#FFD54F';                        // 选中卡片描边（琥珀黄）
  const HL_SHADOW = '0 0 0 3px rgba(255,213,79,.35)'; // 选中卡片外圈光晕
  const CARD_DEFAULT_BORDER = '1px solid rgba(0,0,0,.05)';      // 未选中卡片的默认边框

  // 覆盖 highlightCard() 设的天蓝 inline 样式
  const paintCurrentCard = () => {
    cardElements.forEach((c, i) => {
      if (i === currentIndex) {
        c.style.border = '2px solid ' + HL_BORDER;
        c.style.boxShadow = HL_SHADOW;
        c.style.background = '';   // 清空 inline 背景，回落到 CSS 默认白底
      } else {
        c.style.border = CARD_DEFAULT_BORDER;
        c.style.background = '';
        c.style.boxShadow = 'none';
      }
    });
  };

  // ===== 文件夹详情页：把 var(--primary) 蓝框改成黄框 =====
  (function fixFolderBlueBorder() {
    'use strict';

    const HL_BORDER = '#FFD54F';
    const HL_SHADOW = '0 0 0 3px rgba(255,213,79,.35)';

    let busy = false;

    function fix() {
      if (busy) return;
      busy = true;

      document.querySelectorAll('.card.point-card-content').forEach(el => {
        const st = el.getAttribute('style') || '';
        // 检测到 inline 里有 var(--primary) 蓝框
        if (/border:\s*2px solid var\(--primary\)/.test(st)) {
          el.style.border = '2px solid ' + HL_BORDER;
          el.style.boxShadow = HL_SHADOW;
          el.style.background = '';  // 保持白底
        }
      });

      // 隐藏 4px 天蓝色条
      document.querySelectorAll('#point-list div[style*="height: 4px"]').forEach(bar => {
        bar.style.display = 'none';
      });

      busy = false;
    }

    fix();
    new MutationObserver(fix).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
  })();

  // 用法：调用它切卡，不会再出现塌一下的现象。
  const gotoCard = (idx) => {
    if (idx < 0 || idx >= points.length) return;
    const keepExpanded = isExpanded;   // ← 记住切换前是不是展开状态
    currentIndex = idx;
    highlightCard();                   // 正常走原来的高亮/渲染
    if (keepExpanded) {                // 若被 highlightCard 内部重置成收起
      isExpanded = true;
      highlightCard();                 // 强制展开回去（幂等，重复调用不会反向折叠）
    }
    paintCurrentCard();                // 上色：当前轻黄，其余复原
    const target = cardElements[currentIndex];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const renderFocusTouchBar = () => {
    const oldBar = document.getElementById('review-touch-bar');
    if (oldBar) oldBar.remove();

    const touchBar = el('div', {
      id: 'review-touch-bar',
      style: { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(43, 45, 66, 0.95)', backdropFilter: 'blur(10px)', padding: '6px 12px', borderRadius: '30px', display: 'flex', gap: '8px', zIndex: 100000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }
    }, [
      // 退出：把黄底一起清干净（原来只清了 border，退出后卡片会残留黄底）
      el('button', {
        class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '✕ 退出',
        onClick: () => {
          cardElements.forEach(c => {
            c.style.border = CARD_DEFAULT_BORDER;
            c.style.background = '';
            c.style.boxShadow = 'none';
          });
          touchBar.remove();
          window.onkeydown = null;
        }
      }),

      // 跳转输入框
      el('input', {
        type: 'number', min: 1, max: points.length, placeholder: `${currentIndex + 1}/${points.length}`,
        style: { width: '60px', height: '28px', padding: '2px 6px', borderRadius: '14px', border: 'none', textAlign: 'center', fontSize: '12px', color: '#333', outline: 'none' },
        onKeyDown: (e) => {
          if (e.key === 'Enter') {
            const val = parseInt(e.target.value);
            if (val >= 1 && val <= points.length) {
              isExpanded = false;
              gotoCard(val - 1);        // ← 原来是 highlightCard()，换成 gotoCard
              e.target.value = '';
              e.target.blur();
            } else { toastError('超出范围'); }
          }
        }
      }),

      // 翻转：保持原行为，只补一次上色
      el('button', {
        class: 'btn btn-sm btn-primary', style: { padding: '4px 16px' }, text: '翻转',
        onClick: () => { isExpanded = !isExpanded; highlightCard(); paintCurrentCard(); }
      }),

      // 展开/收起（这一对是「工具栏自身」的展开收起，与卡片无关，保持不动）
      el('button', {
        class: 'btn btn-sm btn-ghost', style: { color: '#fff', fontSize: '14px', padding: '4px 8px', fontWeight: 'bold' },
        text: isBarExpanded ? '收起' : '展开',
        onClick: () => { isBarExpanded = !isBarExpanded; renderFocusTouchBar(); }
      }),

      // 展开后的按钮组
      ...(isBarExpanded ? [
        el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' } }),

        // ⬆️ 上一个只切卡，不收起
        el('button', {
          class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '⬆️', title: '上一个',
          onClick: () => { gotoCard(currentIndex - 1); }
        }),

        // ⬇️ 下一个 只切卡，不收起
        el('button', {
          class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '⬇️', title: '下一个',
          onClick: () => { gotoCard(currentIndex + 1); }
        }),

        el('button', {
          class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '🖼', title: '图片',
          onClick: () => { const p = points[currentIndex]; if (p.imageIds?.length) openQuickImages(p.imageIds); else toastSuccess('当前无图片'); }
        }),

        el('button', {
          class: 'btn btn-sm btn-ghost', style: { color: '#fff' }, text: '📄', title: 'PDF',
          onClick: () => {
            const p = points[currentIndex];
            const realPoint = JSON.parse(localStorage.getItem('kg_points') || '[]').find(x => x.id === p.id) || p;
            const pdfId = findPdfId(realPoint);
            if (pdfId) { window.location.hash = `#/pdf-viewer/${pdfId}?pointId=${p.id}`; touchBar.remove(); window.onkeydown = null; }
            else toastSuccess('当前无 PDF');
          }
        }),

        el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' } }),

        // 打分按钮：逻辑不变，评完分若你希望「不收起」，见下方附注 A
        el('button', { class: 'btn btn-sm btn-danger', text: '1.忘了', onClick: () => rateCurrent('forgot') }),
        el('button', { class: 'btn btn-sm btn-warning', text: '2.模糊', onClick: () => rateCurrent('vague') }),
        el('button', { class: 'btn btn-sm btn-success', text: '3.记得', onClick: () => rateCurrent('remember') })
      ] : [])
    ]);

    document.body.appendChild(touchBar);
    paintCurrentCard();   // 工具栏每次重绘后，把当前卡的颜色补上
  };

  renderFocusTouchBar(); // 初始化
  paintCurrentCard();

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
    }
    toastSuccess('已记录');

    if (currentIndex < points.length - 1) {
      currentIndex++;
      isExpanded = false;
      highlightCard();
    } else {
      // 最后一张也支持循环
      if (confirm('复习完毕！\n点击“确定”从头循环，点击“取消”退出。')) {
        currentIndex = 0;
        isExpanded = false;
        highlightCard();
      } else {
        cardElements.forEach(el => el.style.border = '1px solid rgba(0,0,0,.05)');
        touchBar.remove();
        window.onkeydown = null;
        // 改为调用新的文件夹渲染函数
        if (typeof renderFolderDetail === 'function') {
          renderFolderDetail({ params: { taskId: chapterId } });
        } else {
          window.location.reload();
        }
      }
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

//在 chapter.js 里手写一个折叠函数，不再依赖外部
function handleFolderToggle(taskId) {
  // 1. 从 localStorage 读取当前的折叠状态
  let collapsed = [];
  try {
    collapsed = JSON.parse(localStorage.getItem('kg_collapsed_folders') || '[]');
  } catch (e) { }

  const collapsedSet = new Set(collapsed);

  // 2. 切换状态
  if (collapsedSet.has(taskId)) {
    collapsedSet.delete(taskId); // 如果折叠了，就展开
  } else {
    collapsedSet.add(taskId);    // 如果展开了，就折叠
  }

  // 3. 存回 localStorage
  localStorage.setItem('kg_collapsed_folders', JSON.stringify([...collapsedSet]));

  // 4. 如果是在首页，同步更新 home.js 里的全局变量（如果是同一份数据可以直接刷新）
  if (typeof collapsedFolders !== 'undefined') {
    if (collapsedFolders.has(taskId)) collapsedFolders.delete(taskId);
    else collapsedFolders.add(taskId);
  }
}

// ================= 全局通用文件夹卡片（支持无限嵌套 + 批量模式） =================
export function taskCard(task, currentFolderId, depth = 0) {
  const isBatchMode = window.multiSelectMode === true;
  const isSelected = isBatchMode && window.selectedIds && window.selectedIds.has(task.id);

  const subFolders = store.getTasks().filter(t => t.parentId === task.id);
  const hasSub = subFolders.length > 0;

  let collapsedList = [];
  try { collapsedList = JSON.parse(localStorage.getItem('kg_collapsed_folders') || '[]'); } catch (e) { }
  const isCollapsed = isBatchMode ? false : collapsedList.includes(task.id);

  function countAllPoints(folderId) {
    let count = store.getPoints(folderId).length;
    const children = store.getTasks().filter(t => t.parentId === folderId);
    children.forEach(child => { count += countAllPoints(child.id); });
    return count;
  }
  const totalPointCount = countAllPoints(task.id);
  const indent = depth > 0 ? depth * 16 : 0;

  const cardEl = el('div', {
    class: 'card' + (isSelected ? ' selected' : ''),
    'data-id': task.id,
    style: {
      display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer',
      marginBottom: '4px', marginLeft: indent + 'px',
      borderLeft: depth > 0 ? '2px solid rgba(142,202,230,0.3)' : 'none',
      padding: '6px 10px',
      // 强制去掉了外层巨厚的白边，普通状态下背景透明，批量选中时才有边框
      background: 'transparent',
      border: isSelected ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.05)'
    },
    onClick: (e) => {

      if (e.target.closest('.toggle-btn') || e.target.closest('.card-actions') || e.target.closest('input')) return;

      if (isBatchMode) {
        if (isSelected) window.selectedIds.delete(task.id); else window.selectedIds.add(task.id);
        if (typeof window.renderHomeGlobal === 'function') window.renderHomeGlobal();
        return;
      }

      try {
        window.location.hash = `#/folder/${task.id}`;
      } catch (err) {
        console.error("跳转出错:", err);
        alert("跳转失败，请看控制台");
      }
    },
  }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', flex: '1', minWidth: 0 } }, [
        isBatchMode ? el('input', {
          type: 'checkbox', checked: isSelected, style: { marginRight: '6px', flexShrink: '0' },
          onChange: (e) => {
            if (e.target.checked) window.selectedIds.add(task.id); else window.selectedIds.delete(task.id);
            if (typeof window.renderHomeGlobal === 'function') window.renderHomeGlobal();
          }
        }) : null,

        (!isBatchMode && hasSub) ? el('span', {
          class: 'toggle-btn',
          style: { cursor: 'pointer', color: 'var(--text-2)', fontSize: '12px', padding: '2px 6px', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' },
          text: isCollapsed ? '▸' : '▾',
          onClick: (e) => {
            // 彻底阻断事件冒泡，防止触发外层卡片的跳转
            e.preventDefault();
            e.stopPropagation();

            let current = [];
            try { current = JSON.parse(localStorage.getItem('kg_collapsed_folders') || '[]'); } catch (err) { }
            const set = new Set(current);
            if (set.has(task.id)) {
              set.delete(task.id); // 展开
            } else {
              set.add(task.id);    // 折叠
            }
            localStorage.setItem('kg_collapsed_folders', JSON.stringify([...set]));

            // 既然在当前页面，直接调用当前页面的专用刷新函数
            if (window.currentPageRefresh) {
              window.currentPageRefresh();
            } else {
              window.location.reload();
            }
          }
        }) : el('span', { style: { width: isBatchMode ? '0' : '24px', display: 'inline-block' } }),

        el('div', {
          class: 'card-title',
          style: { display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: '600', fontSize: '14px' }
        }, [
          ...(task.statusTags || (task.statusIcon ? [{ text: task.statusIcon, color: task.statusColor }] : [])).map(tag =>
            el('span', {
              style: { color: tag.color || '#ff4757', fontSize: '11px', padding: '0 4px', borderRadius: '4px', background: 'transparent', border: `1px solid ${tag.borderColor !== undefined ? tag.borderColor : (tag.color || '#ff4757')}`, flexShrink: 0, lineHeight: 1.2, fontWeight: '500' },
              innerHTML: tag.html || tag.text
            })
          ),
          el('span', { text: `📁 ${task.name}`, style: { overflow: 'hidden', textOverflow: 'ellipsis' } })
        ])
      ]),

      el('div', { class: 'card-actions', style: { display: 'flex', gap: '2px' } }, [
        !isBatchMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '🏷️', style: { padding: '0 4px', height: '24px', minHeight: '24px' }, title: '管理状态标签', onClick: (e) => { e.stopPropagation(); showStatusTagManager(task); } }) : null,
        !isBatchMode ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '➕📁', style: { padding: '0 4px', height: '24px', minHeight: '24px' }, title: '新建子文件夹',
          onClick: (e) => {
            e.stopPropagation();
            const name = prompt('输入子文件夹名称：');
            if (name && name.trim()) {
              store.createTask({ name: name.trim(), parentId: task.id });
              toastSuccess('子文件夹已创建');
              if (typeof window.renderHomeGlobal === 'function') window.renderHomeGlobal(); else window.location.reload();
            }
          }
        }) : null,
        !isBatchMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', style: { padding: '0 4px', height: '24px', minHeight: '24px' }, title: '编辑文件夹', onClick: (e) => { e.stopPropagation(); navigate(`#/edit-task/${task.id}`); } }) : null,
        !isBatchMode ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '🗑', style: { padding: '0 4px', height: '24px', minHeight: '24px', color: 'var(--danger)' }, title: '删除文件夹',
          onClick: async (e) => {
            e.stopPropagation();
            if (await confirmBox({ title: '删除文件夹', message: `「${task.name}」及其卡片将进入回收站`, danger: true, confirmText: '删除' })) {
              store.deleteTask(task.id);
              toastSuccess('已移入回收站');
              if (typeof window.renderHomeGlobal === 'function') window.renderHomeGlobal(); else window.location.reload();
            }
          },
        }) : null,
      ])
    ]),

    task.note ? el('div', { style: { fontSize: '12px', color: 'var(--text-2)', lineHeight: '1.2' }, text: task.note }) : null,

    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0px', paddingLeft: isBatchMode ? '24px' : '24px' } }, [
      el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: `💡 ${totalPointCount} 张卡片` }),
      hasSub ? el('span', { style: { fontSize: '11px', color: 'var(--primary)' }, text: `📁 ${subFolders.length} 个子文件夹` }) : null
    ])
  ]);

  // 递归渲染子文件夹
  if (hasSub && !isCollapsed) {
    const subContainer = el('div', { style: { paddingLeft: '12px' } });
    subFolders.forEach(sub => {
      subContainer.appendChild(taskCard(sub, currentFolderId, depth + 1));
    });
    return el('div', { style: { background: 'transparent' } }, [cardEl, subContainer]); //  去掉包裹层的白底
  }

  return cardEl;
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
            isCardTag: true // 这是来自卡片的标签
          });
        }
      });
    }
  });

  // ==========================================
  // 2. 颜色库初始化
  // ==========================================
  // 1. 基础预设与本地存储读取
  const defaultColors = [
    { c: '#ff4757', s: false }, { c: '#2ed573', s: false }, { c: '#1e90ff', s: true },
    { c: '#ffa502', s: false }, { c: '#8e44ad', s: false }, { c: '#747d8c', s: false },
    { c: '#ff9ff3', s: false }, { c: '#f368e0', s: false },
    { c: '#000000', s: false }, { c: '#000080', s: false }, { c: 'transparent', s: false }
  ];

  // 先安全读取，如果为空数组则强制用默认值补齐
  let storedColors = [];
  try {
    storedColors = JSON.parse(localStorage.getItem('kg_tag_colors')) || [];
  } catch (e) {
    storedColors = [];
  }

  let presetColors = storedColors.length > 0 ? storedColors : JSON.parse(JSON.stringify(defaultColors));
  if (storedColors.length === 0) {
    localStorage.setItem('kg_tag_colors', JSON.stringify(presetColors));
  }

  // 2. 定义 8 个「绝对防删」强制色
  const forcedColors = [
    { c: '#000000', s: true, isForced: true }, // 黑
    { c: '#000080', s: true, isForced: true }, // 藏青
    { c: 'transparent', s: true, isForced: true }, // 透明
    { c: '#1e90ff', s: true, isForced: true }, // 亮蓝
    { c: '#ff4757', s: true, isForced: true }, // 红
    { c: '#2ed573', s: true, isForced: true }, // 绿
    { c: '#8e44ad', s: true, isForced: true }, // 紫
    { c: '#f368e0', s: true, isForced: true }  // 粉
  ];

  // 3. 剥离旧的强制色，确保强制色永远排在最前面且带保护标记
  forcedColors.forEach(fc => {
    presetColors = presetColors.filter(p => p.c !== fc.c); // 去重
    presetColors.unshift(fc); // 放在最前
  });

  // 4. 兼容并补齐你在 defaultColors 里定义的普通颜色（不覆盖强制色）
  defaultColors.forEach(dc => {
    if (!presetColors.some(p => p.c === dc.c)) {
      presetColors.push(dc);
    }
  });

  // 5. 将最终结果写回本地存储
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
  //接收一个回显内容参数
  const renderContent = (initialContent = null) => {
    clear(box);

    // 1. 顶部：仅标题
    box.appendChild(el('h3', { text: '🏷️ 状态标签管理', style: { marginTop: 0, marginBottom: '12px' } }));

    // ================= 2. 中部：输入区 =================
    //在最外层声明，避免弹窗内外作用域冲突
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
            let allWords = [];
            try {
              allWords = JSON.parse(localStorage.getItem('kg_common_words')) || [];
            } catch (e) { allWords = []; }

            let presetWords = allWords.filter(w => DEFAULT_WORDS.includes(w));
            let customWords = allWords.filter(w => !DEFAULT_WORDS.includes(w));

            // 如果预设字符全部被清空或丢失了，强制把 DEFAULT_WORDS 补回去！
            if (presetWords.length === 0) {
              presetWords = [...DEFAULT_WORDS];
              // 合并并保存回本地
              allWords = [...presetWords, ...customWords];
              localStorage.setItem('kg_common_words', JSON.stringify(allWords));
            }
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
                      class: 'btn btn-sm btn-ghost',
                      text: w,
                      style: { fontSize: '16px', padding: '2px 10px', border: '1px solid #ccc' },
                      onMousedown: e => e.preventDefault(),
                      onClick: () => insertChar(w)
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

    //如果传入了编辑内容，等 50 毫秒后用原生 API 强塞进去！
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

          //  刷新界面，传入 null 避免把空字符串当成回显内容强行塞入
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

          //  刷新界面，传入 null 避免把空字符串当成回显内容强行塞入
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
            //智能拼接：[卡] 或 [子] 标识 + 原本内容
            innerHTML: (tag.isCardTag ? '<span style="color:#999;font-size:10px;margin-right:2px;">[卡]</span>' : '') +
              (tag.isSubTag ? '<span style="color:#999;font-size:10px;margin-right:2px;">[子]</span>' : '') +
              (tag.html || tag.text)
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '✏️', style: { padding: '2px 6px', minHeight: 'auto' }, onClick: () => {
              //如果这个标签属于子文件夹或卡片，就不允许在这里直接编辑
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

    //用 isListCollapsed 变量控制显示隐藏
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
        isListCollapsed = !isListCollapsed; //  修改状态
        renderContent(null); //  重新渲染以应用状态
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
          //  过滤掉卡片和子文件夹的标签
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
      const isTransparent = c === 'transparent'; //  必须放在最前面

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
              //纯净版：只调用原生命令
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
    //定义 starredColors
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
      //管理工具条（带全选/非全选/删除/恢复默认/管理）
      el('div', { style: { display: 'flex', gap: '4px' } }, [
        isColorManageMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => { e.stopPropagation(); presetColors.forEach((item, i) => { if (item.s) selectedColorIndices.add(i); }); renderContent(null); } }) : null,
        isColorManageMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => { e.stopPropagation(); selectedColorIndices.clear(); renderContent(null); } }) : null,
        isColorManageMode ? el('button', {
          class: 'btn btn-sm btn-danger', text: `删除(${selectedColorIndices.size})`, style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto' }, onClick: (e) => {
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
        isColorManageMode ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '恢复默认', style: { padding: '2px 6px', fontSize: '11px', height: '22px', minHeight: 'auto', color: 'var(--primary)' }, onClick: (e) => {
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
          }
        }) : null,
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
              //透明色的渲染
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
                //管理模式：只负责勾选
                if (selectedColorIndices.has(realIndex)) selectedColorIndices.delete(realIndex);
                else selectedColorIndices.add(realIndex);
                renderContent(null);
              } else {
                //普通模式：切换颜色
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

// ================= 🔢 高级序号与排序管理面板 =================
function openSortManager(currentFolderId) {
  if (ptSelected.size === 0) return toastError('请先勾选要操作的卡片');

  let savedFormats = [];
  try { savedFormats = JSON.parse(localStorage.getItem('kg_saved_sort_formats') || '[]'); } catch (e) { }

  let appliedFormats = [];
  try { appliedFormats = JSON.parse(localStorage.getItem('kg_applied_sort_formats') || '[]'); } catch (e) { }

  let activeTab = 'preset';
  let customPrefix = '第';
  let customSymbol = '{n}';
  let customSuffix = '题';
  let sortMode = 'manual';

  let isPresetExpanded = true;
  let isSymbolExpanded = false;
  let isSavedExpanded = false;
  let isAppliedExpanded = false;

  let selectedSavedIndices = new Set();

  //  多步撤销栈
  let undoStack = [];

  //  预设选中状态（默认选中第一个）
  let activePresetIndex = 0;

  const commonSymbols = ['{n}', '●', '○', '■', '□', '◆', '◇', '★', '☆', '①', 'Ⅰ', '一', 'A', 'a'];

  const presets = [
    { name: '数字', p: (i) => `${i + 1}. `, icon: '1️⃣' },
    { name: '括号数字', p: (i) => `(${i + 1}) `, icon: '🅰️' },
    { name: '中文数字', p: (i) => { const n = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']; return (i + 1 <= 10 ? n[i + 1] : `十${n[(i + 1) % 10]}`) + '、'; }, icon: '🀄' },
    { name: '英文字母', p: (i) => `${String.fromCharCode(65 + i)}. `, icon: '🔤' },
    { name: '罗马数字', p: (i) => { const r = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']; return (r[i] || (i + 1)) + '. '; }, icon: '🏛️' },
    { name: '全角数字', p: (i) => `１. `.replace('１', String(i + 1).replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 65248))), icon: '🔢' },
    { name: '实心圆点', p: (i) => `● `, icon: '⚫' },
    { name: '带圈数字', p: (i) => { const c = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']; return (c[i] || i + 1) + ' '; }, icon: '⭕' }
  ];

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '480px', width: '95%', padding: '20px', maxHeight: '90vh', overflowY: 'auto' } });

  //  完美原地刷新：直接寻找所有卡片并重绘内容，绝对不跳转
  const refreshInPlace = () => {
    const selectedPoints = Array.from(ptSelected).map(id => store.getPoint(id)).filter(Boolean);

    selectedPoints.forEach(p => {
      // 寻找页面上所有绑定了 data-id 的卡片
      const cardEl = document.querySelector(`.card[data-id="${p.id}"]`);
      if (!cardEl) return;

      // 方法1：尝试找卡片标题文本
      const cardTitle = cardEl.querySelector('.card-title');
      if (cardTitle) {
        // 如果你在标题里有其它标签，这里简单替换后面的文本
        cardTitle.innerHTML = `📁 ${task.name}`; // 如果是文件夹。如果是卡片，看方法2
      }

      // 方法2：更通用的找法，遍历卡片内部的文本节点并替换
      // 你的 pointCard 里，卡片内容通常是 .point-card-content 下的第一个 div 里的 innerHTML
      const pointContentDiv = cardEl.querySelector('.point-card-content');
      if (pointContentDiv) {
        // 找到纯文字渲染的那个 div（通常在 header 里）
        const headerDiv = pointContentDiv.firstElementChild;
        if (headerDiv) {
          const textDivs = headerDiv.querySelectorAll('div');
          textDivs.forEach(div => {
            if (!div.querySelector('input') && !div.querySelector('button')) {
              div.innerHTML = typeof parseLinks === 'function' ? parseLinks(p.content) : p.content;
            }
          });
        }
      }
    });
  };


  const renderPanel = () => {
    clear(box);
    box.appendChild(el('h3', { text: `🔢 排版与排序管理`, style: { marginTop: 0, marginBottom: '16px', fontSize: '18px' } }));

    // 排序方式
    box.appendChild(el('div', { style: { background: 'var(--bg)', padding: '12px', borderRadius: '8px', marginBottom: '16px' } }, [
      el('label', { text: '📊 应用顺序', style: { fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '8px' } }),
      el('select', {
        value: sortMode, onchange: (e) => { sortMode = e.target.value; },
        style: { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ccc', background: 'var(--card)' }
      }, [
        el('option', { value: 'manual', text: '按当前手动拖拽顺序' }),
        el('option', { value: 'time-asc', text: '按建立时间（旧 -> 新）' }),
        el('option', { value: 'time-desc', text: '按建立时间（新 -> 旧）' }),
        el('option', { value: 'alpha-asc', text: '按内容首字母（A -> Z）' }),
        el('option', { value: 'alpha-desc', text: '按内容首字母（Z -> A）' })
      ])
    ]));

    const tabs = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '8px' } });
    const createTab = (id, name) => el('button', {
      class: `btn btn-sm ${activeTab === id ? 'btn-primary' : 'btn-ghost'}`, text: name,
      onClick: () => { activeTab = id; renderPanel(); }
    });
    tabs.appendChild(createTab('preset', '常用序号'));
    tabs.appendChild(createTab('custom', '自定义'));
    tabs.appendChild(createTab('manage', '管理'));
    box.appendChild(tabs);

    // ============== 1. 预设列表（选中状态） ==============
    if (activeTab === 'preset') {
      const header = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-2)', marginBottom: '10px' },
        onClick: () => { isPresetExpanded = !isPresetExpanded; renderPanel(); }
      }, [el('span', { text: '预设格式' }), el('span', { text: isPresetExpanded ? '▾' : '▸' })]);
      box.appendChild(header);

      if (isPresetExpanded) {
        const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } });
        presets.forEach((fmt, idx) => {
          const isSelected = activePresetIndex === idx;
          grid.appendChild(el('button', {
            class: 'btn btn-ghost',
            style: {
              padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px',
              background: isSelected ? 'rgba(142,202,230,0.2)' : 'var(--bg)',
              borderRadius: '8px',
              border: isSelected ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,0.05)',
              transform: isSelected ? 'scale(1.02)' : 'scale(1)',
              transition: 'all 0.2s'
            },
            onClick: () => { activePresetIndex = idx; renderPanel(); } //  只选中，不应用
          }, [
            el('span', { text: `${fmt.icon} ${fmt.name}`, style: { fontSize: '12px', color: isSelected ? 'var(--primary-dark)' : 'var(--text-2)' } }),
            el('span', { text: fmt.p(0) + fmt.p(1), style: { fontSize: '13px', fontWeight: 'bold', color: isSelected ? 'var(--primary)' : 'var(--text)' } })
          ]));
        });
        box.appendChild(grid);
      }
    }

    // ============== 2. 自定义 ==============
    if (activeTab === 'custom') {
      const previewBox = el('div', {
        style: { padding: '12px', background: 'rgba(142,202,230,0.1)', borderRadius: '8px', marginBottom: '16px', textAlign: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--primary-dark)', border: '1px dashed var(--primary)', whiteSpace: 'pre-wrap' }
      });

      const updatePreview = () => {
        const base = customSymbol.replace(/{n}/g, '1');
        previewBox.textContent = `${customPrefix}${base}${customSuffix}  ${customPrefix}${customSymbol.replace(/{n}/g, '2')}${customSuffix}`;
      };

      box.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } }, [
        el('div', { style: { flex: '1' } }, [
          el('label', { text: '前缀', style: { fontSize: '12px', color: 'var(--text-2)' } }),
          el('input', { type: 'text', value: customPrefix, onInput: (e) => { customPrefix = e.target.value; updatePreview(); }, style: { width: '100%', padding: '8px', marginTop: '4px', borderRadius: '6px', border: '1px solid #ccc' } })
        ]),
        el('div', { style: { flex: '1.5' } }, [
          el('label', { text: '符号/数字位', style: { fontSize: '12px', color: 'var(--text-2)' } }),
          el('input', { type: 'text', value: customSymbol, placeholder: '{n} 或 ●', onInput: (e) => { customSymbol = e.target.value; updatePreview(); }, style: { width: '100%', padding: '8px', marginTop: '4px', borderRadius: '6px', border: '1px solid #ccc' } })
        ]),
        el('div', { style: { flex: '1' } }, [
          el('label', { text: '后缀', style: { fontSize: '12px', color: 'var(--text-2)' } }),
          el('input', { type: 'text', value: customSuffix, onInput: (e) => { customSuffix = e.target.value; updatePreview(); }, style: { width: '100%', padding: '8px', marginTop: '4px', borderRadius: '6px', border: '1px solid #ccc' } })
        ])
      ]));

      const symbolHeader = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '12px', color: 'var(--text-2)', marginBottom: '6px' },
        onClick: () => { isSymbolExpanded = !isSymbolExpanded; renderPanel(); }
      }, [el('span', { text: '常用形状' }), el('span', { text: isSymbolExpanded ? '▾' : '▸' })]);
      box.appendChild(symbolHeader);

      if (isSymbolExpanded) {
        box.appendChild(el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' } }, [
          ...commonSymbols.map(sym => el('button', {
            class: 'btn btn-sm btn-ghost', text: sym,
            style: { padding: '0 6px', height: '24px', minHeight: 'auto', fontSize: '14px', background: 'var(--bg)' },
            onClick: () => { customSymbol = sym; updatePreview(); renderPanel(); }
          })),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '自定义',
            style: { padding: '0 6px', height: '24px', minHeight: 'auto', fontSize: '12px', background: 'var(--bg)' },
            onClick: () => {
              const val = prompt('请输入自定义形状/字符（如：✪）', '✪');
              if (val) { customSymbol = val; updatePreview(); renderPanel(); }
            }
          })
        ]));
      }

      updatePreview();

      box.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
        el('div', { style: { fontSize: '12px', color: 'var(--text-2)' } }, [el('span', { text: '实时预览：' })]),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '⭐ 收藏此格式',
          style: { padding: '0 6px', height: '22px', minHeight: 'auto', fontSize: '11px', background: 'var(--bg)' },
          onClick: () => {
            const label = `${customPrefix}${customSymbol}${customSuffix}`;
            if (savedFormats.includes(label)) return toastError('该格式已收藏');
            savedFormats.push(label);
            localStorage.setItem('kg_saved_sort_formats', JSON.stringify(savedFormats));
            toastSuccess('已加入收藏列表');
            renderPanel();
          }
        })
      ]));
      box.appendChild(previewBox);
    }

    // ============== 3. 管理 ==============
    if (activeTab === 'manage') {
      // 收藏列表
      const savedHeader = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-2)', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px dashed rgba(0,0,0,0.05)' },
        onClick: () => { isSavedExpanded = !isSavedExpanded; renderPanel(); }
      }, [el('span', { text: '⭐ 收藏列表' }), el('span', { text: isSavedExpanded ? '▾' : '▸' })]);
      box.appendChild(savedHeader);

      if (isSavedExpanded) {
        if (savedFormats.length === 0) {
          box.appendChild(el('div', { text: '暂无收藏格式', style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px' } }));
        } else {
          const toolbar = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, [
            el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { savedFormats.forEach((_, i) => selectedSavedIndices.add(i)); renderPanel(); } }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '非全选', onClick: () => { selectedSavedIndices.clear(); renderPanel(); } }),
            el('button', {
              class: 'btn btn-sm btn-danger', text: '删除', onClick: () => {
                if (selectedSavedIndices.size === 0) return;
                savedFormats = savedFormats.filter((_, i) => !selectedSavedIndices.has(i));
                localStorage.setItem('kg_saved_sort_formats', JSON.stringify(savedFormats));
                selectedSavedIndices.clear();
                renderPanel();
              }
            })
          ]);
          box.appendChild(toolbar);

          savedFormats.forEach((fmt, i) => {
            const isChecked = selectedSavedIndices.has(i);
            const display = fmt.replace(/{n}/g, '1').replace('$', '');
            box.appendChild(el('div', {
              style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: isChecked ? 'rgba(142,202,230,0.2)' : 'var(--bg)', borderRadius: '6px', marginBottom: '6px', cursor: 'pointer', border: '1px solid ' + (isChecked ? 'var(--primary)' : 'transparent') },
              onClick: () => { if (isChecked) selectedSavedIndices.delete(i); else selectedSavedIndices.add(i); renderPanel(); }
            }, [
              el('input', { type: 'checkbox', checked: isChecked, style: { pointerEvents: 'none' } }),
              el('span', { text: display, style: { fontSize: '13px', flex: '1', fontWeight: 'bold' } }),
              el('button', {
                class: 'btn btn-sm btn-primary', text: '应用',
                onClick: (e) => { e.stopPropagation(); applySort((idx) => fmt.replace(/{n}/g, idx + 1) + ' '); }
              })
            ]));
          });
        }
      }

      // 应用列表
      const appliedHeader = el('div', {
        style: { display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-2)', marginTop: '16px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px dashed rgba(0,0,0,0.05)' },
        onClick: () => { isAppliedExpanded = !isAppliedExpanded; renderPanel(); }
      }, [el('span', { text: '📋 应用列表' }), el('span', { text: isAppliedExpanded ? '▾' : '▸' })]);
      box.appendChild(appliedHeader);

      if (isAppliedExpanded) {
        if (appliedFormats.length === 0) {
          box.appendChild(el('div', { text: '暂无应用记录', style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px' } }));
        } else {
          appliedFormats.forEach((fmt, i) => {
            const display = fmt.replace(/{n}/g, '1').replace('$', '');
            box.appendChild(el('div', {
              style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: 'var(--bg)', borderRadius: '6px', marginBottom: '6px' }
            }, [
              el('span', { text: display, style: { fontSize: '13px', flex: '1', fontWeight: 'bold' } }),
              el('button', {
                class: 'btn btn-sm btn-primary', text: '应用',
                onClick: (e) => { e.stopPropagation(); applySort((idx) => fmt.replace(/{n}/g, idx + 1) + ' '); }
              })
            ]));
          });
        }
      }
    }

    // ================== 底部按钮 ==================
    box.appendChild(el('div', { style: { borderTop: '1px dashed rgba(0,0,0,0.1)', marginTop: '16px', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '10px' } }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      el('button', {
        class: 'btn btn-primary', text: '✅ 确认应用',
        onClick: () => {
          if (activeTab === 'custom') {
            const s = customSymbol;
            applySort((i) => `${customPrefix}${s.replace(/{n}/g, i + 1)}${customSuffix} `);
          } else if (activeTab === 'preset') {
            const fmt = presets[activePresetIndex];
            applySort(fmt.p);
          } else {
            mask.remove();
          }
        }
      })
    ]));
  };

  function applySort(getPrefixFn) {
    let selectedPoints = Array.from(ptSelected).map(id => store.getPoint(id)).filter(Boolean);

    // 记录历史快照到全局栈
    const snapshot = selectedPoints.map(p => ({
      id: p.id,
      oldContent: p.content,
      oldOrder: p.order
    }));

    // 直接执行前缀函数，拿到真实的 “1. ” 或 “A. ”
    let styleName = '';
    try {
      // 尝试获取生成的第 0 个前缀（即第一个条目的前缀，如 "1. "）
      styleName = getPrefixFn(0).trim();
      // 如果拿到的是空字符串（某些自定义可能只加后缀），就兜底显示“默认”
      if (!styleName) styleName = '默认';
    } catch (e) {
      styleName = '默认';
    }

    // 只保留时间，去掉“排序排版”这类死板文字
    snapshot.action = styleName;
    snapshot.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    globalUndoStack.push(snapshot);
    if (globalUndoStack.length > 20) globalUndoStack.shift();

    // 存入 localStorage，防止刷新丢失
    localStorage.setItem('kg_undo_stack', JSON.stringify(globalUndoStack));

    if (sortMode === 'time-asc') selectedPoints.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sortMode === 'time-desc') selectedPoints.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sortMode === 'alpha-asc') selectedPoints.sort((a, b) => (a.content || '').localeCompare(b.content || ''));
    else if (sortMode === 'alpha-desc') selectedPoints.sort((a, b) => (b.content || '').localeCompare(a.content || ''));
    else selectedPoints.sort((a, b) => a.order - b.order);

    const sample = getPrefixFn(0);
    const recordFormat = sample.replace('1', '{n}').trim() + ' ';

    if (!appliedFormats.includes(recordFormat)) {
      appliedFormats.unshift(recordFormat);
      if (appliedFormats.length > 10) appliedFormats.pop();
      localStorage.setItem('kg_applied_sort_formats', JSON.stringify(appliedFormats));
    }

    selectedPoints.forEach((p, index) => {
      const prefix = getPrefixFn(index);
      store.updatePoint(p.id, { content: prefix + p.content, order: index });
    });

    toastSuccess(`排版完成，共 ${selectedPoints.length} 张卡片`);

    mask.remove(); // 应用后直接关弹窗
    if (typeof window.renderFolderGlobal === 'function') window.renderFolderGlobal(); // 原地刷新
  }

  renderPanel();
  mask.appendChild(box);
  document.body.appendChild(mask);
}
// 把它挂载到全局，这样在 home.js 也能直接调用
window.showStatusTagManager = showStatusTagManager;