import { el } from '../utils/dom.js';

const STORAGE_KEY = 'kg_pomodoro_state';
const POS_KEY = 'kg_pomodoro_pos';

let floatEl = null;
let rafId = null;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (s && typeof s.remaining === 'number') return s;
  } catch { }
  return { mode: 'work', remaining: 25 * 60 * 1000, running: false, workMs: 25 * 60 * 1000, breakMs: 5 * 60 * 1000 };
}
function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { }
}

let state = loadState();
let lastTick = 0;

export function togglePomodoro() {
  if (floatEl) { closeFloat(); return; }
  buildFloat();
  if (state.running) start();
  else render();
}

export function closePomodoro() {
  if (floatEl) closeFloat();
}

function buildFloat() {
  const timeLabel = el('span', { class: 'pomo-time', text: formatMs(state.remaining) });
  const modeLabel = el('span', {
    style: { fontSize: '12px', color: 'var(--text-2)', minWidth: '32px' },
    text: state.mode === 'work' ? '专注' : '休息',
  });
  const progressBar = el('div', {
    style: { width: '60px', height: '4px', background: 'rgba(0,0,0,.1)', borderRadius: '2px', overflow: 'hidden' },
  }, [
    el('div', { style: { height: '100%', background: 'var(--primary)', width: '0%', transition: 'width .3s' } }),
  ]);

  const btnToggle = el('button', { class: 'pomo-btn', text: state.running ? '⏸' : '▶', onClick: toggleRunning });
  const btnReset = el('button', { class: 'pomo-btn', text: '↺', onClick: resetCurrent });
  const btnSettings = el('button', { class: 'pomo-btn', text: '⚙', onClick: openSettings });
  const btnClose = el('button', { class: 'pomo-btn', text: '✕', onClick: closeFloat });

  floatEl = el('div', { class: 'pomodoro-float' }, [
    modeLabel,
    timeLabel,
    progressBar,
    btnToggle,
    btnReset,
    btnSettings,
    btnClose,
  ]);
  floatEl._timeLabel = timeLabel;
  floatEl._modeLabel = modeLabel;
  floatEl._progressBar = progressBar;
  floatEl._btnToggle = btnToggle;
  document.body.appendChild(floatEl);

  // 恢复位置
  try {
    const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (pos && typeof pos.left === 'number') {
      floatEl.style.left = pos.left + 'px';
      floatEl.style.top = pos.top + 'px';
      floatEl.style.right = 'auto';
      floatEl.style.bottom = 'auto';
    }
  } catch { }

  // 拖拽
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  floatEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = floatEl.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    floatEl.setPointerCapture(e.pointerId);
    floatEl.style.cursor = 'grabbing';
  });
  floatEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const left = Math.max(0, Math.min(window.innerWidth - floatEl.offsetWidth, startLeft + dx));
    const top = Math.max(0, Math.min(window.innerHeight - floatEl.offsetHeight, startTop + dy));
    floatEl.style.left = left + 'px';
    floatEl.style.top = top + 'px';
    floatEl.style.right = 'auto';
    floatEl.style.bottom = 'auto';
  });
  floatEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    floatEl.releasePointerCapture(e.pointerId);
    floatEl.style.cursor = '';
    const rect = floatEl.getBoundingClientRect();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  });

  render();
}

function closeFloat() {
  state.running = false;
  saveState(state);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (floatEl) { floatEl.remove(); floatEl = null; }
}

function toggleRunning() {
  state.running = !state.running;
  saveState(state);
  if (state.running) start();
  else render();
}

function resetCurrent() {
  state.remaining = state.mode === 'work' ? state.workMs : state.breakMs;
  saveState(state);
  lastTick = performance.now();
  render();
}

function start() {
  if (!state.running) return;
  lastTick = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  tick();
}

function tick() {
  if (!state.running || !floatEl) return;
  const now = performance.now();
  const delta = now - lastTick;
  lastTick = now;
  state.remaining = Math.max(0, state.remaining - delta);
  render();
  if (state.remaining <= 0) {
    completePhase();
  } else {
    rafId = requestAnimationFrame(tick);
  }
}

function completePhase() {
  const wasWork = state.mode === 'work';
  notify(wasWork ? '专注结束，休息一下 ☕' : '休息结束，开始专注 🎯');
  playBeep();
  state.mode = wasWork ? 'break' : 'work';
  state.remaining = state.mode === 'work' ? state.workMs : state.breakMs;
  saveState(state);
  render();
  if (state.running) {
    lastTick = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function render() {
  if (!floatEl) return;
  const total = Math.ceil(state.remaining / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  floatEl._timeLabel.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  floatEl._modeLabel.textContent = state.mode === 'work' ? '专注' : '休息';
  floatEl._btnToggle.textContent = state.running ? '⏸' : '▶';
  const phaseTotal = state.mode === 'work' ? state.workMs : state.breakMs;
  const pct = 1 - state.remaining / phaseTotal;
  const bar = floatEl._progressBar.firstChild;
  if (bar) bar.style.width = Math.min(100, Math.max(0, pct * 100)) + '%';
}

function openSettings() {
  const workMin = Math.floor(state.workMs / 60000);
  const workSec = Math.floor((state.workMs % 60000) / 1000);
  const breakMin = Math.floor(state.breakMs / 60000);
  const breakSec = Math.floor((state.breakMs % 60000) / 1000);

  const mask = el('div', { class: 'confirm-mask' }, [
    el('div', { class: 'confirm-box', style: { maxWidth: '340px' } }, [
      el('h3', { text: '番茄钟设置' }),
      el('div', { class: 'field', style: { marginTop: '12px' } }, [
        el('label', { text: '专注时长' }),
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
          el('input', { type: 'number', min: '0', max: '120', value: String(workMin), id: 'pomo-work-min', style: { flex: '1' } }),
          el('span', { text: '分', style: { color: 'var(--text-2)' } }),
          el('input', { type: 'number', min: '0', max: '59', value: String(workSec), id: 'pomo-work-sec', style: { flex: '1' } }),
          el('span', { text: '秒', style: { color: 'var(--text-2)' } }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '休息时长' }),
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
          el('input', { type: 'number', min: '0', max: '60', value: String(breakMin), id: 'pomo-break-min', style: { flex: '1' } }),
          el('span', { text: '分', style: { color: 'var(--text-2)' } }),
          el('input', { type: 'number', min: '0', max: '59', value: String(breakSec), id: 'pomo-break-sec', style: { flex: '1' } }),
          el('span', { text: '秒', style: { color: 'var(--text-2)' } }),
        ]),
      ]),
      el('div', { class: 'confirm-actions' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onClick: () => {
            const wm = Number(document.getElementById('pomo-work-min').value) || 0;
            const ws = Number(document.getElementById('pomo-work-sec').value) || 0;
            const bm = Number(document.getElementById('pomo-break-min').value) || 0;
            const bs = Number(document.getElementById('pomo-break-sec').value) || 0;
            const wTotal = wm * 60000 + ws * 1000;
            const bTotal = bm * 60000 + bs * 1000;
            if (wTotal < 1000 || wTotal > 120 * 60000) { alert('专注时长需在 1 秒到 120 分钟之间'); return; }
            if (bTotal < 1000 || bTotal > 60 * 60000) { alert('休息时长需在 1 秒到 60 分钟之间'); return; }
            state.workMs = wTotal;
            state.breakMs = bTotal;
            state.remaining = state.mode === 'work' ? state.workMs : state.breakMs;
            saveState(state);
            render();
            mask.remove();
          },
        }),
      ]),
    ]),
  ]);
  document.body.appendChild(mask);
}

function notify(text) {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('番茄钟', { body: text });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification('番茄钟', { body: text });
      });
    }
  }
  import('./toast.js').then(({ toastSuccess }) => toastSuccess(text));
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch { }
}

function formatMs(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}