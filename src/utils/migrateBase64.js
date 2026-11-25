// src/utils/migrateBase64.js
// 一次性存量瘦身：把卡片 explanation/content 里内嵌的 base64 图片抽成 Blob 存进 images 表，
// 正文只留 <img data-img-id="..."> 引用。幂等、逐卡 try、支持 dry-run。
// 前置：editPoint.js 已落地 #5（hydrateExplainImgs / explainToSelfContained），
//       否则迁移后编辑框里会看到空图位。
import * as store from '../store.js';
import { dbPut, dbGet } from '../db.js';
import { uuid } from './id.js';

const FLAG = 'kg_b64_migrated_v1';           // 跑完打标记，二次调用直接跳过
const MIN_BYTES = 20 * 1024;                 // 小于 20KB 的 base64（小图标/emoji）不动，收益低

function b64ToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || 'image/png';
  const rest = m[3];
  if (m[2]) {                                // ;base64
    let bin;
    try { bin = atob(rest); } catch (e) { return null; }
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  try { return new Blob([decodeURIComponent(rest)], { type: mime }); } catch (e) { return null; }
}

function measure(blob) {                      // 读出真实宽高，失败给 0 不影响主流程
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { const d = { w: img.naturalWidth, h: img.naturalHeight }; URL.revokeObjectURL(url); res(d); };
    img.onerror = () => { URL.revokeObjectURL(url); res({ w: 0, h: 0 }); };
    img.src = url;
  });
}

async function stripField(html, stats, dry) {
  if (!html || typeof html !== 'string' || html.indexOf('data:image') === -1) return html;
  const tags = html.match(/<img[^>]*>/g) || [];
  let out = html;
  for (const tag of tags) {
    const srcM = tag.match(/src="(data:image[^"]+)"/);
    if (!srcM) continue;
    if (/\bdata-img-id=/.test(tag)) continue;          // 已是引用式，跳过（幂等关键）
    if (srcM[1].length < MIN_BYTES) continue;          // 小图不动
    const blob = b64ToBlob(srcM[1]);
    if (!blob || blob.size === 0) continue;

    const id = uuid();
    let w = 0, h = 0;
    try { const d = await measure(blob); w = d.w; h = d.h; } catch (e) { }

    if (!dry) {
      await dbPut('images', {
        id,
        type: 'image',
        name: `migrated_${id}.png`,
        originalBlob: blob,
        annotatedBlob: blob,
        width: w, height: h, dpr: 1,
        source: 'migrated',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    // 保留原标签上的 style/class 等属性，只把 src 换成引用标记
    let newTag = tag.replace(/\s*src="data:image[^"]*"/, '').replace(/^<img/, `<img data-img-id="${id}"`);
    out = out.split(tag).join(newTag);
    stats.moved++;
    stats.savedBytes += srcM[1].length - id.length;     // 粗略：base64 串长 - 引用长
  }
  return out;
}

export async function migrateBase64Images(opts = {}) {
  const dry = !!opts.dry;
  const force = !!opts.force;
  const auto = !!opts.auto;

  if (auto && !force && localStorage.getItem(FLAG) === '1') return { skipped: true };

  const stats = { points: 0, moved: 0, savedBytes: 0, failed: 0 };
  let points = [];
  try { points = store.getPoints() || []; } catch (e) { console.warn('[migrateBase64] 读卡片失败', e); return stats; }

  for (const p of points) {
    try {
      if (!p.explanation || p.explanation.indexOf('data:image') === -1) continue;
      const before = p.explanation;
      const after = await stripField(before, stats, dry);
      if (after === before) continue;

      stats.points++;
      if (!dry) {
        // 不写进 imageIds：这些图只服务正文内嵌显示，进附件列表会出现重复卡片
        store.updatePoint(p.id, { explanation: after });
      }
    } catch (e) {
      stats.failed++;
      console.warn('[migrateBase64] 单卡失败，已跳过：', p && p.id, e);
    }
  }

  if (!dry) {
    localStorage.setItem(FLAG, '1');
    localStorage.setItem('kg_b64_migrate_log', JSON.stringify({ ...stats, at: new Date().toISOString(), dry: false }));
  }
  console.info('[migrateBase64] 完成', dry ? '(dry-run，未写库)' : '', stats,
    `约释放 ${(stats.savedBytes / 1024 / 1024).toFixed(2)} MB 正文体积`);
  return stats;
}

// 迁移后自检：随机抽一张卡，确认引用图能取到 blob
export async function verifyAfterMigrate(pointId) {
  const p = store.getPoint(pointId);
  if (!p) return { ok: false, msg: '卡片不存在' };
  const ids = [...new Set([...(p.explanation || '').matchAll(/data-img-id="([^"]+)"/g)].map(m => m[1]))];
  const missing = [];
  for (const id of ids) { const r = await dbGet('images', id); if (!r || !r.originalBlob || !r.originalBlob.size) missing.push(id); }
  return { ok: missing.length === 0, total: ids.length, missing };
}

// 手动入口：浏览器控制台执行  window.__migrateBase64 = migrateBase64Images
if (typeof window !== 'undefined') window.__migrateBase64 = migrateBase64Images;
