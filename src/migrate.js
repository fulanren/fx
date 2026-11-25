export const SCHEMA_VERSION = 1;
let __b64Fired = false;
export function migrate() {
  // 存量瘦身与 schema 版本无关，必须放在 stored===SCHEMA_VERSION 的提前 return 之前，
  // 否则老用户（版本号已是 1）永远不会触发迁移。
  if (!__b64Fired) {
    __b64Fired = true;
    // 脚本在 src/utils/ 下，这里必须带 utils/；写成 './migrateBase64.js' 会 404，
    // 而 404 只会被下面这行 warn 吞掉 —— 瘦身永远不跑且毫无提示
    import('./utils/migrateBase64.js')
      .then(m => {
        if (!m || typeof m.migrateBase64Images !== 'function') {
          console.warn('[migrate] migrateBase64.js 已加载但没有导出 migrateBase64Images，函数名被改过？');
          return;
        }
        return m.migrateBase64Images({ auto: true });
      })
      .catch(e => console.warn('[migrate] base64 瘦身未执行：', e && e.message ? e.message : e));
  }
  const stored = Number(localStorage.getItem('kg_schema_version') || 0);
  if (stored === SCHEMA_VERSION) return;
  if (stored < 1) {
    ['kg_tasks', 'kg_chapters', 'kg_points', 'kg_inbox', 'kg_recycle_bin',
      'kg_timer_records', 'kg_audio_index', 'kg_patterns'].forEach(k => {
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