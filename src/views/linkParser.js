export function parseLinks(html) {
  if (!html) return html;
  
  // 匹配 [[folder:id:名称]] 或 [[point:id:名称]]
  const regex = /\[\[(folder|point):([a-zA-Z0-9-]+):([^\]]+)\]\]/g;
  
  return html.replace(regex, (match, type, id, name) => {
    const route = type === 'folder' ? `#/chapter/${id}` : `#/edit-point/${id}`;
    const icon = type === 'folder' ? '📁' : '📄';
    const color = type === 'folder' ? '#8ECAE6' : '#FFB5A7';
    
    return `<a href="${route}" class="knowledge-link" style="
      display: inline-flex; align-items: center; gap: 4px;
      background: ${color}33; color: #2B2D42;
      padding: 2px 8px; border-radius: 4px;
      font-size: 13px; text-decoration: none; border: 1px solid ${color};
      margin: 0 2px; vertical-align: middle; line-height: 1.2;
    " onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">
      ${icon} ${name}
    </a>`;
  });
}