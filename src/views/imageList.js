import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { uuid } from '../utils/id.js';

// 全局状态记忆
let activeTab = 'images'; // 'images' | 'pdfs'
let viewMode = 'both'; // 'both' | 'thumb' | 'name'
let isMulti = false;
let selected = new Set();

export function renderImageList(point, onRefresh) {
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const latestPoint = store.getPoint(point.id) || point;
  const allIds = [...(latestPoint.imageIds || []), ...(latestPoint.compositeImageIds || [])];

  // ============ 1. 顶部 Tab 切换 ============
  const tabsWrap = el('div', { style: { display: 'flex', gap: '8px', borderBottom: '1px solid rgba(0,0,0,.06)', paddingBottom: '8px' } }, [
    el('button', {
      class: 'btn btn-sm ' + (activeTab === 'images' ? 'btn-primary' : 'btn-ghost'),
      text: `🖼 图片`,
      onClick: () => { activeTab = 'images'; onRefresh(); }
    }),
    el('button', {
      class: 'btn btn-sm ' + (activeTab === 'pdfs' ? 'btn-primary' : 'btn-ghost'),
      text: `📄 PDF 文档`,
      onClick: () => { activeTab = 'pdfs'; onRefresh(); }
    })
  ]);
  wrap.appendChild(tabsWrap);

  // ============ 2. 顶部操作栏 ============
  // 👇 工具函数：收集当前知识点下所有已存在的文件名
  async function collectExistingNames(pt) {
    const names = new Set();
    for (const id of [...(pt.imageIds || []), ...(pt.compositeImageIds || [])]) {
      const r = await dbGet('images', id);
      if (!r) continue;
      if (r.type === 'pdf_placeholder') { if (r.pdfName) names.add(r.pdfName); }
      else if (r.name) { names.add(r.name); }
    }
    return names;
  }

  const topBar = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } }, [
    // 左侧：加文件按钮
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      activeTab === 'images' ? el('button', {
        class: 'btn btn-sm btn-primary', text: '+ 加图片',
        onClick: () => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
          input.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            const pt = store.getPoint(point.id); if (!pt.imageIds) pt.imageIds = [];
            // 👇 收集已有名字
            const existingNames = await collectExistingNames(pt);
            let added = 0, skipped = 0;
            for (const f of files) {
              // 👇 重名拦截
              if (existingNames.has(f.name)) {
                toastError(`"${f.name}" 已存在，跳过`);
                skipped++;
                continue;
              }
              const img = new Image(); const url = URL.createObjectURL(f);
              await new Promise(r => { img.onload = r; img.src = url; });
              const id = uuid();
              await dbPut('images', {
                id, name: f.name,  // 👈 关键：给图片记录加上 name 字段
                originalBlob: f, annotatedBlob: f,
                width: img.width, height: img.height, dpr: 1,
                source: 'upload', createdAt: new Date().toISOString()
              });
              URL.revokeObjectURL(url);
              pt.imageIds.push(id);
              existingNames.add(f.name);
              added++;
            }
            store.updatePoint(pt.id, { imageIds: pt.imageIds });
            if (added > 0) toastSuccess(`已添加 ${added} 张图片${skipped ? `，跳过 ${skipped} 个重名` : ''}`);
            onRefresh();
          };
          input.click();
        }
      }) : null,

      activeTab === 'pdfs' ? el('button', {
        class: 'btn btn-sm btn-primary', text: '+ 加 PDF', style: { background: 'var(--accent)' },
        onClick: () => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true;
          input.onchange = async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            const pt = store.getPoint(point.id);
            // 👇 收集已有名字
            const existingNames = await collectExistingNames(pt);
            let added = 0, skipped = 0;
            toastSuccess(`正在导入…`);
            for (const file of files) {
              // 👇 重名拦截
              if (existingNames.has(file.name)) {
                toastError(`PDF "${file.name}" 已存在，跳过`);
                skipped++;
                continue;
              }
              const pdfId = uuid();
              await dbPut('pdfs', { id: pdfId, blob: file, name: file.name, createdAt: new Date().toISOString() });
              const fakeImgId = uuid();
              await dbPut('images', {
                id: fakeImgId, type: 'pdf_placeholder',
                originalBlob: new Blob([], { type: 'text/plain' }),
                annotatedBlob: new Blob([], { type: 'text/plain' }),
                width: 0, height: 0, dpr: 1,
                pdfId: pdfId, pdfName: file.name, pdfPages: '?',
                createdAt: new Date().toISOString()
              });
              store.addImageToPoint(point.id, fakeImgId);
              existingNames.add(file.name);
              added++;
            }
            toastSuccess(`已导入 ${added} 个 PDF${skipped ? `，跳过 ${skipped} 个重名` : ''}`);
            setTimeout(() => onRefresh(), 300);
          };
          input.click();
        }
      }) : null,
    ]),

    // 右侧：功能图标
        // 右侧：功能图标
    el('div', { style: { display: 'flex', gap: '4px', background: 'var(--bg)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)', flexWrap: 'wrap', alignItems: 'center' } }, [
      // 分组 1：视图模式
      el('div', { style: { display: 'flex', gap: '2px', padding: '2px', background: 'rgba(0,0,0,.02)', borderRadius: '6px' } }, [
        el('button', { class: 'btn btn-sm ' + (viewMode === 'both' ? 'btn-primary' : 'btn-ghost'), text: '🖼', title: '图文模式', style: { padding: '4px 8px', minHeight: '28px' }, onClick: () => { viewMode = 'both'; onRefresh(); } }),
        el('button', { class: 'btn btn-sm ' + (viewMode === 'thumb' ? 'btn-primary' : 'btn-ghost'), text: '▦', title: '纯缩略图', style: { padding: '4px 8px', minHeight: '28px' }, onClick: () => { viewMode = 'thumb'; onRefresh(); } }),
        el('button', { class: 'btn btn-sm ' + (viewMode === 'name' ? 'btn-primary' : 'btn-ghost'), text: '📄', title: '列表模式', style: { padding: '4px 8px', minHeight: '28px' }, onClick: () => { viewMode = 'name'; onRefresh(); } }),
      ]),

      el('div', { style: { width: '1px', height: '20px', background: 'rgba(0,0,0,.1)', margin: '0 2px' } }),

      // 分组 2：合并
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '🔗 合并', title: '合并图片与文档',
        style: { padding: '4px 8px', minHeight: '28px' },
        onClick: () => {
          const pt = store.getPoint(point.id);
          const total = (pt.imageIds || []).length + (pt.compositeImageIds || []).length;
          if (total < 2) { toastError('至少需要 2 个文件才能合并'); return; }
          window.location.hash = `#/composer?pointId=${point.id}`;
        }
      }),

      el('div', { style: { width: '1px', height: '20px', background: 'rgba(0,0,0,.1)', margin: '0 2px' } }),

      // 分组 3：多选与批量操作
      el('div', { style: { display: 'flex', gap: '2px', padding: '2px', background: isMulti ? 'rgba(239,71,111,.08)' : 'rgba(0,0,0,.02)', borderRadius: '6px' } }, [
        el('button', { class: 'btn btn-sm ' + (isMulti ? 'btn-danger' : 'btn-ghost'), text: isMulti ? '✕' : '☑', title: isMulti ? '退出多选' : '多选', style: { padding: '4px 8px', minHeight: '28px' }, onClick: () => { isMulti = !isMulti; selected.clear(); onRefresh(); } }),
        
        // 压缩（多选时显示）
        isMulti ? el('button', {
          class: 'btn btn-sm btn-ghost', text: '🗜', title: '压缩选中', style: { padding: '4px 8px', minHeight: '28px' },
          onClick: async () => {
            if (selected.size === 0) { toastError('请先勾选'); return; }
            toastSuccess('正在压缩...');
            for (const id of selected) {
              const rec = await dbGet('images', id);
              if (!rec || rec.type === 'pdf_placeholder' || rec.width <= 1000) continue;
              const img = new Image();
              const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
              await new Promise(r => { img.onload = r; img.src = url; });
              const canvas = document.createElement('canvas');
              canvas.width = 1000;
              canvas.height = img.height * (1000 / img.width);
              canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
              const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
              URL.revokeObjectURL(url);
              await dbPut('images', { ...rec, originalBlob: blob, annotatedBlob: blob, width: canvas.width, height: canvas.height });
            }
            toastSuccess('压缩完成');
            isMulti = false; selected.clear(); onRefresh();
          }
        }) : null,

        // 删除（多选时显示）
        isMulti ? el('button', {
          class: 'btn btn-sm btn-danger', text: '🗑', title: '删除选中', style: { padding: '4px 8px', minHeight: '28px' },
          onClick: async () => {
            if (selected.size === 0) { toastError('请先勾选'); return; }
            if (!confirm(`确定删除选中的 ${selected.size} 个文件吗？`)) return;
            for (const id of selected) {
              const r = await dbGet('images', id);
              if (r && r.type === 'pdf_placeholder' && r.pdfId) await dbDelete('pdfs', r.pdfId);
              await dbDelete('images', id);
            }
            const latestP = store.getPoint(point.id);
            latestP.imageIds = (latestP.imageIds || []).filter(id => !selected.has(id));
            latestP.compositeImageIds = (latestP.compositeImageIds || []).filter(id => !selected.has(id));
            store.updatePoint(latestP.id, {
              imageIds: latestP.imageIds,
              compositeImageIds: latestP.compositeImageIds,
            });
            isMulti = false; selected.clear(); onRefresh();
          }
        }) : null,
      ]),

      el('div', { style: { width: '1px', height: '20px', background: 'rgba(0,0,0,.1)', margin: '0 2px' } }),

      // 分组 4：复制粘贴
      el('div', { style: { display: 'flex', gap: '2px', padding: '2px', background: 'rgba(0,0,0,.02)', borderRadius: '6px' } }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '📋', title: '复制选中', style: { padding: '4px 8px', minHeight: '28px' },
          onClick: () => {
            if (selected.size === 0) { toastError('请先多选要复制的文件'); return; }
            sessionStorage.setItem('kg_clipboard_files', JSON.stringify(Array.from(selected)));
            toastSuccess(`已复制 ${selected.size} 个文件`);
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '📥', title: '粘贴到当前知识点', style: { padding: '4px 8px', minHeight: '28px' },
          onClick: async () => {
            const data = sessionStorage.getItem('kg_clipboard_files');
            if (!data) { toastError('剪贴板为空'); return; }
            const clipIds = JSON.parse(data);
            if (clipIds.length === 0) return;

            toastSuccess('正在粘贴...');
            const pt = store.getPoint(point.id);
            if (!pt.imageIds) pt.imageIds = [];
            if (!pt.compositeImageIds) pt.compositeImageIds = [];

            for (const oldId of clipIds) {
              const rec = await dbGet('images', oldId);
              if (!rec) continue;

              if (rec.type === 'pdf_placeholder') {
                const pdfRec = await dbGet('pdfs', rec.pdfId);
                if (pdfRec) {
                  const newPdfId = uuid();
                  await dbPut('pdfs', { ...pdfRec, id: newPdfId, createdAt: new Date().toISOString() });
                  const newFakeId = uuid();
                  await dbPut('images', { ...rec, id: newFakeId, pdfId: newPdfId, createdAt: new Date().toISOString() });
                  pt.imageIds.push(newFakeId);
                }
              } else if (rec.type === 'composite') {
                const newCompId = uuid();
                await dbPut('images', { ...rec, id: newCompId, createdAt: new Date().toISOString() });
                pt.compositeImageIds.push(newCompId);
              } else {
                const newImgId = uuid();
                await dbPut('images', { ...rec, id: newImgId, createdAt: new Date().toISOString() });
                pt.imageIds.push(newImgId);
              }
            }
            store.updatePoint(pt.id, { imageIds: pt.imageIds, compositeImageIds: pt.compositeImageIds });
            toastSuccess('粘贴成功');
            isMulti = false; selected.clear(); onRefresh();
          }
        }),
      ]),
    ])
  ]);
  wrap.appendChild(topBar);

  // ============ 3. 内容区 ============
  const contentWrap = el('div', { style: { marginTop: '8px' } });
  wrap.appendChild(contentWrap);

  const loadAndRender = async () => {
    const finalImages = [];
    const finalPdfs = [];

    // 读取数据库，分离图片和 PDF
    for (const id of allIds) {
      const rec = await dbGet('images', id);
      if (!rec) continue;
      if (rec.type === 'pdf_placeholder') finalPdfs.push(rec);
      else finalImages.push(rec);
    }

    const currentList = activeTab === 'images' ? finalImages : finalPdfs;

    if (currentList.length === 0) {
      contentWrap.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '20px' }, text: activeTab === 'images' ? '暂无图片' : '暂无 PDF 文档' }));
      return;
    }

    // 多选操作栏
    if (isMulti) {
      contentWrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', padding: '8px', background: 'rgba(142, 202, 230, 0.15)', borderRadius: '8px', marginBottom: '12px', alignItems: 'center' } }, [
        el('span', { style: { fontSize: '13px', fontWeight: '600', flex: '1' }, text: `已选 ${selected.size} 项` }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { currentList.forEach(r => selected.add(r.id)); onRefresh(); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selected.clear(); onRefresh(); } }),
        el('button', {
          class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async () => {
            if (!confirm(`确定删除选中的 ${selected.size} 个文件吗？`)) return;
            for (const id of selected) {
              const r = await dbGet('images', id);
              if (r && r.type === 'pdf_placeholder' && r.pdfId) await dbDelete('pdfs', r.pdfId);
              await dbDelete('images', id);
            }
            const latestP = store.getPoint(point.id);
            latestP.imageIds = (latestP.imageIds || []).filter(id => !selected.has(id));
            latestP.compositeImageIds = (latestP.compositeImageIds || []).filter(id => !selected.has(id));
            store.updatePoint(latestP.id, {
              imageIds: latestP.imageIds,
              compositeImageIds: latestP.compositeImageIds,
            });
            isMulti = false; selected.clear(); onRefresh();
          }
        })
      ]));
    }

    // 网格布局或列表布局
    const grid = el('div', { style: { display: viewMode !== 'name' && activeTab === 'images' ? 'grid' : 'flex', flexDirection: 'column', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' } });

    currentList.forEach((rec, idx) => {
      let card;
      const detailBtn = el('button', {
        style: { background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '12px', cursor: 'pointer', zIndex: 10 },
        text: 'ℹ️',
        onClick: (e) => { e.stopPropagation(); showFileDetails(rec); }
      });

      // ============ PDF 分支 ============
      if (activeTab === 'pdfs') {
        card = el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#FFF0F0', borderRadius: '8px', border: '1px solid rgba(0,0,0,.08)', cursor: 'pointer' },
          onClick: () => handleClick(rec, latestPoint, onRefresh)
        }, [
          el('div', { style: { fontSize: '28px' }, text: '📄' }),
          el('div', { style: { flex: '1', overflow: 'hidden' } }, [
            el('div', { style: { fontWeight: '600', fontSize: '14px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }, text: rec.pdfName }),
          ]),
          detailBtn
        ]);
      }
      // ============ 图片分支 ============
      else {
        const rawBlob = rec.annotatedBlob || rec.originalBlob;
        const hasValidBlob = rawBlob instanceof Blob && rawBlob.size > 0;

        if (viewMode === 'name') {
          // 列表模式（左侧带缩略图）
          const thumbIcon = el('div', { style: { width: '40px', height: '40px', borderRadius: '4px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: '0' } });

          if (hasValidBlob) {
            const url = URL.createObjectURL(rawBlob);
            thumbIcon.appendChild(el('img', {
              src: url,
              style: { width: '100%', height: '100%', objectFit: 'cover' },
              onLoad: () => URL.revokeObjectURL(url),
            }));
          } else {
            thumbIcon.appendChild(el('span', { style: { fontSize: '20px' }, text: '🖼' }));
          }

          card = el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: '#fff', borderRadius: '8px', border: '1px solid rgba(0,0,0,.08)', cursor: 'pointer' },
            onClick: () => handleClick(rec, latestPoint, onRefresh)
          }, [thumbIcon, el('div', { style: { flex: '1', fontSize: '14px', fontWeight: '600' }, text: `图片 ${idx + 1}` }), detailBtn]);
        } else {
          // 缩略图/图文模式
          card = el('div', {
            style: { position: 'relative', borderRadius: '8px', overflow: 'hidden', background: '#f0f0f0', border: '1px solid rgba(0,0,0,.08)', cursor: 'pointer', display: 'flex', flexDirection: 'column' },
            onClick: () => handleClick(rec, latestPoint, onRefresh)
          });

          if (hasValidBlob) {
            const url = URL.createObjectURL(rawBlob);
            card.appendChild(el('img', {
              src: url,
              style: { width: '100%', height: viewMode === 'thumb' ? '80px' : '100px', objectFit: 'cover' },
              onLoad: () => URL.revokeObjectURL(url),
            }));
          } else {
            card.appendChild(el('div', {
              style: { width: '100%', height: viewMode === 'thumb' ? '80px' : '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#999' },
              text: '🖼',
            }));
          }

          if (viewMode === 'both') card.appendChild(el('div', { style: { padding: '6px', fontSize: '12px', textAlign: 'center', background: '#fff' }, text: `图片 ${idx + 1}` }));
          card.appendChild(el('div', { style: { position: 'absolute', top: '4px', right: '4px' } }, [detailBtn]));
        }
      }

      if (isMulti && selected.has(rec.id)) { card.style.border = '2px solid var(--primary)'; card.style.opacity = '0.8'; }
      grid.appendChild(card);
    });
    contentWrap.appendChild(grid);
  };

  loadAndRender();
  return wrap;
}

// ============ 点击处理 ============
function handleClick(rec, point, onRefresh) {
  if (isMulti) {
    if (selected.has(rec.id)) selected.delete(rec.id);
    else selected.add(rec.id);
    onRefresh();
    return;
  }
  if (rec.type === 'pdf_placeholder') {
    window.location.hash = `#/pdf-viewer/${rec.pdfId}?pointId=${point.id}`;
  } else {
    openLightbox(rec.id, point, onRefresh);
  }
}

// ============ 文件详情弹窗 ============
async function showFileDetails(rec) {
  let sizeText = '未知', typeText = '图片', dimensionText = `${rec.width || 0} × ${rec.height || 0} px`;
  if (rec.type === 'pdf_placeholder') {
    typeText = 'PDF 文档'; dimensionText = 'PDF 格式';
    try {
      const pdfRec = await dbGet('pdfs', rec.pdfId);
      if (pdfRec && pdfRec.blob) {
        const bytes = pdfRec.blob.size;
        sizeText = bytes > 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';
      }
    } catch { sizeText = '获取失败'; }
  } else if (rec.originalBlob) {
    const bytes = rec.originalBlob.size;
    sizeText = bytes > 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';
  }

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 }, onClick: (e) => { if (e.target === mask) mask.remove(); } }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
      el('h3', { text: '📄 文件详情' }),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', margin: '16px 0' } }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '类型' }), el('span', { style: { fontWeight: '600' }, text: typeText })]),
        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '大小' }), el('span', { text: sizeText })]),
        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: rec.type === 'pdf_placeholder' ? '格式' : '尺寸' }), el('span', { text: dimensionText })]),
        rec.pdfName ? el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '文件名' }), el('span', { text: rec.pdfName, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })]) : null,
        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '创建时间' }), el('span', { text: new Date(rec.createdAt).toLocaleString() })]),
      ]),
      el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-primary', text: '关闭', onClick: () => mask.remove() })])
    ])
  ]);
  document.body.appendChild(mask);
}

// ============ 图片预览 ============
async function openLightbox(imageId, point, onRefresh) {
  if (!point) { toastError('图片数据丢失'); return; }
  const latestPoint = store.getPoint(point.id) || point;

  const rec = await dbGet('images', imageId);
  if (!rec) { toastError('图片文件丢失'); return; }

  const blob = rec.annotatedBlob || rec.originalBlob;
  const url = URL.createObjectURL(blob);
  let isImmersive = false;

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'rgba(0,0,0,0.92)', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' } });

  const imgWrap = el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: 'zoom-in' } }, [
    el('img', { src: url, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transition: 'transform 0.2s' } })
  ]);

  const toolbar = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', width: '100%', maxWidth: '600px', marginTop: '20px', transition: 'opacity 0.2s' } }, [
    el('button', { class: 'btn btn-primary', text: '🎨 去标注', onClick: () => { mask.remove(); window.location.hash = `#/annotate/${imageId}?pointId=${latestPoint.id}`; } }),
    el('button', {
      class: 'btn btn-danger', text: '🗑 删除', onClick: async () => {
        await dbDelete('images', imageId);
        latestPoint.imageIds = (latestPoint.imageIds || []).filter(id => id !== imageId);
        store.updatePoint(latestPoint.id, { imageIds: latestPoint.imageIds });
        mask.remove(); URL.revokeObjectURL(url); toastSuccess('已删除'); onRefresh();
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '关闭', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }, onClick: () => { mask.remove(); URL.revokeObjectURL(url); } })
  ]);

  mask.appendChild(imgWrap);
  mask.appendChild(toolbar);

  imgWrap.addEventListener('click', () => {
    isImmersive = !isImmersive;
    if (isImmersive) {
      toolbar.style.opacity = '0'; toolbar.style.pointerEvents = 'none';
      mask.style.background = 'rgba(0,0,0,1)'; mask.style.padding = '0'; imgWrap.style.cursor = 'zoom-out';
    } else {
      toolbar.style.opacity = '1'; toolbar.style.pointerEvents = 'auto';
      mask.style.background = 'rgba(0,0,0,0.92)'; mask.style.padding = '20px'; imgWrap.style.cursor = 'zoom-in';
    }
  });

  document.body.appendChild(mask);
}