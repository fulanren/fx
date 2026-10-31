import { toastError } from './toast.js';

export function isSpeechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function attachSpeechButton(inputEl) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm btn-ghost speech-btn';
  btn.textContent = '🎤';

  if (!isSpeechSupported()) {
    btn.title = '当前浏览器不支持语音识别（需 Chrome/Edge，且需联网）';
    btn.disabled = true;
    btn.style.opacity = '0.4';
    return btn;
  }

  btn.title = '语音输入';

  let recognizing = false;
  let recognition = null;
  let baseValue = '';

  btn.addEventListener('click', () => {
    if (recognizing) {
      try { recognition && recognition.stop(); } catch {}
      recognizing = false;
      btn.classList.remove('active');
      btn.textContent = '🎤';
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    baseValue = inputEl.value;
    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      inputEl.value = baseValue + (baseValue ? ' ' : '') + final + interim;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognition.onerror = (e) => {
      if (e.error === 'network') toastError('语音识别需要联网');
      else if (e.error === 'not-allowed') toastError('麦克风权限被拒绝');
      else if (e.error !== 'aborted') toastError('语音识别出错：' + e.error);
      recognizing = false;
      btn.classList.remove('active');
      btn.textContent = '🎤';
    };
    recognition.onend = () => {
      recognizing = false;
      btn.classList.remove('active');
      btn.textContent = '🎤';
    };
    try {
      recognition.start();
      recognizing = true;
      btn.classList.add('active');
      btn.textContent = '⏹';
    } catch (e) {
      toastError('启动语音识别失败');
    }
  });

  return btn;
}