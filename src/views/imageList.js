import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { uuid } from '../utils/id.js';
import { ocrRecognize, checkLib, ensurePdfJs, ensurePdfJsAsync } from '../utils/deps.js';
import { removeAttachment } from '../store.js';

let activeTab = 'images';
let viewMode = 'both';
let isMulti = false;
let selected = new Set();
// 搜索、排序、全折叠状态
let searchQuery = '';
let sortOrder = 'desc'; // 'desc' 最新在前, 'asc' 最旧在前
let forceExpandAll = false;   // 用于一键全部展开
let forceCollapseAll = false; // 用于一键全部收起

const SCOPE_OPT_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', color: '#444' };
let currentPickScope = 'all';   // 当前选择范围：'all' | 'image' | 'pdf'

// 唯一一份范围菜单常驻监听：只负责「切范围更新文案」和「点别处关菜单」。
// 菜单的开合由范围按钮自己的 onClick（闭包 menu 版）负责，这里不再碰开合。
if (!window.__scopeMenuReady) {
  window.__scopeMenuReady = true;

  // 1) 切换范围单选：更新按钮文案、高亮选中项、关闭菜单
  document.addEventListener('change', (e) => {
    const radio = e.target;
    if (!radio || radio.name !== 'pickScope') return;
    currentPickScope = radio.value;

    const menu = radio.closest('.tb-scope-menu');
    if (!menu) return;
    const btn = menu.parentElement.querySelector('.tb-scope-btn');
    if (btn) {
      btn.textContent = '范围：' +
        (radio.value === 'all' ? '全部' : radio.value === 'image' ? '仅图片' : '仅PDF') + ' ▾';
    }
    menu.querySelectorAll('.tb-scope-opt').forEach(o => o.classList.remove('on'));
    const opt = radio.closest('.tb-scope-opt');
    if (opt) opt.classList.add('on');
    menu.hidden = true;
    menu.style.display = 'none';   // 关闭时行内 display 同步复位
  });

  // 2) 点空白处：关闭所有已展开菜单（点按钮 / 点菜单内部时不关）
  document.addEventListener('click', (e) => {
    if (e.target.closest('.tb-scope-menu') || e.target.closest('.tb-scope-btn')) return;
    document.querySelectorAll('.tb-scope-menu').forEach(m => {
      m.hidden = true;
      m.style.display = 'none';
    });
  });
}

// 文件夹状态缓存
const getCollapsed = () => JSON.parse(localStorage.getItem('kg_collapsed_groups') || '{}');
const saveCollapsed = (data) => localStorage.setItem('kg_collapsed_groups', JSON.stringify(data));
const getLocked = () => JSON.parse(localStorage.getItem('kg_locked_folders') || '{}');
const saveLocked = (data) => localStorage.setItem('kg_locked_folders', JSON.stringify(data));

// 记录所有建过的文件夹（防止空文件夹消失）
const getAllFolders = () => JSON.parse(localStorage.getItem('kg_all_folders') || '[]');
const saveAllFolders = (data) => localStorage.setItem('kg_all_folders', JSON.stringify(data));

let lastPointId = null;        // 卡片切换守卫
let lastImageIds = [];         // 当前卡片的纯图片 id
let lastPdfIds = [];           // 当前卡片的 PDF 占位 id

export function renderImageList(point, onRefresh) {
  let lastClickTime = 0;
  // 切换卡片时清空多选态，避免把上一张的勾选带过来
  if (lastPointId !== point.id) { selected.clear(); isMulti = false; lastPointId = point.id; }
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const latestPoint = store.getPoint(point.id) || point;
  const allIds = latestPoint.imageIds || [];

  // ============ 1. 顶部 Tab ============
  const tabsWrap = el('div', { style: { display: 'flex', gap: '8px', borderBottom: '1px solid rgba(0,0,0,.06)', paddingBottom: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
    el('button', { class: 'btn btn-sm ' + (activeTab === 'images' ? 'btn-primary' : 'btn-ghost'), text: `🖼 图片`, onClick: () => { activeTab = 'images'; onRefresh(); } }),
    el('button', { class: 'btn btn-sm ' + (activeTab === 'pdfs' ? 'btn-primary' : 'btn-ghost'), text: `📄 PDF 文档`, onClick: () => { activeTab = 'pdfs'; onRefresh(); } }),

    //挑选 PDF 按钮：去掉 marginLeft: 'auto'，它就紧贴后面了
    el('button', {
      class: 'btn btn-sm btn-ghost',
      text: '📄 挑选 PDF',
      style: { fontSize: '12px', padding: '4px 10px', background: 'rgba(255,181,167,.15)', color: 'var(--accent)' },
      onClick: async () => {
        const { pdfImportModal } = await import('../views/pdfImport.js');
        await pdfImportModal(point.id);
        onRefresh();
      }
    }),

    el('button', { class: 'btn btn-sm ' + (activeTab === 'recent' ? 'btn-primary' : 'btn-ghost'), text: `🕒 最近`, onClick: () => { activeTab = 'recent'; onRefresh(); } })
  ]);
  wrap.appendChild(tabsWrap);

  // ============ 顶部操作栏（单行紧凑版） ============
  const topBar = el('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' } }, [

    // 1. 加图片 / 加 PDF
    activeTab === 'images' ? el('button', {
      class: 'btn btn-sm btn-primary', text: '+ 加图片',
      style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' },
      onClick: () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
        input.onchange = async (e) => {
          const files = Array.from(e.target.files || []);
          if (files.length === 0) return;

          // 防止重复触发
          input.onchange = null;

          //获取当前知识点里已有的所有图片名，用于比对
          const pt = store.getPoint(point.id);
          if (!pt.imageIds) pt.imageIds = [];

          const existingRecs = await Promise.all(pt.imageIds.map(id => dbGet('images', id)));
          const usedNames = new Set(existingRecs.map(r => r && r.name).filter(Boolean));

          for (const f of files) {
            const img = new Image(); const url = URL.createObjectURL(f);
            await new Promise(r => { img.onload = r; img.src = url; });
            const id = uuid();

            //自动给重名文件加序号
            let baseName = f.name || '未命名图片';
            let ext = '';
            if (baseName.includes('.')) {
              const parts = baseName.split('.');
              ext = '.' + parts.pop();
              baseName = parts.join('.');
            }

            let finalName = baseName + ext;
            let counter = 1;
            while (usedNames.has(finalName)) {
              finalName = `${baseName} (${counter})${ext}`;
              counter++;
            }
            usedNames.add(finalName); // 加入集合，防止本次上传的多个同名文件也重复

            await dbPut('images', {
              id,
              name: finalName, //存入去重后的名称
              originalBlob: f,
              annotatedBlob: f,
              width: img.width,
              height: img.height,
              dpr: 1,
              source: 'upload',
              createdAt: new Date().toISOString()
            });

            URL.revokeObjectURL(url);
            pt.imageIds.push(id);
          }

          // 一次性更新知识点
          store.updatePoint(pt.id, { imageIds: pt.imageIds });
          onRefresh();
        };
        input.click();
      }
    }) : null,

    // 2. 加 PDF（分流：转图导入 / 原 PDF 导入 / 两者都做）
    activeTab === 'pdfs' ? el('button', {
      class: 'btn btn-sm btn-primary', text: '+ 加 PDF',
      style: { background: 'var(--accent)', padding: '4px 8px', minHeight: '28px', flexShrink: '0' },
      onClick: () => pickPdfImport(point, onRefresh)
    }) : null,

    // 2. 视图切换（🖼 ▦ 📄）
    el('button', { class: 'btn btn-sm ' + (viewMode === 'both' ? 'btn-primary' : 'btn-ghost'), text: '🖼', title: '图文模式', style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' }, onClick: () => { viewMode = 'both'; onRefresh(); } }),
    el('button', { class: 'btn btn-sm ' + (viewMode === 'thumb' ? 'btn-primary' : 'btn-ghost'), text: '▦', title: '纯缩略图', style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' }, onClick: () => { viewMode = 'thumb'; onRefresh(); } }),
    el('button', { class: 'btn btn-sm ' + (viewMode === 'name' ? 'btn-primary' : 'btn-ghost'), text: '📄', title: '列表模式', style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' }, onClick: () => { viewMode = 'name'; onRefresh(); } }),

    el('button', {
      class: 'btn btn-sm btn-ghost', text: '⬇️', title: '全部展开', style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' },
      onClick: () => {
        // 强制写死到全局变量
        window.forceExpandAll = true;
        window.forceCollapseAll = false;
        // 顺便把本地的折叠状态清空
        saveCollapsed({});
        onRefresh();
      }
    }),
    el('button', {
      class: 'btn btn-sm btn-ghost', text: '⬆️', title: '全部收起', style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' },
      onClick: () => {
        // 强制写死到全局变量
        window.forceCollapseAll = true;
        window.forceExpandAll = false;
        // 拿到当前所有文件夹，强制全部设为收起
        const folders = getAllFolders();
        const collapsedAll = { __ungrouped__: true };
        folders.forEach(f => collapsedAll[f] = true);
        saveCollapsed(collapsedAll);
        onRefresh();
      }
    }),
    el('button', {
      class: 'btn btn-sm btn-ghost', text: '📁+', title: '新建文件夹', style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' },
      onClick: () => {
        openInputModal('新建文件夹', '新建文件夹（用 / 分隔可建子文件夹，如：讲义/数学/函数）', (raw) => {
          const clean = (raw || '').split('/').map(s => s.trim()).filter(Boolean).join('/');
          if (!clean) return toastError('名称不能为空');
          const folders = getAllFolders();
          // 逐级登记所有祖先，否则子文件夹因父级不在清单里而显示/删除异常
          const segs = clean.split('/');
          for (let i = 1; i <= segs.length; i++) {
            const p = segs.slice(0, i).join('/');
            if (!folders.includes(p)) folders.push(p);
          }
          // 末级重名才加序号
          const parent = segs.length > 1 ? segs.slice(0, -1).join('/') + '/' : '';
          const leaf = segs[segs.length - 1];
          let finalLeaf = leaf, i2 = 1;
          while (folders.includes(parent + finalLeaf)) { finalLeaf = `${leaf} (${i2})`; i2++; }
          const finalName = parent + finalLeaf;
          if (!folders.includes(finalName)) folders.push(finalName);
          saveAllFolders(folders);
          sessionStorage.setItem('kg_rename_folder', finalName);
          toastSuccess(`文件夹「${finalName}」已创建`);
          onRefresh();
        });
      }
    }),

    // 4. 排序切换
    el('button', {
      class: 'btn btn-sm btn-ghost', style: { padding: '4px 8px', minHeight: '28px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: '0' }, title: '点击切换排序',
      onClick: () => {
        const options = [
          { id: 'time-desc', label: '创建时间 ↓ (最新在前)' }, { id: 'time-asc', label: '创建时间 ↑ (最旧在前)' },
          { id: 'update-desc', label: '更新时间 ↓ (最近修改在前)' }, { id: 'update-asc', label: '更新时间 ↑ (最早修改在前)' },
          { id: 'name-asc', label: '名称 A-Z' }, { id: 'size-desc', label: '文件大小 ↓ (大文件在前)' }, { id: 'size-asc', label: '文件大小 ↑ (小文件在前)' }
        ];
        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }); const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });
        options.forEach(opt => {
          list.appendChild(el('div', {
            style: { padding: '10px 12px', background: sortOrder === opt.id ? 'rgba(142,202,230,0.2)' : 'var(--bg)', border: sortOrder === opt.id ? '1px solid var(--primary)' : '1px solid rgba(0,0,0,.05)', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
            onClick: () => { sortOrder = opt.id; mask.remove(); onRefresh(); }
          }, [
            el('span', { text: opt.label, style: { fontWeight: sortOrder === opt.id ? '600' : 'normal', color: sortOrder === opt.id ? 'var(--primary-dark)' : 'inherit' } }),
            sortOrder === opt.id ? el('span', { text: '✓' }) : null
          ]));
        });
        const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [el('h3', { text: '选择排序方式' }), list, el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })])]);
        mask.appendChild(box); document.body.appendChild(mask);
      }
    }, [
      el('span', { text: '⇅ ' + (sortOrder === 'time-desc' ? '最新' : sortOrder === 'time-asc' ? '最旧' : sortOrder === 'update-desc' ? '最近改' : sortOrder === 'update-asc' ? '最早改' : sortOrder === 'name-asc' ? '名称' : sortOrder === 'size-desc' ? '大文件' : '小文件') })
    ]),

    // 5. 多选按钮与展开栏
    el('button', {
      class: 'btn btn-sm ' + (isMulti ? 'btn-danger' : 'btn-ghost'), text: isMulti ? '✕ 退出' : '☑ 多选', title: '多选',
      style: { padding: '4px 8px', minHeight: '28px', flexShrink: '0' }, onClick: () => { isMulti = !isMulti; selected.clear(); onRefresh(); }
    }),

    isMulti ? el('div', {
      style: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
        padding: '2px 6px',
        background: 'rgba(142, 202, 230, 0.15)',
        borderRadius: '8px',
        flexWrap: 'wrap',
        zIndex: '10'
      }
    }, [
      el('span', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--primary-dark)', marginRight: '4px' }, text: `${selected.size}` }),
      // —— 选择范围下拉（全部/仅图片/仅PDF 合并为一个区域）
      el('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } }, (() => {
        const menu = el('div', {
          class: 'tb-scope-menu',
          style: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 600, background: '#fff', border: '1px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,.12)', padding: '6px', minWidth: '120px', display: 'none' },
          hidden: true
        }, [
          el('label', { class: 'tb-scope-opt on', style: SCOPE_OPT_STYLE }, [
            el('input', { type: 'radio', name: 'pickScope', value: 'all', checked: currentPickScope === 'all' }), el('span', { text: '全部（图片+PDF）' })
          ]),
          el('label', { class: 'tb-scope-opt', style: SCOPE_OPT_STYLE }, [
            el('input', { type: 'radio', name: 'pickScope', value: 'image', checked: currentPickScope === 'image' }), el('span', { text: '仅图片' })
          ]),
          el('label', { class: 'tb-scope-opt', style: SCOPE_OPT_STYLE }, [
            el('input', { type: 'radio', name: 'pickScope', value: 'pdf', checked: currentPickScope === 'pdf' }), el('span', { text: '仅 PDF' })
          ])
        ]);
        const btn = el('button', {
          class: 'tb-scope-btn',
          text: '范围：' + (currentPickScope === 'all' ? '全部' : currentPickScope === 'image' ? '仅图片' : '仅PDF') + ' ▾',
          style: { padding: '2px 8px', fontSize: '12px', minHeight: '26px', border: '1px solid var(--line, #d6e6ef)', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: 'var(--primary-dark)' },
          onClick: (e) => {
            e.stopPropagation();                      // 阻止冒泡到 document 的“点别处关闭”，否则会立刻被关掉
            const show = menu.hidden;                 // 当前是隐藏的 → 这次点击要展开
            menu.hidden = !show;
            menu.style.display = show ? 'block' : 'none';   // hidden 与行内 display 必须一起切
          }
        });
        return [btn, menu];                           // 按钮在前、菜单在后（与原版顺序一致）
      })()),

      // —— 按当前范围「全选 / 取消全选」 ——
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '全选/取消', title: '对当前范围执行全选，再点则取消',
        style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' },
        onClick: () => toggleSelectByScope(selected, onRefresh)
      }),

      // 移动
      el('button', { class: 'btn btn-sm btn-primary', style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' }, text: '移动', onClick: () => openMoveModal(selected, onRefresh) }),

      //导出功能（弹窗选择格式与方式）
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '导出',
        style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' },
        onClick: async () => {
          if (selected.size === 0) return toastError('请先选择文件');

          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
            el('h3', { text: '选择导出方式' }),
            el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: `共选中 ${selected.size} 个文件` }),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' } }, [
              el('button', {
                class: 'btn btn-primary', text: '📦 打包导出为 ZIP', onClick: async () => {
                  mask.remove();
                  toastSuccess('正在打包，请稍候...');
                  const JSZipClass = window.JSZip;
                  if (!JSZipClass) { toastError('打包组件未加载：请确认 vendor/jszip/jszip.min.js 已就位'); return; }
                  const zip = new JSZipClass();

                  for (const id of selected) {
                    const rec = await dbGet('images', id);
                    if (rec && rec.annotatedBlob) {
                      zip.file(rec.name || `图片_${id.slice(0, 6)}.png`, rec.annotatedBlob);
                    } else if (rec && rec.pdfId) {
                      const pdfRec = await dbGet('pdfs', rec.pdfId);
                      if (pdfRec) zip.file(pdfRec.name || `文档_${id.slice(0, 6)}.pdf`, pdfRec.blob);
                    }
                  }

                  const content = await zip.generateAsync({ type: 'blob' });

                  // 尝试使用 File System Access API 唤起保存对话框
                  if (window.showSaveFilePicker) {
                    try {
                      const handle = await window.showSaveFilePicker({
                        suggestedName: `导出备份_${new Date().getTime()}.zip`,
                        types: [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }]
                      });
                      const writable = await handle.createWritable();
                      await writable.write(content);
                      await writable.close();
                      toastSuccess('导出成功');
                      return;
                    } catch (err) { /* 用户取消或浏览器不支持原生保存，忽略 */ }
                  }

                  // 降级为普通下载
                  const url = URL.createObjectURL(content);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `导出备份_${new Date().getTime()}.zip`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  toastSuccess('已开始下载 ZIP');
                }
              }),
              el('button', {
                class: 'btn btn-ghost', text: '📂 逐个直接下载', onClick: async () => {
                  mask.remove();
                  for (const id of selected) {
                    const rec = await dbGet('images', id);
                    if (rec && rec.annotatedBlob) {
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(rec.annotatedBlob);
                      a.download = rec.name || `导出图片_${id.slice(0, 6)}.png`;
                      a.click();
                      await new Promise(r => setTimeout(r, 300)); // 防止浏览器拦截
                    } else if (rec && rec.pdfId) {
                      const pdfRec = await dbGet('pdfs', rec.pdfId);
                      if (pdfRec) {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(pdfRec.blob);
                        a.download = pdfRec.name || `导出文档_${id.slice(0, 6)}.pdf`;
                        a.click();
                        await new Promise(r => setTimeout(r, 300));
                      }
                    }
                  }
                  toastSuccess('已触发下载');
                }
              }),
              el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
            ])
          ]);
          mask.appendChild(box);
          document.body.appendChild(mask);
        }
      }),

      //重命名功能
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '重命名',
        style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' },
        onClick: () => {
          if (selected.size === 0) return toastError('请先选择文件');
          if (selected.size > 1) return toastError('目前仅支持单文件重命名');

          const id = [...selected][0];
          openInputModal('重命名', '请输入新名称', async (newName) => {
            if (!newName.trim()) return;
            const imgRec = await dbGet('images', id);
            if (imgRec) { imgRec.name = newName.trim(); await dbPut('images', imgRec); }
            toastSuccess('重命名成功');
            onRefresh();
          });
        }
      }),

      //复制
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '复制',
        style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' },
        onClick: () => {
          if (selected.size === 0) return toastError('请先选择文件');
          window._imgClipboard = Array.from(selected);
          toastSuccess(`已复制 ${selected.size} 个文件到内部剪贴板`);
        }
      }),

      //粘贴（带路径选择）
      el('button', {
        class: 'btn btn-sm btn-ghost', text: '粘贴',
        style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' },
        onClick: () => {
          if (!window._imgClipboard || window._imgClipboard.length === 0) return toastError('剪贴板为空，请先复制文件');

          const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
          const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
            el('h3', { text: '选择粘贴位置' }),
            el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: `剪贴板中有 ${window._imgClipboard.length} 个文件` }),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' } }, [
              el('button', {
                class: 'btn btn-primary', text: '📁 粘贴到当前文件夹', onClick: async () => {
                  mask.remove();
                  await doPasteToPoint(point.id);
                }
              }),
              el('button', {
                class: 'btn btn-ghost', text: '📂 选择其他文件夹粘贴...', onClick: () => {
                  mask.remove();
                  const targetPointId = prompt('请输入目标知识点/卡片的 ID', point.id);
                  if (targetPointId) {
                    if (store.getPoint(targetPointId)) {
                      doPasteToPoint(targetPointId);
                    } else {
                      toastError('未找到对应的知识点，粘贴失败');
                    }
                  }
                }
              }),
              el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
            ])
          ]);
          mask.appendChild(box);
          document.body.appendChild(mask);

          async function doPasteToPoint(targetId) {
            const targetPt = store.getPoint(targetId);
            if (!targetPt) return;
            for (const oldId of window._imgClipboard) {
              const rec = await dbGet('images', oldId);
              if (rec) {
                const newId = uuid();
                await dbPut('images', { ...rec, id: newId, createdAt: new Date().toISOString() });
                if (!targetPt.imageIds) targetPt.imageIds = [];
                targetPt.imageIds.push(newId);
              }
            }
            store.updatePoint(targetPt.id, { imageIds: targetPt.imageIds });
            toastSuccess(`成功粘贴 ${window._imgClipboard.length} 个文件`);
            selected.clear();
            if (targetId === point.id) onRefresh();
          }
        }
      }),

      //删除功能
      el('button', {
        class: 'btn btn-sm btn-danger', text: '删除',
        style: { padding: '2px 6px', fontSize: '12px', minHeight: '26px' },
        onClick: () => {
          if (selected.size === 0) return toastError('请先选择文件');
          if (confirm(`确定将选中的 ${selected.size} 个文件移入回收站？`)) {
            const pt = store.getPoint(point.id);
            // 1. 获取卡片名称，如果为空则显示“未命名卡片”
            const pointName = (pt.name || '').replace(/<[^>]+>/g, '') || '未命名卡片';

            // 2. 尝试获取所属文件夹/章节名称（假设 store 有 getChapter 方法，请根据实际调整）
            let folderName = '未知文件夹';
            if (pt.chapterId && store.getChapter) {
              const ch = store.getChapter(pt.chapterId);
              if (ch) folderName = (ch.name || '').replace(/<[^>]+>/g, '') || '未命名文件夹';
            }

            // 3. 逐个推入回收站，带上完整的层级信息
            selected.forEach(id => {
              store.pushRecycle('image', {
                pointId: pt.id,
                pointName: pointName,
                folderName: folderName, // 新增文件夹名称
                imageId: id
              });
            });

            pt.imageIds = (pt.imageIds || []).filter(id => !selected.has(id));
            store.updatePoint(pt.id, { imageIds: pt.imageIds });
            selected.clear();
            toastSuccess('已移入回收站');
            onRefresh();
          }
        }
      })
    ]) : null,

    //6. 搜索框
    el('input', {
      type: 'text', placeholder: '🔍 搜索文件...',
      value: searchQuery,
      style: {
        flex: '1',
        minWidth: '140px',
        maxWidth: '300px',
        padding: '4px 10px',
        borderRadius: '20px',
        border: '1px solid rgba(0,0,0,.1)',
        fontSize: '13px',
        outline: 'none',
        height: '28px',
        zIndex: '10'
      },
      onInput: (e) => { searchQuery = e.target.value.toLowerCase(); onRefresh(); }
    })
  ]);
  wrap.appendChild(topBar);

  // 自动给这个操作栏里的所有按钮加上“长按提示”
  // 延时执行，确保按钮都已经挂载到 DOM 上
  setTimeout(() => {
    topBar.querySelectorAll('button').forEach(btn => {
      // 如果按钮本身没有 title 属性，我们根据它的文字给它赋一个
      let tip = btn.getAttribute('title');
      if (!tip) {
        const text = btn.innerText.trim();
        if (text.includes('加图片')) tip = '从相册选择图片上传';
        else if (text.includes('加 PDF')) tip = '从本地导入 PDF 文档';
        else if (text === '🖼') tip = '图文模式';
        else if (text === '▦') tip = '纯缩略图模式';
        else if (text === '📄') tip = '列表模式';
        else if (text === '⬇️') tip = '全部展开';
        else if (text === '⬆️') tip = '全部收起';
        else if (text === '📁+') tip = '新建文件夹';
        else if (text.includes('多选')) tip = '开启/关闭批量选择';
        else if (text === '导出') tip = '将选中的文件导出';
        else if (text === '重命名') tip = '批量重命名选中文件';
        else if (text === '删除') tip = '删除选中文件';
        else tip = text || '操作按钮';
      }
      // 如果你在 main.js 里写了全局的 attachLongPressTooltip 函数，直接调用它
      if (typeof attachLongPressTooltip === 'function') {
        attachLongPressTooltip(btn, tip);
      }
    });
  }, 100);

  // ============ 内容区 ============
  const contentWrap = el('div', { style: { marginTop: '-4px' } }); //强行往上顶，吃掉多余间隙
  wrap.appendChild(contentWrap);

  const loadAndRender = async () => {
    const finalImages = [];
    const finalPdfs = [];

    for (const id of allIds) {
      const rec = await dbGet('images', id);
      if (!rec) continue;

      // 1. 是 PDF 占位符，进 PDF 列表
      if (rec.type === 'pdf_placeholder') {
        finalPdfs.push(rec);
        continue;
      }

      // 2. 如果是从 PDF 画板存的图（不管新旧），绝对过滤掉
      const isPdfInk = (rec.source && rec.source.includes('pdf')) || (rec.name && rec.name.includes('pdf_'));
      if (isPdfInk) {
        continue;
      }

      // 3. 剩下的不管你传的是什么，全部算正常图片！
      finalImages.push(rec);
    }

    // 记录分类 id，供顶栏「全部 / 仅图片 / 仅PDF」使用（必须在 rawList 过滤之前取全量）
    lastImageIds = finalImages.map(r => r.id);
    lastPdfIds = finalPdfs.map(r => r.id);

    // 支持“最近”Tab 的过滤
    let rawList = [];
    if (activeTab === 'images') rawList = finalImages;
    else if (activeTab === 'pdfs') rawList = finalPdfs;
    else if (activeTab === 'recent') {
      // 最近列表里，也不允许展示 PDF 笔迹图
      rawList = [...finalImages, ...finalPdfs].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()).slice(0, 10);
    }

    // 应用搜索过滤
    if (searchQuery) {
      rawList = rawList.filter(rec => {
        const title = rec.type === 'pdf_placeholder' ? rec.pdfName : (rec.name || '图片');
        return title.toLowerCase().includes(searchQuery);
      });
    }

    //应用排序
    rawList.sort((a, b) => {
      const sizeA = (a.originalBlob && a.originalBlob.size) || 0;
      const sizeB = (b.originalBlob && b.originalBlob.size) || 0;
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      const updateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const updateB = new Date(b.updatedAt || b.createdAt || 0).getTime();

      const nameA = a.type === 'pdf_placeholder' ? a.pdfName : (a.name || '图片');
      const nameB = b.type === 'pdf_placeholder' ? b.pdfName : (b.name || '图片');

      if (sortOrder === 'size-desc') return sizeB - sizeA;
      else if (sortOrder === 'size-asc') return sizeA - sizeB;
      else if (sortOrder === 'time-desc') return timeB - timeA;
      else if (sortOrder === 'time-asc') return timeA - timeB;
      else if (sortOrder === 'update-desc') return updateB - updateA;
      else if (sortOrder === 'update-asc') return updateA - updateB;
      else if (sortOrder === 'name-asc') return nameA.localeCompare(nameB);

      return timeB - timeA;
    });

    //3. 获取所有文件夹（不再自动清理空文件夹）
    let allFolders = getAllFolders();
    const renameTarget = sessionStorage.getItem('kg_rename_folder');

    // 归类
    const groupedList = { '': [] }; // 空字符串代表未分组
    allFolders.forEach(f => { groupedList[f] = []; });

    rawList.forEach(rec => {
      const g = rec.group || '';
      if (!groupedList[g]) groupedList[g] = []; // 容错
      groupedList[g].push(rec);
    });

    // 排序：未分组在最前，其他按层级
    const cmpPath = (a, b) => {
      const as = a.split('/'), bs = b.split('/');
      const n = Math.min(as.length, bs.length);
      for (let i = 0; i < n; i++) {
        const c = as[i].localeCompare(bs[i]);
        if (c !== 0) return c;
      }
      return as.length - bs.length;   // 同前缀时父级排前
    };
    const sortedGroups = Object.keys(groupedList).sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return cmpPath(a, b);
    });

    if (rawList.length === 0 && allFolders.length === 0) {
      contentWrap.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '20px' }, text: activeTab === 'images' ? '暂无图片' : '暂无 PDF 文档' }));
      return;
    }

    const collapsed = getCollapsed();
    const locked = getLocked();

    sortedGroups.forEach(groupName => {
      const groupFiles = groupedList[groupName] || [];

      // 未分组且没文件，直接跳过
      if (groupName === '' && groupFiles.length === 0) return;

      //优先判断全局的“强制展开/收起”开关
      let isCollapsed = false;
      if (window.forceExpandAll) {
        isCollapsed = false;
      } else if (window.forceCollapseAll) {
        isCollapsed = true;
      } else {
        // 未分组也用一个固定 key 参与折叠记忆（原来 groupName='' 从不写入，所以永远展不开也收不起来）
        const collapseKey = groupName === '' ? '__ungrouped__' : groupName;
        isCollapsed = !!collapsed[collapseKey];
      }
      const isLocked = !!locked[groupName];
      const level = (groupName.match(/\//g) || []).length;
      const indent = level * 16;
      const displayName = groupName.split('/').pop() || '未分组文件';

      const isNewFolder = (groupName === renameTarget);

      //找出所有真正拥有文件的文件夹
      const groupsWithFiles = Object.keys(groupedList).filter(k => k !== '' && groupedList[k].length > 0);
      // 如果当前有文件的文件夹只有 1 个，而且名字跟当前循环的一致，那就彻底跳过渲染
      const shouldHideHeader = (groupsWithFiles.length === 1 && groupsWithFiles[0] === groupName);

      // 只有当它不该被隐藏时，才生成 header 这个 DOM 元素
      let header = null;
      if (!shouldHideHeader) {
        header = el('div', {
          onDragOver: (e) => { e.preventDefault(); e.currentTarget.style.background = 'rgba(142,202,230,0.1)'; },
          onDragLeave: (e) => { e.preventDefault(); e.currentTarget.style.background = 'transparent'; },
          onDrop: async (e) => {
            e.preventDefault();
            e.currentTarget.style.background = 'transparent';
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId) return;
            const rec = await dbGet('images', draggedId);
            if (rec) {
              rec.group = groupName;
              await dbPut('images', rec);
              toastSuccess(`已移入「${displayName}」`);
              onRefresh();
            }
          },
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 4px', paddingBottom: '4px', borderBottom: groupName === '' ? 'none' : '1px dashed rgba(0,0,0,.1)', paddingLeft: indent + 'px', borderRadius: '4px', transition: 'background 0.2s' }
        }, [
          el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)', cursor: 'pointer', userSelect: 'none' },
            onClick: () => {
              if (isLocked) {
                const pwd = prompt(`文件夹「${displayName}」已加密，请输入密码解锁：`);
                if (pwd === locked[groupName]) { delete locked[groupName]; saveLocked(locked); onRefresh(); }
                else if (pwd !== null) { toastError('密码错误'); }
                return;
              }

              //解除全局强制状态
              window.forceExpandAll = false;
              window.forceCollapseAll = false;

              collapsed[groupName === '' ? '__ungrouped__' : groupName] = !isCollapsed;
              saveCollapsed(collapsed);
              onRefresh();
            },
            onDblClick: (e) => {
              e.stopPropagation();
              if (groupName === '') return;
              const newName = prompt('输入新文件夹名（支持 / 建子文件夹）：', displayName);
              if (!newName || newName.trim() === displayName) return;

              const finalNewName = newName.trim();
              const parent = level > 0 ? groupName.split('/').slice(0, -1).join('/') + '/' : '';
              const fullNew = parent + finalNewName;

              groupFiles.forEach(async f => {
                const rec = await dbGet('images', f.id);
                if (rec) { rec.group = fullNew; await dbPut('images', rec); }
              });
              const folders = getAllFolders().filter(f => f !== groupName);
              if (!folders.includes(fullNew)) folders.push(fullNew);
              saveAllFolders(folders);
              onRefresh();
            }
          }, [
            el('span', {
              class: 'group-toggle-arrow',
              text: isCollapsed ? '▸' : '▾',
              style: {
                display: 'inline-block',
                transition: 'transform .2s',
                transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                fontSize: '14px',
                color: '#666',
                cursor: 'pointer'
              }
            }),
            el('span', {
              text: groupName === '' ? `📄 未分组文件 (${groupFiles.length})` : `📁 ${displayName} (${groupFiles.length})`,
              style: isNewFolder ? { color: 'var(--danger)', textDecoration: 'underline' } : {}
            })
          ]),

          // 智能防遮挡折叠菜单
          groupName !== '' && !isLocked ? el('button', {
            class: 'btn btn-sm btn-ghost',
            text: '▾',
            title: '更多操作',
            style: { fontSize: '18px', padding: '4px 10px' },
            onClick: (e) => {
              e.stopPropagation();
              const existingMenu = document.getElementById('floating-folder-menu');
              if (existingMenu) { existingMenu.remove(); return; }
              const btnRect = e.currentTarget.getBoundingClientRect();
              const menu = el('div', {
                id: 'floating-folder-menu',
                style: { position: 'fixed', background: 'var(--card)', border: '1px solid rgba(0,0,0,.1)', borderRadius: '8px', padding: '6px', zIndex: 999999, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '140px', maxHeight: '300px', overflowY: 'auto' }
              });
              const spaceBelow = window.innerHeight - btnRect.bottom;
              if (spaceBelow < 300) { menu.style.bottom = (window.innerHeight - btnRect.top + 4) + 'px'; }
              else { menu.style.top = (btnRect.bottom + 4) + 'px'; }
              menu.style.left = Math.max(10, btnRect.right - 160) + 'px';
              const closeMenu = () => menu.remove();
              setTimeout(() => {
                document.addEventListener('pointerdown', (ev) => {
                  if (!menu.contains(ev.target)) closeMenu();
                }, { once: true });
              }, 50);

              const addMenuItem = (text, danger, onClickAction) => {
                menu.appendChild(el('button', {
                  class: 'btn btn-sm btn-ghost', text: text,
                  style: { justifyContent: 'flex-start', padding: '8px 12px', color: danger ? 'var(--danger)' : 'inherit' },
                  onClick: () => { closeMenu(); onClickAction(); }
                }));
              };

              addMenuItem('📁＋ 在此建子文件夹', false, () => {
                openInputModal('新建子文件夹', '子文件夹名称（还可用 / 继续往下建）', (raw) => {
                  const clean = (raw || '').split('/').map(s => s.trim()).filter(Boolean).join('/');
                  if (!clean) return toastError('名称不能为空');
                  const folders = getAllFolders();
                  const full = `${groupName}/${clean}`;
                  // 逐级登记，保证每一层父级都在清单里
                  const segs = full.split('/');
                  for (let i = 1; i <= segs.length; i++) {
                    const p = segs.slice(0, i).join('/');
                    if (!folders.includes(p)) folders.push(p);
                  }
                  sessionStorage.setItem('kg_rename_folder', full);
                  saveAllFolders(folders);
                  toastSuccess(`已创建「${full}」`);
                  // 父级自动展开，新建的子级立刻看得见
                  const c = getCollapsed(); delete c[groupName]; saveCollapsed(c);
                  window.forceExpandAll = false; window.forceCollapseAll = false;
                  onRefresh();
                });
              });

              addMenuItem('☑ 全选本组', false, () => { isMulti = true; groupFiles.forEach(f => selected.add(f.id)); onRefresh(); });
              addMenuItem('⬜ 全不选本组', false, () => { groupFiles.forEach(f => selected.delete(f.id)); onRefresh(); });
              addMenuItem('📁 移动到...', false, () => {
                const thisGroupSelected = new Set(groupFiles.filter(f => selected.has(f.id)).map(f => f.id));
                if (thisGroupSelected.size === 0) groupFiles.forEach(f => thisGroupSelected.add(f.id));
                openMoveModal(thisGroupSelected, onRefresh);
              });
              addMenuItem('📦 导出整组为 ZIP', false, async () => {
                if (typeof JSZip === 'undefined') { toastError('JSZip未加载'); return; }
                const zip = new JSZip(); const folder = zip.folder(displayName);
                toastSuccess('打包中，请稍候...');
                for (let i = 0; i < groupFiles.length; i++) {
                  const f = groupFiles[i]; const blob = f.annotatedBlob || f.originalBlob || f.blob;
                  if (blob) folder.file(`${f.name || '文件'}_${i + 1}.${f.type === 'pdf_placeholder' ? 'pdf' : 'png'}`, blob);
                }
                try {
                  const content = await zip.generateAsync({ type: 'blob' });
                  if (typeof downloadFileWithPath === 'function') downloadFileWithPath(content, `${displayName}.zip`, 'application/zip', ['.zip']);
                  else { const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `${displayName}.zip`; a.click(); }
                } catch (err) { toastError('打包失败'); }
              });
              addMenuItem('ℹ️ 文件夹详情', false, () => {
                let folderTimes = {};
                try { folderTimes = JSON.parse(localStorage.getItem('kg_folder_create_times') || '{}'); } catch { }
                let createTimeStr = folderTimes[groupName] ? new Date(folderTimes[groupName]).toLocaleString() : '较早创建';
                let totalBytes = 0;
                for (const f of groupFiles) {
                  if (f.type === 'pdf_placeholder') {
                    const pdfRec = f; if (pdfRec && pdfRec.blob) totalBytes += pdfRec.blob.size;
                  } else {
                    if (f.originalBlob) totalBytes += f.originalBlob.size;
                    if (f.annotatedBlob && f.annotatedBlob !== f.originalBlob) totalBytes += f.annotatedBlob.size;
                  }
                }
                const sizeStr = totalBytes > 1024 * 1024 ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB` : `${(totalBytes / 1024).toFixed(1)} KB`;
                const mask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999 } });
                const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
                  el('h3', { text: '📁 文件夹详情' }),
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', margin: '16px 0' } }, [
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '文件夹名' }), el('span', { style: { fontWeight: '600' }, text: displayName })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '文件数量' }), el('span', { style: { fontWeight: '600' }, text: `${groupFiles.length} 个文件` })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '占用空间' }), el('span', { style: { fontWeight: '600', color: 'var(--primary)' }, text: sizeStr })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '创建时间' }), el('span', { style: { fontWeight: '600' }, text: createTimeStr })])
                  ]),
                  el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-primary', text: '关闭', onClick: () => mask.remove() })])
                ]);
                mask.appendChild(box); document.body.appendChild(mask);
              });
              addMenuItem('🔒 加密该组', false, () => {
                const pwd = prompt('设置密码（留空则取消加密）：');
                if (pwd === null) return;
                if (pwd.trim()) { locked[groupName] = pwd.trim(); toastSuccess('已加密'); }
                else { delete locked[groupName]; toastSuccess('已取消'); }
                saveLocked(locked); onRefresh();
              });
              addMenuItem('🗑 删除分组', true, () => {
                const mask = el('div', { class: 'confirm-mask', style: { zIndex: 9999999 } });
                const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px', textAlign: 'center' } }, [
                  el('h3', { text: '删除文件夹' }),
                  el('p', { style: { fontSize: '14px', color: 'var(--text-2)', margin: '12px 0', textAlign: 'left' }, text: `如何处理「${displayName}」里的 ${groupFiles.length} 个文件？` }),
                  el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' } }, [
                    el('button', {
                      class: 'btn btn-primary', text: '📁 仅删文件夹，文件退回上一级', onClick: async () => {
                        mask.remove(); toastSuccess('正在处理...');
                        for (const f of groupFiles) {
                          const rec = await dbGet('images', f.id);
                          if (rec) {
                            const parent = level > 0 ? groupName.split('/').slice(0, -1).join('/') : null;
                            if (parent) rec.group = parent; else delete rec.group;
                            await dbPut('images', rec);
                          }
                        }
                        const parentPrefix = level > 0 ? groupName.split('/').slice(0, -1).join('/') + '/' : '';
                        // 子文件夹整体跟着上移一级，不遗留孤儿
                        let folders = getAllFolders().filter(f => f !== groupName);
                        const kids = folders.filter(f => f.startsWith(groupName + '/'))
                          .sort((a, b) => a.length - b.length);
                        folders = folders.filter(f => !f.startsWith(groupName + '/'));
                        for (const k of kids) {
                          const nk = parentPrefix + k.slice(groupName.length + 1);
                          if (!folders.includes(nk)) folders.push(nk);
                        }
                        // 组内文件退回上一级
                        for (const f of groupFiles) {
                          const rec = await dbGet('images', f.id);
                          if (rec) { rec.group = parentPrefix ? parentPrefix.slice(0, -1) : rec.group; if (!parentPrefix) delete rec.group; await dbPut('images', rec); }
                        }
                        saveAllFolders(folders); onRefresh();
                      }
                    }),
                    el('button', {
                      class: 'btn btn-danger', text: '🗑 连同文件一起彻底删除', onClick: async () => {
                        if (!confirm(`⚠️ 警告：确定要彻底删除文件夹及里面的所有文件吗？此操作不可恢复！`)) return;
                        mask.remove(); toastSuccess('正在删除...');
                        const pt = store.getPoint(point.id);
                        for (const f of groupFiles) {
                          const rec = await dbGet('images', f.id);
                          if (rec && rec.type === 'pdf_placeholder' && rec.pdfId) await dbDelete('pdfs', rec.pdfId);
                          await dbDelete('images', f.id);
                          if (pt && pt.imageIds) pt.imageIds = pt.imageIds.filter(id => id !== f.id);
                        }
                        if (pt) store.updatePoint(pt.id, { imageIds: pt.imageIds });
                        const folders = getAllFolders().filter(f => f !== groupName && !f.startsWith(groupName + '/'));
                        saveAllFolders(folders); onRefresh();
                      }
                    }),
                    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
                  ])
                ]);
                mask.appendChild(box); document.body.appendChild(mask);
              });

              document.body.appendChild(menu);
            }
          }) : null
        ]);
      } //这是补上的 if (!shouldHideHeader) 闭合！

      //如果刚才新建了，立刻弹出重命名
      if (isNewFolder) {
        sessionStorage.removeItem('kg_rename_folder');
        setTimeout(() => {
          const newName = prompt('请为新文件夹命名：', displayName);
          if (newName && newName.trim() && newName.trim() !== displayName) {
            const finalNewName = newName.trim();
            const folders = getAllFolders().filter(f => f !== groupName);
            if (!folders.includes(finalNewName)) folders.push(finalNewName);
            saveAllFolders(folders);
            onRefresh();
          }
        }, 100);
      }

      // 如果未分组且里面没文件，直接跳过
      if (groupName === '' && groupFiles.length === 0) return;

      //只有生成了 header 才把它加进去
      if (header) {
        contentWrap.appendChild(header);
      }

      // 渲染文件网格
      if (!isCollapsed && !isLocked) {
        const gridStyle = activeTab === 'pdfs'
          ? { display: 'flex', flexDirection: 'column', width: '100%', gap: '6px', marginBottom: '16px', paddingLeft: indent + 'px' }
          : { display: viewMode !== 'name' ? 'grid' : 'flex', flexDirection: viewMode !== 'name' ? undefined : 'column', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px', marginBottom: '16px', paddingLeft: indent + 'px' };

        const groupGrid = el('div', { style: gridStyle });

        groupFiles.forEach((rec, idx) => {
          let card;

          // 详情按钮
          const detailBtn = el('button', {
            style: { background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '12px', cursor: 'pointer', zIndex: 10 },
            text: 'ℹ️',
            onClick: (e) => { e.stopPropagation(); showFileDetails(rec); }
          });

          // 大图压缩标签
          let sizeTag = null;
          const rawSize = rec.originalBlob ? rec.originalBlob.size : 0;
          if (rawSize > 2 * 1024 * 1024) {
            sizeTag = el('div', {
              style: { position: 'absolute', top: '4px', left: '4px', background: 'var(--danger)', color: '#fff', padding: '2px 6px', fontSize: '11px', borderRadius: '4px', zIndex: 10, cursor: 'pointer' },
              text: '🗜 大图',
              title: '点击一键压缩到 1MB 以内',
              onClick: async (e) => {
                e.stopPropagation();
                const img = new Image(); const url = URL.createObjectURL(rec.annotatedBlob || rec.originalBlob);
                await new Promise(r => { img.onload = r; img.src = url; });
                const canvas = document.createElement('canvas');
                const MAX_W = 1000; canvas.width = MAX_W; canvas.height = img.height * (MAX_W / img.width);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                const compressed = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
                rec.annotatedBlob = compressed; rec.originalBlob = compressed;
                await dbPut('images', rec);
                URL.revokeObjectURL(url);
                toastSuccess('已压缩');
                onRefresh();
              }
            });
          }

          // 拖拽属性配置
          const dragAttr = {
            draggable: 'true',
            onDragStart: (e) => {
              e.dataTransfer.setData('text/plain', rec.id);
              e.dataTransfer.effectAllowed = 'move';
            }
          };

          if (activeTab === 'pdfs') {
            card = el('div', {
              ...dragAttr,
              style: {
                position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 10px', background: '#FFF0F0',
                borderRadius: '6px', border: '1px solid rgba(0,0,0,.06)',
                cursor: 'pointer', width: '100%', boxSizing: 'border-box'
              },
              onClick: () => handleClick(rec, latestPoint, onRefresh)
            }, [
              isMulti ? el('input', { type: 'checkbox', checked: selected.has(rec.id), style: { width: '16px', height: '16px', flexShrink: '0', margin: '0' }, onClick: (e) => e.stopPropagation() }) : null,
              el('div', { style: { fontSize: '18px' }, text: '📄' }),
              el('div', { style: { flex: '1', overflow: 'hidden' } }, [
                el('div', { style: { fontWeight: '500', fontSize: '13px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }, text: rec.pdfName }),
              ]),
              detailBtn, sizeTag
            ]);

          } else {
            if (viewMode === 'name') {
              const thumbIcon = el('div', { style: { width: '32px', height: '32px', borderRadius: '4px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: '0' } });
              const rawBlob = rec.annotatedBlob || rec.originalBlob;
              if (rawBlob instanceof Blob && rawBlob.size > 0) {
                const url = URL.createObjectURL(rawBlob);
                thumbIcon.appendChild(el('img', {
                  src: url,
                  loading: 'lazy',
                  decoding: 'async',
                  style: { width: '100%', height: '100%', objectFit: 'cover' },
                  onLoad: () => URL.revokeObjectURL(url)
                }));
              } else {
                thumbIcon.appendChild(el('span', { style: { fontSize: '16px' }, text: '🖼' }));
              }
              card = el('div', {
                ...dragAttr,
                style: {
                  position: 'relative', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 10px',
                  background: '#fff',
                  borderRadius: '6px', border: '1px solid rgba(0,0,0,.08)',
                  cursor: 'pointer', width: '100%', boxSizing: 'border-box'
                },
                onClick: () => handleClick(rec, latestPoint, onRefresh)
              }, [
                isMulti ? el('input', { type: 'checkbox', checked: selected.has(rec.id), style: { width: '16px', height: '16px', flexShrink: '0', margin: '0' }, onClick: (e) => e.stopPropagation() }) : null,
                thumbIcon,
                el('div', { style: { flex: '1', fontSize: '13px', fontWeight: '500', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }, text: rec.name || `图片 ${idx + 1}` }),
                detailBtn, sizeTag
              ]);
            } else {
              card = el('div', {
                ...dragAttr,
                style: { position: 'relative', borderRadius: '8px', overflow: 'hidden', background: '#f0f0f0', border: '1px solid rgba(0,0,0,.08)', cursor: 'pointer', display: 'flex', flexDirection: 'column' },
                onClick: () => handleClick(rec, latestPoint, onRefresh)
              });
              const rawBlob = rec.annotatedBlob || rec.originalBlob;
              if (rawBlob instanceof Blob && rawBlob.size > 0) {
                const url = URL.createObjectURL(rawBlob);
                card.appendChild(el('img', {
                  src: url,
                  loading: 'lazy',
                  decoding: 'async',
                  style: { width: '100%', height: viewMode === 'thumb' ? '80px' : '100px', objectFit: 'cover' },
                  onLoad: () => URL.revokeObjectURL(url)
                }));
              } else {
                card.appendChild(el('div', { style: { width: '100%', height: viewMode === 'thumb' ? '80px' : '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#999' }, text: '🖼' }));
              }
              if (viewMode === 'both') {
                card.appendChild(el('div', { style: { padding: '6px', fontSize: '12px', textAlign: 'center', background: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', boxSizing: 'border-box' }, text: rec.name || `图片 ${idx + 1}` }));
              }
              if (isMulti) card.appendChild(el('input', { type: 'checkbox', checked: selected.has(rec.id), style: { position: 'absolute', top: '8px', left: '8px', width: '20px', height: '20px', zIndex: '10', margin: '0' }, onClick: (e) => e.stopPropagation() }));
              card.appendChild(el('div', { style: { position: 'absolute', top: '4px', right: '4px' } }, [detailBtn]));
              if (sizeTag) card.appendChild(sizeTag);
            }
          }

          groupGrid.appendChild(card);
        });

        if (groupFiles.length > 0 || groupName !== '') {
          contentWrap.appendChild(groupGrid);
        }
      }
    });
  };



  // ============ 文件详情 ============
  async function showFileDetails(rec) {
    let sizeText = '未知';
    let typeText = rec.type === 'pdf_placeholder' ? 'PDF 文档' : '图片';
    let dimensionText = '';

    if (rec.type === 'pdf_placeholder') {
      const { dbAll } = await import('../db.js');
      const pdfs = await dbAll('pdfs');
      const pdf = pdfs.find(p => p.id === rec.pdfId);
      if (pdf && pdf.blob) sizeText = (pdf.blob.size / 1024 / 1024).toFixed(2) + ' MB';
      // 占位记录初值是 0（异步补页数后才变数字），不能用 `|| '?'`——0 会被判假
      dimensionText = (typeof rec.pdfPages === 'number' && rec.pdfPages > 0)
        ? `共 ${rec.pdfPages} 页`
        : '页数读取中…';
    } else {
      if (rec.originalBlob) sizeText = (rec.originalBlob.size / 1024).toFixed(1) + ' KB';
      dimensionText = `${rec.width || 0} × ${rec.height || 0} px`;
    }

    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 }, onClick: (e) => { if (e.target === mask) mask.remove(); } }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
        el('h3', { text: 'ℹ️ 文件详情' }),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', margin: '16px 0' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '文件名' }), el('span', { style: { fontWeight: '600', wordBreak: 'break-all', textAlign: 'right' }, text: rec.name || rec.pdfName || '未命名' })]),
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '类型' }), el('span', { text: typeText })]),
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '大小' }), el('span', { text: sizeText })]),
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '尺寸/页数' }), el('span', { text: dimensionText })]),
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '分组' }), el('span', { text: rec.group || '未分组' })]),
          el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '创建时间' }), el('span', { text: rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '未知' })]),
        ]),
        el('div', { class: 'confirm-actions' }, [
          el('button', { class: 'btn btn-primary', text: '关闭', onClick: () => mask.remove() })
        ])
      ])
    ]);
    document.body.appendChild(mask);
  }

  // ============ 点击文件 ============
  async function handleClick(rec, latestPoint, onRefresh) {
    if (isMulti) {
      if (selected.has(rec.id)) selected.delete(rec.id);
      else selected.add(rec.id);
      onRefresh();
      return;
    }

    if (rec.type === 'pdf_placeholder') {
      window.location.hash = `#/pdf-viewer/${rec.pdfId}?pointId=${latestPoint.id}`;
      return;
    }

    const rawBlob = rec.annotatedBlob || rec.originalBlob;
    if (!(rawBlob instanceof Blob) || rawBlob.size === 0) {
      toastError('该文件内容异常，无法预览');
      return;
    }

    window.location.hash = `#/annotate/${rec.id}?pointId=${latestPoint.id}`;
  }

  // ============ 全屏大图预览 ============
  async function openLightbox(imageId, point, onRefresh) {
    const rec = await dbGet('images', imageId);
    if (!rec) { toastError('图片丢失'); return; }
    const blob = rec.annotatedBlob || rec.originalBlob;
    if (!(blob instanceof Blob) || blob.size === 0) { toastError('图片内容异常'); return; }
    const url = URL.createObjectURL(blob);

    let isImmersive = false;
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'rgba(0,0,0,0.92)', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } });
    //支持双指缩放与单指平移
    const imgEl = el('img', { src: url, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transition: 'transform 0.1s', transformOrigin: 'center center' } });
    const imgWrap = el('div', {
      style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: 'grab', overflow: 'hidden' }
    }, [imgEl]);

    // 手势状态变量
    let scale = 1, panX = 0, panY = 0;
    let startDist = 0, startScale = 1;
    let startX = 0, startY = 0;
    let isDragging = false;

    imgWrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        startDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        startScale = scale;
      } else if (e.touches.length === 1 && scale > 1.05) {
        isDragging = true;
        startX = e.touches[0].clientX - panX;
        startY = e.touches[0].clientY - panY;
      }
    }, { passive: false });

    imgWrap.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault(); // 阻止页面滚动
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        scale = Math.max(1, Math.min(5, startScale * (dist / startDist)));
        imgEl.style.transform = `scale(${scale}) translate(${panX / scale}px, ${panY / scale}px)`;
      } else if (isDragging && e.touches.length === 1 && scale > 1.05) {
        e.preventDefault();
        panX = e.touches[0].clientX - startX;
        panY = e.touches[0].clientY - startY;
        imgEl.style.transform = `scale(${scale}) translate(${panX / scale}px, ${panY / scale}px)`;
      }
    }, { passive: false });

    imgWrap.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        isDragging = false;
        if (scale <= 1.05) {
          scale = 1; panX = 0; panY = 0;
          imgEl.style.transform = 'scale(1)';
        }
      }
    });
    // 👆 手势逻辑结束

    const toolbar = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', width: '100%', maxWidth: '600px', marginTop: '20px' } }, [
      // 复制当前图
      el('button', {
        class: 'btn btn-ghost', text: '📋 复制', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
        onClick: () => {
          sessionStorage.setItem('kg_clipboard_files', JSON.stringify([imageId]));
          localStorage.removeItem('kg_clipboard_folders');
          toastSuccess('已复制该图片');
        }
      }),

      // 粘贴到当前图所在的分组
      el('button', {
        class: 'btn btn-ghost', text: '📥 粘贴', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
        onClick: async () => {
          const clipFilesStr = sessionStorage.getItem('kg_clipboard_files');
          if (!clipFilesStr) { toastError('剪贴板为空'); return; }
          const clipIds = JSON.parse(clipFilesStr);
          const pt = store.getPoint(point.id);
          if (!pt.imageIds) pt.imageIds = [];

          toastSuccess('正在粘贴...');
          const currentRec = await dbGet('images', imageId);
          const currentGroup = currentRec ? currentRec.group : undefined;

          for (const oldId of clipIds) {
            const rec = await dbGet('images', oldId);
            if (rec) {
              const newId = uuid();
              await dbPut('images', { ...rec, id: newId, group: currentGroup, createdAt: new Date().toISOString() });
              pt.imageIds.push(newId);
            }
          }
          store.updatePoint(pt.id, { imageIds: pt.imageIds });
          toastSuccess('粘贴成功');
          mask.remove(); URL.revokeObjectURL(url); onRefresh();
        }
      }),
      // 一键提取文字 (OCR)
      el('button', {
        class: 'btn btn-ghost', text: '🔤 提取文字',
        style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
        onClick: async () => {
          if (!checkLib('Tesseract').ok) { toastError(checkLib('Tesseract').hint); return; }

          toastSuccess('正在识别文字，请稍候…');
          try {
            // 直接调用全局的 Tesseract 识别
            const result = await ocrRecognize(blob, 'chi_sim+eng');
            const text = result.data.text.trim();

            if (!text) {
              toastError('未识别到文字，请确认图片是否清晰');
              return;
            }

            // 弹出结果供用户复制或建卡
            const maskOcr = el('div', { class: 'confirm-mask', style: { zIndex: 9999999 } });
            const boxOcr = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
              el('h3', { text: '🔤 识别结果' }),
              el('textarea', {
                value: text,
                style: { width: '100%', height: '150px', padding: '10px', margin: '12px 0', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', fontSize: '14px', resize: 'none', outline: 'none' }
              }),
              el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
                el('button', {
                  class: 'btn btn-ghost', text: '📋 复制',
                  onClick: async () => {
                    await navigator.clipboard.writeText(text);
                    toastSuccess('已复制到剪贴板');
                    maskOcr.remove();
                  }
                }),
                el('button', {
                  class: 'btn btn-primary', text: '📥 存为新卡片',
                  onClick: () => {
                    const pt = store.getPoint(point.id);
                    if (pt) {
                      const newPoint = store.createPoint({
                        chapterId: pt.chapterId,
                        content: text,
                        imageIds: [imageId] // 顺便把原图也带上
                      });
                      toastSuccess('已创建新知识点');
                      maskOcr.remove();
                      mask.remove(); // 关掉大图预览
                      onRefresh();
                    }
                  }
                }),
                el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => maskOcr.remove() })
              ])
            ]);
            maskOcr.appendChild(boxOcr);
            document.body.appendChild(maskOcr);

          } catch (err) {
            toastError('识别失败: ' + err.message);
          }
        }
      }),
      el('button', {
        class: 'btn btn-primary', text: '🎨 去标注',
        onClick: () => { mask.remove(); URL.revokeObjectURL(url); window.location.hash = `#/annotate/${imageId}?pointId=${point.id}`; }
      }),
      el('button', {
        class: 'btn btn-ghost', text: '📁 移动', style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
        onClick: async () => {
          const folders = getAllFolders();
          let target = prompt(`输入目标分组名：\n（已有：${folders.join('、') || '暂无'}）\n留空则移出文件夹`);
          if (target === null) return;
          target = target.trim();

          const fresh = await dbGet('images', imageId);
          if (fresh) {
            if (target) {
              fresh.group = target;
              if (!folders.includes(target)) { folders.push(target); saveAllFolders(folders); }
            } else {
              delete fresh.group;
            }
            await dbPut('images', fresh);
            toastSuccess('移动成功'); mask.remove(); URL.revokeObjectURL(url); onRefresh();
          }
        }
      }),
      el('button', {
        class: 'btn btn-danger', text: '🗑 删除',
        onClick: async () => {
          if (!confirm('删除这张图片？')) return;
          // 只移除引用并推入回收站；图片二进制保留，待回收站过期/彻底删除时由 cleanOrphanImages 物理释放
          store.removeImageFromPoint(point.id, imageId);
          toastSuccess('已删除'); mask.remove(); URL.revokeObjectURL(url); onRefresh();
        }
      }),
      el('button', {
        class: 'btn btn-ghost', text: '关闭',
        style: { color: '#fff', border: '1px solid rgba(255,255,255,0.3)' },
        onClick: () => { mask.remove(); URL.revokeObjectURL(url); }
      })
    ]);

    mask.appendChild(imgWrap);
    mask.appendChild(toolbar);
    document.body.appendChild(mask);
  }

  // ============ 页面初始化执行 ============
  loadAndRender();
  return wrap;
}

/** 取当前范围对应的 id 列表 */
function scopeIds() {
  if (currentPickScope === 'image') return [...lastImageIds];
  if (currentPickScope === 'pdf') return [...lastPdfIds];
  return [...lastImageIds, ...lastPdfIds];
}

/** 对当前范围执行“全选 / 取消全选”切换 */
function toggleSelectByScope(selected, onRefresh) {
  const ids = scopeIds();
  if (!ids.length) return onRefresh();
  const allIn = ids.every(id => selected.has(id));
  if (allIn) ids.forEach(id => selected.delete(id));   // 已全选 -> 取消该范围
  else ids.forEach(id => selected.add(id));            // 否则 -> 全选该范围
  onRefresh();
}

// ===== 加 PDF：直接整本导入，不选页（选页功能在「挑选PDF」里）=====
async function pickPdfImport(point, onRefresh) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.multiple = true;

  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // 直接调用导入函数，不经过选页框
    // 你需要确认 pdfImport.js 里有没有类似 importPdfDirectly 的函数
    // 如果没有，就临时用现有的 pdfImportModal，但传一个标记让它跳过选页
    const { pdfImportModal } = await import('../views/pdfImport.js');
    await pdfImportModal(point.id, { wholeBook: true });  // 传个标记

    onRefresh();
  };

  input.click();
}

function choosePdfFiles(cb) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true;
  input.onchange = (e) => {
    input.onchange = null;
    const files = Array.from(e.target.files || []);
    if (files.length) cb(files);
  };
  input.click();
}

// ============ 原 PDF 导入（整份入库，进阅读器翻看） ============
// 说明：本函数体 = 原 imageList.js 132-203 行，去掉 input.onchange 外壳，files 改为入参；
async function importPdfRaw(files, point, onRefresh) {
  if (!files || !files.length) return;
  toastSuccess(`正在导入 ${files.length} 个 PDF...`);

  const pt = store.getPoint(point.id) || point;
  if (!pt.imageIds) pt.imageIds = [];
  if (!pt.pdfFiles) pt.pdfFiles = [];

  // 先查出当前已有的 PDF 名字（防重名）
  const existingRecs = await Promise.all(pt.imageIds.map(id => dbGet('images', id)));
  const usedNames = new Set(existingRecs.map(r => r && r.pdfName).filter(Boolean));

  const newImageIds = [];
  const newPdfFiles = [];
  const coverTasks = [];

  for (const file of files) {
    const pdfId = uuid();
    await dbPut('pdfs', { id: pdfId, blob: file, name: file.name, createdAt: new Date().toISOString() });

    const fakeImgId = uuid();

    // 自动给重名 PDF 加序号
    let baseName = file.name || '未命名文档';
    let ext = '';
    if (baseName.includes('.')) {
      const parts = baseName.split('.');
      ext = '.' + parts.pop();
      baseName = parts.join('.');
    }
    let finalName = baseName + ext;
    let counter = 1;
    while (usedNames.has(finalName)) { finalName = `${baseName} (${counter})${ext}`; counter++; }
    usedNames.add(finalName);

    await dbPut('images', {
      id: fakeImgId,
      type: 'pdf_placeholder',
      name: finalName,
      pdfName: finalName,
      originalBlob: new Blob([], { type: 'text/plain' }),
      annotatedBlob: new Blob([], { type: 'text/plain' }),
      width: 0, height: 0, dpr: 1,
      pdfId: pdfId,
      pdfPages: 0,          // ← 原来是 '?'，阅读器/缩略图拿它当数字用会崩
      coverUrl: '',         // ← 原来根本没这个字段，缩略图取 coverUrl 就白屏
      createdAt: new Date().toISOString()
    });

    newImageIds.push(fakeImgId);
    newPdfFiles.push({ id: pdfId, name: finalName, size: file.size });

    // A-2：异步补首页封面 + 真实页数，失败不影响导入本身
    coverTasks.push((async () => {
      // 这里是导入后的后台任务，pdf.js 可能还没就绪，用异步版补载一次
      if (!(await ensurePdfJsAsync())) {
        console.warn('PDF.js 不可用，跳过封面生成：', finalName);
        return;
      }
      let pdf = null;
      try {
        const buf = await file.arrayBuffer();
        pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 0.4 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const rec = await dbGet('images', fakeImgId);
        if (rec) {
          rec.coverUrl = c.toDataURL('image/jpeg', 0.8);
          rec.pdfPages = pdf.numPages;
          await dbPut('images', rec);
        }
      } catch (e) { console.warn('PDF 封面生成失败', finalName, e); }
      finally { try { if (pdf && pdf.destroy) pdf.destroy(); } catch (e) { } }
    })());
  }

  // 一次性全部写入
  pt.imageIds = [...new Set([...pt.imageIds, ...newImageIds])];
  pt.pdfFiles = [...(pt.pdfFiles || []), ...newPdfFiles];
  store.updatePoint(pt.id, { imageIds: pt.imageIds, pdfFiles: pt.pdfFiles });

  toastSuccess('导入完成');
  setTimeout(() => onRefresh(), 300);
  await Promise.allSettled(coverTasks);   // 封面回来后
  onRefresh();
}

// ============ 移动到文件夹弹窗 ============
function openMoveModal(selectedIds, onRefresh) {
  if (selectedIds.size === 0) { toastError('请先勾选文件'); return; }

  // 获取当前所有的文件夹
  let folders = getAllFolders();

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
    el('h3', { text: `移动 ${selectedIds.size} 个文件` }),
    el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择要移动到的目标文件夹：' }),
  ]);
  mask.appendChild(box);

  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' } });

  // 把文件夹列表渲染出来
  function renderFolders() {
    list.innerHTML = '';

    // 1. 移出文件夹（未分组）的选项
    list.appendChild(el('div', {
      style: { padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px', fontWeight: '600' },
      text: '📄 移出文件夹 (未分组)',
      onClick: async () => {
        await moveFilesTo(null);
        mask.remove();
      }
    }));

    // 2. 已有的文件夹
    if (folders.length === 0) {
      list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '暂无其他文件夹' }));
    } else {
      [...folders].sort((a, b) => a.split('/').join('\u0000').localeCompare(b.split('/').join('\u0000'))).forEach(f => {
        const lv = (f.match(/\//g) || []).length;
        const leaf = f.split('/').pop();
        list.appendChild(el('div', {
          style: { padding: '10px 12px', paddingLeft: (12 + lv * 18) + 'px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px' },
          text: `${'　'.repeat(lv)}📁 ${leaf}`,
          onClick: async () => { await moveFilesTo(f); mask.remove(); }
        }));
      });
    }
  }

  // 真正的移动执行逻辑
  async function moveFilesTo(targetGroup) {
    toastSuccess('正在移动...');
    for (const id of selectedIds) {
      const rec = await dbGet('images', id);
      if (rec) {
        if (targetGroup) rec.group = targetGroup;
        else delete rec.group;
        await dbPut('images', rec);
      }
    }
    toastSuccess('移动成功');
    onRefresh();
  }

  renderFolders();
  box.appendChild(list);

  // 底部操作：新建文件夹 & 取消
  box.appendChild(el('div', { class: 'confirm-actions', style: { justifyContent: 'space-between' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📁+ 新建文件夹并移入',
      onClick: async () => {
        const newName = prompt('输入新文件夹名称（用 / 可建子文件夹，如：讲义/数学）：');
        if (!newName || !newName.trim()) return;
        const clean = newName.trim().split('/').map(s => s.trim()).filter(Boolean).join('/');
        if (!clean) return;
        // 逐级登记所有祖先，否则删父级时抓不到子孙
        const segs = clean.split('/');
        for (let i = 1; i <= segs.length; i++) {
          const p = segs.slice(0, i).join('/');
          if (!folders.includes(p)) folders.push(p);
        }
        // 同父目录下判重加序号
        const parent = segs.length > 1 ? segs.slice(0, -1).join('/') + '/' : '';
        const leaf = segs[segs.length - 1];
        let finalLeaf = leaf, i2 = 1;
        while (folders.includes(parent + finalLeaf)) { finalLeaf = `${leaf} (${i2})`; i2++; }
        const finalName = parent + finalLeaf;
        if (!folders.includes(finalName)) folders.push(finalName);
        saveAllFolders(folders);
        sessionStorage.setItem('kg_rename_folder', finalName);
        renderFolders();          // 让新目录立刻出现在上面的树里
        await moveFilesTo(finalName);
        mask.remove();
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
  ]));

  document.body.appendChild(mask);
}

// ============ 自定义输入弹窗（替代 prompt） ============
function openInputModal(title, defaultValue, onConfirm) {
  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
  const input = el('input', {
    type: 'text', value: defaultValue || '',
    style: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(0,0,0,.1)', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' }
  });

  const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
    el('h3', { text: title, style: { marginBottom: '12px', fontSize: '16px' } }),
    input,
    el('div', { class: 'confirm-actions' }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
      el('button', {
        class: 'btn btn-primary', text: '确定', onClick: () => {
          const val = input.value.trim();
          if (val) { mask.remove(); onConfirm(val); }
        }
      })
    ])
  ]);

  mask.appendChild(box);
  document.body.appendChild(mask);

  // 自动聚焦并全选
  setTimeout(() => { input.focus(); input.select(); }, 100);
  // 回车直接确认
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (val) { mask.remove(); onConfirm(val); }
    }
  };
  // 点击遮罩关闭
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}

// ============ 粘贴位置选择弹窗 ============
function openPasteModal(pointId, onRefresh) {
  const folders = getAllFolders();
  const pt = store.getPoint(pointId);
  if (!pt) return;

  const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
  const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
    el('h3', { text: '粘贴到哪里？' }),
    el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择要粘贴到的目标文件夹：' }),
  ]);
  mask.appendChild(box);

  const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' } });

  async function doPaste(targetGroup) {
    toastSuccess('正在粘贴...');
    if (!pt.imageIds) pt.imageIds = [];

    // 1. 粘贴单个文件
    const clipFilesStr = sessionStorage.getItem('kg_clipboard_files');
    if (clipFilesStr) {
      const clipIds = JSON.parse(clipFilesStr);
      for (const oldId of clipIds) {
        const rec = await dbGet('images', oldId);
        if (!rec) continue;
        const newId = uuid();
        await dbPut('images', {
          ...rec,
          id: newId,
          group: targetGroup || undefined, //放入指定文件夹
          createdAt: new Date().toISOString()
        });
        pt.imageIds.push(newId);
      }
      sessionStorage.removeItem('kg_clipboard_files');
    }

    // 2. 粘贴整个文件夹
    const clipFolderStr = localStorage.getItem('kg_clipboard_folders');
    if (clipFolderStr) {
      const data = JSON.parse(clipFolderStr);
      // 如果目标是“未分组”，文件夹里的文件也就变成未分组；否则合并到目标文件夹
      const finalGroup = targetGroup || '';

      for (const oldId of data.ids) {
        const rec = await dbGet('images', oldId);
        if (!rec) continue;
        const newId = uuid();
        await dbPut('images', {
          ...rec,
          id: newId,
          group: finalGroup || undefined,
          createdAt: new Date().toISOString()
        });
        pt.imageIds.push(newId);
      }
      localStorage.removeItem('kg_clipboard_folders');
    }

    store.updatePoint(pt.id, { imageIds: pt.imageIds });
    toastSuccess('粘贴成功');
    mask.remove();
    onRefresh();
  }

  // 渲染文件夹列表
  function renderFolders() {
    list.innerHTML = '';

    // 1. 未分组选项
    list.appendChild(el('div', {
      style: { padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px', fontWeight: '600' },
      text: '📄 粘贴到未分组区域',
      onClick: () => doPaste(null)
    }));

    // 2. 已有文件夹
    folders.forEach(f => {
      list.appendChild(el('div', {
        style: { padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px' },
        text: `📁 粘贴到 ${f}`,
        onClick: () => doPaste(f)
      }));
    });
  }

  renderFolders();
  box.appendChild(list);

  // 底部：新建文件夹并粘贴 & 取消
  box.appendChild(el('div', { class: 'confirm-actions', style: { justifyContent: 'space-between' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📁+ 新建文件夹并粘贴',
      onClick: () => {
        const newName = prompt('输入新文件夹名称：');
        if (!newName || !newName.trim()) return;
        const finalName = newName.trim();
        if (!folders.includes(finalName)) {
          folders.push(finalName);
          saveAllFolders(folders);
        }
        doPaste(finalName);
      }
    }),
    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
  ]));

  document.body.appendChild(mask);
}

// ============ 统一下载封装（支持选择路径） ============
async function downloadWithPicker(blob, filename) {
  // 1. 优先尝试弹出系统的“另存为”窗口 (Chrome/Edge 支持)
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toastSuccess('导出成功');
      return;
    } catch (err) {
      // 如果用户点击了“取消”，直接静默返回
      if (err.name === 'AbortError') return;
      console.warn('另存为失败，降级为普通下载', err);
    }
  }

  // 2. 降级方案：普通的 <a> 标签下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
  toastSuccess('已开始下载（已保存至默认下载目录）');
}