import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';

// 全局状态，防止刷新时丢失
let globalMultiMode = false;
let globalSelectedIds = new Set();
let globalExpanded = false; // 控制是否展开所有图片

export function renderImageList(point, onRefresh) {
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  
  const latestPoint = store.getPoint(point.id) || point;
  const allIds = [...(latestPoint.imageIds || []), ...(latestPoint.compositeImageIds || [])];
  
  if (allIds.length === 0) {
    globalMultiMode = false;
    globalSelectedIds.clear();
    globalExpanded = false;
    wrap.appendChild(createUploadBox(latestPoint, onRefresh, true));
    return wrap;
  }

  // 计算要展示的 ID 列表
  const displayIds = globalExpanded ? allIds : allIds.slice(0, 3);
  const hasMore = allIds.length > 3;

  // ============ 头部工具栏 ============
  const header = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' } });
  
  const titleRow = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
      el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: `共 ${allIds.length} 张图片` }),
      hasMore ? el('button', {
        class: 'btn btn-sm btn-ghost', text: globalExpanded ? '收起' : '展开全部',
        style: { padding: '2px 8px', fontSize: '12px', minHeight: '24px' },
        onClick: () => { globalExpanded = !globalExpanded; onRefresh(); }
      }) : null
    ]),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', text: globalMultiMode ? '取消多选' : '☑ 多选',
        onClick: () => {
          globalMultiMode = !globalMultiMode;
          globalSelectedIds.clear();
          onRefresh();
        }
      }),
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🗜 压缩',
        onClick: async () => {
          if (!confirm(`确定压缩这 ${allIds.length} 张图片吗？`)) return;
          toastSuccess('开始压缩，请稍候…');
          for (const id of allIds) {
            const rec = await dbGet('images', id);
            if (!rec || !rec.originalBlob) continue;
            const targetBlob = rec.annotatedBlob || rec.originalBlob;
            const url = URL.createObjectURL(targetBlob);
            const img = new Image();
            await new Promise(r => { img.onload = r; img.src = url; });
            URL.revokeObjectURL(url);
            const MAX_W = 1000;
            if (img.width <= MAX_W) continue;

            const canvas = document.createElement('canvas');
            canvas.width = MAX_W;
            canvas.height = img.height * (MAX_W / img.width);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const compressedBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
            
            await dbPut('images', {
              ...rec,
              originalBlob: compressedBlob,
              annotatedBlob: compressedBlob,
              width: canvas.width,
              height: canvas.height,
              updatedAt: new Date().toISOString(),
            });
          }
          toastSuccess('压缩完成');
          onRefresh();
        }
      })
    ])
  ]);
  header.appendChild(titleRow);

  // 多选模式下的操作条
  if (globalMultiMode) {
    const countEl = el('span', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--primary-dark)' }, text: `已选 ${globalSelectedIds.size} 张` });
    const actionRow = el('div', { style: { display: 'flex', gap: '8px', padding: '8px', background: 'rgba(142, 202, 230, 0.15)', borderRadius: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
      countEl,
      el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { allIds.forEach(id => globalSelectedIds.add(id)); onRefresh(); } }),
      el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { globalSelectedIds.clear(); onRefresh(); } }),
      el('button', { class: 'btn btn-sm btn-danger', text: '🗑 删除选中', onClick: async () => {
        if (globalSelectedIds.size === 0) { toastError('请先勾选'); return; }
        if (!confirm(`确定删除选中的 ${globalSelectedIds.size} 张图片吗？`)) return;
        
        for (const id of globalSelectedIds) {
          await dbDelete('images', id);
          const { deleteImageAssets } = await import('../store.js');
          deleteImageAssets(id);
        }
        
        latestPoint.imageIds = (latestPoint.imageIds || []).filter(id => !globalSelectedIds.has(id));
        latestPoint.compositeImageIds = (latestPoint.compositeImageIds || []).filter(id => !globalSelectedIds.has(id));
        store.updatePoint(latestPoint.id, { imageIds: latestPoint.imageIds, compositeImageIds: latestPoint.compositeImageIds });
        
        globalSelectedIds.clear();
        globalMultiMode = false;
        toastSuccess('已删除');
        onRefresh();
      }}),
      el('button', { class: 'btn btn-sm btn-ghost', text: '取消', onClick: () => { globalMultiMode = false; globalSelectedIds.clear(); onRefresh(); } })
    ]);
    header.appendChild(actionRow);
  }
  
  wrap.appendChild(header);

  // ============ 网格容器（弹性排列） ============
  const grid = el('div', { 
    style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start' } 
  });

  displayIds.forEach((imageId, idx) => {
    const isComposite = (latestPoint.compositeImageIds || []).includes(imageId);
    
    // 容器，固定高度，宽度自适应，保留原图长宽比
    const thumbWrap = el('div', {
      'data-id': imageId,
      style: {
        position: 'relative', height: '80px', minWidth: '60px', borderRadius: '6px', overflow: 'hidden',
        background: '#f0f0f0', border: '1px solid rgba(0,0,0,.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
        transition: 'border-color 0.2s'
      }
    });

    if (globalMultiMode && globalSelectedIds.has(imageId)) {
      thumbWrap.style.border = '3px solid var(--primary)';
      thumbWrap.style.opacity = '0.7';
    }

    thumbWrap.addEventListener('contextmenu', (e) => e.preventDefault());

    // 骨架屏（宽度不定，先用最小值）
    const placeholder = el('div', {
      style: {
        position: 'absolute', inset: 0, background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)',
        backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite linear',
      }
    });
    thumbWrap.appendChild(placeholder);

    // 加载图片
    dbGet('images', imageId).then(rec => {
      if (!rec) return;
      const blob = rec.annotatedBlob || rec.originalBlob;
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img = el('img', { 
        src: url, 
        style: { height: '100%', width: 'auto', display: 'block', pointerEvents: 'none' },
        onLoad: (e) => { 
          URL.revokeObjectURL(url); 
          placeholder.remove();
          // 动态设置宽度，保证排版紧凑
          thumbWrap.style.width = e.target.width * (80 / e.target.height) + 'px';
        }
      });
      thumbWrap.appendChild(img);
    });

    // 序号/类型标签
    thumbWrap.appendChild(el('div', {
      style: {
        position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,.6)', color: '#fff',
        fontSize: '10px', padding: '1px 4px', borderRadius: '4px', pointerEvents: 'none'
      },
      text: isComposite ? '合成' : String(idx + 1)
    }));

    // ============ 悬浮操作按钮（非多选模式下可见） ============
    if (!globalMultiMode) {
      const actions = el('div', {
        style: {
          position: 'absolute', top: 0, right: 0, display: 'flex',
          background: 'rgba(0,0,0,0.5)', borderBottomLeftRadius: '6px',
          opacity: '0', transition: 'opacity 0.2s'
        },
        class: 'thumb-actions'
      }, [
        el('button', {
          style: { background: 'transparent', border: 'none', color: '#fff', padding: '2px 4px', cursor: 'pointer', fontSize: '12px' },
          text: '🎨',
          title: '去标注',
          onClick: (e) => {
            e.stopPropagation();
            window.location.hash = `#/annotate/${imageId}?pointId=${latestPoint.id}`;
          }
        }),
        el('button', {
          style: { background: 'transparent', border: 'none', color: 'var(--danger)', padding: '2px 4px', cursor: 'pointer', fontSize: '12px' },
          text: '✕',
          title: '删除',
          onClick: async (e) => {
            e.stopPropagation();
            if (!confirm('确定删除这张图片吗？')) return;
            const { deleteImageAssets } = await import('../store.js');
            await dbDelete('images', imageId);
            deleteImageAssets(imageId);
            latestPoint.imageIds = (latestPoint.imageIds || []).filter(id => id !== imageId);
            latestPoint.compositeImageIds = (latestPoint.compositeImageIds || []).filter(id => id !== imageId);
            store.updatePoint(latestPoint.id, { imageIds: latestPoint.imageIds, compositeImageIds: latestPoint.compositeImageIds });
            toastSuccess('已删除');
            onRefresh();
          }
        })
      ]);
      thumbWrap.appendChild(actions);
      
      // 桌面端 hover 显示，移动端常驻
      thumbWrap.addEventListener('pointerenter', () => actions.style.opacity = '1');
      thumbWrap.addEventListener('pointerleave', () => actions.style.opacity = '0');
      if (window.matchMedia('(pointer: coarse)').matches) actions.style.opacity = '1';
    }

    // 点击事件
    thumbWrap.addEventListener('click', () => {
      if (globalMultiMode) {
        if (globalSelectedIds.has(imageId)) {
          globalSelectedIds.delete(imageId);
          thumbWrap.style.border = '1px solid rgba(0,0,0,.08)';
          thumbWrap.style.opacity = '1';
        } else {
          globalSelectedIds.add(imageId);
          thumbWrap.style.border = '3px solid var(--primary)';
          thumbWrap.style.opacity = '0.7';
        }
        const countEl = header.querySelector('span[style*="已选"]');
        if (countEl) countEl.textContent = `已选 ${globalSelectedIds.size} 张`;
      } else {
        openLightbox(imageId, latestPoint, onRefresh);
      }
    });

    grid.appendChild(thumbWrap);
  });

  // ============ 末尾追加「添加图片」虚线框 ============
  if (!globalMultiMode) {
    grid.appendChild(createUploadBox(latestPoint, onRefresh, false));
  }

  wrap.appendChild(grid);
  return wrap;
}

// 辅助：创建上传框
function createUploadBox(point, onRefresh, isFullWidth) {
  const box = el('div', {
    style: {
      height: '80px', width: isFullWidth ? '100%' : '80px',
      borderRadius: '6px', border: '2px dashed rgba(142, 202, 230, 0.6)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', background: 'rgba(142, 202, 230, 0.05)', color: 'var(--primary-dark)',
      fontSize: '12px', gap: '4px'
    },
    onClick: () => uploadImages(point.id, onRefresh),
    onDragover: (e) => { e.preventDefault(); box.style.background = 'rgba(142, 202, 230, 0.15)'; },
    onDragleave: (e) => { e.preventDefault(); box.style.background = 'rgba(142, 202, 230, 0.05)'; },
    onDrop: async (e) => {
      e.preventDefault();
      box.style.background = 'rgba(142, 202, 230, 0.05)';
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) await processFiles(files, point.id, onRefresh);
    }
  }, [
    el('span', { style: { fontSize: '20px', pointerEvents: 'none' }, text: '+' }),
    el('span', { style: { pointerEvents: 'none' }, text: '添加图片' })
  ]);
  return box;
}

// 辅助：处理上传
async function uploadImages(pointId, onRefresh) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) await processFiles(files, pointId, onRefresh);
  };
  fileInput.click();
}

// 辅助：写入数据库
async function processFiles(files, pointId, onRefresh) {
  const pt = store.getPoint(pointId);
  if (!pt) { toastError('知识点未找到'); return; }
  const { dbPut } = await import('../db.js');
  if (!pt.imageIds) pt.imageIds = [];
  
  for (const f of files) {
    const img = new Image();
    const url = URL.createObjectURL(f);
    await new Promise(r => { img.onload = r; img.src = url; });
    const id = crypto.randomUUID();
    await dbPut('images', {
      id, originalBlob: f, annotatedBlob: f, width: img.width, height: img.height,
      dpr: window.devicePixelRatio || 1, source: 'upload', createdAt: new Date().toISOString(),
    });
    URL.revokeObjectURL(url);
    pt.imageIds.push(id);
  }
  store.updatePoint(pt.id, { imageIds: pt.imageIds });
  toastSuccess(`已添加 ${files.length} 张图片`);
  onRefresh();
}

// 大图预览（保留你之前的代码，无需变动）
async function openLightbox(imageId, point, onRefresh) {
  if (!point) { toastError('图片数据丢失'); return; }
  const latestPoint = store.getPoint(point.id) || point;

  const rec = await dbGet('images', imageId);
  if (!rec) { toastError('图片文件丢失'); return; }
  
  const blob = rec.annotatedBlob || rec.originalBlob;
  const url = URL.createObjectURL(blob);

  // 新增一个状态：是否处于沉浸模式
  let isImmersive = false;

  const mask = el('div', { 
    class: 'confirm-mask', 
    style: { zIndex: 99999, background: 'rgba(0,0,0,0.92)', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }
  });

  // 图片容器
  const imgWrap = el('div', {
    style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: 'zoom-in' }
  }, [
    el('img', { 
      src: url, 
      style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transition: 'transform 0.2s' } 
    })
  ]);

  // 底部工具栏
  const toolbar = el('div', { 
    style: { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', width: '100%', maxWidth: '600px', marginTop: '20px', transition: 'opacity 0.2s' } 
  }, [
    el('button', {
      class: 'btn btn-ghost', text: '⬅️ 前移', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
      onClick: () => {
        const ids = [...(latestPoint.imageIds || []), ...(latestPoint.compositeImageIds || [])];
        const idx = ids.indexOf(imageId);
        if (idx > 0) {
          [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
          const finalIds = ids.filter(id => !(latestPoint.compositeImageIds || []).includes(id));
          const finalCompositeIds = ids.filter(id => (latestPoint.compositeImageIds || []).includes(id));
          store.updatePoint(latestPoint.id, { imageIds: finalIds, compositeImageIds: finalCompositeIds });
          toastSuccess('已前移');
          mask.remove();
          URL.revokeObjectURL(url);
          onRefresh();
        } else {
          toastError('已经是第一张了');
        }
      }
    }),
    el('button', {
      class: 'btn btn-ghost', text: '➡️ 后移', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
      onClick: () => {
        const ids = [...(latestPoint.imageIds || []), ...(latestPoint.compositeImageIds || [])];
        const idx = ids.indexOf(imageId);
        if (idx < ids.length - 1) {
          [ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]];
          const finalIds = ids.filter(id => !(latestPoint.compositeImageIds || []).includes(id));
          const finalCompositeIds = ids.filter(id => (latestPoint.compositeImageIds || []).includes(id));
          store.updatePoint(latestPoint.id, { imageIds: finalIds, compositeImageIds: finalCompositeIds });
          toastSuccess('已后移');
          mask.remove();
          URL.revokeObjectURL(url);
          onRefresh();
        } else {
          toastError('已经是最后一张了');
        }
      }
    }),
    el('button', {
      class: 'btn btn-primary', text: '🎨 去标注',
      onClick: () => {
        mask.remove();
        URL.revokeObjectURL(url);
        window.location.hash = `#/annotate/${imageId}?pointId=${latestPoint.id}`;
      }
    }),
    el('button', {
      class: 'btn btn-danger', text: '🗑 删除',
      onClick: async () => {
        if (!confirm('确定删除这张图片吗？')) return;
        const { deleteImageAssets } = await import('../store.js');
        await dbDelete('images', imageId);
        deleteImageAssets(imageId);
        
        latestPoint.imageIds = (latestPoint.imageIds || []).filter(id => id !== imageId);
        latestPoint.compositeImageIds = (latestPoint.compositeImageIds || []).filter(id => id !== imageId);
        store.updatePoint(latestPoint.id, { imageIds: latestPoint.imageIds, compositeImageIds: latestPoint.compositeImageIds });
        
        mask.remove();
        URL.revokeObjectURL(url);
        toastSuccess('已删除');
        onRefresh();
      }
    }),
    el('button', {
      class: 'btn btn-ghost', text: '关闭', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
      onClick: () => { mask.remove(); URL.revokeObjectURL(url); }
    })
  ]);

  mask.appendChild(imgWrap);
  mask.appendChild(toolbar);

  // 👇 新增：点击图片切换沉浸模式
  imgWrap.addEventListener('click', () => {
    isImmersive = !isImmersive;
    if (isImmersive) {
      // 隐藏工具栏，背景变纯黑，鼠标变放大镜
      toolbar.style.opacity = '0';
      toolbar.style.pointerEvents = 'none';
      mask.style.background = 'rgba(0,0,0,1)';
      mask.style.padding = '0';
      imgWrap.style.cursor = 'zoom-out';
    } else {
      // 恢复
      toolbar.style.opacity = '1';
      toolbar.style.pointerEvents = 'auto';
      mask.style.background = 'rgba(0,0,0,0.92)';
      mask.style.padding = '20px';
      imgWrap.style.cursor = 'zoom-in';
    }
  });

  mask.addEventListener('click', (e) => {
    if (e.target === mask && !isImmersive) {
      mask.remove();
      URL.revokeObjectURL(url);
    }
  });

  document.body.appendChild(mask);
}