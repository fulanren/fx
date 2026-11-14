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
  { key: 'pdfs', label: '📁 文档附件 (PDF)' },
  { key: 'kg_inbox', label: '📥 速记收件箱' },
  { key: 'kg_settings', label: '⚙️ 系统设置' },
];

export function renderSettings() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '设置';
  document.getElementById('btn-back').classList.remove('hidden');

  // 👇 核心：每次离开设置页，自动刷新一次页面以更新顶栏
  document.getElementById('btn-back').onclick = () => {
    location.reload();
  };

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
      }),
      // 👇 新增：悬浮火箭开关
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' } }, [
        el('input', { 
          type: 'checkbox', 
          checked: localStorage.getItem('kg_hide_back_to_top') !== '1',
          onChange: (e) => {
            localStorage.setItem('kg_hide_back_to_top', e.target.checked ? '0' : '1');
            toastSuccess(e.target.checked ? '已开启悬浮火箭' : '已关闭悬浮火箭');
            // 触发一次滚动事件更新状态
            window.dispatchEvent(new Event('scroll'));
          }
        }),
        el('span', { text: '显示“🚀 回到顶部”悬浮按钮' })
      ])
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

  // ============ 4. 自定义顶栏快捷按钮 ============
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '🧩 自定义顶栏快捷按钮' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '勾选需要的按钮，保存后生效。' }),

      (() => {
        let prefs = JSON.parse(localStorage.getItem('kg_topbar_prefs') || '[]');
        if (prefs.length === 0) prefs = ['theme', 'quickNote', 'review', 'search', 'export'];

        const checkboxes = [
          { id: 'theme', label: '🌙 切换主题' },
          { id: 'quickNote', label: '⚡️ 速记' },
          { id: 'review', label: '🎯 复习' },
          { id: 'search', label: '🔍 搜索' },
          { id: 'export', label: '📤 导出数据' },
          { id: 'import', label: '📥 导入数据' },
          { id: 'template', label: '📑 资料模板' },
          { id: 'importDoc', label: '📄 文档导入' },
          { id: 'home', label: '📚 背诵首页' },
          { id: 'resources', label: '📁 资源总览' },
          { id: 'inbox', label: '📥 速记收件箱' },
          { id: 'countdown', label: '⏰ 考试倒计时' },
          { id: 'trash', label: '🗑 回收站' },
          { id: 'help', label: '❓ 帮助' },
          { id: 'settings', label: '⚙️ 设置页' },
        ];

        // 渲染复选框列表
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
          checkboxes.map(tool => el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' } }, [
            el('input', {
              type: 'checkbox',
              class: 'topbar-pref-cb',
              value: tool.id,
              checked: prefs.includes(tool.id)
            }),
            el('span', { text: tool.label })
          ]))
        );

        // 全选 / 全不选 按钮
        const selectAllRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } }, [
          el('button', {
            class: 'btn btn-sm btn-ghost',
            text: '全选',
            onClick: () => {
              document.querySelectorAll('.topbar-pref-cb').forEach(cb => cb.checked = true);
            }
          }),
          el('button', {
            class: 'btn btn-sm btn-ghost',
            text: '全不选',
            onClick: () => {
              document.querySelectorAll('.topbar-pref-cb').forEach(cb => cb.checked = false);
            }
          })
        ]);

                // 在列表下方加上全宽的保存按钮
        const saveBtn = el('button', {
          class: 'btn btn-primary btn-sm',
          text: '💾 保存并应用',
          style: { marginTop: '16px', padding: '4px 16px', fontSize: '13px' }, 
          onClick: () => {
            const checkedCbs = document.querySelectorAll('.topbar-pref-cb:checked');
            const newPrefs = Array.from(checkedCbs).map(cb => cb.value);
            localStorage.setItem('kg_topbar_prefs', JSON.stringify(newPrefs));
            toastSuccess('已保存，正在刷新...');
            setTimeout(() => location.reload(), 500);
          }
        });

        return el('div', {}, [list, selectAllRow, saveBtn]);
      })()
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

  // ================= 👇 云同步面板 加在这里 =================
  const davSettings = JSON.parse(localStorage.getItem('kg_webdav_settings') || '{}');
  
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '☁️ WebDAV 云同步' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)' } }, [
        '支持坚果云等 WebDAV 网盘，建议使用应用密码。',
      ]),
      
      el('div', { class: 'field' }, [
        el('label', { text: 'WebDAV 地址' }),
        el('input', { id: 'dav-url', type: 'text', placeholder: '例如 https://dav.jianguoyun.com/dav/', value: davSettings.url || '' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '账号 / 邮箱' }),
        el('input', { id: 'dav-user', type: 'text', placeholder: '你的账号', value: davSettings.user || '' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '应用密码' }),
        el('input', { id: 'dav-pass', type: 'password', placeholder: '生成的第三方应用密码', value: davSettings.pass || '' })
      ]),

      // 👇 在按钮组的上面加自动同步勾选框
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', marginTop: '4px' } }, [
        el('input', { 
          type: 'checkbox', 
          checked: localStorage.getItem('kg_webdav_autosync') === '1',
          onChange: (e) => {
            localStorage.setItem('kg_webdav_autosync', e.target.checked ? '1' : '0');
            toastSuccess(e.target.checked ? '已开启自动同步' : '已关闭自动同步');
          }
        }),
        el('span', { text: '开启后台自动同步（仅在应用关闭/切换时上传）' })
      ]),

      el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        el('button', { class: 'btn btn-ghost btn-sm', text: '保存配置', onClick: () => {
          const url = document.getElementById('dav-url').value.trim();
          const user = document.getElementById('dav-user').value.trim();
          const pass = document.getElementById('dav-pass').value.trim();
          localStorage.setItem('kg_webdav_settings', JSON.stringify({ url, user, pass }));
          toastSuccess('配置已保存');
        } }),
        el('button', { class: 'btn btn-primary btn-sm', text: '⬆️ 上传备份', onClick: () => syncWebDAV('upload') }),
        el('button', { class: 'btn btn-danger btn-sm', text: '⬇️ 下载覆盖', onClick: () => syncWebDAV('download') }),
         // 👇 新增：安全恢复按钮
        el('button', { 
          class: 'btn btn-ghost btn-sm', 
          text: '🛡️ 恢复安全快照', 
          style: { color: 'var(--primary-dark)' },
          onClick: () => {
            const safety = localStorage.getItem('kg_sync_safety_backup');
            if (!safety) { toastError('没有找到可用的安全快照'); return; }
            if (!confirm('⚠️ 确定要恢复到上次上传前的状态吗？')) return;
            
            const data = JSON.parse(safety);
            localStorage.setItem('kg_tasks', data.kg_tasks);
            localStorage.setItem('kg_chapters', data.kg_chapters);
            localStorage.setItem('kg_points', data.kg_points);
            toastSuccess('已恢复，即将刷新页面...');
            setTimeout(() => window.location.reload(), 1000);
          }
        }),
      ])
    ])
  ]));
  // ================= ☝️ 云同步面板结束 =================
}

// ============ WebDAV 同步核心逻辑（安全加强版） ============
async function syncWebDAV(action) {
  const settings = JSON.parse(localStorage.getItem('kg_webdav_settings') || '{}');
  if (!settings.url || !settings.user || !settings.pass) {
    toastError('请先填写并保存 WebDAV 账号信息');
    return;
  }

  const auth = 'Basic ' + btoa(`${settings.user}:${settings.pass}`);
  const baseUrl = settings.url.endsWith('/') ? settings.url : settings.url + '/';
  const fileName = '资料复习系统_云端备份.json';
  const fileUrl = baseUrl + fileName;

  if (action === 'upload') {
    toastSuccess('正在打包并上传云端...');
    try {
      // 👇 核心防护 1：在上传前，先在本地备份一份当前的状态
      const currentBackup = {
        kg_tasks: localStorage.getItem('kg_tasks') || '[]',
        kg_chapters: localStorage.getItem('kg_chapters') || '[]',
        kg_points: localStorage.getItem('kg_points') || '[]',
      };
      localStorage.setItem('kg_sync_safety_backup', JSON.stringify(currentBackup));

      const backupData = {
        version: 1,
        timestamp: Date.now(),
        data: {
          kg_tasks: JSON.parse(localStorage.getItem('kg_tasks') || '[]'),
          kg_chapters: JSON.parse(localStorage.getItem('kg_chapters') || '[]'),
          kg_points: JSON.parse(localStorage.getItem('kg_points') || '[]'),
          kg_inbox: JSON.parse(localStorage.getItem('kg_inbox') || '[]'),
          kg_settings: JSON.parse(localStorage.getItem('kg_settings') || '{}'),
        }
      };

      const res = await fetch(fileUrl, {
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json;charset=utf-8'
        },
        body: JSON.stringify(backupData, null, 2)
      });

      if (res.ok || res.status === 201 || res.status === 204) {
        toastSuccess('✅ 云同步成功！');
      } else {
        toastError(`上传失败，状态码: ${res.status}。请检查账号或目录权限。`);
      }
    } catch (err) {
      console.error(err);
      toastError('上传失败，可能是跨域(CORS)限制或网络断开。');
    }
  } 
  
  else if (action === 'download') {
    toastSuccess('正在获取云端信息...');
    try {
      // 👇 核心防护 2：先查再覆盖
      const res = await fetch(fileUrl, {
        method: 'GET',
        headers: { 'Authorization': auth }
      });

      if (res.ok) {
        const backupData = await res.json();
        if (!backupData.data || !backupData.data.kg_tasks) {
          toastError('云端数据格式错误');
          return;
        }

        // 弹窗比对时间
        const cloudTime = new Date(backupData.timestamp || Date.now()).toLocaleString();
        const localPointCount = JSON.parse(localStorage.getItem('kg_points') || '[]').length;
        const cloudPointCount = backupData.data.kg_points.length;

        if (!confirm(`⚠️ 发现云端备份：\n时间：${cloudTime}\n云端知识点：${cloudPointCount} 个\n本地知识点：${localPointCount} 个\n\n确定要覆盖本地数据吗？（此操作不可逆）`)) {
          return;
        }

        // 执行覆盖
        localStorage.setItem('kg_tasks', JSON.stringify(backupData.data.kg_tasks));
        localStorage.setItem('kg_chapters', JSON.stringify(backupData.data.kg_chapters));
        localStorage.setItem('kg_points', JSON.stringify(backupData.data.kg_points));
        localStorage.setItem('kg_inbox', JSON.stringify(backupData.data.kg_inbox || []));
        localStorage.setItem('kg_settings', JSON.stringify(backupData.data.kg_settings || {}));

        toastSuccess('✅ 云端数据已覆盖本地，即将刷新页面...');
        setTimeout(() => window.location.reload(), 1500);
      } else if (res.status === 404) {
        toastError('云端暂无备份文件，请先点击上传。');
      } else {
        toastError(`下载失败，状态码: ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      toastError('下载失败，可能是跨域(CORS)限制或网络断开。');
    }
  }
}

// ============ 导出弹窗（修复版） ============
export function openExportModal(defaultTaskId = null, defaultChapterId = null) {
  let currentFormat = 'pdf';
  let onlyError = false;
  let includeImagesInDoc = false;
  let imageExportVersion = 'all'; // 👈 新增：图片导出版本

  const selectedModules = new Set(MODULES.map(m => m.key));
  const selectedTaskIds = new Set(defaultTaskId ? [defaultTaskId] : []);
  const selectedChapterIds = new Set(defaultChapterId ? [defaultChapterId] : []);

  const tasks = store.getTasks();
  const taskListEl = el('div', { style: { maxHeight: '200px', overflowY: 'auto' } });
  const imgCheckboxWrap = el('label', { style: { display: 'none', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '12px', padding: '8px', background: 'rgba(142,202,230,.08)', borderRadius: '6px' } }, [
    el('input', { type: 'checkbox', checked: includeImagesInDoc, onChange: (e) => { includeImagesInDoc = e.target.checked; } }),
    el('span', { text: '📸 在文档中嵌入解释图片', style: { color: 'var(--primary-dark)', fontWeight: '600' } })
  ]);

  const sizeWarningEl = el('div', { style: { display: 'none', fontSize: '12px', color: 'var(--danger)', marginTop: '8px', fontWeight: 'bold' } });

  // 导出提示框变量
  const exportTip = el('div', {
    style: {
      display: 'none', padding: '10px', marginBottom: '12px', background: 'rgba(142, 202, 230, 0.15)',
      border: '1px solid var(--primary)', borderRadius: '8px', fontSize: '13px', color: 'var(--primary-dark)', lineHeight: '1.5'
    }
  });
  imgCheckboxWrap.appendChild(sizeWarningEl);

  // 选择导出图片的版本
  const imgVersionWrap = el('div', { style: { display: 'none', marginBottom: '16px', padding: '10px', background: 'var(--bg)', borderRadius: '8px' } }, [
    el('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '8px' }, text: '图片导出格式' }),
    el('div', { style: { display: 'flex', gap: '12px' } }, [
      ...[
        { val: 'all', label: '全部保留 (原图+标注)' },
        { val: 'annotated', label: '仅带笔迹的图' },
        { val: 'original', label: '仅原图' }
      ].map(opt => el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' } }, [
        el('input', {
          type: 'radio', name: 'imgVersion', value: opt.val, checked: imageExportVersion === opt.val,
          onChange: () => { imageExportVersion = opt.val; }
        }),
        el('span', { text: opt.label })
      ]))
    ])
  ]);

  async function checkStorageSize() {
    if (!selectedModules.has('images')) {
      sizeWarningEl.style.display = 'none';
      return;
    }
    try {
      // 简单估算：遍历所有选中的知识点图片
      let totalSize = 0;
      for (const p of store.getAllPoints()) {
        for (const id of (p.imageIds || [])) {
          const rec = await dbGet('images', id);
          if (rec && rec.originalBlob) totalSize += rec.originalBlob.size;
        }
      }
      const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
      if (sizeMB > 50) {
        sizeWarningEl.textContent = `⚠️ 包含图片体积约 ${sizeMB} MB，建议在电脑端操作以防卡顿。`;
        sizeWarningEl.style.display = 'block';
      } else {
        sizeWarningEl.style.display = 'none';
      }
    } catch (e) { console.warn('容量计算失败', e); }
  }

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
    const isDoc = ['pdf', 'html', 'docx'].includes(currentFormat);

    imgCheckboxWrap.style.display = isDoc ? 'flex' : 'none';
    imgVersionWrap.style.display = (isZip && selectedModules.has('images')) ? 'block' : 'none';

    MODULES.forEach(m => {
      const cb = moduleCheckboxes[m.key];
      if (!cb) return;
      if (!isZip && (m.key === 'images' || m.key === 'pdfs' || m.key === 'kg_settings' || m.key === 'kg_inbox')) {
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
    checkStorageSize();

    // 👇 动态更新导出提示文字
    if (currentFormat === 'zip') {
      const hasImg = selectedModules.has('images');
      const hasPdf = selectedModules.has('pdfs');
      let fileTypes = [];
      if (hasImg) fileTypes.push('🖼️ 图片 (含原图/笔迹)');
      if (hasPdf) fileTypes.push('📁 PDF 文档');

      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>ZIP 完整包</b> 将包含：<br>` +
        `• <b>数据</b>：任务、章节、知识点及复习进度<br>` +
        (fileTypes.length > 0 ? `• <b>附件</b>：${fileTypes.join('、')}<br>` : '') +
        `• <b>打印版</b>：一份排版精美的 HTML 复习书`;
    } else if (currentFormat === 'json') {
      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>JSON 数据</b> 仅包含纯文本结构与复习进度，<b>不包含图片和 PDF</b>。适用于轻量备份。`;
    } else if (currentFormat === 'markdown') {
      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>Markdown</b> 将按章节生成带文字的 .md 文件，<b>不包含图片和 PDF</b>。适合导入 Obsidian 等软件。`;
    } else if (currentFormat === 'txt') {
      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>纯文本 TXT</b> 仅包含文字内容，没有任何格式和图片。`;
    } else if (currentFormat === 'html') {
      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>网页 HTML</b> 将生成单文件网页，<b>包含所有嵌入的图片</b>。可直接在浏览器阅读或打印为 PDF。`;
    } else if (currentFormat === 'docx') {
      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>Word 文档</b> 将生成可编辑的 .docx 文件，<b>包含所有文字和图片</b>。适合在电脑上二次编辑。`;
    } else if (currentFormat === 'pdf') {
      exportTip.style.display = 'block';
      exportTip.innerHTML = `💡 <b>打印 PDF</b> 将唤起系统打印窗口。保存后即为带图 PDF，图片独占一页，中文完全清晰。`;
    } else {
      exportTip.style.display = 'none';
    }
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

      // 提示语
      el('div', {
        style: { margin: '0 12px 12px', padding: '10px', background: 'rgba(255, 209, 102, 0.15)', border: '1px solid rgba(255, 209, 102, 0.5)', borderRadius: '8px', fontSize: '12px', color: '#B47D00', lineHeight: '1.5' }
      }, [
        el('strong', { text: '💡 提示：' }),
        el('span', { text: '如果需要更好适配该网页排版等，请务必选择「ZIP 完整包」，并勾选「图片」与「PDF」。' }),
        el('br'),
        el('span', { text: '其他格式（如 JSON/TXT）仅包含文字，导入后将无法还原图片和 PDF。' })
      ]),

      // 👇 只有一个滚动容器（删掉了重复的那个）
      el('div', {
        style: { flex: '1', overflowY: 'auto', padding: '4px 12px 4px 4px', display: 'flex', flexDirection: 'column', gap: '16px' }
      }, [


        // 1. 格式
        el('div', { class: 'section', style: { border: '1px solid rgba(0,0,0,.1)', boxShadow: 'none', flexShrink: '0' } }, [
          el('div', { class: 'section-body', style: { padding: '12px' } }, [
            exportTip, // 👈 动态提示框插在这里
            el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px' }, text: '1. 导出格式' }),
            el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' } },
              [
                ['zip', '📦 ZIP 完整包'], ['json', '📄 JSON 数据'], ['markdown', '📝 Markdown'],
                ['txt', '📑 纯文本 TXT'], ['html', '🌐 网页 HTML'], ['pdf', '🖨️ 打印 PDF'],
                ['docx', '📝 Word 文档 (.docx)'] // 👈 新增 Word 格式
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
          imgVersionWrap,

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
            // 直接从界面上抓取选中的 radio，并赋值给 currentFormat
            const checkedRadio = document.querySelector('input[name="exportFmt"]:checked');
            if (checkedRadio) {
              currentFormat = checkedRadio.value;
            }

            if (currentFormat === 'zip' && selectedModules.size === 0) { toastError('至少选择一个模块'); return; }
            mask.remove();
            doExport(
              currentFormat, // 👈 这里传的一定是最新的
              Array.from(selectedModules),
              Array.from(selectedTaskIds),
              Array.from(selectedChapterIds),
              onlyError,
              includeImagesInDoc,
              imageExportVersion
            );
          }
        })
      ])
    ])
  ]);
  document.body.appendChild(mask);
  updateModuleStatus();
}

async function doExport(exportType, keysToExport, targetTaskIds, targetChapterIds, onlyError, includeImagesInDoc, imageExportVersion = 'all') {
  toastSuccess('正在生成数据…');

  try {
    const hasScope = targetTaskIds.length > 0 || targetChapterIds.length > 0;

    let exportTasks = [];
    let exportChapters = [];
    let exportPoints = [];

    const allTasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]');
    const allChapters = JSON.parse(localStorage.getItem('kg_chapters') || '[]');
    const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');

    let taskIdsToExport = new Set(targetTaskIds);
    let chapterIdsToExport = new Set(targetChapterIds);

    if (hasScope) {
      targetChapterIds.forEach(cid => {
        const ch = allChapters.find(c => c.id === cid);
        if (ch) taskIdsToExport.add(ch.taskId);
      });
      targetTaskIds.forEach(tid => {
        allChapters.filter(c => c.taskId === tid).forEach(c => chapterIdsToExport.add(c.id));
      });
    }

    if (keysToExport.includes('kg_tasks') || hasScope) {
      exportTasks = hasScope ? allTasks.filter(t => taskIdsToExport.has(t.id)) : allTasks;
    }
    if (keysToExport.includes('kg_chapters') || hasScope) {
      exportChapters = hasScope ? allChapters.filter(c => chapterIdsToExport.has(c.id)) : allChapters;
    }
    if (keysToExport.includes('kg_points') || exportType !== 'zip') {
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

    // 智能命名（放在最前面供全函数使用）
    let fileNamePrefix = '全量复习';
    if (exportTasks.length === 1 && exportChapters.length === 0) fileNamePrefix = exportTasks[0].name;
    else if (exportChapters.length === 1) fileNamePrefix = exportChapters[0].name;
    else if (exportTasks.length === 1) fileNamePrefix = exportTasks[0].name;

    // ================= 1. JSON =================
    if (exportType === 'json') {
      const data = { tasks: exportTasks, chapters: exportChapters, points: exportPoints };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
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
      const blob = new Blob(['\uFEFF' + content], { type: 'text/markdown;charset=utf-8' });
      downloadBlob(blob, `资料复习_${new Date().toISOString().slice(0, 10)}.md`);
      return;
    }

    // ================= 3. TXT / Anki =================
    if (exportType === 'txt' || exportType === 'anki') {
      let content = '';
      if (exportType === 'anki') {
        exportTasks.forEach(t => {
          const chs = exportChapters.filter(c => c.taskId === t.id);
          chs.forEach(c => {
            const pts = exportPoints.filter(p => p.chapterId === c.id);
            pts.forEach(p => {
              const front = p.content.replace(/\n/g, '<br>');
              const back = (p.explanation || '无解释').replace(/\n/g, '<br>');
              content += `${front}\t${back}\n`;
            });
          });
        });
      } else {
        content += `资料复习导出\n生成时间：${new Date().toLocaleString()}\n\n`;
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
      }
      const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `资料复习_${exportType === 'anki' ? 'Anki卡片_' : ''}${new Date().toISOString().slice(0, 10)}.txt`);
      return;
    }

    // ================= 4 & 5. HTML & PDF & Word =================
    if (exportType === 'html' || exportType === 'pdf' || exportType === 'docx') {
      // 构造带图片的打印版 HTML
      const htmlContent = await buildPrintHTML(exportTasks, exportChapters, exportPoints, fileNamePrefix);

      if (exportType === 'html' || exportType === 'docx') {
        // HTML 和 Word 本质都是基于 HTML 扩展名不同，使用 Blob 下载
        const ext = exportType === 'html' ? '.html' : '.doc';
        const mime = exportType === 'html' ? 'text/html;charset=utf-8' : 'application/msword;charset=utf-8';
        const docHtml = exportType === 'docx'
          ? `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${fileNamePrefix}</title><style>body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; line-height: 1.6; } img { max-width: 100%; }</style></head><body>${htmlContent}</body></html>`
          : htmlContent;
        const blob = new Blob(['\uFEFF' + docHtml], { type: mime });
        downloadBlob(blob, `资料复习_${new Date().toISOString().slice(0, 10)}${ext}`);
      }
      else if (exportType === 'pdf') {
        toastSuccess('正在生成 PDF，请在弹出的打印窗口中选择“另存为 PDF”');

        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0';
        iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open(); doc.write(htmlContent); doc.close();

        // 等图片加载完唤起打印
        let attempts = 0;
        const triggerPrint = () => {
          const imgs = doc.images;
          let allLoaded = true;
          for (let i = 0; i < imgs.length; i++) {
            if (!imgs[i].complete) { allLoaded = false; break; }
          }
          if (allLoaded || attempts > 50) {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 2000);
          } else {
            attempts++; setTimeout(triggerPrint, 100);
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
    const pdfIds = new Set();
    const imagesMap = {};
    const pdfsMap = {};

    if (keysToExport.includes('images') || keysToExport.includes('pdfs')) {
      exportPoints.forEach(p => {
        (p.imageIds || []).forEach(id => imgIds.add(id));
        (p.compositeImageIds || []).forEach(id => imgIds.add(id));
        (p.pdfFiles || []).forEach(pdf => pdfIds.add(pdf.id));
      });
    }

    const imgFolder = zip.folder('images');
    const pdfFolder = zip.folder('pdfs');
    let finalImgCount = 0;
    let finalPdfCount = 0;

    if (keysToExport.includes('images') && imgIds.size > 0) {
      for (const id of imgIds) {
        try {
          const rec = await dbGet('images', id);
          if (!rec) continue;
          if (rec.type === 'pdf_placeholder' && rec.pdfId) {
            pdfIds.add(rec.pdfId);
            continue;
          }
          let baseName = rec.name ? rec.name.replace(/\.[^.]+$/, '') : `图片_${id.slice(0, 6)}`;
          let fileName = `${baseName}_${id.slice(0, 4)}`;
          imagesMap[id] = {
            width: rec.width || 0, height: rec.height || 0,
            source: rec.source || 'unknown', createdAt: rec.createdAt || new Date().toISOString(),
            name: rec.name || ''
          };
          const { originalBlob, annotatedBlob } = rec;
          if (imageExportVersion === 'all') {
            if (originalBlob) imgFolder.file(`${fileName}_original.png`, originalBlob);
            if (annotatedBlob) imgFolder.file(`${fileName}_annotated.png`, annotatedBlob);
          } else if (imageExportVersion === 'annotated') {
            if (annotatedBlob || originalBlob) imgFolder.file(`${fileName}_annotated.png`, annotatedBlob || originalBlob);
          } else if (imageExportVersion === 'original') {
            if (originalBlob || annotatedBlob) imgFolder.file(`${fileName}_original.png`, originalBlob || annotatedBlob);
          }
          finalImgCount++;
        } catch (e) { console.warn('跳过损坏图片', id); }
      }
    }

    if (keysToExport.includes('pdfs') && pdfIds.size > 0) {
      for (const pdfId of pdfIds) {
        try {
          const rec = await dbGet('pdfs', pdfId);
          if (!rec || !rec.blob) continue;
          let baseName = rec.name ? rec.name.replace(/\.pdf$/i, '') : `文档_${pdfId.slice(0, 6)}`;
          let fileName = `${baseName}_${pdfId.slice(0, 4)}.pdf`;
          pdfsMap[pdfId] = { name: rec.name || '未命名.pdf', createdAt: rec.createdAt || new Date().toISOString() };
          pdfFolder.file(fileName, rec.blob);
          finalPdfCount++;
        } catch (e) { console.warn('跳过损坏PDF', pdfId); }
      }
    }

    const meta = {
      version: 8, exportedAt: new Date().toISOString(), modules: keysToExport,
      stats: { images: finalImgCount, pdfs: finalPdfCount }, localData, imagesMap, pdfsMap
    };
    zip.file('meta.json', JSON.stringify(meta, null, 2));

    // 内嵌 HTML 打印版
    if (keysToExport.includes('kg_points')) {
      const htmlContent = await buildPrintHTML(exportTasks, exportChapters, exportPoints, fileNamePrefix);
      zip.file(`${fileNamePrefix}_复习打印版.html`, htmlContent);

      // 👇 因为纯前端直接生成中文 PDF 必乱码，ZIP 里只放排版完美的 HTML。
      // 提示用户：想要 PDF 直接打开这个 HTML 按 Ctrl+P 存为 PDF 即可。
      console.log('ZIP 中已包含排版完美的复习打印版 HTML');
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `资料复习全量包_${new Date().toISOString().slice(0, 10)}.zip`);

  } catch (err) {
    console.error('导出详细错误:', err);
    toastError('导出失败: ' + (err.message || '未知错误'));
    alert('导出失败详情：\n' + err.stack);
  }
}

// ============ 抽离的公共函数：生成打印版 HTML ============
// ============ 抽离的公共函数：生成打印版 HTML ============
async function buildPrintHTML(exportTasks, exportChapters, exportPoints, fileNamePrefix) {
  let htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileNamePrefix} - 打印版</title><style>
    body { font-family: 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif; line-height: 1.6; color: #000; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
    h2 { border-bottom: 2px solid #8ECAE6; padding-bottom: 4px; margin-top: 30px; page-break-after: avoid; }
    h3 { color: #333; margin-top: 20px; page-break-after: avoid; }
    
    /* 知识点卡片：把所有内容包在一起 */
    .point { margin-bottom: 24px; padding: 12px; border: 1px solid #eee; border-left: 4px solid #FFD166; border-radius: 6px; page-break-inside: avoid; background: #fff; }
    .point-title { font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #333; }
    .explanation { color: #333; font-size: 14px; margin-bottom: 12px; background: #f9f9f9; padding: 8px; border-radius: 4px; }
    
    /* 附件相册网格 */
    .attachment-gallery { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
    .attachment-item { flex: 0 0 auto; max-width: 100%; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; background: #fff; }
    .attachment-title { font-size: 12px; color: #555; text-align: center; padding: 4px; background: #f0f0f0; border-bottom: 1px solid #ddd; }
    .attachment-item img { max-width: 100%; max-height: 300px; object-fit: contain; display: block; }
    
    @media print { body { padding: 0; max-width: 100%; } }
  </style></head><body>\n`;

  htmlContent += `<h1>${fileNamePrefix} - 复习资料</h1>\n`;

  for (const t of exportTasks) {
    const chs = exportChapters.filter(c => c.taskId === t.id);
    if (chs.length === 0) continue;
    htmlContent += `<h2>📚 ${t.name}</h2>\n`;

    for (const c of chs) {
      const pts = exportPoints.filter(p => p.chapterId === c.id);
      if (pts.length === 0) continue;
      htmlContent += `<h3>📖 ${c.name}</h3>\n`;

      for (const p of pts) {
        // 1. 先渲染知识点卡片外壳和标题
        htmlContent += `<div class="point">`;
        htmlContent += `<div class="point-title">${p.content}</div>`;
        
        // 2. 渲染解释
        if (p.explanation) {
          htmlContent += `<div class="explanation">${p.explanation.replace(/\n/g, '<br>')}</div>`;
        }

        // 3. 收集并渲染所有图片/PDF
        const allImageIds = [...(p.imageIds || []), ...(p.compositeImageIds || [])];
        if (allImageIds.length > 0) {
          htmlContent += `<div class="attachment-gallery">`;
          
          for (const imgId of allImageIds) {
            const rec = await dbGet('images', imgId);
            if (!rec) continue;

            if (rec.type === 'pdf_placeholder' && rec.pdfId) {
              const pdfRec = await dbGet('pdfs', rec.pdfId);
              if (pdfRec && pdfRec.blob) {
                try {
                  const buf = await pdfRec.blob.arrayBuffer();
                  const pdfjs = await window.pdfjsLib.getDocument({ data: buf }).promise;
                  const page = await pdfjs.getPage(1);
                  const vp = page.getViewport({ scale: 1.0 });
                  const canvas = document.createElement('canvas');
                  canvas.width = vp.width; canvas.height = vp.height;
                  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
                  const base64 = canvas.toDataURL('image/jpeg', 0.85);
                  
                  htmlContent += `<div class="attachment-item">
                    <div class="attachment-title">📄 ${rec.pdfName || 'PDF'}</div>
                    <img src="${base64}">
                  </div>`;
                } catch (e) { console.warn('PDF转图失败', e); }
              }
            } else if (rec.annotatedBlob || rec.originalBlob) {
              const blob = rec.annotatedBlob || rec.originalBlob;
              const base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
              
              htmlContent += `<div class="attachment-item">
                <div class="attachment-title">🖼 图片</div>
                <img src="${base64}">
              </div>`;
            }
          }
          
          htmlContent += `</div>`; // 闭合相册容器
        }
        
        htmlContent += `</div>\n`; // 闭合知识点卡片
      }
    }
  }
  htmlContent += `</body></html>`;
  return htmlContent;
}

// ============ 统一下载封装 ============
async function downloadBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const ext = filename.split('.').pop().toLowerCase();
      let acceptType = 'application/octet-stream';
      if (ext === 'json') acceptType = 'application/json';
      if (ext === 'md') acceptType = 'text/markdown';
      if (ext === 'txt') acceptType = 'text/plain';
      if (ext === 'html') acceptType = 'text/html';
      if (ext === 'zip') acceptType = 'application/zip';
      if (ext === 'pdf') acceptType = 'application/pdf';

      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: '导出文件', accept: { [acceptType]: ['.' + ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toastSuccess('文件已保存');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename; // 👈 这里绝对忠实于传入的文件名，不会乱改后缀
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
  toastSuccess('已开始下载');
}

// ============ 导入弹窗 ============
export function openImportModal() {
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 9999 } }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '480px', textAlign: 'center' } }, [
      el('h3', { text: '📥 导入数据' }),

      // 导入提示
      el('div', {
        style: { margin: '0 0 16px', padding: '10px', background: 'rgba(142, 202, 230, 0.1)', border: '1px solid rgba(142, 202, 230, 0.3)', borderRadius: '8px', fontSize: '12px', color: 'var(--primary-dark)', lineHeight: '1.5', textAlign: 'left' }
      }, [
        el('strong', { text: '💡 提示：' }),
        el('span', { text: '为了100%还原所有文字、图片和PDF，请上传由本系统导出的 .zip 包。' }),
        el('br'),
        el('span', { text: '如果导入 .md / .txt / .pdf 等外部文件，系统会尝试提取文字，但无法还原图片。' })
      ]),

      el('div', {
        id: 'drop-zone',
        style: { border: '2px dashed var(--primary)', borderRadius: '12px', padding: '40px 20px', background: 'rgba(142,202,230,0.05)', cursor: 'pointer', transition: 'all 0.2s', marginBottom: '20px' },
        onDragover: (e) => { e.preventDefault(); e.target.style.background = 'rgba(142,202,230,0.15)'; },
        onDragleave: (e) => { e.preventDefault(); e.target.style.background = 'rgba(142,202,230,0.05)'; },
        onDrop: (e) => {
          e.preventDefault();
          e.target.style.background = 'rgba(142,202,230,0.05)';
          const file = e.dataTransfer.files[0];
          if (file) doImportFile(file, mask);
        },
        onClick: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.zip,.json,.md,.txt,.html,.pdf';
          input.onchange = (e) => { if (e.target.files[0]) doImportFile(e.target.files[0], mask); };
          input.click();
        }
      }, [
        el('div', { style: { fontSize: '32px', marginBottom: '8px' }, text: '📁' }),
        el('div', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '点击选择或拖拽文件到此处' }),
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

    // 识别可用模块
    const availableModules = MODULES.filter(m => {
      if (m.key === 'images') return Object.keys(meta.imagesMap || {}).length > 0;
      if (m.key === 'pdfs') return Object.keys(meta.pdfsMap || {}).length > 0;
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
        el('div', { style: { fontSize: '12px', color: 'var(--primary-dark)', background: 'rgba(142,202,230,.1)', padding: '8px', borderRadius: '6px', marginBottom: '16px' } }, '✨ 安全合并模式：不会覆盖旧数据，同名内容会自动加上序号。'),
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
  toastSuccess('正在安全合并数据…');
  try {
    // 1. 取出当前所有的本地数据
    const currentTasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]');
    const currentChapters = JSON.parse(localStorage.getItem('kg_chapters') || '[]');
    const currentPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');

    const taskIdMap = {};
    const chapterIdMap = {};

    // ============ 工具函数：智能生成不重复的名字 ============
    function getUniqueName(baseName, existingNames, suffix = '(副本)') {
      if (!existingNames.includes(baseName)) return baseName;
      let counter = 1;
      let newName = `${baseName}${suffix}${counter}`;
      while (existingNames.includes(newName)) {
        counter++;
        newName = `${baseName}${suffix}${counter}`;
      }
      return newName;
    }

    // 兜底任务
    function getFallbackTask() {
      let t = currentTasks.find(x => x.name === '未分类导入的任务' && !x.deletedAt);
      if (!t) {
        t = { id: crypto.randomUUID(), name: '未分类导入的任务', order: currentTasks.length, createdAt: new Date().toISOString() };
        currentTasks.push(t);
      }
      return t;
    }

    // 兜底章节
    function getFallbackChapter() {
      let task = getFallbackTask();
      let c = currentChapters.find(x => x.taskId === task.id && x.name === '未分类导入的章节' && !x.deletedAt);
      if (!c) {
        c = { id: crypto.randomUUID(), taskId: task.id, name: '未分类导入的章节', order: 0, createdAt: new Date().toISOString() };
        currentChapters.push(c);
      }
      return c;
    }

    // ============ 2. 处理任务（查重） ============
    const importTasks = meta.localData?.kg_tasks || [];
    for (const t of importTasks) {
      // 收集现有的所有任务名
      const existingTaskNames = currentTasks.map(x => x.name);
      const uniqueName = getUniqueName(t.name, existingTaskNames);

      // 检查是否已经存在（如果同一个包多次导入，名字会被改掉，所以必然作为新任务存入）
      const newId = crypto.randomUUID();
      taskIdMap[t.id] = newId;
      currentTasks.push({ ...t, id: newId, name: uniqueName });
    }

    // ============ 3. 处理章节（查重） ============
    const importChapters = meta.localData?.kg_chapters || [];
    for (const c of importChapters) {
      const mappedTaskId = taskIdMap[c.taskId];
      const finalTaskId = mappedTaskId || getFallbackTask().id;

      // 收集当前任务下的所有章节名
      const existingChNames = currentChapters.filter(x => x.taskId === finalTaskId).map(x => x.name);
      const uniqueName = getUniqueName(c.name, existingChNames);

      const newId = crypto.randomUUID();
      chapterIdMap[c.id] = newId;
      currentChapters.push({ ...c, id: newId, taskId: finalTaskId, name: uniqueName });
    }

    // ============ 4. 处理知识点（查重） ============
    const importPoints = meta.localData?.kg_points || [];
    for (const p of importPoints) {
      const mappedChapterId = chapterIdMap[p.chapterId];
      const finalChapterId = mappedChapterId || getFallbackChapter().id;

      // 收集当前章节下的所有知识点内容
      const existingContents = currentPoints.filter(x => x.chapterId === finalChapterId).map(x => x.content);

      let finalContent = p.content;
      if (existingContents.includes(finalContent)) {
        // 如果内容重复，在末尾加上 (导入1), (导入2)
        let counter = 1;
        while (existingContents.includes(`${p.content} (导入${counter})`)) {
          counter++;
        }
        finalContent = `${p.content} (导入${counter})`;
      }

      currentPoints.push({ ...p, id: crypto.randomUUID(), chapterId: finalChapterId, content: finalContent });
    }

    // ============ 5. 处理图片、PDF ============
    if (selectedModules.includes('images')) {
      const imgFolder = zip.folder('images');
      if (imgFolder) {
        const imgFiles = [];
        imgFolder.forEach((path, f) => { if (!f.dir) imgFiles.push(f); });
        const groupedImages = {};
        imgFiles.forEach(f => {
          const match = f.name.match(/(.+)_([a-zA-Z0-9]{4})_(original|annotated)\.png$/);
          if (match) {
            const id = match[2];
            if (!groupedImages[id]) groupedImages[id] = {};
            groupedImages[id][match[3]] = f;
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
            name: imgMeta.name || `导入图片_${id.slice(0, 4)}`,
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

    if (selectedModules.includes('pdfs') || selectedModules.includes('images')) {
      const pdfFolder = zip.folder('pdfs');
      if (pdfFolder) {
        const pdfFiles = [];
        pdfFolder.forEach((path, f) => { if (!f.dir) pdfFiles.push(f); });

        const { dbAll } = await import('../db.js');
        const existingPdfs = await dbAll('pdfs');
        const existingNames = existingPdfs.map(p => p.name);

        for (const file of pdfFiles) {
          const match = file.name.match(/_([a-zA-Z0-9]{4})\.pdf$/);
          if (!match) continue;
          const pdfId = match[1];

          const pdfBlob = await file.async('blob');
          const pdfMeta = meta.pdfsMap[pdfId] || {};

          // 查重 PDF 名字
          let finalName = pdfMeta.name || '导入的文档.pdf';
          if (existingNames.includes(finalName)) {
            const extIdx = finalName.lastIndexOf('.');
            const base = extIdx > -1 ? finalName.slice(0, extIdx) : finalName;
            const ext = extIdx > -1 ? finalName.slice(extIdx) : '.pdf';
            let counter = 1;
            while (existingNames.includes(`${base}(${counter})${ext}`)) { counter++; }
            finalName = `${base}(${counter})${ext}`;
          }
          existingNames.push(finalName);

          await dbPut('pdfs', {
            id: pdfId,
            blob: pdfBlob,
            name: finalName,
            createdAt: pdfMeta.createdAt || new Date().toISOString()
          });
        }
      }
    }

    // ============ 6. 保存 ============
    localStorage.setItem('kg_tasks', JSON.stringify(currentTasks));
    localStorage.setItem('kg_chapters', JSON.stringify(currentChapters));
    localStorage.setItem('kg_points', JSON.stringify(currentPoints));

    toastSuccess('安全合并成功！1秒后刷新…');
    setTimeout(() => window.location.reload(), 1000);

  } catch (err) {
    console.error(err);
    toastError('恢复失败：' + err.message);
  }
}

async function doImportFile(file, mask) {
  const ext = file.name.split('.').pop().toLowerCase();
  mask.remove();

  if (ext === 'zip') {
    // 👉 走原有 ZIP 恢复逻辑
    doImportParse(file, el('div'));
  }
  else if (ext === 'json') {
    toastSuccess('正在解析 JSON 数据...');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // 兼容两种结构：纯数据对象，或者备份包里的 localData
      const tasks = data.tasks || data.localData?.kg_tasks || [];
      const chapters = data.chapters || data.localData?.kg_chapters || [];
      const points = data.points || data.localData?.kg_points || [];

      if (tasks.length === 0 && chapters.length === 0 && points.length === 0) {
        toastError('JSON 内未找到有效知识点数据'); return;
      }

      // 导入逻辑（按 ID 合并）
      mergeImportedData(tasks, chapters, points);
    } catch (e) { toastError('JSON 解析失败：' + e.message); }
  }
  else if (ext === 'md' || ext === 'txt') {
    toastSuccess('正在解析文本...');
    try {
      const text = await file.text();
      parseMarkdownOrText(text, file.name.replace(/\.[^/.]+$/, ""));
    } catch (e) { toastError('读取失败：' + e.message); }
  }
  else if (ext === 'html') {
    toastSuccess('正在解析 HTML...');
    try {
      const text = await file.text();
      parseHtml(text, file.name.replace(/\.[^/.]+$/, ""));
    } catch (e) { toastError('读取失败：' + e.message); }
  }
  else if (ext === 'pdf') {
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '340px', textAlign: 'center' } }, [
        el('h3', { text: '📄 正在解析 PDF' }),
        el('div', { id: 'pdf-import-status', style: { fontSize: '13px', color: 'var(--text-2)', margin: '16px 0' }, text: '准备中...' }),
        el('div', { style: { width: '100%', height: '8px', background: '#eee', borderRadius: '4px', overflow: 'hidden' } }, [
          el('div', { id: 'pdf-import-bar', style: { width: '0%', height: '100%', background: 'var(--primary)', transition: 'width 0.2s' } })
        ])
      ])
    ]);
    document.body.appendChild(mask);

    const statusEl = document.getElementById('pdf-import-status');
    const barEl = document.getElementById('pdf-import-bar');

    try {
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      const total = pdf.numPages;

      let fullText = '';
      const pageImages = []; // 👈 存储每一页的截图

      for (let i = 1; i <= total; i++) {
        statusEl.textContent = `正在读取第 ${i} / ${total} 页...`;
        barEl.style.width = `${Math.round((i / total) * 100)}%`;

        const page = await pdf.getPage(i);

        // 1. 渲染整页为高清图片并存库
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

        const imgBlob = await new Promise(r => c.toBlob(r, 'image/png'));
        const imgId = crypto.randomUUID();
        await dbPut('images', {
          id: imgId, originalBlob: imgBlob, annotatedBlob: imgBlob,
          width: c.width, height: c.height, dpr: 2, createdAt: new Date().toISOString()
        });
        pageImages.push(imgId); // 存下图片 ID 供后面绑定

        // 2. 尝试提取文字
        const content = await page.getTextContent();
        let pageText = content.items.map(item => item.str).join(' ').trim();

        // 3. 如果没文字，用 OCR 提取
        if (pageText.length < 10) {
          statusEl.textContent = `第 ${i} / ${total} 页无原生文字，正在进行 OCR 识别...`;
          const result = await window.Tesseract.recognize(imgBlob, 'chi_sim+eng', {
            logger: m => {
              if (m.status === 'recognizing text') {
                statusEl.textContent = `第 ${i} / ${total} 页 OCR 识别中... ${Math.round(m.progress * 100)}%`;
              }
            }
          });
          pageText = result.data.text.trim();
        }

        fullText += pageText + '\n\n';
      }

      mask.remove();

      if (!fullText.trim()) {
        toastError('未识别到任何有效文字');
        return;
      }

      // 👇 将识别出的文字和生成的整页截图一起传给解析器
      await parseMarkdownOrText(fullText, file.name.replace(/\.[^/.]+$/, ""), pageImages);

    } catch (e) {
      mask.remove();
      console.error(e);
      toastError('PDF 解析失败：' + e.message);
    }
  }
  else {
    toastError('不支持的文件格式');
  }
}

// 👇 智能解析纯文本 / Markdown（支持提取图片）
async function parseMarkdownOrText(text, filename, images = []) {
  const lines = text.split('\n');
  const pointsToAdd = [];
  let currentContent = '';

  lines.forEach(line => {
    line = line.trim();
    if (line.startsWith('#') || line.startsWith('===') || line.startsWith('---')) {
      if (currentContent) { pointsToAdd.push(currentContent); currentContent = ''; }
      return;
    }
    if (line === '') {
      if (currentContent) { pointsToAdd.push(currentContent); currentContent = ''; }
    } else {
      const cleanLine = line.replace(/^(\d+\.|\-|\*)\s*/, '');
      currentContent += (currentContent ? '\n' : '') + cleanLine;
    }
  });
  if (currentContent) pointsToAdd.push(currentContent);

  if (pointsToAdd.length === 0) { toastError('未找到有效文本'); return; }

  const task = store.createTask({ name: `导入_${filename}` });
  const chapter = store.createChapter({ taskId: task.id, name: '导入内容' });

  // 👇 遍历生成知识点，并分配图片
  for (let i = 0; i < pointsToAdd.length; i++) {
    const content = pointsToAdd[i].slice(0, 1000);
    const imageIds = [];

    // 如果传入了图片（针对 PDF 的整页截图，或者 HTML 里的图）
    // 这里我们做简单映射：如果图片数量等于段落数量，就一一对应；
    // 否则，如果只有一张图，就全给第一个知识点。
    if (images.length > 0) {
      if (images.length === pointsToAdd.length) {
        imageIds.push(images[i]);
      } else if (images.length === 1) {
        imageIds.push(images[0]);
      } else {
        // 多图多段落随机分配，或者按比例分配
        imageIds.push(images[Math.floor(i * images.length / pointsToAdd.length)]);
      }
    }

    store.createPoint({
      chapterId: chapter.id,
      content: content,
      imageIds: imageIds // 👈 存入图文附件
    });
  }

  toastSuccess(`成功导入 ${pointsToAdd.length} 个知识点！${images.length > 0 ? `(包含 ${images.length} 张截图)` : ''}`);
  setTimeout(() => window.location.reload(), 1000);
}

// 👇 智能解析 HTML
function parseHtml(html, filename) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  // 获取所有文本内容
  const text = doc.body.innerText || doc.body.textContent || '';
  parseMarkdownOrText(text, filename);
}

// 👇 JSON 合并逻辑
function mergeImportedData(tasks, chapters, points) {
  const existingTasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]');
  const existingChapters = JSON.parse(localStorage.getItem('kg_chapters') || '[]');
  const existingPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');

  const newTasks = tasks.filter(t => !existingTasks.some(et => et.id === t.id));
  const newChapters = chapters.filter(c => !existingChapters.some(ec => ec.id === c.id));
  const newPoints = points.filter(p => !existingPoints.some(ep => ep.id === p.id));

  localStorage.setItem('kg_tasks', JSON.stringify([...existingTasks, ...newTasks]));
  localStorage.setItem('kg_chapters', JSON.stringify([...existingChapters, ...newChapters]));
  localStorage.setItem('kg_points', JSON.stringify([...existingPoints, ...newPoints]));

  toastSuccess(`成功导入 ${newTasks.length} 任务, ${newChapters.length} 章节, ${newPoints.length} 知识点！`);
  setTimeout(() => window.location.reload(), 1000);
}

