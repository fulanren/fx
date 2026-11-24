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
    <div style="margin-bottom: 8px;"><b>👉 无限层级的树状结构：</b><br>系统支持「文件夹 -> 子文件夹 -> 卡片」的无限极嵌套。在首页、侧边栏均以树状展示，点击小三角可快速折叠或展开。</div>
    <div style="margin-bottom: 8px;"><b>👉 全能管理面板（批量操作）：</b><br>在首页点击顶部的「⚙️ 管理」按钮，进入文件夹的高级管理模式。此时每个文件夹左侧会出现勾选框，支持<b>全选、全不选、批量删除</b>。</div>
    <div style="margin-bottom: 8px;"><b>👉 跨级复制与移动（杀手锏）：</b><br>在管理模式下，一键「复制」或「移动」选中的文件夹。系统会弹出全能归档面板，让你选择粘贴到<b>“当前层级”、“其他现有文件夹”、或“新建文件夹并归入”</b>。</div>
    <div style="margin-bottom: 8px;"><b>👉 散落卡片特殊管理：</b><br>无归属的卡片进入首页“散落卡片”区。点击「☑ 多选」同样支持全选、复制、粘贴、移入指定文件夹及批量删除。</div>
  `));

  container.appendChild(createSection('✍️ 2. 富文本编辑器与高级工具', `
    <div style="margin-bottom: 8px;"><b>👉 多格式混排：</b><br>在「文字解释」输入框中，支持加粗、斜体、下划线、无级调字号、行距、对齐方式，以及文字变色和荧光笔高亮。</div>
    <div style="margin-bottom: 8px;"><b>👉 防退防闪退机制：</b><br>点击工具栏修改格式时，系统会自动锁定你的文字选区，绝不丢失；双击输入文字时，底层画布全局锁死，彻底杜绝打字光标闪退。</div>
    <div style="margin-bottom: 8px;"><b>👉 高级双向链接：</b><br>在解释框里输入 <code>[[</code> 即可唤起全局检索，直接插入一张卡片或文件夹的跳转链接。点击链接可直达，长按链接可重置或删除。</div>
    <div style="margin-bottom: 8px;"><b>👉 数学公式与符号：</b><br>点击 <code>∑</code> 调出 KaTeX 公式面板，支持搜索、预览和收藏。插入的公式双击可重新编辑。工具栏集成了常用标点符号和外置快捷输入组。</div>
  `));

  container.appendChild(createSection('🔍 3. 搜索与批量替换 (全局联动)', `
    <div style="margin-bottom: 8px;"><b>👉 悬浮搜索面板：</b><br>在编辑页面点击「🔍 搜索/替换」按钮，会弹出一个可拖拽的悬浮面板。</div>
    <div style="margin-bottom: 8px;"><b>👉 查找规则：</b><br>支持“当前内容”、“内容+解释”以及<b>“全局资料库”</b>三种范围。支持区分大小写和全词匹配。甚至能穿透富文本标签，即使文字被加粗变色也能精准搜到。</div>
    <div style="margin-bottom: 8px;"><b>👉 替换与撤销：</b><br>点击“全部替换”会二次确认。面板左下角自带<b>“撤销/重做”</b>栈，替换错了可一键还原。在“全局资料库”模式下，能直接批量替换全站所有卡片里的文字。</div>
    <div style="margin-bottom: 8px;"><b>👉 历史记录管理：</b><br>搜索框下方保留最近搜词，点击快速填入。支持展开/收起，以及全选删除。</div>
  `));

  container.appendChild(createSection('🖼️ 4. 附件、PDF 与多模态录入', `
    <div style="margin-bottom: 8px;"><b>👉 多源极速录入：</b><br>点击输入框右侧的 <code>📷</code>，支持<b>拍照识别</b>、<b>选相册图</b>、或<b>从 PDF 选页提取</b>。系统自动 OCR 提取文字并插入输入框。</div>
    <div style="margin-bottom: 8px;"><b>👉 图文附件管理：</b><br>支持批量上传、重名自动加后缀、图片自动压缩、视图切换、批量移动、导出 ZIP、批量删除。</div>
    <div style="margin-bottom: 8px;"><b>👉 PDF 高级阅读：</b><br>支持双指缩放、单双页、全屏。支持大纲与书签自动顺延页码。支持框选截图、划词提取、插入新页面（横线/方格/答题卡）。</div>
  `));

  container.appendChild(createSection('❗ 5. 错题本与沉浸式重练', `
    <div style="margin-bottom: 8px;"><b>👉 错题录入与分类：</b><br>点击「➕ 新增错题」快速录入。编辑卡片时可设置错因（📚 知识盲区 / ✏️ 粗心大意），错题本支持按错因过滤。</div>
    <div style="margin-bottom: 8px;"><b>👉 错题本全能管理：</b><br>点击「⚙️ 管理」，支持全选、批量删除、复制、粘贴到其他文件夹等全套操作。</div>
    <div style="margin-bottom: 8px;"><b>👉 间隔算法：</b><br>点击「🎯 开始重练」全屏展示题目。自评“记得”拉长下次复习间隔；“忘了”则重置到 1 天。</div>
  `));

  container.appendChild(createSection('⏰ 6. 倒计时与侧边栏配置', `
    <div style="margin-bottom: 8px;"><b>👉 多考试倒计时：</b><br>去「考试倒计时」页面添加多个目标。在列表里勾选「侧边栏显示」才会出现在侧边栏上。支持批量管理。</div>
    <div style="margin-bottom: 8px;"><b>👉 界面个性化：</b><br>去「设置」的「外观与侧边栏」中，可自由选择“错题本”和“倒计时”在侧边栏的显示位置（顶部/中部/底部），以及倒计时的字体大小。</div>
  `));

  container.appendChild(createSection('☁️ 7. 存储容量、数据安全与云同步', `
    <div style="margin-bottom: 8px;"><b>👉 存储限制与 PWA 突破（重要）：</b><br>电脑端通常可用 60% 硬盘空间；安卓/iPad 端由于系统限制，普通网页模式通常被锁在 <b>10GB 左右</b>。若想在平板突破限制，请将网页“添加到主屏幕”并以 PWA App 模式打开。<b>实在不够用时，请定期用「导出数据」存网盘，并清理本地空间。</b></div>
    <div style="margin-bottom: 8px;"><b>👉 一键瘦身：</b><br>去设置页点击「🧹 一键清理废弃图片」，系统会物理删除无关联的孤儿图片和 PDF。</div>
    <div style="margin-bottom: 8px;"><b>👉 WebDAV 云同步：</b><br>设置页最下方填入坚果云账号。上传前自动生成“安全快照”，下载前支持恢复。</div>
    <div style="margin-bottom: 8px;"><b>👉 多标签页防冲突：</b><br>多标签页打开系统会亮红条警告，防止数据覆盖。每日首次打开会自动生成快照。</div>
  `));

  container.appendChild(createSection('🎨 8. 沉浸式标注画板', `
    <div style="margin-bottom: 8px;"><b>👉 全功能笔刷：</b><br>支持圆珠笔、钢笔、毛笔、铅笔（0.01 极细精度），压感渲染极佳。</div>
    <div style="margin-bottom: 8px;"><b>👉 记忆胶带与图层：</b><br>独立图层遮挡重点。点击胶带可快速显隐；橡皮擦除自动记录路径。支持自定义花样和图层顺序调整。</div>
    <div style="margin-bottom: 8px;"><b>👉 扩展画布：</b><br>支持按像素向四周扩展白边，原图居中不变形，不覆盖原有笔记。</div>
  `));

  container.appendChild(createSection('⌨️ 9. 极客快捷键与平板手势', `
    <div style="margin-bottom: 8px;">在电脑端，你可以完全脱离鼠标：</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + K</code> / <code>/</code>：唤起全局搜索。</div>
    <div style="margin-bottom: 4px;"><code>N</code>：在文件夹下新建卡片。</div>
    <div style="margin-bottom: 4px;"><code>空格键</code>：复习时翻开答案。</div>
    <div style="margin-bottom: 4px;"><code>1 / 2 / 3</code>：极速自评。</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + Z</code>：画板内撤销操作。</div>
    <div style="margin-top: 12px;"><b>👉 平板专属手势：</b><br>全局长按任意按钮 500ms 弹出气泡提示；部分卡片支持左滑删除、右滑标星；输入框聚焦时自动躲避软键盘。</div>
  `));

  container.appendChild(createSection('📱 10. 全平台安装指南与数据迁移警告', `
    <div style="margin-bottom: 12px; color: var(--danger); font-weight: bold; font-size: 15px;">🚨 极其重要：数据安全与换浏览器须知</div>
    <div style="margin-bottom: 8px; background: rgba(239,71,111,0.08); padding: 10px; border-radius: 6px; border-left: 3px solid var(--danger);">
      本系统的所有数据（卡片、图片、PDF、录音）全部**100% 存储在你当前浏览器的本地沙盒中**（IndexedDB 和 localStorage）。
      <br><br>
      <b>1. 换浏览器的代价：</b>如果你用 Chrome 录入了数据，然后换用 Edge 浏览器打开，**数据是空的！** 因为不同浏览器的数据完全隔离。<br>
      <b>2. 换网址的代价：</b>如果你今天用 <code>xxx.github.io</code> 打开，明天换成了新域名，浏览器会把它们当成两个不同的网站，**数据绝不互通！**<br>
      <b>3. 终极解决法：</b>在更换设备或浏览器之前，务必去「设置」页点击 <b>「📦 导出数据」</b>，把 ZIP 备份包存到网盘或电脑里。到了新浏览器，再用「📥 导入备份」恢复即可！
    </div>

    <div style="margin-bottom: 8px; margin-top: 16px;"><b>👉 电脑端安装（Edge / Chrome）：</b><br>
    在地址栏右侧点击类似“电脑屏幕带向下箭头”的小图标（或在右上角菜单里找“安装应用”），即可安装为独立桌面 App，以后像微信一样双击打开。</div>

    <div style="margin-bottom: 8px;"><b>👉 iPad / iPhone 安装 (Safari 浏览器)：</b><br>
    苹果系统极其严格，必须用自带的 <b>Safari 浏览器</b>。<br>
    1. 在 Safari 打开网址。<br>
    2. 点击顶部地址栏右侧的「分享」按钮（方框带向上箭头）。<br>
    3. 往下滑，找到并点击 <b>「添加到主屏幕」</b>，然后点“添加”。<br>
    点开桌面图标，就是全屏无地址栏的沉浸式体验。</div>

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
      当你点击“添加到主屏幕”时，浏览器只是把当前的“网址”和“图标”打包成了一个快捷方式。所以，<b>去浏览器的“下载记录”里是绝对找不到它的！</b> 所有的系统代码都是在您点击图标的那一瞬间，由浏览器实时加载的。
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

    container.appendChild(createSection('⚙️ 11. PDF 高级设置与加载优化', `
    <div style="margin-bottom: 8px;"><b>👉 导入 PDF 时的画质选择（重要）：</b><br>当你点击「加 PDF」或「导入 PDF」时，选页框顶部会出现画质选择按钮：<br>
    - <b>超清 (2.0x)</b>：适合电脑端查看细节。<br>
    - <b>高清 (1.5x)</b>：推荐画质。<br>
    - <b>标准 (1.0x)</b>：适合日常使用。<br>
    - <b>流畅 (0.8x)</b>：<b style="color:var(--danger)">平板强烈推荐！</b>体积只有 1/4，极大减少卡顿。<br>
    选择不同的画质，系统会按对应比例渲染 Canvas 并存入 IndexedDB。画质越低，占用存储和内存越小。</div>

    <div style="margin-bottom: 8px;"><b>👉 导入 PDF 提取文字的加速技巧：</b><br>如果你的 PDF 是为了直接提取文字生成知识点（模板导入），而不是为了原样保留页面截图，系统会使用 <code>0.8</code> 的低比例来渲染画布，仅提取纯文本，实现极速导入，不占多余空间。</div>

    <div style="margin-bottom: 8px;"><b>👉 阅读器渲染性能：</b><br>为了在平板上保持丝滑，PDF 阅读器默认采用 1.3 倍的渲染比例。它使用 <code>IntersectionObserver</code> 实现了懒加载，只有滑动到可视区域的页面才会被真正渲染，所以即使打开几百页的大文档也不会卡死。</div>
  `));

  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习系统 · 祝你早日上岸' }));
}