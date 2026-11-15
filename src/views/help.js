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
    <div style="margin-bottom: 8px;"><b>👉 三层结构是怎么回事？</b><br>本系统采用「任务（文件夹） -> 章节（子模块） -> 知识点（卡片）」的三层架构。为了兼顾灵活性和防报错，如果你直接建了一个文件夹，系统会在后台自动建一个不可见的「占位子模块」，你正常用就行，它不会干扰你。</div>
    <div style="margin-bottom: 8px;"><b>👉 如何新建大文件夹？</b><br>在首页点击右下角蓝色的 <code>+</code> 按钮，输入名称即可。侧边栏也会同步刷新。</div>
    <div style="margin-bottom: 8px;"><b>👉 拖拽排序与移动：</b><br>按住任何大文件夹或卡片，都可以直接上下拖拽改变排序。如果你想改变卡片所属的文件夹，可以在侧边栏拖动它，或者在编辑卡片时点击「📁 归属文件夹」进行切换。</div>
    <div style="margin-bottom: 8px;"><b>👉 侧边栏折叠：</b><br>点击侧边栏大文件夹左侧的 <code>▸</code> 箭头，可以一键折叠它下面的所有内容。如果你文件夹太多，这个功能能救命。</div>
    <div style="margin-bottom: 8px;"><b>👉 快捷记录灵感：</b><br>在电脑上使用 <code>Ctrl+V</code> 粘贴一段文字，或者在手机/平板上点「⚡️ 速记」，就能把灵感先存入“收件箱”，不用马上分类，事后再去整理。</div>
  `));

  container.appendChild(createSection('🖼️ 2. 图文附件与万能文件管理', `
    <div style="margin-bottom: 8px;"><b>👉 上传与重名保护：</b><br>在「图文附件」区域点「+ 加图片」或「+ 加 PDF」。如果你传了两张都叫 <code>1.pdf</code> 的文件，系统会极其聪明地自动加上 <code>(1).pdf</code> 后缀，绝对不会弄混。</div>
    <div style="margin-bottom: 8px;"><b>👉 三种视图模式：</b><br>顶部三个小按钮可以切换视图：<code>🖼 图文模式</code>（显示缩略图和名字，方便找）、<code>▦ 纯缩略图</code>（适合看图）、<code>📄 列表模式</code>（适合看文件大小和详情）。</div>
    <div style="margin-bottom: 8px;"><b>👉 批量操作的魔法：</b><br>点击「☑ 多选」，勾选多个文件后，顶部的工具栏会变得极其强大：<br>
    - <b>移动：</b>把选中的图片整批挪到另一个文件夹。<br>
    - <b>导出：</b>你可以选择打包成 <code>ZIP</code> 压缩包一键下载，或者逐个直接下载原图。<br>
    - <b>删除：</b>一键清理几十张废图。</div>
    <div style="margin-bottom: 8px;"><b>👉 一键折叠管理：</b><br>多选模式下，点击顶部的 <code>⬇️</code> 或 <code>⬆️</code>，可以一键展开/收起所有文件夹，方便你快速整理。</div>
  `));

  container.appendChild(createSection('❗ 3. 错题本与复习闭环', `
    <div style="margin-bottom: 8px;"><b>👉 如何录入错题？</b><br>直接进侧边栏的「错题本」，点击左上角的「➕ 新增错题」，填入题目和解析。系统会自动把它放进错题收集箱，并打上红色标记。</div>
    <div style="margin-bottom: 8px;"><b>👉 错因分类：</b><br>在编辑卡片时，找到「复习设置」，在错因下拉框里可以选择「📚 知识盲区」或「✏️ 粗心大意」，方便你日后在错题本里按原因过滤。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式重练：</b><br>点击「🎯 开始重练」，系统会全屏展示题目，你可以先自己回忆，点「显示解析」对答案，最后选「忘了」或「记得并消除」。这一套流程下来，记忆极其深刻。</div>
    <div style="margin-bottom: 8px;"><b>👉 间隔重复算法：</b><br>系统用的是简化版 SM-2 算法。你点「记得」就会拉长复习间隔，点「忘了」就会被打回原形（明天再背）。所以一定要在首页的「今日待复习」里认真评价。</div>
  `));

  container.appendChild(createSection('📄 4. PDF 高级阅读器（杀手锏）', `
    <div style="margin-bottom: 8px;"><b>👉 基础阅读：</b><br>支持双指缩放、鼠标滚轮缩放。单击页面选中，双击页面直接进入标注画板。左侧右侧都有悬浮的翻页按钮，单手握着平板也能轻松翻页。</div>
    <div style="margin-bottom: 8px;"><b>👉 插入新页面：</b><br>点击顶部的 <code>➕</code>，你可以插入空白纸、动态横线纸、方格纸、申论答题卡。你可以自定义横线间距和页面留白。插入后，系统会自动跳到你刚插的那一页，不用手动翻。</div>
    <div style="margin-bottom: 8px;"><b>👉 大纲与书签：</b><br>顶部 <code>📋</code> 是大纲，支持自动识别 PDF 自带的目录，也支持手动建立层级。顶部 <code>📑</code> 是书签，随时记录阅读位置。插入新页后，大纲和书签的页码会自动顺延，极其智能。</div>
    <div style="margin-bottom: 8px;"><b>👉 划词提取与截图：</b><br>点击顶部 <code>🔤</code>，在 PDF 上拖拽一个框，系统会自动识别里面的文字（离线 OCR）；点击 <code>✂️</code> 可以框选并保存为图片附件。</div>
  `));

  container.appendChild(createSection('🎨 5. 沉浸式标注画板', `
    <div style="margin-bottom: 8px;"><b>👉 多种笔刷自由切换：</b><br>在画笔工具下，点击右侧的「🎨」面板，你可以切换 圆珠笔、钢笔、毛笔、铅笔。毛笔会有压感渲染，非常适合在平板上做笔记。</div>
    <div style="margin-bottom: 8px;"><b>👉 粗细与颜色：</b><br>支持滑块微调，还可以直接输入数字（可精确到 0.01 极细线）。颜色板可以自定义并收藏常用的颜色。</div>
    <div style="margin-bottom: 8px;"><b>👉 记忆胶带：</b><br>如果有些重点需要遮挡，选「胶带」工具画一块。点击胶带可以随时隐藏或显示；用橡皮擦擦开一个小口子，它就会永久记住这个擦除路径。</div>
    <div style="margin-bottom: 8px;"><b>👉 纸张图层管理：</b><br>点击顶部 <code>➕</code>，在弹出的窗口中点「🗂 管理已有画布」，可以勾选并批量删除你误加的空白纸张。</div>
    <div style="margin-bottom: 8px;"><b>👉 扩展画布：</b><br>点击顶部的「➕ 扩展画布」，选择方向并输入像素，可以在原图周围扩大一圈白边，方便你在边角做笔记，且原图不会被拉变形。</div>
    <div style="margin-bottom: 8px;"><b>👉 自动保存：</b><br>画板每停笔 1.5 秒会自动静默保存，右上角的指示灯变绿就代表存好了。即使误关页面，画的东西也还在。</div>
  `));

  container.appendChild(createSection('☁️ 6. 数据安全、瘦身与云同步', `
    <div style="margin-bottom: 8px;"><b>👉 强烈建议定期备份：</b><br>去设置页点击「导出数据」，存一份 <code>ZIP</code> 完整包到电脑或网盘里。系统会在超过 7 天未备份时，在首页顶部弹黄条提醒你。</div>
    <div style="margin-bottom: 8px;"><b>👉 一键清理废弃图片：</b><br>如果你删了很多卡片，发现空间还是没变小，去设置页点击「🧹 一键清理废弃图片」，系统会扫描并彻底删除所有没有关联的孤儿图片，瞬间腾出几个 G 的空间。</div>
    <div style="margin-bottom: 8px;"><b>👉 WebDAV 坚果云同步：</b><br>在设置页最下方，填入坚果云的应用密码。你可以手动把数据传到云端，也可以开启后台自动同步。注意：它只同步文字和结构，图片太大通常走手动导出。</div>
    <div style="margin-bottom: 8px;"><b>👉 多标签页防冲突：</b><br>如果你在电脑上不小心开了两个标签页，系统会弹红条警告你，防止两边同时修改导致数据互相覆盖。</div>
  `));

  container.appendChild(createSection('📱 7. 平板 PWA 原生全屏体验指南', `
    <div style="margin-bottom: 8px;">为了获得最像原生 App 的体验，一定要这样做：</div>
    <div style="margin-bottom: 8px;"><b>第一步：</b>在 iPad 或手机的 Safari 浏览器中，打开你部署好的网址。</div>
    <div style="margin-bottom: 8px;"><b>第二步：</b>点击顶部地址栏旁边的「分享」按钮（正方形带向上箭头）。</div>
    <div style="margin-bottom: 8px;"><b>第三步：</b>下拉菜单，找到并点击「添加到主屏幕」。</div>
    <div style="margin-bottom: 8px;"><b>第四步：</b>回到桌面，点击新生成的图标。你将获得：**无地址栏、无底边、全屏沉浸、断网秒开**的体验！</div>
  `));

  container.appendChild(createSection('⌨️ 8. 键盘极客快捷键', `
    <div style="margin-bottom: 8px;">在电脑端，你可以完全脱离鼠标：</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + K</code> / <code>/</code>：随时唤起全局搜索，搜索结果里的关键词会自动高亮。</div>
    <div style="margin-bottom: 4px;"><code>N</code>：在章节页一键新建知识点卡片。</div>
    <div style="margin-bottom: 4px;"><code>空格键</code>：在复习卡片中，按空格快速翻开答案。</div>
    <div style="margin-bottom: 4px;"><code>1 / 2 / 3</code>：在复习或错题重练时，按 1（忘了）、2（模糊）、3（记得），自动切下一题。</div>
  `));

  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习系统 · 祝你早日上岸' }));
}