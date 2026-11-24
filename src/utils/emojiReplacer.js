// src/utils/emojiReplacer.js

//核心图标映射库（以后想加新图标，直接往这里加 key-value 即可）
export const EmojiMap = {
    '🌙': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
    '☀️': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#FFD166" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
    '🔍': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    '🗑': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5C667A" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    '❓': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5C667A" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    '⚙️': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5C667A" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    '💾': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#4A7C1B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
    '📦': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#4A7C1B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
    '📊': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
    '🧩': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
    '🎨': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#C92A4E" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.33-.08-.66-.22-.97-.14-.3-.22-.62-.22-.97 0-.83.67-1.5 1.5-1.5h3.5c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"></path><circle cx="6.5" cy="11.5" r="1.5"></circle><circle cx="9.5" cy="7.5" r="1.5"></circle><circle cx="14.5" cy="7.5" r="1.5"></circle><circle cx="17.5" cy="11.5" r="1.5"></circle></svg>`,
    '⬆️': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5C667A" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
    '⬇️': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5C667A" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,
    '🔒': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#C92A4E" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    '🔓': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#4A7C1B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`,
    '📋': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M9 14h6"></path><path d="M9 18h6"></path><path d="M9 10h6"></path></svg>`,
    '🗑': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#EF476F" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
    '✏️': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    '📄': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#8D99AE" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><polyline points="9 15 12 18 15 15"></polyline></svg>`,
    '🔍': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#5FA8C7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    '📂': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#4A7C1B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15h6"></path><path d="M12 12v6"></path><path d="M15 12l-3 3-3-3"></path></svg>`,
    '➕': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#B38200" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
    // 📥 导入备份：绿色托盘
    '📥': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#4A7C1B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`, '📤': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#4A7C1B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
    /* // ⚡️ / ⚡ 速记：灯泡
    '⚡️': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#FFB5A7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M15.09 14c.18-1.36 1.22-2.14 2.01-3.02A6 6 0 1 0 7 10.98c.79.88 1.83 1.66 2.01 3.02h6.08z"></path></svg>`,
    '⚡': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#FFB5A7" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M15.09 14c.18-1.36 1.22-2.14 2.01-3.02A6 6 0 1 0 7 10.98c.79.88 1.83 1.66 2.01 3.02h6.08z"></path></svg>`, */
    '📑': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#B38200" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M9 14h6"></path><path d="M9 18h6"></path><path d="M9 10h6"></path></svg>`,
    '⏰': `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#C92A4E" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
};

//深度遍历 DOM 树替换文本
function replaceNode(node) {
    if (!node) return;

    // 1. 处理纯文本节点
    if (node.nodeType === Node.TEXT_NODE) {
        let text = node.nodeValue;
        let hasEmoji = false;
        for (const [emoji, svg] of Object.entries(EmojiMap)) {
            if (text.includes(emoji)) {
                text = text.split(emoji).join(svg);
                hasEmoji = true;
            }
        }
        if (hasEmoji) {
            const span = document.createElement('span');
            span.innerHTML = text;
            span.style.display = 'inline-flex';
            span.style.alignItems = 'center';
            node.parentNode.replaceChild(span, node);
        }
        return;
    }

    // 2. 处理 input 的 placeholder 或 value（可选，防止表单里出现 Emoji）
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'INPUT' && node.placeholder) {
            for (const [emoji, svg] of Object.entries(EmojiMap)) {
                // 输入框无法渲染 HTML，通常这里保留原样或去除 Emoji
                if (node.placeholder.includes(emoji)) {
                    node.placeholder = node.placeholder.replace(emoji, '').trim();
                }
            }
        }
    }

    // 3. 递归遍历子元素
    if (node.childNodes && node.childNodes.length > 0) {
        Array.from(node.childNodes).forEach(child => replaceNode(child));
    }
}

//导出启动函数
export function initEmojiReplacer() {
    // 初次加载时全量替换一次
    setTimeout(() => {
        replaceNode(document.body);
    }, 100);

    // 监听后续动态渲染的内容（比如弹窗、新生成的列表）
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                // 避免拦截 SVG 自身
                if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'svg') {
                    replaceNode(node);
                } else if (node.nodeType === Node.TEXT_NODE) {
                    replaceNode(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}