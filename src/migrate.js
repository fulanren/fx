export const SCHEMA_VERSION = 1;
export function migrate() {
  const stored = Number(localStorage.getItem('kg_schema_version') || 0);
  if (stored === SCHEMA_VERSION) return;
  if (stored < 1) {
    ['kg_tasks','kg_chapters','kg_points','kg_inbox','kg_recycle_bin',
     'kg_timer_records','kg_audio_index','kg_patterns'].forEach(k => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, '[]');
    });
    if (!localStorage.getItem('kg_settings')) {
      localStorage.setItem('kg_settings', JSON.stringify({
        theme: 'system', penOnly: true,
        pomodoroWorkMs: 1500000, pomodoroBreakMs: 300000,
        selfTestLimitEnabled: false, selfTestLimitMs: 90000,
      }));
    }
    if (!localStorage.getItem('kg_streak')) localStorage.setItem('kg_streak', '0');
  }
  localStorage.setItem('kg_schema_version', String(SCHEMA_VERSION));
}
export function cleanExpiredDrafts() {
  const now = Date.now(); const rm = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('kg_drafts_')) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k));
      if (d.savedAt && now - new Date(d.savedAt).getTime() > 7 * 86400000) rm.push(k);
    } catch { rm.push(k); }
  }
  rm.forEach(k => localStorage.removeItem(k));
  return rm.length;
}
export function cleanRecycleBin() {
  const bin = JSON.parse(localStorage.getItem('kg_recycle_bin') || '[]');
  const now = Date.now();
  const keep = bin.filter(i => new Date(i.expireAt).getTime() > now);
  if (keep.length !== bin.length) localStorage.setItem('kg_recycle_bin', JSON.stringify(keep));
  return bin.length - keep.length;
}