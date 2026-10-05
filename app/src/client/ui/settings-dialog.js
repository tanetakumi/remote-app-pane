import { request } from '../core/api.js';

// Load on open, edit locally, and persist only when Save is pressed.
// The bar position and scroll feel are per device: they apply and are remembered immediately, without Save.
// Returns the live scroll settings for the touch input.
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
  const scroll = {
    sensitivity: Number(localStorage.getItem('scrollSensitivity') ?? 1),
    acceleration: Number(localStorage.getItem('scrollAcceleration') ?? 1),
  };
  const scrollFields = [
    [$('settings-scroll-sensitivity'), 'sensitivity', 'scrollSensitivity', $('settings-scroll-sensitivity-value')],
    [$('settings-scroll-acceleration'), 'acceleration', 'scrollAcceleration', $('settings-scroll-acceleration-value')],
  ];
  for (const [input, key, storageKey, output] of scrollFields) {
    input.value = scroll[key];
    output.textContent = `${input.value}×`;
    input.addEventListener('input', () => {
      scroll[key] = Number(input.value);
      output.textContent = `${input.value}×`;
      localStorage.setItem(storageKey, input.value);
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
  return scroll;
}
