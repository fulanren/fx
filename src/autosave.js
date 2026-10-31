import { now } from './utils/date.js';
function key(entity, id) { return `kg_drafts_${entity}_${id}`; }
export function saveDraft(entity, id, data) {
  try {
    localStorage.setItem(key(entity, id), JSON.stringify({ entity, entityId: id, data, savedAt: now() }));
    return true;
  } catch { return false; }
}
export function loadDraft(entity, id) {
  try {
    const raw = localStorage.getItem(key(entity, id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (new Date(d.savedAt).getTime() < Date.now() - 7 * 86400000) {
      localStorage.removeItem(key(entity, id)); return null;
    }
    return d;
  } catch { return null; }
}
export function clearDraft(entity, id) { localStorage.removeItem(key(entity, id)); }
export function hasChanges(original, current) {
  const keys = new Set([...Object.keys(original||{}), ...Object.keys(current||{})]);
  for (const k of keys) {
    if (k === 'updatedAt' || k === 'id') continue;
    if (JSON.stringify(original?.[k]) !== JSON.stringify(current?.[k])) return true;
  }
  return false;
}