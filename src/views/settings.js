import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';
import { dbGet, dbPut } from '../db.js';

const MODULES = [
  { key: 'kg_tasks', label: '📚 任务列表' },
  { key: 'kg_chapters', label: '📖 章节列表' },
  { key: 'kg_points', label: '💡 知识点（含笔记）' },
  { key: 'images', label: '🖼️ 图片（含笔迹）' },
  { key: 'kg_inbox', label: '📥 速记收件箱' },
  { key: 'kg_settings', label: '⚙️ 系统设置' },
];

export function renderSettings() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '设置';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  // ============ 1. 外观 ============
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '🎨 外观' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('button', {
        class: 'btn btn-ghost', text: '🌙 切换暗黑模式',
        onClick: () => {
          const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
          if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('kg_theme', 'light');
            toastSuccess('已切换为浅色模式');
          } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('kg_theme', 'dark');
            toastSuccess('已切换为暗黑模式');
          }
        }
      })
    ])
  ]));

  // ============ 2. 数据备份与恢复 ============
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '💾 数据备份与恢复' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '16px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' } }, [
        '支持导出为各类格式。如果需要离线打印，推荐导出 PDF 或 HTML。',
      ]),
      el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn btn-primary', text: '📦 导出数据', onClick: () => openExportModal() }),
        el('button', { class: 'btn btn-danger', text: '📥 导入备份', style: { background: 'rgba(239,71,111,.1)', color: 'var(--danger)' }, onClick: () => openImportModal() })
      ])
    ])
  ]));

  // ============ 3. 存储用量 ============
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '📊 存储用量' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { id: 'storage-usage', style: { fontSize: '13px', color: 'var(--text-2)' }, text: '正在计算…' })
    ])
  ]));

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      const percent = Math.round((usage / quota) * 100);
      const usageMB = (usage / (1024 * 1024)).toFixed(1);
      const quotaMB = (quota / (1024 * 1024)).toFixed(0);
      const elUsage = document.getElementById('storage-usage');
      if (elUsage) {
        elUsage.innerHTML = `当前已用：<b>${usageMB} MB</b> / 约 ${quotaMB} MB (${percent}%)<br><br>
        <span style="color:${percent > 80 ? 'var(--danger)' : 'var(--text-2)'}">
          ${percent > 80 ? '⚠️ 存储空间即将耗尽，建议尽快导出备份并清理不用的图片。' : '存储空间充足。'}
        </span>`;
      }
    });
  }
}

// ============ 导出弹窗（修复版） ============
function openExportModal() {
  // 1. 修复：强制读取正确的类型，不依赖旧的错误缓存
  let currentFormat = 'pdf';
  let onlyError = false;
  let includeImagesInDoc = false;

  const selectedModules = new Set(MODULES.map(m => m.key));
  const selectedTaskIds = new Set();
  const selectedChapterIds = new Set();

  const tasks = store.getTasks();
  const taskListEl = el('div', { style: { maxHeight: '200px', overflowY: 'auto' } });

  const imgCheckboxWrap = el('label', { style: { display: 'none', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '12px', padding: '8px', background: 'rgba(142,202,230,.08)', borderRadius: '6px' } }, [
    el('input', { type: 'checkbox', checked: includeImagesInDoc, onChange: (e) => { includeImagesInDoc = e.target.checked; } }),
    el('span', { text: '📸 在文档中嵌入解释图片', style: { color: 'var(--primary-dark)', fontWeight: '600' } })
  ]);

  function renderOnlyError() {
    // 强制刷新错题勾选框的 UI（通过重新生成整个弹窗太慢，这里只更新局部文字）
    const elCheck = document.querySelector('span:has(> span:contains("🔥 仅导出"))');
    // 上面这句选择器可能不兼容，我们用最简单的方法：重绘整个范围区域（利用闭包）
  }

  function renderTaskTree() {
    taskListEl.innerHTML = '';
    if (tasks.length === 0) {
      taskListEl.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '暂无任务' }));
      return;
    }

    tasks.forEach(t => {
      const chapters = store.getChapters(t.id);
      const isTaskChecked = selectedTaskIds.has(t.id);
      let isExpanded = isTaskChecked || chapters.some(c => selectedChapterIds.has(c.id));

      const taskContainer = el('div', { style: { marginBottom: '10px' } });

      const makeCheckbox = (checked) => el('div', {
        style: {
          width: '18px', height: '18px', borderRadius: '4px', border: checked ? 'none' : '2px solid var(--text-2)',
          background: checked ? 'var(--primary)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '12px', flexShrink: '0'
        },
        text: checked ? '✔' : ''
      });

      // ================= 任务行 =================
      // 注意：这里全部使用 onClick，去掉了 onPointerDown
      const taskRow = el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 0' },
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (selectedTaskIds.has(t.id)) {
            selectedTaskIds.delete(t.id);
            chapters.forEach(c => selectedChapterIds.delete(c.id));
          } else {
            selectedTaskIds.add(t.id);
            chapters.forEach(c => selectedChapterIds.add(c.id));
          }
          renderTaskTree();
        }
      }, [
        // 展开箭头（拦截点击，防止触发任务勾选）
        el('span', {
          style: { fontSize: '12px', color: 'var(--text-2)', width: '16px', textAlign: 'center', cursor: 'pointer' },
          text: chapters.length > 0 ? (isExpanded ? '▾' : '▸') : '',
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            isExpanded = !isExpanded;
            renderTaskTree();
          }
        }),
        makeCheckbox(isTaskChecked),
        el('span', { style: { fontWeight: '600', fontSize: '14px', flex: '1' }, text: t.name })
      ]);

      taskContainer.appendChild(taskRow);

      // ================= 章节列表 =================
      if (isExpanded && chapters.length > 0) {
        const chList = el('div', { style: { paddingLeft: '32px', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' } });

        chapters.forEach(c => {
          const isChChecked = selectedChapterIds.has(c.id);

          // 注意：这里也只用 onClick
          const chRow = el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 0' },
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (selectedChapterIds.has(c.id)) {
                selectedChapterIds.delete(c.id);
                selectedTaskIds.delete(t.id); // 取消子章节时，父任务取消全选
              } else {
                selectedChapterIds.add(c.id);
                // 如果所有子章节都勾了，自动勾上父任务
                if (chapters.every(ch => ch.id === c.id || selectedChapterIds.has(ch.id))) {
                  selectedTaskIds.add(t.id);
                }
              }
              renderTaskTree();
            }
          }, [
            makeCheckbox(isChChecked),
            el('span', { style: { fontSize: '13px', color: 'var(--text-2)', flex: '1' }, text: c.name })
          ]);

          chList.appendChild(chRow);
        });

        taskContainer.appendChild(chList);
      }

      taskListEl.appendChild(taskContainer);
    });
  }
  renderTaskTree();

  const moduleCheckboxes = {};
  function updateModuleStatus() {
    const isZip = currentFormat === 'zip';
    const isDoc = ['pdf', 'html'].includes(currentFormat);

    imgCheckboxWrap.style.display = isDoc ? 'flex' : 'none';

    MODULES.forEach(m => {
      const cb = moduleCheckboxes[m.key];
      if (!cb) return;
      if (!isZip && (m.key === 'images' || m.key === 'kg_settings' || m.key === 'kg_inbox')) {
        cb.disabled = true;
        cb.checked = false;
        selectedModules.delete(m.key);
        cb.parentElement.style.opacity = '0.5';
      } else {
        cb.disabled = false;
        cb.checked = selectedModules.has(m.key);
        cb.parentElement.style.opacity = '1';
      }
    });
  }

  // 2. 修复：全选/反选阻止事件冒泡
  const toggleAllModules = (e) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止 details 折叠
    const allChecked = MODULES.every(m => selectedModules.has(m.key) || moduleCheckboxes[m.key]?.disabled);
    MODULES.forEach(m => {
      if (moduleCheckboxes[m.key] && !moduleCheckboxes[m.key].disabled) {
        if (allChecked) selectedModules.delete(m.key);
        else selectedModules.add(m.key);
        moduleCheckboxes[m.key].checked = !allChecked;
      }
    });
  };

  const toggleAllScope = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const allChecked = tasks.every(t => selectedTaskIds.has(t.id));
    tasks.forEach(t => {
      if (allChecked) {
        selectedTaskIds.delete(t.id);
      } else {
        selectedTaskIds.add(t.id);
      }
    });
    renderTaskTree(); // 强制刷新 DOM
  };

  const mask = el('div', {
    class: 'confirm-mask',
    style: { zIndex: 9999 },
    onClick: (e) => {
      if (e.target === mask) mask.remove();
    }
  }, [
    el('div', {
      class: 'confirm-box',
      style: { maxWidth: '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      onPointerdown: (e) => e.stopPropagation()
    }, [
      el('h3', { text: '📦 导出数据', style: { margin: '0 0 12px 0', flexShrink: '0', paddingLeft: '8px' } }),

      el('div', {
        style: { flex: '1', overflowY: 'auto', padding: '4px 12px 4px 4px', display: 'flex', flexDirection: 'column', gap: '16px' }
      }, [
        // 1. 格式
        el('div', { class: 'section', style: { border: '1px solid rgba(0,0,0,.1)', boxShadow: 'none', flexShrink: '0' } }, [
          el('div', { class: 'section-body', style: { padding: '12px' } }, [
            el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px' }, text: '1. 导出格式' }),
            el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' } },
              [
                ['zip', '📦 ZIP 完整包'], ['json', '📄 JSON 数据'], ['markdown', '📝 Markdown'],
                ['txt', '📑 纯文本 TXT'], ['html', '🌐 网页 HTML'], ['pdf', '🖨️ 打印 PDF']
              ].map(([fmt, label]) => el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' } }, [
                el('input', {
                  type: 'radio', name: 'exportFmt', value: fmt, checked: currentFormat === fmt,
                  onChange: (e) => {
                    if (e.target.checked) {
                      currentFormat = fmt;
                      updateModuleStatus();
                    }
                  }
                }),
                el('span', { text: label })
              ]))
            )
          ])
        ]),

        // 2. 数据模块
        el('div', { style: { border: '1px solid rgba(0,0,0,.1)', borderRadius: '8px', padding: '12px' } }, [
          el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' } }, [
            el('span', { text: '2. 数据模块' }),
            el('button', {
              type: 'button', class: 'btn btn-sm btn-ghost', text: '全选/反选', style: { padding: '2px 8px', minHeight: '24px', fontSize: '12px' },
              onClick: (e) => {
                e.preventDefault(); e.stopPropagation();
                const allChecked = MODULES.every(m => selectedModules.has(m.key) || moduleCheckboxes[m.key]?.disabled);
                MODULES.forEach(m => {
                  if (moduleCheckboxes[m.key] && !moduleCheckboxes[m.key].disabled) {
                    if (allChecked) selectedModules.delete(m.key);
                    else selectedModules.add(m.key);
                    moduleCheckboxes[m.key].checked = !allChecked;
                  }
                });
              }
            })
          ]),
          el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
            MODULES.map(m => {
              const cb = el('input', {
                type: 'checkbox', checked: selectedModules.has(m.key), onChange: (e) => {
                  if (e.target.checked) selectedModules.add(m.key); else selectedModules.delete(m.key);
                }
              });
              moduleCheckboxes[m.key] = cb;
              return el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' } }, [cb, el('span', { text: m.label })]);
            })
          )
        ]),

        // 3. 范围与过滤
        el('div', { style: { border: '1px solid rgba(0,0,0,.1)', borderRadius: '8px', padding: '12px' } }, [
          el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '12px' }, text: '3. 范围与过滤' }),

          imgCheckboxWrap,

          // 错题过滤
          el('label', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', padding: '10px', background: 'rgba(239,71,111,.08)', borderRadius: '8px' }
          }, [
            el('input', { type: 'checkbox', checked: onlyError, onChange: (e) => { onlyError = e.target.checked; } }),
            el('span', { text: '🔥 仅导出易错/难记度≥7 的知识点（错题本）', style: { color: 'var(--danger)', fontWeight: '600' } })
          ]),

          // 全选/反选按钮平铺在最上方
          el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } }, [
            el('button', {
              type: 'button',
              class: 'btn btn-sm btn-ghost',
              text: '☑️ 全选任务',
              style: { flex: '1' },
              onClick: (e) => {
                e.preventDefault(); e.stopPropagation();
                const allChecked = tasks.every(t => selectedTaskIds.has(t.id));
                tasks.forEach(t => { allChecked ? selectedTaskIds.delete(t.id) : selectedTaskIds.add(t.id); });
                renderTaskTree();
              }
            }),
            el('button', {
              type: 'button',
              class: 'btn btn-sm btn-ghost',
              text: '⬜ 全不选',
              style: { flex: '1' },
              onClick: (e) => {
                e.preventDefault(); e.stopPropagation();
                selectedTaskIds.clear();
                selectedChapterIds.clear();
                renderTaskTree();
              }
            })
          ]),

          // 任务列表容器
          el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px' }, text: '指定要导出的任务/章节（不选则代表全部）：' }),
          taskListEl
        ])

      ]),

      el('div', { class: 'confirm-actions', style: { marginTop: '16px', flexShrink: '0' } }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: '开始导出',
          onClick: () => {
            if (currentFormat === 'zip' && selectedModules.size === 0) { toastError('至少选择一个模块'); return; }
            mask.remove();
            doExport(
              currentFormat,
              Array.from(selectedModules),
              Array.from(selectedTaskIds),
              Array.from(selectedChapterIds),
              onlyError,
              includeImagesInDoc
            );
          }
        })
      ])
    ])
  ]);
  document.body.appendChild(mask);
  updateModuleStatus();
}

// ============ 核心导出逻辑（修复参数污染） ============
async function doExport(exportType, keysToExport, targetTaskIds, targetChapterIds, onlyError, includeImagesInDoc) {
  toastSuccess('正在生成数据…');

  try {
    const hasScope = targetTaskIds.length > 0 || targetChapterIds.length > 0;

    let exportTasks = [];
    let exportChapters = [];
    let exportPoints = [];

    if (keysToExport.includes('kg_tasks') || hasScope) {
      const allTasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]');
      exportTasks = hasScope ? allTasks.filter(t => targetTaskIds.includes(t.id)) : allTasks;
    }
    if (keysToExport.includes('kg_chapters') || hasScope) {
      const allChapters = JSON.parse(localStorage.getItem('kg_chapters') || '[]');
      exportChapters = hasScope ? allChapters.filter(c => targetChapterIds.includes(c.id) || targetTaskIds.includes(c.taskId)) : allChapters;
    }
    if (keysToExport.includes('kg_points') || exportType !== 'zip') {
      const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
      let filtered = allPoints;
      if (hasScope) {
        const validChapterIds = new Set(exportChapters.map(c => c.id));
        filtered = allPoints.filter(p => validChapterIds.has(p.chapterId));
      }
      if (onlyError) {
        filtered = filtered.filter(p => p.isErrorProne || (p.difficulty || 0) >= 7);
      }
      exportPoints = filtered;
    }

    // ================= 1. JSON =================
    if (exportType === 'json') {
      const data = { tasks: exportTasks, chapters: exportChapters, points: exportPoints };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `资料复习数据_${new Date().toISOString().slice(0, 10)}.json`);
      return;
    }

    // ================= 2. Markdown =================
    if (exportType === 'markdown') {
      let content = `# 资料复习导出\n生成时间：${new Date().toLocaleString()}\n\n`;
      exportTasks.forEach(t => {
        const chs = exportChapters.filter(c => c.taskId === t.id);
        if (chs.length === 0) return;
        content += `## 📚 ${t.name}\n\n`;
        chs.forEach(c => {
          const pts = exportPoints.filter(p => p.chapterId === c.id);
          if (pts.length === 0) return;
          content += `### 📖 ${c.name}\n\n`;
          pts.forEach((p, i) => {
            content += `**${i + 1}. ${p.content}**\n\n`;
            if (p.explanation) content += `> ${p.explanation.replace(/\n/g, '\n> ')}\n\n`;
          });
        });
      });
      const blob = new Blob([content], { type: 'text/markdown' });
      downloadBlob(blob, `资料复习_${new Date().toISOString().slice(0, 10)}.md`);
      return;
    }

    // ================= 3. TXT =================
    if (exportType === 'txt') {
      let content = `资料复习导出\n生成时间：${new Date().toLocaleString()}\n\n`;
      exportTasks.forEach(t => {
        const chs = exportChapters.filter(c => c.taskId === t.id);
        if (chs.length === 0) return;
        content += `=== ${t.name} ===\n\n`;
        chs.forEach(c => {
          const pts = exportPoints.filter(p => p.chapterId === c.id);
          if (pts.length === 0) return;
          content += `--- ${c.name} ---\n\n`;
          pts.forEach((p, i) => {
            content += `${i + 1}. ${p.content}\n`;
            if (p.explanation) content += `   解释：${p.explanation.replace(/\n/g, '\n   ')}\n`;
            content += '\n';
          });
        });
      });
      const blob = new Blob([content], { type: 'text/plain' });
      downloadBlob(blob, `资料复习_${new Date().toISOString().slice(0, 10)}.txt`);
      return;
    }

    // ================= 4 & 5. HTML & PDF =================
    if (exportType === 'html' || exportType === 'pdf') {
      let htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>资料复习</title><style>
        body { font-family: sans-serif; line-height: 1.6; color: #000; max-width: 900px; margin: 0 auto; padding: 20px; }
        h1, h2, h3 { color: #000; page-break-after: avoid; }
        h2 { border-bottom: 2px solid #8ECAE6; padding-bottom: 4px; margin-top: 30px; }
        .point { margin-bottom: 16px; padding-left: 12px; border-left: 3px solid #FFD166; page-break-inside: avoid; }
        .explanation { color: #333; font-size: 14px; margin-top: 4px; }
        .img-wrap { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 10px; }
        .img-wrap img { max-width: 100%; max-height: 400px; object-fit: contain; border-radius: 6px; border: 1px solid #ccc; page-break-inside: avoid; }
      </style></head><body>\n`;
      htmlContent += `<h1>资料复习导出 <small style="font-size:14px;color:#666;">${new Date().toLocaleString()}</small></h1>\n`;

      for (const t of exportTasks) {
        const chs = exportChapters.filter(c => c.taskId === t.id);
        if (chs.length === 0) continue;
        htmlContent += `<h2>📚 ${t.name}</h2>\n`;

        for (const c of chs) {
          const pts = exportPoints.filter(p => p.chapterId === c.id);
          if (pts.length === 0) continue;
          htmlContent += `<h3>📖 ${c.name}</h3>\n`;

          for (const p of pts) {
            htmlContent += `<div class="point"><strong>${p.content}</strong>`;
            if (p.explanation) htmlContent += `<div class="explanation">${p.explanation.replace(/\n/g, '<br>')}</div>`;

            // 👇 强制读取带笔迹的图片（去掉了 includeImagesInDoc 限制）
            if (p.imageIds && p.imageIds.length > 0) {
              htmlContent += `<div class="img-wrap">`;
              for (const imgId of p.imageIds) {
                const rec = await dbGet('images', imgId);
                if (rec && (rec.annotatedBlob || rec.originalBlob)) {
                  const blob = rec.annotatedBlob || rec.originalBlob;
                  const base64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                  });
                  htmlContent += `<img src="${base64}" />`;
                }
              }
              htmlContent += `</div>`;
            }
            htmlContent += `</div>\n`;
          }
        }
      }
      htmlContent += `</body></html>`;

      if (exportType === 'html') {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        downloadBlob(blob, `资料复习带图_${new Date().toISOString().slice(0, 10)}.html`);
      } else {
        // 👇 终极修复：使用 iframe 并在所有图片加载完毕后再调用打印
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(htmlContent);
        doc.close();

        const checkImagesLoaded = () => {
          const imgs = doc.images;
          let allLoaded = true;
          for (let i = 0; i < imgs.length; i++) {
            if (!imgs[i].complete) {
              allLoaded = false;
              break;
            }
          }
          return allLoaded;
        };

        let attempts = 0;
        const triggerPrint = () => {
          if (checkImagesLoaded() || attempts > 50) { // 最多等 5 秒
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => {
              if (document.body.contains(iframe)) document.body.removeChild(iframe);
            }, 2000);
          } else {
            attempts++;
            setTimeout(triggerPrint, 100);
          }
        };

        setTimeout(triggerPrint, 300);
      }
      return;
    }

    // ================= 6. ZIP =================
    if (!window.JSZip) { toastError('JSZip 未加载'); return; }
    const zip = new JSZip();

    const localData = {};
    if (keysToExport.includes('kg_tasks')) localData.kg_tasks = exportTasks;
    if (keysToExport.includes('kg_chapters')) localData.kg_chapters = exportChapters;
    if (keysToExport.includes('kg_points')) localData.kg_points = exportPoints;
    if (keysToExport.includes('kg_inbox')) localData.kg_inbox = JSON.parse(localStorage.getItem('kg_inbox') || '[]');
    if (keysToExport.includes('kg_settings')) localData.kg_settings = JSON.parse(localStorage.getItem('kg_settings') || '{}');

    const imgIds = new Set();
    const imagesMap = {};
    if (keysToExport.includes('images')) {
      exportPoints.forEach(p => {
        (p.imageIds || []).forEach(id => imgIds.add(id));
        (p.compositeImageIds || []).forEach(id => imgIds.add(id));
      });
    }

    const imgFolder = zip.folder('images');
    if (imgIds.size > 0) {
      for (const id of imgIds) {
        const rec = await dbGet('images', id);
        if (rec) {
          imagesMap[id] = { width: rec.width, height: rec.height, source: rec.source, createdAt: rec.createdAt };
          if (rec.originalBlob) imgFolder.file(`${id}_original.png`, rec.originalBlob);
          if (rec.annotatedBlob) imgFolder.file(`${id}_annotated.png`, rec.annotatedBlob);
        }
      }
    }

    const meta = { version: 6, exportedAt: new Date().toISOString(), modules: keysToExport, localData, imagesMap };
    zip.file('meta.json', JSON.stringify(meta, null, 2));

    // ZIP 内嵌一份带图的 HTML
    if (keysToExport.includes('kg_points')) {
      let htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: sans-serif; line-height: 1.6; color: #000; max-width: 900px; margin: 0 auto; padding: 20px; }
        h1, h2, h3 { color: #000; page-break-after: avoid; }
        h2 { border-bottom: 2px solid #8ECAE6; padding-bottom: 4px; margin-top: 30px; }
        .point { margin-bottom: 12px; padding-left: 12px; border-left: 3px solid #FFD166; page-break-inside: avoid; }
        .explanation { color: #333; font-size: 14px; margin-top: 4px; }
        .img-wrap { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
        .img-wrap img { max-width: 100%; max-height: 400px; object-fit: contain; border-radius: 6px; }
      </style></head><body>\n`;
      htmlContent += `<h1>资料复习导出 <small style="font-size:14px;color:#666;">${new Date().toLocaleString()}</small></h1>\n`;

      for (const t of exportTasks) {
        const chs = exportChapters.filter(c => c.taskId === t.id);
        if (chs.length === 0) continue;
        htmlContent += `<h2>📚 ${t.name}</h2>\n`;
        for (const c of chs) {
          const pts = exportPoints.filter(p => p.chapterId === c.id);
          if (pts.length === 0) continue;
          htmlContent += `<h3>📖 ${c.name}</h3>\n`;
          for (const p of pts) {
            htmlContent += `<div class="point"><strong>${p.content}</strong>`;
            if (p.explanation) htmlContent += `<div class="explanation">${p.explanation.replace(/\n/g, '<br>')}</div>`;

            if (p.imageIds && p.imageIds.length > 0) {
              htmlContent += `<div class="img-wrap">`;
              for (const imgId of p.imageIds) {
                const rec = await dbGet('images', imgId);
                if (rec && (rec.annotatedBlob || rec.originalBlob)) {
                  const blob = rec.annotatedBlob || rec.originalBlob;
                  const base64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                  });
                  htmlContent += `<img src="${base64}">`;
                }
              }
              htmlContent += `</div>`;
            }
            htmlContent += `</div>\n`;
          }
        }
      }
      htmlContent += `</body></html>`;
      zip.file(`复习资料_打印版_${new Date().toISOString().slice(0, 10)}.html`, htmlContent);
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `资料复习全量包_${new Date().toISOString().slice(0, 10)}.zip`);

  } catch (err) {
    console.error(err);
    toastError('导出失败：' + err.message);
  }
}

// 统一下载封装
async function downloadBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: '导出文件', accept: { [blob.type]: ['.zip', '.json', '.md', '.txt', '.html'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toastSuccess('导出成功');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toastSuccess('导出成功（已开始下载）');
}

// ============ 导入弹窗 ============
function openImportModal() {
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 9999 } }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '480px', textAlign: 'center' } }, [
      el('h3', { text: '📥 导入数据备份' }),
      el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '20px' }, text: '请选择 .zip 备份文件，或拖拽到下方。' }),
      el('div', {
        id: 'drop-zone',
        style: { border: '2px dashed var(--primary)', borderRadius: '12px', padding: '40px 20px', background: 'rgba(142,202,230,0.05)', cursor: 'pointer', transition: 'all 0.2s', marginBottom: '20px' },
        onDragover: (e) => { e.preventDefault(); e.target.style.background = 'rgba(142,202,230,0.15)'; },
        onDragleave: (e) => { e.preventDefault(); e.target.style.background = 'rgba(142,202,230,0.05)'; },
        onDrop: (e) => {
          e.preventDefault();
          e.target.style.background = 'rgba(142,202,230,0.05)';
          const file = e.dataTransfer.files[0];
          if (file && file.name.endsWith('.zip')) doImportParse(file, mask);
          else toastError('请上传 .zip 文件');
        },
        onClick: () => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = '.zip';
          input.onchange = (e) => { if (e.target.files[0]) doImportParse(e.target.files[0], mask); };
          input.click();
        }
      }, [
        el('div', { style: { fontSize: '32px', marginBottom: '8px' }, text: '📁' }),
        el('div', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '点击选择文件' }),
      ]),
      el('div', { class: 'confirm-actions', style: { justifyContent: 'center' } }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
      ])
    ])
  ]);
  document.body.appendChild(mask);
}

async function doImportParse(file, mask) {
  if (!window.JSZip) { toastError('JSZip 未加载'); return; }
  toastSuccess('正在解析备份文件…');

  try {
    const zip = await JSZip.loadAsync(file);
    const metaFile = zip.file('meta.json');
    if (!metaFile) throw new Error('缺少 meta.json 数据');
    const meta = JSON.parse(await metaFile.async('string'));
    mask.remove();

    const availableModules = MODULES.filter(m => {
      if (m.key === 'images') return Object.keys(meta.imagesMap || {}).length > 0;
      return meta.localData && meta.localData[m.key];
    });

    const selected = new Set(availableModules.map(m => m.key));

    const confirmMask = el('div', { class: 'confirm-mask', style: { zIndex: 9999 } }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
        el('h3', { text: '恢复哪些数据？' }),
        el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '勾选你要恢复的模块：' }),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' } },
          availableModules.map(m => el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' } }, [
            el('input', { type: 'checkbox', checked: true, onChange: (e) => { if (e.target.checked) selected.add(m.key); else selected.delete(m.key); } }),
            el('span', { text: m.label })
          ]))
        ),
        el('div', { style: { fontSize: '12px', color: 'var(--danger)', marginBottom: '16px' } }, '⚠️ 恢复操作不可逆，会合并或覆盖现有数据。'),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => confirmMask.remove() }),
          el('button', {
            class: 'btn btn-primary', text: '确定恢复',
            onClick: async () => {
              if (selected.size === 0) { toastError('至少选一项'); return; }
              confirmMask.remove();
              await doImportApply(zip, meta, Array.from(selected));
            }
          })
        ])
      ])
    ]);
    document.body.appendChild(confirmMask);

  } catch (err) {
    console.error(err);
    toastError('解析失败：' + err.message);
  }
}

async function doImportApply(zip, meta, selectedModules) {
  toastSuccess('正在恢复数据…');
  try {
    selectedModules.forEach(k => {
      if (k === 'images') return;
      if (meta.localData[k]) {
        if (Array.isArray(meta.localData[k])) {
          const existing = JSON.parse(localStorage.getItem(k) || '[]');
          const existingIds = new Set(existing.map(x => x.id));
          const newItems = meta.localData[k].filter(x => !existingIds.has(x.id));
          localStorage.setItem(k, JSON.stringify([...existing, ...newItems]));
        } else {
          const existing = JSON.parse(localStorage.getItem(k) || '{}');
          localStorage.setItem(k, JSON.stringify({ ...existing, ...meta.localData[k] }));
        }
      }
    });

    if (selectedModules.includes('images')) {
      const imgFolder = zip.folder('images');
      if (imgFolder) {
        const imgFiles = [];
        imgFolder.forEach((path, f) => { if (!f.dir) imgFiles.push(f); });

        const groupedImages = {};
        imgFiles.forEach(f => {
          const match = f.name.match(/(.+)_(original|annotated)\.png$/);
          if (match) {
            const id = match[1];
            if (!groupedImages[id]) groupedImages[id] = {};
            groupedImages[id][match[2]] = f;
          }
        });

        for (const id of Object.keys(groupedImages)) {
          const group = groupedImages[id];
          const imgMeta = meta.imagesMap[id] || {};
          let originalBlob = null;
          let annotatedBlob = null;
          if (group.original) originalBlob = await group.original.async('blob');
          if (group.annotated) annotatedBlob = await group.annotated.async('blob');

          await dbPut('images', {
            id: id,
            originalBlob: originalBlob || annotatedBlob,
            annotatedBlob: annotatedBlob || originalBlob,
            width: imgMeta.width || 800,
            height: imgMeta.height || 600,
            source: imgMeta.source || 'imported',
            createdAt: imgMeta.createdAt || new Date().toISOString()
          });
        }
      }
    }

    toastSuccess('数据恢复成功！1秒后自动刷新…');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    console.error(err);
    toastError('恢复失败：' + err.message);
  }
}