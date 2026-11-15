import * as store from '../store.js';
import { dbGet, dbPut } from '../db.js';
import { toastSuccess, toastError } from '../ui/toast.js';

// ============ 1. 全量导出 ============
export async function exportFullBackup() {
  if (!window.JSZip) {
    toastError('JSZip 未加载，请刷新重试');
    return;
  }

  toastSuccess('正在打包数据，请稍候…');
  const zip = new JSZip();

  // 1. 收集 localStorage 里的所有结构数据（除了主题这种不重要的）
  const localData = {};
  const keys = ['kg_tasks', 'kg_chapters', 'kg_points', 'kg_recycle_bin', 'kg_settings', 'kg_patterns', 'kg_tape', 'kg_paper', 'kg_text'];
  keys.forEach(k => {
    const val = localStorage.getItem(k);
    if (val) localData[k] = JSON.parse(val);
  });

  // 2. 处理动态的图片数据 (IndexedDB)
  const imagesMap = {};
  const imgFolder = zip.folder('images');

  if (window.indexedDB && dbGet) {
    // 这里假设你有办法获取所有 images 的 id (或者通过遍历 kg_points 找 imageIds)
    const allPoints = JSON.parse(localStorage.getItem('kg_points') || '[]');
    let imgIds = new Set();
    allPoints.forEach(p => {
      (p.imageIds || []).forEach(id => imgIds.add(id));
      (p.compositeImageIds || []).forEach(id => imgIds.add(id));
    });

    for (const id of imgIds) {
      const rec = await dbGet('images', id);
      if (rec && rec.originalBlob) {
        // 记录 meta 信息
        imagesMap[id] = { width: rec.width, height: rec.height, source: rec.source };
        // 把 Blob 存进 zip
        imgFolder.file(`${id}.png`, rec.originalBlob);
      }
    }
  }

  // 3. 把 meta.json 放进去
  const meta = {
    version: 2,
    exportedAt: new Date().toISOString(),
    localData,
    imagesMap
  };
  zip.file('meta.json', JSON.stringify(meta, null, 2));

  // 4. 生成并下载 ZIP
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `考公复习_全量备份_${new Date().toLocaleDateString()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  toastSuccess('导出成功');
}

// ============ 2. 导入备份 ============
export function importFullBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.JSZip) { toastError('JSZip 未加载'); return; }

    toastSuccess('正在解析备份，请稍候…');
    try {
      const zip = await JSZip.loadAsync(file);
      const metaFile = zip.file('meta.json');
      if (!metaFile) throw new Error('备份文件格式错误，缺少 meta.json');

      const meta = JSON.parse(await metaFile.async('string'));
      if (meta.version !== 2) throw new Error('备份版本不兼容');

      // 1. 恢复 localStorage
      Object.keys(meta.localData).forEach(k => {
        localStorage.setItem(k, JSON.stringify(meta.localData[k]));
      });

      // 2. 恢复图片 (存入 IndexedDB)
      const imgFolder = zip.folder('images');
      if (imgFolder && window.dbPut) {
        const imgFiles = [];
        imgFolder.forEach((path, file) => { if (!file.dir) imgFiles.push(file); });

        for (const file of imgFiles) {
          const id = file.name.replace('.png', '');
          const blob = await file.async('blob');
          const imgMeta = meta.imagesMap[id] || {};

          await dbPut('images', {
            id,
            originalBlob: blob,
            annotatedBlob: blob, // 这里的备份只存了底图，标注层根据你的需要可以再调整
            width: imgMeta.width || 800,
            height: imgMeta.height || 600,
            source: imgMeta.source || 'imported',
            createdAt: new Date().toISOString()
          });
        }
      }

      toastSuccess('导入成功，即将刷新页面');
      setTimeout(() => location.reload(), 1000);

    } catch (err) {
      console.error(err);
      toastError('导入失败：' + err.message);
    }
  };
  input.click();
}