import { el } from '../utils/dom.js';

export function createTimer({ mode = 'countup', limitMs = 90000, onTick, onFinish }) {
  let startTime = performance.now();
  let paused = false;
  let rafId = null;
  let elapsedBeforePause = 0;

  function tick() {
    if (paused) return;
    const elapsed = elapsedBeforePause + (performance.now() - startTime);
    onTick && onTick(elapsed);
    if ((mode === 'countdown' || mode === 'pomodoro') && elapsed >= limitMs) {
      onFinish && onFinish();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  return {
    start() { startTime = performance.now(); paused = false; tick(); },
    pause() { paused = true; elapsedBeforePause += performance.now() - startTime; },
    resume() { startTime = performance.now(); paused = false; tick(); },
    stop() { cancelAnimationFrame(rafId); return elapsedBeforePause + (performance.now() - startTime); },
    reset() { elapsedBeforePause = 0; startTime = performance.now(); },
    getElapsed() { return elapsedBeforePause + (performance.now() - startTime); },
  };
}

export function renderSelfTestRing(limitMs = 90000) {
  const ring = el('div', {
    class: 'selftest-ring',
    style: { position: 'relative', width: '60px', height: '60px', flexShrink: '0' },
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 60 60');
  svg.style.width = '100%';
  svg.style.height = '100%';
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '30'); circle.setAttribute('cy', '30'); circle.setAttribute('r', '26');
  circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', '#e5e7eb'); circle.setAttribute('stroke-width', '4');
  const progress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  progress.setAttribute('cx', '30'); progress.setAttribute('cy', '30'); progress.setAttribute('r', '26');
  progress.setAttribute('fill', 'none'); progress.setAttribute('stroke', '#8ECAE6'); progress.setAttribute('stroke-width', '4');
  const circ = 2 * Math.PI * 26;
  progress.setAttribute('stroke-dasharray', String(circ));
  progress.setAttribute('stroke-dashoffset', '0');
  progress.setAttribute('transform', 'rotate(-90 30 30)');
  svg.appendChild(circle); svg.appendChild(progress);
  ring.appendChild(svg);
  const label = el('span', {
    style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600' },
    text: String(Math.floor(limitMs / 1000)),
  });
  ring.appendChild(label);

  const startTime = performance.now();
  let rafId;
  function tick() {
    const elapsed = performance.now() - startTime;
    const remain = Math.max(0, limitMs - elapsed);
    const pct = remain / limitMs;
    progress.setAttribute('stroke-dashoffset', String((1 - pct) * circ));
    label.textContent = Math.ceil(remain / 1000) + 's';
    if (remain <= 0) {
      progress.setAttribute('stroke', '#EF476F');
      label.style.color = '#EF476F';
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  tick();
  ring._stop = () => cancelAnimationFrame(rafId);
  return ring;
}