import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { dbGet, dbPut, dbDelete } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess } from '../ui/toast.js';

// 多选状态存在模块级，刷新后保留
let multiMode = false;
let selected = new Set();

export function renderImageList(point, onRefresh) {
  const container = el('div', { style: { marginTop: '8px' } });

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true,
    id: 'hidden-image-input',
    style: { display: 'none' },
    onChange: async (e) => {
      const files = [...e.target.files];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const imageId = uuid();
        const bitmap = await createImageBitmap(file);
        await dbPut('images', {
          id: imageId, type: 'original',
          originalBlob: file, annotatedBlob: file,
          width: bitmap.width, height: bitmap.height, dpr: 1,
          createdAt: new Date().toISOString(),
        });
        store.addImageToPoint(point.id, imageId);
      }
      toastSuccess(`已添加 ${files.length} 张图片`);
      e.target.value = '';
      onRefresh && onRefresh();
    },
  });
  container.appendChild(fileInput);

  const ids = point.imageIds || [];

  // 顶部工具栏
  const toolbar = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' } });
  if (ids.length > 0) {
    toolbar.appendChild(el('button', {
      class: 'btn btn-sm btn-ghost',
      text: multiMode ? '✕ 退出多选' : '☑ 多选',
      onClick: () => {
        multiMode = !multiMode;
        selected.clear();
        onRefresh && onRefresh();
      },
    }));
  }
  container.appendChild(toolbar);

  // 图片网格
  const list = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } });

  ids.forEach(imageId => {
    const thumb = el('div', {
      style: {
        width: '100px', height: '100px', borderRadius: '8px', overflow: 'hidden',
        background: '#f0f0f0', cursor: 'pointer', position: 'relative', flexShrink: '0',
        border: multiMode && selected.has(imageId) ? '3px solid var(--primary)' : '3px solid transparent',
        boxSizing: 'border-box',
      },
      onClick: () => {
        if (multiMode) {
          if (selected.has(imageId)) selected.delete(imageId);
          else selected.add(imageId);
          onRefresh && onRefresh();
        } else {
          navigate(`#/annotate/${imageId}?pointId=${point.id}`);
        }
      },
    });

    // 多选勾选框
    if (multiMode) {
      const cb = el('input', {
        type: 'checkbox',
        checked: selected.has(imageId),
        style: { position: 'absolute', top: '4px', left: '4px', zIndex: '3', width: '20px', height: '20px', cursor: 'pointer' },
        onClick: (e) => e.stopPropagation(),
        onChange: (e) => {
          if (e.target.checked) selected.add(imageId);
          else selected.delete(imageId);
          onRefresh && onRefresh();
        },
      });
      thumb.appendChild(cb);
    }

    // 单张删除按钮（多选模式下隐藏）
    if (!multiMode) {
      const delBtn = el('button', {
        style: { position: 'absolute', top: '2px', right: '2px', background: 'rgba(239,71,111,.9)', color: '#fff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontSize: '13px', lineHeight: '1', zIndex: '3' },
        text: '×',
        onClick: async (e) => {
          e.stopPropagation();
          if (!confirm('删除这张图片？')) return;
          await dbDelete('images', imageId);
          store.removeImageFromPoint(point.id, imageId);
          onRefresh && onRefresh();
        },
      });
      thumb.appendChild(delBtn);
    }

    // 加载缩略图
    dbGet('images', imageId).then(img => {
      if (!img) return;
      const blob = img.annotatedBlob || img.originalBlob;
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      thumb.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) }));
    }).catch(() => {
      thumb.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '24px', color: '#ccc' },
        text: '🖼',
      }));
    });

    list.appendChild(thumb);
  });

  if (ids.length === 0) {
    list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', padding: '8px 0' }, text: '还没有图片' }));
  }

  container.appendChild(list);

  // 多选批量操作栏
  if (multiMode && selected.size > 0) {
    const batchBar = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '8px', background: 'rgba(142,202,230,.1)', borderRadius: '8px' } }, [
      el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: `已选 ${selected.size} 张` }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '全选',
        onClick: () => {
          ids.forEach(id => selected.add(id));
          onRefresh && onRefresh();
        },
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '全不选',
        onClick: () => { selected.clear(); onRefresh && onRefresh(); },
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除选中',
        onClick: async () => {
          if (!confirm(`删除选中的 ${selected.size} 张图片？`)) return;
          for (const id of [...selected]) {
            await dbDelete('images', id);
            store.removeImageFromPoint(point.id, id);
          }
          selected.clear();
          multiMode = false;
          toastSuccess('已删除');
          onRefresh && onRefresh();
        },
      }),
    ]);
    container.appendChild(batchBar);
  }

  // 粘贴上传
  const onPaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const imageId = uuid();
        const bitmap = await createImageBitmap(file);
        await dbPut('images', {
          id: imageId, type: 'original',
          originalBlob: file, annotatedBlob: file,
          width: bitmap.width, height: bitmap.height, dpr: 1,
          createdAt: new Date().toISOString(),
        });
        store.addImageToPoint(point.id, imageId);
        toastSuccess('已粘贴图片');
        onRefresh && onRefresh();
        break;
      }
    }
  };
  document.addEventListener('paste', onPaste);

  return container;
}