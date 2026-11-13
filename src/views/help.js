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

  container.appendChild(el('h2', { text: '📖 资料复习系统 - 详细操作手册', style: { textAlign: 'center', marginBottom: '4px', color: 'var(--primary-dark)', fontSize: '20px' } }));

  // ================= 核心折叠面板生成器 =================
  function createSection(title, htmlContent) {
    let isOpen = false;
    
    // 👇 直接创建一个容器，内部用 innerHTML 塞进去
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = htmlContent; // 👈 用原生 DOM API
    contentDiv.style.display = 'none';  // 默认隐藏
    contentDiv.style.padding = '12px 16px';
    contentDiv.style.fontSize = '14px';
    contentDiv.style.lineHeight = '1.8';
    contentDiv.style.color = 'var(--text-2)';
    contentDiv.style.borderTop = '1px solid rgba(0,0,0,.05)';

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

  container.appendChild(createSection('📚 1. 背诵与知识库管理', `
    <div style="margin-bottom: 8px;"><b>👉 如何新建任务/章节？</b><br>在首页点击右下角蓝色的 <code>+</code> 按钮，或者点击侧边栏顶部的 <code>+</code>。选好归属后，输入名称即可。</div>
    <div style="margin-bottom: 8px;"><b>👉 如何录入知识点？</b><br>进入任意章节页面，点击底部的「+ 新建知识点」。可以直接打字，也可以点击输入框旁边的「📷」拍照提取文字。</div>
    <div style="margin-bottom: 8px;"><b>👉 快捷操作：粘贴即存。</b><br>在电脑上按 <code>Ctrl+V</code> 粘贴任何文字，系统会自动弹窗，帮你存入收件箱。</div>
    <div style="margin-bottom: 8px;"><b>👉 拖拽排序：</b><br>按住任何任务或章节卡片，可以随意拖拽调整上下顺序。</div>
  `));

  container.appendChild(createSection('🖼️ 2. 图文附件与文件管理', `
    <div style="margin-bottom: 8px;"><b>👉 如何上传附件？</b><br>在知识点编辑页面，展开「🖼 图文附件」，点击「+ 加图片」或「+ 加 PDF」。</div>
    <div style="margin-bottom: 8px;"><b>👉 视图切换：</b><br>进入附件区，顶部有三个按钮：<code>🖼</code> 图文（带缩略图）、<code>▦</code> 极简网格、<code>📄</code> 纯列表。</div>
    <div style="margin-bottom: 8px;"><b>👉 批量操作（多选）：</b><br>点击顶部的「☑ 多选」，然后点击卡片即可勾选。勾选后，顶部会展开「移动、导出、重命名、删除」等按钮。</div>
    <div style="margin-bottom: 8px;"><b>👉 文件夹功能：</b><br>你可以点击「📁+」新建文件夹，把几十张图片分类。单击文件夹名可折叠/展开。</div>
    <div style="margin-bottom: 8px;"><b>👉 导出技巧：</b><br>在多选模式下点击「导出」，你可以选择打包成 <code>ZIP</code>，或者直接逐个下载原本的 PDF 和图片。</div>
  `));

  container.appendChild(createSection('❗ 3. 错题本与冲刺复习', `
    <div style="margin-bottom: 8px;"><b>👉 如何把题目加入错题本？</b><br>在知识点卡片上点击「标记易错」，或者在编辑页面打开「复习设置」，在错因里选「知识盲区」或「粗心大意」。</div>
    <div style="margin-bottom: 8px;"><b>👉 沉浸式重练：</b><br>点击侧边栏的「错题本」，点击顶部的「🎯 开始重练」。屏幕会全屏显示题目，你先回忆，然后点「显示解析」对答案。</div>
    <div style="margin-bottom: 8px;"><b>👉 消灭错题：</b><br>如果这道题你彻底会了，点击「😎 记得并消除」，系统会自动把它移出错题本，很有成就感！</div>
    <div style="margin-bottom: 8px;"><b>👉 错因筛选：</b><br>错题本顶部支持按「盲区 / 粗心」进行过滤，帮你找出自己最容易掉坑的地方。</div>
  `));

  container.appendChild(createSection('📄 4. PDF 高级阅读器', `
    <div style="margin-bottom: 8px;"><b>👉 基础阅读：</b><br>支持双指缩放、鼠标滚轮缩放。单击页面可以选中，双击页面直接进入标注画板。</div>
    <div style="margin-bottom: 8px;"><b>👉 插入新页面：</b><br>点击顶部的 <code>➕</code>，你可以插入空白纸、横线纸、甚至申论答题卡和错题纸。你可以把它插在当前页的前面或后面。</div>
    <div style="margin-bottom: 8px;"><b>👉 划词提取文字：</b><br>点击顶部的 <code>🔤</code>，然后在 PDF 上按住鼠标拖拽一个框，系统会自动识别框里的文字，并可以存为新知识点。</div>
    <div style="margin-bottom: 8px;"><b>👉 框选截图：</b><br>点击顶部的 <code>✂️</code>，框选题目区域，松手后可以保存为图片附件。</div>
    <div style="margin-bottom: 8px;"><b>👉 大纲与书签：</b><br>顶部 <code>📋</code> 是大纲，<code>📑</code> 是书签。你可以创建层级大纲，并全选/批量删除，插入新页后大纲页码会自动顺延。</div>
  `));

  container.appendChild(createSection('🎨 5. 沉浸式标注画板', `
    <div style="margin-bottom: 8px;"><b>👉 图层与工具：</b><br>底部工具栏从左到右依次是：画笔、橡皮、圈擦、文字、形状、胶带、纸张、抓手。</div>
    <div style="margin-bottom: 8px;"><b>👉 隐藏笔迹：</b><br>如果画得太乱挡住了原题，点击顶部的 <code>🙈</code> 可以瞬间隐藏所有你画的线，只显示原图。</div>
    <div style="margin-bottom: 8px;"><b>👉 纸张列表管理：</b><br>点击顶部 <code>➕</code>，在弹出的窗口中点击「🗂 管理已有画布」，可以一键定位并删除你误加的空白纸张。</div>
    <div style="margin-bottom: 8px;"><b>👉 撤销操作：</b><br>顶部的 <code>↶</code> 最多支持撤销 30 步。在平板上，双指双击屏幕也能快速撤销。</div>
  `));

  container.appendChild(createSection('☁️ 6. 数据安全与云同步', `
    <div style="margin-bottom: 8px;"><b>👉 手动备份：</b><br>去设置页点击「导出数据」，强烈建议定期存一份 <code>ZIP</code> 完整包到电脑上（包含了图片和笔迹）。</div>
    <div style="margin-bottom: 8px;"><b>👉 WebDAV 同步：</b><br>在设置页最下方，填入坚果云的 WebDAV 地址、账号和应用密码。点击「⬆️ 上传」即可把纯文字数据传到云端。</div>
    <div style="margin-bottom: 8px;"><b>👉 自动同步：</b><br>勾选「开启后台自动同步」，以后你关闭网页时，它会默默帮你把数据传上去。</div>
    <div style="margin-bottom: 8px;"><b>👉 安全快照：</b><br>如果点了下载覆盖导致数据丢失，立刻点击旁边的「🛡️ 恢复安全快照」，可以一键还原！</div>
  `));

  container.appendChild(createSection('⌨️ 7. 键盘极客快捷键', `
    <div style="margin-bottom: 8px;">在电脑端，你可以完全脱离鼠标复习：</div>
    <div style="margin-bottom: 4px;"><code>Ctrl + K</code> / <code>/</code>：随时唤起全局搜索。</div>
    <div style="margin-bottom: 4px;"><code>N</code>：在章节页一键新建知识点。</div>
    <div style="margin-bottom: 4px;"><code>空格键</code>：在复习卡片中，按空格快速翻开答案。</div>
    <div style="margin-bottom: 4px;"><code>1 / 2 / 3</code>：在复习或错题重练时，按键盘 1（忘了）、2（模糊）、3（记得），直接丝滑跳到下一题。</div>
  `));

  container.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-2)', fontSize: '12px', marginTop: '20px', marginBottom: '40px' }, text: '资料复习系统 · 祝你早日上岸' }));
}