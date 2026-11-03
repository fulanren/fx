import * as store from '../store.js';

const REMINDER_KEY = 'kg_reminder';

export function getReminder() {
    try { return JSON.parse(localStorage.getItem(REMINDER_KEY) || 'null'); }
    catch { return null; }
}

export function saveReminder(data) {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(data));
}

export function clearReminder() {
    localStorage.removeItem(REMINDER_KEY);
}

export async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const p = await Notification.requestPermission();
    return p === 'granted';
}

/**
 * 检查是否该提醒，该提醒就弹通知
 * 每次打开网站、或定时器每 10 分钟调一次
 */
export function checkReminder() {
    const r = getReminder();
    if (!r || !r.enabled) return;
    if (Notification.permission !== 'granted') return;

    const now = new Date();
    const [h, m] = (r.time || '20:00').split(':').map(Number);
    const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (r.lastFired === todayKey) return; // 今天已经提醒过

    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (now < target) return; // 还没到时间

    // 到时间了，检查有没有待复习
    const due = store.getDuePoints();
    if (due.length === 0) return;

    new Notification('考公复习提醒', {
        body: `今天有 ${due.length} 个知识点待复习`,
        icon: './assets/icons/icon-192.png',
        tag: 'review-reminder',
    });

    r.lastFired = todayKey;
    saveReminder(r);
}

/** 启动时和定时器调用 */
export function initReminder() {
    checkReminder();
    setInterval(checkReminder, 10 * 60 * 1000); // 每 10 分钟检查一次
}