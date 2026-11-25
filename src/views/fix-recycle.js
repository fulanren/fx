// fix-recycle.js
import * as store from '../store.js';

/**
 * 终极修复脚本：全量遍历匹配，补全回收站历史数据的 folderName 和 pointName
 */
export function fixRecycleData() {
  console.log('🔧 开始深度扫描并修复回收站历史数据...');

  const bin = store.getRecycleBin();
  if (!bin || bin.length === 0) {
    console.log('✅ 回收站为空，无需修复。');
    return;
  }

  // 1. 一次性获取所有卡片和文件夹数据（请根据你 store.js 实际暴露的方法名调整）
  // 常见的方法名可能是 getPoints/getAllPoints, getChapters/getFolders/getAllFolders
  const allPoints = store.getPoints ? store.getPoints() : (store.getAllPoints ? store.getAllPoints() : []);
  const allFolders = store.getChapters ? store.getChapters() : (store.getFolders ? store.getFolders() : (store.getAllFolders ? store.getAllFolders() : []));

  if (!allPoints || allPoints.length === 0) {
    console.warn('⚠️ 警告：未能从 store 中获取到卡片数据，请检查 store.js 中的方法名！');
  }

  let fixCount = 0;

  // 2. 遍历回收站条目
  bin.forEach(item => {
    if (['image', 'attachment', 'composite'].includes(item.type)) {
      const p = item.payload;
      if (!p) return;

      let targetPointId = null;
      let needsFix = false;

      // 判断是否需要修复
      if (item.type === 'image' || item.type === 'composite') {
        targetPointId = p.pointId;
        if (!p.pointName || p.pointName === '未知卡片' || !p.folderName || p.folderName === '未知文件夹') {
          needsFix = true;
        }
      } else if (item.type === 'attachment') {
        targetPointId = p.entityId;
        if (!p.entityName || !p.folderName || p.folderName === '未知文件夹') {
          needsFix = true;
        }
      }

      // 3. 执行匹配与补全
      if (needsFix && targetPointId) {
        // 在全部卡片中查找对应的卡片
        const point = allPoints.find(pt => pt.id === targetPointId);

        if (point) {
          // 清洗并补全卡片名称
          const cleanPointName = (point.name || point.content || '未命名卡片').replace(/<[^>]+>/g, '').slice(0, 30);

          if (item.type === 'image' || item.type === 'composite') {
            p.pointName = cleanPointName;
          } else {
            p.entityName = cleanPointName;
          }

          // 如果卡片有 folderId，继续在全部文件夹中查找
          if (point.folderId) {
            const folder = allFolders.find(fd => fd.id === point.folderId);
            if (folder) {
              p.folderName = (folder.name || '未命名文件夹').replace(/<[^>]+>/g, '').slice(0, 20);
            } else {
              p.folderName = '未知文件夹'; // 确实找不到时兜底
            }
          }

          fixCount++;
          console.log(`✅ 已修复 [${item.type}]:`, p.pointName || p.entityName, '-> 文件夹:', p.folderName);
        } else {
          console.warn(`⚠️ 找不到 ID 为 ${targetPointId} 的卡片，可能该卡片已被彻底删除。`);
        }
      }
    }
  });

  // 4. 保存修改回 store
  if (fixCount > 0) {
    if (store.saveRecycleBin) {
      store.saveRecycleBin(bin);
    } else if (store.updateRecycleBin) {
      store.updateRecycleBin(bin);
    } else {
      console.warn('⚠️ 未在 store 中找到 saveRecycleBin 方法，请确认数据是否已持久化。');
    }
    console.log(`🎉 修复完成！共更新了 ${fixCount} 条记录。请刷新页面查看效果。`);
  } else {
    console.log('✅ 未发现需要修复的历史数据，或所有数据已完整。');
  }
}