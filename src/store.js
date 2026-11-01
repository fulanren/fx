import { uuid } from './utils/id.js';
import { now, addDays, todayStart, isDue } from './utils/date.js';

const K = {
  tasks: 'kg_tasks',
  chapters: 'kg_chapters',
  points: 'kg_points',
  recycle: 'kg_recycle_bin',
  streak: 'kg_streak',
  lastReview: 'kg_last_review_at',
};

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    setSaveStatus('saved');
    return true;
  } catch (e) {
    setSaveStatus('failed');
    console.error('写盘失败', e);
    return false;
  }
}

// ============ 保存状态 ============
let status = 'saved';
const statusListeners = [];
export function setSaveStatus(s) {
  status = s;
  statusListeners.forEach(fn => fn(s));
}
export function getSaveStatus() { return status; }
export function onSaveStatus(fn) { statusListeners.push(fn); }

// 写盘防抖（保留给未来高频操作）
const pending = new Map();
let flushTimer = null;
function scheduleWrite(key, val) {
  pending.set(key, val);
  setSaveStatus('saving');
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushNow(); }, 200);
}
export function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  for (const [k, v] of pending) { write(k, v); notify(k, v); }
  pending.clear();
}
export function flushAll() { flushNow(); }

const listeners = [];
function notify(key, val) { listeners.forEach(fn => fn(key, val)); }
export function subscribe(fn) { listeners.push(fn); return () => {
  const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
}; }

// ============ 回收站 ============
function pushRecycle(type, obj) {
  const bin = read(K.recycle);
  bin.push({
    id: uuid(),
    type,
    payload: JSON.parse(JSON.stringify(obj)),
    deletedAt: now(),
    expireAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  write(K.recycle, bin);
}
export function getRecycleBin() { return read(K.recycle); }
export function restoreRecycle(id) {
  const bin = read(K.recycle);
  const item = bin.find(x => x.id === id);
  if (!item) return;
  const p = item.payload;
  const map = { task: K.tasks, chapter: K.chapters, point: K.points };
  const key = map[item.type];
  if (key) {
    const list = read(key);
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i].deletedAt = null;
    else list.push({ ...p, deletedAt: null });
    write(key, list);
  }
  write(K.recycle, bin.filter(x => x.id !== id));
}
export function purgeRecycle(id) {
  write(K.recycle, read(K.recycle).filter(x => x.id !== id));
}
export function emptyRecycle() { write(K.recycle, []); }

// ============ 任务 ============
export function getTasks() {
  return read(K.tasks).filter(t => !t.deletedAt).sort((a, b) => a.order - b.order);
}
export function getTask(id) { return read(K.tasks).find(t => t.id === id); }
export function createTask(patch) {
  const list = read(K.tasks);
  const t = {
    id: uuid(),
    name: patch.name || '未命名',
    note: patch.note || '',
    order: list.length,
    createdAt: now(),
    updatedAt: now(),
  };
  list.push(t);
  write(K.tasks, list);
  return t;
}
export function updateTask(id, patch) {
  const list = read(K.tasks);
  const i = list.findIndex(t => t.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, updatedAt: now() };
  write(K.tasks, list);
  return list[i];
}
export function deleteTask(id) {
  const list = read(K.tasks);
  const t = list.find(x => x.id === id);
  if (!t) return;
  pushRecycle('task', t);
  t.deletedAt = now();
  write(K.tasks, list);
  const chs = read(K.chapters);
  chs.filter(c => c.taskId === id && !c.deletedAt).forEach(c => c.deletedAt = now());
  write(K.chapters, chs);
}
export function mergeTasks(sourceIds, targetId, dedupe = false) {
  const tasks = read(K.tasks);
  const chapters = read(K.chapters);
  const target = tasks.find(t => t.id === targetId);
  if (!target) return;
  sourceIds.forEach(sid => {
    const s = tasks.find(t => t.id === sid);
    if (!s) return;
    chapters.filter(c => c.taskId === sid && !c.deletedAt).forEach(c => {
      if (dedupe) {
        const dup = chapters.find(x => x.taskId === targetId && !x.deletedAt && x.name === c.name);
        if (dup) { c.deletedAt = now(); return; }
      }
      c.taskId = targetId;
      c.order = chapters.filter(x => x.taskId === targetId && !x.deletedAt).length;
    });
    s.deletedAt = now();
    pushRecycle('task', s);
  });
  write(K.tasks, tasks);
  write(K.chapters, chapters);
}

// ============ 章节 ============
export function getChapters(taskId) {
  return read(K.chapters).filter(c => c.taskId === taskId && !c.deletedAt).sort((a, b) => a.order - b.order);
}
export function getChapter(id) { return read(K.chapters).find(c => c.id === id); }
export function createChapter(patch) {
  const list = read(K.chapters);
  const c = {
    id: uuid(),
    taskId: patch.taskId,
    name: patch.name || '未命名',
    book: patch.book || '',
    part: patch.part || '',
    note: patch.note || '',
    order: list.filter(x => x.taskId === patch.taskId && !x.deletedAt).length,
    createdAt: now(),
    updatedAt: now(),
  };
  list.push(c);
  write(K.chapters, list);
  return c;
}
export function updateChapter(id, patch) {
  const list = read(K.chapters);
  const i = list.findIndex(c => c.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, updatedAt: now() };
  write(K.chapters, list);
  return list[i];
}
export function deleteChapter(id) {
  const list = read(K.chapters);
  const c = list.find(x => x.id === id);
  if (!c) return;
  pushRecycle('chapter', c);
  c.deletedAt = now();
  write(K.chapters, list);
  const pts = read(K.points);
  pts.filter(p => p.chapterId === id && !p.deletedAt).forEach(p => p.deletedAt = now());
  write(K.points, pts);
}
export function mergeChapters(sourceIds, targetId, dedupe = false) {
  const chapters = read(K.chapters);
  const points = read(K.points);
  sourceIds.forEach(sid => {
    const s = chapters.find(c => c.id === sid);
    if (!s) return;
    points.filter(p => p.chapterId === sid && !p.deletedAt).forEach(p => {
      if (dedupe) {
        const dup = points.find(x => x.chapterId === targetId && !x.deletedAt && x.content === p.content);
        if (dup) { p.deletedAt = now(); return; }
      }
      p.chapterId = targetId;
    });
    s.deletedAt = now();
    pushRecycle('chapter', s);
  });
  write(K.chapters, chapters);
  write(K.points, points);
}

// ============ 知识点 ============
export function getPoints(chapterId) {
  return read(K.points).filter(p => p.chapterId === chapterId && !p.deletedAt).sort((a, b) => a.order - b.order);
}
export function getPoint(id) { return read(K.points).find(p => p.id === id); }
export function createPoint(patch) {
  const list = read(K.points);
  const p = {
    id: uuid(),
    chapterId: patch.chapterId,
    content: patch.content || '',
    explanation: patch.explanation || '',
    imageIds: [],
    compositeImageIds: [],
    audioIds: [],
    files: [],
    reviewCount: 0,
    difficulty: patch.difficulty || 5,
    intervalDays: 0,
    nextReviewAt: addDays(now(), 1),
    reviewHistory: [],
    isErrorProne: false,
    tags: [],
    order: list.filter(x => x.chapterId === patch.chapterId && !x.deletedAt).length,
    createdAt: now(),
    updatedAt: now(),
  };
  list.push(p);
  write(K.points, list);
  return p;
}
export function updatePoint(id, patch) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, updatedAt: now() };
  write(K.points, list);
  return list[i];
}
export function deletePoint(id) {
  const list = read(K.points);
  const p = list.find(x => x.id === id);
  if (!p) return;
  pushRecycle('point', p);
  p.deletedAt = now();
  write(K.points, list);
}

// ============ 自评 ============
export function ratePoint(id, rating, durationMs = 0) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return null;
  const p = list[i];
  const prev = p.intervalDays || 0;
  let next = rating === 'forgot' ? 1
    : rating === 'vague' ? (prev ? Math.round(prev * 1.5) : 1)
    : (prev ? Math.round(prev * 2.2) : 2);
  const d = p.difficulty || 5;
  next = Math.max(1, Math.round(next * (d <= 3 ? 1.2 : d >= 8 ? 0.8 : 1)));
  p.intervalDays = next;
  p.reviewCount = (p.reviewCount || 0) + 1;
  p.nextReviewAt = addDays(now(), next);
  p.reviewHistory = [...(p.reviewHistory || []), {
    at: now(), rating, durationMs, prevInterval: prev, nextInterval: next,
  }].slice(-50);
  p.updatedAt = now();
  write(K.points, list);
  updateStreak();
  return p;
}

// ============ 今日待复习 ============
export function getDuePoints() {
  const nowMs = Date.now();
  return read(K.points).filter(p => {
    if (p.deletedAt) return false;
    if (p.excluded) return false;
    if (p.snoozedUntil && new Date(p.snoozedUntil).getTime() > nowMs) return false;
    return isDue(p.nextReviewAt);
  }).sort((a, b) => {
    const da = (a.difficulty || 5) * 2 + Math.max(0, Math.floor((Date.now() - new Date(a.nextReviewAt)) / 86400000)) * 1.5;
    const db = (b.difficulty || 5) * 2 + Math.max(0, Math.floor((Date.now() - new Date(b.nextReviewAt)) / 86400000)) * 1.5;
    return db - da;
  });
}

// ============ 推迟 / 排除 ============
export function snoozePoint(id, untilIso) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return;
  if (untilIso) list[i].snoozedUntil = untilIso;
  else delete list[i].snoozedUntil;
  list[i].updatedAt = now();
  write(K.points, list);
}

export function excludePoint(id) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return;
  list[i].excluded = true;
  list[i].updatedAt = now();
  write(K.points, list);
}

export function unexcludePoint(id) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return;
  list[i].excluded = false;
  delete list[i].snoozedUntil;
  list[i].updatedAt = now();
  write(K.points, list);
}

// ============ 批量操作 ============
export function batchDeletePoints(ids) {
  const list = read(K.points);
  ids.forEach(id => {
    const p = list.find(x => x.id === id);
    if (p) { pushRecycle('point', p); p.deletedAt = now(); }
  });
  write(K.points, list);
}

export function batchUpdatePoints(ids, patch) {
  const list = read(K.points);
  ids.forEach(id => {
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list[i] = { ...list[i], ...patch, updatedAt: now() };
  });
  write(K.points, list);
}

export function batchMovePoints(ids, targetChapterId) {
  const list = read(K.points);
  ids.forEach(id => {
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) {
      list[i].chapterId = targetChapterId;
      list[i].updatedAt = now();
    }
  });
  write(K.points, list);
}

export function batchRatePoints(ids, rating) {
  ids.forEach(id => ratePoint(id, rating));
}

// ============ 排序 ============
export function reorderTasks(orderedIds) {
  const list = read(K.tasks);
  orderedIds.forEach((id, idx) => {
    const t = list.find(x => x.id === id);
    if (t) t.order = idx;
  });
  write(K.tasks, list);
}

export function reorderChapters(taskId, orderedIds) {
  const list = read(K.chapters);
  orderedIds.forEach((id, idx) => {
    const c = list.find(x => x.id === id && x.taskId === taskId);
    if (c) c.order = idx;
  });
  write(K.chapters, list);
}

export function reorderPoints(chapterId, orderedIds) {
  const list = read(K.points);
  orderedIds.forEach((id, idx) => {
    const p = list.find(x => x.id === id && x.chapterId === chapterId);
    if (p) p.order = idx;
  });
  write(K.points, list);
}

export function movePoint(id, direction) {
  const p = getPoint(id);
  if (!p) return;
  const siblings = getPoints(p.chapterId);
  const idx = siblings.findIndex(x => x.id === id);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= siblings.length) return;
  const ids = siblings.map(x => x.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  reorderPoints(p.chapterId, ids);
}

export function moveChapter(id, direction) {
  const c = getChapter(id);
  if (!c) return;
  const siblings = getChapters(c.taskId);
  const idx = siblings.findIndex(x => x.id === id);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= siblings.length) return;
  const ids = siblings.map(x => x.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  reorderChapters(c.taskId, ids);
}

// ============ 连续打卡 ============
function updateStreak() {
  const last = localStorage.getItem(K.lastReview);
  const today = todayStart().toISOString();
  if (last) {
    const ld = new Date(last);
    ld.setHours(0, 0, 0, 0);
    const diff = Math.floor((new Date(today) - ld) / 86400000);
    if (diff === 0) return;
    if (diff === 1) {
      const s = Number(localStorage.getItem(K.streak) || '0');
      localStorage.setItem(K.streak, String(s + 1));
    } else localStorage.setItem(K.streak, '1');
  } else localStorage.setItem(K.streak, '1');
  localStorage.setItem(K.lastReview, today);
}
export function getStreak() {
  return Number(localStorage.getItem(K.streak) || '0');
}

// ============ 速记收件箱 ============
export function getInbox() {
  return read('kg_inbox').filter(i => !i.consumed).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
export function addInbox(content) {
  const list = read('kg_inbox');
  const item = { id: uuid(), content, createdAt: now(), consumed: false };
  list.push(item);
  write('kg_inbox', list);
  return item;
}
export function consumeInbox(id) {
  const list = read('kg_inbox');
  const i = list.findIndex(x => x.id === id);
  if (i >= 0) { list[i].consumed = true; write('kg_inbox', list); }
}
export function deleteInbox(id) {
  write('kg_inbox', read('kg_inbox').filter(x => x.id !== id));
}

// ============ 全局搜索 ============
export function searchAll(query) {
  const q = query.trim().toLowerCase();
  if (!q) return { tasks: [], chapters: [], points: [] };
  const tasks = getTasks().filter(t =>
    t.name.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)
  );
  const chapters = read(K.chapters).filter(c => !c.deletedAt && (
    c.name.toLowerCase().includes(q) ||
    (c.book || '').toLowerCase().includes(q) ||
    (c.note || '').toLowerCase().includes(q)
  ));
  const points = read(K.points).filter(p => !p.deletedAt && (
    (p.content || '').toLowerCase().includes(q) ||
    (p.explanation || '').toLowerCase().includes(q)
  ));
  return { tasks, chapters, points };
}

// ============ 设置 ============
export function getSettings() {
  try { return JSON.parse(localStorage.getItem('kg_settings') || '{}'); }
  catch { return {}; }
}
export function updateSettings(patch) {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem('kg_settings', JSON.stringify(s));
  return s;
}

// ============ 胶带 / 纸张 / 花样 ============
export function getTape(imageId) {
  try { return JSON.parse(localStorage.getItem(`kg_tape_${imageId}`) || '[]'); }
  catch { return []; }
}
export function saveTape(imageId, items) {
  try { localStorage.setItem(`kg_tape_${imageId}`, JSON.stringify(items)); return true; }
  catch (e) { console.error('胶带存储失败', e); return false; }
}

export function getPaper(imageId) {
  try { return JSON.parse(localStorage.getItem(`kg_paper_${imageId}`) || '[]'); }
  catch { return []; }
}
export function savePaper(imageId, items) {
  try { localStorage.setItem(`kg_paper_${imageId}`, JSON.stringify(items)); return true; }
  catch (e) { console.error('纸张存储失败', e); return false; }
}

export function deleteImageAssets(imageId) {
  localStorage.removeItem(`kg_tape_${imageId}`);
  localStorage.removeItem(`kg_paper_${imageId}`);
}

export function getPatterns() {
  try { return JSON.parse(localStorage.getItem('kg_patterns') || '[]'); }
  catch { return []; }
}
export function savePatterns(list) {
  localStorage.setItem('kg_patterns', JSON.stringify(list));
}
export function addPattern(pattern) {
  const list = getPatterns();
  list.push(pattern);
  savePatterns(list);
  return pattern;
}
export function removePattern(id) {
  savePatterns(getPatterns().filter(p => p.id !== id));
}

// ============ 图片关联 ============
export function addImageToPoint(pointId, imageId) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === pointId);
  if (i < 0) return;
  if (!list[i].imageIds) list[i].imageIds = [];
  if (!list[i].imageIds.includes(imageId)) list[i].imageIds.push(imageId);
  list[i].updatedAt = now();
  write(K.points, list);
}

export function removeImageFromPoint(pointId, imageId) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === pointId);
  if (i < 0) return;
  list[i].imageIds = (list[i].imageIds || []).filter(id => id !== imageId);
  list[i].updatedAt = now();
  write(K.points, list);
}

export function addCompositeToPoint(pointId, imageId) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === pointId);
  if (i < 0) return;
  if (!list[i].compositeImageIds) list[i].compositeImageIds = [];
  if (!list[i].compositeImageIds.includes(imageId)) list[i].compositeImageIds.push(imageId);
  list[i].updatedAt = now();
  write(K.points, list);
}
// ============ 附件 ============
export function addAttachment(entity, entityId, attachment) {
  const keyMap = { task: K.tasks, chapter: K.chapters, point: K.points };
  const key = keyMap[entity];
  if (!key) return;
  const list = read(key);
  const i = list.findIndex(x => x.id === entityId);
  if (i < 0) return;
  if (!list[i].attachments) list[i].attachments = [];
  list[i].attachments.push(attachment);
  list[i].updatedAt = now();
  write(key, list);
}

export function removeAttachment(entity, entityId, attachmentId) {
  const keyMap = { task: K.tasks, chapter: K.chapters, point: K.points };
  const key = keyMap[entity];
  if (!key) return;
  const list = read(key);
  const i = list.findIndex(x => x.id === entityId);
  if (i < 0) return;
  list[i].attachments = (list[i].attachments || []).filter(a => a.id !== attachmentId);
  list[i].updatedAt = now();
  write(key, list);
}

export function getAttachments(entity, entityId) {
  const keyMap = { task: K.tasks, chapter: K.chapters, point: K.points };
  const key = keyMap[entity];
  if (!key) return [];
  const item = read(key).find(x => x.id === entityId);
  return item?.attachments || [];
}