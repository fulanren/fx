import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete, dbAll } from '../db.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';

export async function renderResourceOverview() {
    const view = document.getElementById('view');
    clear(view);
    document.getElementById('page-title').textContent = '📁 资源总览';
    document.getElementById('btn-back').classList.remove('hidden');
    document.getElementById('btn-back').onclick = () => history.back();

    let allFiles = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let viewMode = 'tree';
    let isMulti = false;
    let selectedIds = new Set();
    let fileTags = JSON.parse(localStorage.getItem('kg_file_tags') || '{}');
    let currentTagFilter = 'all';

    view.appendChild(el('div', { style: { padding: '20px', textAlign: 'center', color: 'var(--text-2)' }, text: '正在扫描资料库...' }));

    const allImages = await dbAll('images');
    const allPdfs = await dbAll('pdfs');
    const imgMap = new Map(allImages.map(i => [i.id, i]));
    const pdfMap = new Map(allPdfs.map(p => [p.id, p]));
    const tasks = store.getTasks();

    // 遍历所有知识点，平铺提取文件
    tasks.forEach(task => {
        store.getChapters(task.id).forEach(chapter => {
            store.getPoints(chapter.id).forEach(point => {

                // 1. 处理混在 imageIds 里的普通图片 和 PDF占位
                [...(point.imageIds || []), ...(point.compositeImageIds || [])].forEach(id => {
                    if (imgMap.has(id)) {
                        const rec = imgMap.get(id);
                        if (rec.type === 'pdf_placeholder') {
                            // 这是 PDF 占位记录
                            allFiles.push({ type: 'pdf', id: rec.pdfId, rec: pdfMap.get(rec.pdfId) || { id: rec.pdfId, name: rec.pdfName, blob: null }, taskName: task.name, chapterName: chapter.name, pointContent: point.content, pointId: point.id });
                        } else {
                            // 这是普通图片
                            allFiles.push({ type: 'img', id, rec, taskName: task.name, chapterName: chapter.name, pointContent: point.content, pointId: point.id });
                        }
                    }
                });

                // 2. 处理直接绑定的 pdfFiles
                (point.pdfFiles || []).forEach(pdf => {
                    if (pdfMap.has(pdf.id)) {
                        allFiles.push({ type: 'pdf', id: pdf.id, rec: pdfMap.get(pdf.id), taskName: task.name, chapterName: chapter.name, pointContent: point.content, pointId: point.id });
                    }
                });
            });
        });
    });

    view.innerHTML = '';

    if (allFiles.length === 0) {
        view.appendChild(el('div', { class: 'empty', text: '系统里还没有上传过任何图片或 PDF 附件。' }));
        return;
    }

    // ================= 2. 顶部工具栏 =================
    const topBar = el('div', { style: { padding: '12px 16px', background: 'var(--card)', borderBottom: '1px solid rgba(0,0,0,.05)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', position: 'sticky', top: '0', zIndex: '10' } });
    view.appendChild(topBar);

    const searchInput = el('input', {
        type: 'text', placeholder: '🔍 搜索文件名或知识点内容...',
        style: { flex: '1', minWidth: '150px', padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(0,0,0,.1)', fontSize: '13px', outline: 'none' },
        onInput: (e) => { searchQuery = e.target.value.toLowerCase(); renderContent(); }
    });
    topBar.appendChild(searchInput);

    const filterGroup = el('div', { style: { display: 'flex', gap: '4px', background: 'var(--bg)', padding: '2px', borderRadius: '8px' } }, [
        el('button', { class: 'btn btn-sm btn-primary', text: '全部', onClick: (e) => { currentFilter = 'all'; updateFilterBtns(e.target); renderContent(); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '📄 PDF', onClick: (e) => { currentFilter = 'pdf'; updateFilterBtns(e.target); renderContent(); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '🖼 图片', onClick: (e) => { currentFilter = 'img'; updateFilterBtns(e.target); renderContent(); } })
    ]);
    topBar.appendChild(filterGroup);

    const viewToggle = el('button', {
        class: 'btn btn-sm btn-ghost', text: '📋 列表', title: '切换视图', onClick: (e) => {
            viewMode = viewMode === 'tree' ? 'flat' : 'tree';
            e.target.textContent = viewMode === 'tree' ? '📋 列表' : '🗂 树状';
            renderContent();
        }
    });
    topBar.appendChild(viewToggle);

    // 文件夹过滤
    const allFolders = [...new Set(allFiles.map(f => f.rec.group).filter(Boolean))].sort();
    let currentGroupFilter = 'all';

    const groupSelect = el('select', {
        style: { padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(0,0,0,.1)', fontSize: '13px', outline: 'none', background: 'var(--bg)', maxWidth: '120px' },
        onChange: (e) => { currentGroupFilter = e.target.value; renderContent(); }
    }, [
        el('option', { value: 'all', text: '📁 全部文件夹' }),
        el('option', { value: 'none', text: '📄 未分组文件' }),
        ...allFolders.map(f => el('option', { value: f, text: `📁 ${f}` }))
    ]);
    topBar.appendChild(groupSelect);

    const multiBtn = el('button', {
        class: 'btn btn-sm btn-ghost', text: '☑ 多选', onClick: () => {
            isMulti = !isMulti;
            selectedIds.clear();
            multiBtn.className = `btn btn-sm ${isMulti ? 'btn-danger' : 'btn-ghost'}`;
            multiBtn.textContent = isMulti ? '✕ 退出' : '☑ 多选';
            renderContent();

            // 👇 点击多选时，动态显示或隐藏“全选”按钮
            if (isMulti) {
                topBar.appendChild(selectAllBtn);
                topBar.appendChild(deselectAllBtn);
            } else {
                selectAllBtn.remove();
                deselectAllBtn.remove();
            }
        }
    });
    topBar.appendChild(multiBtn);

    // 全选 / 全不选按钮
    const selectAllBtn = el('button', {
        class: 'btn btn-sm btn-ghost',
        text: '全选',
        title: '全选当前列表',
        onClick: () => {
            // 找到当前过滤后的列表
            let filtered = allFiles;
            if (currentFilter !== 'all') filtered = filtered.filter(f => f.type === currentFilter);
            if (searchQuery) {
                filtered = filtered.filter(f =>
                    (f.rec.name || f.rec.pdfName || '').toLowerCase().includes(searchQuery) ||
                    (f.pointContent || '').toLowerCase().includes(searchQuery)
                );
            }
            if (currentTagFilter !== 'all') {
                filtered = filtered.filter(f => fileTags[f.id] && fileTags[f.id].includes(currentTagFilter));
            }

            // 把当前过滤出的所有文件 ID 加进选中集合
            filtered.forEach(f => selectedIds.add(f.id));
            renderContent(); // 重新渲染界面，高亮选中的文件
        }
    });

    const deselectAllBtn = el('button', {
        class: 'btn btn-sm btn-ghost',
        text: '全不选',
        title: '取消全选',
        onClick: () => {
            selectedIds.clear();
            renderContent();
        }
    });

    // 只有开启多选模式时，才显示这两个按钮
    if (isMulti) {
        topBar.appendChild(selectAllBtn);
        topBar.appendChild(deselectAllBtn);
    }

    function updateFilterBtns(activeBtn) {
        filterGroup.querySelectorAll('.btn').forEach(b => b.className = 'btn btn-sm btn-ghost');
        activeBtn.className = 'btn btn-sm btn-primary';
    }

    const batchBar = el('div', { style: { display: 'none', position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(43,45,66,.95)', padding: '8px 16px', borderRadius: '24px', zIndex: '9999', alignItems: 'center', gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' } });
    view.appendChild(batchBar);

    const contentWrap = el('div', { style: { padding: '16px', paddingBottom: '80px' } });
    view.appendChild(contentWrap);

    // ================= 3. 核心渲染 =================
    function renderContent() {
        contentWrap.innerHTML = '';

        let filtered = allFiles;
        if (currentFilter !== 'all') filtered = filtered.filter(f => f.type === currentFilter);
        if (searchQuery) {
            filtered = filtered.filter(f => (f.rec.name || f.rec.pdfName || '').toLowerCase().includes(searchQuery) || (f.pointContent || '').toLowerCase().includes(searchQuery));
        }
        // 文件夹过滤
        if (currentGroupFilter === 'none') {
            filtered = filtered.filter(f => !f.rec.group);
        } else if (currentGroupFilter !== 'all') {
            filtered = filtered.filter(f => f.rec.group === currentGroupFilter);
        }

        if (filtered.length === 0) {
            contentWrap.appendChild(el('div', { class: 'empty', style: { padding: '40px', color: 'var(--text-2)', textAlign: 'center' }, text: '没有找到匹配的文件' }));
            updateBatchBar();
            return;
        }

        // 👇 加上这行标签过滤
        if (currentTagFilter !== 'all') {
            filtered = filtered.filter(f => fileTags[f.id] && fileTags[f.id].includes(currentTagFilter));
        }

        if (filtered.length === 0) {
            contentWrap.appendChild(el('div', { class: 'empty', style: { padding: '40px', color: 'var(--text-2)', textAlign: 'center' }, text: '没有找到匹配的文件' }));
            updateBatchBar();
            return;
        }

        if (viewMode === 'tree') {
            renderTreeView(filtered);
        } else {
            renderFlatView(filtered);
        }

        updateBatchBar();
    }

    // 懒加载图片核心逻辑
    function lazyLoadImage(container, imgRec) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const blob = imgRec.annotatedBlob || imgRec.originalBlob;
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        const img = el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) });
                        container.innerHTML = '';
                        container.appendChild(img);
                    }
                    observer.disconnect();
                }
            });
        });
        observer.observe(container);
    }

    function renderTreeView(data) {
        const groups = {};
        data.forEach(f => {
            const key = `${f.taskName} || ${f.chapterName}`;
            if (!groups[key]) groups[key] = { task: f.taskName, chapter: f.chapterName, items: [] };
            groups[key].items.push(f);
        });

        Object.values(groups).forEach(group => {
            const section = el('div', { class: 'card', style: { marginBottom: '16px', padding: '16px' } });
            section.appendChild(el('h3', { style: { color: 'var(--primary-dark)', marginBottom: '8px', fontSize: '15px' }, text: `📚 ${group.task}` }));
            section.appendChild(el('div', { style: { fontSize: '13px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '1px dashed rgba(0,0,0,.1)', paddingBottom: '4px' }, text: `📖 ${group.chapter}` }));

            const grid = el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } });
            group.items.forEach(item => grid.appendChild(createFileCard(item)));
            section.appendChild(grid);
            contentWrap.appendChild(section);
        });
    }

    // 渲染扁平列表视图
    function renderFlatView(data) {
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

        data.forEach(item => {
            const row = el('div', {
                style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: 'var(--card)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)', cursor: 'pointer' },
                onClick: () => handleItemClick(item)
            });

            if (isMulti) {
                row.appendChild(el('input', {
                    type: 'checkbox', checked: selectedIds.has(item.id), onChange: (e) => {
                        e.stopPropagation();
                        if (e.target.checked) selectedIds.add(item.id); else selectedIds.delete(item.id);
                        updateBatchBar();
                    }
                }));
            }

            // 👇 核心：判断类型，分别获取缩略图
            const thumbBox = el('div', { style: { width: '40px', height: '50px', borderRadius: '6px', overflow: 'hidden', background: '#eee', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,.08)' } });

            if (item.type === 'pdf') {
                thumbBox.style.background = '#FFF0F0';

                // 如果有存过封面，直接显示
                if (item.rec.coverUrl) {
                    thumbBox.appendChild(el('img', { src: item.rec.coverUrl, style: { width: '100%', height: '100%', objectFit: 'cover' } }));
                } else {
                    // 没有封面，先显示图标
                    thumbBox.appendChild(el('span', { style: { fontSize: '20px' }, text: '📄' }));

                    // 👇 在后台悄悄生成第一页的缩略图
                    if (item.rec.blob) {
                        (async () => {
                            try {
                                const buf = await item.rec.blob.arrayBuffer();
                                const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
                                const page = await pdf.getPage(1);
                                const vp = page.getViewport({ scale: 0.3 });
                                const c = document.createElement('canvas');
                                c.width = vp.width; c.height = vp.height;
                                await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                                const url = c.toDataURL('image/jpeg', 0.8);

                                // 替换掉图标
                                thumbBox.innerHTML = '';
                                thumbBox.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } }));

                                // 偷偷存进数据库（下次就秒出了）
                                item.rec.coverUrl = url;
                                const { dbPut } = await import('../db.js');
                                await dbPut('pdfs', item.rec);
                            } catch (e) { console.warn('PDF封面生成失败', e); }
                        })();
                    }
                }
            } else {
                const blob = item.rec.annotatedBlob || item.rec.originalBlob;
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    thumbBox.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' }, onLoad: () => URL.revokeObjectURL(url) }));
                } else {
                    thumbBox.appendChild(el('span', { style: { fontSize: '20px' }, text: '🖼' }));
                }
            }

            row.appendChild(thumbBox);

            // 👇 修复文件名显示，PDF 用 pdfName，图片用 name
            const displayName = item.type === 'pdf' ? (item.rec.name || '未命名 PDF') : (item.rec.name || '未命名图片');

            row.appendChild(el('span', { style: { flex: '1', fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: displayName }));
            // 显示所属文件夹
            if (item.rec.group) {
                row.appendChild(el('span', { style: { fontSize: '11px', padding: '2px 6px', background: 'var(--bg)', borderRadius: '4px', color: 'var(--primary-dark)', whiteSpace: 'nowrap' }, text: `📁 ${item.rec.group}` }));
            }
            row.appendChild(el('span', { style: { fontSize: '11px', color: 'var(--text-2)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: `${item.taskName} / ${item.chapterName}` }));

            list.appendChild(row);
        });
        contentWrap.appendChild(list);
    }

    function createFileCard(item) {
        const card = el('div', {
            style: { position: 'relative', width: '80px', height: '100px', background: '#eee', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', border: selectedIds.has(item.id) ? '3px solid var(--primary)' : '1px solid rgba(0,0,0,.05)' },
            onClick: () => handleItemClick(item)
        });

        // 右上角详情小按钮
        const infoBtn = el('button', {
            style: { position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', zIndex: '5', cursor: 'pointer', padding: '0' },
            text: 'ℹ️',
            onClick: (e) => { e.stopPropagation(); showFileDetails(item); }
        });

        if (isMulti) {
            card.appendChild(el('input', {
                type: 'checkbox', checked: selectedIds.has(item.id), style: { position: 'absolute', top: '4px', left: '4px', zIndex: '2' }, onChange: (e) => {
                    e.stopPropagation();
                    if (e.target.checked) selectedIds.add(item.id); else selectedIds.delete(item.id);
                    card.style.border = e.target.checked ? '3px solid var(--primary)' : '1px solid rgba(0,0,0,.05)';
                    updateBatchBar();
                }
            }));
        } else {
            card.appendChild(infoBtn);
        }

        if (item.type === 'pdf') {
            card.style.background = '#FFF0F0';
            card.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '4px' } }, [
                el('span', { style: { fontSize: '32px' }, text: '📄' }),
                el('span', { style: { fontSize: '10px', color: '#EF476F', textAlign: 'center', wordBreak: 'break-all', maxHeight: '30px', overflow: 'hidden' }, text: item.rec.name })
            ]));
        } else {
            // 图片懒加载占位
            const lazyBox = el('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#ccc' }, text: '🖼' });
            card.appendChild(lazyBox);
            lazyLoadImage(lazyBox, item.rec);
        }

        return card;
    }

    function handleItemClick(item) {
        if (isMulti) {
            if (selectedIds.has(item.id)) selectedIds.delete(item.id); else selectedIds.add(item.id);
            renderContent();
            return;
        }
        if (item.type === 'pdf') {
            navigate(`#/pdf-viewer/${item.id}?pointId=${item.pointId}`);
        } else {
            navigate(`#/annotate/${item.id}?pointId=${item.pointId}`);
        }
    }

    // 文件详情弹窗
    function showFileDetails(item) {
        let sizeText = '未知';
        let typeText = item.type === 'pdf' ? 'PDF 文档' : '图片';
        let dimensionText = '';

        if (item.type === 'pdf') {
            if (item.rec.blob) sizeText = (item.rec.blob.size / 1024 / 1024).toFixed(2) + ' MB';
            dimensionText = item.rec.pdfPages ? `共 ${item.rec.pdfPages} 页` : '页数未知';
        } else {
            if (item.rec.originalBlob) sizeText = (item.rec.originalBlob.size / 1024).toFixed(1) + ' KB';
            dimensionText = `${item.rec.width || 0} × ${item.rec.height || 0} px`;
        }

        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 }, onClick: (e) => { if (e.target === mask) mask.remove(); } }, [
            el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
                el('h3', { text: 'ℹ️ 资源详情' }),
                el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', margin: '16px 0' } }, [
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '文件名' }), el('span', { style: { fontWeight: '600', wordBreak: 'break-all', textAlign: 'right' }, text: item.rec.name || item.rec.pdfName || '未命名' })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '类型' }), el('span', { text: typeText })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '大小' }), el('span', { text: sizeText })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '尺寸/页数' }), el('span', { text: dimensionText })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '关联章节' }), el('span', { text: `${item.taskName} - ${item.chapterName}`, style: { maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '创建时间' }), el('span', { text: item.rec.createdAt ? new Date(item.rec.createdAt).toLocaleString() : '未知' })]),
                    // 👇 加上标签输入框
                    el('div', { style: { marginTop: '12px', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
                        el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '6px' }, text: '自定义标签 (用逗号隔开)' }),
                        el('input', {
                            type: 'text',
                            value: (fileTags[item.id] || []).join(', '),
                            placeholder: '例如：错题, 必看, 申论',
                            style: { width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' },
                            onInput: (e) => {
                                const tags = e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
                                fileTags[item.id] = tags;
                                localStorage.setItem('kg_file_tags', JSON.stringify(fileTags));
                                renderTags();
                            }
                        })
                    ]),
                ]),
                el('div', { class: 'confirm-actions' }, [
                    el('button', { class: 'btn btn-primary', text: '关闭', onClick: () => mask.remove() })
                ])
            ])
        ]);
        document.body.appendChild(mask);
    }

    function updateBatchBar() {
        if (isMulti && selectedIds.size > 0) {
            batchBar.style.display = 'flex';
            batchBar.innerHTML = '';
            batchBar.appendChild(el('span', { style: { color: '#fff', fontSize: '13px', fontWeight: 'bold' }, text: `已选 ${selectedIds.size} 项` }));
            batchBar.appendChild(el('div', { style: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.3)' } }));
            // 批量移动到文件夹
            batchBar.appendChild(el('button', {
                class: 'btn btn-sm btn-primary', text: '📁 移动到...',
                onClick: () => {
                    const getFolders = () => JSON.parse(localStorage.getItem('kg_all_folders') || '[]');
                    const folders = getFolders();

                    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
                    const box = el('div', { class: 'confirm-box', style: { maxWidth: '360px', display: 'flex', flexDirection: 'column' } }, [
                        el('h3', { text: `移动 ${selectedIds.size} 个文件` }),
                        el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择要移动到的目标文件夹：' }),
                    ]);
                    mask.appendChild(box);

                    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto', marginBottom: '16px' } });

                    function renderFolders() {
                        list.innerHTML = '';
                        list.appendChild(el('div', {
                            style: { padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px', fontWeight: '600' },
                            text: '📄 移出文件夹 (未分组)',
                            onClick: async () => {
                                await moveFilesTo(null);
                                mask.remove();
                            }
                        }));

                        if (folders.length === 0) {
                            list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '12px' }, text: '暂无其他文件夹' }));
                        } else {
                            folders.forEach(f => {
                                list.appendChild(el('div', {
                                    style: { padding: '10px 12px', background: 'var(--bg)', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)', fontSize: '14px' },
                                    text: `📁 ${f}`,
                                    onClick: async () => {
                                        await moveFilesTo(f);
                                        mask.remove();
                                    }
                                }));
                            });
                        }
                    }

                    async function moveFilesTo(targetGroup) {
                        toastSuccess('正在移动...');
                        const selectedArray = Array.from(selectedIds);
                        for (const id of selectedArray) {
                            const rec = await dbGet('images', id);
                            if (rec) {
                                if (targetGroup) rec.group = targetGroup;
                                else delete rec.group;
                                await dbPut('images', rec);
                            }
                        }
                        toastSuccess('移动成功');
                        selectedIds.clear();
                        isMulti = false;
                        renderResourceOverview();
                    }

                    renderFolders();
                    box.appendChild(list);

                    box.appendChild(el('div', { class: 'confirm-actions', style: { justifyContent: 'space-between' } }, [
                        el('button', {
                            class: 'btn btn-primary', text: '📁+ 新建文件夹并移入',
                            onClick: async () => {
                                const newName = prompt('输入新文件夹名称：');
                                if (!newName || !newName.trim()) return;
                                const finalName = newName.trim();
                                if (!folders.includes(finalName)) {
                                    folders.push(finalName);
                                    localStorage.setItem('kg_all_folders', JSON.stringify(folders));
                                }
                                await moveFilesTo(finalName);
                                mask.remove();
                            }
                        }),
                        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
                    ]));

                    document.body.appendChild(mask);
                }
            }));
            batchBar.appendChild(el('button', {
                class: 'btn btn-sm btn-danger', text: '🗑 批量删除', onClick: async () => {
                    if (!confirm(`确定彻底删除选中的 ${selectedIds.size} 个文件吗？（不可恢复）`)) return;
                    toastSuccess('正在删除...');
                    for (const id of selectedIds) {
                        await dbDelete('images', id);
                        await dbDelete('pdfs', id);
                        const points = JSON.parse(localStorage.getItem('kg_points') || '[]');
                        points.forEach(p => {
                            if (p.imageIds) p.imageIds = p.imageIds.filter(i => i !== id);
                            if (p.compositeImageIds) p.compositeImageIds = p.compositeImageIds.filter(i => i !== id);
                            if (p.pdfFiles) p.pdfFiles = p.pdfFiles.filter(pf => pf.id !== id);
                        });
                        localStorage.setItem('kg_points', JSON.stringify(points));
                    }
                    toastSuccess('已删除');
                    selectedIds.clear(); isMulti = false;
                    multiBtn.className = 'btn btn-sm btn-ghost'; multiBtn.textContent = '☑ 多选';
                    renderResourceOverview();
                }
            }));
        } else {
            batchBar.style.display = 'none';
        }
    }

    renderContent();
}