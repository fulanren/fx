


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
    // —— 修复：原逻辑只遍历「任务→章节→知识点」，会漏掉直接挂在任务下、
    //    没有章节的知识点（你的卡片正是这种情况，导致列表为空）。
    //    改为直接读全量知识点，再用 taskId / chapterId 反查归属。——
    const tasks = store.getTasks();
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const chapterMap = new Map();
    tasks.forEach(t => { (store.getChapters(t.id) || []).forEach(c => chapterMap.set(c.id, c)); });
    const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');

    // 任务即文件夹：用 kg_tasks 的 parentId 向上拼出「任务名路径」作为文件夹层级（如 1/2）
    function buildTaskPathMap(taskList) {
        const byId = new Map(taskList.map(t => [t.id, t]));
        function pathOf(t, guard) {
            guard = guard || new Set();
            if (!t || guard.has(t.id)) return '';
            guard.add(t.id);
            const name = t.name || '';
            if (t.parentId && byId.has(t.parentId)) {
                const p = pathOf(byId.get(t.parentId), guard);
                return p ? (p + '/' + name) : name;
            }
            return name;
        }
        const m = new Map();
        taskList.forEach(t => m.set(t.id, pathOf(t)));
        return m;
    }
    const taskPathMap = buildTaskPathMap(tasks);

    let lostCount = 0;

    function pickName(obj, fallback) {
        if (!obj) return fallback;
        return obj.name || obj.pdfName || obj.filename || obj.title || fallback;
    }

    allPoints.forEach(point => {
        const task = taskMap.get(point.taskId);
        const chapter = chapterMap.get(point.chapterId);
        const taskName = task ? (task.name || task.id) : '未归属任务';
        const chapterName = chapter ? (chapter.name || '') : '';
        // 维度A：卡片所属文件夹 = 该卡片 taskId 对应任务的名路径（用 parentId 拼出，如 1/2）
        const pointFolder = taskPathMap.get(point.taskId) || '';
        const _startIdx = allFiles.length;

        [...(point.imageIds || []), ...(point.compositeImageIds || [])].forEach(id => {
            if (imgMap.has(id)) {
                const rec = imgMap.get(id);
                if (rec.type === 'pdf_placeholder') {
                    allFiles.push({ type: 'pdf', id: rec.pdfId || id, rec: pdfMap.get(rec.pdfId) || { id: rec.pdfId || id, name: pickName(rec, rec.pdfId || id), blob: null }, taskName, chapterName, pointContent: point.content, pointId: point.id });
                } else {
                    allFiles.push({ type: 'img', id, rec, taskName, chapterName, pointContent: point.content, pointId: point.id });
                }
            } else {
                const isPdfPh = typeof id === 'string' && id.indexOf('pdf_') === 0;
                if (isPdfPh) {
                    allFiles.push({ type: 'pdf', id, rec: { id, name: id, pdfName: id, blob: null, lost: true }, taskName, chapterName, pointContent: point.content, pointId: point.id });
                } else {
                    allFiles.push({ type: 'img', id, rec: { id, name: '图片_' + String(id).slice(0, 6), blob: null, lost: true }, taskName, chapterName, pointContent: point.content, pointId: point.id });
                }
                lostCount++;
            }
        });

        (point.pdfFiles || []).forEach(pdf => {
            if (pdfMap.has(pdf.id)) {
                allFiles.push({ type: 'pdf', id: pdf.id, rec: pdfMap.get(pdf.id), taskName, chapterName, pointContent: point.content, pointId: point.id });
            } else {
                allFiles.push({ type: 'pdf', id: pdf.id, rec: { id: pdf.id, name: pickName(pdf, 'PDF_' + String(pdf.id).slice(0, 6)), pdfName: pickName(pdf, 'PDF'), blob: null, lost: true }, taskName, chapterName, pointContent: point.content, pointId: point.id });
                lostCount++;
            }
        });
        // 维度B：卡片内文件夹 = 图片/PDF 自身的 group（批量移动写入，目前多未赋值）
        // 同时记录 taskId 与卡片路径，供右侧标签点击跳转 / 筛选
        for (let i = _startIdx; i < allFiles.length; i++) {
            allFiles[i].pointFolder = pointFolder;
            allFiles[i].taskId = point.taskId;
            allFiles[i].fileGroup = (allFiles[i].rec && allFiles[i].rec.group) || '';
        }
    });

    view.innerHTML = '';

    if (allFiles.length === 0) {
        view.appendChild(el('div', { class: 'empty', text: '系统里还没有上传过任何图片或 PDF 附件。' }));
        return;
    }

    // 若存在仅留关联记录（内容丢失）的附件，顶部给出醒目提示
    if (lostCount > 0) {
        view.appendChild(el('div', { style: { padding: '6px 11px', background: '#FFF4E5', color: '#B26A00', fontSize: '8px', lineHeight: '1', borderBottom: '1px solid rgba(0,0,0,.06)' }, text: '⚠️ 共有 ' + lostCount + ' 个附件仅保留了关联记录（图片/PDF 的实际内容不在数据库中），下面列出的是它们的名称与归属，点击或预览将无法打开。' }));
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

    // ===== 文件夹过滤：可切换「按文件所属文件夹 / 按卡片所属文件夹」两个维度 =====
    // groupDim: 'file' = 图片/PDF 自身所属文件夹; 'point' = 卡片(知识点)所属文件夹
    let groupDim = 'point';   // 'point'=按所属卡片的文件夹；'file'=按卡片内(图片/PDF)的文件夹
    let currentGroupFilter = 'all';
    let folderById = new Map();       // taskId -> 树节点
    let folderIdByPath = new Map();  // 任务名路径 -> 首个匹配 taskId（仅供维度B兜底）

    function groupOf(f) {
        return (groupDim === 'point' ? f.pointFolder : f.fileGroup) || '';
    }
    // 判断资源在当前维度下的文件夹路径是否落在「选中文件夹节点」及其所有子文件夹内。
    // 下拉 value 用「任务名路径」(如 11/22)，资源记录 pointFolder / fileGroup 同为名路径，
    // 父带子 = 等于选中路径，或以 选中路径 + '/' 开头。
    function inFolder(g, sel) {
        return !!g && (g === sel || g.startsWith(sel + '/'));
    }

    const groupSelect = el('select', {
        style: { padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(0,0,0,.1)', fontSize: '13px', outline: 'none', background: 'var(--bg)', maxWidth: '200px' },
        onChange: (e) => { currentGroupFilter = e.target.value; renderContent(); }
    });
    function refreshGroupSelect() {
        // 直接用 kg_tasks + parentId 建完整文件夹树，跟侧边栏一样：
        // 凡是任务(文件夹)都出现在下拉里，哪怕它下面暂时没有附件；靠 depth 缩进 + 任务名展示层级。
        const tree = buildTaskFolderTree();
        clear(groupSelect);
        groupSelect.appendChild(el('option', { value: 'all', text: groupDim === 'point' ? '📁 全部卡片文件夹' : '📁 全部文件文件夹' }));
        groupSelect.appendChild(el('option', { value: 'none', text: groupDim === 'point' ? '🗂 无任务归属' : '🗂 未分组文件' }));
        folderById = new Map();
        folderIdByPath = new Map();
        tree.forEach(n => {
            folderById.set(n.id, n);
            if (!folderIdByPath.has(n.namePath)) folderIdByPath.set(n.namePath, n.id);
            const indent = '\u00A0'.repeat(n.depth * 2);
            const icon = n.hasChildren ? '📂' : '📄';
            groupSelect.appendChild(el('option', { value: n.id, text: indent + icon + ' ' + n.name }));
        });
        groupSelect.value = currentGroupFilter;
    }
    const dimToggle = el('button', {
        class: 'btn btn-sm btn-ghost', text: '🃏 按卡片文件夹', title: '点击切换：按所属卡片的文件夹 ⇄ 按卡片内文件(图片/PDF)的文件夹',
        onClick: () => {
            groupDim = groupDim === 'point' ? 'file' : 'point';
            dimToggle.textContent = groupDim === 'point' ? '🃏 按卡片文件夹' : '📁 按文件文件夹';
            currentGroupFilter = 'all';
            refreshGroupSelect();
            renderContent();
        }
    });
    refreshGroupSelect();
    topBar.appendChild(dimToggle);
    topBar.appendChild(groupSelect);
    const exportBtns = el('div', { style: { display: 'flex', gap: '4px' } }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '⬇ JSON', title: '导出当前总览为 JSON', onClick: exportJSON }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '⬇ CSV', title: '导出当前总览为 CSV', onClick: exportCSV })
    ]);
    topBar.appendChild(exportBtns);

    const multiBtn = el('button', {
        class: 'btn btn-sm btn-ghost', text: '☑ 多选', onClick: () => {
            isMulti = !isMulti;
            selectedIds.clear();
            multiBtn.className = `btn btn-sm ${isMulti ? 'btn-danger' : 'btn-ghost'}`;
            multiBtn.textContent = isMulti ? '✕ 退出' : '☑ 多选';
            renderContent();

            //点击多选时，动态显示或隐藏“全选”按钮
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

    function buildOverviewData() {
        return {
            生成时间: new Date().toLocaleString('zh-CN'),
            统计: { 附件总数: allFiles.length, 图片数: allFiles.filter(f => f.type === 'img').length, PDF数: allFiles.filter(f => f.type === 'pdf').length, 内容丢失数: lostCount },
            附件: allFiles.map(f => ({ 类型: f.type === 'pdf' ? 'PDF' : '图片', 名称: f.rec.name || f.rec.pdfName || '未命名', 内容状态: f.rec.lost ? '已丢失(仅关联)' : '正常', 所属卡片文件夹: f.pointFolder || '（未分组）', 卡片内文件夹: f.fileGroup || '（未分组）', 所属卡片: f.pointContent || '（空卡片）', 任务: f.taskName, 章节: f.chapterName || '（无章节）' }))
        };
    }
    function downloadText(filename, content, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }
    // 支持「选择保存路径」：优先弹系统另存为对话框，浏览器不支持时回退普通下载
    async function saveAs(filename, content, blobMime, acceptMime, exts, description) {
        const blob = new Blob([content], { type: blobMime });
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: description, accept: { [acceptMime]: exts } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                toastSuccess('已保存到所选位置');
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }
        downloadText(filename, content, blobMime);
        toastSuccess('已导出（当前浏览器不支持选路径，已用默认下载）');
    }
    async function exportJSON() {
        await saveAs('资源总览_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(buildOverviewData(), null, 2), 'application/json;charset=utf-8', 'application/json', ['.json'], 'JSON 文件');
    }
    async function exportCSV() {
        const rows = [['类型', '名称', '内容状态', '所属卡片文件夹', '卡片内文件夹', '所属卡片', '任务', '章节']];
        allFiles.forEach(f => rows.push([f.type === 'pdf' ? 'PDF' : '图片', f.rec.name || f.rec.pdfName || '未命名', f.rec.lost ? '已丢失(仅关联)' : '正常', f.pointFolder || '（未分组）', f.fileGroup || '（未分组）', String(f.pointContent || '').replace(/\s+/g, ' '), f.taskName || '', f.chapterName || '（无章节）']));
        const csv = '\uFEFF' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
        await saveAs('资源总览_' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8', 'text/csv', ['.csv'], 'CSV 文件');
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
        // 文件夹过滤（按选中节点及其所有子文件夹）—— 维度A用 taskId 精确匹配，规避重名冲突
        if (currentGroupFilter === 'none') {
            filtered = filtered.filter(f => !groupOf(f));
        } else if (currentGroupFilter !== 'all') {
            let node = folderById.get(currentGroupFilter);
            if (!node) {
                const nid = folderIdByPath.get(currentGroupFilter);
                if (nid) node = folderById.get(nid);
            }
            if (node) {
                if (groupDim === 'point') {
                    const ids = collectTaskIdsWithDescendants(node.id);
                    filtered = filtered.filter(f => ids.has(f.taskId));
                } else {
                    filtered = filtered.filter(f => inFolder(f.fileGroup, node.namePath));
                }
            }
        }

        if (filtered.length === 0) {
            contentWrap.appendChild(el('div', { class: 'empty', style: { padding: '40px', color: 'var(--text-2)', textAlign: 'center' }, text: '没有找到匹配的文件' }));
            updateBatchBar();
            return;
        }

        //加上这行标签过滤
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
        // 分组口径与侧边栏 / 文件夹下拉完全一致：按 kg_tasks 的「任务名路径」(pointFolder) 归类。
        // 不再使用章节(chapterName)那套数据 —— 章节与任务文件夹是两套 id 空间，
        // 这正是之前「侧边栏是文件夹树、这里却显示章节」对不上的根因。
        const groups = {};
        const order = [];
        data.forEach(f => {
            const key = f.pointFolder || '__none__';
            if (!groups[key]) { groups[key] = { path: f.pointFolder || '未归属', items: [] }; order.push(key); }
            groups[key].items.push(f);
        });

        // 按名路径排序，使分组顺序与下拉 / 侧边栏对齐（同层数字感知比较）
        const sorted = order.map(k => groups[k]).sort((a, b) =>
            String(a.path).localeCompare(String(b.path), 'zh-CN', { numeric: true }));

        sorted.forEach(group => {
            const section = el('div', { class: 'card', style: { marginBottom: '16px', padding: '16px' } });
            section.appendChild(el('h3', { style: { color: 'var(--primary-dark)', marginBottom: '12px', fontSize: '15px' }, text: '📁 ' + group.path }));

            const grid = el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } });
            group.items.forEach(item => grid.appendChild(createFileCard(item)));
            section.appendChild(grid);
            contentWrap.appendChild(section);
        });
    }

    // 跳到该资源所属卡片的「真实文件夹页」：路由 #/folder/{taskId}（任务即文件夹）
    function goToPointFolder(item) {
        if (!item.taskId) { toastError('该资源没有关联到具体文件夹/任务'); return; }
        navigate('#/folder/' + item.taskId);
    }
    // 按文件夹筛选（dim: 'point' 卡片文件夹 / 'file' 卡片内文件文件夹）
    function filterByGroup(target, dim) {
        if (dim) groupDim = dim;
        if (dimToggle) dimToggle.textContent = groupDim === 'point' ? '🃏 按卡片文件夹' : '📁 按文件文件夹';
        let id = 'all';
        if (groupDim === 'point') {
            id = folderById.has(target) ? target : 'all';
        } else {
            if (!target) id = 'none';
            else id = folderIdByPath.get(target) || 'none';
        }
        currentGroupFilter = id;
        refreshGroupSelect();
        renderContent();
        const shown = (id !== 'all' && folderById.get(id)) ? folderById.get(id).name : (target || '未分组');
        toastSuccess('已按' + (groupDim === 'point' ? '所属卡片' : '卡片内文件') + '文件夹筛选：' + shown);
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

            //判断类型，分别获取缩略图
            const thumbBox = el('div', { style: { width: '20px', height: '25px', borderRadius: '4px', overflow: 'hidden', background: '#eee', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,.08)' } });

            if (item.type === 'pdf') {
                thumbBox.style.background = '#FFF0F0';

                // 如果有存过封面，直接显示
                if (item.rec.coverUrl) {
                    thumbBox.appendChild(el('img', { src: item.rec.coverUrl, style: { width: '100%', height: '100%', objectFit: 'cover' } }));
                } else {
                    // 没有封面，先显示图标
                    thumbBox.appendChild(el('span', { style: { fontSize: '12px' }, text: '📄' }));

                    //在后台悄悄生成第一页的缩略图
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
                    thumbBox.appendChild(el('span', { style: { fontSize: '12px' }, text: '🖼' }));
                }
            }

            row.appendChild(thumbBox);

            //修复文件名显示，PDF 用 pdfName，图片用 name
            const displayName = item.type === 'pdf' ? (item.rec.name || '未命名 PDF') : (item.rec.name || '未命名图片');

            row.appendChild(el('span', { style: { flex: '1', fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: displayName }));
            // —— 右侧归属区：所属卡片（点击跳转）+ 所属文件夹（点击筛选） ——
            row.appendChild(el('span', {
                title: '所属卡片：' + (item.pointContent || '(空卡片)') + '\n点击打开该卡片所在的真实文件夹页',
                style: { fontSize: '11px', padding: '2px 6px', background: '#EAF1FF', borderRadius: '4px', color: 'var(--primary-dark)', whiteSpace: 'nowrap', cursor: 'pointer', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', border: '1px solid rgba(37,99,235,.15)', flexShrink: '0' },
                text: '🃏 ' + (item.pointContent || '卡片').toString().slice(0, 10),
                onClick: (e) => { e.stopPropagation(); goToPointFolder(item); }
            }));
            if (item.fileGroup) {
                row.appendChild(el('span', {
                    title: '卡片内文件夹（图片/PDF 自身分组）：' + item.fileGroup + '\n点击按【卡片内文件】筛选',
                    style: { fontSize: '11px', padding: '2px 6px', background: 'var(--bg)', borderRadius: '4px', color: 'var(--primary-dark)', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: '0' },
                    text: `🗂 ${item.fileGroup}`,
                    onClick: (e) => { e.stopPropagation(); filterByGroup(item.fileGroup, 'file'); }
                }));
            }
            {
                // 列表模式：所属卡片文件夹标签始终显示，无归属时灰字标「未归属」，点击可筛到未归属分组
                const fp = item.pointFolder || '';
                row.appendChild(el('span', {
                    title: '所属卡片文件夹（按任务层级）：' + (fp || '未归属') + '\n点击按【所属卡片文件夹】筛选',
                    style: { fontSize: '11px', padding: '2px 6px', background: fp ? '#F1E8FF' : '#f0f0f0', borderRadius: '4px', color: fp ? '#6B3FB0' : '#888', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: '0' },
                    text: '📁 ' + (fp || '未归属'),
                    onClick: (ev) => {
                        ev.stopPropagation();
                        if (fp && folderById.has(item.taskId)) filterByGroup(item.taskId, 'point');
                        else { currentGroupFilter = 'none'; refreshGroupSelect(); renderContent(); }
                    }
                }));
            }

            list.appendChild(row);
        });
        contentWrap.appendChild(list);
    }

    function createFileCard(item) {
        const card = el('div', {
            style: { position: 'relative', width: '40px', height: '50px', background: '#eee', borderRadius: '6px', overflow: 'hidden', cursor: 'pointer', border: selectedIds.has(item.id) ? '2px solid var(--primary)' : '1px solid rgba(0,0,0,.05)' },
            onClick: () => handleItemClick(item)
        });

        // 右上角详情小按钮
        const infoBtn = el('button', {
            style: { position: 'absolute', top: '1px', right: '1px', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%', width: '11px', height: '11px', fontSize: '7px', lineHeight: '11px', zIndex: '5', cursor: 'pointer', padding: '0' },
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
                el('span', { style: { fontSize: '16px' }, text: '📄' }),
                el('span', { style: { fontSize: '7px', color: '#EF476F', textAlign: 'center', wordBreak: 'break-all', maxHeight: '15px', overflow: 'hidden', lineHeight: '1.1' }, text: item.rec.name })
            ]));
        } else {
            // 图片懒加载占位
            const lazyBox = el('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#ccc' }, text: '🖼' });
            card.appendChild(lazyBox);
            lazyLoadImage(lazyBox, item.rec);
        }

        if (item.rec.lost) {
            card.appendChild(el('div', { title: '内容已丢失（仅保留关联记录）', style: { position: 'absolute', bottom: '0', left: '0', right: '0', fontSize: '6px', color: '#B26A00', background: 'rgba(255,244,229,.92)', textAlign: 'center', padding: '0', lineHeight: '1.1' }, text: '⚠' }));
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
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '所属卡片文件夹' }), el('span', { text: item.pointFolder || '（未分组）', style: { fontWeight: '600' } })]),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', { style: { color: 'var(--text-2)' }, text: '卡片内文件夹' }), el('span', { text: item.fileGroup || '（未分组）' })]),
                    el('div', { style: { display: item.rec.lost ? 'flex' : 'none', justifyContent: 'center', background: '#FFF4E5', padding: '6px 8px', borderRadius: '6px' } }, [el('span', { style: { color: '#B26A00', fontSize: '12px' }, text: '⚠ 该附件内容已丢失（仅保留关联记录，无法预览）' })]),
                    //加上标签输入框
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

/* ========== 用 kg_tasks + parentId 建树（与侧边栏一致） ========== */
function buildTaskFolderTree() {
    let tasks = [];
    try { tasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]'); } catch (e) { tasks = []; }

    // 1. 建索引
    const map = new Map();
    tasks.forEach(t => map.set(t.id, { ...t, children: [] }));

    // 2. 挂父子；parentId 为空或找不到父 → 视为根
    const roots = [];
    map.forEach(node => {
        const pid = node.parentId;
        if (pid && map.has(pid)) map.get(pid).children.push(node);
        else roots.push(node);
    });

    // 3. 按 order 排序（有则排，无则按名字）
    const sortRec = list => {
        list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
        list.forEach(n => sortRec(n.children));
    };
    sortRec(roots);

    // 3.5 给每个节点算「任务名路径」(如 11/22)，与资源记录 pointFolder / fileGroup 口径一致
    const namePath = new Map();
    const calcPath = (node, parentPath) => {
        const p = parentPath ? (parentPath + '/' + (node.name || '')) : String(node.name || '');
        namePath.set(node.id, p);
        node.children.forEach(c => calcPath(c, p));
    };
    roots.forEach(r => calcPath(r, ''));

    // 4. 深度优先摊平成 [{id, name, namePath, depth, hasChildren}]
    const flat = [];
    const walk = (list, depth) => list.forEach(n => {
        flat.push({ id: n.id, name: n.name, namePath: namePath.get(n.id), depth, hasChildren: n.children.length > 0 });
        walk(n.children, depth + 1);
    });
    walk(roots, 0);
    // 5. 按「名路径」排序，保证父在前、子紧随，与侧边栏顺序一致（同层按名字数字感知比较）
    flat.sort((a, b) => {
        const pa = String(a.namePath).split('/'), pb = String(b.namePath).split('/');
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            if (pa[i] === undefined) return -1;
            if (pb[i] === undefined) return 1;
            const c = String(pa[i]).localeCompare(String(pb[i]), 'zh-CN', { numeric: true });
            if (c !== 0) return c;
        }
        return 0;
    });
    return flat;
}

/* 取某文件夹节点及其所有后代的 taskId 集合 */
function collectTaskIdsWithDescendants(taskId) {
    let tasks = [];
    try { tasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]'); } catch (e) { tasks = []; }
    const ids = new Set([taskId]);
    let changed = true;
    while (changed) {                 // 迭代向下收集，避免递归
        changed = false;
        tasks.forEach(t => {
            if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) { ids.add(t.id); changed = true; }
        });
    }
    return ids;
}