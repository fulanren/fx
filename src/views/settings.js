import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { applyTheme, setTheme } from '../ui/theme.js';
import { exportFullBackup, importFullBackup } from './exporter.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

export function renderSettings() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '设置';
  document.getElementById('btn-back').classList.add('hidden');

  const settings = store.getSettings();

  // 主题
  const themeRow = el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '主题' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        themeBtn('跟随系统', 'system', settings.theme),
        themeBtn('亮色', 'light', settings.theme),
        themeBtn('暗色', 'dark', settings.theme),
      ]),
    ]),
  ]);
  view.appendChild(themeRow);

  // 备份
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '💾 备份与恢复' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' } },
        [`上次备份：${localStorage.getItem('kg_last_backup_at') ? new Date(localStorage.getItem('kg_last_backup_at')).toLocaleString() : '从未备份'}`]),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-primary', text: '📦 全量导出',
          onClick: async () => {
            try {
              await exportFullBackup();
              toastSuccess('已导出');
            } catch (e) { toastError('导出失败：' + e.message); }
          },
        }),
        el('button', {
          class: 'btn btn-ghost', text: '📥 导入备份',
          onClick: () => importBackupDialog(),
        }),
      ]),
    ]),
  ]));

  // 存储用量
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '存储用量' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px' } }, [
      el('div', { id: 'storage-info', style: { fontSize: '13px', color: 'var(--text-2)' }, text: '计算中…' }),
    ]),
  ]));

  // 关于
  view.appendChild(el('div', { class: 'section' }, [
    el('div', { class: 'section-head' }, [el('span', { text: '关于' })]),
    el('div', { class: 'section-body', style: { paddingTop: '12px', fontSize: '13px', color: 'var(--text-2)' } }, [
      el('div', { text: '资料复习系统 · 纯前端本地存储' }),
      el('div', { text: '数据保存在浏览器本地，请定期备份', style: { marginTop: '4px' } }),
    ]),
  ]));

  // 存储用量计算
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

  function importBackupDialog() {
    const input = el('input', { type: 'file', accept: '.zip', style: { display: 'none' } });
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const r = await confirmBox({
        title: '导入备份',
        message: '导入会合并到现有数据（按 UUID 去重）。是否继续？',
        confirmText: '合并导入',
        cancelText: '取消',
        extra: { label: '覆盖全部', value: 'overwrite' },
      });
      if (r === false) return;
      try {
        await importFullBackup(file, r === 'overwrite' ? 'overwrite' : 'merge');
        toastSuccess('导入完成，即将刷新');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        toastError('导入失败：' + err.message);
      }
    };
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  }
}