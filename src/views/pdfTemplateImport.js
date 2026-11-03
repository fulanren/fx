import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

/**
 * 按模板格式导入 PDF / DOCX / TXT
 * 模板格式：
 * ## 章节：章节名
 * ### 知识点：内容
 * 解释：解释内容
 */
export function templateImportModal(taskId) {
    return new Promise(resolve => {
        const fileInput = el('input', {
            type: 'file',
            accept: '.pdf,.docx,.txt',
            style: { display: 'none' },
            onChange: async (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(false); return; }
                try {
                    const text = await extractText(file);
                    if (!text.trim()) { toastError('文件里没有可提取的文字'); resolve(false); return; }
                    parseAndPreview(text, taskId, resolve);
                } catch (err) {
                    toastError('解析失败：' + err.message);
                    resolve(false);
                }
            },
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 60000);
    });
}

async function extractText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'docx') {
        if (!window.mammoth) throw new Error('mammoth.js 未加载');
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        return result.value || '';
    }
    if (ext === 'txt') return await file.text();
    if (ext === 'pdf') {
        if (!window.pdfjsLib) throw new Error('PDF.js 未加载');
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join('') + '\n';
        }
        return fullText;
    }
    throw new Error('不支持的文件类型：' + ext);
}

function parseAndPreview(text, taskId, resolve) {
    // 按「## 章节：」拆分
    const chapterParts = text.split(/##\s*章节[：:]\s*/).filter(Boolean);
    if (chapterParts.length === 0) { toastError('没有找到「## 章节：」格式的内容'); resolve(false); return; }

    const chapters = [];
    chapterParts.forEach(part => {
        const lines = part.split('\n');
        const chapterName = lines[0].trim();
        if (!chapterName) return;
        const rest = lines.slice(1).join('\n');

        // 按「### 知识点：」拆分
        const pointParts = rest.split(/###\s*知识点[：:]\s*/).filter(Boolean);
        const points = [];
        pointParts.forEach(pp => {
            const plines = pp.split('\n');
            const content = plines[0].trim();
            if (!content) return;
            let explanation = '';
            const expMatch = pp.match(/解释[：:]\s*([\s\S]*?)(?=###|$)/);
            if (expMatch) explanation = expMatch[1].trim();
            points.push({ content, explanation });
        });

        chapters.push({ name: chapterName, points });
    });

    showPreview(chapters, taskId, resolve);
}

function showPreview(chapters, taskId, resolve) {
    const list = el('div', { style: { maxHeight: '400px', overflowY: 'auto', margin: '12px 0' } });
    chapters.forEach((ch, i) => {
        list.appendChild(el('div', { style: { marginBottom: '12px' } }, [
            el('div', { style: { fontWeight: '600', fontSize: '15px', marginBottom: '4px' }, text: `📖 ${ch.name}` }),
            ...ch.points.map((p, j) => el('div', { style: { fontSize: '13px', padding: '4px 8px', background: 'var(--bg)', borderRadius: '6px', marginBottom: '2px' } }, [
                el('div', { style: { fontWeight: '600' }, text: `${j + 1}. ${p.content.slice(0, 50)}${p.content.length > 50 ? '…' : ''}` }),
                p.explanation ? el('div', { style: { color: 'var(--text-2)', fontSize: '12px', marginTop: '2px' }, text: p.explanation.slice(0, 60) + (p.explanation.length > 60 ? '…' : '') }) : null,
            ])),
        ]));
    });

    const totalPoints = chapters.reduce((n, ch) => n + ch.points.length, 0);

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '700px', maxHeight: '90vh', overflow: 'auto' } }, [
            el('h3', { text: '模板导入预览' }),
            el('p', { text: `识别到 ${chapters.length} 个章节，${totalPoints} 个知识点`, style: { fontSize: '13px', color: 'var(--text-2)' } }),
            list,
            el('div', { class: 'confirm-actions' }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => { mask.remove(); resolve(false); } }),
                el('button', {
                    class: 'btn btn-primary', text: '确认导入',
                    onClick: async () => {
                        if (!await confirmBox({ title: '确认导入', message: `将创建 ${chapters.length} 个章节，${totalPoints} 个知识点`, confirmText: '导入' })) return;
                        mask.remove();
                        for (const ch of chapters) {
                            const newCh = store.createChapter({ taskId, name: ch.name });
                            for (const p of ch.points) {
                                store.createPoint({ chapterId: newCh.id, content: p.content, explanation: p.explanation });
                            }
                        }
                        toastSuccess(`已导入 ${chapters.length} 个章节，${totalPoints} 个知识点`);
                        navigate(`#/chapter-list/${taskId}`);
                        resolve(true);
                    },
                }),
            ]),
        ]),
    ]);
    document.body.appendChild(mask);
}