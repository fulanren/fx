import * as store from '../store.js';
import { dbGet } from '../db.js';
import { fmtDate } from '../utils/date.js';
import { toastSuccess, toastError } from '../ui/toast.js';

/**
 * 导出为 Anki 兼容的 .txt
 * 格式：正面<TAB>背面<TAB>标签
 * 正面：知识点内容
 * 背面：解释 + 图片（HTML）
 * 标签：章节名、难度
 */
export async function exportToAnki(scope, id) {
    let points = [];
    let tagPrefix = '';

    if (scope === 'chapter') {
        const ch = store.getChapter(id);
        if (!ch) throw new Error('章节不存在');
        points = store.getPoints(id);
        tagPrefix = ch.name;
    } else if (scope === 'task') {
        const task = store.getTask(id);
        if (!task) throw new Error('任务不存在');
        const chapters = store.getChapters(id);
        chapters.forEach(c => {
            store.getPoints(c.id).forEach(p => {
                points.push({ ...p, _chapterName: c.name });
            });
        });
        tagPrefix = task.name;
    } else if (scope === 'point') {
        const p = store.getPoint(id);
        if (!p) throw new Error('知识点不存在');
        points = [p];
        const ch = store.getChapter(p.chapterId);
        tagPrefix = ch ? ch.name : '';
    }

    if (points.length === 0) throw new Error('没有可导出的知识点');

    const lines = [];
    // Anki 导入需要表头
    lines.push('#separator:tab');
    lines.push('#html:true');
    lines.push('#columns:正面\t背面\t标签');

    for (const p of points) {
        const front = escapeHtml(p.content || '');
        let back = '';
        if (p.explanation) back += `<div>${escapeHtml(p.explanation)}</div>`;
        // 图片：Anki 导入时用 <img src="..."> 引用，图片需要单独放到 Anki 的媒体文件夹
        // 这里只导出图片文件名，用户手动导入图片
        if (p.imageIds && p.imageIds.length > 0) {
            back += `<div style="font-size:12px;color:#888">[含 ${p.imageIds.length} 张图片，需手动导入]</div>`;
        }
        const tags = [
            tagPrefix,
            p._chapterName || '',
            `难度${p.difficulty || 5}`,
            p.isErrorProne ? '易错' : '',
        ].filter(Boolean).join(' ');

        lines.push(`${front}\t${back}\t${tags}`);
    }

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anki_${scope}_${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastSuccess(`已导出 ${points.length} 个知识点为 Anki 格式`);
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}