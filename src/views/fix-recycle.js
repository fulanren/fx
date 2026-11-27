// fix-recycle.js
import * as store from '../store.js';

/**
 * 终极修复脚本：全量遍历匹配，补全回收站历史数据的 folderName 和 pointName
 */
export function fixRecycleData() {
  const bin = store.getRecycleBin();
  if (!bin || bin.length === 0) {
    return;
  }

  const allPoints = store.getPoints ? store.getPoints() : (store.getAllPoints ? store.getAllPoints() : []);
  const allFolders = store.getChapters ? store.getChapters() : (store.getFolders ? store.getFolders() : (store.getAllFolders ? store.getAllFolders() : []));

  // 如果连卡片数据都没有，直接结束
  if (!allPoints || allPoints.length === 0) {
    return;
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
    }
  }
}