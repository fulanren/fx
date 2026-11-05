export function drawSmoothPath(ctx, points, color, width) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

export function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) { ctx.restore(); return; }
  const headLen = Math.max(14, width * 4.5);
  const headW = Math.max(10, width * 3);
  const angle = Math.atan2(dy, dx);
  const bodyEndX = x2 - Math.cos(angle) * headLen * 0.85;
  const bodyEndY = y2 - Math.sin(angle) * headLen * 0.85;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bodyEndX, bodyEndY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - Math.cos(angle) * headLen + Math.cos(angle + Math.PI / 2) * headW / 2,
    y2 - Math.sin(angle) * headLen + Math.sin(angle + Math.PI / 2) * headW / 2
  );
  ctx.lineTo(
    x2 - Math.cos(angle) * headLen - Math.cos(angle + Math.PI / 2) * headW / 2,
    y2 - Math.sin(angle) * headLen - Math.sin(angle + Math.PI / 2) * headW / 2
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawRect(ctx, x1, y1, x2, y2, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  ctx.restore();
}

export function drawLine(ctx, x1, y1, x2, y2, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

export function drawWave(ctx, x1, y1, x2, y2, color, width, amplitude = 8) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) { ctx.restore(); return; }
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.max(20, Math.floor(len / 4));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const baseX = x1 + dx * t;
    const baseY = y1 + dy * t;
    const wave = Math.sin(t * Math.PI * 8) * amplitude;
    const px = baseX + nx * wave;
    const py = baseY + ny * wave;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

export function eraseCircle(ctx, x, y, radius) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============ 方形橡皮擦除 ============
export function eraseSquare(ctx, x, y, halfSize) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(x - halfSize, y - halfSize, halfSize * 2, halfSize * 2);
  ctx.restore();
}

export function eraseRect(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  ctx.restore();
}

// ============ 压感笔迹绘制 ============
// points 数组每项带 pressure（0~1），没有则默认 0.5
export function drawPressurePath(ctx, points, color, baseWidth, scaleFactor = 1) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const pressure = p1.pressure !== undefined ? p1.pressure : 0.5;
    const w = Math.max(1, baseWidth * scaleFactor * (0.5 + pressure * 0.5));
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ============ 笔迹平滑（二次贝塞尔） ============
// ============ 笔迹平滑（二次贝塞尔） ============
export function drawSmoothCurve(ctx, points, color, width, scaleFactor = 1) {
  if (points.length < 3) {
    drawSmoothPath(ctx, points, color, width / scaleFactor);
    return;
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width / scaleFactor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}