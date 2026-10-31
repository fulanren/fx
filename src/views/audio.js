import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { dbGet, dbPut, dbDelete, dbAll } from '../db.js';
import { uuid } from '../utils/id.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

const AUDIO_INDEX_KEY = 'kg_audio_index';

function getAudioIndex() {
  try { return JSON.parse(localStorage.getItem(AUDIO_INDEX_KEY) || '[]'); }
  catch { return []; }
}
function setAudioIndex(list) { localStorage.setItem(AUDIO_INDEX_KEY, JSON.stringify(list)); }

export function getAudiosForPoint(pointId) {
  return getAudioIndex().filter(a => a.pointId === pointId);
}
export function getAudiosForChapter(chapterId) {
  return getAudioIndex().filter(a => a.chapterId === chapterId);
}

// ============ 录音器 ============
export function createRecorder({ onTick, onWave, onStop }) {
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];
  let audioContext = null;
  let analyser = null;
  let rafId = null;
  let currentAudioId = null;
  let startTime = 0;
  let pausedMs = 0;
  let pausedAt = 0;
  let isPaused = false;

  function pickMime() {
    const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const t of opts) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toastError('当前浏览器不支持录音');
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toastError('麦克风权限被拒绝：' + e.message);
      return false;
    }
    const mimeType = pickMime();
    if (!mimeType) { toastError('浏览器不支持录音格式'); return false; }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    function loop() {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      onWave && onWave(rms);
      rafId = requestAnimationFrame(loop);
    }
    loop();

    currentAudioId = uuid();
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size === 0) return;
      chunks.push(e.data);
      try {
        await dbPut('audio_chunks', {
          id: `${currentAudioId}_${Date.now()}`,
          audioId: currentAudioId,
          seq: chunks.length,
          blob: e.data,
          startMs: (chunks.length - 1) * 5000,
          endMs: chunks.length * 5000,
        });
      } catch {}
    };
    mediaRecorder.start(5000);
    startTime = performance.now();
    pausedMs = 0;
    isPaused = false;

    function tick() {
      if (isPaused) return;
      const elapsed = pausedMs + (performance.now() - startTime);
      onTick && onTick(elapsed);
      rafId = requestAnimationFrame(tick);
    }
    tick();
    return true;
  }

  function pause() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    mediaRecorder.pause();
    isPaused = true;
    pausedAt = performance.now();
  }
  function resume() {
    if (!mediaRecorder || mediaRecorder.state !== 'paused') return;
    mediaRecorder.resume();
    pausedMs += performance.now() - pausedAt;
    isPaused = false;
  }

  async function stop() {
    if (!mediaRecorder) return null;
    const mimeType = mediaRecorder.mimeType;
    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        cancelAnimationFrame(rafId);
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        try { audioContext?.close(); } catch {}
        const blob = new Blob(chunks, { type: mimeType });
        const durationMs = pausedMs + (performance.now() - startTime);
        await dbPut('audios', {
          id: currentAudioId,
          blob,
          mimeType,
          durationMs,
          createdAt: new Date().toISOString(),
        });
        const allChunks = await dbAll('audio_chunks');
        for (const c of allChunks) {
          if (c.audioId === currentAudioId) await dbDelete('audio_chunks', c.id);
        }
        onStop && onStop();
        resolve({ id: currentAudioId, blob, mimeType, durationMs });
      };
      mediaRecorder.stop();
      mediaRecorder = null;
    });
  }

  return { start, pause, resume, stop };
}

// ============ 元数据 ============
export function saveAudioMeta({ id, pointId, chapterId, name, mimeType, durationMs }) {
  const list = getAudioIndex();
  list.push({ id, pointId, chapterId, name, mimeType, durationMs, createdAt: new Date().toISOString() });
  setAudioIndex(list);
  if (pointId) {
    const p = store.getPoint(pointId);
    if (p) {
      const ids = p.audioIds || [];
      if (!ids.includes(id)) store.updatePoint(pointId, { audioIds: [...ids, id] });
    }
  }
}
export function removeAudio(id, pointId) {
  const list = getAudioIndex().filter(a => a.id !== id);
  setAudioIndex(list);
  if (pointId) {
    const p = store.getPoint(pointId);
    if (p) store.updatePoint(pointId, { audioIds: (p.audioIds || []).filter(x => x !== id) });
  }
  dbDelete('audios', id).catch(() => {});
}

// ============ 录音弹窗 ============
export function audioRecorderModal({ pointId, chapterId, name }) {
  return new Promise(async (resolve) => {
    let recording = false;
    let paused = false;

    const timeLabel = el('div', { style: { fontSize: '32px', fontWeight: '600', textAlign: 'center', margin: '16px 0' }, text: '00:00' });
    const waveCanvas = el('canvas', { width: 300, height: 60, style: { display: 'block', margin: '0 auto 16px', background: '#f5f5f5', borderRadius: '8px' } });
    const wctx = waveCanvas.getContext('2d');
    function drawWave(rms) {
      wctx.fillStyle = '#f5f5f5'; wctx.fillRect(0, 0, 300, 60);
      wctx.fillStyle = '#8ECAE6';
      const w = Math.min(300, rms * 800);
      wctx.fillRect(150 - w / 2, 10, w, 40);
    }

    const recorder = createRecorder({
      onTick: (ms) => { timeLabel.textContent = formatMs(ms); },
      onWave: drawWave,
      onStop: () => {},
    });

    const btnRecord = el('button', { class: 'btn btn-primary', text: '🎙 开始录音', onClick: async () => {
      if (!recording) {
        const ok = await recorder.start();
        if (!ok) return;
        recording = true;
        btnRecord.textContent = '⏸ 暂停';
        btnStop.classList.remove('hidden');
      } else {
        if (paused) { recorder.resume(); paused = false; btnRecord.textContent = '⏸ 暂停'; }
        else { recorder.pause(); paused = true; btnRecord.textContent = '▶ 继续'; }
      }
    } });

    const btnStop = el('button', { class: 'btn btn-danger hidden', text: '⏹ 停止并保存', onClick: async () => {
      const result = await recorder.stop();
      if (result) {
        await dbPut('audios', {
          id: result.id, pointId, chapterId,
          blob: result.blob, mimeType: result.mimeType, durationMs: result.durationMs,
          createdAt: new Date().toISOString(),
        });
        saveAudioMeta({ id: result.id, pointId, chapterId, name: name || '录音', mimeType: result.mimeType, durationMs: result.durationMs });
        toastSuccess('已保存录音');
        mask.remove();
        resolve(true);
      }
    } });

    const btnCancel = el('button', { class: 'btn btn-ghost', text: '取消', onClick: async () => {
      if (recording) { try { await recorder.stop(); } catch {} }
      mask.remove();
      resolve(false);
    } });

    const mask = el('div', { class: 'confirm-mask' }, [
      el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
        el('h3', { text: '🎙 录音' }),
        timeLabel,
        waveCanvas,
        el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' } }, [btnRecord, btnStop]),
        el('div', { style: { marginTop: '12px', textAlign: 'center' } }, [btnCancel]),
      ]),
    ]);
    document.body.appendChild(mask);
  });
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ============ 录音列表 ============
export function renderAudioList(audios, onRemove) {
  if (!audios.length) return null;
  const list = el('div', { style: { marginTop: '8px' } });
  audios.forEach(a => {
    const item = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: '#f9f9f9', borderRadius: '6px', marginBottom: '4px' },
    });
    item.appendChild(el('span', { text: `🎙 ${a.name || '录音'} · ${formatMs(a.durationMs)}` }));
    item.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: '▶ 播放', onClick: async () => {
      const audio = await dbGet('audios', a.id);
      if (!audio) { toastError('音频不存在'); return; }
      const url = URL.createObjectURL(audio.blob);
      new Audio(url).play();
    } }));
    item.appendChild(el('button', { class: 'btn btn-sm btn-danger', text: '删除', onClick: async () => {
      if (await confirmBox({ title: '删除录音', message: '删除后无法恢复', danger: true, confirmText: '删除' })) {
        removeAudio(a.id, a.pointId);
        onRemove && onRemove();
      }
    } }));
    list.appendChild(item);
  });
  return list;
}