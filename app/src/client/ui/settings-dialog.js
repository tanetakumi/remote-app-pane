import { request } from '../core/api.js';

// Load on open, edit locally, and persist only when Save is pressed.
// The bar position and touch feel are per device: they apply and are remembered immediately, without Save.
// Returns the live touch settings, keyed like their localStorage entries.
export function createSettingsDialog(onSaved) {
  const $ = id => document.getElementById(id);
  const dialog = $('settings-dialog');
  const scale = $('settings-scale');
  const speed = $('settings-speed');
  const compression = $('settings-compression');
  const save = $('settings-save');
  const status = $('settings-status');
  const controls = [scale, speed, compression, save];
  const values = () => {
    $('settings-scale-value').textContent = `${scale.value}×`;
    $('settings-speed-value').textContent = `${speed.value}×`;
    $('settings-compression-value').textContent = compression.value === '0' ? '無効' : compression.value;
  };
  const message = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('has-error', error);
  };
  const apply = settings => {
    scale.value = settings.resolutionScale;
    speed.value = settings.pointerSpeed;
    compression.value = settings.websocketCompressionLevel;
    values();
  };
  const touchSettings = {};
  const touchFields = [
    ['scrollSensitivity', 1, 'settings-scroll-sensitivity', '×'],
    ['scrollStartDistance', 8, 'settings-scroll-start', ' px'],
    ['longPressMs', 700, 'settings-long-press', ' ms'],
  ];
  for (const [key, fallback, id, unit] of touchFields) {
    const input = $(id);
    const output = $(`${id}-value`);
    touchSettings[key] = Number(localStorage.getItem(key) ?? fallback);
    input.value = touchSettings[key];
    output.textContent = `${input.value}${unit}`;
    input.addEventListener('input', () => {
      touchSettings[key] = Number(input.value);
      output.textContent = `${input.value}${unit}`;
      localStorage.setItem(key, input.value);
    });
  }
  const barBottom = $('settings-bar-bottom');
  const placeBar = () => { $('app').dataset.bar = barBottom.checked ? 'bottom' : 'top'; };
  const busy = value => { for (const control of controls) control.disabled = value; };
  $('settings-button').addEventListener('click', async () => {
    busy(true);
    message('読み込み中…');
    dialog.showModal();
    dialog.focus();
    try {
      apply(await request('/api/settings'));
      busy(false);
      message('');
    } catch (error) { message(error.message, true); }
  });
  barBottom.checked = localStorage.getItem('barPosition') === 'bottom';
  placeBar();
  barBottom.addEventListener('change', () => {
    placeBar();
    localStorage.setItem('barPosition', $('app').dataset.bar);
  });
  scale.addEventListener('input', values);
  speed.addEventListener('input', values);
  compression.addEventListener('input', values);
  save.addEventListener('click', async () => {
    busy(true);
    message('保存中…');
    try {
      const saved = await request('/api/settings', {
        resolutionScale: Number(scale.value), pointerSpeed: Number(speed.value),
        websocketCompressionLevel: Number(compression.value),
      }, 'PUT');
      apply(saved);
      onSaved(saved);
      message('保存しました');
    } catch (error) { message(error.message, true); }
    busy(false);
  });
  $('close-settings').addEventListener('click', () => dialog.close());
  return touchSettings;
}
