import { uuid } from './utils/id.js';
import { now, addDays, todayStart, isDue } from './utils/date.js';

// 在 store.js 的 init 函数里（或者文件顶部）调用
export function autoCleanRecycleBin() {
  const bin = read(K.recycle);
  const now = Date.now();
  const keep = bin.filter(item => {
    const expire = new Date(item.expireAt).getTime();
    return expire > now; // 保留没过期的
  });

  if (keep.length !== bin.length) {
    console.log(`[自动清理] 彻底删除了 ${bin.length - keep.length} 个过期回收站文件`);
    write(K.recycle, keep);
    // 顺便调用之前的垃圾清理引擎
    cleanOrphanImages();
  }
}

const K = {
  tasks: 'kg_tasks',
  chapters: 'kg_chapters',
  points: 'kg_points',
  recycle: 'kg_recycle_bin',
  streak: 'kg_streak',
  lastReview: 'kg_last_review_at',
  patterns: 'kg_patterns',
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
export function subscribe(fn) {
  listeners.push(fn); return () => {
    const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
  };
}

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
  const bin = getRecycleBin();
  const index = bin.findIndex(x => x.id === id);
  if (index === -1) return false;

  const item = bin[index];
  const data = item.payload;

  if (!data) return false;

  // 1. 恢复任务
  if (item.type === 'task') {
    const tasks = read(K.tasks);
    const filtered = tasks.filter(t => t.id !== data.id);
    data.deletedAt = null;
    filtered.push(data);
    write(K.tasks, filtered);

    // 把属于这个任务的所有章节也复活
    const chapters = read(K.chapters);
    chapters.forEach(c => {
      if (c.taskId === data.id) {
        c.deletedAt = null;
        // 顺便把章节下的知识点也复活
        const points = read(K.points);
        points.forEach(p => {
          if (p.chapterId === c.id) p.deletedAt = null;
        });
        write(K.points, points);
      }
    });
    write(K.chapters, chapters);
  }
  // 2. 恢复章节
  else if (item.type === 'chapter') {
    const tasks = read(K.tasks);
    const chapters = read(K.chapters);

    // 兜底：如果它原本的任务被彻底删了，建一个未分类
    if (!tasks.some(t => t.id === data.taskId)) {
      const fallbackId = uuid();
      tasks.push({ id: fallbackId, name: '未分类恢复的任务', createdAt: now() });
      write(K.tasks, tasks);
      data.taskId = fallbackId;
    }

    const filtered = chapters.filter(c => c.id !== data.id);
    data.deletedAt = null;
    filtered.push(data);
    write(K.chapters, filtered);

    // 把属于这个章节的所有知识点也复活
    const points = read(K.points);
    points.forEach(p => {
      if (p.chapterId === data.id) p.deletedAt = null;
    });
    write(K.points, points);
  }
  // 3. 恢复知识点
  else if (item.type === 'point') {
    const tasks = read(K.tasks);
    const chapters = read(K.chapters);
    const points = read(K.points);

    // 兜底：检查父章节在不在
    if (!chapters.some(c => c.id === data.chapterId)) {
      let fallbackTask = tasks.find(t => t.name === '未分类恢复的任务');
      if (!fallbackTask) {
        fallbackTask = { id: uuid(), name: '未分类恢复的任务', createdAt: now() };
        tasks.push(fallbackTask);
        write(K.tasks, tasks);
      }

      const fallbackChapterId = uuid();
      chapters.push({ id: fallbackChapterId, taskId: fallbackTask.id, name: '未分类恢复的章节', createdAt: now() });
      write(K.chapters, chapters);
      data.chapterId = fallbackChapterId;
    }

    const filtered = points.filter(p => p.id !== data.id);
    data.deletedAt = null;
    filtered.push(data);
    write(K.points, filtered);
  }

  // 从回收站移除
  bin.splice(index, 1);
  write(K.recycle, bin);

  return true;
}
export function purgeRecycle(id) {
  write(K.recycle, read(K.recycle).filter(x => x.id !== id));
  cleanOrphanImages(); //彻底删除时顺便清理垃圾
}
export function emptyRecycle() {
  write(K.recycle, []);
  cleanOrphanImages(); //清空回收站时顺便清理垃圾
}

// ============ 任务 ============
export function getTasks() {
  return read(K.tasks).filter(t => !t.deletedAt).sort((a, b) => a.order - b.order);
}
export function getTask(id) { return read(K.tasks).find(t => t.id === id); }
// 修改 createTask，添加附件字段
export function createTask(patch) {
  const list = read(K.tasks);
  const t = {
    id: uuid(),
    name: patch.name || '未命名文件夹',
    note: patch.note || '',
    parentId: patch.parentId || null, // 记录父文件夹 ID
    imageIds: [],
    pdfFiles: [],
    order: list.filter(x => !x.deletedAt && x.parentId === (patch.parentId || null)).length, // 按同级排序
    createdAt: now(),
    updatedAt: now(),
  };
  list.push(t);
  write(K.tasks, list);
  return t;
}

// 终极版：包含兜底逻辑 + 附件字段
export function createChapter(patch) {
  const tasks = getTasks();

  //如果没有指定任务，或指定的任务不存在
  if (!patch.taskId || !tasks.some(t => t.id === patch.taskId)) {
    if (tasks.length === 0) {
      // 如果连一个任务都没有，自动建一个默认任务
      const defaultTaskId = uuid();
      const newTask = { id: defaultTaskId, name: '默认任务', order: 0, createdAt: now(), updatedAt: now(), imageIds: [], pdfFiles: [] };
      write(K.tasks, [...tasks, newTask]);
      patch.taskId = defaultTaskId;
    } else {
      // 如果有任务，默认放到第一个任务下
      patch.taskId = tasks[0].id;
    }
  }

  const list = read(K.chapters);
  const c = {
    id: uuid(),
    taskId: patch.taskId,
    name: patch.name || '未命名',
    book: patch.book || '',
    part: patch.part || '',
    note: patch.note || '',
    imageIds: [], //确保附件字段存在
    pdfFiles: [], //确保附件字段存在
    order: list.filter(x => x.taskId === patch.taskId && !x.deletedAt).length,
    createdAt: now(),
    updatedAt: now(),
  };
  list.push(c);
  write(K.chapters, list);
  return c;
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
export function mergeTasks(sourceIds, targetId, dedupe = false, newName = null, sortMode = 'keep') {
  const tasks = read(K.tasks);
  const chapters = read(K.chapters);
  const target = tasks.find(t => t.id === targetId);
  if (!target) return;
  if (newName) target.name = newName;
  sourceIds.forEach(sid => {
    const s = tasks.find(t => t.id === sid);
    if (!s) return;
    chapters.filter(c => c.taskId === sid && !c.deletedAt).forEach(c => {
      if (dedupe) {
        const dup = chapters.find(x => x.taskId === targetId && !x.deletedAt && x.name === c.name);
        if (dup) { c.deletedAt = now(); return; }
      }
      c.taskId = targetId;
    });
    s.deletedAt = now();
    pushRecycle('task', s);
  });
  const targetChapters = chapters.filter(c => c.taskId === targetId && !c.deletedAt);
  sortItems(targetChapters, sortMode);
  targetChapters.forEach((c, i) => c.order = i);
  write(K.tasks, tasks);
  write(K.chapters, chapters);
}

export function mergeChapters(sourceIds, targetId, dedupe = false, newName = null, sortMode = 'keep') {
  const chapters = read(K.chapters);
  const points = read(K.points);
  const target = chapters.find(c => c.id === targetId);
  if (!target) return;
  if (newName) target.name = newName;
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
  const targetPoints = points.filter(p => p.chapterId === targetId && !p.deletedAt);
  sortItems(targetPoints, sortMode);
  targetPoints.forEach((p, i) => p.order = i);
  write(K.chapters, chapters);
  write(K.points, points);
}

function sortItems(list, mode) {
  if (mode === 'name-asc') return list.sort((a, b) => (a.name || a.content || '').localeCompare(b.name || b.content || ''));
  if (mode === 'name-desc') return list.sort((a, b) => (b.name || b.content || '').localeCompare(a.name || a.content || ''));
  if (mode === 'date-asc') return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (mode === 'date-desc') return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

// ============ 章节 ============
export function getChapters(taskId) {
  return read(K.chapters).filter(c => c.taskId === taskId && !c.deletedAt).sort((a, b) => a.order - b.order);
}
export function getChapter(id) { return read(K.chapters).find(c => c.id === id); }
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

// ============ 知识点 ============
export function getPoints(chapterId) {
  const allPoints = read(K.points).filter(p => !p.deletedAt);

  //如果传了 chapterId，就按章节过滤
  if (chapterId !== undefined) {
    return allPoints.filter(p => p.chapterId === chapterId).sort((a, b) => a.order - b.order);
  }

  //如果没传参数，就返回所有未删除的卡片（用于首页散落卡片展示）
  return allPoints.sort((a, b) => a.order - b.order);
}
export function getPoint(id) { return read(K.points).find(p => p.id === id); }
export function createPoint(patch) {
  const list = read(K.points);
  const p = {
    id: uuid(),
    chapterId: patch.chapterId || null, //必须允许为 null，代表未分类卡片
    content: patch.content || '未命名卡片',
    explanation: patch.explanation || '',
    imageIds: patch.imageIds || [],
    compositeImageIds: patch.compositeImageIds || [],
    files: patch.files || [],
    reviewCount: 0,
    difficulty: patch.difficulty || 5,
    intervalDays: 0,
    nextReviewAt: now(),
    reviewHistory: [],
    isErrorProne: patch.isErrorProne || false,
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
// 侧边栏挂载配置 (默认错题本在顶部，倒计时在底部)
export function getSidebarConfig() {
  try {
    return JSON.parse(localStorage.getItem('kg_sidebar_config') || '{"errorBookPos":"top","countdownPos":"bottom","countdownSize":"medium"}');
  } catch { return {}; }
}
export function updateSidebarConfig(patch) {
  const cfg = { ...getSidebarConfig(), ...patch };
  localStorage.setItem('kg_sidebar_config', JSON.stringify(cfg));
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
  localStorage.setItem('kg_patterns', JSON.stringify(list));
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

// ============ 文字对象 ============
export function getTextItems(imageId) {
  try { return JSON.parse(localStorage.getItem(`kg_text_${imageId}`) || '[]'); }
  catch { return []; }
}
export function saveTextItems(imageId, items) {
  try { localStorage.setItem(`kg_text_${imageId}`, JSON.stringify(items)); return true; }
  catch { return false; }
}
export function deleteTextItems(imageId) {
  localStorage.removeItem(`kg_text_${imageId}`);
}

// ============ 图层顺序 ============
const LAYER_ORDER_KEY = 'kg_layer_order';

export function getLayerOrder() {
  try {
    const v = JSON.parse(localStorage.getItem(LAYER_ORDER_KEY) || 'null');
    if (Array.isArray(v) && v.length === 5) return v;
  } catch { }
  return ['base', 'paper', 'stroke', 'text', 'tape'];
}

export function saveLayerOrder(order) {
  try { localStorage.setItem(LAYER_ORDER_KEY, JSON.stringify(order)); return true; }
  catch { return false; }
}

export function mergePoints(sourceIds, targetId, dedupe = false, newName = null, sortMode = 'keep', mergeMode = 'concat', saveMode = 'overwrite', customExplanation = null) {
  const list = read(K.points);
  const target = list.find(p => p.id === targetId);
  if (!target) return;

  let finalTargetId = targetId;

  // 1. 克隆新卡片 (另存模式)
  if (saveMode === 'saveAs') {
    finalTargetId = uuid();
    const newTarget = JSON.parse(JSON.stringify(target));
    newTarget.id = finalTargetId;

    // 防重名
    let baseName = newName || target.content;
    let finalName = baseName;
    let counter = 1;
    while (list.some(p => p.content === finalName && !p.deletedAt)) {
      finalName = `${baseName} (${counter})`;
      counter++;
    }
    newTarget.content = finalName;
    newTarget.createdAt = now();
    newTarget.updatedAt = now();
    list.push(newTarget);
  } else {
    if (newName) target.content = newName;
  }

  const finalTarget = list.find(p => p.id === finalTargetId);

  // 2. 处理合并逻辑
  const selectedItems = sourceIds.map(id => list.find(p => p.id === id)).filter(Boolean);

  if (mergeMode === 'concat') {
    //直接使用用户在弹窗里编辑好的 `customExplanation`
    if (customExplanation !== null) {
      finalTarget.explanation = customExplanation;
    } else {
      // 兜底：如果没传，就按老逻辑拼接
      const allExplanations = [target.explanation, ...selectedItems.map(s => s.explanation)].filter(Boolean);
      finalTarget.explanation = allExplanations.join('<br><br>');
    }

    // 合并图片等其他附属数据
    const allImages = [target, ...selectedItems].flatMap(p => p.imageIds || []);
    finalTarget.imageIds = [...new Set(allImages)];

    finalTarget.difficulty = Math.max(target.difficulty || 5, ...selectedItems.map(s => s.difficulty || 5));
    finalTarget.reviewCount = [target, ...selectedItems].reduce((sum, p) => sum + (p.reviewCount || 0), 0);

    const allDates = [target, ...selectedItems].map(p => p.nextReviewAt).filter(Boolean).sort();
    if (allDates.length > 0) finalTarget.nextReviewAt = allDates[0];

  } else {
    // 关联模式
    if (!finalTarget.linkedPointIds) finalTarget.linkedPointIds = [];
    selectedItems.forEach(s => {
      if (!finalTarget.linkedPointIds.includes(s.id)) finalTarget.linkedPointIds.push(s.id);
    });
  }

  // 3. 清理源卡片 (如果选了覆盖)
  sourceIds.forEach(sid => {
    if (sid === targetId) return;
    const s = list.find(p => p.id === sid);
    if (!s) return;

    if (saveMode === 'overwrite') {
      s.deletedAt = now();
      pushRecycle('point', s);
    }
  });

  finalTarget.updatedAt = now();
  write(K.points, list);
}

// ============ 学习统计 ============
export function getStats() {
  const tasks = getTasks();
  const allChapters = tasks.flatMap(t => getChapters(t.id));
  const allPoints = allChapters.flatMap(c => getPoints(c.id));
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;

  // 本周复习数
  let weekReviews = 0;
  allPoints.forEach(p => {
    (p.reviewHistory || []).forEach(r => {
      if (new Date(r.at).getTime() >= weekAgo) weekReviews++;
    });
  });

  // 难度分布
  const diffDist = { low: 0, mid: 0, high: 0 };
  allPoints.forEach(p => {
    const d = p.difficulty || 5;
    if (d <= 3) diffDist.low++;
    else if (d <= 7) diffDist.mid++;
    else diffDist.high++;
  });

  // 掌握度（已背遍数）
  const mastered = allPoints.filter(p => p.reviewCount >= 3).length;
  const learning = allPoints.filter(p => p.reviewCount > 0 && p.reviewCount < 3).length;
  const newPoints = allPoints.filter(p => p.reviewCount === 0).length;

  // 每日复习数（最近 7 天）
  const dailyReviews = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = now - i * 86400000;
    const dayEnd = dayStart + 86400000;
    const d = new Date(dayStart);
    let count = 0;
    allPoints.forEach(p => {
      (p.reviewHistory || []).forEach(r => {
        const t = new Date(r.at).getTime();
        if (t >= dayStart && t < dayEnd) count++;
      });
    });
    dailyReviews.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      count,
    });
  }

  return {
    totalPoints: allPoints.length,
    totalChapters: allChapters.length,
    totalTasks: tasks.length,
    weekReviews,
    diffDist,
    mastered,
    learning,
    newPoints,
    dailyReviews,
    streak: getStreak(),
    dueCount: getDuePoints().length,
    errorCount: allPoints.filter(p => p.isErrorProne).length,
  };
}

// ============ 考试倒计时 ============
export function getExamCountdown() {
  try {
    return JSON.parse(localStorage.getItem('kg_exam_countdown') || 'null');
  } catch { return null; }
}
export function saveExamCountdown(data) {
  localStorage.setItem('kg_exam_countdown', JSON.stringify(data));
}
export function clearExamCountdown() {
  localStorage.removeItem('kg_exam_countdown');
}

// ============ 错题统计 ============
export function getErrorStats(point) {
  const history = point.reviewHistory || [];
  const forgotCount = history.filter(r => r.rating === 'forgot').length;
  const totalCount = history.length;
  const errorRate = totalCount > 0 ? Math.round(forgotCount / totalCount * 100) : 0;
  return { forgotCount, totalCount, errorRate };
}

export function incrementErrorCount(pointId) {
  const list = read(K.points);
  const i = list.findIndex(p => p.id === pointId);
  if (i < 0) return;
  list[i].errorCount = (list[i].errorCount || 0) + 1;
  list[i].isErrorProne = true;
  list[i].updatedAt = now();
  write(K.points, list);
}

// ============ 标注模板 ============
const TEMPLATE_KEY = 'kg_annotator_templates';

export function getTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]'); }
  catch { return []; }
}

export function saveTemplates(list) {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list));
}

export function addTemplate(template) {
  const list = getTemplates();
  list.push({ ...template, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  saveTemplates(list);
  return list;
}

export function deleteTemplate(id) {
  const list = getTemplates().filter(t => t.id !== id);
  saveTemplates(list);
  return list;
}

//支持跨级粘贴/复制的 Task
export function copyTask(taskId, targetParentId = null) {
  const tasks = read(K.tasks);
  const chapters = read(K.chapters);
  const points = read(K.points);

  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;

  const newTaskId = uuid();
  const newTaskName = `${task.name} (副本)`;

  const newTask = { ...task, id: newTaskId, name: newTaskName, parentId: targetParentId, createdAt: now(), updatedAt: now() };
  tasks.push(newTask);

  // 收集该任务下的所有章节
  const taskChapters = chapters.filter(c => c.taskId === taskId && !c.deletedAt);
  const chapterMap = {};

  taskChapters.forEach(c => {
    const newCid = uuid();
    chapterMap[c.id] = newCid;
    chapters.push({ ...c, id: newCid, taskId: newTaskId, createdAt: now(), updatedAt: now() });
  });

  // 收集知识点
  const chapterIds = taskChapters.map(c => c.id);
  const taskPoints = points.filter(p => chapterIds.includes(p.chapterId) && !p.deletedAt);

  taskPoints.forEach(p => {
    const newCid = chapterMap[p.chapterId];
    if (newCid) {
      points.push({ ...p, id: uuid(), chapterId: newCid, createdAt: now(), updatedAt: now() });
    }
  });

  write(K.tasks, tasks);
  write(K.chapters, chapters);
  write(K.points, points);
  return true;
}

export function copyChapter(chapterId) {
  const chapters = read(K.chapters);
  const points = read(K.points);

  const chapter = chapters.find(c => c.id === chapterId);
  if (!chapter) return false;

  const chapterPoints = points.filter(p => p.chapterId === chapterId && !p.deletedAt);

  const clipboardData = {
    type: 'chapter',
    chapter: JSON.parse(JSON.stringify(chapter)),
    points: JSON.parse(JSON.stringify(chapterPoints))
  };

  localStorage.setItem('kg_clipboard_copy', JSON.stringify(clipboardData));
  return true;
}

export function pasteData(targetId = null) {
  const raw = localStorage.getItem('kg_clipboard_copy');
  if (!raw) return { success: false, msg: '剪贴板为空' };
  const data = JSON.parse(raw);

  const tasks = read(K.tasks);
  const chapters = read(K.chapters);
  const points = read(K.points);

  if (data.type === 'task') {
    // 粘贴任务
    const newTaskId = uuid();
    const newTask = { ...data.task, id: newTaskId, name: `${data.task.name} (副本)`, order: tasks.length, createdAt: now(), updatedAt: now() };
    tasks.push(newTask);

    // 重建章节和知识点
    const chapterMap = {};
    data.chapters.forEach(c => {
      const newCid = uuid();
      chapterMap[c.id] = newCid;
      chapters.push({ ...c, id: newCid, taskId: newTaskId, createdAt: now(), updatedAt: now() });
    });

    data.points.forEach(p => {
      const newCid = chapterMap[p.chapterId];
      if (newCid) {
        points.push({ ...p, id: uuid(), chapterId: newCid, createdAt: now(), updatedAt: now() });
      }
    });

    write(K.tasks, tasks);
    write(K.chapters, chapters);
    write(K.points, points);
    return { success: true, msg: '任务已粘贴（含子内容）' };
  }

  if (data.type === 'chapter') {
    // 粘贴章节
    let finalTaskId = targetId;
    // 如果没指定粘贴到哪个任务，且原任务还在，就粘回原任务；否则建个新任务
    if (!finalTaskId) {
      if (tasks.some(t => t.id === data.chapter.taskId)) {
        finalTaskId = data.chapter.taskId;
      } else {
        const fallbackTaskId = uuid();
        tasks.push({ id: fallbackTaskId, name: '未分类任务', order: tasks.length, createdAt: now(), updatedAt: now() });
        write(K.tasks, tasks);
        finalTaskId = fallbackTaskId;
      }
    }

    const newCid = uuid();
    chapters.push({ ...data.chapter, id: newCid, taskId: finalTaskId, name: `${data.chapter.name} (副本)`, order: chapters.filter(c => c.taskId === finalTaskId).length, createdAt: now(), updatedAt: now() });

    data.points.forEach(p => {
      points.push({ ...p, id: uuid(), chapterId: newCid, createdAt: now(), updatedAt: now() });
    });

    write(K.chapters, chapters);
    write(K.points, points);
    return { success: true, msg: '章节已粘贴（含知识点）' };
  }

  return { success: false, msg: '未知的数据类型' };
}

// ============ 垃圾清理引擎 ============
export async function cleanOrphanImages() {
  try {
    const { dbAll, dbDelete } = await import('./db.js'); // 动态引入避免循环依赖

    // 1. 获取所有有效的知识点
    const points = read(K.points).filter(p => !p.deletedAt);
    const activeImageIds = new Set();
    const activePdfIds = new Set();

    points.forEach(p => {
      if (p.imageIds) p.imageIds.forEach(id => activeImageIds.add(id));
      if (p.pdfFiles) p.pdfFiles.forEach(f => activePdfIds.add(f.id));
    });

    // 2. 扫描 IndexedDB 里的 images
    const allImages = await dbAll('images');
    let deletedCount = 0;

    for (const img of allImages) {
      // 如果是 PDF 占位图，根据 pdfId 校验；如果是普通图片，根据 id 校验
      const isPdf = img.type === 'pdf_placeholder';
      const isActive = isPdf ? activePdfIds.has(img.pdfId) : activeImageIds.has(img.id);

      if (!isActive) {
        await dbDelete('images', img.id);
        if (isPdf && img.pdfId) {
          await dbDelete('pdfs', img.pdfId); // 顺便把真实的 PDF 文件也删了
        }
        // 顺便清理关联的胶带和纸张本地存储
        localStorage.removeItem(`kg_tape_${img.id}`);
        localStorage.removeItem(`kg_paper_${img.id}`);
        localStorage.removeItem(`kg_text_${img.id}`);
        deletedCount++;
      }
    }

    console.log(`[清理] 成功清除了 ${deletedCount} 个废弃图片/PDF`);
    return deletedCount;
  } catch (e) {
    console.error('清理垃圾图片失败:', e);
    return 0;
  }
}