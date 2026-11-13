import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { dbPut } from '../db.js';

// 选择导入方式
export function globalImportDocModal() {
    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
            el('h3', { text: '📄 文档导入' }),
            el('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '请选择导入模式：' }),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
                el('button', {
                    class: 'btn btn-primary', text: '📑 智能解析大纲（自动生成结构）',
                    onClick: () => {
                        mask.remove();
                        uploadFile(true);
                    }
                }),
                el('div', { style: { fontSize: '12px', color: 'var(--text-2)', lineHeight: '1.5' }, text: '文档格式要求：\n用 # 号代表任务，## 号代表章节，其余纯文本行代表知识点。' }),

                el('button', {
                    class: 'btn btn-ghost', text: '📄 全部作为纯知识点（导入现有章节）',
                    onClick: () => {
                        mask.remove();
                        chooseTargetChapter(false, (chapterId) => uploadFile(false, chapterId));
                    }
                }),
            ]),
            el('div', { class: 'confirm-actions', style: { marginTop: '16px' } }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
            ])
        ])
    ]);
    document.body.appendChild(mask);
}

// 解析并生成大纲
async function parseOutlineToDB(text, images = []) {
    let currentTask = null;
    let currentChapter = null;
    let countT = 0, countC = 0, countP = 0;
    let imageIndex = 0;

    const lines = text.split('\n');
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith('# ')) {
            const name = line.replace(/^# /, '').trim();
            currentTask = store.createTask({ name });
            countT++;
            currentChapter = null;
        }
        else if (line.startsWith('## ')) {
            const name = line.replace(/^## /, '').trim();
            if (!currentTask) {
                currentTask = store.createTask({ name: '默认导入任务' });
                countT++;
            }
            currentChapter = store.createChapter({ taskId: currentTask.id, name });
            countC++;
        }
        else {
            if (!currentTask) {
                currentTask = store.createTask({ name: '默认导入任务' });
                countT++;
            }
            if (!currentChapter) {
                currentChapter = store.createChapter({ taskId: currentTask.id, name: '默认导入章节' });
                countC++;
            }

            const content = line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '');
            const point = store.createPoint({ chapterId: currentChapter.id, content });
            countP++;

            // 绑定图片
            if (images.length > imageIndex) {
                const imgBlob = images[imageIndex];
                const imgId = crypto.randomUUID();
                const imgObj = new Image();
                imgObj.src = URL.createObjectURL(imgBlob);
                await new Promise(r => { imgObj.onload = r; imgObj.onerror = r; });

                await dbPut('images', {
                    id: imgId,
                    originalBlob: imgBlob,
                    annotatedBlob: imgBlob,
                    width: imgObj.width || 800,
                    height: imgObj.height || 600,
                    dpr: window.devicePixelRatio || 1,
                    source: 'upload',
                    createdAt: new Date().toISOString(),
                });

                if (!point.imageIds) point.imageIds = [];
                point.imageIds.push(imgId);
                store.updatePoint(point.id, { imageIds: point.imageIds });
                imageIndex++;
            }
        }
    }
    return { countT, countC, countP };
}

// 读取文件
function uploadFile(isOutline, targetChapterId = null) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,.md,.docx';
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            if (file.name.endsWith('.docx')) {
                if (!window.mammoth) { toastError('Word解析库未加载，请刷新页面'); return; }
                toastSuccess('正在解析 Word 文档（图文精准匹配）…');
                const arrayBuffer = await file.arrayBuffer();

                // 👇 核心修改：把 Word 里的图片转成 Base64 的同时，保留在 HTML 结构中
                const result = await window.mammoth.convertToHtml({ arrayBuffer }, {
                    convertImage: window.mammoth.images.imgElement(function (image) {
                        return image.read("base64").then(function (imageBuffer) {
                            // 带上更精确的 MIME 类型
                            return { src: "data:" + image.contentType + ";base64," + imageBuffer };
                        });
                    })
                });

                const html = result.value;

                // 👇 核心逻辑：按段落 (<p> 或 <h1> 或 <h2>) 切分，确保图片和它所在的段落在一起
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                let currentTask = null;
                let currentChapter = null;
                let countT = 0, countC = 0, countP = 0, countImg = 0;

                // 遍历每一个段落节点
                const nodes = Array.from(doc.body.children);

                for (const node of nodes) {
                    const tag = node.tagName.toLowerCase();
                    const text = node.textContent.trim();
                    // 获取该段落里的所有图片（如果有的话）
                    const imgs = Array.from(node.querySelectorAll('img'));

                    // 如果是标题，创建任务或章节
                    if (isOutline && (tag === 'h1' || tag === 'h2')) {
                        if (tag === 'h1') {
                            currentTask = store.createTask({ name: text || '默认导入任务' });
                            countT++;
                            currentChapter = null;
                        } else if (tag === 'h2') {
                            if (!currentTask) { currentTask = store.createTask({ name: '默认导入任务' }); countT++; }
                            currentChapter = store.createChapter({ taskId: currentTask.id, name: text || '默认导入章节' });
                            countC++;
                        }
                        continue;
                    }

                    // 如果是正文段落，或者虽然没文字但有图片
                    if (text || imgs.length > 0) {
                        if (!currentTask) { currentTask = store.createTask({ name: '默认导入任务' }); countT++; }
                        if (!currentChapter) { currentChapter = store.createChapter({ taskId: currentTask.id, name: '默认导入章节' }); countC++; }

                        // 处理段落内的图片
                        const imageIds = [];
                        for (const img of imgs) {
                            const src = img.getAttribute('src');
                            if (!src || !src.startsWith('data:image')) continue;

                            // 从 Base64 转回 Blob
                            const base64Data = src.split(',')[1];
                            const mimeMatch = src.match(/data:([^;]+);/);
                            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                            const byteCharacters = atob(base64Data);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }
                            const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });

                            // 存入数据库
                            const imgId = crypto.randomUUID();
                            const imgObj = new Image();
                            imgObj.src = src;
                            await new Promise(r => { imgObj.onload = r; imgObj.onerror = r; });

                            await dbPut('images', {
                                id: imgId,
                                originalBlob: blob,
                                annotatedBlob: blob,
                                width: imgObj.width || 800,
                                height: imgObj.height || 600,
                                dpr: window.devicePixelRatio || 1,
                                source: 'upload',
                                createdAt: new Date().toISOString(),
                            });
                            imageIds.push(imgId);
                            countImg++;
                        }

                        // 创建知识点，并直接绑定刚才解析出的图片
                        const point = store.createPoint({
                            chapterId: currentChapter.id,
                            content: text || `【图片附件】`
                        });
                        countP++;

                        if (imageIds.length > 0) {
                            store.updatePoint(point.id, { imageIds });
                        }
                    }
                }

                toastSuccess(`成功导入 ${countT} 任务，${countC} 章节，${countP} 知识点，${countImg} 张图片精准绑定！`);
                setTimeout(() => location.reload(), 1000);
            } else {
                const text = await file.text();
                if (isOutline) {
                    const res = await parseOutlineToDB(text);
                    toastSuccess(`成功导入 ${res.countT} 个任务，${res.countC} 个章节，${res.countP} 个知识点`);
                    location.reload();
                } else {
                    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                    if (lines.length === 0) { toastError('文档为空'); return; }
                    lines.forEach(content => store.createPoint({ chapterId: targetChapterId, content }));
                    toastSuccess(`成功导入 ${lines.length} 个知识点`);
                }
            }
        } catch (err) {
            console.error(err);
            toastError('读取失败：' + err.message);
        }
    };
    fileInput.click();
}

// 选章节弹窗
function chooseTargetChapter(taskOnly, callback) {
    const tasks = store.getTasks();
    if (tasks.length === 0) { toastError('还没有任何任务，请先创建任务'); return; }

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '400px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' } }, [
            el('h3', { text: '选择导入到的章节' }),
            el('div', { style: { maxHeight: '50vh', overflowY: 'auto', margin: '8px 0' } },
                tasks.map(t => el('div', { style: { marginBottom: '10px' } }, [
                    el('div', { style: { fontWeight: '600', fontSize: '14px', color: 'var(--primary-dark)', marginBottom: '4px', padding: '4px 8px', background: 'rgba(142,202,230,.1)', borderRadius: '4px' }, text: t.name }),
                    (store.getChapters(t.id).length === 0
                        ? [el('div', { style: { fontSize: '12px', color: 'var(--text-2)', padding: '4px 12px' }, text: '（无章节）' })]
                        : store.getChapters(t.id).map(c => el('div', {
                            style: { padding: '8px 12px', background: 'var(--bg)', borderRadius: '6px', cursor: 'pointer', marginBottom: '4px', fontSize: '13px', marginLeft: '8px' },
                            text: `📄 ${c.name}`,
                            onClick: () => { mask.remove(); callback(c.id); }
                        }))
                    )
                ]))
            ),
            el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })
            ])
        ])
    ]);
    document.body.appendChild(mask);
}