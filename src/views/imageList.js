import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { dbGet, dbPut, dbDelete } from '../db.js';
import { uuid } from '../utils/id.js';
import { confirmBox } from '../ui/confirm.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export function renderImageList(point, onRefresh) {
  const container = el('div', { style: { marginTop: '12px' } });

  const list = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } });

  (point.imageIds || []).forEach(imageId => {
    const thumb = el('div', {
      style: {
        width: '100px', height: '100px', borderRadius: '8px', overflow: 'hidden',
        background: '#f0f0f0', cursor: 'pointer', position: 'relative',
      },
      onClick: () => navigate(`#/annotate/${imageId}?pointId=${point.id}`),
    });
    // 异步加载缩略图
    dbGet('images', imageId).then(img => {
      if (!img) return;
      const blob = img.annotatedBlob || img.originalBlob;
      const url = URL.createObjectURL(blob);
      const imgEl = el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } });
      thumb.appendChild(imgEl);
    });
    container.appendChild(list);
    list.appendChild(thumb);
  });

  // 上传按钮
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', multiple: true,style: { display: 'none' },
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

  const uploadBtn = el('button', {
    class: 'btn btn-sm btn-ghost', text: '📷 添加图片',
    onClick: () => fileInput.click(),
  });

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

  container.appendChild(fileInput);
  container.appendChild(uploadBtn);
  container.appendChild(list);

  return container;
}