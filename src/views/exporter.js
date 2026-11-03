import * as store from '../store.js';
import { getImageCached } from '../db.js';
import { fmtDate } from '../utils/date.js';
import { jsPDF } from 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js';

// ============ 收集数据 ============
async function collectData(scope, id) {
  if (scope === 'point') {
    const p = store.getPoint(id);
    if (!p) return null;
    const ch = store.getChapter(p.chapterId);
    const task = ch ? store.getTask(ch.taskId) : null;
    return { task, chapter: ch, points: [p] };
  }
  if (scope === 'chapter') {
    const ch = store.getChapter(id);
    if (!ch) return null;
    const task = store.getTask(ch.taskId);
    return { task, chapter: ch, points: store.getPoints(ch.id) };
  }
  if (scope === 'task') {
    const task = store.getTask(id);
    if (!task) return null;
    const chapters = store.getChapters(task.id);
    const allPoints = [];
    chapters.forEach(c => {
      const pts = store.getPoints(c.id);
      pts.forEach(p => allPoints.push({ ...p, _chapterName: c.name }));
    });
    return { task, chapters, points: allPoints };
  }
  return null;
}

// ============ 收集图片 ============
async function collectImages(points) {
  const images = [];
  for (const p of points) {
    const ids = [...(p.imageIds || []), ...(p.compositeImageIds || [])];
    for (const id of ids) {
      const img = await getImageCached(id);
      if (!img) continue;
      const blob = img.annotatedBlob || img.originalBlob;
      if (!blob) continue;
      images.push({ pointId: p.id, imageId: id, blob, type: img.type || 'image' });
    }
  }
  return images;
}

// ============ Markdown ============
function toMarkdown(data, images) {
  const lines = [];
  if (data.task) {
    lines.push(`# 任务：${data.task.name}`);
    if (data.task.note) lines.push(`> ${data.task.note}`);
    lines.push('');
  }
  const chapters = data.chapters || (data.chapter ? [data.chapter] : []);
  const pointsByChapter = {};
  data.points.forEach(p => {
    const cid = p.chapterId;
    if (!pointsByChapter[cid]) pointsByChapter[cid] = [];
    pointsByChapter[cid].push(p);
  });

  chapters.forEach(ch => {
    lines.push(`## 章节：${ch.name}`);
    if (ch.book) lines.push(`- 书籍：${ch.book}`);
    if (ch.part) lines.push(`- 页码：${ch.part}`);
    if (ch.note) lines.push(`- 备注：${ch.note}`);
    lines.push('');

    const pts = pointsByChapter[ch.id] || [];
    pts.forEach((p, i) => {
      lines.push(`### 知识点 ${i + 1}`);
      lines.push(`**内容**：${p.content}`);
      if (p.explanation) lines.push(`\n**解释**：${p.explanation}`);
      const pImgs = images.filter(im => im.pointId === p.id);
      if (pImgs.length) {
        lines.push(`\n**图片**：`);
        pImgs.forEach((im, j) => {
          lines.push(`![fig${j + 1}](images/${im.imageId}.png)`);
        });
      }
      lines.push(`\n**复习状态**：已背 ${p.reviewCount} 遍 · 难记度 ${p.difficulty} · 下次 ${fmtDate(p.nextReviewAt)}`);
      if (p.reviewHistory && p.reviewHistory.length) {
        lines.push(`\n**背诵历史**：`);
        lines.push(`| 日期 | 自评 | 间隔变化 |`);
        lines.push(`|---|---|---|`);
        p.reviewHistory.slice(-10).forEach(r => {
          lines.push(`| ${fmtDate(r.at)} | ${r.rating} | ${r.prevInterval}→${r.nextInterval} 天 |`);
        });
      }
      lines.push('\n---\n');
    });
  });
  return lines.join('\n');
}

// ============ HTML ============
function toHtml(data, images) {
  const md = toMarkdown(data, images);
  const html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/!\[(.+?)\]\((.+?)\)/g, '<img alt="$1" src="$2" style="max-width:100%;border-radius:8px;margin:8px 0">')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>导出</title>
<style>
body{font-family:-apple-system,"PingFang SC",sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.7;color:#2B2D42}
h1{color:#5FA8C7;border-bottom:2px solid #8ECAE6;padding-bottom:8px}
h2{color:#2B2D42;margin-top:24px}
h3{color:#5FA8C7}
blockquote{border-left:4px solid #8ECAE6;margin:8px 0;padding:4px 12px;color:#666;background:#f9f9f9}
table{border-collapse:collapse;margin:8px 0;font-size:13px}
th,td{border:1px solid #ddd;padding:4px 8px;text-align:left}
img{max-width:100%;border-radius:8px;margin:8px 0}
hr{border:none;border-top:1px dashed #ddd;margin:16px 0}
@media print{body{padding:0}}
</style></head><body>${html}</body></html>`;
}

// ============ 纯文本 ============
export function toPlainText(data) {
  const lines = [];
  if (data.task) {
    lines.push(`任务：${data.task.name}`);
    if (data.task.note) lines.push(`备注：${data.task.note}`);
    lines.push('');
  }
  const chapters = data.chapters || (data.chapter ? [data.chapter] : []);
  const pointsByChapter = {};
  data.points.forEach(p => {
    if (!pointsByChapter[p.chapterId]) pointsByChapter[p.chapterId] = [];
    pointsByChapter[p.chapterId].push(p);
  });

  chapters.forEach(ch => {
    lines.push(`【章节】${ch.name}`);
    if (ch.book) lines.push(`书籍：${ch.book}`);
    if (ch.part) lines.push(`页码：${ch.part}`);
    lines.push('');
    const pts = pointsByChapter[ch.id] || [];
    pts.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.content}`);
      if (p.explanation) lines.push(`   解释：${p.explanation}`);
      const imgCount = (p.imageIds || []).length + (p.compositeImageIds || []).length;
      if (imgCount > 0) lines.push(`   [含 ${imgCount} 张图片]`);
      lines.push(`   已背 ${p.reviewCount} 遍 · 难记度 ${p.difficulty} · 下次 ${fmtDate(p.nextReviewAt)}`);
      lines.push('');
    });
    lines.push('------------------------');
    lines.push('');
  });
  return lines.join('\n');
}

// ============ PDF（新标签页 + 打印） ============
export async function exportAsPdf(scope, id, options = {}) {
  const data = await collectData(scope, id);
  if (!data) throw new Error('数据不存在');

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;
  const margin = 20;
  const maxW = 170;

  function addText(text, size = 11, bold = false) {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, maxW);
    lines.forEach(line => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += size * 0.5 + 2;
    });
  }

  if (data.task) addText(data.task.name, 16, true);
  const chapters = data.chapters || (data.chapter ? [data.chapter] : []);
  chapters.forEach(ch => {
    addText(ch.name, 14, true);
    data.points.filter(p => p.chapterId === ch.id).forEach((p, i) => {
      addText(`${i + 1}. ${p.content}`, 12, true);
      if (p.explanation) addText(p.explanation, 10);
      y += 2;
    });
  });

  doc.save(`export_${scope}_${Date.now()}.pdf`);
}

async function buildPrintHtml(data, images, options) {
  const includeImages = options.includeImages !== false;
  const chapters = data.chapters || (data.chapter ? [data.chapter] : []);
  const pointsByChapter = {};
  data.points.forEach(p => {
    if (!pointsByChapter[p.chapterId]) pointsByChapter[p.chapterId] = [];
    pointsByChapter[p.chapterId].push(p);
  });

  const imgMap = {};
  if (includeImages) {
    for (const im of images) {
      imgMap[im.imageId] = await blobToBase64(im.blob);
    }
  }

  let bodyHtml = '';
  if (data.task) {
    bodyHtml += `<h1>${esc(data.task.name)}</h1>`;
    if (data.task.note) bodyHtml += `<p class="note">${esc(data.task.note)}</p>`;
  }

  chapters.forEach(ch => {
    bodyHtml += `<h2>${esc(ch.name)}</h2>`;
    if (ch.book || ch.part) bodyHtml += `<p class="meta">${esc(ch.book || '')} ${esc(ch.part || '')}</p>`;
    const pts = pointsByChapter[ch.id] || [];
    pts.forEach((p, i) => {
      bodyHtml += `<div class="point">`;
      bodyHtml += `<h3>${i + 1}. ${esc(p.content)}</h3>`;
      if (p.explanation) bodyHtml += `<p class="explain">${esc(p.explanation)}</p>`;
      const ids = [...(p.imageIds || []), ...(p.compositeImageIds || [])];
      if (includeImages && ids.length) {
        bodyHtml += `<div class="imgs">`;
        ids.forEach(id2 => { if (imgMap[id2]) bodyHtml += `<img src="${imgMap[id2]}">`; });
        bodyHtml += `</div>`;
      }
      bodyHtml += `<p class="status">已背 ${p.reviewCount} 遍 · 难记度 ${p.difficulty} · 下次 ${fmtDate(p.nextReviewAt)}</p>`;
      bodyHtml += `</div>`;
    });
  });

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>复习单</title>
<style>
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.7; color: #2B2D42; }
h1 { font-size: 22px; color: #5FA8C7; border-bottom: 2px solid #8ECAE6; padding-bottom: 6px; }
h2 { font-size: 18px; margin-top: 20px; border-left: 4px solid #8ECAE6; padding-left: 8px; }
h3 { font-size: 15px; margin: 12px 0 4px; }
.note { color: #666; font-size: 13px; }
.meta { color: #888; font-size: 12px; margin: 2px 0 8px; }
.point { margin-bottom: 16px; page-break-inside: avoid; }
.explain { font-size: 14px; color: #444; background: #f9f9f9; padding: 8px 12px; border-radius: 6px; margin: 6px 0; }
.status { font-size: 12px; color: #999; margin-top: 4px; }
.imgs { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.imgs img { max-width: 100%; max-height: 300px; border-radius: 6px; border: 1px solid #eee; }
@media print { .point { page-break-inside: avoid; } }
</style></head><body>${bodyHtml}</body></html>`;
}

// ============ 导出入口 ============
export async function exportContent(scope, id, options = {}) {
  const { includeImages = true, format = 'zip' } = options;
  const data = await collectData(scope, id);
  if (!data) throw new Error('数据不存在');
  const images = includeImages ? await collectImages(data.points) : [];

  if (format === 'txt') {
    const txt = toPlainText(data);
    downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `export_${scope}_${Date.now()}.txt`);
    return;
  }

  if (format === 'pdf') {
    await exportAsPdf(scope, id, { includeImages });
    return;
  }

  const md = toMarkdown(data, images);
  const html = toHtml(data, images);

  if (format === 'md') {
    downloadBlob(new Blob([md], { type: 'text/markdown' }), `export_${scope}_${Date.now()}.md`);
    return;
  }
  if (format === 'html') {
    let htmlWithImages = html;
    for (const im of images) {
      const base64 = await blobToBase64(im.blob);
      htmlWithImages = htmlWithImages.replace(`images/${im.imageId}.png`, base64);
    }
    downloadBlob(new Blob([htmlWithImages], { type: 'text/html' }), `export_${scope}_${Date.now()}.html`);
    return;
  }
  if (format === 'zip') {
    if (!window.JSZip) throw new Error('JSZip 未加载');
    const zip = new window.JSZip();
    zip.file('content.md', md);
    zip.file('content.html', html);

    // 【关键】单实体导出也用全量结构，保证能被 importFullBackup 识别
    const zipData = {
      tasks: data.task ? [data.task] : [],
      chapters: data.chapters || (data.chapter ? [data.chapter] : []),
      points: data.points || [],
      inbox: [],
      recycle: [],
      settings: {},
      audioIndex: [],
      patterns: [],
      schemaVersion: 1,
      exportAt: new Date().toISOString(),
    };
    zip.file('data.json', JSON.stringify(zipData, null, 2));

    const imgFolder = zip.folder('images');
    for (const im of images) {
      imgFolder.file(`${im.imageId}.png`, im.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `export_${scope}_${Date.now()}.zip`);
    return;
  }
  throw new Error('未知导出格式：' + format);
}

// ============ 全量备份 ============
export async function exportFullBackup(options = {}) {
  const {
    data: includeData = true,
    images: includeImages = true,
    audios: includeAudios = true,
    tape: includeTape = true,
    exports: includeExports = true,
    pdf: includePdf = true,
  } = options;

  if (!window.JSZip) throw new Error('JSZip 未加载');
  const zip = new window.JSZip();

  const data = {
    tasks: JSON.parse(localStorage.getItem('kg_tasks') || '[]'),
    chapters: JSON.parse(localStorage.getItem('kg_chapters') || '[]'),
    points: JSON.parse(localStorage.getItem('kg_points') || '[]'),
    inbox: JSON.parse(localStorage.getItem('kg_inbox') || '[]'),
    recycle: JSON.parse(localStorage.getItem('kg_recycle_bin') || '[]'),
    settings: JSON.parse(localStorage.getItem('kg_settings') || '{}'),
    audioIndex: JSON.parse(localStorage.getItem('kg_audio_index') || '[]'),
    patterns: JSON.parse(localStorage.getItem('kg_patterns') || '[]'),
    schemaVersion: Number(localStorage.getItem('kg_schema_version') || 1),
    exportAt: new Date().toISOString(),
  };

  if (includeData) {
    zip.file('data.json', JSON.stringify(data, null, 2));
  }

  const readmeLines = ['考公复习系统备份清单', `导出时间：${new Date().toLocaleString()}`, ''];
  (data.tasks || []).forEach(t => {
    readmeLines.push(`任务：${t.name}`);
    (data.chapters || []).filter(c => c.taskId === t.id).forEach(c => {
      readmeLines.push(`  章节：${c.name}`);
      (data.points || []).filter(p => p.chapterId === c.id).forEach(p => {
        readmeLines.push(`    知识点：${(p.content || '').slice(0, 30)}`);
      });
    });
  });
  zip.file('readme.txt', readmeLines.join('\n'));

  const { dbAll } = await import('../db.js');

  if (includeImages) {
    const images = await dbAll('images');
    const imgFolder = zip.folder('images');
    for (const img of images) {
      if (img.annotatedBlob) imgFolder.file(`${img.id}_annotated.png`, img.annotatedBlob);
      if (img.originalBlob && img.originalBlob !== img.annotatedBlob) {
        imgFolder.file(`${img.id}_original.png`, img.originalBlob);
      }
      if (img.strokeBlob) imgFolder.file(`${img.id}_stroke.png`, img.strokeBlob);
      if (img.paperStrokeBlob) imgFolder.file(`${img.id}_paperstroke.png`, img.paperStrokeBlob);
    }
  }

  if (includeAudios) {
    const audios = await dbAll('audios');
    const audioFolder = zip.folder('audios');
    for (const a of audios) {
      audioFolder.file(`${a.id}.webm`, a.blob);
    }
  }

  if (includeTape) {
    const tapeData = {};
    const paperData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('kg_tape_')) tapeData[k] = JSON.parse(localStorage.getItem(k));
      if (k.startsWith('kg_paper_')) paperData[k] = JSON.parse(localStorage.getItem(k));
    }
    zip.file('tape.json', JSON.stringify(tapeData));
    zip.file('paper.json', JSON.stringify(paperData));
  }

  if (includeExports) {
    for (const task of (data.tasks || [])) {
      const chapters = (data.chapters || []).filter(c => c.taskId === task.id);
      const points = [];
      chapters.forEach(c => {
        (data.points || []).filter(p => p.chapterId === c.id).forEach(p => points.push(p));
      });
      if (points.length === 0) continue;

      const taskData = { task, chapters, points };
      const safeTask = task.name.replace(/[\\/:*?"<>|]/g, '_');
      const dateStr = new Date().toISOString().slice(0, 10);

      zip.file(`exports/${safeTask}_${dateStr}.md`, toMarkdown(taskData, []));
      zip.file(`exports/${safeTask}_${dateStr}.txt`, toPlainText(taskData));
      zip.file(`exports/${safeTask}_${dateStr}.html`, toHtml(taskData, []));
      zip.file(`exports/${safeTask}_${dateStr}_打印版.html`, await buildPrintHtml(taskData, [], { includeImages: false }));

      chapters.forEach(ch => {
        const chPoints = points.filter(p => p.chapterId === ch.id);
        if (chPoints.length === 0) return;
        const chData = { task, chapter: ch, points: chPoints };
        const safeCh = ch.name.replace(/[\\/:*?"<>|]/g, '_');
        zip.file(`exports/${safeTask}_${safeCh}_${dateStr}.md`, toMarkdown(chData, []));
        zip.file(`exports/${safeTask}_${safeCh}_${dateStr}.txt`, toPlainText(chData));
      });
    }
  }

  if (includePdf) {
    for (const task of (data.tasks || [])) {
      const chapters = (data.chapters || []).filter(c => c.taskId === task.id);
      const points = [];
      chapters.forEach(c => {
        (data.points || []).filter(p => p.chapterId === c.id).forEach(p => points.push(p));
      });
      if (points.length === 0) continue;

      const taskData = { task, chapters, points };
      const safeTask = task.name.replace(/[\\/:*?"<>|]/g, '_');
      const dateStr = new Date().toISOString().slice(0, 10);

      const printHtml = await buildPrintHtml(taskData, [], { includeImages: false });
      zip.file(`pdf/${safeTask}_${dateStr}_打印版.html`, printHtml);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `backup_full_${Date.now()}.zip`);
  localStorage.setItem('kg_last_backup_at', new Date().toISOString());
}

// ============ 导入 ============
export async function importFullBackup(file, mode = 'merge', onProgress = null) {
  if (!window.JSZip) throw new Error('JSZip 未加载');
  const zip = await window.JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('不是有效的备份文件');
  const data = JSON.parse(await dataFile.async('string'));

  const stats = { tasks: 0, chapters: 0, points: 0, images: 0, audios: 0, skippedPoints: 0 };

  const totalCount = (data.tasks?.length || 0) + (data.chapters?.length || 0) + (data.points?.length || 0)
    + Object.keys(zip.files).filter(f => f.startsWith('images/')).length
    + Object.keys(zip.files).filter(f => f.startsWith('audios/')).length;
  let doneCount = 0;
  const report = (label) => {
    doneCount++;
    if (onProgress) onProgress(doneCount, totalCount, label);
  };

  function normalizeTask(t) {
    return {
      id: t.id, name: t.name || '未命名任务', note: t.note || '',
      order: t.order ?? 0, createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || new Date().toISOString(), deletedAt: t.deletedAt || null,
      attachments: Array.isArray(t.attachments) ? t.attachments : [],
    };
  }
  function normalizeChapter(c) {
    return {
      id: c.id, taskId: c.taskId, name: c.name || '未命名章节',
      book: c.book || '', part: c.part || '', note: c.note || '',
      order: c.order ?? 0, createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || new Date().toISOString(), deletedAt: c.deletedAt || null,
      attachments: Array.isArray(c.attachments) ? c.attachments : [],
    };
  }
  function normalizePoint(p) {
    return {
      id: p.id, chapterId: p.chapterId, content: p.content || '', explanation: p.explanation || '',
      imageIds: Array.isArray(p.imageIds) ? p.imageIds : [],
      compositeImageIds: Array.isArray(p.compositeImageIds) ? p.compositeImageIds : [],
      audioIds: Array.isArray(p.audioIds) ? p.audioIds : [],
      files: Array.isArray(p.files) ? p.files : [],
      attachments: Array.isArray(p.attachments) ? p.attachments : [],
      reviewCount: typeof p.reviewCount === 'number' ? p.reviewCount : 0,
      difficulty: typeof p.difficulty === 'number' ? p.difficulty : 5,
      intervalDays: typeof p.intervalDays === 'number' ? p.intervalDays : 0,
      nextReviewAt: p.nextReviewAt || new Date().toISOString(),
      reviewHistory: Array.isArray(p.reviewHistory) ? p.reviewHistory : [],
      isErrorProne: !!p.isErrorProne,
      tags: Array.isArray(p.tags) ? p.tags : [],
      order: p.order ?? 0,
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString(),
      deletedAt: p.deletedAt || null,
      manualReviewCount: !!p.manualReviewCount,
      manualNextReviewAt: !!p.manualNextReviewAt,
    };
  }

  const existingTasks = JSON.parse(localStorage.getItem('kg_tasks') || '[]');
  const existingTaskIds = new Set(existingTasks.map(t => t.id));
  const normalizedTasks = (data.tasks || []).map(normalizeTask);
  const incomingTasks = normalizedTasks.filter(t => !existingTaskIds.has(t.id));
  if (mode === 'overwrite') {
    localStorage.setItem('kg_tasks', JSON.stringify(normalizedTasks));
    stats.tasks = normalizedTasks.length;
  } else {
    localStorage.setItem('kg_tasks', JSON.stringify([...existingTasks, ...incomingTasks]));
    stats.tasks = incomingTasks.length;
  }

  // 【进度】每导入一个任务调一次
  for (let i = 0; i < (mode === 'overwrite' ? normalizedTasks.length : incomingTasks.length); i++) {
    report('导入任务');
  }

  const existingChapters = JSON.parse(localStorage.getItem('kg_chapters') || '[]');
  const existingChapterIds = new Set(existingChapters.map(c => c.id));
  const normalizedChapters = (data.chapters || []).map(normalizeChapter);
  const incomingChapters = normalizedChapters.filter(c => !existingChapterIds.has(c.id));
  if (mode === 'overwrite') {
    localStorage.setItem('kg_chapters', JSON.stringify(normalizedChapters));
    stats.chapters = normalizedChapters.length;
  } else {
    localStorage.setItem('kg_chapters', JSON.stringify([...existingChapters, ...incomingChapters]));
    stats.chapters = incomingChapters.length;
  }

  // 【进度】每导入一个章节调一次
  for (let i = 0; i < (mode === 'overwrite' ? normalizedChapters.length : incomingChapters.length); i++) {
    report('导入章节');
  }

  const finalChapters = JSON.parse(localStorage.getItem('kg_chapters') || '[]');
  const finalChapterIds = new Set(finalChapters.map(c => c.id));
  const existingPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
  const existingPointIds = new Set(existingPoints.map(p => p.id));

  const normalizedPoints = (data.points || []).map(normalizePoint);
  const pointsToImport = normalizedPoints.filter(p => !existingPointIds.has(p.id));
  const validPoints = [];
  pointsToImport.forEach(p => {
    if (finalChapterIds.has(p.chapterId)) validPoints.push(p);
    else stats.skippedPoints++;
  });

  if (mode === 'overwrite') {
    const overwritePoints = normalizedPoints.filter(p => finalChapterIds.has(p.chapterId));
    localStorage.setItem('kg_points', JSON.stringify(overwritePoints));
    stats.points = overwritePoints.length;
  } else {
    localStorage.setItem('kg_points', JSON.stringify([...existingPoints, ...validPoints]));
    stats.points = validPoints.length;
  }

  // 【进度】每导入一个知识点调一次
  for (let i = 0; i < (mode === 'overwrite' ? normalizedPoints.length : validPoints.length); i++) {
    report('导入知识点');
  }

  if (mode === 'overwrite') {
    localStorage.setItem('kg_inbox', JSON.stringify(data.inbox || []));
    localStorage.setItem('kg_recycle_bin', JSON.stringify(data.recycle || []));
    localStorage.setItem('kg_settings', JSON.stringify(data.settings || {}));
    localStorage.setItem('kg_audio_index', JSON.stringify(data.audioIndex || []));
    localStorage.setItem('kg_patterns', JSON.stringify(data.patterns || []));
  } else {
    ['inbox', 'recycle'].forEach(key => {
      const existing = JSON.parse(localStorage.getItem(`kg_${key}`) || '[]');
      const existingIds = new Set(existing.map(x => x.id));
      const incoming = (data[key] || []).filter(x => !existingIds.has(x.id));
      localStorage.setItem(`kg_${key}`, JSON.stringify([...existing, ...incoming]));
    });
  }

  const { putImageCached, getImageCached } = await import('../db.js');
  const imgFolder = zip.folder('images');
  if (imgFolder) {
    const files = Object.keys(zip.files).filter(f => f.startsWith('images/') && f.endsWith('.png'));
    for (const f of files) {
      try {
        const blob = await zip.file(f).async('blob');
        const name = f.replace('images/', '').replace('.png', '');
        const isOriginal = name.endsWith('_original');
        const isStroke = name.endsWith('_stroke');
        const isPaperStroke = name.endsWith('_paperstroke');
        const id = name.replace('_annotated', '').replace('_original', '').replace('_stroke', '').replace('_paperstroke', '');
        const existing = await getImageCached(id);
        const record = existing || { id, width: 0, height: 0, createdAt: new Date().toISOString() };
        if (isOriginal) record.originalBlob = blob;
        else if (isStroke) record.strokeBlob = blob;
        else if (isPaperStroke) record.paperStrokeBlob = blob;
        else { record.annotatedBlob = blob; if (!record.originalBlob) record.originalBlob = blob; }
        await putImageCached(record);
        stats.images++;
        // 【进度】每导入一张图片调一次
        report('导入图片');
      } catch (err) { console.warn('图片导入失败:', f, err); }
    }
  }

  const audioFiles = Object.keys(zip.files).filter(f => f.startsWith('audios/') && f.endsWith('.webm'));
  for (const f of audioFiles) {
    try {
      const blob = await zip.file(f).async('blob');
      const id = f.replace('audios/', '').replace('.webm', '');
      await dbPut('audios', { id, blob, mimeType: 'audio/webm', createdAt: new Date().toISOString() });
      stats.audios++;
      // 【进度】每导入一条录音调一次
      report('导入录音');
    } catch (err) { console.warn('录音导入失败:', f, err); }
  }

  const tapeFile = zip.file('tape.json');
  if (tapeFile) {
    const tapeData = JSON.parse(await tapeFile.async('string'));
    Object.entries(tapeData).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }
  const paperFile = zip.file('paper.json');
  if (paperFile) {
    const paperData = JSON.parse(await paperFile.async('string'));
    Object.entries(paperData).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }

  return stats;
}

// ============ 工具 ============
async function downloadBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // 兜底：普通下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}