import { el, clear } from '../utils/dom.js';
import { navigate } from '../router.js';

export function renderHelp() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '使用帮助';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate('#/');

  const wrap = el('div', { style: { maxWidth: '760px', margin: '0 auto' } });

  wrap.appendChild(el('div', { class: 'card', style: { cursor: 'default' } }, [
    el('div', { class: 'card-title', text: '📚 这是什么' }),
    el('div', { style: { fontSize: '14px', color: 'var(--text-2)', lineHeight: '1.8', marginTop: '8px' } }, [
      '资料复习系统是一个纯本地的背诵记录工具。所有数据保存在你当前浏览器的本地存储里，不上传服务器。',
      el('br'),
      '⚠️ 重要：清理浏览器缓存/网站数据会导致数据丢失，请定期在「设置 → 全量导出」备份。',
    ]),
  ]));

  const sections = [
    {
      title: '🗂 三层结构',
      items: [
        ['任务', '最外层，相当于一个文件夹，比如「行测常识」。点右下角 + 新建。'],
        ['章节', '中间层，比如「法律常识」。点进任务后新建。'],
        ['知识点', '最内层，每个知识点独立记录内容、解释、图片、录音。点进章节后新建。'],
      ],
    },
    {
      title: '✏️ 新建与编辑',
      items: [
        ['新建', '每层右下角都有 + 按钮。'],
        ['编辑', '卡片上的「编辑」按钮。'],
        ['自动保存', '编辑时输入内容会自动存草稿，误关弹窗、刷新页面都不会丢。重新打开会提示恢复草稿。'],
        ['合并', '点「☑ 批量」，勾选多个任务/章节，点「合并选中」。合并后源项进回收站，7 天内可恢复。'],
        ['排序', '长按卡片 300ms 拖动，或用卡片下方的 ↑ ↓ 按钮。'],
      ],
    },
    {
      title: '🎯 复习',
      items: [
        ['今日待复习', '首页顶部会提示今天有多少知识点到期。'],
        ['自测', '点底部「复习」→ 看到知识点 → 点「👁 显示答案」→ 自评三档（记得/模糊/忘了）。'],
        ['间隔算法', '忘了 → 明天再复习；模糊 → 间隔 ×1.5；记得 → 间隔 ×2.2。难度越高，间隔越短。'],
        ['易错标记', '知识点展开后点「标记易错」，在「复习 → 易错」里集中查看。'],
      ],
    },
    {
      title: '🖼 图片标注',
      items: [
        ['添加图片', '编辑知识点 → 「解释图片」→ 「📷 添加图片」，或直接 Ctrl+V 粘贴截图。'],
        ['进入标注', '点图片缩略图进入全屏标注页。'],
        ['工具栏', '画笔、橡皮、圈擦、文字、箭头、矩形、直线、波浪、胶带、纸张、抓手。'],
        ['缩放', '双指缩放，单指绘制。选「抓手」工具后单指平移。'],
        ['撤销', '最多 30 步。'],
        ['保存', '点「💾 保存」，笔迹会合并到图片。原图始终保留，可重新标注。'],
      ],
    },
    {
      title: '🎗️ 胶带与纸张',
      items: [
        ['胶带', '适合盖住一行答案。可选形状（圆头线/方头线/矩形/圆）、花样（纯色/波点/自定义）、宽度 8-80px。'],
        ['纸张', '适合盖住一段内容或做笔记。6 种样式：便签、便利贴、横线、方格、标签条、空白。可输入文字。'],
        ['显隐', '每块胶带/纸张可单独显示隐藏，也可「全部显示/隐藏」。'],
        ['擦除', '橡皮擦到胶带会擦掉该位置；纸张不按像素擦，选中后点「🗑 删除」。'],
      ],
    },
    {
      title: '🖼 图片合成',
      items: [
        ['入口', '知识点有 ≥2 张图片时，展开后点「🖼 合成图片」。'],
        ['样式', '纵向拼接、横向拼接、网格、A4 排版、拍立得墙、卡片列表。'],
        ['预览', '调参数时实时预览，确认后点「生成并保存」。'],
      ],
    },
    {
      title: '🔤 文字识别与 PDF',
      items: [
        ['OCR', '知识点展开 → 「🔤 提取文字」。从原图识别，需联网。识别结果可编辑后插入内容或解释。'],
        ['PDF 取页', '知识点展开 → 「📄 导入 PDF」→ 选 PDF 文件 → 选页码 → 自动导入并进入标注。'],
      ],
    },
    {
      title: '🎙 录音与语音',
      items: [
        ['录音', '编辑知识点 → 「🎙 口述背诵」→ 开始录音 → 停止并保存。可回放、删除。'],
        ['语音转文字', '内容/解释输入框旁的 🎤 按钮。Chrome/Edge 可用（需联网），Safari 不支持。'],
      ],
    },
    {
      title: '📤 导出',
      items: [
        ['格式', 'PDF（打印/阅读）、纯文本 .txt、Markdown .md、HTML、ZIP 完整归档。'],
        ['PDF', '点导出 → 选 PDF → 新标签页打开复习单 → 打印对话框里选「另存为 PDF」。'],
        ['粒度', '可导出单个知识点、整个章节、整个任务。'],
      ],
    },
    {
      title: '💾 备份与恢复',
      items: [
        ['全量导出', '设置 → 「📦 全量导出」，下载完整 zip（含所有图片、录音、胶带、纸张）。'],
        ['导入', '设置 → 「📥 导入备份」，选 zip 恢复。支持合并或覆盖。'],
        ['建议', '每 3~7 天备份一次，存到网盘或电脑。清浏览器缓存会导致数据丢失。'],
      ],
    },
    {
      title: '⌨️ 快捷键',
      items: [
        ['Ctrl + K', '打开搜索'],
        ['N', '首页按 N 新建任务'],
        ['Ctrl + Z', '标注页撤销'],
        ['Esc', '关闭弹窗'],
      ],
    },
    {
      title: '❓ 常见问题',
      items: [
        ['页面空白', '按 F12 看 Console 红色报错，通常是某个文件没加载。'],
        ['录音没声音', '检查设备音量、静音键，或插耳机测试。'],
        ['数据丢了', '如果没备份，无法恢复。这是纯本地存储的代价，务必定期备份。'],
        ['换设备', '数据不跨设备同步。用「全量导出」→ 在新设备「导入备份」。'],
      ],
    },
  ];

  sections.forEach(sec => {
    const card = el('div', { class: 'card', style: { cursor: 'default' } }, [
      el('div', { class: 'card-title', text: sec.title }),
      el('div', { style: { marginTop: '8px' } }, sec.items.map(([k, v]) =>
        el('div', { style: { fontSize: '14px', marginBottom: '8px', lineHeight: '1.7' } }, [
          el('span', { style: { fontWeight: '600', color: 'var(--primary-dark)' }, text: k + '：' }),
          el('span', { style: { color: 'var(--text-2)' }, text: v }),
        ])
      )),
    ]);
    wrap.appendChild(card);
  });

  wrap.appendChild(el('div', { style: { textAlign: 'center', fontSize: '12px', color: 'var(--text-2)', padding: '20px 0' } },
    ['资料复习系统 · 纯本地存储 · 请定期备份']));

  view.appendChild(wrap);
}