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

  container.appendChild(createSection('📚 1. 资料库与层级管理', `
    <div style="margin-bottom: 8px;"><b>👉 三层结构是怎么回事？</b><br>本系统采用「任务（文件夹） -> 章节（子模块） -> 知识点（卡片）」的三层架构。如果你直接建了一个文件夹，系统会在后台自动建一个不可见的「占位子模块」，你正常用就行，它不会干扰你。</div>
    <div style="margin-bottom: 8px;"><b>👉 如何新建大文件夹？</b><br>在首页点击右下角蓝色的 <code>+</code> 按钮，输入名称即可。侧边栏也会同步刷新。</div>
    <div style="margin-bottom: 8px;"><b>👉 拖拽排序与移动：</b><br>按住任何大文件夹或卡片，都可以直接上下拖拽改变排序。如果你想改变卡片所属的文件夹，可以在侧边栏拖动它，或者在编辑卡片时点击「📁 归属文件夹」进行切换。</div>
    <div style="margin-bottom: 8px;"><b>👉 侧边栏折叠：</b><br>点击侧边栏大文件夹左侧的 <code>▸</code> 箭头，可以一键折叠它下面的所有内容。如果你文件夹太多，这个功能能救命。</div>
  `));

  // 富文本编辑器专属说明
  container.appendChild(createSection('✍️ 2. 富文本编辑器 (文字解释)', `
    <div style="margin-bottom: 8px;"><b>👉 多格式混排：</b><br>在「文字解释」输入框中，你可以像用 Word 一样排版。选中一段文字，点击上方工具栏的 <code>T</code> 图标可以精准调整字号，点击 <code>↕</code> 图标可以调整行距。</div>
    <div style="margin-bottom: 8px;"><b>👉 颜色与高亮：</b><br>工具栏自带了加粗 (<code>B</code>)、斜体 (<code>I</code>)、下划线 (<code>U</code>)，以及一键高亮 (<code>✨</code>) 和文字变色 (<code>🎨</code>)。你可以用荧光笔快速划重点。</div>
    <div style="margin-bottom: 8px;"><b>👉 智能防护（防误触）：</b><br>当你点击工具栏按钮时，系统会自动锁定你的选区，绝不会把已经选中的文字弄丢。即使粘贴网页内容，也会自动洗掉乱七八糟的格式，保持页面整洁。</div>
  `));

  container.appendChild(createSection('🖼️ 3. 图文附件与万能文件管理', `
    <div style="margin-bottom: 8px;"><b>👉 拍照与相册识别（OCR）：</b><br>在「内容」和「文字解释」输入框的右侧，都有一个 <code>📷</code> 按钮。点击它，你可以选择<b>「直接拍照」</b>或<b>「从相册/文件选图」</b>。系统会在本地离线提取图片中的文字，并自动填入输入框。</div>
    <div style="margin-bottom: 8px;"><b>👉 语音输入：</b><br>电脑端的输入框右侧有一个 <code>🎤</code> 麦克风按钮，支持浏览器原生语音转文字（需联网）。</div>
    <div style="margin-bottom: 8px;"><b>👉 上传与重名保护：</b><br>在「图文附件」区域点「+ 加图片」或「+ 加 PDF」。如果你传了两张都叫 <code>1.pdf</code> 的文件，系统会自动加上 <code>(1).pdf</code> 后缀。</div>
    <div style="margin-bottom: 8px;"><b>👉 三种视图模式：</b><br>顶部三个小按钮可以切换视图：<code>🖼 图文模式</code>、<code>▦ 纯缩略图</code>、<code>📄 列表模式</code>。</div>
    <div style="margin-bottom: 8px;"><b>👉 批量操作的魔法：</b><br>点击「☑ 多选」，勾选多个文件后，可以批量移动、打包导出 ZIP、或者一键删除。</div>
  `));

  container.appendChild(createSection('❗ 4. 错题本与复习闭环', `
    <div style="margin-bottom: 8px;"><b>👉 如何录入错题？</b><br>直接进侧边栏的「错题本」，点击左上角的「➕ 新增错题」，填入题目和解析。系统会自动把它放进错题收集箱，并打上红色标记。</div>
    <div style="margin-bottom: 8px;"><b>👉 错因分类：</b><br>在编辑卡片时，找到「复习设置」，在错因下拉框里可以选择「📚 知识盲区」或「✏️ 粗心大意」，方便你日后在错题本里按原因过滤。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式重练：</b><br>点击「🎯 开始重练」，系统会全屏展示题目，你可以先自己回忆，点「显示解析」对答案，最后选「忘了」或「记得并消除」。</div>
    <div style="margin-bottom: 8px;"><b>👉 间隔重复算法：</b><br>系统用的是简化版 SM-2 算法。你点「记得」就会拉长复习间隔，点「忘了」就会被打回原形（明天再背）。</div>
  `));

  container.appendChild(createSection('📄 5. PDF 高级阅读器（杀手锏）', `
    <div style="margin-bottom: 8px;"><b>👉 基础阅读：</b><br>支持双指缩放、鼠标滚轮缩放。单击页面选中，双击页面直接进入标注画板。左右侧有悬浮的翻页按钮。</div>
    <div style="margin-bottom: 8px;"><b>👉 插入新页面：</b><br>点击顶部的 <code>➕</code>，可以插入空白纸、横线纸、方格纸、申论答题卡。自定义横线间距和页面留白。插入后会自动跳到新插入的页面。</div>
    <div style="margin-bottom: 8px;"><b>👉 大纲与书签：</b><br>顶部 <code>📋</code> 是大纲，支持自动识别 PDF 目录。顶部 <code>📑</code> 是书签。插入新页后，大纲和书签的页码会自动顺延。</div>
    <div style="margin-bottom: 8px;"><b>👉 划词提取与截图：</b><br>点击顶部 <code>🔤</code>，在 PDF 上拖拽一个框，系统会自动识别里面的文字；点击 <code>✂️</code> 可以框选并保存为图片附件。</div>
  `));

  container.appendChild(createSection('🎨 6. 沉浸式标注画板', `
    <div style="margin-bottom: 8px;"><b>👉 多种笔刷自由切换：</b><br>在画笔工具下，点击右侧的「🎨」面板，你可以切换 圆珠笔、钢笔、毛笔、铅笔。毛笔会有压感渲染。</div>
    <div style="margin-bottom: 8px;"><b>👉 粗细与颜色：</b><br>支持滑块微调，还可以直接输入数字（可精确到 0.01 极细线）。</div>
    <div style="margin-bottom: 8px;"><b>👉 记忆胶带：</b><br>如果有些重点需要遮挡，选「胶带」工具画一块。点击胶带可以随时隐藏或显示；用橡皮擦擦开一个小口子，它就会永久记住这个擦除路径。</div>
    <div style="margin-bottom: 8px;"><b>👉 扩展画布：</b><br>点击顶部的「➕ 扩展画布」，选择方向并输入像素，可以在原图周围扩大一圈白边，且原图不会被拉变形。</div>
  `));

  // 数据安全细节说明
  container.appendChild(createSection('☁️ 7. 数据安全与隐藏机制', `
    <div style="margin-bottom: 8px;"><b>👉 每日自动快照：</b><br>系统每天在你打开时，会自动把数据打包存一份在本地。如果手滑删了核心数据，可以在控制台找回今日快照。</div>
    <div style="margin-bottom: 8px;"><b>👉 多标签页防冲突：</b><br>如果你在电脑上不小心开了两个标签页，系统会弹红条警告你，防止两边同时修改导致数据互相覆盖。</div>
    <div style="margin-bottom: 8px;"><b>👉 一键清理废弃图片：</b><br>如果你删了很多卡片，空间没变小，去设置页点击「🧹 一键清理废弃图片」，系统会彻底删除孤儿图片。</div>
    <div style="margin-bottom: 8px;"><b>👉 WebDAV 云同步：</b><br>在设置页最下方，填入坚果云账号。下载前会自动生成“安全快照”。</div>
  `));

  container.appendChild(createSection('📱 8. 平板 PWA 原生全屏体验指南', `
    <div style="margin-bottom: 8px;"><b>第一步：</b>在 iPad 或手机的 Safari 浏览器中，打开你部署好的网址。</div>
    <div style="margin-bottom: 8px;"><b>第二步：</b>点击顶部地址栏旁边的「分享」按钮。</div>
    <div style="margin-bottom: 8px;"><b>第三步：</b>下拉菜单，找到并点击「添加到主屏幕」。</div>
    <div style="margin-bottom: 8px;"><b>第四步：</b>回到桌面，点击新生成的图标。你将获得：**无地址栏、无底边、全屏沉浸、断网秒开**的体验！</div>
  `));

  container.appendChild(createSection('⌨️ 9. 键盘极客快捷键', `
    <div style="margin-bottom: 8px;">在电脑端，你可以完全脱离鼠标：</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + K</code> / <code>/</code>：随时唤起全局搜索。</div>
    <div style="margin-bottom: 4px;"><code>N</code>：在章节页一键新建知识点卡片。</div>
    <div style="margin-bottom: 4px;"><code>空格键</code>：在复习卡片中，按空格快速翻开答案。</div>
    <div style="margin-bottom: 4px;"><code>1 / 2 / 3</code>：在复习或错题重练时，按 1（忘了）、2（模糊）、3（记得）。</div>
  `));

  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习系统 · 祝你早日上岸' }));
}