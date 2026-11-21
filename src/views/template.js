import { el, clear } from '../utils/dom.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { uuid } from '../utils/id.js';

const STORAGE_KEY = 'kg_templates';

// 内置默认分类
const DEFAULT_CATEGORIES = ['全部', '申论', '行测', '面试', '公基'];

export function renderTemplate() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '资料与模板';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate('#/');

  const wrap = el('div', { style: { maxWidth: '760px', margin: '0 auto' } });

  // ==========================================
  // 状态管理
  // ==========================================
  let activeCategory = '全部';
  let searchQuery = '';
  let templates = loadTemplates();
  let isManageMode = false;
  let selectedIds = new Set();

  // ==========================================
  // 1. 顶部：操作与搜索栏
  // ==========================================
  const headerRow = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' } }, [
    el('input', {
      type: 'text', placeholder: '🔍 搜索模板标题或内容...',
      style: { flex: '1', minWidth: '200px', padding: '10px 16px', borderRadius: '20px', border: '1px solid rgba(0,0,0,.1)', outline: 'none', background: 'var(--card)', color: 'var(--text)' },
      onInput: (e) => { searchQuery = e.target.value.toLowerCase(); renderTemplateList(); }
    }),
    el('button', {
      class: `btn ${isManageMode ? 'btn-danger' : 'btn-ghost'}`,
      text: isManageMode ? '✖ 退出管理' : '⚙️ 管理',
      onClick: () => {
        isManageMode = !isManageMode;
        selectedIds.clear();
        renderHeader(); // 重新渲染头部按钮状态
        renderTemplateList();
      }
    }),
    !isManageMode ? el('button', {
      class: 'btn btn-primary',
      text: '➕ 新建模板',
      onClick: () => openTemplateEditor(null)
    }) : null
  ]);

  // 批量操作工具栏 (仅在管理模式下显示)
  const batchBar = el('div', {
    style: {
      display: 'none', gap: '8px', marginBottom: '16px', padding: '12px',
      background: 'rgba(239, 71, 111, 0.1)', borderRadius: '10px',
      alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap'
    }
  });

  const headerContainer = el('div', {}, [headerRow, batchBar]);
  wrap.appendChild(headerContainer);

  function renderHeader() {
    // 更新按钮文字
    const manageBtn = headerRow.querySelector('button:nth-child(2)');
    if (manageBtn) {
      manageBtn.className = `btn ${isManageMode ? 'btn-danger' : 'btn-ghost'}`;
      manageBtn.textContent = isManageMode ? '✖ 退出管理' : '⚙️ 管理';
    }

    // 移除或添加新建按钮
    const newBtn = headerRow.querySelector('.btn-primary');
    if (isManageMode && newBtn) {
      newBtn.remove();
    } else if (!isManageMode && !newBtn) {
      headerRow.appendChild(el('button', {
        class: 'btn btn-primary', text: '➕ 新建模板', onClick: () => openTemplateEditor(null)
      }));
    }

    // 渲染批量工具栏
    if (isManageMode) {
      batchBar.style.display = 'flex';
      batchBar.innerHTML = '';
      batchBar.appendChild(el('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--danger)' } }, [
        `已选中 ${selectedIds.size} 个模板`
      ]));

      const btnGroup = el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '全选',
          onClick: () => {
            const filtered = getFilteredTemplates();
            filtered.forEach(t => selectedIds.add(t.id));
            renderHeader(); renderTemplateList();
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '全不选',
          onClick: () => {
            selectedIds.clear();
            renderHeader(); renderTemplateList();
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-danger', text: '🗑 删除选中',
          onClick: async () => {
            if (selectedIds.size === 0) return toastError('请先选择要删除的模板');
            if (await confirmBox({ title: '批量删除', message: `确定要删除选中的 ${selectedIds.size} 个模板吗？` })) {
              templates = templates.filter(t => !selectedIds.has(t.id));
              saveTemplates();
              selectedIds.clear();
              isManageMode = false;
              renderHeader();
              renderTemplateList();
              toastSuccess('批量删除成功');
            }
          }
        })
      ]);
      batchBar.appendChild(btnGroup);
    } else {
      batchBar.style.display = 'none';
    }
  }

  // ==========================================
  // 分类栏
  // ==========================================
  const categoryBar = el('div', { style: { display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '16px', scrollbarWidth: 'none' } });
  function renderCategories() {
    categoryBar.innerHTML = '';
    DEFAULT_CATEGORIES.forEach(cat => {
      categoryBar.appendChild(el('button', {
        class: `btn btn-sm ${activeCategory === cat ? 'btn-primary' : 'btn-ghost'}`,
        text: cat,
        style: { flexShrink: '0', borderRadius: '20px', padding: '6px 16px' },
        onClick: () => { activeCategory = cat; renderCategories(); renderTemplateList(); }
      }));
    });
  }
  renderCategories();
  wrap.appendChild(categoryBar);

  // 列表容器
  const listWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' } });
  wrap.appendChild(listWrap);

  // 获取过滤后的模板（供列表渲染和全选使用）
  function getFilteredTemplates() {
    return templates.filter(t => {
      const matchCat = activeCategory === '全部' || t.category === activeCategory;
      const matchKw = t.title.toLowerCase().includes(searchQuery) || (t.content || '').replace(/<[^>]+>/g, '').toLowerCase().includes(searchQuery);
      return matchCat && matchKw;
    });
  }

  function renderTemplateList() {
    listWrap.innerHTML = '';
    const filtered = getFilteredTemplates();

    if (filtered.length === 0) {
      listWrap.appendChild(el('div', { class: 'empty', style: { padding: '20px', background: 'var(--bg)', borderRadius: '12px' } }, [
        el('div', { text: '暂无相关模板，点击右上角新建。', style: { color: 'var(--text-2)', fontSize: '13px' } })
      ]));
      return;
    }

    filtered.forEach(tpl => {
      const plainContent = (tpl.content || '').replace(/<[^>]+>/g, '');
      const isChecked = selectedIds.has(tpl.id);

      const card = el('div', {
        class: 'card',
        style: {
          display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'default',
          background: isChecked ? 'rgba(239, 71, 111, 0.05)' : 'var(--card)',
          border: isChecked ? '1px solid var(--danger)' : '1px solid var(--border)',
          position: 'relative'
        }
      }, [
        // 左上角的复选框
        isManageMode ? el('div', {
          style: { position: 'absolute', top: '12px', left: '12px', zIndex: 10 },
          onClick: (e) => {
            e.stopPropagation();
            if (isChecked) selectedIds.delete(tpl.id);
            else selectedIds.add(tpl.id);
            renderHeader(); renderTemplateList();
          }
        }, [
          el('div', {
            style: {
              width: '22px', height: '22px', borderRadius: '50%',
              border: isChecked ? 'none' : '2px solid #ccc',
              background: isChecked ? 'var(--danger)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer'
            },
            text: isChecked ? '✔' : ''
          })
        ]) : null,

        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingLeft: isManageMode ? '32px' : '0' } }, [
          el('div', { style: { fontWeight: '600', fontSize: '16px', color: 'var(--primary-dark)' }, text: tpl.title }),
          // 非管理模式下才显示操作按钮
          !isManageMode ? el('div', { style: { display: 'flex', gap: '6px' } }, [
            el('button', { class: 'btn btn-sm btn-ghost', text: '✏️ 编辑', onClick: () => openTemplateEditor(tpl) }),
            el('button', {
              class: 'btn btn-sm btn-danger', text: '🗑', onClick: async () => {
                if (await confirmBox({ title: '删除模板', message: `确定删除「${tpl.title}」吗？` })) {
                  templates = templates.filter(t => t.id !== tpl.id);
                  saveTemplates();
                  renderTemplateList();
                  toastSuccess('模板已删除');
                }
              }
            })
          ]) : null
        ]),

        el('div', { style: { fontSize: '13px', color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', paddingLeft: isManageMode ? '32px' : '0' }, text: plainContent || '（空内容）' }),

        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', paddingLeft: isManageMode ? '32px' : '0' } }, [
          el('span', { style: { fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(142,202,230,.15)', color: 'var(--primary-dark)' }, text: tpl.category }),
          !isManageMode ? el('button', {
            class: 'btn btn-sm btn-primary',
            text: '🚀 使用此模板建卡',
            onClick: () => applyTemplate(tpl)
          }) : null
        ])
      ]);
      listWrap.appendChild(card);
    });
  }

  renderHeader(); // 初始化头部
  renderTemplateList();

  // ==========================================
  // 2. 中间：原有的格式说明卡片
  // ==========================================
  // ... (这里省略的部分保持你原先 template.js 里的格式说明、下载按钮等代码完全不变) ...
  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default', marginTop: '16px' } }, [
    el('div', { class: 'card-title', text: '📋 批量导入整理模板' }),
    el('div', { style: { fontSize: '14px', color: 'var(--text-2)', lineHeight: '1.8', marginTop: '8px' } }, [
      '按以下格式整理资料，导入时网页能 100% 识别章节和知识点。',
      el('br'),
      '整理好后，在任务页点「📄 模板导入」，选文件即可自动创建章节和知识点。',
    ]),
  ]));

  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default', marginTop: '12px' } }, [
    el('div', { class: 'card-title', text: '📝 模板格式' }),
    el('pre', {
      style: { background: 'var(--bg)', padding: '12px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.8', overflowX: 'auto', marginTop: '8px', whiteSpace: 'pre-wrap', color: 'var(--text)' },
      text: templateText(),
    }),
  ]));

  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default', marginTop: '12px' } }, [
    el('div', { class: 'card-title', text: '📌 格式规则' }),
    el('div', { style: { fontSize: '14px', lineHeight: '1.8', marginTop: '8px' } }, [
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '## 章节：' }),
        el('span', { text: ' 开头的是章节名，每个章节自动创建一个章节。' }),
      ]),
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '### 知识点：' }),
        el('span', { text: ' 开头的是知识点内容，每行生成一个知识点。' }),
      ]),
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '解释：' }),
        el('span', { text: ' 开头的是知识点的解释，可省略。' }),
      ]),
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '空行' }),
        el('span', { text: ' 分隔不同知识点。' }),
      ]),
      el('div', { style: { color: 'var(--text-2)', fontSize: '13px', marginTop: '8px' } },
        ['支持的格式：.docx、.txt、文字版 PDF。扫描版 PDF 需要 OCR，不保证 100% 识别。']),
    ]),
  ]));

  // ==========================================
  // 3. 底部：原有的下载按钮组
  // ==========================================
  wrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px', marginBottom: '40px' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📥 下载 PDF 模板',
      onClick: () => downloadTemplate('pdf')
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📥 下载 Word 模板',
      onClick: () => downloadTemplate('doc')
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📥 下载 TXT 模板',
      onClick: () => downloadTemplate('txt')
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📋 复制模板',
      onClick: () => {
        navigator.clipboard.writeText(templateText()).then(() => toastSuccess('已复制'));
      },
    })
  ]));

  view.appendChild(wrap);

  // ==========================================
  // 辅助函数
  // ==========================================
  function loadTemplates() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }
  function saveTemplates() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  }

  function applyTemplate(tpl) {
    window.location.hash = `#/edit-point/new?tplId=${tpl.id}`;
    toastSuccess('已套用模板，请选择归属文件夹并保存');
  }

  function openTemplateEditor(tpl) {
    const isNew = !tpl;
    const current = tpl || { id: uuid(), title: '', category: '申论', content: '', explanation: '' };

    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
    const box = el('div', { class: 'confirm-box', style: { maxWidth: '600px', width: '95%', padding: '20px', display: 'flex', flexDirection: 'column', maxHeight: '90vh' } }, [
      el('h3', { text: isNew ? '新建模板' : '编辑模板', style: { marginBottom: '16px' } }),

      el('div', { style: { display: 'flex', gap: '12px', marginBottom: '12px' } }, [
        el('div', { class: 'field', style: { flex: '2', margin: 0 } }, [
          el('label', { text: '模板名称' }),
          el('input', { type: 'text', value: current.title, placeholder: '如：综合分析题-万能开头', style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }, onInput: (e) => current.title = e.target.value })
        ]),
        el('div', { class: 'field', style: { flex: '1', margin: 0 } }, [
          el('label', { text: '所属分类' }),
          el('select', { value: current.category, style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }, onchange: (e) => current.category = e.target.value },
            DEFAULT_CATEGORIES.filter(c => c !== '全部').map(c => el('option', { value: c, text: c }))
          )
        ])
      ]),

      el('div', { class: 'field', style: { marginBottom: '12px' } }, [
        el('label', { text: '模板内容（卡片正文）' }),
        el('textarea', { placeholder: '输入模板的正文内容...', style: { width: '100%', minHeight: '100px', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', resize: 'vertical' }, onInput: (e) => current.content = e.target.value }, current.content)
      ]),

      el('div', { class: 'field', style: { marginBottom: '16px' } }, [
        el('label', { text: '文字解释（可选）' }),
        el('textarea', { placeholder: '输入解析、思路等...', style: { width: '100%', minHeight: '100px', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', resize: 'vertical' }, onInput: (e) => current.explanation = e.target.value }, current.explanation)
      ]),

      el('div', { class: 'confirm-actions', style: { justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '16px' } }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: '保存模板', onClick: () => {
            if (!current.title.trim()) return toastError('请填写模板名称');

            if (isNew) {
              templates.unshift(current);
            } else {
              const idx = templates.findIndex(t => t.id === current.id);
              if (idx >= 0) templates[idx] = current;
            }
            saveTemplates();
            renderTemplateList();
            mask.remove();
            toastSuccess(isNew ? '模板已创建' : '模板已更新');
          }
        })
      ])
    ]);

    mask.appendChild(box);
    document.body.appendChild(mask);
  }
}

function templateText() {
  return `## 章节：法律常识

### 知识点：宪法是国家的根本法
解释：宪法规定国家根本制度和根本任务，具有最高法律效力。

### 知识点：全国人民代表大会是最高权力机关
解释：全国人民代表大会行使国家立法权、决定权、任免权、监督权。

## 章节：行政法

### 知识点：行政许可的定义
解释：行政许可是指行政机关根据公民、法人或者其他组织的申请，经依法审查，准予其从事特定活动的行为。

### 知识点：行政处罚的种类
解释：警告、罚款、没收违法所得、责令停产停业、暂扣或吊销许可证、行政拘留。
`;
}

// ============ 强大的模板下载工具 ============
async function downloadTemplate(format) {
  const content = `# 第一章 资料分析\n## 第一节 基础概念\n1. 增长率 = (现期 - 基期) / 基期\n2. 比重 = 部分 / 整体\n\n# 第二章 申论\n## 第一节 归纳概括\n- 问题：材料中反映了哪些问题？\n- 对策：提出解决这些问题的建议。`;

  let blob, filename, mimeType, ext;

  if (format === 'txt') {
    blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
    filename = '资料复习模板.txt'; ext = '.txt'; mimeType = 'text/plain';
  }
  else if (format === 'doc') {
    const docHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>资料复习模板</title></head><body><pre style="font-family: sans-serif; white-space: pre-wrap;">${content}</pre></body></html>`;
    blob = new Blob(['\uFEFF' + docHtml], { type: 'application/msword' });
    filename = '资料复习模板.doc'; ext = '.doc'; mimeType = 'application/msword';
  }
  else if (format === 'pdf') {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body { font-family: sans-serif; line-height: 1.6; padding: 20px; } h1, h2 { page-break-after: avoid; }</style></head><body><h1>资料复习模板</h1><pre style="white-space: pre-wrap; font-family: inherit;">${content}</pre></body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); }, 600);
    toastSuccess('请在弹出的打印窗口中选择“另存为 PDF”');
    return;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: '模板文件', accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toastSuccess('模板已保存到你选择的位置');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('原生另存为失败，降级为默认下载', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
  toastSuccess('已开始下载（保存至默认下载目录）');
}