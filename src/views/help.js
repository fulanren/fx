import { el, clear } from '../utils/dom.js';

export function renderHelp() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '❓ 帮助中心';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => history.back();

  view.style.padding = '16px';
  view.style.display = 'block';
  view.style.overflowY = 'auto';

  const container = el('div', { style: { width: '100%', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '10px' } });
  view.appendChild(container);

  container.appendChild(el('h2', { text: '📖 资料复习系统 - 终极操作手册', style: { textAlign: 'center', marginBottom: '4px', color: 'var(--primary-dark)', fontSize: '20px' } }));

  // ================= 核心折叠面板生成器 =================
  function createSection(title, htmlContent) {
    let isOpen = false;

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = htmlContent;
    contentDiv.style.display = 'none';
    contentDiv.style.padding = '12px 16px';
    contentDiv.style.fontSize = '14px';
    contentDiv.style.lineHeight = '1.8';
    contentDiv.style.color = 'var(--text-2)';
    contentDiv.style.borderTop = '1px solid rgba(0,0,0,.05)';
    contentDiv.style.overflowWrap = 'break-word';

    const arrow = el('span', { text: '▸', style: { color: 'var(--text-2)', fontSize: '12px', transition: 'transform 0.2s' } });

    const header = el('div', {
      style: { padding: '12px 16px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      onClick: () => {
        isOpen = !isOpen;
        contentDiv.style.display = isOpen ? 'block' : 'none';
        arrow.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
      }
    }, [
      el('span', { text: title }),
      arrow
    ]);

    return el('div', {
      style: { background: 'var(--card)', borderRadius: '8px', boxShadow: 'var(--shadow)', overflow: 'hidden', marginBottom: '8px' }
    }, [header, contentDiv]);
  }

  // ================= 插入内容 =================

  container.appendChild(createSection('📚 1. 极简架构与多维标签体系', `
    <div style="margin-bottom: 8px;"><b>👉 扁平化收纳：</b><br>系统采用「文件夹 -> 卡片」的极简结构。点击文件夹直接进入卡片列表，内部自动建立隐藏模块保证数据不断裂，彻底告别臃肿的子模块列表。</div>
    <div style="margin-bottom: 8px;"><b>👉 文件夹标签（管理面板）：</b><br>在文件夹列表点击「🏷️」图标，可以进入多层级标签管理。左侧标签列表支持折叠，可以管理预设颜色、自定义颜色，同时汇聚了子文件夹和当前文件夹下所有卡片的标签（带 <code>[子]</code> 和 <code>[卡]</code> 标识）。</div>
    <div style="margin-bottom: 8px;"><b>👉 卡片专属标签（独立管理）：</b><br>在每张卡片右下角点击「🏷️」图标，可以给这张卡片单独打标签。卡片标签支持富文本、字体颜色/背景/边框调节，并且拥有独立的收藏颜色管理功能。输入框的<b>第一个中文字符</b>也能完美实时变色，退格键毫无卡顿。</div>
  `));

  container.appendChild(createSection('🎨 2. 超强富文本与编辑工具', `
    <div style="margin-bottom: 8px;"><b>👉 富文本混排：</b><br>在「文字解释」输入框中，支持加粗、斜体、下划线、调整字号、行距、对齐方式，以及文字变色和高亮荧光笔。支持无级调节透明色。</div>
    <div style="margin-bottom: 8px;"><b>👉 🔍 全局搜索与批量替换：</b><br>在编辑页面点击「🔍 搜索/替换」按钮，不仅能高亮当前卡片内匹配的文字，还支持<b>「全局资料库搜索」</b>，能瞬间扫描出你所有卡片中包含该词的记录。支持区分大小写和全词匹配。</div>
    <div style="margin-bottom: 8px;"><b>👉 公式编辑器：</b><br>点击 <code>∑</code> 按钮可调出公式面板，内置了微积分、线代、物理等常用公式，插入的公式自动渲染成公式块，双击可重新编辑。</div>
    <div style="margin-bottom: 8px;"><b>👉 快捷输入组：</b><br>工具栏集成了「常用字」和「外置快捷键」，可自由添加常用数学符号、标点。外置的快捷键会以微型按钮常驻在输入框上方，随点随插，并自带当前选中的颜色。</div>
  `));

  container.appendChild(createSection('🖼️ 3. 图文附件、PDF与音频', `
    <div style="margin-bottom: 8px;"><b>👉 拍照/相册识别（OCR）：</b><br>在「内容」和「文字解释」右侧都有 <code>📷</code> 按钮。支持拍照或选图，系统会在本地离线提取图片中的文字并自动填入输入框。</div>
    <div style="margin-bottom: 8px;"><b>👉 批量上传与重名保护：</b><br>支持多选上传。如果传了同名文件，系统会自动追加 <code>(1)</code>、<code>(2)</code> 后缀。</div>
    <div style="margin-bottom: 8px;"><b>👉 PDF 高级阅读与标注：</b><br>点击 PDF 文件可以打开专属阅读器。支持双指缩放、翻页、添加书签、自动识别大纲。支持划词 OCR 提取和框选截图。插入新页后，大纲和书签页码会自动顺延。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式画板：</b><br>双击图片进入画板。支持圆珠笔、钢笔、毛笔等多种笔刷。包含可点击隐藏的记忆胶带、扩展画布、多图层文字和纸张。自动保存历史版本，可随时回滚。</div>
  `));

  container.appendChild(createSection('❗ 4. 错题本与复习闭环', `
    <div style="margin-bottom: 8px;"><b>👉 错题录入与分类：</b><br>进入侧边栏「错题本」，可以点击「➕ 新增错题」快速录入。在编辑卡片时，可以设置错因（📚 知识盲区 / ✏️ 粗心大意），在错题本页面可以按错因过滤。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式重练：</b><br>点击「🎯 开始重练」，系统会全屏展示题目。回忆后点「显示解析」，最后选择「😵 忘了」或「😎 记得并消除」。</div>
    <div style="margin-bottom: 8px;"><b>👉 间隔重复算法（SM-2）：</b><br>自评「记得」会拉长下次复习间隔；「忘了」则直接重置到 1 天。系统自动根据难记度进行加权修正。</div>
  `));

  container.appendChild(createSection('☁️ 5. 数据安全与全平台同步', `
    <div style="margin-bottom: 8px;"><b>👉 每日自动快照与防冲突：</b><br>系统每天首次打开会自动快照。多标签页打开时会有红条警告。请勿在两个标签页同时编辑同一条卡片。</div>
    <div style="margin-bottom: 8px;"><b>👉 一键清理废弃数据：</b><br>删除了卡片，但空间没变小？去设置页点击「🧹 一键清理废弃图片」，系统会彻底删掉所有没有关联到卡片的孤儿图片和音频。</div>
    <div style="margin-bottom: 8px;"><b>👉 WebDAV 云同步：</b><br>在设置页最下方，填入坚果云账号。上传前会自动生成“安全快照”，下载前支持选择恢复。</div>
    <div style="margin-bottom: 8px;"><b>👉 PWA 全屏沉浸体验：</b><br>在 iPad Safari 中打开网页，点击「分享」->「添加到主屏幕」。打开后无地址栏、无底边，完全全屏。</div>
  `));

  container.appendChild(createSection('⌨️ 6. 极客快捷键与手势', `
    <div style="margin-bottom: 8px;">在电脑端，你可以完全脱离鼠标：</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + K</code> / <code>/</code>：全局搜索。</div>
    <div style="margin-bottom: 4px;"><code>N</code>：在当前文件夹下新建卡片。</div>
    <div style="margin-bottom: 4px;"><code>空格键</code>：复习时翻开答案。</div>
    <div style="margin-bottom: 4px;"><code>1 / 2 / 3</code>：极速自评（忘了 / 模糊 / 记得）。</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + Z</code>：画板内撤销操作。</div>
    <div style="margin-top: 12px;"><b>👉 平板的专属优化：</b><br>在画板、知识卡片、文件夹管理中均支持<b>长按 500ms 弹出功能提示气泡</b>。部分卡片支持左滑删除、右滑标星。</div>
  `));

  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习系统 · 祝你早日上岸' }));
}