import { jsPDF } from 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.es.min.js';
import { toastSuccess } from '../ui/toast.js';

export function downloadPdfTemplate() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFontSize(18);
    doc.text('复习资料整理模板', 20, 20);
    doc.setFontSize(11);
    doc.text('说明：按以下格式整理，导入识别准确率更高。', 20, 30);
    doc.text('1. 每个章节用「## 章节：章节名」开头', 20, 40);
    doc.text('2. 每个知识点用「### 知识点：内容」开头', 20, 48);
    doc.text('3. 解释用「解释：」开头', 20, 56);
    doc.text('4. 空行分隔知识点', 20, 64);

    doc.setFontSize(14);
    doc.text('## 章节：法律常识', 20, 80);
    doc.setFontSize(12);
    doc.text('### 知识点：宪法是国家的根本法', 20, 92);
    doc.text('解释：宪法规定国家根本制度和根本任务...', 20, 100);

    doc.text('### 知识点：全国人民代表大会是最高权力机关', 20, 116);
    doc.text('解释：全国人民代表大会行使国家立法权...', 20, 124);

    doc.save('复习资料模板.pdf');
    toastSuccess('模板已下载');
}