import { el, clear } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete, dbAll } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { uuid } from '../utils/id.js';
import { drawSmoothCurve, drawPressurePath, drawRect, drawLine, drawArrow, eraseCircle } from '../utils/canvas.js';
window.dbPut = dbPut;
window.uuid = uuid;

// 👇 强制指定 PDF 渲染引擎的 Worker 路径，解决 404 报错
if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

// ============ 统一的偏好读写 ============
const DEFAULT_PREFS = {
    nav: true,
    mode: true, layout: true, eye: true, multi: true, switch: true,
    rename: true, bookmark: true, thumbnail: true, outline: true
};

function getPdfPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}');
        return { ...DEFAULT_PREFS, ...saved };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function setPdfPref(key, value) {
    const current = getPdfPrefs();
    current[key] = value;
    localStorage.setItem('kg_pdf_toolbar_prefs', JSON.stringify(current));
    window.__pdfPrefsDirty = true;
}

export async function renderPdfViewer({ params, query }) {
    const pdfId = params.id;
    const pointId = query.pointId;
    const view = document.getElementById('view');
    clear(view);
    // 👇 暴力清零父容器的边距
    view.style.padding = '0';
    view.style.margin = '0';
    view.style.display = 'flex';
    view.style.flexDirection = 'column';
    view.style.position = 'relative';

    document.getElementById('page-title').textContent = 'PDF 阅读';
    document.getElementById('btn-back').classList.remove('hidden');
    document.getElementById('btn-back').onclick = () => {
        if (pointId) window.location.hash = `#/edit-point/${pointId}`;
        else window.location.hash = `#/resources`;
    };

    // 核心状态
    let pdfRecord = null, pdfDoc = null, total = 0, currentPage = 1;
    let mode = 'scroll'; // 'scroll' | 'paged'
    let layout = 'single'; // 👈 核心修复：补上没声明的 layout 变量
    let eyeMode = false;
    // 从 localStorage 读取持久化状态
    let bigTextMode = localStorage.getItem('kg_pdf_bigtext') === '1';
    let highContrastMode = localStorage.getItem('kg_pdf_contrast') === '1';
    let darkReaderMode = localStorage.getItem('kg_pdf_darkreader') === '1';
    let sepiaMode = localStorage.getItem('kg_pdf_sepia') === '1';
    let isMulti = false;
    let selectedPages = new Set();
    let dimMode = localStorage.getItem('kg_pdf_dim') === '1';     // 👈 新增：变暗遮罩
    let isFullscreen = false;
    let isOcrMode = false;
    let isScreenshotMode = false; // 👈 新增：截图模式                                        

    const container = el('div', {
        style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%', // 👈 改回 100%
            width: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative', // 👈 改回相对定位
            margin: '0',
            padding: '0',
            background: eyeMode ? '#F0F5E9' : 'var(--bg)'
        }
    });
    view.appendChild(container);

    async function initPdf(id) {
        container.innerHTML = '<div style="padding:20px;text-align:center;">加载中...</div>';
        try {
            pdfRecord = await dbGet('pdfs', id);
            if (!pdfRecord) { container.innerHTML = '文件丢失'; return; }
            const buf = await pdfRecord.blob.arrayBuffer();

            // 确保 Worker 路径被正确指定
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
            }

            pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
            total = pdfDoc.numPages;

            // 👇 核心修改：优先读取外部链接参数，其次读取上次阅读进度
            currentPage = 1;

            // 1. 尝试解析外部链接传来的 page 参数
            const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
            const targetPage = urlParams.get('page');

            if (targetPage) {
                currentPage = parseInt(targetPage);
            } else {
                // 1. 尝试解析外部链接传来的 page 参数
                const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
                const targetPage = urlParams.get('page');

                if (targetPage) {
                    currentPage = parseInt(targetPage);
                    // 👇 新增：如果是从外部链接跳转来的，顺手更新一下本地进度记录，防止下次回到旧页面
                    if (!isNaN(currentPage) && currentPage > 0) {
                        localStorage.setItem(`kg_pdf_progress_${id}`, currentPage);
                    }
                } else {
                    // 2. 如果没有外部参数，才读取本地缓存
                    const savedPage = localStorage.getItem(`kg_pdf_progress_${id}`);
                    if (savedPage) {
                        const p = parseInt(savedPage);
                        if (p >= 1 && p <= total) currentPage = p;
                    }
                }
            }

            // 3. 越界保护
            if (currentPage > total) currentPage = total;
            if (currentPage < 1) currentPage = 1;

            selectedPages.clear();

            document.querySelectorAll('#pdf-bottom-float').forEach(el => el.remove());
            document.querySelectorAll('#pdf-page-float').forEach(el => el.remove());

            renderUI();
        } catch (err) {
            console.error('PDF加载崩溃:', err);
            container.innerHTML = `<div style="padding:20px;text-align:center;color:red;">加载失败: ${err.message}</div>`;
        }
    }

    // 在 pdfViewer.js 渲染结束时，直接把父级大盒子的 padding 抹除
    setTimeout(() => {
        let parent = document.getElementById('view');
        while (parent && parent.tagName !== 'BODY') {
            parent.style.setProperty('padding', '0', 'important');
            parent.style.setProperty('margin', '0', 'important');
            parent.style.setProperty('border', 'none', 'important');
            parent.style.setProperty('border-radius', '0', 'important');
            parent = parent.parentNode;
        }
    }, 100);

    // 重命名
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

    // ============ PDF 专属搜索面板 ============
    function renderSearchInto(content) {
        content.appendChild(el('h3', { text: '🔍 搜索文档', style: { padding: '16px 16px 8px' } }));

        let currentScope = 'text'; // text | bookmark | outline
        let history = JSON.parse(localStorage.getItem(`kg_pdf_search_history_${pdfId}`) || '[]');

        // 搜索框容器
        const searchBox = el('div', { style: { padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: '10px' } });
        content.appendChild(searchBox);

        const input = el('input', {
            type: 'text', placeholder: '输入关键词开始搜索...',
            style: { width: '100%', padding: '10px 16px', borderRadius: '24px', border: '1px solid rgba(0,0,0,.1)', outline: 'none', background: 'var(--bg)', fontSize: '14px' }
        });

        // 👇 针对手写的处理：提供一次性 OCR 按钮，识别后填入搜索框
        const ocrBtn = el('button', {
            class: 'btn btn-sm btn-ghost', text: '📷 拍照识别手写',
            style: { padding: '6px 12px', borderRadius: '20px', background: 'rgba(142,202,230,0.15)', color: 'var(--primary-dark)', alignSelf: 'flex-start' },
            onClick: () => {
                const fileInput = document.createElement('input');
                fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.capture = 'environment';
                fileInput.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    toastSuccess('正在识别手写文字...');
                    try {
                        const result = await window.Tesseract.recognize(file, 'chi_sim+eng');
                        const text = result.data.text.trim();
                        if (text) { input.value = text; doSearch(); }
                        else { toastError('未识别到文字'); }
                    } catch (err) { toastError('识别失败'); }
                };
                fileInput.click();
            }
        });

        searchBox.appendChild(input);
        searchBox.appendChild(ocrBtn);

        // 分类按钮
        const scopeWrap = el('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } });
        const scopes = [
            { id: 'text', label: '📝 文本' },
            { id: 'bookmark', label: '📑 书签' },
            { id: 'outline', label: '📋 大纲' }
        ];

        scopes.forEach(s => {
            scopeWrap.appendChild(el('button', {
                class: `btn btn-sm ${currentScope === s.id ? 'btn-primary' : 'btn-ghost'}`,
                text: s.label,
                onClick: (e) => {
                    currentScope = s.id;
                    scopeWrap.querySelectorAll('.btn').forEach(b => b.className = 'btn btn-sm btn-ghost');
                    e.target.className = 'btn btn-sm btn-primary';
                    if (input.value.trim()) doSearch();
                }
            }));
        });
        searchBox.appendChild(scopeWrap);

        // 历史记录与结果容器
        const historyWrap = el('div', { style: { padding: '0 16px 12px', display: 'flex', gap: '6px', flexWrap: 'wrap' } });
        const resultWrap = el('div', { style: { flex: '1', overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' } });
        content.appendChild(historyWrap);
        content.appendChild(resultWrap);

        function renderHistory() {
            historyWrap.innerHTML = '';
            if (history.length > 0) {
                historyWrap.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '历史：' }));
                history.forEach(kw => {
                    historyWrap.appendChild(el('span', {
                        style: { fontSize: '12px', padding: '2px 8px', background: 'var(--bg)', borderRadius: '12px', cursor: 'pointer', border: '1px solid rgba(0,0,0,.05)' },
                        text: kw,
                        onClick: () => { input.value = kw; doSearch(); }
                    }));
                });
            }
        }
        renderHistory();

        async function doSearch() {
            const query = input.value.trim().toLowerCase();
            if (!query) return;

            if (!history.includes(query)) {
                history.unshift(query);
                history = history.slice(0, 10);
                localStorage.setItem(`kg_pdf_search_history_${pdfId}`, JSON.stringify(history));
                renderHistory();
            }

            resultWrap.innerHTML = '<div style="text-align:center;color:var(--text-2);padding:20px;">正在搜索...</div>';
            const results = [];

            if (currentScope === 'bookmark') {
                // 搜书签
                let bms = JSON.parse(localStorage.getItem(`kg_pdf_bookmarks_${pdfId}`) || '[]');
                bms = bms.map(b => typeof b === 'number' ? { page: b, note: '' } : b);
                bms.forEach(bm => {
                    if ((bm.note || '').toLowerCase().includes(query) || String(bm.page).includes(query)) {
                        results.push({ type: 'bookmark', title: bm.note || `第 ${bm.page} 页`, desc: `书签，在第 ${bm.page} 页`, page: bm.page });
                    }
                });
            }
            else if (currentScope === 'outline') {
                // 搜大纲
                const outlines = loadOutline();
                const flatten = (nodes) => {
                    nodes.forEach(n => {
                        if (n.title.toLowerCase().includes(query)) {
                            results.push({ type: 'outline', title: n.title, desc: `大纲，跳转到第 ${n.page} 页`, page: n.page });
                        }
                        if (n.children) flatten(n.children);
                    });
                };
                flatten(outlines);
            }
            else {
                // 搜文本（因为 PDF 全文本提取性能太差，我们用“遍历渲染好的 canvas 提取”不太现实。
                // 所以这里通过提取 PDF 的页面内容来实现核心搜索）
                try {
                    for (let i = 1; i <= total; i++) {
                        const page = await pdfDoc.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        if (pageText.toLowerCase().includes(query)) {
                            // 截取匹配的上下文
                            const idx = pageText.toLowerCase().indexOf(query);
                            const snippet = pageText.substring(Math.max(0, idx - 20), Math.min(pageText.length, idx + 30)) + '...';
                            results.push({ type: 'text', title: snippet, desc: `文本匹配，在第 ${i} 页`, page: i });
                        }
                    }
                } catch (e) { console.warn('文本搜索失败', e); }
            }

            resultWrap.innerHTML = '';
            if (results.length === 0) {
                resultWrap.innerHTML = '<div style="text-align:center;color:var(--text-2);padding:20px;">没有找到相关内容</div>';
                return;
            }

            results.forEach(res => {
                let icon = res.type === 'text' ? '📝' : (res.type === 'bookmark' ? '📑' : '📋');
                resultWrap.appendChild(el('div', {
                    style: { padding: '12px', background: 'var(--card)', borderRadius: '8px', border: '1px solid rgba(0,0,0,.05)', cursor: 'pointer' },
                    onClick: () => {
                        window.__pdfCloseDrawer();
                        jumpToPage(res.page);
                    }
                }, [
                    el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--primary-dark)' }, text: `${icon} ${res.title}` }),
                    el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' }, text: res.desc })
                ]));
            });
        }

        // 防抖搜索
        input.oninput = () => {
            clearTimeout(window.__pdfSearchTimer);
            window.__pdfSearchTimer = setTimeout(doSearch, 400);
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                clearTimeout(window.__pdfSearchTimer);
                doSearch();
            }
        };
    }

    function renderBookmarkInto(content) {
        let bookmarks = JSON.parse(localStorage.getItem(`kg_pdf_bookmarks_${pdfId}`) || '[]');
        bookmarks = bookmarks.map(b => typeof b === 'number' ? { page: b, note: '' } : b);

        let multiMode = false;
        const selectedPages = new Set();
        const thumbCache = new Map();

        function saveBookmarks() {
            localStorage.setItem(`kg_pdf_bookmarks_${pdfId}`, JSON.stringify(bookmarks));
            if (window.__updatePdfPageFloat) window.__updatePdfPageFloat();
        }

        function render() {
            content.innerHTML = '';
            content.appendChild(el('h3', { text: `📑 书签（${bookmarks.length}）`, style: { padding: '16px 16px 8px' } }));

            // 工具条
            content.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', padding: '0 16px', flexWrap: 'wrap' } }, [
                el('button', {
                    class: 'btn btn-sm btn-primary', text: '➕ 当前页',
                    onClick: () => {
                        if (bookmarks.find(b => b.page === currentPage)) { toastError('当前页已在书签中'); return; }
                        bookmarks.push({ page: currentPage, note: '' });
                        saveBookmarks(); render();
                        toastSuccess(`已添加第 ${currentPage} 页`);
                    },
                }),
                el('button', {
                    class: 'btn btn-sm ' + (multiMode ? 'btn-danger' : 'btn-ghost'),
                    text: multiMode ? '✕ 退出' : '☑ 多选',
                    onClick: () => { multiMode = !multiMode; selectedPages.clear(); render(); },
                }),
                multiMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { bookmarks.forEach(b => selectedPages.add(b.page)); render(); } }) : null,
                multiMode ? el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selectedPages.clear(); render(); } }) : null,
                multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '📕 全部折叠',
                    onClick: () => {
                        // 递归把所有节点的 expanded 设为 false
                        const collapseAll = (nodes) => nodes.forEach(n => { n.expanded = false; if (n.children) collapseAll(n.children); });
                        collapseAll(outline); render();
                    }
                }) : null,
                multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '📖 全部展开',
                    onClick: () => {
                        const expandAll = (nodes) => nodes.forEach(n => { n.expanded = true; if (n.children) expandAll(n.children); });
                        expandAll(outline); render();
                    }
                }) : null,
                multiMode && selectedPages.size > 0 ? el('button', {
                    class: 'btn btn-sm btn-danger', text: `🗑 删除(${selectedPages.size})`,
                    onClick: () => {
                        if (!confirm(`删除 ${selectedPages.size} 个书签？`)) return;
                        bookmarks = bookmarks.filter(b => !selectedPages.has(b.page));
                        selectedPages.clear(); multiMode = false;
                        saveBookmarks(); render();
                    },
                }) : null,
            ]));

            // 列表
            const list = el('div', { style: { padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' } });
            if (bookmarks.length === 0) {
                list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '32px' }, text: '暂无书签' }));
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

                    if (multiMode) {
                        row.appendChild(el('input', {
                            type: 'checkbox', checked: selectedPages.has(bm.page),
                            style: { marginTop: '20px' },
                            onChange: (e) => {
                                if (e.target.checked) selectedPages.add(bm.page);
                                else selectedPages.delete(bm.page);
                                render();
                            },
                        }));
                    }

                    const thumb = el('div', {
                        style: { width: '48px', height: '64px', background: '#eee', borderRadius: '4px', overflow: 'hidden', flexShrink: 0, cursor: 'pointer' },
                        onClick: () => { window.__pdfCloseDrawer(); jumpToPage(bm.page); },
                    });
                    row.appendChild(thumb);

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

                    const info = el('div', { style: { flex: '1', minWidth: '0' } });
                    info.appendChild(el('div', {
                        style: { fontWeight: '600', fontSize: '13px', cursor: 'pointer' },
                        text: `第 ${bm.page} 页`,
                        onClick: () => { window.__pdfCloseDrawer(); jumpToPage(bm.page); },
                    }));

                    info.appendChild(el('textarea', {
                        placeholder: '备注…',
                        value: bm.note || '',
                        style: {
                            width: '100%', marginTop: '4px', padding: '4px 6px',
                            fontSize: '12px', border: '1px solid rgba(0,0,0,.1)',
                            borderRadius: '6px', resize: 'vertical', minHeight: '36px',
                            fontFamily: 'inherit',
                        },
                        onInput: (e) => { bm.note = e.target.value; saveBookmarks(); },
                    }));
                    row.appendChild(info);

                    if (!multiMode) {
                        row.appendChild(el('button', {
                            class: 'btn btn-sm btn-ghost', text: '✕',
                            style: { color: 'var(--danger)', padding: '2px 6px', minHeight: '20px' },
                            onClick: () => {
                                bookmarks = bookmarks.filter(b => b.page !== bm.page);
                                saveBookmarks(); render();
                            },
                        }));
                    }
                    list.appendChild(row);
                }
            }
            content.appendChild(list);
        }

        render();
    }

    function renderThumbnailsInto(content) {
        // 工具条
        const toolRow = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', padding: '0 16px', flexWrap: 'wrap' } });
        content.appendChild(toolRow);

        const grid = el('div', {
            style: {
                padding: '0 16px 16px',
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px',
            },
        });
        content.appendChild(grid);

        let currentSelected = selectedPages;

        function renderTools() {
            toolRow.innerHTML = '';

            // 把按钮分成左右两组，拉开距离
            const leftGroup = el('div', { style: { display: 'flex', gap: '8px' } }, [
                el('button', { class: 'btn btn-sm btn-ghost', text: '全选', style: { padding: '4px 12px' }, onClick: () => { for (let i = 1; i <= total; i++) currentSelected.add(i); renderAll(); } }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', style: { padding: '4px 12px' }, onClick: () => { currentSelected.clear(); renderAll(); } })
            ]);

            const rightGroup = el('div', { style: { display: 'flex', gap: '8px' } });

            if (currentSelected.size > 0) {
                rightGroup.appendChild(el('button', {
                    class: 'btn btn-sm btn-danger', text: `🗑 删除 (${currentSelected.size})`,
                    style: { padding: '4px 12px' },
                    onClick: async () => {
                        if (!confirm(`删除 ${currentSelected.size} 页？`)) return;
                        window.__pdfCloseDrawer();
                        await processPDF('delete');
                    }
                }));
                rightGroup.appendChild(el('button', {
                    class: 'btn btn-sm btn-primary', text: `📤 导出 (${currentSelected.size})`,
                    style: { padding: '4px 12px' },
                    onClick: () => { window.__pdfCloseDrawer(); processPDF('export'); }
                }));
            }

            // 将两组按钮分别靠左和靠右对齐
            toolRow.style.display = 'flex';
            toolRow.style.justifyContent = 'space-between';
            toolRow.style.alignItems = 'center';
            toolRow.appendChild(leftGroup);
            toolRow.appendChild(rightGroup);
        }

        function renderAll() {
            renderTools();
            Array.from(grid.children).forEach((cell) => {
                const pageNum = parseInt(cell.dataset.page);
                const selected = currentSelected.has(pageNum);
                cell.style.borderColor = selected ? 'var(--primary)' : 'transparent';
                cell.style.opacity = selected ? '1' : '0.85';
            });
        }

        for (let i = 1; i <= total; i++) {
            const cell = el('div', {
                'data-page': String(i),
                style: {
                    position: 'relative', background: '#eee', borderRadius: '6px', overflow: 'hidden',
                    cursor: 'pointer', border: '2px solid transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                },
                onClick: () => {
                    if (currentSelected.has(i)) currentSelected.delete(i);
                    else currentSelected.add(i);
                    renderAll();
                },
            });

            const pageLabel = el('div', {
                style: { position: 'absolute', bottom: '0', left: '0', right: '0', background: 'rgba(0,0,0,.6)', color: '#fff', textAlign: 'center', fontSize: '11px', padding: '2px 0', pointerEvents: 'none' },
                text: `第 ${i} 页`,
            });
            cell.appendChild(pageLabel);

            const menuBtn = el('button', {
                style: { position: 'absolute', top: '4px', right: '4px', width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(0,0,0,.65)', color: '#fff', border: 'none', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10', padding: '0' },
                text: '▼',
                onClick: (e) => { e.stopPropagation(); showThumbMenu(e.target, i); },
            });
            cell.appendChild(menuBtn);

            grid.appendChild(cell);

            (async (pageNum, elCell) => {
                try {
                    const page = await pdfDoc.getPage(pageNum);
                    const vp = page.getViewport({ scale: 0.35 });
                    const c = document.createElement('canvas');
                    c.width = vp.width; c.height = vp.height;
                    c.style.width = '100%'; c.style.height = '100%'; c.style.objectFit = 'contain';
                    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                    elCell.insertBefore(c, elCell.firstChild);
                } catch { }
            })(i, cell);
        }

        function showThumbMenu(anchor, pageNum) {
            const existing = document.getElementById('pdf-thumb-menu');
            if (existing) existing.remove();
            const rect = anchor.getBoundingClientRect();
            const menu = el('div', {
                id: 'pdf-thumb-menu',
                style: { position: 'fixed', top: rect.bottom + 4 + 'px', left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 170)) + 'px', background: 'var(--card)', border: '1px solid rgba(0,0,0,.1)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,.15)', zIndex: '999999', minWidth: '160px', padding: '4px' },
            });
            const items = [
                { icon: '📑', label: '加入大纲', fn: () => { addOutlineFromPage(pageNum); } },

                // 👇 这里替换成了调用刚刚写的面板函数
                { icon: '🔗', label: '创建连接', fn: () => { openLinkSelector(pageNum, pdfId); } },

                {
                    icon: '🖼', label: '导出为图片', fn: async () => {
                        try {
                            toastSuccess('正在生成图片...');
                            const page = await pdfDoc.getPage(pageNum);
                            const vp = page.getViewport({ scale: 2 });
                            const c = document.createElement('canvas');
                            c.width = vp.width; c.height = vp.height;
                            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                            const blob = await new Promise(r => c.toBlob(r, 'image/png'));

                            // 👇 改用最底层不会报错的 downloadFileWithPath
                            await downloadFileWithPath(blob, `第${pageNum}页.png`, 'image/png', ['.png']);
                        } catch (err) {
                            console.error(err);
                            toastError('导出失败: ' + err.message);
                        }
                    }
                },
                {
                    icon: '📄', label: '导出为 PDF', fn: async () => {
                        try {
                            toastSuccess('正在生成PDF...');
                            const { PDFDocument } = window.PDFLib;
                            const srcDoc = await PDFDocument.load(await pdfRecord.blob.arrayBuffer());
                            const newDoc = await PDFDocument.create();
                            const [p] = await newDoc.copyPages(srcDoc, [pageNum - 1]);
                            newDoc.addPage(p);
                            const bytes = await newDoc.save();
                            const blob = new Blob([bytes], { type: 'application/pdf' });

                            // 👇 改用最底层不会报错的 downloadFileWithPath
                            await downloadFileWithPath(blob, `第${pageNum}页.pdf`, 'application/pdf', ['.pdf']);
                        } catch (err) {
                            console.error(err);
                            toastError('导出失败: ' + err.message);
                        }
                    }
                },
                {
                    icon: '🗑', label: '删除本页', fn: async () => {
                        if (!confirm(`确定删除第 ${pageNum} 页？`)) return;
                        currentSelected.clear(); currentSelected.add(pageNum);
                        window.__pdfCloseDrawer();
                        await processPDF('delete');
                    }
                },
            ];
            items.forEach(it => {
                menu.appendChild(el('div', {
                    style: { padding: '8px 12px', fontSize: '13px', cursor: 'pointer', borderRadius: '4px', display: 'flex', gap: '8px', alignItems: 'center' },
                    onClick: () => { menu.remove(); it.fn(); },
                    onPointerenter: (e) => { e.currentTarget.style.background = 'var(--bg)'; },
                    onPointerleave: (e) => { e.currentTarget.style.background = 'transparent'; },
                }, [el('span', { text: it.icon }), el('span', { text: it.label })]));
            });
            document.body.appendChild(menu);
            setTimeout(() => {
                const close = (e) => {
                    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close, true); }
                };
                document.addEventListener('pointerdown', close, true);
            }, 50);
        }

        renderAll();
    }

    // 跳页辅助函数
    // 👇 如果没有就加上这个，如果有就替换掉旧的
    function jumpToPage(pageNum) {
        currentPage = pageNum;
        localStorage.setItem(`kg_pdf_progress_${pdfId}`, pageNum);
        renderUI();

        // 👇 增加：跳转后显示“返回大纲”悬浮球
        const oldBackBtn = document.getElementById('pdf-back-outline');
        if (oldBackBtn) oldBackBtn.remove();

        const backBtn = el('button', {
            id: 'pdf-back-outline',
            style: {
                position: 'fixed', bottom: '130px', right: '20px', zIndex: '9999',
                background: 'rgba(43,45,66,0.85)', color: '#fff', padding: '8px 14px',
                borderRadius: '20px', fontWeight: 'bold', border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', gap: '6px'
            },
            text: '⬅️ 返回大纲'
        });

        backBtn.onclick = () => {
            backBtn.remove();
            if (window.__pdfOpenDrawer) window.__pdfOpenDrawer((content) => renderOutlineInto(content));
        };

        document.body.appendChild(backBtn);

        // 5秒后自动消失，不碍事
        setTimeout(() => { if (backBtn.isConnected) backBtn.remove(); }, 5000);

        setTimeout(() => {
            const target = document.getElementById(`pdf-page-wrap-${currentPage}`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    function renderUI() {
        // 1. 清理旧的悬浮球和底部栏，防止重叠
        document.querySelectorAll('#pdf-bottom-float').forEach(el => el.remove());
        document.querySelectorAll('#pdf-page-float').forEach(el => el.remove());
        document.querySelectorAll('#pdf-side-drawer').forEach(el => el.remove());
        document.querySelectorAll('#pdf-side-backdrop').forEach(el => el.remove());

        // 2. 全局滚动监听
        window.onscroll = () => {
            let closestPage = currentPage;
            let minDiff = Infinity;
            document.querySelectorAll('.pdf-page-wrap').forEach(wrap => {
                const rect = wrap.getBoundingClientRect();
                const diff = Math.abs(rect.top - 100);
                if (diff < minDiff) {
                    minDiff = diff;
                    const p = parseInt(wrap.dataset.page);
                    if (!isNaN(p)) closestPage = p;
                }
            });
            if (currentPage !== closestPage) {
                currentPage = closestPage;
                localStorage.setItem(`kg_pdf_progress_${pdfId}`, currentPage);
                if (window.__updatePdfPageFloat) window.__updatePdfPageFloat();
            }
        };

        container.innerHTML = '';
        container.style.height = 'calc(100vh - 56px)';
        container.style.overflow = 'auto';
        container.style.background = eyeMode ? '#F0F5E9' : 'var(--bg)';

        // ============ 3. 读取配置 ============
        let currentPrefs = { nav: true, mode: true, layout: true, eye: true, multi: true, switch: true, rename: true, bookmark: true, thumbnail: true, outline: true, ocr: true, insert: true, search: true };
        try {
            const saved = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}');
            currentPrefs = { ...currentPrefs, ...saved };
        } catch { }

        // ============ 4. 侧边栏宽度计算 ============
        const sidebarEl = document.getElementById('sidebar');
        const isSidebarCollapsed = sidebarEl && (sidebarEl.classList.contains('collapsed') || sidebarEl.style.display === 'none');
        const sidebarWidth = isSidebarCollapsed ? 0 : (sidebarEl ? sidebarEl.offsetWidth : 0);

        // ============ 5. 定义工具图纸 ============
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
            switch: {
                render: () => el('button', {
                    class: 'btn btn-sm btn-ghost', text: '📂', title: '切换文档',
                    onClick: () => window.__pdfOpenDrawer((content) => renderRecentFilesInto(content)),
                }),
            }
        };

        // ============ 6. 生成可见 / 隐藏工具列表 ============
        const visibleTools = [];
        if (currentPrefs.mode) visibleTools.push(...toolsMap.mode.render());
        if (currentPrefs.layout) visibleTools.push(...toolsMap.layout.render());
        if (currentPrefs.eye) visibleTools.push(toolsMap.eye.render());
        if (currentPrefs.multi) visibleTools.push(toolsMap.multi.render());
        if (currentPrefs.switch) visibleTools.push(toolsMap.switch.render());

        const hiddenTools = [];
        if (currentPrefs.eye === false) hiddenTools.push(toolsMap.eye.render());
        if (currentPrefs.multi === false) hiddenTools.push(toolsMap.multi.render());
        if (currentPrefs.switch === false) hiddenTools.push(toolsMap.switch.render());
        if (currentPrefs.mode === false) hiddenTools.push(...toolsMap.mode.render());
        if (currentPrefs.layout === false) hiddenTools.push(...toolsMap.layout.render());

        if (currentPrefs.ocr === false) hiddenTools.push(el('button', { class: 'btn btn-sm btn-ghost', text: '🔤', title: '划词提取', onClick: () => { isOcrMode = !isOcrMode; renderUI(); } }));
        if (currentPrefs.search === false) hiddenTools.push(el('button', { class: 'btn btn-sm btn-ghost', text: '🔍', title: '搜索', onClick: () => window.__pdfOpenDrawer((content) => renderSearchInto(content)) }));
        if (currentPrefs.bookmark === false) hiddenTools.push(el('button', { class: 'btn btn-sm btn-ghost', text: '📑', title: '书签', onClick: () => window.__pdfOpenDrawer((content) => renderBookmarkInto(content)) }));
        if (currentPrefs.thumbnail === false) hiddenTools.push(el('button', { class: 'btn btn-sm btn-ghost', text: '🗂', title: '缩略图', onClick: () => window.__pdfOpenDrawer((content) => renderThumbnailsInto(content)) }));
        if (currentPrefs.outline === false) hiddenTools.push(el('button', { class: 'btn btn-sm btn-ghost', text: '📋', title: '大纲', onClick: () => window.__pdfOpenDrawer((content) => renderOutlineInto(content)) }));

        // ============ 7. 组装顶栏 ============
        const topBar = el('div', {
            class: 'pdf-topbar',
            style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                height: '40px', minHeight: '40px',
                padding: '0 12px',
                margin: '0',
                borderBottom: '1px solid rgba(0,0,0,.05)',
                background: 'var(--card)',
                position: 'sticky',
                top: '0',
                zIndex: '100',
                flexShrink: '0',
                boxShadow: '0 2px 4px rgba(0,0,0,.04)',
                width: '100%'
            }
        }, [
            // 左侧：文件名
            el('span', { style: { fontWeight: 'bold', fontSize: '14px', color: 'var(--text)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }, text: pdfRecord.name }),

            // 右侧：工具集合
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', whiteSpace: 'nowrap', paddingLeft: '12px' } }, [

                // 1. 翻页组件
                currentPrefs.nav !== false ? (() => {
                    const group = el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--bg)', padding: '2px 4px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.06)' } });
                    group.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: '‹', style: { padding: '0 6px', height: '24px', fontSize: '16px' }, onClick: () => { if (currentPage > 1) { currentPage -= 1; renderUI(); } } }));
                    group.appendChild(el('input', { type: 'number', value: String(currentPage), style: { width: '36px', height: '24px', padding: '0', textAlign: 'center', fontSize: '12px', fontWeight: 'bold', border: '1px solid rgba(0,0,0,0.1)', background: 'var(--card)', borderRadius: '4px' }, onkeydown: (e) => { if (e.key === 'Enter') { const val = parseInt(e.target.value); if (val >= 1 && val <= total) { currentPage = val; renderUI(); } else e.target.value = String(currentPage); } } }));
                    group.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--text-2)', padding: '0 2px' }, text: `/ ${total}` }));
                    group.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: '›', style: { padding: '0 6px', height: '24px', fontSize: '16px' }, onClick: () => { if (currentPage < total) { currentPage += 1; renderUI(); } } }));
                    return group;
                })() : null,

                // 2. 专业标注
                el('button', {
                    class: 'btn btn-sm btn-primary', text: '🎨 专业标注', style: { padding: '4px 12px', fontWeight: '600', whiteSpace: 'nowrap' }, onClick: async () => {
                        toastSuccess('正在准备画板...');
                        const pageWrap = document.getElementById(`pdf-page-wrap-${currentPage}`);
                        if (!pageWrap) return;
                        const c = pageWrap.querySelector('canvas');
                        const canvas = document.createElement('canvas');
                        canvas.width = c.width; canvas.height = c.height;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(c, 0, 0);
                        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                        const { dbPut, dbAll } = await import('../db.js');
                        const { uuid } = await import('../utils/id.js');
                        const newImgId = uuid();
                        const pageTag = `pdf_${pdfId}_page_${currentPage}`;
                        const all = await dbAll('images');
                        const existing = all.find(img => img.source === pageTag || img.name === pageTag);
                        let finalBlob = blob;
                        let strokeBlob = null;
                        if (existing) {
                            finalBlob = existing.originalBlob || blob;
                            strokeBlob = existing.strokeBlob || null;
                        }
                        await dbPut('images', {
                            id: existing ? existing.id : newImgId,
                            originalBlob: finalBlob, strokeBlob: strokeBlob,
                            width: canvas.width, height: canvas.height, dpr: window.devicePixelRatio || 1,
                            source: pageTag, name: pageTag, createdAt: existing ? existing.createdAt : new Date().toISOString()
                        });
                        const pt = store.getPoint(pointId);
                        if (pt) {
                            if (!pt.imageIds) pt.imageIds = [];
                            if (!pt.imageIds.includes(existing ? existing.id : newImgId)) {
                                pt.imageIds.push(existing ? existing.id : newImgId);
                                store.updatePoint(pt.id, { imageIds: pt.imageIds });
                            }
                        }
                        const returnUrl = encodeURIComponent(window.location.hash);
                        window.location.hash = `#/annotate/${existing ? existing.id : newImgId}?pointId=${pointId}&pdfId=${pdfId}&page=${currentPage}&returnUrl=${returnUrl}`;
                    }
                }),

                // 3. 独立工具
                currentPrefs.rename ? el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', title: '重命名', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => window.__pdfOpenDrawer((content) => { /* ... */ }) }) : null,
                currentPrefs.bookmark ? el('button', { class: 'btn btn-sm btn-ghost', text: '📑', title: '书签', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => window.__pdfOpenDrawer((content) => renderBookmarkInto(content)) }) : null,
                currentPrefs.search !== false ? el('button', { class: 'btn btn-sm btn-ghost', text: '🔍', title: '搜索', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => window.__pdfOpenDrawer((content) => renderSearchInto(content)) }) : null,
                currentPrefs.thumbnail ? el('button', { class: 'btn btn-sm btn-ghost', text: '🗂', title: '缩略图', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => window.__pdfOpenDrawer((content) => renderThumbnailsInto(content)) }) : null,
                currentPrefs.outline ? el('button', { class: 'btn btn-sm btn-ghost', text: '📋', title: '大纲', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => window.__pdfOpenDrawer((content) => renderOutlineInto(content)) }) : null,
                currentPrefs.ocr !== false ? el('button', { class: 'btn btn-sm btn-ghost', text: '🔤', title: 'OCR', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px', background: isOcrMode ? 'var(--primary)' : '', color: isOcrMode ? '#fff' : '' }, onClick: () => { isOcrMode = !isOcrMode; renderUI(); } }) : null,
                currentPrefs.insert !== false ? el('button', {
                    class: 'btn btn-sm btn-ghost',
                    text: '➕',
                    title: '插入新页面',
                    style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' },
                    onClick: () => openInsertPageModal()
                }) : null,

                // 👈 挂载设置里勾选的工具
                ...visibleTools,

                el('button', { class: 'btn btn-sm btn-ghost', text: '⛶', title: '全屏', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => { isFullscreen = !isFullscreen; renderUI(); } }),

                // 更多工具菜单
                (() => {
                    if (hiddenTools.length === 0) return null;
                    return el('button', {
                        class: 'btn btn-sm btn-ghost', text: '⋮', title: '更多工具',
                        style: { padding: '4px 8px', fontSize: '18px', fontWeight: 'bold' },
                        onClick: (e) => {
                            e.stopPropagation();
                            document.querySelectorAll('.pdf-extra-menu').forEach(m => m.remove());
                            const menu = el('div', { class: 'pdf-extra-menu', style: { position: 'fixed', top: (e.clientY + 24) + 'px', left: Math.max(10, e.clientX - 150) + 'px', background: 'var(--card)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', borderRadius: '12px', padding: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap', maxWidth: '300px', border: '1px solid rgba(0,0,0,.08)', zIndex: '999999' } }, hiddenTools);
                            document.body.appendChild(menu);
                            setTimeout(() => {
                                const closeMenu = (ev) => { if (!menu.contains(ev.target) && ev.target.textContent !== '⋮') { menu.remove(); document.removeEventListener('pointerdown', closeMenu, true); } };
                                document.addEventListener('pointerdown', closeMenu, true);
                            }, 50);
                        }
                    });
                })(),

                el('button', { class: 'btn btn-sm btn-ghost', text: '⚙️', title: '设置', style: { width: '32px', height: '32px', padding: 0, fontSize: '16px' }, onClick: () => window.__pdfOpenDrawer((content) => renderSettingsInto(content)) })
            ])
        ]);
        container.appendChild(topBar);

        // 8. 彻底废除推挤式布局，永远 100% 宽度
        const updateLayout = () => {
            container.style.marginLeft = '0';
            container.style.width = '100%';
            const bar = document.querySelector('.pdf-topbar');
            if (bar) bar.style.left = '0';
        };
        updateLayout();

        // 9. 画布渲染区
        const scrollWrap = el('div', { style: { width: '100%', display: 'block' } });
        const canvasWrap = el('div', { style: { display: 'block', width: '100%', padding: '50px 0 150px 0' } });
        scrollWrap.appendChild(canvasWrap);
        container.appendChild(scrollWrap);

        renderPages(canvasWrap);

        // 11. 侧边抽屉初始化
        let sidePref = 'right';
        try { sidePref = localStorage.getItem('kg_pdf_side_pref') || 'right'; } catch { }

        const drawerBackdrop = el('div', {
            id: 'pdf-side-backdrop',
            style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.3)', zIndex: '99998', display: 'none' },
            onClick: () => closeDrawer(),
        });
        document.body.appendChild(drawerBackdrop);

        const sideDrawer = el('div', {
            id: 'pdf-side-drawer',
            style: {
                position: 'fixed', top: '0', bottom: '0', width: 'min(360px, 88vw)',
                background: 'var(--card)', boxShadow: '0 0 20px rgba(0,0,0,.2)',
                zIndex: '99999', display: 'flex', flexDirection: 'column',
                transition: 'transform .25s ease',
                [sidePref === 'right' ? 'right' : 'left']: '0',
                transform: sidePref === 'right' ? 'translateX(110%)' : 'translateX(-110%)',
            },
        });
        document.body.appendChild(sideDrawer);

        function openDrawer(contentFn, side) {
            if (side && side !== sidePref) {
                sidePref = side;
                localStorage.setItem('kg_pdf_side_pref', side);
                sideDrawer.style.right = '';
                sideDrawer.style.left = '';
                sideDrawer.style[side === 'right' ? 'right' : 'left'] = '0';
                sideDrawer.style.transform = side === 'right' ? 'translateX(110%)' : 'translateX(-110%)';
            }
            sideDrawer.innerHTML = '';

            const sideSwitch = el('div', { style: { padding: '8px 16px 0', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 } }, [
                el('button', {
                    class: 'btn btn-sm btn-ghost',
                    text: sidePref === 'right' ? '⇤ 左侧' : '右侧 ⇥',
                    onClick: () => { const newSide = sidePref === 'right' ? 'left' : 'right'; closeDrawer(); setTimeout(() => openDrawer(contentFn, newSide), 300); },
                }),
            ]);
            sideDrawer.appendChild(sideSwitch);

            const content = el('div', { style: { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column' } });
            sideDrawer.appendChild(content);
            contentFn(content);

            drawerBackdrop.style.display = 'block';
            requestAnimationFrame(() => { sideDrawer.style.transform = 'translateX(0)'; });
        }

        function closeDrawer() {
            sideDrawer.style.transform = sidePref === 'right' ? 'translateX(110%)' : 'translateX(-110%)';
            drawerBackdrop.style.display = 'none';
            if (window.__pdfPrefsDirty) {
                window.__pdfPrefsDirty = false;
                setTimeout(() => renderUI(), 300);
            }
        }

        window.__pdfOpenDrawer = openDrawer;
        window.__pdfCloseDrawer = closeDrawer;
    }


    function renderSettingsInto(content) {
        content.appendChild(el('h3', { text: '⚙️ 设置', style: { padding: '16px 16px 8px' } }));

        // 👇 直接写辅助函数，绕过内存中的 prefs 变量
        function getPrefs() {
            try { return JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}'); }
            catch { return {}; }
        }

        function setPref(key, val) {
            const p = getPrefs();
            p[key] = val;
            localStorage.setItem('kg_pdf_toolbar_prefs', JSON.stringify(p));
            window.__pdfPrefsDirty = true; // 通知顶部按钮重建
        }

        const toolsMap = {
            mode: {
                render: () => [
                    { id: 'paged', label: '📖 翻页' },
                    { id: 'scroll', label: '📜 滚动' },
                ].map(m => el('button', { class: 'btn btn-sm ' + (mode === m.id ? 'btn-primary' : 'btn-ghost'), text: m.label, onClick: () => { mode = m.id; window.__pdfCloseDrawer(); renderUI(); } })),
            },
            layout: {
                render: () => [
                    { id: 'single', label: '单页' },
                    { id: 'double', label: '双页' },
                ].map(l => el('button', { class: 'btn btn-sm ' + (layout === l.id ? 'btn-primary' : 'btn-ghost'), text: l.label, onClick: () => { layout = l.id; window.__pdfCloseDrawer(); renderUI(); } })),
            },
            eye: { render: () => el('button', { class: 'btn btn-sm ' + (eyeMode ? 'btn-primary' : 'btn-ghost'), text: '🌿 护眼', onClick: () => { eyeMode = !eyeMode; window.__pdfCloseDrawer(); renderUI(); } }) },
            multi: { render: () => el('button', { class: 'btn btn-sm ' + (isMulti ? 'btn-danger' : 'btn-ghost'), text: isMulti ? '✕ 退出多选' : '☑ 多选', onClick: () => { isMulti = !isMulti; selectedPages.clear(); window.__pdfCloseDrawer(); renderUI(); } }) },
        };

        // 阅读模式
        content.appendChild(el('div', { style: { padding: '0 16px 12px' } }, [
            el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px', fontWeight: '600' }, text: '阅读模式' }),
            el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, toolsMap.mode.render()),
        ]));

        // 页面布局
        content.appendChild(el('div', { style: { padding: '0 16px 12px', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
            el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px', fontWeight: '600' }, text: '页面布局' }),
            el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, toolsMap.layout.render()),
        ]));

        // 其他
        content.appendChild(el('div', { style: { padding: '0 16px 12px', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
            el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px', fontWeight: '600' }, text: '其他' }),
            el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
                toolsMap.eye.render(),
                toolsMap.multi.render(),
            ]),
        ]));

        // 显示模式
        content.appendChild(el('div', { style: { padding: '0 16px 12px', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
            el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px', fontWeight: '600' }, text: '显示模式' }),
            el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
                el('button', { class: 'btn btn-sm ' + (bigTextMode ? 'btn-primary' : 'btn-ghost'), text: '🔍 大文字', onClick: () => { bigTextMode = !bigTextMode; window.__pdfCloseDrawer(); renderUI(); } }),
                el('button', { class: 'btn btn-sm ' + (highContrastMode ? 'btn-primary' : 'btn-ghost'), text: '🌗 高对比度', onClick: () => { highContrastMode = !highContrastMode; window.__pdfCloseDrawer(); renderUI(); } }),
                el('button', { class: 'btn btn-sm ' + (darkReaderMode ? 'btn-primary' : 'btn-ghost'), text: '🌑 暗色反色', onClick: () => { darkReaderMode = !darkReaderMode; window.__pdfCloseDrawer(); renderUI(); } }),
                el('button', { class: 'btn btn-sm ' + (sepiaMode ? 'btn-primary' : 'btn-ghost'), text: '📜 羊皮纸', onClick: () => { sepiaMode = !sepiaMode; window.__pdfCloseDrawer(); renderUI(); } }),
                el('button', {
                    class: 'btn btn-sm ' + (dimMode ? 'btn-primary' : 'btn-ghost'),
                    text: '🌘 变暗遮罩',
                    onClick: () => {
                        dimMode = !dimMode;
                        localStorage.setItem('kg_pdf_dim', dimMode ? '1' : '0');
                        window.__pdfCloseDrawer();
                        renderUI();
                    }
                }),
            ]),
        ]));

        // 外置工具栏显示列表
        // 外置工具栏显示列表
        const prefsHeader = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } }, [
            el('div', { style: { fontSize: '13px', color: 'var(--text-2)', fontWeight: '600' }, text: '外置工具栏显示' }),
            el('div', { style: { display: 'flex', gap: '6px' } }, [
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全选',
                    style: { fontSize: '12px', padding: '2px 8px', minHeight: '24px', height: '24px' },
                    onClick: () => {
                        const cbs = document.querySelectorAll('#pdf-prefs-container input[type="checkbox"]');
                        let p = {};
                        try { p = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}'); } catch { }
                        cbs.forEach(cb => {
                            cb.checked = true;
                            if (cb.dataset.key) p[cb.dataset.key] = true;
                        });
                        localStorage.setItem('kg_pdf_toolbar_prefs', JSON.stringify(p));
                        window.__pdfPrefsDirty = true;
                    }
                }),
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全不选',
                    style: { fontSize: '12px', padding: '2px 8px', minHeight: '24px', height: '24px' },
                    onClick: () => {
                        const cbs = document.querySelectorAll('#pdf-prefs-container input[type="checkbox"]');
                        let p = {};
                        try { p = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}'); } catch { }
                        cbs.forEach(cb => {
                            cb.checked = false;
                            if (cb.dataset.key) p[cb.dataset.key] = false;
                        });
                        localStorage.setItem('kg_pdf_toolbar_prefs', JSON.stringify(p));
                        window.__pdfPrefsDirty = true;
                    }
                })
            ])
        ]);

        content.appendChild(el('div', { style: { padding: '0 16px 16px', borderTop: '1px solid rgba(0,0,0,.05)', paddingTop: '12px' } }, [
            prefsHeader,
            el('div', { id: 'pdf-prefs-container', style: { display: 'flex', flexDirection: 'column', gap: '6px' } })
        ]));

        // 强制在渲染完后，独立注入勾选框
        requestAnimationFrame(() => {
            const container = document.getElementById('pdf-prefs-container');
            if (!container) return;
            container.innerHTML = '';

            let currentPrefs = { nav: true, mode: true, layout: true, eye: true, multi: true, switch: true, rename: true, bookmark: true, thumbnail: true, outline: true, ocr: true };
            try {
                const saved = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}');
                currentPrefs = { ...currentPrefs, ...saved };
            } catch { }

            // 👇 核心修复：在设置面板里补上 toolsMap，否则这里会报错导致勾选框出不来
            const toolsMap = {
                mode: { render: () => [] }, // 占位
                layout: { render: () => [] },
                eye: { render: () => null },
                multi: { render: () => null },
                switch: { render: () => null }
            };

            const visibleTools = [];
            if (currentPrefs.mode) visibleTools.push(...toolsMap.mode.render());
            if (currentPrefs.layout) visibleTools.push(...toolsMap.layout.render());
            if (currentPrefs.eye) visibleTools.push(toolsMap.eye.render());
            if (currentPrefs.multi) visibleTools.push(toolsMap.multi.render());
            if (currentPrefs.switch) visibleTools.push(toolsMap.switch.render());

            const list = [
                ['rename', '✏️ 重命名'],
                ['nav', 'PDF翻页条'],
                ['bookmark', '📑 书签'],
                ['thumbnail', '🗂 缩略图总览'],
                ['outline', '📋 大纲'],
                ['mode', '📖 阅读模式'],
                ['layout', '单页/双页'],
                ['eye', '🌿 护眼'],
                ['ocr', '🔤 划词提取'],
                ['search', '🔍 搜索PDF'],
                ['insert', '➕ 插入页'],
                ['multi', '☑ 多选'],
                ['switch', '📂 切换文档'],
            ];

            let savedPrefs = {};
            try {
                savedPrefs = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}');
            } catch { }

            list.forEach(([key, label]) => {
                const isChecked = savedPrefs[key] !== false;
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = isChecked;
                cb.dataset.key = key;

                // 👇 这里是记忆的核心：只要勾选，立刻存进本地
                cb.onclick = (e) => {
                    let p = {};
                    try { p = JSON.parse(localStorage.getItem('kg_pdf_toolbar_prefs') || '{}'); } catch { }
                    p[key] = e.target.checked;
                    localStorage.setItem('kg_pdf_toolbar_prefs', JSON.stringify(p));
                    window.__pdfPrefsDirty = true;
                };

                const labelEl = document.createElement('label');
                labelEl.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; padding:4px 0';
                labelEl.appendChild(cb);

                const spanEl = document.createElement('span');
                spanEl.textContent = label;
                labelEl.appendChild(spanEl);

                container.appendChild(labelEl);
            });
        });

        // 底部两个辅助按钮
        content.appendChild(el('div', { style: { padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' } }, [
            el('button', {
                class: 'btn btn-primary',
                text: '✅ 应用并刷新界面',
                style: { width: '100%' },
                onClick: () => {
                    window.__pdfPrefsDirty = false;
                    window.__pdfCloseDrawer();
                    setTimeout(() => renderUI(), 300);
                }
            }),
        ]));

        // 底部加个「恢复默认」按钮，防止用户把自己锁死
        content.appendChild(el('div', { style: { padding: '0 16px 16px' } }, [
            el('button', {
                class: 'btn btn-ghost', text: '🔄 恢复全部显示', style: { width: '100%', color: 'var(--danger)' },
                onClick: () => {
                    localStorage.removeItem('kg_pdf_toolbar_prefs');
                    window.__pdfPrefsDirty = true;
                    window.__pdfCloseDrawer();
                    setTimeout(() => renderUI(), 300);
                }
            })
        ]));
    }

    // 读取/保存大纲
    function loadOutline() {
        try { return JSON.parse(localStorage.getItem(`kg_pdf_outline_${pdfId}`) || '[]'); }
        catch { return []; }
    }
    function saveOutline(outline) {
        localStorage.setItem(`kg_pdf_outline_${pdfId}`, JSON.stringify(outline));
    }

    async function autoDetectOutline() {
        try {
            const outline = await pdfDoc.getOutline();
            if (!outline || outline.length === 0) return null;
            const result = [];
            async function walk(items) {
                for (const it of items) {
                    let pageNum = 0;
                    if (typeof it.dest === 'string') {
                        try {
                            const dest = await pdfDoc.getDestination(it.dest);
                            const ref = dest?.[0];
                            if (ref && typeof ref === 'object') { const idx = await pdfDoc.getPageIndex(ref); pageNum = idx + 1; }
                        } catch { }
                    } else if (Array.isArray(it.dest)) {
                        try {
                            const ref = it.dest[0];
                            if (ref && typeof ref === 'object') { const idx = await pdfDoc.getPageIndex(ref); pageNum = idx + 1; }
                        } catch { }
                    }
                    result.push({ title: it.title || '未命名', page: pageNum || 1 });
                    if (it.items) await walk(it.items);
                }
            }
            await walk(outline);
            return result;
        } catch { return null; }
    }

    function renderOutlineInto(content) {
        let outline = loadOutline();
        if (!Array.isArray(outline)) outline = [];

        let multiMode = false;
        const selectedNodes = new Set(); // 用于存放选中的节点对象

        // 辅助：递归收集所有节点（用于一键全选）
        function getAllNodes(nodes, result = []) {
            nodes.forEach(n => {
                result.push(n);
                if (n.children && n.children.length > 0) getAllNodes(n.children, result);
            });
            return result;
        }

        // 辅助：递归删除节点
        function removeNodes(nodes, toRemoveSet) {
            for (let i = nodes.length - 1; i >= 0; i--) {
                if (toRemoveSet.has(nodes[i])) {
                    nodes.splice(i, 1);
                } else if (nodes[i].children && nodes[i].children.length > 0) {
                    removeNodes(nodes[i].children, toRemoveSet);
                }
            }
        }

        function render() {
            content.innerHTML = '';
            content.appendChild(el('h3', { text: `📋 大纲树`, style: { padding: '16px 16px 8px' } }));

            // ============ 顶部工具栏 ============
            const toolRow = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px', padding: '0 16px', flexWrap: 'wrap' } }, [
                el('button', {
                    class: 'btn btn-sm ' + (multiMode ? 'btn-danger' : 'btn-ghost'),
                    text: multiMode ? '✕ 退出' : '☑ 多选',
                    style: { padding: '4px 8px', fontSize: '12px' }, // 👈 调小
                    onClick: () => { multiMode = !multiMode; selectedNodes.clear(); render(); }
                }),
                multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全选',
                    style: { padding: '4px 8px', fontSize: '12px' },
                    onClick: () => { getAllNodes(outline).forEach(n => selectedNodes.add(n)); render(); }
                }) : null,
                multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '全不选',
                    style: { padding: '4px 8px', fontSize: '12px' },
                    onClick: () => { selectedNodes.clear(); render(); }
                }) : null,
                multiMode && selectedNodes.size > 0 ? el('button', {
                    class: 'btn btn-sm btn-danger', text: `🗑 删除(${selectedNodes.size})`,
                    style: { padding: '4px 8px', fontSize: '12px' },
                    onClick: () => {
                        if (confirm(`确定删除选中的 ${selectedNodes.size} 条大纲及其子级吗？`)) {
                            removeNodes(outline, selectedNodes);
                            selectedNodes.clear(); multiMode = false;
                            saveOutline(outline); render();
                        }
                    }
                }) : null,

                // 非多选时显示的按钮
                !multiMode ? el('button', {
                    class: 'btn btn-sm btn-primary', text: '➕ 添加',
                    style: { padding: '4px 8px', fontSize: '12px' }, // 👈 调小
                    onClick: () => addNode(null)
                }) : null,
                !multiMode ? el('button', {
                    class: 'btn btn-sm btn-ghost', text: '🔍 识别',
                    style: { padding: '4px 8px', fontSize: '12px' }, // 👈 调小
                    onClick: async () => {
                        toastSuccess('正在识别…');
                        const detected = await autoDetectOutline();
                        if (!detected || detected.length === 0) { toastError('无内置大纲'); return; }
                        if (!confirm(`识别到 ${detected.length} 个主目录，是否替换当前大纲？`)) return;
                        outline = detected; saveOutline(outline); render();
                    }
                }) : null,
                !multiMode && outline.length > 0 ? el('button', {
                    class: 'btn btn-sm btn-danger', text: '🗑 清空',
                    style: { padding: '4px 8px', fontSize: '12px' }, // 👈 调小
                    onClick: () => {
                        if (confirm('清空所有大纲？')) { outline = []; saveOutline(outline); render(); }
                    }
                }) : null,
            ]);
            content.appendChild(toolRow);

            // ============ 树状列表 ============
            const list = el('div', { style: { padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '4px' } });

            if (outline.length === 0) {
                list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '32px' }, text: '暂无大纲' }));
            } else {
                function renderTree(nodes, parentArray, depth = 0) {
                    nodes.forEach((node, index) => {
                        if (!node.children) node.children = [];
                        if (node.expanded === undefined) node.expanded = true;
                        const isChecked = selectedNodes.has(node);
                        const isCurrent = currentPage === node.page;

                        const row = el('div', {
                            style: {
                                display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px',
                                background: isChecked ? 'rgba(239,71,111,.1)' : (isCurrent ? 'rgba(142,202,230,0.15)' : 'transparent'),
                                border: isChecked ? '1px solid var(--danger)' : (isCurrent ? '1px solid var(--primary)' : '1px solid transparent'),
                                borderRadius: '6px', cursor: 'pointer',
                                marginLeft: (depth * 16) + 'px',
                                transition: 'all 0.2s'
                            }
                        });

                        // 1. 多选/折叠
                        if (multiMode) {
                            row.appendChild(el('input', {
                                type: 'checkbox', checked: isChecked,
                                style: { margin: '0 4px 0 0', cursor: 'pointer' },
                                onChange: (e) => { e.target.checked ? selectedNodes.add(node) : selectedNodes.delete(node); render(); }
                            }));
                        }

                        if (node.children.length > 0) {
                            row.appendChild(el('button', {
                                style: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-2)', padding: '0 4px' },
                                text: node.expanded ? '▼' : '▶',
                                onClick: (e) => { e.stopPropagation(); node.expanded = !node.expanded; render(); }
                            }));
                        } else {
                            row.appendChild(el('span', { style: { width: multiMode ? '12px' : '20px', display: 'inline-block' } }));
                        }

                        // 2. 点击跳转与标题（自动高亮当前页）
                        const isCurrentPage = node.page === currentPage;
                        row.appendChild(el('span', {
                            style: {
                                flex: '1', fontSize: '13px', fontWeight: (depth === 0 || isCurrentPage) ? '600' : '400',
                                cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                color: isChecked ? 'var(--danger)' : (isCurrentPage ? 'var(--primary-dark)' : 'inherit'),
                                background: isCurrentPage ? 'rgba(142,202,230,0.15)' : 'transparent',
                                padding: isCurrentPage ? '2px 6px' : '0',
                                borderRadius: isCurrentPage ? '4px' : '0'
                            },
                            text: `${node.title} (P${node.page})`,
                            onClick: () => { if (!multiMode) { window.__pdfCloseDrawer(); jumpToPage(node.page); } else { selectedNodes.has(node) ? selectedNodes.delete(node) : selectedNodes.add(node); render(); } }
                        }));

                        // 3. 操作按钮（非多选时显示）
                        if (!multiMode) {
                            const actions = el('div', { style: { display: 'flex', gap: '2px' } }, [
                                el('button', { class: 'btn btn-sm btn-ghost', text: '➕', title: '添加子级', style: { padding: '2px 4px', minHeight: '20px', fontSize: '12px' }, onClick: (e) => { e.stopPropagation(); addNode(node); } }),
                                el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', title: '修改', style: { padding: '2px 4px', minHeight: '20px', fontSize: '12px' }, onClick: (e) => { e.stopPropagation(); editNode(node); } }),
                                el('button', {
                                    class: 'btn btn-sm btn-ghost', text: '✕', title: '删除', style: { padding: '2px 4px', minHeight: '20px', fontSize: '12px', color: 'var(--danger)' }, onClick: (e) => {
                                        e.stopPropagation();
                                        if (confirm(`删除「${node.title}」及其子级？`)) { parentArray.splice(index, 1); saveOutline(outline); render(); }
                                    }
                                }),
                            ]);
                            row.appendChild(actions);
                        }
                        list.appendChild(row);

                        // 递归渲染子级
                        if (node.expanded && node.children.length > 0) {
                            renderTree(node.children, node.children, depth + 1);
                        }
                    });
                }
                renderTree(outline, outline);
            }
            content.appendChild(list);
        }

        // 👇 辅助：自定义的大纲输入弹窗（标题 + 页码）
        function openOutlineEditModal(defaultTitle, defaultPage, onSave) {
            const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
            const box = el('div', { class: 'confirm-box', style: { maxWidth: '320px' } });
            mask.appendChild(box);

            box.appendChild(el('h3', { text: '📝 编辑大纲' }));

            // 标题输入
            const titleInput = el('input', {
                type: 'text', value: defaultTitle || '',
                placeholder: '输入大纲标题（如：第一章）',
                style: { width: '100%', padding: '8px 12px', marginBottom: '12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.15)', fontSize: '14px' }
            });
            box.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: '大纲标题' }));
            box.appendChild(titleInput);

            // 页码输入
            const pageInput = el('input', {
                type: 'number', min: '1', max: String(total), value: String(defaultPage || currentPage),
                style: { width: '100%', padding: '8px 12px', marginBottom: '16px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.15)', fontSize: '14px' }
            });
            box.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '4px' }, text: `跳转页码 (1 - ${total})` }));
            box.appendChild(pageInput);

            // 按钮
            box.appendChild(el('div', { class: 'confirm-actions' }, [
                el('button', {
                    class: 'btn btn-primary', text: '确定',
                    onClick: () => {
                        const title = titleInput.value.trim() || `第 ${pageInput.value} 页`;
                        const page = parseInt(pageInput.value);
                        if (!page || page < 1 || page > total) { toastError('页码无效'); return; }
                        mask.remove();
                        onSave(title, page);
                    }
                }),
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
            ]));

            document.body.appendChild(mask);
            setTimeout(() => titleInput.focus(), 100); // 自动聚焦到标题
        }

        // 👇 添加节点（调用自定义弹窗）
        function addNode(parentNode) {
            openOutlineEditModal('', currentPage, (title, page) => {
                const newNode = { title, page, children: [], expanded: true };
                if (parentNode) {
                    if (!parentNode.children) parentNode.children = [];
                    parentNode.children.push(newNode);
                    parentNode.expanded = true;
                } else {
                    outline.push(newNode);
                }
                saveOutline(outline); render(); toastSuccess('已添加');
            });
        }

        // 👇 修改节点（调用自定义弹窗）
        function editNode(node) {
            openOutlineEditModal(node.title, node.page, (title, page) => {
                node.title = title;
                node.page = page;
                saveOutline(outline); render(); toastSuccess('已修改');
            });
        }

        render();
    }

    function addOutlineFromPage(pageNum) {
        const title = prompt(`为第 ${pageNum} 页添加大纲标题：`);
        if (title === null) return;
        const outline = loadOutline();
        outline.push({ title: title || `第 ${pageNum} 页`, page: pageNum });
        saveOutline(outline);
        toastSuccess('已加入大纲');
    }

    function saveOutline(outline) {
        localStorage.setItem(`kg_pdf_outline_${pdfId}`, JSON.stringify(outline));
    }

    // 自动识别 PDF 原书大纲
    async function autoDetectOutline() {
        try {
            const rawOutline = await pdfDoc.getOutline();
            if (!rawOutline || rawOutline.length === 0) return null;

            async function walk(items) {
                const result = [];
                for (const it of items) {
                    let pageNum = 0;
                    if (typeof it.dest === 'string') {
                        try {
                            const dest = await pdfDoc.getDestination(it.dest);
                            const ref = dest?.[0];
                            if (ref && typeof ref === 'object') { const idx = await pdfDoc.getPageIndex(ref); pageNum = idx + 1; }
                        } catch { }
                    } else if (Array.isArray(it.dest)) {
                        try {
                            const ref = it.dest[0];
                            if (ref && typeof ref === 'object') { const idx = await pdfDoc.getPageIndex(ref); pageNum = idx + 1; }
                        } catch { }
                    }

                    const node = { title: it.title || '未命名', page: pageNum || 1, children: [], expanded: true };
                    if (it.items && it.items.length > 0) {
                        node.children = await walk(it.items); // 👈 递归识别子级
                    }
                    result.push(node);
                }
                return result;
            }

            return await walk(rawOutline);
        } catch { return null; }
    }

    async function openOutlinePanel() {
        let outline = loadOutline();
        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
        const box = el('div', { class: 'confirm-box', style: { maxWidth: '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' } });
        mask.appendChild(box);

        function renderList() {
            listWrap.innerHTML = '';

            if (currentTab === 'pdf') {
                for (let i = 1; i <= Math.min(50, currentPdfPages); i++) {
                    if (i === pageNum) continue;
                    listWrap.appendChild(el('button', {
                        class: 'btn btn-ghost',
                        style: { justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', border: '1px solid rgba(0,0,0,.05)' },
                        text: `跳转到第 ${i} 页`,
                        onClick: () => {
                            let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                            links.push({ sourcePage: pageNum, targetPage: i, targetTitle: `第 ${i} 页` });
                            localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                            toastSuccess(`已生成连接：当前页 ➡️ 第 ${i} 页`);
                            mask.remove();
                        }
                    }));
                }
            }
            else if (currentTab === 'otherPdf') {
                // 👇 放弃查库，直接显示导入按钮
                listWrap.appendChild(el('button', {
                    class: 'btn btn-primary',
                    text: '📁 从本地选择 PDF 并关联',
                    style: { width: '100%', marginBottom: '10px' },
                    onClick: () => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'application/pdf';
                        input.onchange = async () => {
                            const file = input.files[0];
                            if (!file) return;

                            const newPdfId = uuid();
                            // 保护性写入，防止非本地服务器环境下的 dbPut 报错
                            try {
                                if (typeof dbPut === 'function') {
                                    await dbPut('pdfs', { id: newPdfId, blob: file, name: file.name, createdAt: new Date().toISOString() });
                                }
                            } catch (e) { console.warn('存库失败，不影响本次关联'); }

                            const targetP = prompt(`已导入「${file.name}」\n要跳转到第几页？`, '1');
                            if (!targetP) return;

                            let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                            links.push({
                                sourcePage: pageNum,
                                targetPdfId: newPdfId,
                                targetPdfName: file.name,
                                targetPage: parseInt(targetP),
                                targetTitle: `${file.name} (第${targetP}页)`
                            });
                            localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                            toastSuccess(`已生成外部连接！`);
                            mask.remove();
                        };
                        input.click();
                    }
                }));

                // 尝试读取历史，失败了就不显示，绝不报错卡死
                try {
                    if (typeof dbAll === 'function') {
                        dbAll('pdfs').then(allPdfs => {
                            if (!allPdfs) return;
                            const otherPdfs = allPdfs.filter(p => p.id !== pdfId);
                            if (otherPdfs.length > 0) {
                                listWrap.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', margin: '8px 0 4px' }, text: '或选择已导入的文档：' }));
                                otherPdfs.forEach(p => {
                                    listWrap.appendChild(el('button', {
                                        class: 'btn btn-ghost',
                                        style: { justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', border: '1px solid rgba(0,0,0,.05)' },
                                        text: `📄 ${p.name}`,
                                        onClick: () => {
                                            const targetP = prompt(`要跳转到「${p.name}」的第几页？`, '1');
                                            if (!targetP) return;

                                            let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                                            links.push({
                                                sourcePage: pageNum,
                                                targetPdfId: p.id,
                                                targetPdfName: p.name,
                                                targetPage: parseInt(targetP),
                                                targetTitle: `${p.name} (第${targetP}页)`
                                            });
                                            localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                                            toastSuccess(`已生成跨文档连接`);
                                            mask.remove();
                                        }
                                    }));
                                });
                            }
                        }).catch(e => console.warn('获取列表失败', e));
                    }
                } catch (e) { }
            }
            else if (currentTab === 'point') {
                // 保持原本的
                if (allPoints.length === 0) {
                    listWrap.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '20px' }, text: '暂无知识点' }));
                } else {
                    allPoints.slice(0, 30).forEach(p => {
                        listWrap.appendChild(el('button', {
                            class: 'btn btn-ghost',
                            style: { justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', border: '1px solid rgba(0,0,0,.05)' },
                            text: p.content ? p.content.slice(0, 20) + '...' : '未命名知识点',
                            onClick: () => {
                                let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                                links.push({ sourcePage: pageNum, targetPointId: p.id, targetTitle: (p.content || '').slice(0, 10) + '...' });
                                localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                                toastSuccess(`已建立双向连接`);
                                mask.remove();
                            }
                        }));
                    });
                }
            }
        }

        await renderList();
        document.body.appendChild(mask);
    }

    // 从缩略图菜单直接「加入大纲」
    function openOutlineAddPanel(pageNum) {
        const title = prompt(`为第 ${pageNum} 页添加大纲标题：`);
        if (title === null) return;
        const outline = loadOutline();
        outline.push({ title: title || `第 ${pageNum} 页`, page: pageNum });
        saveOutline(outline);
        toastSuccess('已加入大纲');
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
                outline: (isMulti && selectedPages.has(num)) ? '4px solid var(--primary)' : (!isMulti && currentPage === num) ? '3px solid var(--primary)' : 'none',
                opacity: (isMulti && selectedPages.has(num)) ? '0.7' : '1',
                background: (isMulti && selectedPages.has(num)) ? 'rgba(142, 202, 230, 0.3)' : 'transparent',
                transition: 'all 0.2s'
            },
            id: `pdf-page-wrap-${num}`,
        });

        // 👇 核心融合：直接读取完整的预览图（无蓝框，带文字）
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        c.style.display = 'block'; c.style.width = '100%'; c.style.height = 'auto';

        let savedAnnotated = null;
        try {
            const { dbAll } = await import('../db.js');
            const allImages = await dbAll('images');
            const pageTag = `pdf_${pdfId}_page_${num}`;

            // 宽松匹配，新旧数据都能找到
            const matched = allImages.find(img =>
                img.source === pageTag ||
                img.name === pageTag ||
                (img.source && img.source.includes(pageTag)) ||
                (img.name && img.name.includes(pageTag))
            );

            if (matched && matched.annotatedBlob) {
                savedAnnotated = matched.annotatedBlob; // 👈 取完整的合成大图
            }
        } catch (e) { }

        if (savedAnnotated) {
            const url = URL.createObjectURL(savedAnnotated);
            const img = new Image();
            await new Promise(r => { img.onload = r; img.onerror = r; img.src = url; });
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
        } else {
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        }

        // 滤镜组合
        const filters = [];
        if (eyeMode) filters.push('sepia(0.4) contrast(0.9) brightness(0.95)');
        if (highContrastMode) filters.push('contrast(1.5) saturate(0.8)');
        if (sepiaMode) filters.push('sepia(0.7) contrast(1.1) brightness(0.95)');
        if (darkReaderMode) filters.push('invert(0.9) hue-rotate(180deg)');
        if (bigTextMode) {
            c.style.transform = 'scale(1.15)';
            c.style.transformOrigin = 'top left';
            c.style.marginBottom = '10px';
            wrap.style.overflow = 'auto';
            wrap.style.maxHeight = '80vh';
        }
        if (filters.length > 0) c.style.filter = filters.join(' ');

        if (dimMode) {
            wrap.appendChild(el('div', {
                style: { position: 'absolute', inset: '0', background: 'rgba(0, 0, 0, 0.45)', pointerEvents: 'none', zIndex: '1' }
            }));
        }

        wrap.appendChild(c);

        // ：渲染完当前页后，立刻检查有没有刚刚画完带回来的图
        const updatePdfImage = sessionStorage.getItem('update_pdf_image');
        const updatePdfId = sessionStorage.getItem('update_pdf_id');

        if (updatePdfImage && updatePdfId && updatePdfId === `pdf_${pdfId}_page_${num}`) {
            const newImg = new Image();
            newImg.onload = () => {
                // 强行把画过的图覆盖到当前 PDF 页面的 Canvas 上
                c.getContext('2d').clearRect(0, 0, c.width, c.height);
                c.getContext('2d').drawImage(newImg, 0, 0, c.width, c.height);
            };
            newImg.src = updatePdfImage;

            // 👇 必须在这里清空，且只清空一次（防止重新渲染丢失）
            sessionStorage.removeItem('update_pdf_image');
            sessionStorage.removeItem('update_pdf_id');
        }


        // 👇 核心改造：双击进入全功能画板
        wrap.style.cursor = 'pointer';
        wrap.title = '双击进入全功能标注';
        wrap.style.userSelect = 'none'; // 防止双击选中页面文字

        wrap.addEventListener('dblclick', async (e) => {
            if (e.target.closest('button')) return;
            toastSuccess('正在准备画板...');

            const canvas = document.createElement('canvas');
            canvas.width = c.width;
            canvas.height = c.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(c, 0, 0);

            // 👇 核心：使用固定的 ID 规则，与数据库里的 source 标签一致
            const targetImageId = `pdf_${pdfId}_page_${num}`;

            const base64Data = canvas.toDataURL('image/png');
            sessionStorage.setItem('temp_pdf_image', base64Data);
            sessionStorage.setItem('temp_pdf_id', targetImageId);

            const returnUrl = encodeURIComponent(window.location.hash);

            window.location.hash = `#/annotate/${targetImageId}?returnUrl=${returnUrl}&isPdf=true&pdfId=${pdfId}&page=${num}`;
        });

        // 👇 1. 双指缩放与拖拽逻辑
        wrap.style.touchAction = 'none'; // 禁用浏览器默认手势
        let scale = 1, startDist = 0, startScale = 1, panX = 0, panY = 0, startX = 0, startY = 0;
        let isPinching = false, isDragging = false;

        wrap.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                isPinching = true;
                startDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                startScale = scale;
            } else if (e.touches.length === 1 && scale > 1) {
                isDragging = true;
                startX = e.touches[0].clientX - panX;
                startY = e.touches[0].clientY - panY;
            }
        });

        wrap.addEventListener('touchmove', (e) => {
            if (isPinching && e.touches.length === 2) {
                e.preventDefault(); // 阻止页面滚动
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                scale = Math.max(1, Math.min(5, startScale * (dist / startDist)));
                c.style.transform = `scale(${scale}) translate(${panX / scale}px, ${panY / scale}px)`;
                c.style.cursor = 'grab';
            } else if (isDragging && e.touches.length === 1) {
                e.preventDefault();
                panX = e.touches[0].clientX - startX;
                panY = e.touches[0].clientY - startY;
                c.style.transform = `scale(${scale}) translate(${panX / scale}px, ${panY / scale}px)`;
            }
        });

        wrap.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) isPinching = false;
            if (e.touches.length === 0) {
                isDragging = false;
                // 缩放回原状时重置
                if (scale <= 1.05) {
                    scale = 1; panX = 0; panY = 0;
                    c.style.transform = 'scale(1)';
                }
            }
        });

        // 👇 2. 鼠标局部放大镜（电脑端按住 Alt 键并悬停）
        const magnifier = el('div', {
            style: { position: 'absolute', width: '150px', height: '150px', borderRadius: '50%', border: '3px solid var(--primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', display: 'none', pointerEvents: 'none', zIndex: '99', backgroundImage: `url(${c.toDataURL()})`, backgroundRepeat: 'no-repeat' }
        });
        wrap.appendChild(magnifier);

        wrap.addEventListener('mousemove', (e) => {
            if (!e.altKey) { magnifier.style.display = 'none'; return; }
            const rect = c.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            magnifier.style.display = 'block';
            magnifier.style.left = (x - 75) + 'px';
            magnifier.style.top = (y - 75) + 'px';

            // 放大倍数 2.5 倍
            const bgX = -(x * 2.5 - 75);
            const bgY = -(y * 2.5 - 75);
            magnifier.style.backgroundSize = `${rect.width * 2.5}px ${rect.height * 2.5}px`;
            magnifier.style.backgroundPosition = `${bgX}px ${bgY}px`;
        });
        wrap.addEventListener('mouseleave', () => { magnifier.style.display = 'none'; });

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

        // 👇 核心逻辑：如果是 OCR 模式，绑定拖拽画框；否则是普通点击
        if (isOcrMode || isScreenshotMode) {
            wrap.style.cursor = 'crosshair';
            let startX = 0, startY = 0, selectionBox = null;

            wrap.onpointerdown = (e) => {
                e.stopPropagation(); e.preventDefault();
                const rect = c.getBoundingClientRect();
                startX = e.clientX - rect.left;
                startY = e.clientY - rect.top;

                selectionBox = el('div', {
                    style: {
                        position: 'absolute',
                        left: startX + 'px',
                        top: startY + 'px',
                        width: '0',
                        height: '0',
                        border: '2px dashed var(--primary)',
                        background: 'rgba(142, 202, 230, 0.2)',
                        zIndex: '10',
                        pointerEvents: 'none'
                    }
                });
                wrap.appendChild(selectionBox);
            };

            wrap.onpointermove = (e) => {
                if (!selectionBox) return;
                const rect = c.getBoundingClientRect();
                const currentX = e.clientX - rect.left;
                const currentY = e.clientY - rect.top;

                selectionBox.style.left = Math.min(startX, currentX) + 'px';
                selectionBox.style.top = Math.min(startY, currentY) + 'px';
                selectionBox.style.width = Math.abs(currentX - startX) + 'px';
                selectionBox.style.height = Math.abs(currentY - startY) + 'px';
            };

            wrap.onpointerup = async (e) => {
                if (!selectionBox) return;
                const box = selectionBox; selectionBox = null; wrap.removeChild(box);

                const rect = c.getBoundingClientRect();
                const endX = e.clientX - rect.left; const endY = e.clientY - rect.top;
                const left = Math.min(startX, endX); const top = Math.min(startY, endY);
                const width = Math.abs(endX - startX); const height = Math.abs(endY - startY);

                if (width < 10 || height < 10) return;

                // 1. 裁剪画布
                const scaleX = c.width / rect.width; const scaleY = c.height / rect.height;
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = width * scaleX; tempCanvas.height = height * scaleY;
                tempCanvas.getContext('2d').drawImage(c, left * scaleX, top * scaleY, width * scaleX, height * scaleY, 0, 0, tempCanvas.width, tempCanvas.height);

                const blob = await new Promise(r => tempCanvas.toBlob(r, 'image/png'));

                // 👇 2. 根据模式调用不同功能
                if (isOcrMode) {
                    openOcrResultPanel(blob, pointId, store, window.dbPut, window.uuid, toastSuccess, toastError);
                } else if (isScreenshotMode) {
                    // 👇 截图模式：不再静默下载，而是弹出预览窗
                    isScreenshotMode = false; // 截完自动退出模式
                    if (globalScreenshotBtn) {
                        globalScreenshotBtn.style.background = '';
                        globalScreenshotBtn.style.color = '';
                    }
                    renderUI();
                    openScreenshotPreview(blob, num);
                }
            };
        } else {
            // 👇 非 OCR 模式下，恢复普通点击翻页/多选功能
            wrap.onclick = () => {
                if (isMulti) {
                    if (selectedPages.has(num)) selectedPages.delete(num);
                    else selectedPages.add(num);
                    renderUI(); // 多选模式下必须重新渲染
                } else {
                    currentPage = num;
                    localStorage.setItem(`kg_pdf_progress_${pdfId}`, currentPage);

                    // 👇 核心修复：用直接查找的方式，确保一定能找到那个输入框
                    const pageInput = document.querySelector('.pdf-topbar input[type="number"]') ||
                        document.getElementById('pdf-page-input') ||
                        document.querySelector('input[type="number"]');
                    if (pageInput) {
                        pageInput.value = currentPage;
                    }

                    // 👇 手动更新页面高亮，同时让顶部输入框获取焦点(可选)
                    document.querySelectorAll('[id^="pdf-page-wrap-"]').forEach(w => {
                        w.style.outline = 'none';
                    });
                    wrap.style.outline = '3px solid var(--primary)';
                }
            };
        }

        // 👇 核心：渲染已有的跳转连接（极简小图标版）
        try {
            const allLinks = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
            const pageLinks = allLinks.filter(l => l.sourcePage === num);

            pageLinks.forEach((link, idx) => {
                // 根据类型决定颜色和图标
                let icon = '🔗';
                let bgColor = 'var(--primary)';

                if (link.targetPdfId) { icon = '📂'; bgColor = '#118AB2'; }
                else if (link.targetPointId) { icon = '💡'; bgColor = '#FFD166'; }

                // 生成文字提示（悬浮显示）
                const tipText = link.targetPdfId
                    ? `跨文档：${link.targetTitle}`
                    : (link.targetPointId ? `知识点：${link.targetTitle}` : `跳转到第 ${link.targetPage} 页`);

                const btn = el('button', {
                    style: {
                        position: 'absolute',
                        top: (6 + idx * 32) + 'px',
                        right: '6px',
                        zIndex: '5',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%', // 圆形
                        background: bgColor,
                        color: '#fff',
                        border: '2px solid #fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(0,0,0,.25)',
                        fontSize: '14px',
                        transition: 'transform 0.2s'
                    },
                    text: icon,
                    title: tipText, // 鼠标悬停时显示完整文字
                    onClick: (e) => {
                        e.stopPropagation();
                        if (link.targetPdfId) {
                            const newUrl = window.location.href.split('#')[0] + `#/pdf-viewer/${link.targetPdfId}?pointId=${pointId}&page=${link.targetPage}`;
                            window.open(newUrl, '_blank');
                        } else if (link.targetPage) {
                            jumpToPage(link.targetPage);
                        }
                    },
                    // 右键删除便签
                    onContextmenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(`确定要删除这个连接吗？\n目标：${tipText}`)) {
                            let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                            links = links.filter(l => !(l.sourcePage === link.sourcePage && l.targetTitle === link.targetTitle));
                            localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                            toastSuccess('已删除连接');
                            renderUI();
                        }
                    }
                });

                // 悬停时微微放大效果
                btn.onmouseenter = () => { btn.style.transform = 'scale(1.15)'; };
                btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };

                wrap.appendChild(btn);
            });
        } catch { }

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
            await dbPut('images', {
                id: newImgId,
                originalBlob: blob,
                annotatedBlob: null, // 👈 核心修复1：初始不带笔迹，只存干净原图
                strokeBlob: null,    // 👈 确保初始笔迹为空
                width: canvas.width,
                height: canvas.height,
                dpr: window.devicePixelRatio || 1,
                source: pageTag,
                name: pageTag,
                createdAt: new Date().toISOString()
            });
            store.addImageToPoint(pointId, imageId);
            window.location.hash = `#/annotate/${imageId}?pointId=${pointId}`;
        } catch (err) { toastError('生成失败'); }
    }

    // ============ 插入新页功能 ============
    function openInsertPageModal() {
        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
        const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px', maxHeight: '90vh', overflowY: 'auto' } });
        mask.appendChild(box);

        box.appendChild(el('h3', { text: '➕ 插入新页面' }));

        let insertPos = currentPage;

        // 位置提示
        box.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', margin: '8px 0' }, text: `当前正在看第 ${currentPage} 页，共 ${total} 页` }));

        // 插入位置选择
        box.appendChild(el('div', { class: 'field' }, [
            el('label', { text: '插入位置' }),
            el('select', {
                style: { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' },
                onChange: (e) => { insertPos = parseInt(e.target.value); }
            }, [
                el('option', { value: currentPage, text: `当前页之后 (第 ${currentPage} 页后)` }),
                el('option', { value: currentPage - 1, text: `当前页之前 (第 ${currentPage} 页前)` }),
                el('option', { value: total, text: '追加到最后面' }),
                el('option', { value: 0, text: '插入到最前面' })
            ])
        ]));

        // ============ 动态参数设置区 ============
        const paramArea = el('div', { style: { display: 'none', background: 'var(--bg)', padding: '10px', borderRadius: '8px', marginTop: '10px' } });
        box.appendChild(paramArea);

        // 👇 辅助函数：生成标准的带数值和加减的滑块
        function buildRangeControl(id, min, max, defaultVal, label) {
            const inputNum = el('input', {
                type: 'number', min: String(min), max: String(max), value: String(defaultVal), id: id + '-num',
                style: { width: '52px', padding: '4px', fontSize: '13px', textAlign: 'center', borderRadius: '6px', border: '1px solid rgba(0,0,0,.1)' }
            });
            const inputRange = el('input', {
                type: 'range', min: String(min), max: String(max), value: String(defaultVal), id: id + '-range',
                style: { flex: '1', margin: '0 8px' },
                onInput: (e) => { inputNum.value = e.target.value; }
            });

            const btnMinus = el('button', {
                class: 'btn btn-sm btn-ghost', text: '−', style: { padding: '0 8px', minHeight: '26px' }, onClick: () => {
                    const v = Math.max(min, parseInt(inputNum.value) - 2);
                    inputNum.value = v; inputRange.value = v;
                }
            });
            const btnPlus = el('button', {
                class: 'btn btn-sm btn-ghost', text: '+', style: { padding: '0 8px', minHeight: '26px' }, onClick: () => {
                    const v = Math.min(max, parseInt(inputNum.value) + 2);
                    inputNum.value = v; inputRange.value = v;
                }
            });

            inputNum.oninput = (e) => {
                let v = parseInt(e.target.value);
                if (isNaN(v)) return;
                v = Math.max(min, Math.min(max, v));
                inputRange.value = v;
            };

            return el('div', { style: { display: 'flex', alignItems: 'center', marginTop: '8px' } }, [
                el('span', { style: { fontSize: '12px', minWidth: '60px', color: 'var(--text-2)' }, text: label }),
                btnMinus, inputRange, btnPlus, inputNum
            ]);
        }

        // 1. 横线纸参数
        const linedParams = el('div', { style: { display: 'none', flexDirection: 'column', gap: '8px' } }, [
            buildRangeControl('param-line-gap', 10, 60, 30, '📝 横线间距')
        ]);

        // 2. 方格纸参数
        const gridParams = el('div', { style: { display: 'none', flexDirection: 'column', gap: '8px' } }, [
            buildRangeControl('param-grid-size', 10, 60, 30, '🗒 方格大小')
        ]);

        paramArea.appendChild(linedParams);
        paramArea.appendChild(gridParams);

        // ============ 样式按钮区（支持折叠） ============
        const styleDetails = el('details', { style: { marginTop: '12px' }, open: true }, [
            el('summary', { style: { fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px', outline: 'none' }, text: '🎨 页面样式 (点击展开/收起)' }),
            el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
                el('button', { class: 'btn btn-sm btn-primary', text: '📄 A4 空白', onClick: () => doInsert('blank') }),
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '📝 动态横线纸', onClick: () => {
                        paramArea.style.display = 'block'; linedParams.style.display = 'flex'; gridParams.style.display = 'none';
                        const btn = document.getElementById('btn-confirm-param'); btn.style.display = 'block'; btn.textContent = '⏩ 生成横线纸'; btn.onclick = () => doInsert('lined', { gap: parseInt(document.getElementById('param-line-gap-num').value) || 30 });
                    }
                }),
                el('button', {
                    class: 'btn btn-sm btn-ghost', text: '🗒 动态方格纸', onClick: () => {
                        paramArea.style.display = 'block'; linedParams.style.display = 'none'; gridParams.style.display = 'flex';
                        const btn = document.getElementById('btn-confirm-param'); btn.style.display = 'block'; btn.textContent = '⏩ 生成方格纸'; btn.onclick = () => doInsert('grid', { size: parseInt(document.getElementById('param-grid-size').value) || 30 });
                    }
                }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '🎓 康奈尔笔记', onClick: () => doInsert('cornell') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '❌ 错题整理纸', onClick: () => doInsert('mistake') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '🔤 四线三格', onClick: () => doInsert('english') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '▤ 竖线备忘纸', onClick: () => doInsert('vertical') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '📝 申论答题卡', onClick: () => doInsert('answer_sheet') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '📋 会议纪要纸', onClick: () => doInsert('meeting') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '💼 待办清单', onClick: () => doInsert('todo') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '🗓 周计划表', onClick: () => doInsert('weekly') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '🖼 导入图片', onClick: () => doInsert('image') }),
                el('button', { class: 'btn btn-sm btn-ghost', text: '📄 导入 PDF', onClick: () => doInsert('pdf') }),
            ])
        ]);
        box.appendChild(styleDetails);

        // 展开参数区时，显示执行按钮
        box.querySelectorAll('button').forEach(btn => {
            if (btn.textContent.includes('横线纸') || btn.textContent.includes('方格纸')) {
                const oldClick = btn.onclick;
                btn.onclick = () => {
                    oldClick();
                    document.getElementById('btn-confirm-param').style.display = 'block';
                };
            }
        });

        // ============ 我的模板区（支持折叠） ============
        const templateWrap = el('details', { style: { marginTop: '16px', display: 'none' }, open: true });
        box.appendChild(templateWrap);

        // 👇 标题固定在外部，不随内部刷新而重置
        templateWrap.appendChild(el('summary', {
            style: { fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px', outline: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        }, [
            el('span', { text: '📁 我的自定义模板' }),
            el('span', { style: { fontSize: '11px', color: 'var(--primary)', fontWeight: 'normal' }, text: '点此展开/收起' })
        ]));

        const templateContent = el('div');
        templateWrap.appendChild(templateContent);

        let selectedTemplates = new Set();
        let isTemplateMulti = false;

        function renderTemplates() {
            templateContent.innerHTML = '';
            let templates = JSON.parse(localStorage.getItem('kg_pdf_templates') || '[]');
            if (templates.length === 0) return;

            templateWrap.style.display = 'block';

            // 操作栏
            const header = el('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '8px' } }, [
                el('div', { style: { display: 'flex', gap: '6px' } }, [
                    el('button', {
                        class: `btn btn-sm ${isTemplateMulti ? 'btn-danger' : 'btn-ghost'}`, text: isTemplateMulti ? '✕ 退出' : '☑ 管理', onClick: (e) => {
                            e.preventDefault();
                            isTemplateMulti = !isTemplateMulti; selectedTemplates.clear(); renderTemplates();
                        }
                    }),
                    isTemplateMulti ? el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: (e) => { e.preventDefault(); templates.forEach(t => selectedTemplates.add(t.id)); renderTemplates(); } }) : null,
                    isTemplateMulti ? el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: (e) => { e.preventDefault(); selectedTemplates.clear(); renderTemplates(); } }) : null,
                    isTemplateMulti && selectedTemplates.size > 0 ? el('button', {
                        class: 'btn btn-sm btn-danger', text: `🗑 删除(${selectedTemplates.size})`, onClick: (e) => {
                            e.preventDefault();
                            if (!confirm('确定删除选中的模板吗？')) return;
                            templates = templates.filter(t => !selectedTemplates.has(t.id));
                            localStorage.setItem('kg_pdf_templates', JSON.stringify(templates));
                            selectedTemplates.clear(); renderTemplates(); toastSuccess('已删除');
                        }
                    }) : null
                ])
            ]);
            templateContent.appendChild(header);

            const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' } });

            templates.forEach(tpl => {
                const isSelected = selectedTemplates.has(tpl.id);
                const thumb = el('div', {
                    style: { position: 'relative', paddingBottom: '130%', background: '#eee', borderRadius: '4px', overflow: 'hidden', cursor: 'pointer', border: isSelected ? '3px solid var(--primary)' : '1px solid rgba(0,0,0,.1)' },
                    onClick: () => {
                        if (isTemplateMulti) {
                            if (isSelected) selectedTemplates.delete(tpl.id);
                            else selectedTemplates.add(tpl.id);
                            renderTemplates();
                        } else {
                            mask.remove();
                            toastSuccess('正在应用模板...');
                        }
                    }
                }, [
                    el('img', { src: tpl.base64, style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' } }),
                    el('div', { style: { position: 'absolute', bottom: '0', left: '0', right: '0', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', textAlign: 'center' }, text: tpl.name }),
                    isTemplateMulti ? el('input', { type: 'checkbox', checked: isSelected, style: { position: 'absolute', top: '4px', left: '4px', width: '16px', height: '16px', zIndex: 10 }, readOnly: true }) : null
                ]);
                grid.appendChild(thumb);
            });
            templateContent.appendChild(grid);
        }
        renderTemplates();

        box.appendChild(el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
            el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
        ]));

        document.body.appendChild(mask);

        // ============ 核心写入逻辑 ============
        async function doInsert(type, params = {}) {
            mask.remove();

            let externalFile = null;
            if (type === 'image' || type === 'pdf') {
                externalFile = await new Promise((resolve) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = type === 'image' ? 'image/*' : 'application/pdf';
                    input.onchange = () => resolve(input.files[0]);
                    input.click();
                });
                if (!externalFile) return;
            }

            toastSuccess('正在生成新页面，请稍候...');
            try {
                const { PDFDocument, rgb } = window.PDFLib;
                const srcDoc = await PDFDocument.load(await pdfRecord.blob.arrayBuffer());
                const newDoc = await PDFDocument.create();

                // 1. 复制插入位置之前的所有页
                const pagesBefore = [];
                for (let i = 1; i <= insertPos; i++) pagesBefore.push(i - 1);
                if (pagesBefore.length > 0) {
                    const copied = await newDoc.copyPages(srcDoc, pagesBefore);
                    copied.forEach(p => newDoc.addPage(p));
                }

                // 2. 生成新插入的页面
                if (type === 'blank' || type === 'lined' || type === 'grid' || type === 'cornell' || type === 'mistake' || type === 'english' || type === 'vertical' || type === 'answer_sheet' || type === 'meeting' || type === 'todo' || type === 'weekly') {
                    const page = newDoc.addPage([595, 842]); // A4 纸张
                    const lineColor = rgb(0.85, 0.85, 0.85);

                    if (type === 'lined') {
                        const gap = params.gap || 30;
                        for (let y = 50; y < 800; y += gap) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                        }
                    }
                    else if (type === 'grid') {
                        const size = params.size || 30;
                        for (let x = 50; x < 545; x += size) {
                            page.drawLine({ start: { x, y: 50 }, end: { x, y: 800 }, thickness: 0.5, color: lineColor });
                        }
                        for (let y = 50; y < 800; y += size) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                        }
                    }
                    else if (type === 'cornell') {
                        for (let y = 50; y < 750; y += 30) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                        }
                        page.drawLine({ start: { x: 150, y: 750 }, end: { x: 150, y: 50 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
                        page.drawLine({ start: { x: 50, y: 150 }, end: { x: 545, y: 150 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
                    }
                    else if (type === 'mistake') {
                        for (let y = 450; y < 800; y += 30) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                        }
                        page.drawLine({ start: { x: 50, y: 420 }, end: { x: 545, y: 420 }, thickness: 1.5, color: rgb(0.6, 0.6, 0.6) });
                        for (let x = 50; x < 545; x += 25) {
                            page.drawLine({ start: { x, y: 50 }, end: { x, y: 400 }, thickness: 0.5, color: lineColor });
                        }
                        for (let y = 50; y < 400; y += 25) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                        }
                    }
                    else if (type === 'english') {
                        for (let y = 50; y < 800; y += 40) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                            page.drawLine({ start: { x: 50, y: y - 10 }, end: { x: 545, y: y - 10 }, thickness: 0.5, color: rgb(0.9, 0.7, 0.7) });
                            page.drawLine({ start: { x: 50, y: y - 20 }, end: { x: 545, y: y - 20 }, thickness: 0.5, color: rgb(0.9, 0.7, 0.7) });
                            page.drawLine({ start: { x: 50, y: y - 30 }, end: { x: 545, y: y - 30 }, thickness: 0.5, color: lineColor });
                        }
                    }
                    else if (type === 'vertical') {
                        for (let x = 50; x < 545; x += 80) {
                            page.drawLine({ start: { x, y: 50 }, end: { x, y: 800 }, thickness: 0.5, color: lineColor });
                        }
                        for (let y = 50; y < 800; y += 40) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.3, color: rgb(0.95, 0.95, 0.95) });
                        }
                    }
                    else if (type === 'answer_sheet') {
                        for (let y = 80; y < 800; y += 25) {
                            for (let x = 50; x < 545; x += 25) {
                                page.drawRectangle({ x, y, width: 25, height: 25, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
                            }
                        }
                        for (let y = 80; y < 800; y += 125) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
                        }
                    }
                    else if (type === 'meeting') {
                        page.drawText('Meeting Notes / 课堂笔记', { x: 50, y: 790, size: 16, color: rgb(0.4, 0.4, 0.4) });
                        page.drawLine({ start: { x: 50, y: 780 }, end: { x: 545, y: 780 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
                        page.drawText('日期 (Date):', { x: 50, y: 750, size: 10, color: rgb(0.5, 0.5, 0.5) });
                        page.drawLine({ start: { x: 110, y: 748 }, end: { x: 250, y: 748 }, thickness: 0.5, color: lineColor });
                        page.drawText('主题 (Topic):', { x: 300, y: 750, size: 10, color: rgb(0.5, 0.5, 0.5) });
                        page.drawLine({ start: { x: 360, y: 748 }, end: { x: 545, y: 748 }, thickness: 0.5, color: lineColor });
                        for (let y = 720; y < 800; y += 30) {
                            page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: lineColor });
                        }
                    }
                    else if (type === 'todo') {
                        page.drawText('TO-DO LIST / 任务清单', { x: 50, y: 790, size: 16, color: rgb(0.4, 0.4, 0.4) });
                        for (let y = 740; y > 50; y -= 30) {
                            page.drawRectangle({ x: 55, y: y - 8, width: 12, height: 12, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1 });
                            page.drawLine({ start: { x: 80, y: y - 3 }, end: { x: 545, y: y - 3 }, thickness: 0.5, color: lineColor });
                        }
                    }
                    else if (type === 'weekly') {
                        const days = ['一', '二', '三', '四', '五', '六', '日'];
                        const colWidth = 495 / 7;
                        page.drawText('WEEKLY PLAN / 周计划', { x: 50, y: 800, size: 14, color: rgb(0.4, 0.4, 0.4) });
                        for (let i = 0; i < 7; i++) {
                            const x = 50 + i * colWidth;
                            page.drawText(days[i], { x: x + colWidth / 2 - 5, y: 770, size: 12, color: rgb(0.5, 0.5, 0.5) });
                            page.drawRectangle({ x, y: 70, width: colWidth, height: 690, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
                        }
                    }
                }
                else if (type === 'image') {
                    const page = newDoc.addPage([595, 842]);
                    const bytes = await externalFile.arrayBuffer();
                    let img;
                    if (externalFile.type === 'image/png') img = await newDoc.embedPng(bytes);
                    else img = await newDoc.embedJpg(bytes);

                    const fillWidth = document.getElementById('insert-img-fill')?.checked;
                    if (fillWidth) {
                        const h = (img.height / img.width) * 495;
                        if (h > 742) {
                            const w = (img.width / img.height) * 742;
                            page.drawImage(img, { x: (595 - w) / 2, y: 50, width: w, height: 742 });
                        } else {
                            page.drawImage(img, { x: 50, y: 842 - h - 50, width: 495, height: h });
                        }
                    } else {
                        const { width, height } = img.scaleToFit(495, 742);
                        page.drawImage(img, { x: (595 - width) / 2, y: 421 - (height / 2), width, height });
                    }
                }
                else if (type === 'pdf') {
                    const extBytes = await externalFile.arrayBuffer();
                    const extDoc = await PDFDocument.load(extBytes);
                    const pdfjsDoc = await window.pdfjsLib.getDocument({ data: extBytes }).promise;

                    const selectedExtPages = await new Promise(async (resolve) => {
                        const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', maxHeight: '50vh', overflowY: 'auto', margin: '12px 0' } });
                        const selectedSet = new Set();

                        const toolBar = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, [
                            el('button', {
                                class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => {
                                    for (let i = 1; i <= pdfjsDoc.numPages; i++) selectedSet.add(i);
                                    grid.querySelectorAll('div').forEach(t => t.style.borderColor = 'var(--primary)');
                                }
                            }),
                            el('button', {
                                class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => {
                                    selectedSet.clear();
                                    grid.querySelectorAll('div').forEach(t => t.style.borderColor = 'transparent');
                                }
                            })
                        ]);

                        for (let i = 1; i <= pdfjsDoc.numPages; i++) {
                            const page = await pdfjsDoc.getPage(i);
                            const vp = page.getViewport({ scale: 0.3 });
                            const c = document.createElement('canvas');
                            c.width = vp.width; c.height = vp.height;
                            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

                            const thumb = el('div', {
                                style: { border: '2px solid transparent', borderRadius: '4px', overflow: 'hidden', cursor: 'pointer', position: 'relative', background: '#eee' },
                                onClick: () => {
                                    if (selectedSet.has(i)) { selectedSet.delete(i); thumb.style.borderColor = 'transparent'; }
                                    else { selectedSet.add(i); thumb.style.borderColor = 'var(--primary)'; }
                                }
                            }, [
                                el('img', { src: c.toDataURL(), style: { width: '100%', display: 'block' } }),
                                el('div', { style: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', textAlign: 'center' }, text: `第 ${i} 页` })
                            ]);
                            grid.appendChild(thumb);
                        }

                        const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } }, [
                            el('div', { class: 'confirm-box', style: { maxWidth: '600px' } }, [
                                el('h3', { text: '选择要插入的页面' }),
                                el('p', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '点击选择你想插入进来的具体页面' }),
                                toolBar,
                                grid,
                                el('div', { class: 'confirm-actions' }, [
                                    el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(null); } }),
                                    el('button', { class: 'btn btn-primary', text: '确认插入', onClick: () => { mask.remove(); resolve(selectedSet); } })
                                ])
                            ])
                        ]);
                        document.body.appendChild(mask);
                    });

                    if (!selectedExtPages || selectedExtPages.size === 0) return;
                    const pagesToCopy = Array.from(selectedExtPages).map(n => n - 1).sort((a, b) => a - b);
                    const copiedPages = await newDoc.copyPages(extDoc, pagesToCopy);
                    copiedPages.forEach(p => newDoc.addPage(p));
                }

                // 3. 复制插入位置之后的所有页
                const pagesAfter = [];
                for (let i = insertPos; i < total; i++) pagesAfter.push(i);
                if (pagesAfter.length > 0) {
                    const copied = await newDoc.copyPages(srcDoc, pagesAfter);
                    copied.forEach(p => newDoc.addPage(p));
                }

                // 4. 计算插入了多少页并智能顺延大纲/书签
                let insertedCount = 0;
                if (type === 'pdf') insertedCount = selectedExtPages ? selectedExtPages.size : 0;
                else insertedCount = 1;

                if (insertedCount > 0) {
                    let outlineData = JSON.parse(localStorage.getItem(`kg_pdf_outline_${pdfId}`) || '[]');
                    const shiftPages = (nodes) => {
                        nodes.forEach(n => {
                            if (n.page > insertPos) n.page += insertedCount;
                            if (n.children) shiftPages(n.children);
                        });
                    };
                    shiftPages(outlineData);
                    localStorage.setItem(`kg_pdf_outline_${pdfId}`, JSON.stringify(outlineData));

                    let bookmarks = JSON.parse(localStorage.getItem(`kg_pdf_bookmarks_${pdfId}`) || '[]');
                    bookmarks = bookmarks.map(b => {
                        const page = typeof b === 'number' ? b : b.page;
                        const note = typeof b === 'number' ? '' : b.note;
                        if (page > insertPos) return { page: page + insertedCount, note };
                        return { page, note };
                    });
                    localStorage.setItem(`kg_pdf_bookmarks_${pdfId}`, JSON.stringify(bookmarks));
                }

                // 5. 保存并刷新
                const bytes = await newDoc.save();
                const newBlob = new Blob([bytes], { type: 'application/pdf' });
                await dbPut('pdfs', { ...pdfRecord, blob: newBlob });

                toastSuccess('插入成功！即将刷新页面');

                const jumpTarget = insertPos + 1;
                setTimeout(async () => {
                    await initPdf(pdfId);
                    jumpToPage(jumpTarget);
                    setTimeout(() => {
                        // 自动生成一个默认大纲节点
                        let outlineData = JSON.parse(localStorage.getItem(`kg_pdf_outline_${pdfId}`) || '[]');
                        const newTitle = (type === 'blank' || type === 'lined' || type === 'grid') ? '📝 新增笔记本页' : (type === 'pdf' ? '📄 导入的 PDF 页' : '🖼 导入的图片页');

                        outlineData.push({ title: newTitle, page: jumpTarget, children: [], expanded: true });
                        outlineData.sort((a, b) => a.page - b.page); // 按页码排序
                        localStorage.setItem(`kg_pdf_outline_${pdfId}`, JSON.stringify(outlineData));

                        toastSuccess(`已自动加入大纲：${newTitle}`);
                    }, 600);
                }, 500);

            } catch (err) {
                console.error(err);
                toastError('插入失败: ' + err.message);
            }
        }
    }

    function renderRecentFilesInto(content) {
        content.appendChild(el('h3', { text: '📂 切换文档', style: { padding: '16px 16px 8px' } }));

        const list = el('div', { style: { padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' } });
        content.appendChild(list);

        list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '20px' }, text: '加载中…' }));

        dbAll('pdfs').then(all => {
            all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            list.innerHTML = '';

            // 从本地导入
            list.appendChild(el('button', {
                class: 'btn btn-primary', text: '📥 从本地导入新 PDF',
                style: { marginBottom: '8px' },
                onClick: () => {
                    window.__pdfCloseDrawer();
                    importNewPdf();
                },
            }));

            if (all.length === 0) {
                list.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '20px' }, text: '暂无文档' }));
                return;
            }

            all.slice(0, 15).forEach(p => {
                const isCurrent = p.id === pdfId;
                list.appendChild(el('div', {
                    style: {
                        padding: '10px 12px',
                        background: isCurrent ? 'rgba(142, 202, 230, 0.15)' : 'var(--bg)',
                        border: isCurrent ? '1px solid var(--primary)' : '1px solid transparent',
                        borderRadius: '8px', cursor: 'pointer',
                    },
                    onClick: () => {
                        window.__pdfCloseDrawer();
                        if (!isCurrent) {
                            window.location.hash = `#/pdf-viewer/${p.id}?pointId=${pointId}`;
                        }
                    },
                }, [
                    el('div', { style: { fontWeight: 'bold', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: p.name || '未命名' }),
                    el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '2px' }, text: new Date(p.createdAt).toLocaleString() + (isCurrent ? ' · 当前打开' : '') }),
                ]));
            });
        });
    }

    // 外部导入 PDF
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

// ============ 智能连接选择器 ============
async function openLinkSelector(pageNum, pdfId) {
    // 1. 获取系统里所有的知识点和当前 PDF 的信息
    let currentPdfPages = 0;

    // 获取当前 PDF 总页数 (从 DOM 中的悬浮球尝试获取，或者给个默认值)
    const pageFloat = document.getElementById('pdf-page-float');
    if (pageFloat) currentPdfPages = parseInt(pageFloat.textContent.split('/')[1]) || 100;

    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
    const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' } });
    mask.appendChild(box);

    box.appendChild(el('h3', { text: '🔗 创建双向连接' }));
    box.appendChild(el('p', { style: { fontSize: '12px', color: 'var(--text-2)', marginBottom: '12px' }, text: `为第 ${pageNum} 页关联到：` }));

    const tabRow = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } });
    const listWrap = el('div', { style: { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });

    box.appendChild(tabRow);
    box.appendChild(listWrap);

    let currentTab = 'pdf'; // 'pdf' | 'point'

    function renderTabs() {
        tabRow.innerHTML = '';
        tabRow.appendChild(el('button', {
            class: 'btn btn-sm ' + (currentTab === 'pdf' ? 'btn-primary' : 'btn-ghost'),
            text: '📄 本 PDF 页',
            onClick: () => { currentTab = 'pdf'; renderTabs(); renderList(); }
        }));
        tabRow.appendChild(el('button', {
            class: 'btn btn-sm ' + (currentTab === 'otherPdf' ? 'btn-primary' : 'btn-ghost'),
            text: '📂 其他文档', // 👈 新增的跨文档 Tab
            onClick: () => { currentTab = 'otherPdf'; renderTabs(); renderList(); }
        }));
        tabRow.appendChild(el('button', {
            class: 'btn btn-sm ' + (currentTab === 'point' ? 'btn-primary' : 'btn-ghost'),
            text: '💡 知识点',
            onClick: () => { currentTab = 'point'; renderTabs(); renderList(); }
        }));
    }

    async function renderList() {
        listWrap.innerHTML = '';

        if (currentTab === 'pdf') {
            // 1. 关联本 PDF 其他页
            for (let i = 1; i <= Math.min(50, currentPdfPages); i++) {
                if (i === pageNum) continue;
                listWrap.appendChild(el('button', {
                    class: 'btn btn-ghost',
                    style: { justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', border: '1px solid rgba(0,0,0,.05)' },
                    text: `跳转到第 ${i} 页`,
                    onClick: () => {
                        let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                        links.push({ sourcePage: pageNum, targetPage: i, targetTitle: `第 ${i} 页` });
                        localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                        toastSuccess(`已生成连接：当前页 ➡️ 第 ${i} 页`);
                        mask.remove();
                    }
                }));
            }
        }
        else if (currentTab === 'otherPdf') {
            // 👇 暴力读取 IndexedDB 的所有 PDF 数据
            const allPdfs = await new Promise((resolve) => {
                try {
                    const req = indexedDB.open('kaogong_db');
                    req.onsuccess = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('pdfs')) { resolve([]); return; }
                        const t = db.transaction('pdfs', 'readonly');
                        const storeReq = t.objectStore('pdfs').getAll();
                        storeReq.onsuccess = () => resolve(storeReq.result || []);
                        storeReq.onerror = () => resolve([]);
                    };
                    req.onerror = () => resolve([]);
                } catch { resolve([]); }
            });

            const otherPdfs = allPdfs.filter(p => p.id !== pdfId);

            // 1. 外部导入按钮
            listWrap.appendChild(el('button', {
                class: 'btn btn-sm btn-primary',
                text: '📁 从本地导入并关联外部 PDF',
                style: { margin: '8px 0', justifyContent: 'center' },
                onClick: () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'application/pdf';
                    input.onchange = async () => {
                        const file = input.files[0];
                        if (!file) return;
                        toastSuccess('正在读取文件...');

                        const newPdfId = uuid();
                        // 👇 强制使用底层的 dbPut
                        await new Promise((resolve, reject) => {
                            const req = indexedDB.open('kaogong_db');
                            req.onsuccess = (e) => {
                                const db = e.target.result;
                                const t = db.transaction('pdfs', 'readwrite');
                                const s = t.objectStore('pdfs');
                                s.put({ id: newPdfId, blob: file, name: file.name, createdAt: new Date().toISOString() });
                                t.oncomplete = resolve;
                                t.onerror = reject;
                            };
                        });

                        // 生成占位图记录，以便全局可见
                        const fakeImgId = uuid();
                        await new Promise((resolve) => {
                            const req = indexedDB.open('kaogong_db');
                            req.onsuccess = (e) => {
                                const db = e.target.result;
                                const t = db.transaction('images', 'readwrite');
                                t.objectStore('images').put({
                                    id: fakeImgId, type: 'pdf_placeholder',
                                    originalBlob: new Blob([], { type: 'text/plain' }),
                                    annotatedBlob: new Blob([], { type: 'text/plain' }),
                                    width: 0, height: 0, dpr: 1,
                                    pdfId: newPdfId, pdfName: file.name, pdfPages: '?',
                                    createdAt: new Date().toISOString()
                                });
                                t.oncomplete = resolve;
                            };
                        });

                        if (window.store && window.store.addImageToPoint) {
                            window.store.addImageToPoint(pointId, fakeImgId);
                        }

                        const targetP = prompt(`已成功导入「${file.name}」\n你想关联到该文档的第几页？`, '1');
                        if (!targetP) return;

                        let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                        links.push({
                            sourcePage: pageNum,
                            targetPdfId: newPdfId,
                            targetPdfName: file.name,
                            targetPage: parseInt(targetP),
                            targetTitle: `${file.name} (第${targetP}页)`
                        });
                        localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));

                        toastSuccess(`已生成外部连接！`);
                        mask.remove();
                    };
                    input.click();
                }
            }));

            // 2. 渲染现有 PDF 列表
            if (otherPdfs.length === 0) {
                listWrap.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '10px' }, text: '暂无其他已存文档' }));
            } else {
                otherPdfs.forEach(p => {
                    listWrap.appendChild(el('button', {
                        class: 'btn btn-ghost',
                        style: { justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', border: '1px solid rgba(0,0,0,.05)' },
                        text: `📄 ${p.name || '未命名文档'}`,
                        onClick: () => {
                            const targetP = prompt(`要跳转到「${p.name}」的第几页？`, '1');
                            if (!targetP) return;

                            let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                            links.push({
                                sourcePage: pageNum,
                                targetPdfId: p.id,
                                targetPdfName: p.name,
                                targetPage: parseInt(targetP),
                                targetTitle: `${p.name} (第${targetP}页)`
                            });
                            localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));

                            toastSuccess(`已生成跨文档连接`);
                            mask.remove();
                        }
                    }));
                });
            }
        }
        else if (currentTab === 'point') {
            // 3. 关联知识点
            if (allPoints.length === 0) {
                listWrap.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', textAlign: 'center', padding: '20px' }, text: '暂无知识点' }));
            } else {
                allPoints.slice(0, 30).forEach(p => {
                    listWrap.appendChild(el('button', {
                        class: 'btn btn-ghost',
                        style: { justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', border: '1px solid rgba(0,0,0,.05)' },
                        text: p.content ? p.content.slice(0, 20) + '...' : '未命名知识点',
                        onClick: () => {
                            let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                            links.push({ sourcePage: pageNum, targetPointId: p.id, targetTitle: (p.content || '').slice(0, 10) + '...' });
                            localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));

                            let pt = store.getPoint(p.id);
                            if (pt) {
                                if (!pt.linkedPdfs) pt.linkedPdfs = [];
                                pt.linkedPdfs.push({ pdfId: pdfId, pdfName: pdfRecord.name, page: pageNum });
                                store.updatePoint(pt.id, { linkedPdfs: pt.linkedPdfs });
                            }

                            toastSuccess(`已建立双向连接`);
                            mask.remove();
                        }
                    }));
                });
            }
        }
    }

    // 底部增加一个自定义备注框（可选）
    const customNoteInput = el('input', {
        type: 'text', placeholder: '或者手动输入一个链接备注…',
        style: { width: '100%', padding: '8px', marginTop: '12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.15)', fontSize: '13px' }
    });

    box.appendChild(customNoteInput);

    box.appendChild(el('div', { class: 'confirm-actions', style: { marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', {
            class: 'btn btn-primary', text: '✅ 生成内部跳转',
            onClick: () => {
                // 这里是刚才写好的内部跳转（略过，保持不变）
                if (customNoteInput.value.trim()) {
                    let links = JSON.parse(localStorage.getItem(`kg_pdf_links_${pdfId}`) || '[]');
                    links.push({ sourcePage: pageNum, targetTitle: customNoteInput.value.trim() });
                    localStorage.setItem(`kg_pdf_links_${pdfId}`, JSON.stringify(links));
                    toastSuccess(`已生成自定义连接：${customNoteInput.value}`);
                } else {
                    toastError('请选择一个目标或输入备注');
                    return;
                }
                mask.remove();
            }
        }),
        el('button', {
            class: 'btn btn-ghost', text: '📋 复制文本链接',
            onClick: async () => {
                // 👇 核心：生成可以到处粘贴的文本链接
                let title = customNoteInput.value.trim() || '查看详情';
                let target = '';

                // 如果用户选中了某一页
                if (currentTab === 'pdf') {
                    const targetPageStr = prompt('你要关联到第几页？', '1');
                    if (!targetPageStr) return;
                    target = `【跳转到 PDF: ${pdfRecord.name} 第${targetPageStr}页】\n链接：#/pdf-viewer/${pdfId}?pointId=${pointId}&page=${targetPageStr}`;
                } else {
                    target = `【关联知识点: ${title}】\n链接：#/search?q=${encodeURIComponent(title)}`;
                }

                try {
                    await navigator.clipboard.writeText(target);
                    toastSuccess('文本链接已复制，可粘贴到任何地方');
                    mask.remove();
                } catch (e) {
                    toastError('复制失败，请手动选中复制');
                }
            }
        }),
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
    ]));

    renderTabs();
    renderList();
    document.body.appendChild(mask);
}

// ============ 统一下载封装 ============
async function downloadFileWithPath(blob, filename, mimeType, extensions) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: '导出文件', accept: { [mimeType]: extensions } }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            toastSuccess('导出成功');
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    toastSuccess('已开始下载');
}

// ============ 图片文字识别 (OCR) ============
async function runOcrForPdf(imageBlob) {
    if (!window.Tesseract) {
        throw new Error('Tesseract 库未加载，请检查 index.html');
    }

    // 👇 核心修改：把进度直接显示在弹窗里
    const progressText = document.getElementById('ocr-text-result');

    try {
        const result = await window.Tesseract.recognize(
            imageBlob,
            'chi_sim+eng',
            {
                logger: m => {
                    console.log(m);
                    if (progressText && m.status === 'recognizing text') {
                        const percent = Math.round(m.progress * 100);
                        progressText.textContent = `🔍 正在识别文字... ${percent}%`;
                    } else if (progressText && m.status) {
                        // 显示下载语言包的进度
                        progressText.textContent = `⏳ 正在加载: ${m.status} (${Math.round((m.progress || 0) * 100)}%)`;
                    }
                }
            }
        );
        return result.data.text;
    } catch (err) {
        console.error('OCR识别崩溃:', err);
        throw new Error('识别引擎报错: ' + err.message);
    }
}

// ============ OCR 识别结果弹窗 ============
async function openOcrResultPanel(imageBlob, pointId, store, dbPut, uuid, toastSuccess, toastError) {
    // 1. 创建带加载动画的弹窗
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999 } });
    const resultBox = el('div', {
        style: { fontSize: '14px', padding: '16px', background: 'var(--bg)', borderRadius: '8px', minHeight: '120px', whiteSpace: 'pre-wrap', margin: '12px 0', overflowY: 'auto', maxHeight: '40vh' },
        text: '🔍 正在识别文字，首次识别可能需要下载语言包，请耐心等待…'
    });

    const box = el('div', { class: 'confirm-box', style: { maxWidth: '420px', display: 'flex', flexDirection: 'column' } }, [
        el('h3', { text: '🔤 文字提取结果' }),
        resultBox,
        el('div', { class: 'confirm-actions', style: { flexWrap: 'wrap' } }, [
            el('button', {
                class: 'btn btn-ghost', text: '📋 复制文字',
                onClick: async () => {
                    const text = resultBox.textContent;
                    if (!text || text.includes('正在识别')) return;
                    try {
                        await navigator.clipboard.writeText(text);
                        toastSuccess('已复制到剪贴板');
                        mask.remove();
                    } catch { toastError('复制失败'); }
                }
            }),
            el('button', {
                class: 'btn btn-primary', text: '📥 存为新知识点',
                onClick: async () => {
                    const text = resultBox.textContent;
                    if (!text || text.includes('正在识别')) { toastError('请等待识别完成'); return; }

                    const imgId = uuid();
                    await dbPut('images', {
                        id: imgId,
                        originalBlob: imageBlob,
                        annotatedBlob: imageBlob,
                        width: 0, height: 0, dpr: 1,
                        createdAt: new Date().toISOString()
                    });

                    const pt = store.getPoint(pointId);
                    if (pt) {
                        store.createPoint({
                            chapterId: pt.chapterId,
                            content: text,
                            imageIds: [imgId]
                        });
                        toastSuccess('已保存为新知识点');
                        mask.remove();
                    } else {
                        toastError('无法定位章节');
                    }
                }
            }),
            el('button', { class: 'btn btn-ghost', text: '关闭', onClick: () => mask.remove() }),
        ])
    ]);

    mask.appendChild(box);
    document.body.appendChild(mask);

    // 2. 调用底层识别函数
    try {
        const text = await runOcrForPdf(imageBlob);
        resultBox.textContent = text.trim() || '（未识别到文字，请重试）';
    } catch (err) {
        resultBox.textContent = '❌ 识别失败：' + err.message;
        console.error(err);
    }
}

// ============ 截图预览与操作弹窗 ============
async function openScreenshotPreview(blob, pageNum) {
    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 99999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    const box = el('div', { style: { maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--card)', borderRadius: '12px', overflow: 'hidden' } });
    mask.appendChild(box);

    const url = URL.createObjectURL(blob);

    // 1. 顶部标题
    box.appendChild(el('div', { style: { padding: '12px 16px', background: 'var(--bg)', fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid rgba(0,0,0,.05)' }, text: `✂️ 截图预览 (第 ${pageNum} 页)` }));

    // 2. 图片预览区
    const imgWrap = el('div', { style: { flex: '1', overflow: 'auto', padding: '16px', display: 'flex', justifyContent: 'center' } }, [
        el('img', { src: url, style: { maxWidth: '100%', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' } })
    ]);
    box.appendChild(imgWrap);

    // 3. 底部操作按钮
    const actionRow = el('div', { style: { padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid rgba(0,0,0,.05)' } }, [
        el('button', {
            class: 'btn btn-ghost', text: '📋 复制图片',
            onClick: async () => {
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    toastSuccess('图片已复制到剪贴板');
                } catch (e) { toastError('复制失败，请长按图片或另存为'); }
            }
        }),
        el('button', {
            class: 'btn btn-ghost', text: '💾 另存为',
            onClick: async () => {
                await downloadWithPicker(blob, `截图_第${pageNum}页_${Date.now()}.png`, 'image/png', ['.png']);
            }
        }),
        el('button', {
            class: 'btn btn-primary', text: '📥 存为新知识点',
            onClick: () => {
                // 调用我们即将写的新函数，直接打开编辑页面
                saveScreenshotToPoint(blob);
                mask.remove();
                URL.revokeObjectURL(url);
            }
        }),
        el('button', { class: 'btn btn-primary', text: '关闭', onClick: () => { mask.remove(); URL.revokeObjectURL(url); } })
    ]);
    box.appendChild(actionRow);

    mask.addEventListener('click', (e) => {
        if (e.target === mask) { mask.remove(); URL.revokeObjectURL(url); }
    });

    document.body.appendChild(mask);
}

// ============ 将截图存为知识点 ============
async function saveScreenshotToPoint(blob) {
    try {
        const { dbPut } = await import('../db.js');
        const { uuid } = await import('../utils/id.js');
        const store = await import('../store.js');

        // 1. 先把图片存入 IndexedDB
        const imgId = uuid();
        // 读取图片真实尺寸
        const imgObj = new Image();
        imgObj.src = URL.createObjectURL(blob);
        await new Promise(r => { imgObj.onload = r; });

        await dbPut('images', {
            id: imgId,
            originalBlob: blob,
            annotatedBlob: blob,
            width: imgObj.width,
            height: imgObj.height,
            dpr: 1,
            createdAt: new Date().toISOString()
        });
        URL.revokeObjectURL(imgObj.src);

        // 2. 查找最近查看过的章节
        const recentChapterId = localStorage.getItem('kg_last_chapter_id');

        // 3. 跳转到新建知识点页面，并带上图片 ID
        // 如果系统记住了最近的章节，就自动填入 chapterId，否则让用户自己选
        const queryStr = recentChapterId ? `?chapterId=${recentChapterId}&imageId=${imgId}` : `?imageId=${imgId}`;
        window.location.hash = `#/edit-point/new${queryStr}`;

        toastSuccess('截图已准备好，请填写知识点内容');
    } catch (err) {
        console.error(err);
        toastError('创建知识点失败');
    }
}