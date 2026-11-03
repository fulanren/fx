import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { setTheme } from '../ui/theme.js';
import { exportFullBackup, importFullBackup } from './exporter.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { clearImageCache } from '../db.js';

export async function renderSettings() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '设置';
  document.getElementById('btn-back').classList.remove('hidden');

  const settings = store.getSettings();

  // 主题
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '主题' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        themeBtn('跟随系统', 'system', settings.theme),
        themeBtn('亮色', 'light', settings.theme),
        themeBtn('暗色', 'dark', settings.theme),
      ]),
    ]),
  ]));

  // 备份
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '💾 备份与恢复' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } },
        [`上次备份：${localStorage.getItem('kg_last_backup_at') ? new Date(localStorage.getItem('kg_last_backup_at')).toLocaleString() : '从未备份'}`]),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-primary', text: '📦 全量导出',
          onClick: () => exportOptionsDialog(),
        }),
        el('button', {
          class: 'btn btn-ghost', text: '📥 导入备份',
          onClick: () => importBackupDialog(),
        }),
      ]),
    ]),
  ]));

  // ============ 【复习提醒】加在这里 ============
  const reminder = (await import('../ui/reminder.js')).getReminder() || { enabled: false, time: '20:00' };
  const reminderCheckbox = el('input', { type: 'checkbox', checked: reminder.enabled });
  const reminderTime = el('input', { type: 'time', value: reminder.time || '20:00', style: { width: '120px' } });

  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '⏰ 复习提醒' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { class: 'field' }, [
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
          reminderCheckbox,
          '每天固定时间提醒我复习',
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '提醒时间' }),
        reminderTime,
      ]),
      el('button', {
        class: 'btn btn-sm btn-primary', text: '保存提醒设置',
        onClick: async () => {
          const { saveReminder, requestNotificationPermission } = await import('../ui/reminder.js');
          if (reminderCheckbox.checked) {
            const ok = await requestNotificationPermission();
            if (!ok) {
              toastError('通知权限被拒绝，无法发送提醒');
              return;
            }
          }
          saveReminder({
            enabled: reminderCheckbox.checked,
            time: reminderTime.value || '20:00',
          });
          toastSuccess('提醒设置已保存');
        },
      }),
    ]),
  ]));

  // 存储用量
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '存储用量' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { id: 'storage-info', style: { fontSize: '13px', color: 'var(--text-2)' }, text: '计算中…' }),
    ]),
  ]));

  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '📄 PDF 模板' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } },
        ['下载模板，按模板整理资料，导入识别准确率更高']),
      el('button', {
        class: 'btn btn-primary', text: '📄 下载 PDF 模板',
        onClick: async () => {
          try {
            const { downloadPdfTemplate } = await import('./pdfTemplate.js');
            downloadPdfTemplate();
          } catch (e) { toastError('模板下载失败：' + e.message); }
        },
      }),
    ]),
  ]));

  // 关于
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '关于' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px', fontSize: '13px', color: 'var(--text-2)' } }, [
      el('div', { text: '考公复习系统 · 纯前端本地存储' }),
      el('div', { text: '数据保存在浏览器本地，请定期备份', style: { marginTop: '4px' } }),
    ]),
  ]));

  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(est => {
      const used = (est.usage / 1024 / 1024).toFixed(2);
      const quota = (est.quota / 1024 / 1024).toFixed(0);
      const pct = ((est.usage / est.quota) * 100).toFixed(1);
      const info = document.getElementById('storage-info');
      if (info) {
        info.textContent = `已用 ${used} MB / 共 ${quota} MB（${pct}%）`;
        if (pct > 80) info.style.color = 'var(--danger)';
      }
    });
  }

  function themeBtn(label, value, current) {
    return el('button', {
      class: `btn btn-sm ${current === value ? 'btn-primary' : 'btn-ghost'}`,
      text: label,
      onClick: () => {
        setTheme(value);
        renderSettings();
      },
    });
  }
}

// ============ 导出选项弹窗 ============
function exportOptionsDialog() {
  const options = { data: true, images: true, audios: true, tape: true, exports: true, pdf: true };

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '360px' } }, [
      el('h3', { text: '选择导出内容' }),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', margin: '16px 0' } }, [
        checkRow('数据（任务/章节/知识点）', 'data'),
        checkRow('图片', 'images'),
        checkRow('录音', 'audios'),
        checkRow('胶带和纸张', 'tape'),
        checkRow('可读文本（md/txt/html）', 'exports'),
        checkRow('PDF（每个任务的打印版）', 'pdf'),
      ]),
      el('div', { class: 'confirm-actions' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: '导出',
          onClick: async () => {
            mask.remove();
            try {
              await exportFullBackup(options);
              toastSuccess('已导出');
            } catch (e) { toastError('导出失败：' + e.message); }
          },
        }),
      ]),
    ]),
  ]);
  document.body.appendChild(mask);

  function checkRow(label, key) {
    return el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
      el('input', { type: 'checkbox', checked: options[key], onChange: (e) => { options[key] = e.target.checked; } }),
      label,
    ]);
  }
}

// ============ 导入预览弹窗 ============
function importBackupDialog() {
  const input = el('input', { type: 'file', accept: '.zip', style: { display: 'none' } });
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (!window.JSZip) throw new Error('JSZip 未加载');
      const zip = await window.JSZip.loadAsync(file);
      const dataFile = zip.file('data.json');
      if (!dataFile) throw new Error('不是有效的备份文件');
      const data = JSON.parse(await dataFile.async('string'));

      const tasks = data.tasks || [];
      const chapters = data.chapters || [];
      const points = data.points || [];
      const imgCount = Object.keys(zip.files).filter(f => f.startsWith('images/')).length;
      const audioCount = Object.keys(zip.files).filter(f => f.startsWith('audios/')).length;

      const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '420px' } }, [
          el('h3', { text: '导入预览' }),
          el('div', { style: { fontSize: '14px', lineHeight: '1.8', margin: '12px 0' } }, [
            el('div', { text: `任务：${tasks.length} 个` }),
            el('div', { text: `章节：${chapters.length} 个` }),
            el('div', { text: `知识点：${points.length} 个` }),
            el('div', { text: `图片：${imgCount} 张` }),
            el('div', { text: `录音：${audioCount} 条` }),
            el('div', { text: `导出时间：${data.exportAt ? new Date(data.exportAt).toLocaleString() : '未知'}`, style: { color: 'var(--text-2)', fontSize: '12px', marginTop: '8px' } }),
            imgCount === 0 ? el('div', {
              style: { color: 'var(--danger)', fontSize: '13px', marginTop: '8px', padding: '8px', background: 'rgba(239,71,111,.08)', borderRadius: '6px' },
              text: '⚠️ 此备份不含图片，导入后知识点里的图片会缺失。',
            }) : null,
            audioCount === 0 && (data.audioIndex || []).length > 0 ? el('div', {
              style: { color: 'var(--danger)', fontSize: '13px', marginTop: '8px', padding: '8px', background: 'rgba(239,71,111,.08)', borderRadius: '6px' },
              text: '⚠️ 此备份不含录音文件，导入后录音会无法播放。',
            }) : null,
          ]),
          el('p', { text: '选择导入方式：', style: { fontSize: '13px', color: 'var(--text-2)', marginTop: '12px' } }),
          el('div', { class: 'confirm-actions', style: { marginTop: '12px', flexWrap: 'wrap' } }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
            el('button', {
              class: 'btn btn-ghost', text: '合并导入',
              onClick: async () => {
                mask.remove();
                const progressContainer = el('div', { style: { position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', background: 'var(--card)', padding: '16px', borderRadius: '12px', boxShadow: 'var(--shadow-lg)', zIndex: '999', width: '80%', maxWidth: '400px' } }, [
                  el('div', { style: { fontWeight: '600', marginBottom: '12px' }, text: '正在导入…' }),
                  el('div', { style: { height: '6px', background: 'rgba(0,0,0,.1)', borderRadius: '3px', overflow: 'hidden' } }, [
                    el('div', { id: 'import-progress-fill', style: { height: '100%', width: '0%', background: 'var(--primary)', transition: 'width .2s' } }),
                  ]),
                  el('div', { id: 'import-progress-text', style: { fontSize: '12px', color: 'var(--text-2)', textAlign: 'center', marginTop: '8px' }, text: '准备中…' }),
                ]);
                document.body.appendChild(progressContainer);
                try {
                  const stats = await importFullBackup(file, 'merge', (done, total, label) => {
                    const pct = total > 0 ? Math.round(done / total * 100) : 0;
                    const fill = document.getElementById('import-progress-fill');
                    const text = document.getElementById('import-progress-text');
                    if (fill) fill.style.width = pct + '%';
                    if (text) text.textContent = `${label}（${done}/${total}）`;
                  });
                  clearImageCache();
                  progressContainer.remove();
                  const msg = `导入完成：任务 ${stats.tasks}，章节 ${stats.chapters}，知识点 ${stats.points}，图片 ${stats.images}，录音 ${stats.audios}`;
                  toastSuccess(msg);
                  setTimeout(() => location.reload(), 1500);
                } catch (err) {
                  progressContainer.remove();
                  toastError('导入失败：' + err.message);
                }
              },
            }),
            // 【覆盖全部】先清空现有数据，再导入
            el('button', {
              class: 'btn btn-danger', text: '覆盖全部',
              onClick: async () => {
                if (!confirm('覆盖会清空现有数据，确定吗？')) return;
                mask.remove();
                // 创建进度条容器
                const progressContainer = el('div', {
                  style: { position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', background: 'var(--card)', padding: '16px', borderRadius: '12px', boxShadow: 'var(--shadow-lg)', zIndex: '999', width: '80%', maxWidth: '400px' },
                }, [
                  el('div', { style: { fontWeight: '600', marginBottom: '12px' }, text: '正在导入…' }),
                  el('div', { style: { height: '6px', background: 'rgba(0,0,0,.1)', borderRadius: '3px', overflow: 'hidden' } }, [
                    el('div', { id: 'import-progress-fill', style: { height: '100%', width: '0%', background: 'var(--primary)', transition: 'width .2s' } }),
                  ]),
                  el('div', { id: 'import-progress-text', style: { fontSize: '12px', color: 'var(--text-2)', textAlign: 'center', marginTop: '8px' }, text: '准备中…' }),
                ]);
                document.body.appendChild(progressContainer);
                try {
                  // mode = 'overwrite'，进度回调同「合并导入」
                  const stats = await importFullBackup(file, 'overwrite', (done, total, label) => {
                    const pct = total > 0 ? Math.round(done / total * 100) : 0;
                    const fill = document.getElementById('import-progress-fill');
                    const text = document.getElementById('import-progress-text');
                    if (fill) fill.style.width = pct + '%';
                    if (text) text.textContent = `${label}（${done}/${total}）`;
                  });
                  clearImageCache();
                  progressContainer.remove();
                  toastSuccess(`覆盖导入完成：${stats.tasks} 任务，${stats.chapters} 章节，${stats.points} 知识点`);
                  setTimeout(() => location.reload(), 1500);
                } catch (err) {
                  progressContainer.remove();
                  toastError('导入失败：' + err.message);
                }
              },
            }),
          ]),
        ]),
      ]);
      document.body.appendChild(mask);
    } catch (err) {
      toastError('读取备份失败：' + err.message);
    }
  };
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}