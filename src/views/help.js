
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

  container.appendChild(el('h2', { text: '📖 资料复习 - 终极操作手册', style: { textAlign: 'center', marginBottom: '4px', color: 'var(--primary-dark)', fontSize: '20px' } }));

  // ================= 🚨 全局红字警告 =================
  container.appendChild(el('div', {
    style: {
      background: 'rgba(239,71,111,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)',
      padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', lineHeight: '1.6', marginBottom: '10px'
    }
  }, [
    el('div', { text: '🚨 数据绝对安全警告（必读）' }),
    el('div', { text: '1. 【清除缓存极高危】在浏览器设置里清除数据时：勾选⚠️“清除网页数据/Cookie/站点数据/IndexedDB（不同浏览器稍许不同，若不确定要勾选哪些可先测试一下）”！这等同于把本系统彻底格式化。如果一定要清理，请只清理“缓存的图片和文件”。', style: { fontWeight: 'normal', marginTop: '4px' } }),
    el('div', { text: '2. 【换浏览器/换设备】数据完全隔离，请务必先用【导出数据】功能打包 ZIP 备份。', style: { fontWeight: 'normal', marginTop: '4px' } }),
    el('div', { text: '3. 【安装到本地】如果你想下载安装为独立 App（PWA），必须在浏览器弹出的权限弹窗中点击“允许”，否则会安装失败。若没弹窗，就前往本地权限打开允许', style: { fontWeight: 'normal', marginTop: '4px' } })
  ]));

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

  container.appendChild(createSection('📊 2. 资源总览页（文件夹视图）常见问答 FAQ', `
    <div style="margin-bottom: 10px; color: var(--text-2);">下面是资源总览页「文件夹下拉 / 筛选 / 列表标签」最常见的 10 个问题，逐条点击展开查看。</div>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 资源总览页顶部那两个开关（按卡片文件夹 / 按文件文件夹）是做什么的？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">它们是<b>两个互斥视角</b>：<b>「按卡片文件夹」</b>按<b>知识点卡片</b>所属文件夹归类筛选；<b>「按文件文件夹」</b>按<b>附件文件</b>的分组归类。两个开关的下拉展示<b>同一棵文件夹树</b>，只是底层匹配字段不同（前者匹配卡片的文件夹归属，后者匹配文件的分组）。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 下拉里的文件夹树是从哪来的？和左侧侧边栏一致吗？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">完全一致。下拉直接读取系统唯一文件夹数据源（<code>kg_tasks</code>），按 <code>parentId</code> 递归还原层级，并<b>按深度缩进</b>逐层显示任务名，跟侧边栏一样。<b>📂 表示有子文件夹</b>，<b>📄 表示末端节点</b>。例如：📂 11 →（缩进）📂 22 →（缩进）📄 11 / 📄 12。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 选中一个父文件夹，它下面子文件夹里的卡片会自动出来吗？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">会。选中任意父节点，系统会把它<b>本身 + 下面所有层级的子文件夹</b>里的卡片一并筛出来，不需要逐个子文件夹去点。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 我有两个同名「11 (副本)」，筛选会不会把它们串在一起？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">不会。即使下拉里两个选项文字一模一样，底层也用<b>每个文件夹各自的唯一 ID</b> 作区分——你点中哪个就只筛哪个的子树。显示文字不变，区分在内部完成。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 下拉里那几个「全部 / 无任务归属 / 未分组文件」是什么意思？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">三个固定特殊选项：<b>「📁 全部卡片文件夹 / 全部文件文件夹」</b>＝不筛选、看全部；<b>「🗂 无任务归属」</b>＝列出没归到任何文件夹的散落卡片；<b>「🗂 未分组文件」</b>＝文件视角下还没分组的文件。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 列表模式下，怎么知道每条记录属于哪个文件夹？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">切到列表视图后，<b>每一行右侧始终显示</b>该记录的完整文件夹路径标签（如「📁 11/22」）；没有归属的显示灰字「未归属」。<b>直接点这枚标签就能按该文件夹筛选</b>，省得再去下拉里翻。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 点击卡片名称会发生什么？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">会直接跳转到它所属文件夹的页面（路由 <code>#/folder/文件夹ID</code>）。注意目前只<b>跳到文件夹页</b>，还不会自动高亮那张具体的卡片。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 「按文件文件夹」这一栏几乎是空的，是不是坏了？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">不是故障，是数据现状——文件记录里暂时还没写入「所属分组(group)」字段，所以文件视角下绝大多数落进「🗂 未分组文件」。等你用 <b>「📁 移动到…」批量把文件分进文件夹</b>之后，这棵树会自动出现内容，无需额外操作。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 顶部黄色「共有 N 个附件仅保留了关联记录」是什么意思？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">说明这些图片/PDF 的<b>实际文件已不在本机存储</b>（多为换设备、清缓存或文件被瘦身），系统只剩名称与归属。<b style="color:var(--danger)">这类条目点击或预览可能打不开</b>，属预期现象；但名称、所属关系仍可正常浏览、搜索和导出。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">❓ 怎么导出、怎么批量多选？</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">顶部提供 <b>JSON / CSV 一键导出</b>（会弹出路径选择），并有 <b>「☑ 多选」</b> 批量操作。导出表里保留了「任务 / 章节」等溯源列，仅用于表格溯源，不影响界面分组展示。</div>
    </details>
  `));

  container.appendChild(createSection('🔍 3. 批量查找替换与文本管理 (全局联动)', `
    <div style="margin-bottom: 8px;"><b>👉 支持多种替换模式：</b><br>在批量选择页面，点击「🔍 查找替换」即可调出高级面板。支持<b>普通文本替换</b>和<b>序列自动替换</b>（如将 <code>1.</code> 批量转为 <code>一、</code>）。</div>
    <div style="margin-bottom: 8px;"><b>👉 序列递进与前后缀：</b><br>勾选“序列自动替换”后，可设置数字/中文/字母递进。还能自定义在数字前加符号（如 <code>(1)</code>）或在后加符号（如 <code>1、</code>）。支持指定特定序号（如只替换第 4、6、7 个）。</div>
    <div style="margin-bottom: 8px;"><b>👉 常用场景一键套用：</b><br>内置了 9 种超实用场景（删混合序号、删空行、去首尾空格等），点击「📋 套用」即可一键填入，无需手写正则表达式。</div>
    <div style="margin-bottom: 8px;"><b>👉 历史撤销栈：</b><br>在排版的工具栏左侧，点击「撤销历史记录」，会弹出所有操作的时间线，支持一键回滚到特定的状态。</div>
  `));

  container.appendChild(createSection('🖼️ 4. 附件、PDF 与多模态录入', `
    <div style="margin-bottom: 8px;"><b>👉 多源极速录入：</b><br>点击输入框右侧的 <code>📷</code>，支持<b>拍照识别</b>、<b>选相册图</b>、或<b>从 PDF 选页提取</b>。系统自动 OCR 提取文字并插入输入框。</div>
    <div style="margin-bottom: 8px;"><b>👉 画质自由选择：</b><br>导入 PDF 时可以自由选择清晰度（超清/高清/标准/流畅），流畅模式能大幅减少平板卡顿。</div>
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

  container.appendChild(createSection('📱 10. 全平台安装指南 (PWA)', `
    <div style="margin-bottom: 8px;"><b>👉 电脑端安装（Edge / Chrome）：</b><br>
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
    Chrome 的兼容性是目前全世界最好的，保证一键安装，全屏独立运行！</div>

    <div style="margin-bottom: 8px;"><b>👉 为什么点安装“没反应”？</b><br>
    如果你之前装过旧版本，或者点了没反应，请去浏览器设置里 <b>清除该网站的缓存和 Cookie</b>。如果依然不行，请打开浏览器的 <b>无痕模式 / 隐私模式</b>，输入网址再点安装。</div>

    <div style="margin-bottom: 8px; margin-top: 16px; border-top: 1px dashed rgba(0,0,0,.1); padding-top: 16px;">
      <b>👉 安装好了，但是“下载”列表里为什么找不到？</b><br>
      <span style="color: var(--danger);">这是一个常见的误区：PWA 应用不是普通的安装包（像 APK 或 EXE），它不需要“下载”。</span>
      当你点击“添加到主屏幕”时，浏览器只是把当前的“网址”和“图标”打包成了一个快捷方式。所以，<b>去浏览器的“下载记录”里是绝对找不到它的！</b> 所有的系统代码都是在您点击图标的那一瞬间，由浏览器实时加载的。
    </div>

    <div style="margin-bottom: 8px;">
      <b>👉 那到底去哪里找？</b><br>
      1. 去平板的<b>系统桌面</b>向左或向右滑，或者打开平板底部的<b>“所有应用 / 应用抽屉”</b>。<br>
      2. 有些平板会自动把它放进一个叫“浏览器快捷方式”或“推荐应用”的系统文件夹里。仔细找找名为“资料复习”的图标。
    </div>

    <div style="margin-bottom: 8px;">
      <b>👉 如何判断它是不是真正的独立 App？</b><br>
      去桌面点击打开那个新建的图标：<br>
      - <b>如果是真的 PWA App：</b>打开后，顶部<b>没有</b>浏览器的地址栏、没有底部的浏览器黑边、没有任何多余按钮，直接全屏展示你的系统。<br>
      - <b>如果只是普通书签快捷方式：</b>打开后，顶部依然有网址栏。这说明你用的这款平板自带浏览器阉割了 PWA 全屏功能。<br>
    </div>
  `));

  container.appendChild(createSection('⚙️ 11. PDF 高级设置与加载优化（含全部 8 档画质）', `
    <div style="margin-bottom: 8px;"><b>👉 导入 PDF 时的画质选择（重要）：</b><br>当你点击「加 PDF」或「导入 PDF」时，选页框顶部会出现完整画质选择按钮，共 <b>8 档</b>。系统会按对应比例（scale）渲染 Canvas 并存入 IndexedDB，画质越高越清晰、占用存储和内存也越大：</div>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px;">
      <thead><tr style="background: rgba(0,0,0,.05);"><th style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: left;">档位</th><th style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">缩放比</th><th style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: left;">说明</th><th style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">体积</th></tr></thead>
      <tbody>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>超清 2.0x</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">2.0</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">打印级清晰度，文字锐利可放大查看</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积最大</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>高清 1.5x（默认推荐）</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">1.5</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">推荐日常使用，清晰度与体积平衡</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积适中</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>很清 1.4x</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">1.4</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">接近超清，比 2.0x 省约 30% 空间</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积适中</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>清晰 1.3x</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">1.3</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">与阅读端默认清晰度一致，性价比高</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积较小</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>清晰 1.2x</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">1.2</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">屏幕阅读足够清晰</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积较小</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>轻清 1.1x</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">1.1</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">轻微压缩，肉眼几乎无差别</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积小</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b>标准 1.0x</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">1.0</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">原始比例，适合纯预览</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积小</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;"><b style="color:var(--danger)">流畅 0.8x（平板强烈推荐）</b></td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">0.8</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">大幅节省空间，适合页数很多的文档</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: center;">体积最小</td></tr>
      </tbody>
    </table>
    <div style="margin-bottom: 8px;"><b>👉 默认档位：</b><br>不手动选择时，系统默认落在 <b>「高清 1.5x」</b>，兼顾清晰度与体积。</div>
    <div style="margin-bottom: 8px;"><b>👉 导入 PDF 提取文字的加速技巧：</b><br>如果你的 PDF 是为了直接提取文字生成知识点（模板导入），而不是为了原样保留页面截图，系统会使用 <code>0.8</code> 的低比例来渲染画布，仅提取纯文本，实现极速导入，不占多余空间。</div>
  `));

  container.appendChild(createSection('✍️ 12. 富文本编辑器与高级工具', `
    <div style="margin-bottom: 8px;"><b>👉 多格式混排：</b><br>在「文字解释」输入框中，支持加粗、斜体、下划线、无级调字号、行距、对齐方式，以及文字变色和荧光笔高亮。</div>
    <div style="margin-bottom: 8px;"><b>👉 防退防闪退机制：</b><br>点击工具栏修改格式时，系统会自动锁定你的文字选区，绝不丢失；双击输入文字时，底层画布全局锁死，彻底杜绝打字光标闪退。</div>
    <div style="margin-bottom: 8px;"><b>👉 高级双向链接：</b><br>在解释框里输入 <code>[[</code> 即可唤起全局检索，直接插入一张卡片或文件夹的跳转链接。点击链接可直达，长按链接可重置或删除。</div>
    <div style="margin-bottom: 8px;"><b>👉 数学公式与符号：</b><br>点击 <code>∑</code> 调出 KaTeX 公式面板，支持搜索、预览和收藏。插入的公式双击可重新编辑。工具栏集成了常用标点符号和外置快捷输入组。</div>
  `));

  container.appendChild(createSection('🔄 13. 如何安全更新至最新版本（保证数据不丢失）', `
    <div style="margin-bottom: 10px;"><b>核心结论：</b><br>你的任务树、章节、卡片全部存在浏览器的 <b>localStorage</b>（<code>kg_tasks</code>、<code>kg_chapters</code> 等键）里；而 <code>resourceOverview.js</code>、<code>help.js</code> 只是逻辑代码。<b>换代码 = 只换“怎么读数据”，不动“数据本身”</b>，所以正常更新不会丢数据。</div>
    <div style="margin-bottom: 8px; color: var(--danger);"><b>⚠️ 真正会丢数据的是这几件事，更新时务必绕开：</b></div>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px;">
      <thead><tr style="background: rgba(239,71,111,.08);"><th style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: left;">危险操作</th><th style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px; text-align: left;">为什么危险</th></tr></thead>
      <tbody>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">DevTools / 浏览器设置里点“清除站点数据 / Clear site data / 清除 Cookie / 清除 IndexedDB”</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">连带清空 localStorage，数据全没</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">把桌面应用“卸载”再重装</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">部分浏览器会顺带清站点数据</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">换打开方式（原 file:// 双击，改用 http://127.0.0.1，或反之）</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">origin 变了＝读另一个 localStorage 桶，看似丢了其实存了两份</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">用无痕 / 隐私窗口打开</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">关掉窗口即清空</td></tr>
        <tr><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">换浏览器 / 换电脑</td><td style="border: 1px solid rgba(0,0,0,.12); padding: 5px 6px;">localStorage 不跨设备同步</td></tr>
      </tbody>
    </table>
    <div style="margin-bottom: 8px;"><b>👉 安全的操作是：</b>注销 Service Worker、删除 CacheStorage 缓存条目、硬刷新——这三个都<b>不碰 localStorage</b>。</div>
    <div style="margin-bottom: 8px; margin-top: 12px; border-top: 1px dashed rgba(0,0,0,.12); padding-top: 12px;"><b>📌 标准更新流程（5 步，照做即可）</b></div>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">🔧 第 1 步　更新前先备份（每次都要做，约 10 秒）</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">打开应用 → 按 <code>F12</code> → Console → 运行备份脚本里的 <code>kgBackupToFile()</code>，会下载一个带时间戳的 <code>.json</code>。<b>把它存到项目目录外面</b>（桌面/文档），防止下次覆盖代码时被一起删。顺手跑 <code>kgStatus()</code>，把“kg_ 键数量 / 数组元素合计”记下来，更新后对账。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">🔧 第 2 步　覆盖代码文件</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">按你平时的加载方式覆盖 <code>views/resourceOverview.js</code>、<code>views/help.js</code> 等更新后的文件。这一步不用关浏览器，也不用关窗口。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">🔧 第 3 步　让 Service Worker 缓存失效（PWA 卡旧代码就在这）</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">三选一：<br>① <b>最正规</b>：改 <code>sw.js</code> 里的缓存版本号，把 <code>CACHE_NAME</code> 从 <code>v6</code> 改成 <code>v7</code>，新 SW 接管后自动删旧缓存。<br>② <b>最快捷</b>：F12 → Console 跑 <code>kgRefreshNoDataLoss()</code>（只注销 SW + 清空 CacheStorage，明确不动数据）。<br>③ <b>调试用</b>：F12 → Network 勾选 <b>Update on reload</b> 和 <b>Disable cache</b>，再 <code>Ctrl+Shift+R</code>。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">🔧 第 4 步　重开桌面应用</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">把桌面图标打开的<b>所有窗口全部关掉</b>（SW 只有在没有旧文档引用时才会接管），再重新双击图标打开。若界面自带“发现新版本，点击更新”提示条，点它一次更干净。</div>
    </details>
    <details style="margin-bottom: 8px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;">
      <summary style="cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--primary-dark); background: rgba(0,0,0,.03); border-radius: 8px;">🔧 第 5 步　校验数据是否还在</summary>
      <div style="padding: 10px 14px; line-height: 1.8;">新窗口 F12 → Console 跑 <code>kgVerify()</code>，打印 <code>kg_tasks</code> 条数、根节点数量、所有 <code>kg_</code> 键。数字和第 1 步记的一致 → 更新成功；若显示“缺失关键键”红字 → 立刻跑 <code>kgRestorePick()</code> 选第 1 步那个 json 恢复，再刷新。</div>
    </details>
    <div style="margin-bottom: 8px; margin-top: 12px; border-top: 1px dashed rgba(0,0,0,.12); padding-top: 12px;"><b>📌 我属于哪种加载方式？（决定第 3 步要不要做）</b><br>
      - 地址栏是 <code>http://localhost:xxxx</code> 或 <code>https://…</code> → 有 PWA + SW，<b>必须做第 3 步</b>，否则覆盖一万次文件，页面读的还是旧缓存。<br>
      - 地址栏是 <code>file:index.html</code> → 没有 SW 缓存层，“添加到桌面”只是快捷方式，覆盖文件后 <code>Ctrl+F5</code> 即可；跑 <code>kgRefreshNoDataLoss()</code> 会提示“未发现 SW/缓存”，属正常。<br>
      - 进一步确认：F12 → Application 左侧有没有 <b>Service Workers</b> 与 <b>Manifest</b> 两个区块，有就是真 PWA。</div>
    <div style="margin-bottom: 8px;"><b>👉 配套辅助脚本：</b><br>此前交付的 <code>PWA更新数据备份辅助脚本.js</code> 提供 <code>kgStatus()</code> 看概况、<code>kgBackupToFile()</code> 备份、<code>kgBackupToClipboard()</code> 复制、<code>kgRestorePick()</code> 恢复、<code>kgRefreshNoDataLoss()</code> 只清缓存、<code>kgVerify()</code> 自检。脚本全程<b>只读</b> localStorage，不会删除或覆盖任何数据。</div>
  `));
  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习' }));
}