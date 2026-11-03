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

  // 下载按钮
  wrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
    el('button', {
      class: 'btn btn-primary', text: '📥 下载模板（.docx）',
      onClick: async () => {
        try {
          const blob = new Blob([templateText()], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = '考公复习资料模板.txt';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toastSuccess('模板已下载，用 Word 打开另存为 .docx 即可');
        } catch (e) { toastSuccess('下载失败'); }
      },
    }),
    el('button', {
      class: 'btn btn-ghost', text: '📋 复制模板',
      onClick: () => {
        navigator.clipboard.writeText(templateText()).then(() => toastSuccess('已复制'));
      },
    }),
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