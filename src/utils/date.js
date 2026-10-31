export function now() { return new Date().toISOString(); }
export function todayStart() { const d = new Date(); d.setHours(0,0,0,0); return d; }
export function addDays(iso, days) {
  const d = new Date(iso); d.setDate(d.getDate() + days); d.setHours(0,0,0,0);
  return d.toISOString();
}
export function isDue(iso) { return new Date(iso) <= new Date(); }
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }