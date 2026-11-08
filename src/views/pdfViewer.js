import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete, dbAll } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { uuid } from '../utils/id.js';

export async function renderPdfViewer({ params, query }) {
    const pdfId = params.id;
    const pointId = query.pointId;
    const view = document.getElementById('view');
    clear(view);

    document.getElementById('page-title').textContent = 'PDF 阅读';
    document.getElementById('btn-back').classList.remove('hidden');
    document.getElementById('btn-back').onclick = () => history.back();

    // 核心状态
    let pdfRecord = null, pdfDoc = null, total = 0, currentPage = 1;
    let mode = 'scroll'; // 'scroll' | 'paged'
    let layout = 'single'; // 👈 核心修复：补上没声明的 layout 变量
    let eyeMode = false;
    let isMulti = false;
    let selectedPages = new Set();

    const container = el('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', overflow: 'hidden', position: 'relative', background: eyeMode ? '#F0F5E9' : 'var(--bg)' } });
    view.appendChild(container);

    async function initPdf(id) {
        container.innerHTML = '<div style="padding:20px;text-align:center;">加载中...</div>';
        try {
            pdfRecord = await dbGet('pdfs', id);
            if (!pdfRecord) { container.innerHTML = '文件丢失'; return; }
            const buf = await pdfRecord.blob.arrayBuffer();
            pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
            total = pdfDoc.numPages;
            currentPage = 1;
            selectedPages.clear();

            document.querySelectorAll('#pdf-bottom-float').forEach(el => el.remove());
            document.querySelectorAll('#pdf-page-float').forEach(el => el.remove());

            renderUI();
        } catch (err) { container.innerHTML = '加载失败'; }
    }

    // 👇 新增：重命名
    async function renamePdf() {
        const newName = prompt('重命名文档', pdfRecord.name);
        if (newName && newName.trim() && newName !== pdfRecord.name) {
            pdfRecord.name = newName.trim();
            await dbPut('pdfs', pdfRecord);

            // 同步更新知识点里绑定的旧名称
            const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
            let changed = false;
            allPoints.forEach(p => {
                if (p.pdfFiles) {
                    p.pdfFiles.forEach(pdf => {
                        if (pdf.id === pdfId) { pdf.name = pdfRecord.name; changed = true; }
                    });
                }
            });
            if (changed) localStorage.setItem('kg_points', JSON.stringify(allPoints));

            toastSuccess('已重命名');
            renderUI();
        }
    }

    // 👇 新增：书签面板
    function openBookmarkPanel() {
        let bookmarks = JSON.parse(localStorage.getItem(`kg_pdf_bookmarks_${pdfId}`) || '[]');
        // 兼容旧格式：字符串页码 → 对象
        bookmarks = bookmarks.map(b => typeof b === 'number' ? { page: b, note: '' } : b);

        let multiMode = false;
        const selectedPages = new Set();
        const thumbCache = new Map();

        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
        const box = el('div', { class: 'confirm-box', style: { maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' } });
        mask.appendChild(box);

        function saveBookmarks() {
            localStorage.setItem(`kg_pdf_bookmarks_${pdfId}`, JSON.stringify(bookmarks));
        }

        async function renderList() {
            box.innerHTML = '';
            box.appendChild(el('h3', { text: `📑 书签（${bookmarks.length}）` }));

            // 顶部工具条
            box.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' } }, [
                el('button', {
                    class: 'btn btn-sm btn-primary', text: '➕ 添加当前页',
                    onClick: () => {
                        if (bookmarks.find(b => b.page === currentPage)) { toastError('当前页已在书签中'); return; }
                        bookmarks.push({ page: currentPage, note: '' });
                        saveBookmarks();
                        if (window.__updatePdfPageFloat) window.__updatePdfPageFloat(); renderList();
                        toastSuccess(`已添加第 ${currentPage} 页书签`);
                    },
                }),
                el('button', {
                    class: 'btn btn-sm ' + (multiMode ? 'btn-danger' : 'btn-ghost'),
                    text: multiMode ? '✕ 退出多选' : '☑ 多选',
                    onClick: () => { multiMode = !multiMode; selectedPages.clear(); renderList(); },
                }),
                multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全选',
                    onClick: () => { bookmarks.forEach(b => selectedPages.add(b.page)); renderList(); },
                }) : null,
                multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全不选',
                    onClick: () => { selectedPages.clear(); renderList(); },
                }) : null,
                multiMode && selectedPages.size > 0 ? el('button', {
                    class: 'btn btn-sm btn-danger', text: `🗑 删除选中 (${selectedPages.size})`,
                    onClick: () => {
                        if (!confirm(`删除选中的 ${selectedPages.size} 个书签？`)) return;
                        bookmarks = bookmarks.filter(b => !selectedPages.has(b.page));
                        selectedPages.clear(); multiMode = false;
                        saveBookmarks();
                        if (window.__updatePdfPageFloat) window.__updatePdfPageFloat(); renderList();
                        toastSuccess('已删除');
                    },
                }) : null,
            ]));

            // 列表
            const list = el('div', { style: { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } });

            if (bookmarks.length === 0) {
                list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '32px' }, text: '暂无书签，点上方「添加当前页」' }));
            } else {
                bookmarks.sort((a, b) => a.page - b.page);
                for (const bm of bookmarks) {
                    const row = el('div', {
                        style: {
                            display: 'flex', gap: '10px', padding: '8px', background: 'var(--bg)',
                            borderRadius: '8px', alignItems: 'flex-start',
                            border: multiMode && selectedPages.has(bm.page) ? '2px solid var(--primary)' : '1px solid transparent',
                        },
                    });

                    // 多选勾选
                    if (multiMode) {
                        row.appendChild(el('input', {
                            type: 'checkbox', checked: selectedPages.has(bm.page),
                            style: { marginTop: '20px' },
                            onChange: (e) => {
                                if (e.target.checked) selectedPages.add(bm.page);
                                else selectedPages.delete(bm.page);
                                renderList();
                            },
                        }));
                    }

                    // 缩略图
                    const thumb = el('div', {
                        style: { width: '60px', height: '80px', background: '#eee', borderRadius: '4px', overflow: 'hidden', flexShrink: 0, cursor: 'pointer' },
                        onClick: () => { mask.remove(); jumpToPage(bm.page); },
                    });
                    row.appendChild(thumb);

                    // 异步加载缩略图
                    if (thumbCache.has(bm.page)) {
                        thumb.appendChild(el('img', { src: thumbCache.get(bm.page), style: { width: '100%', height: '100%', objectFit: 'cover' } }));
                    } else {
                        pdfDoc.getPage(bm.page).then(page => {
                            const vp = page.getViewport({ scale: 0.4 });
                            const c = document.createElement('canvas');
                            c.width = vp.width; c.height = vp.height;
                            return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(() => {
                                const url = c.toDataURL('image/jpeg', 0.7);
                                thumbCache.set(bm.page, url);
                                if (thumb.isConnected) {
                                    thumb.innerHTML = '';
                                    thumb.appendChild(el('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } }));
                                }
                            });
                        }).catch(() => { thumb.textContent = '📄'; });
                    }

                    // 右侧内容
                    const info = el('div', { style: { flex: '1', minWidth: '0' } });
                    info.appendChild(el('div', {
                        style: { fontWeight: '600', fontSize: '14px', cursor: 'pointer' },
                        text: `第 ${bm.page} 页`,
                        onClick: () => { mask.remove(); jumpToPage(bm.page); },
                    }));

                    // 备注输入
                    const noteInput = el('textarea', {
                        placeholder: '添加备注…',
                        value: bm.note || '',
                        style: {
                            width: '100%', marginTop: '4px', padding: '6px 8px',
                            fontSize: '12px', border: '1px solid rgba(0,0,0,.1)',
                            borderRadius: '6px', resize: 'vertical', minHeight: '40px',
                            fontFamily: 'inherit', background: 'var(--card)',
                        },
                        onInput: (e) => {
                            bm.note = e.target.value;
                            saveBookmarks();
                            if (window.__updatePdfPageFloat) window.__updatePdfPageFloat();
                        },
                    });
                    info.appendChild(noteInput);
                    row.appendChild(info);

                    // 删除按钮（非多选时显示）
                    if (!multiMode) {
                        row.appendChild(el('button', {
                            class: 'btn btn-sm btn-ghost', text: '✕',
                            style: { color: 'var(--danger)' },
                            onClick: () => {
                                bookmarks = bookmarks.filter(b => b.page !== bm.page);
                                saveBookmarks();
                                if (window.__updatePdfPageFloat) window.__updatePdfPageFloat(); renderList();
                                toastSuccess('已删除');
                            },
                        }));
                    }

                    list.appendChild(row);
                }
            }

            box.appendChild(list);
            box.appendChild(el('div', { class: 'confirm-actions', style: { marginTop: '12px' } }, [
                el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
            ]));
        }

        renderList();
        document.body.appendChild(mask);
    }

    // 跳页辅助函数
    function jumpToPage(pageNum) {
        currentPage = pageNum;
        renderUI();
        if (window.__updatePdfPageFloat) setTimeout(window.__updatePdfPageFloat, 50);
        setTimeout(() => {
            const target = document.getElementById(`pdf-page-wrap-${currentPage}`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    function renderUI() {
        // 1. 清理旧的悬浮球和底部栏，防止重叠
        document.querySelectorAll('#pdf-bottom-float').forEach(el => el.remove());
        document.querySelectorAll('#pdf-page-float').forEach(el => el.remove());

        // 2. 读取用户偏好的外部显示工具
        const defaultPrefs = { mode: true, layout: true, eye: true, multi: true, switch: true };
        let prefs = defaultPrefs;
        try {
            const saved = localStorage.getItem('kg_pdf_toolbar_prefs');
            if (saved) prefs = { ...defaultPrefs, ...JSON.parse(saved) };
        } catch { }

        function savePrefs() {
            localStorage.setItem('kg_pdf_toolbar_prefs', JSON.stringify(prefs));
            renderUI();
        }

        container.innerHTML = '';
        container.style.height = 'auto';
        container.style.overflow = 'visible';
        container.style.background = eyeMode ? '#F0F5E9' : 'var(--bg)';

        // ============ 3. 定义所有工具 ============
        const toolsMap = {
            mode: {
                render: () => [
                    { id: 'paged', label: '📖 翻页' },
                    { id: 'scroll', label: '📜 滚动' }
                ].map(m => el('button', { class: 'btn btn-sm ' + (mode === m.id ? 'btn-primary' : 'btn-ghost'), text: m.label, onClick: () => { mode = m.id; renderUI(); } }))
            },
            layout: {
                render: () => [
                    { id: 'single', label: '单页' },
                    { id: 'double', label: '双页' }
                ].map(l => el('button', { class: 'btn btn-sm ' + (layout === l.id ? 'btn-primary' : 'btn-ghost'), text: l.label, onClick: () => { layout = l.id; renderUI(); } }))
            },
            eye: { render: () => el('button', { class: 'btn btn-sm ' + (eyeMode ? 'btn-primary' : 'btn-ghost'), text: '🌿', title: '护眼', onClick: () => { eyeMode = !eyeMode; renderUI(); } }) },
            multi: { render: () => el('button', { class: 'btn btn-sm ' + (isMulti ? 'btn-danger' : 'btn-ghost'), text: isMulti ? '✕' : '☑', title: '多选', onClick: () => { isMulti = !isMulti; selectedPages.clear(); renderUI(); } }) },
            switch: { render: () => el('button', { class: 'btn btn-sm btn-ghost', text: '📂', title: '切换文档', onClick: () => showRecentFiles() }) }
        };

        // 4. 渲染外置工具
        const visibleTools = [];
        if (prefs.mode) visibleTools.push(...toolsMap.mode.render());
        if (prefs.layout) visibleTools.push(...toolsMap.layout.render());
        if (prefs.eye) visibleTools.push(toolsMap.eye.render());
        if (prefs.multi) visibleTools.push(toolsMap.multi.render());
        if (prefs.switch) visibleTools.push(toolsMap.switch.render());

        // ============ 5. 隐藏的折叠设置面板 ============
        const toolPanel = el('div', {
            style: { display: 'none', position: 'absolute', top: '56px', left: '0', right: '0', background: 'var(--card)', padding: '12px', borderBottom: '1px solid rgba(0,0,0,.08)', zIndex: 99, flexDirection: 'column', gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }
        }, [
            // 阅读模式
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
                el('span', { style: { fontSize: '13px', color: 'var(--text-2)', width: '64px', flexShrink: 0 }, text: '阅读模式' }),
                ...toolsMap.mode.render(),
            ]),
            // 页面布局
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
                el('span', { style: { fontSize: '13px', color: 'var(--text-2)', width: '64px', flexShrink: 0 }, text: '页面布局' }),
                ...toolsMap.layout.render(),
            ]),
            // 其他
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
                el('span', { style: { fontSize: '13px', color: 'var(--text-2)', width: '64px', flexShrink: 0 }, text: '其他' }),
                toolsMap.eye.render(),
                toolsMap.multi.render(),
                toolsMap.switch.render(),
            ]),
            el('div', { style: { display: 'flex', gap: '8px', width: '100%', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
                el('button', { class: 'btn btn-sm btn-ghost', text: '⚙️ 配置外置按钮', onClick: () => openToolManager(prefs, savePrefs) })
            ])
        ]);
        container.appendChild(toolPanel);

        // ============ 6. 顶栏 ============
        const topBar = el('div', { style: { display: 'flex', gap: '6px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.05)', background: 'var(--card)', zIndex: 100, position: 'relative', overflowX: 'auto' } }, [
            el('span', { style: { fontWeight: 'bold', fontSize: '15px', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '80px' }, text: pdfRecord.name }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', title: '重命名', onClick: () => renamePdf() }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '📑', title: '书签', onClick: () => openBookmarkPanel() }),
            ...visibleTools,
            el('button', {
                class: 'btn btn-sm btn-ghost', text: '⚙️', title: '设置',
                onClick: () => {
                    const isHidden = toolPanel.style.display === 'none';
                    toolPanel.style.display = isHidden ? 'flex' : 'none';
                }
            })
        ]);
        container.appendChild(topBar);

        // ============ 7. 多选操作栏 ============
        if (isMulti) {
            container.appendChild(el('div', { style: { display: 'flex', gap: '8px', padding: '8px', background: 'rgba(142, 202, 230, 0.15)', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.05)', flexWrap: 'wrap' } }, [
                el('span', { style: { fontSize: '13px', fontWeight: 'bold', color: 'var(--primary-dark)' }, text: `已选 ${selectedPages.size} 页` }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { for (let i = 1; i <= total; i++) selectedPages.add(i); renderUI(); } }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '取消全选', onClick: () => { selectedPages.clear(); renderUI(); } }),
                el('div', { style: { width: '1px', height: '20px', background: 'rgba(0,0,0,.1)' } }),
                el('button', { class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: () => processPDF('delete') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => { sessionStorage.setItem('pdf_clipboard', JSON.stringify([...selectedPages])); toastSuccess('已复制'); } }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '📥 插入', onClick: () => processPDF('paste') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '🔗 合并', onClick: () => processPDF('merge') }),
                el('button', { class: 'btn btn-sm btn-primary', text: '📤 导出选中', onClick: () => processPDF('export') })
            ]));
        }

        // ============ 8. 画布渲染区 ============
        const scrollWrap = el('div', { style: { width: '100%', display: 'block' } });
        const canvasWrap = el('div', { style: { display: 'block', width: '100%', padding: '16px 0 150px 0' } });
        scrollWrap.appendChild(canvasWrap);
        container.appendChild(scrollWrap);

        renderPages(canvasWrap);

        // ============ 9. 底部工具栏（可拖拽） ============
        const bottomFloat = el('div', {
            id: 'pdf-bottom-float',
            style: { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(43,45,66,.9)', padding: '8px 16px', borderRadius: '24px', display: 'flex', gap: '12px', alignItems: 'center', zIndex: 9999, cursor: 'grab', userSelect: 'none', touchAction: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
        }, [
            el('button', { class: 'btn btn-sm btn-ghost', text: '⬅️', style: { color: '#fff' }, onClick: () => { if (currentPage > 1) { currentPage = layout === 'double' ? Math.max(1, currentPage - 2) : currentPage - 1; renderUI(); } } }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '➡️', style: { color: '#fff' }, onClick: () => { if (currentPage < total) { currentPage = layout === 'double' ? Math.min(total, currentPage + 2) : currentPage + 1; renderUI(); } } }),
            el('button', { class: 'btn btn-sm btn-primary', text: '🎨 标注', onClick: () => annotatePage(currentPage) })
        ]);

        // 底部工具栏拖拽逻辑
        let isBottomDragging = false, bStartX = 0, bStartY = 0, bOffX = 0, bOffY = 0;
        bottomFloat.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isBottomDragging = true;
            bStartX = e.clientX; bStartY = e.clientY;
            const rect = bottomFloat.getBoundingClientRect();
            bOffX = e.clientX - rect.left; bOffY = e.clientY - rect.top;
            bottomFloat.setPointerCapture(e.pointerId);
            bottomFloat.style.cursor = 'grabbing';
        });
        bottomFloat.addEventListener('pointermove', (e) => {
            if (!isBottomDragging) return;
            bottomFloat.style.left = (e.clientX - bOffX) + 'px';
            bottomFloat.style.top = (e.clientY - bOffY) + 'px';
            bottomFloat.style.bottom = 'auto';
            bottomFloat.style.transform = 'none';
        });
        bottomFloat.addEventListener('pointerup', (e) => {
            isBottomDragging = false;
            bottomFloat.releasePointerCapture(e.pointerId);
            bottomFloat.style.cursor = 'grab';
        });
        document.body.appendChild(bottomFloat);

        // ============ 10. 悬浮页码球（可拖拽 + 书签标识） ============
        function hasBmOnPage(pageNum) {
            try {
                const savedBookmarks = JSON.parse(localStorage.getItem(`kg_pdf_bookmarks_${pdfId}`) || '[]');
                const bookmarks = savedBookmarks.map(b => typeof b === 'number' ? { page: b } : b);
                return bookmarks.some(b => b.page === pageNum);
            } catch { return false; }
        }

        function updatePageFloatText() {
            const elF = document.getElementById('pdf-page-float');
            if (!elF) return;
            elF.textContent = hasBmOnPage(currentPage) ? `${currentPage} / ${total} 📑` : `${currentPage} / ${total}`;
        }

        const floatPage = el('div', {
            id: 'pdf-page-float',
            style: { position: 'fixed', bottom: '80px', right: '20px', zIndex: 9999, background: 'rgba(43,45,66,0.85)', color: '#fff', padding: '6px 14px', borderRadius: '20px', fontWeight: 'bold', cursor: 'grab', userSelect: 'none', touchAction: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' },
            text: hasBmOnPage(currentPage) ? `${currentPage} / ${total} 📑` : `${currentPage} / ${total}`
        });

        floatPage.onclick = () => {
            if (floatPage.getAttribute('data-dragging') === '1') return;
            const val = prompt('跳转到哪一页？', String(currentPage));
            if (val) {
                const n = parseInt(val);
                if (n >= 1 && n <= total) {
                    jumpToPage(n);
                }
            }
        };

        let isDragging = false, startX = 0, startY = 0, offsetX = 0, offsetY = 0;
        floatPage.addEventListener('pointerdown', (e) => {
            isDragging = false; startX = e.clientX; startY = e.clientY;
            const rect = floatPage.getBoundingClientRect();
            offsetX = e.clientX - rect.left; offsetY = e.clientY - rect.top;
            floatPage.setPointerCapture(e.pointerId);
            floatPage.style.cursor = 'grabbing';
        });
        floatPage.addEventListener('pointermove', (e) => {
            if (!floatPage.hasPointerCapture(e.pointerId)) return;
            if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
                isDragging = true; floatPage.setAttribute('data-dragging', '1');
                floatPage.style.right = 'auto'; floatPage.style.bottom = 'auto';
                floatPage.style.left = (e.clientX - offsetX) + 'px';
                floatPage.style.top = (e.clientY - offsetY) + 'px';
            }
        });
        floatPage.addEventListener('pointerup', (e) => {
            floatPage.releasePointerCapture(e.pointerId);
            floatPage.style.cursor = 'grab';
            setTimeout(() => { isDragging = false; floatPage.setAttribute('data-dragging', '0'); }, 100);
        });
        document.body.appendChild(floatPage);

        // 👇 把更新函数挂到 window 上，外部（jumpToPage / 书签操作后）可调用刷新
        window.__updatePdfPageFloat = updatePageFloatText;
    }

    async function renderPages(canvasWrap) {
        canvasWrap.innerHTML = '<div style="padding:20px;color:var(--text-2);">正在渲染...</div>';
        await new Promise(r => setTimeout(r, 50));
        canvasWrap.innerHTML = '';

        if (mode === 'scroll') {
            if (layout === 'single') {
                for (let i = 1; i <= total; i++) await renderPage(i, canvasWrap, 'scroll-single');
            } else {
                for (let i = 1; i <= total; i += 2) {
                    const row = el('div', { style: { display: 'flex', gap: '12px', width: '96%', maxWidth: '1000px', justifyContent: 'center', margin: '0 auto 12px' } });
                    await renderPage(i, row, 'scroll-double');
                    if (i + 1 <= total) await renderPage(i + 1, row, 'scroll-double');
                    canvasWrap.appendChild(row);
                }
            }
        } else {
            if (layout === 'single') {
                await renderPage(currentPage, canvasWrap, 'paged-single');
            } else {
                const start = currentPage % 2 !== 0 ? currentPage : currentPage - 1;
                const end = Math.min(total, start + 1);
                const row = el('div', { style: { display: 'flex', gap: '20px', width: '96%', maxWidth: '1200px', justifyContent: 'center', margin: '24px auto' } });
                for (let i = start; i <= end; i++) await renderPage(i, row, 'paged-double');
                canvasWrap.appendChild(row);
            }
        }
    }

    async function renderPage(num, parent, renderMode) {
        const page = await pdfDoc.getPage(num);
        const vp = page.getViewport({ scale: 1.5 });

        let widthStyle = '92%', marginStyle = '0 auto', boxShadowStyle = '0 4px 12px rgba(0,0,0,0.08)', borderRadiusStyle = '6px';
        if (renderMode === 'scroll-single') { widthStyle = '100%'; marginStyle = '0 auto'; boxShadowStyle = 'none'; borderRadiusStyle = '0'; }
        else if (renderMode === 'scroll-double') { widthStyle = '49%'; marginStyle = '0'; boxShadowStyle = 'none'; borderRadiusStyle = '0'; }
        else if (renderMode === 'paged-single') { widthStyle = '92%'; marginStyle = '24px auto'; }
        else if (renderMode === 'paged-double') { widthStyle = '48%'; }

        const isSelected = selectedPages.has(num);
        const wrap = el('div', {
            style: {
                position: 'relative', width: widthStyle, margin: marginStyle,
                maxWidth: renderMode.includes('double') ? '500px' : '800px',
                overflow: 'hidden', boxShadow: boxShadowStyle, borderRadius: borderRadiusStyle,
                cursor: 'pointer',

                // 👇 核心逻辑：如果当前页是点击的页，或者多选选中了，就显示蓝框
                outline: (isMulti && selectedPages.has(num)) ? '4px solid var(--primary)' : (!isMulti && currentPage === num) ? '3px solid var(--primary)' : 'none',
                // 👇 多选时变半透明
                opacity: (isMulti && selectedPages.has(num)) ? '0.7' : '1',
                background: (isMulti && selectedPages.has(num)) ? 'rgba(142, 202, 230, 0.3)' : 'transparent',
                transition: 'all 0.2s'
            },
            id: `pdf-page-wrap-${num}`,
        });

        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        c.style.display = 'block'; c.style.width = '100%'; c.style.height = 'auto';
        if (eyeMode) c.style.filter = 'sepia(0.4) contrast(0.9) brightness(0.95)';
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        wrap.appendChild(c);

        // 👇 书签标识：左上角小圆点，不遮内容
        try {
            const savedBookmarks = JSON.parse(localStorage.getItem(`kg_pdf_bookmarks_${pdfId}`) || '[]');
            const bookmarks = savedBookmarks.map(b => typeof b === 'number' ? { page: b, note: '' } : b);
            const bm = bookmarks.find(b => b.page === num);
            if (bm) {
                wrap.appendChild(el('div', {
                    style: {
                        position: 'absolute', top: '6px', left: '6px', zIndex: '5',
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: '#FFD166',
                        border: '2px solid #fff',
                        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
                        pointerEvents: 'auto',
                    },
                    title: bm.note || `第 ${num} 页书签`,
                }));
            }
        } catch { }

        // 👇 核心修复：点击事件绑定
        wrap.onclick = () => {
            if (isMulti) {
                if (selectedPages.has(num)) selectedPages.delete(num);
                else selectedPages.add(num);
                renderUI();
            } else {
                currentPage = num;
                renderUI();
            }
        };
        parent.appendChild(wrap);
        return wrap;
    }

    async function processPDF(action) {
        if (selectedPages.size === 0) { toastError('请先选择要操作的页面'); return; }
        toastSuccess('正在处理文档，请稍候...');

        try {
            const { PDFDocument } = window.PDFLib;
            const srcDoc = await PDFDocument.load(await pdfRecord.blob.arrayBuffer());
            const newDoc = await PDFDocument.create();

            if (action === 'export') {
                const pagesToExport = [...selectedPages].sort((a, b) => a - b).map(n => n - 1);
                const isSingle = pagesToExport.length === 1;

                // 👇 弹出选择框，让用户选择导出格式
                const choice = await new Promise(resolve => {
                    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
                        el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
                            el('h3', { text: '导出选中页' }),
                            el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: `共选中 ${pagesToExport.length} 页` }),
                            el('div', { class: 'confirm-actions', style: { flexDirection: 'column', gap: '8px', marginTop: '16px' } }, [
                                el('button', { class: 'btn btn-primary', text: '📄 合并导出为 PDF', onClick: () => { mask.remove(); resolve('pdf'); } }),
                                el('button', { class: 'btn btn-ghost', text: isSingle ? '🖼 直接下载为图片' : '🖼 直接下载多张图片 (不打包)', onClick: () => { mask.remove(); resolve('img-direct'); } }),
                                el('button', { class: 'btn btn-ghost', text: '🗂 打包为图片 ZIP', onClick: () => { mask.remove(); resolve('img-zip'); } }),
                                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(null); } }),
                            ])
                        ])
                    ]);
                    document.body.appendChild(mask);
                });

                if (!choice) return;

                if (choice === 'pdf') {
                    const newDoc = await PDFDocument.create();
                    const copiedPages = await newDoc.copyPages(srcDoc, pagesToExport);
                    copiedPages.forEach(p => newDoc.addPage(p));
                    const bytes = await newDoc.save();
                    const blob = new Blob([bytes], { type: 'application/pdf' });
                    await downloadFileWithPath(blob, `${pdfRecord.name}_导出.pdf`, 'application/pdf', ['.pdf']);
                }
                else if (choice === 'img-direct') {
                    // 👇 直接逐张下载（不打包）
                    toastSuccess('正在生成图片...');
                    for (let i = 0; i < pagesToExport.length; i++) {
                        const pageNum = pagesToExport[i] + 1;
                        const page = await pdfDoc.getPage(pageNum);
                        const vp = page.getViewport({ scale: 2 });
                        const c = document.createElement('canvas');
                        c.width = vp.width; c.height = vp.height;
                        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                        const imgBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));

                        // 每张图触发一次下载（浏览器可能会弹窗拦截，建议延迟 300ms）
                        const url = URL.createObjectURL(imgBlob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${pdfRecord.name}_第${pageNum}页.jpg`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        // 稍微延迟，防止浏览器拦截多个连续下载
                        await new Promise(r => setTimeout(r, 300));
                    }
                    toastSuccess('下载完成');
                }
                else if (choice === 'img-zip') {
                    // 打包 ZIP
                    toastSuccess('正在生成图片压缩包，请稍候…');
                    const zip = new window.JSZip();
                    const imgFolder = zip.folder('images');

                    for (let i = 0; i < pagesToExport.length; i++) {
                        const pageNum = pagesToExport[i] + 1;
                        const page = await pdfDoc.getPage(pageNum);
                        const vp = page.getViewport({ scale: 2 });
                        const c = document.createElement('canvas');
                        c.width = vp.width; c.height = vp.height;
                        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                        const imgBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
                        imgFolder.file(`第${pageNum}页.jpg`, imgBlob);
                    }

                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    await downloadFileWithPath(zipBlob, `${pdfRecord.name}_导出图片.zip`, 'application/zip', ['.zip']);
                }
                return;
            }

            if (action === 'delete') {
                if (selectedPages.size === 0) { toastError('请先选页'); return; }
                for (let i = 1; i <= total; i++) {
                    if (!selectedPages.has(i)) {
                        const [p] = await newDoc.copyPages(srcDoc, [i - 1]);
                        newDoc.addPage(p);
                    }
                }
            } else if (action === 'paste') {
                const data = sessionStorage.getItem('pdf_clipboard');
                if (!data) { toastError('剪贴板为空'); return; }
                const copied = JSON.parse(data).map(n => n - 1);

                for (let i = 1; i <= total; i++) {
                    const [p] = await newDoc.copyPages(srcDoc, [i - 1]);
                    newDoc.addPage(p);
                    if (i === currentPage) {
                        const pages = await newDoc.copyPages(srcDoc, copied);
                        pages.forEach(p => newDoc.addPage(p));
                    }
                }
            } else if (action === 'merge') {
                // 1. 先询问插入位置
                const insertPos = await new Promise(resolve => {
                    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
                        el('div', { class: 'confirm-box', style: { maxWidth: '300px' } }, [
                            el('h3', { text: '合并外部 PDF' }),
                            el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '要把选中的外部文件插入到哪里？' }),
                            el('div', { class: 'confirm-actions', style: { flexDirection: 'column', gap: '8px', marginTop: '16px' } }, [
                                el('button', { class: 'btn btn-ghost', text: '⬆️ 插入到最前面', onClick: () => { mask.remove(); resolve(1); } }),
                                el('button', { class: 'btn btn-ghost', text: '⬇️ 追加到最后面', onClick: () => { mask.remove(); resolve(total); } }),
                                el('button', { class: 'btn btn-primary', text: `🎯 插入到选中页之后`, onClick: () => { mask.remove(); resolve(currentPage); } }),
                                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(null); } }),
                            ])
                        ])
                    ]);
                    document.body.appendChild(mask);
                });

                if (!insertPos) return;

                // 2. 选择外部文件
                const files = await new Promise(resolve => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true;
                    input.onchange = () => resolve(Array.from(input.files || []));
                    input.click();
                });

                if (!files.length) return;

                // 3. 弹出缩略图预览进行挑选
                const selectedExternalPages = await new Promise(async (resolve) => {
                    const grid = el('div', { class: 'pdf-pages-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', maxHeight: '50vh', overflowY: 'auto', margin: '12px 0' } });
                    const selectedSet = new Set();

                    for (const file of files) {
                        const buf = await file.arrayBuffer();
                        const extDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;

                        for (let i = 1; i <= extDoc.numPages; i++) {
                            const page = await extDoc.getPage(i);
                            const vp = page.getViewport({ scale: 0.3 });
                            const c = document.createElement('canvas');
                            c.width = vp.width; c.height = vp.height;
                            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

                            const thumb = el('div', {
                                style: { border: '2px solid transparent', borderRadius: '4px', overflow: 'hidden', cursor: 'pointer', position: 'relative', background: '#eee' },
                                onClick: () => {
                                    const key = `${file.name}::${i}`;
                                    if (selectedSet.has(key)) { selectedSet.delete(key); thumb.style.borderColor = 'transparent'; }
                                    else { selectedSet.add(key); thumb.style.borderColor = 'var(--primary)'; }
                                }
                            }, [
                                el('img', { src: c.toDataURL(), style: { width: '100%', display: 'block' } }),
                                el('div', { style: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', textAlign: 'center' }, text: `${file.name.slice(0, 5)}... 第${i}页` })
                            ]);
                            grid.appendChild(thumb);
                        }
                    }

                    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
                        el('div', { class: 'confirm-box', style: { maxWidth: '600px' } }, [
                            el('h3', { text: '选择要合并的页面' }),
                            el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '点击选择你要合并进来的具体页面' }),
                            grid,
                            el('div', { class: 'confirm-actions' }, [
                                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(null); } }),
                                el('button', { class: 'btn btn-primary', text: '确认合并', onClick: () => { mask.remove(); resolve({ files, selectedSet }); } })
                            ])
                        ])
                    ]);
                    document.body.appendChild(mask);
                });

                if (!selectedExternalPages || selectedExternalPages.selectedSet.size === 0) return;

                // 4. 执行精细合并
                toastSuccess('正在合并文档…');
                const { PDFDocument } = window.PDFLib;
                const newDoc = await PDFDocument.create();
                const srcDoc = await PDFDocument.load(await pdfRecord.blob.arrayBuffer());

                // 复制主文档（到插入位置）
                const primaryPageIndices = [];
                for (let i = 1; i <= insertPos; i++) primaryPageIndices.push(i - 1);
                if (primaryPageIndices.length > 0) {
                    const copied = await newDoc.copyPages(srcDoc, primaryPageIndices);
                    copied.forEach(p => newDoc.addPage(p));
                }

                // 复制外部选中的页面
                for (const file of selectedExternalPages.files) {
                    const buf = await file.arrayBuffer();
                    const extDoc = await PDFDocument.load(buf);
                    const pagesToCopy = [];
                    for (let i = 1; i <= extDoc.getPageCount(); i++) {
                        if (selectedExternalPages.selectedSet.has(`${file.name}::${i}`)) {
                            pagesToCopy.push(i - 1);
                        }
                    }
                    if (pagesToCopy.length > 0) {
                        const copied = await newDoc.copyPages(extDoc, pagesToCopy);
                        copied.forEach(p => newDoc.addPage(p));
                    }
                }

                // 复制主文档（插入位置之后的部分）
                const remainingPageIndices = [];
                for (let i = insertPos + 1; i <= total; i++) remainingPageIndices.push(i - 1);
                if (remainingPageIndices.length > 0) {
                    const copied = await newDoc.copyPages(srcDoc, remainingPageIndices);
                    copied.forEach(p => newDoc.addPage(p));
                }

                const bytes = await newDoc.save();
                const newBlob = new Blob([bytes], { type: 'application/pdf' });
                await dbPut('pdfs', { ...pdfRecord, blob: newBlob });
                toastSuccess('合并成功，刷新页面');
                setTimeout(() => initPdf(pdfId), 500);
                return;
            }
            await finishRewrite(newDoc);
        } catch (err) { toastError('处理失败: ' + err.message); }
    }

    async function finishRewrite(newDoc) {
        const bytes = await newDoc.save();
        const newBlob = new Blob([bytes], { type: 'application/pdf' });
        await dbPut('pdfs', { ...pdfRecord, blob: newBlob });
        toastSuccess('操作成功，刷新页面');
        setTimeout(() => initPdf(pdfId), 500);
    }

    async function annotatePage(pageNum) {
        toastSuccess('生成标注图中…');
        try {
            const page = await pdfDoc.getPage(pageNum);
            const vp = page.getViewport({ scale: 2 });
            const c = document.createElement('canvas');
            c.width = vp.width; c.height = vp.height;
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            const blob = await new Promise(r => c.toBlob(r, 'image/png'));
            const imageId = uuid();
            await dbPut('images', { id: imageId, originalBlob: blob, annotatedBlob: blob, width: c.width, height: c.height, dpr: 2, createdAt: new Date().toISOString() });
            store.addImageToPoint(pointId, imageId);
            window.location.hash = `#/annotate/${imageId}?pointId=${pointId}`;
        } catch (err) { toastError('生成失败'); }
    }

    function showRecentFiles() {
        dbAll('pdfs').then(all => {
            all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto', margin: '12px 0' } });

            all.slice(0, 10).forEach(p => {
                list.appendChild(el('div', {
                    style: { padding: '12px', background: p.id === pdfId ? 'rgba(142, 202, 230, 0.15)' : 'var(--bg)', border: p.id === pdfId ? '1px solid var(--primary)' : '1px solid transparent', borderRadius: '8px', cursor: 'pointer' },
                    onClick: () => { mask.remove(); window.location.hash = `#/pdf-viewer/${p.id}?pointId=${pointId}`; }
                }, [
                    el('div', { style: { fontWeight: 'bold', fontSize: '14px' }, text: p.name }),
                    el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: new Date(p.createdAt).toLocaleString() })
                ]));
            });

            const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
                el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
                    el('h3', { text: '📂 近期文档' }),
                    list,
                    el('div', { class: 'confirm-actions', style: { flexDirection: 'column' } }, [
                        el('button', {
                            class: 'btn btn-primary', text: '📥 从本地导入新 PDF', onClick: () => {
                                mask.remove();
                                importNewPdf();
                            }
                        }),
                        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
                    ])
                ])
            ]);
            document.body.appendChild(mask);
        });
    }

    // 👇 新增：外部导入 PDF
    function importNewPdf() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/pdf'; input.multiple = true;
        input.onchange = async () => {
            const files = Array.from(input.files || []);
            if (files.length === 0) return;

            toastSuccess(`正在导入 ${files.length} 个文件…`);
            for (const file of files) {
                const newPdfId = uuid();
                await dbPut('pdfs', { id: newPdfId, blob: file, name: file.name, createdAt: new Date().toISOString() });

                const fakeImgId = uuid();
                await dbPut('images', {
                    id: fakeImgId, type: 'pdf_placeholder',
                    originalBlob: new Blob([], { type: 'text/plain' }), annotatedBlob: new Blob([], { type: 'text/plain' }), width: 0, height: 0, dpr: 1,
                    pdfId: newPdfId, pdfName: file.name, pdfPages: '?', createdAt: new Date().toISOString()
                });

                store.addImageToPoint(pointId, fakeImgId);
            }
            toastSuccess('导入完成，刷新列表');
            setTimeout(() => window.location.reload(), 500);
        };
        input.click();
    }

    initPdf(pdfId);
}

// 👇 新增：工具栏管理弹窗
function openToolManager(prefs, onSave) {
    const toolLabels = {
        mode: '阅读模式 (翻页/滚动)',
        layout: '页面布局 (单页/双页)',
        eye: '🌿 护眼模式',
        multi: '☑ 多选',
        switch: '📂 切换文档'
    };

    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', margin: '16px 0' } });

    Object.keys(toolLabels).forEach(key => {
        const isChecked = prefs[key] !== false;
        list.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' } }, [
            el('input', {
                type: 'checkbox', checked: isChecked,
                onChange: (e) => { prefs[key] = e.target.checked; }
            }),
            el('span', { text: toolLabels[key] })
        ]));
    });

    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '320px' } }, [
            el('h3', { text: '⚙️ 管理工具栏' }),
            el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '勾选的工具将显示在顶栏，未勾选的将被收起。' }),
            list,
            el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                el('button', { class: 'btn btn-primary', text: '保存设置', onClick: () => { mask.remove(); onSave(); } })
            ])
        ])
    ]);
    document.body.appendChild(mask);
}

// 👇 统一下载封装（优先唤起系统另存为对话框）
async function downloadFileWithPath(blob, filename, mimeType, extensions) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: '导出文件',
                    accept: { [mimeType]: extensions }
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            toastSuccess('导出成功');
            return;
        } catch (err) {
            if (err.name === 'AbortError') return; // 用户取消
            console.warn('另存为失败，降级为普通下载', err);
        }
    }

    // 如果不支持 showSaveFilePicker，降级为浏览器默认下载
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 1500);
    toastSuccess('已开始下载（已保存至默认下载目录）');
}