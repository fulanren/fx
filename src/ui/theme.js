import * as store from '../store.js';

export function applyTheme() {
  const settings = store.getSettings();
  const theme = settings.theme || 'system';
  let dark = false;
  if (theme === 'dark') dark = true;
  else if (theme === 'system') dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function initTheme() {
  applyTheme();
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    const settings = store.getSettings();
    if (settings.theme === 'system') applyTheme();
  });
}

export function setTheme(theme) {
  store.updateSettings({ theme });
  applyTheme();
}