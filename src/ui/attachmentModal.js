import { el } from '../utils/dom.js';
import { uuid } from '../utils/id.js';
import { dbPut } from '../db.js';
import * as store from '../store.js';
import { toastSuccess, toastError } from './toast.js';

export function attachmentModal(entity, entityId, onDone) {
  const fileInput = el('input', { type: 'file', style: { display: 'none' } });
  let selectedFile = null;

  const fileNameInput = el('input', { type: 'text', placeholder: '文件名', value: '' });
  const filePathInput = el('input', { type: 'text', placeholder: '完整路径，如 D:\\考公资料\\讲义.pdf 或 https://...' });
  const noteInput = el('textarea', { placeholder: '备注（可选）', style: { minHeight: '60px' } });
  const saveFileCheck = el('input', { type: 'checkbox' });

  fileInput.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    selectedFile = f;
    fileNameInput.value = f.name;
    const rootDir = localStorage.getItem('kg_root_dir') || '';
    if (rootDir && !rootDir.startsWith('http')) {
      filePathInput.value = rootDir + '\\' + f.name;
    }
  };

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '420px' } }, [
      el('h3', { text: '添加附件' }),
      el('div', { class: 'field' }, [
        el('label', { text: '选择文件' }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '📁 选择文件', onClick: () => fileInput.click() }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '文件名' }),
        fileNameInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '完整路径或链接' }),
        filePathInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '备注' }),
        noteInput,
      ]),
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' } }, [
        saveFileCheck,
        '把文件本身存进浏览器（占空间，换设备能带走）',
      ]),
      el('div', { class: 'confirm-actions' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: '添加',
          onClick: async () => {
            const name = fileNameInput.value.trim();
            const path = filePathInput.value.trim();
            if (!name) { alert('请填文件名'); return; }
            const id = uuid();
            const isLink = path.startsWith('http://') || path.startsWith('https://');
            let storedFileId = null;

            if (saveFileCheck.checked && selectedFile) {
              try {
                await dbPut('attachments', { id, blob: selectedFile, name: selectedFile.name, type: selectedFile.type });
                storedFileId = id;
              } catch (e) {
                toastError('文件存储失败：' + e.message);
                return;
              }
            }

            const attachment = {
              id,
              name,
              path,
              note: noteInput.value.trim(),
              isLink,
              storedFileId,
              createdAt: new Date().toISOString(),
            };
            store.addAttachment(entity, entityId, attachment);
            toastSuccess('已添加附件');
            mask.remove();
            onDone && onDone();
          },
        }),
      ]),
    ]),
  ]);
  document.body.appendChild(mask);
}

export function renderAttachmentList(entity, entityId, onRefresh) {
  const list = store.getAttachments(entity, entityId);
  const container = el('div', { style: { marginTop: '8px' } });

  if (list.length === 0) {
    container.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '暂无附件' }));
    return container;
  }

  list.forEach(a => {
    const item = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#f9f9f9', borderRadius: '6px', marginBottom: '4px', fontSize: '13px', flexWrap: 'wrap' },
    });
    item.appendChild(el('span', { text: '📎' }));
    item.appendChild(el('span', { text: a.name, style: { fontWeight: '600' } }));
    if (a.path) item.appendChild(el('span', { text: a.path, style: { color: 'var(--text-2)', fontSize: '12px', wordBreak: 'break-all' } }));
    if (a.note) item.appendChild(el('span', { text: `（${a.note}）`, style: { color: 'var(--text-2)', fontSize: '12px' } }));

    if (a.isLink) {
      item.appendChild(el('a', {
        href: a.path, target: '_blank', rel: 'noopener',
        class: 'btn btn-sm btn-ghost', text: '打开',
      }));
    } else {
      item.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: '复制路径',
        onClick: () => {
          const full = a.name + (a.path ? ' ' + a.path : '');
          navigator.clipboard.writeText(full).then(() => toastSuccess('已复制'));
        },
      }));
    }

    if (a.storedFileId) {
      item.appendChild(el('button', {
        class: 'btn btn-sm btn-ghost', text: '下载',
        onClick: async () => {
          const { dbGet } = await import('../db.js');
          const rec = await dbGet('attachments', a.storedFileId);
          if (!rec) { toastError('文件不存在'); return; }
          const url = URL.createObjectURL(rec.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = rec.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      }));
    }

    item.appendChild(el('button', {
      class: 'btn btn-sm btn-danger', text: '删除',
      onClick: () => {
        if (!confirm('删除这个附件？')) return;
        store.removeAttachment(entity, entityId, a.id);
        onRefresh && onRefresh();
      },
    }));

    container.appendChild(item);
  });

  return container;
}