import { request } from '../core/api.js';

// Load on open, edit locally, and persist only when Save is pressed.
export function createSettingsDialog(onSaved) {
  const $ = id => document.getElementById(id);
  const dialog = $('settings-dialog');
  const scale = $('settings-scale');
  const compression = $('settings-compression');
  const save = $('settings-save');
  const status = $('settings-status');
  const controls = [scale, compression, save];
  const values = () => {
    $('settings-scale-value').textContent = `${scale.value}×`;
    $('settings-compression-value').textContent = compression.value === '0' ? '無効' : compression.value;
  };
  const message = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('has-error', error);
  };
  const apply = settings => {
    scale.value = settings.resolutionScale;
    compression.value = settings.websocketCompressionLevel;
    values();
  };
  const busy = value => { for (const control of controls) control.disabled = value; };
  $('settings-button').addEventListener('click', async () => {
    busy(true);
    message('読み込み中…');
    dialog.showModal();
    try {
      apply(await request('/api/settings'));
      busy(false);
      message('');
    } catch (error) { message(error.message, true); }
  });
  scale.addEventListener('input', values);
  compression.addEventListener('input', values);
  save.addEventListener('click', async () => {
    busy(true);
    message('保存中…');
    try {
      apply(await request('/api/settings', {
        resolutionScale: Number(scale.value), websocketCompressionLevel: Number(compression.value),
      }, 'PUT'));
      onSaved();
      message('保存しました。解像度倍率は現在の画面に、圧縮の変更は次の画面接続から反映されます。');
    } catch (error) { message(error.message, true); }
    busy(false);
  });
  $('close-settings').addEventListener('click', () => dialog.close());
}
