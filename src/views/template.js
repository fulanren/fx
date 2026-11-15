import { el, clear } from '../utils/dom.js';
import { navigate } from '../router.js';
import { toastSuccess } from '../ui/toast.js';

export function renderTemplate() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '资料模板';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate('#/');

  const wrap = el('div', { style: { maxWidth: '760px', margin: '0 auto' } });

  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
    el('div', { class: 'card-title', text: '📋 资料整理模板' }),
    el('div', { style: { fontSize: '14px', color: 'var(--text-2)', lineHeight: '1.8', marginTop: '8px' } }, [
      '按以下格式整理资料，导入时网页能 100% 识别章节和知识点。',
      el('br'),
      '整理好后，在任务页点「📄 模板导入」，选文件即可自动创建章节和知识点。',
    ]),
  ]));

  // 模板格式说明
  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
    el('div', { class: 'card-title', text: '📝 模板格式' }),
    el('pre', {
      style: { background: 'var(--bg)', padding: '12px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.8', overflowX: 'auto', marginTop: '8px', whiteSpace: 'pre-wrap' },
      text: `## 章节：法律常识

### 知识点：宪法是国家的根本法
解释：宪法规定国家根本制度和根本任务，具有最高法律效力。

### 知识点：全国人民代表大会是最高权力机关
解释：全国人民代表大会行使国家立法权、决定权、任免权、监督权。

## 章节：行政法

### 知识点：行政许可的定义
解释：行政许可是指行政机关根据公民、法人或者其他组织的申请，经依法审查，准予其从事特定活动的行为。`,
    }),
  ]));

  // 说明
  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
    el('div', { class: 'card-title', text: '📌 格式规则' }),
    el('div', { style: { fontSize: '14px', lineHeight: '1.8', marginTop: '8px' } }, [
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '## 章节：' }),
        el('span', { text: ' 开头的是章节名，每个章节自动创建一个章节。' }),
      ]),
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '### 知识点：' }),
        el('span', { text: ' 开头的是知识点内容，每行生成一个知识点。' }),
      ]),
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '解释：' }),
        el('span', { text: ' 开头的是知识点的解释，可省略。' }),
      ]),
      el('div', { style: { marginBottom: '6px' } }, [
        el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: '空行' }),
        el('span', { text: ' 分隔不同知识点。' }),
      ]),
      el('div', { style: { color: 'var(--text-2)', fontSize: '13px', marginTop: '8px' } },
        ['支持的格式：.docx、.txt、文字版 PDF。扫描版 PDF 需要 OCR，不保证 100% 识别。']),
    ]),
  ]));

  // 下载按钮组
  wrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📥 下载 PDF 模板',
      onClick: () => downloadTemplate('pdf')
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📥 下载 Word 模板',
      onClick: () => downloadTemplate('doc')
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📥 下载 TXT 模板',
      onClick: () => downloadTemplate('txt')
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📋 复制模板',
      onClick: () => {
        navigator.clipboard.writeText(templateText()).then(() => toastSuccess('已复制'));
      },
    })
  ]));

  view.appendChild(wrap);
}

function templateText() {
  return `## 章节：法律常识

### 知识点：宪法是国家的根本法
解释：宪法规定国家根本制度和根本任务，具有最高法律效力。

### 知识点：全国人民代表大会是最高权力机关
解释：全国人民代表大会行使国家立法权、决定权、任免权、监督权。

## 章节：行政法

### 知识点：行政许可的定义
解释：行政许可是指行政机关根据公民、法人或者其他组织的申请，经依法审查，准予其从事特定活动的行为。

### 知识点：行政处罚的种类
解释：警告、罚款、没收违法所得、责令停产停业、暂扣或吊销许可证、行政拘留。
`;
}

// ============ 强大的模板下载工具 ============
async function downloadTemplate(format) {
  const content = `# 第一章 资料分析\n## 第一节 基础概念\n1. 增长率 = (现期 - 基期) / 基期\n2. 比重 = 部分 / 整体\n\n# 第二章 申论\n## 第一节 归纳概括\n- 问题：材料中反映了哪些问题？\n- 对策：提出解决这些问题的建议。`;

  let blob, filename, mimeType, ext;

  if (format === 'txt') {
    blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
    filename = '资料复习模板.txt'; ext = '.txt'; mimeType = 'text/plain';
  }
  else if (format === 'doc') {
    // 生成 Word 能识别的 HTML 格式，这样打开后就是有排版的 Word
    const docHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>资料复习模板</title></head><body><pre style="font-family: sans-serif; white-space: pre-wrap;">${content}</pre></body></html>`;
    blob = new Blob(['\uFEFF' + docHtml], { type: 'application/msword' });
    filename = '资料复习模板.doc'; ext = '.doc'; mimeType = 'application/msword';
  }
  else if (format === 'pdf') {
    // 生成一个极其精简的 HTML，让浏览器去打印为 PDF
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body { font-family: sans-serif; line-height: 1.6; padding: 20px; } h1, h2 { page-break-after: avoid; }</style></head><body><h1>资料复习模板</h1><pre style="white-space: pre-wrap; font-family: inherit;">${content}</pre></body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); }, 600);
    toastSuccess('请在弹出的打印窗口中选择“另存为 PDF”');
    return;
  }

  // 👇 核心：优先唤起系统“另存为”窗口，支持选择路径
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: '模板文件', accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toastSuccess('模板已保存到你选择的位置');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 用户取消了
      console.warn('原生另存为失败，降级为默认下载', err);
    }
  }

  // 降级方案：直接下载到默认文件夹
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
  toastSuccess('已开始下载（保存至默认下载目录）');
}