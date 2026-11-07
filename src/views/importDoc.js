import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { dbPut } from '../db.js';

// ... (保留上方的 globalImportDocModal 不变) ...

// 👇 替换为增强版的大纲解析（支持提取 Word 图片）
async function parseOutlineToDB(text, images = []) {
  let currentTask = null;
  let currentChapter = null;
  let countT = 0, countC = 0, countP = 0;
  let imageIndex = 0; // 用于按顺序分配图片
  
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('# ')) {
      const name = line.replace(/^# /, '').trim();
      currentTask = store.createTask({ name });
      countT++;
      currentChapter = null;
    } 
    else if (line.startsWith('## ')) {
      const name = line.replace(/^## /, '').trim();
      if (!currentTask) {
        currentTask = store.createTask({ name: '默认导入任务' });
        countT++;
      }
      currentChapter = store.createChapter({ taskId: currentTask.id, name });
      countC++;
    } 
    else {
      if (!currentTask) {
        currentTask = store.createTask({ name: '默认导入任务' });
        countT++;
      }
      if (!currentChapter) {
        currentChapter = store.createChapter({ taskId: currentTask.id, name: '默认导入章节' });
        countC++;
      }
      
      const content = line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '');
      
      // 创建知识点
      const point = store.createPoint({ chapterId: currentChapter.id, content });
      countP++;

      // 👇 如果这篇文档含有图片，按顺序绑定给当前知识点
      if (images.length > imageIndex) {
        const imgBlob = images[imageIndex];
        
        // 存入 IndexedDB
        const imgId = crypto.randomUUID();
        const imgObj = new Image();
        imgObj.src = URL.createObjectURL(imgBlob);
        await new Promise(r => { imgObj.onload = r; imgObj.onerror = r; });
        
        await dbPut('images', {
          id: imgId,
          originalBlob: imgBlob,
          annotatedBlob: imgBlob,
          width: imgObj.width || 800,
          height: imgObj.height || 600,
          dpr: window.devicePixelRatio || 1,
          source: 'upload',
          createdAt: new Date().toISOString(),
        });

        // 更新知识点关联
        if (!point.imageIds) point.imageIds = [];
        point.imageIds.push(imgId);
        store.updatePoint(point.id, { imageIds: point.imageIds });
        
        imageIndex++;
      }
    }
  }
  return { countT, countC, countP };
}

// 👇 替换文件读取逻辑（支持读取 Word 文件图片）
function uploadFile(isOutline, targetChapterId = null) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,.md,.docx'; // 支持 Word
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      if (file.name.endsWith('.docx')) {
        if (!window.mammoth) {
          toastError('Word解析库(mammoth)未加载，请刷新页面');
          return;
        }
        
        toastSuccess('正在解析 Word 文档…');
        
        // 将 Word 转成 HTML
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.convertToHtml({ arrayBuffer }, {
          convertImage: window.mammoth.images.imgElement(function(image) {
            return image.read("base64").then(function(imageBuffer) {
              return {
                src: "data:" + image.contentType + ";base64," + imageBuffer
              };
            });
          })
        });
        
        const html = result.value;
        
        // 提取出所有的 Base64 图片
        const images = [];
        const imgRegex = /<img[^>]+src="data:image\/[^;]+;base64,([^"]+)"/g;
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
          // 把 base64 转成 Blob
          const byteCharacters = atob(match[1]);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/png' });
          images.push(blob);
        }

        // 把 HTML 里的图片标签清空，并用换行符分割文本
        let text = html.replace(/<img[^>]*>/g, '[此处有图片，已自动关联]');
        
        // 把 Word 的标题标签转为 # 号格式（如果是大纲导入）
        if (isOutline) {
          text = text.replace(/<h1[^>]*>(.*?)<\/h1>/g, '\n# $1\n')
                     .replace(/<h2[^>]*>(.*?)<\/h2>/g, '\n## $1\n')
                     .replace(/<h3[^>]*>(.*?)<\/h3>/g, '\n### $1\n');
        }
        
        // 去除所有 HTML 标签
        text = text.replace(/<[^>]+>/g, '');
        
        // 将连续的换行符合并，保证文本整齐
        text = text.replace(/\n\s*\n/g, '\n');

        if (isOutline) {
          const res = await parseOutlineToDB(text, images);
          toastSuccess(`成功导入 ${res.countT} 个任务，${res.countC} 个章节，${res.countP} 个知识点（含 ${images.length} 张图）`);
          location.reload();
        } else {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          lines.forEach(content => store.createPoint({ chapterId: targetChapterId, content }));
          toastSuccess(`成功导入 ${lines.length} 个知识点`);
        }

      } else {
        // 普通的 txt / md 处理
        const text = await file.text();
        if (isOutline) {
          const res = await parseOutlineToDB(text);
          toastSuccess(`成功导入 ${res.countT} 个任务，${res.countC} 个章节，${res.countP} 个知识点`);
          location.reload();
        } else {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length === 0) { toastError('文档为空'); return; }
          lines.forEach(content => store.createPoint({ chapterId: targetChapterId, content }));
          toastSuccess(`成功导入 ${lines.length} 个知识点`);
        }
      }
    } catch (err) {
      console.error(err);
      toastError('读取失败：' + err.message);
    }
  };
  fileInput.click();
}