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

  container.appendChild(createSection('📚 1. 资料库与全能文件夹管理', `
    <div style="margin-bottom: 8px;"><b>👉 三层架构与树状树：</b><br>系统支持「文件夹 -> 子文件夹 -> 卡片」的无限极嵌套。在首页和侧边栏均以树状结构展示，点击小三角可以快速折叠或展开。</div>
    <div style="margin-bottom: 8px;"><b>👉 全能管理面板（管理模式）：</b><br>在首页点击顶部的「⚙️ 管理」按钮，即可进入文件夹的高级管理模式。此时每个文件夹左侧会出现勾选框，支持<b>全选、全不选、取消、批量删除</b>。</div>
    <div style="margin-bottom: 8px;"><b>👉 跨级复制与移动（杀手锏）：</b><br>在管理模式下，你可以一键「复制」或「移动」选中的文件夹。系统会弹出一个全能的归档面板，让你选择粘贴到<b>“当前层级”、“其他现有文件夹”、或“新建文件夹并归入”</b>。</div>
    <div style="margin-bottom: 8px;"><b>👉 散落卡片的特殊管理：</b><br>没有归属到任何文件夹的卡片会自动进入首页的“散落卡片”区。在这个区域点击「☑ 多选」，同样支持全选、复制、粘贴、移入指定文件夹以及批量删除。</div>
  `));

  container.appendChild(createSection('✍️ 2. 富文本编辑器与全能工具', `
    <div style="margin-bottom: 8px;"><b>👉 多格式混排：</b><br>在「文字解释」输入框中，你可以像用 Word 一样排版。支持加粗、斜体、下划线、调整字号、行距、对齐方式，以及文字变色和荧光笔高亮。</div>
    <div style="margin-bottom: 8px;"><b>👉 智能防护与提示：</b><br>当你点击工具栏修改格式时，系统会自动锁定你的选区，绝不会把已经选中的文字弄丢。并且在电脑或平板上长按工具栏图标，会弹出功能提示气泡。</div>
    <div style="margin-bottom: 8px;"><b>👉 高级双向链接：</b><br>在解释框里输入 <code>[[</code> 即可唤起全局检索，直接插入一张卡片或文件夹的跳转链接。点击链接可直达目标，长按链接可进行重置或删除。</div>
    <div style="margin-bottom: 8px;"><b>👉 公式与符号：</b><br>点击 <code>∑</code> 调出 KaTeX 公式面板，支持搜索、预览和收藏。插入的公式双击可重新编辑。工具栏还集成了常用标点符号和外置快捷输入组。</div>
  `));

  container.appendChild(createSection('🔍 3. 搜索与批量替换 (全局联动)', `
    <div style="margin-bottom: 8px;"><b>👉 悬浮搜索面板：</b><br>在编辑页面点击「🔍 搜索/替换」按钮，会弹出一个可拖拽的悬浮面板。</div>
    <div style="margin-bottom: 8px;"><b>👉 查找规则：</b><br>支持“当前内容”、“内容+解释”以及<b>“全局资料库”</b>三种搜索范围。支持“区分大小写”和“全词匹配”。甚至能穿透富文本标签，即使文字被加粗变色也能搜到。</div>
    <div style="margin-bottom: 8px;"><b>👉 替换与撤回：</b><br>点击“全部替换”会弹出二次确认框。面板左下角自带<b>“撤销/重做”</b>栈，如果替换错了，可以一键还原。在“全局资料库”模式下，能直接批量替换全站所有卡片里的文字。</div>
    <div style="margin-bottom: 8px;"><b>👉 历史记录管理：</b><br>搜索框下方会保存你最近搜过的词，点击即可快速填入。支持对历史记录进行展开/收起，以及全选删除。</div>
  `));

  container.appendChild(createSection('🖼️ 4. 附件、PDF 与多模态录入', `
    <div style="margin-bottom: 8px;"><b>👉 多源录入入口：</b><br>在“内容”和“文字解释”框的右侧都有一个 <code>📷</code> 按钮。点击它不仅支持拍照识别文字，还能<b>选相册图片</b>或<b>从 PDF 中选页提取</b>。系统会自动处理 OCR 并把图片和文字一并插入你的输入框。</div>
    <div style="margin-bottom: 8px;"><b>👉 图文附件管理：</b><br>支持批量上传、重名自动追加后缀、图片压缩、视图切换、批量移动、导出 ZIP、批量删除。</div>
    <div style="margin-bottom: 8px;"><b>👉 PDF 高级阅读器：</b><br>支持双指缩放、单双页切换、全屏。支持大纲与书签自动顺延页码。支持“框选截图”或“划词提取”。</div>
  `));

  container.appendChild(createSection('❗ 5. 错题本与沉浸式重练', `
    <div style="margin-bottom: 8px;"><b>👉 错题录入与分类：</b><br>进入侧边栏「错题本」，点击「➕ 新增错题」快速录入。在编辑卡片时可以设置错因（📚 知识盲区 / ✏️ 粗心大意），在错题本可按错因过滤。</div>
    <div style="margin-bottom: 8px;"><b>👉 错题本全能管理：</b><br>点击错题本顶部的「⚙️ 管理」，同样支持全选、批量删除、复制、粘贴到其他文件夹等全套批量操作。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式重练与间隔算法：</b><br>点击「🎯 开始重练」全屏展示题目。回忆后选择「😵 忘了」或「😎 记得并消除」。自评“记得”会拉长下次复习间隔；“忘了”则重置到 1 天。</div>
  `));

  container.appendChild(createSection('⏰ 6. 倒计时与侧边栏配置', `
    <div style="margin-bottom: 8px;"><b>👉 多考试倒计时：</b><br>去「考试倒计时」页面，可以添加多个考试目标。在列表里勾选「侧边栏显示」，它才会出现在侧边栏上。支持对倒计时进行批量管理。</div>
    <div style="margin-bottom: 8px;"><b>👉 界面个性化配置：</b><br>去「设置页」的「外观与侧边栏」中，可以自由选择“错题本”和“倒计时”在侧边栏的显示位置（顶部/中部/底部），以及倒计时的字体大小（小/中/大）。</div>
  `));

  container.appendChild(createSection('☁️ 7. 存储容量、数据安全与云同步', `
    <div style="margin-bottom: 8px;"><b>👉 数据安全与多标签页防冲突：</b><br>系统每天首次打开会自动生成快照。如果你在多个浏览器标签页同时打开系统，顶部会自动亮起红色警告条，防止数据相互覆盖。</div>
    <div style="margin-bottom: 8px;"><b>👉 一键清理废弃数据：</b><br>如果你删了卡片但发现存储空间没变小，去设置页点击「🧹 一键清理废弃图片」，系统会彻底扫描并物理删除所有没有关联到卡片的垃圾图片和 PDF。</div>
    <div style="margin-bottom: 8px;"><b>👉 WebDAV 云端同步：</b><br>在设置页最下方填入坚果云的账号。上传前会自动生成“安全快照”，下载前也支持选择恢复。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式全屏体验：</b><br>在平板浏览器中点击「分享」->「添加到主屏幕」。由于配置了 PWA 规范，打开后无地址栏、无底边，完全全屏。</div>
  `));

  container.appendChild(createSection('🎨 8. 沉浸式标注画板', `
    <div style="margin-bottom: 8px;"><b>👉 全功能笔刷：</b><br>支持圆珠笔、钢笔、毛笔、铅笔，拥有压感渲染和极细精度（0.01 级别）。</div>
    <div style="margin-bottom: 8px;"><b>👉 记忆胶带：</b><br>独立图层遮挡重点。点击胶带可以快速显隐；支持橡皮擦除并记录路径。支持自定义花样。</div>
    <div style="margin-bottom: 8px;"><b>👉 文字防退与扩展画布：</b><br>双击生成输入框时，底层画布会全局锁死，彻底解决打字光标闪退的 Bug。支持按像素向四周扩展白边。</div>
  `));

  container.appendChild(createSection('⌨️ 9. 快捷键与平板专属手势', `
    <div style="margin-bottom: 8px;">在电脑端，你可以使用以下快捷键提高效率：</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + K</code> / <code>/</code>：唤起全局搜索。</div>
    <div style="margin-bottom: 4px;"><code>N</code>：在文件夹下新建卡片。</div>
    <div style="margin-bottom: 4px;"><code>空格键</code>：复习时翻开答案。</div>
    <div style="margin-bottom: 4px;"><code>1 / 2 / 3</code>：极速自评。</div>
    <div style="margin-top: 12px;"><b>👉 平板的专属优化：</b><br>全局长按按钮 500ms 弹出功能名称。部分卡片支持左滑删除、右滑标星。输入框聚焦时自动躲避软键盘。</div>
  `));

  container.appendChild(createSection('📱 10. 全平台安装指南与数据迁移警告', `
    <div style="margin-bottom: 12px; color: var(--danger); font-weight: bold; font-size: 15px;">🚨 极其重要：数据安全与换浏览器须知</div>
    <div style="margin-bottom: 8px; background: rgba(239,71,111,0.08); padding: 10px; border-radius: 6px; border-left: 3px solid var(--danger);">
      本系统的所有数据（包括卡片、图片、PDF、录音）全部**100% 存储在你当前浏览器的本地沙盒中**（IndexedDB 和 localStorage）。
      <br><br>
      <b>1. 换浏览器的代价：</b>如果你用 Chrome 录入了数据，然后换用 Edge 浏览器打开，**数据是空的！** 因为不同浏览器的数据是完全隔离的。<br>
      <b>2. 换网址的代价：</b>如果你今天用 <code>xxx.github.io</code> 打开，明天换成了你买的新域名，浏览器会把它们当成两个不同的网站，**数据绝不互通！**<br>
      <b>3. 终极解决法：</b>在更换设备或浏览器之前，请务必去「设置」页点击 <b>「📦 导出数据」</b>，把 ZIP 备份包存到网盘或电脑里。到了新浏览器，再用「📥 导入备份」恢复即可！
    </div>

    <div style="margin-bottom: 8px; margin-top: 16px;"><b>👉 电脑端安装（Edge / Chrome）：</b><br>
    在地址栏的右侧，点击那个类似“电脑屏幕带向下箭头”的小图标（或者在浏览器右上角菜单里找“安装应用”），点击即可安装为独立的桌面 App，以后可以像微信一样在桌面双击打开。</div>

    <div style="margin-bottom: 8px;"><b>👉 iPad / iPhone 安装 (Safari 浏览器)：</b><br>
    苹果系统极其严格，必须使用自带的 <b>Safari 浏览器</b>。<br>
    1. 在 Safari 打开网址。<br>
    2. 点击顶部地址栏右侧的「分享」按钮（一个方框带向上的箭头）。<br>
    3. 往下滑，找到并点击 <b>「添加到主屏幕」</b>，然后点“添加”。<br>
    点开桌面的图标，就是全屏无地址栏的沉浸式体验。</div>

    <div style="margin-bottom: 8px;"><b>👉 安卓平板 / 手机安装（强烈推荐 Chrome）：</b><br>
    安卓系统碎片化严重，很多自带浏览器（如某些华为、小米自带浏览器，或夸克、百度 App）根本不支持真正的 PWA 安装，点了没反应或者只生成一个带网址的普通书签。<br>
    <b>💡 终极建议：</b>务必去应用商店下载一个 <b>Google Chrome 浏览器</b>。<br>
    1. 用 Chrome 打开网址。<br>
    2. 点击右上角三个点 <code>⋮</code>。<br>
    3. 选择 <b>「安装应用」</b> 或 <b>「添加到主屏幕」</b>。<br>
    Chrome 的兼容性是目前全世界最好的，保证一键安装，全屏独立运行！<br>
    <i>(注：如果你用的是安卓版 Edge，它在平板上经常出 Bug，点了“安装”会没反应，建议直接放弃 Edge 换 Chrome。)</i></div>

    <div style="margin-bottom: 8px;"><b>👉 为什么点安装“没反应”？</b><br>
    如果你之前装过旧版本，或者点了没反应，请去浏览器设置里 <b>清除该网站的缓存和 Cookie</b>。如果依然不行，请打开浏览器的 <b>无痕模式 / 隐私模式</b>，输入网址再点安装。无痕模式没有缓存干扰，100% 能测出到底能不能装。</div>
        <div style="margin-bottom: 8px; margin-top: 16px; border-top: 1px dashed rgba(0,0,0,.1); padding-top: 16px;">
      <b>👉 安装好了，但是“下载”列表里为什么找不到？</b><br>
      <span style="color: var(--danger);">这是一个常见的误区：PWA 应用不是普通的安装包（像 APK 或 EXE），它不需要“下载”。</span>
      当你点击“添加到主屏幕”时，浏览器只是把当前的“网址”和“图标”打包成了一个快捷方式。
      所以，<b>去浏览器的“下载记录”里是绝对找不到它的！</b> 所有的系统代码都是在您点击图标的那一瞬间，由浏览器实时加载的。
    </div>

    <div style="margin-bottom: 8px;">
      <b>👉 那到底去哪里找？</b><br>
      1. 去平板的<b>系统桌面</b>向左或向右滑，或者打开平板底部的<b>“所有应用 / 应用抽屉”</b>。<br>
      2. 有些平板（如华为、小米）会自动把它放进一个叫“浏览器快捷方式”或“推荐应用”的系统文件夹里。仔细找找名为“资料复习”或带有您自定义图标的按钮。
    </div>

    <div style="margin-bottom: 8px;">
      <b>👉 如何判断它是不是真正的独立 App？</b><br>
      去桌面点击打开那个新建的图标：<br>
      - <b>如果是真的 PWA App：</b>打开后，顶部<b>没有</b>浏览器的地址栏、没有底部的浏览器黑边、没有任何多余按钮，直接全屏展示你的系统。<br>
      - <b>如果只是普通书签快捷方式：</b>打开后，顶部依然有网址栏。这说明你用的这款平板自带浏览器阉割了 PWA 全屏功能。<br>
      <i>(这也是为什么强烈推荐用 Google Chrome 的原因！)</i>
    </div>
  `));

  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习系统 · 祝你早日上岸' }));
  
}