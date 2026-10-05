import './styles.css';
import { request } from './core/api.js';
import { webpSupported } from './core/webp.js';
import { openRemoteSession } from './core/remote-session.js';
import { createTextInput } from './input/text-input.js';
import { createSpecialKeys } from './input/special-keys.js';
import { createSettingsDialog } from './ui/settings-dialog.js';

const $ = id => document.getElementById(id);
const button = $('connection-button');
const dialog = $('credentials-dialog');
const viewer = $('viewer');
const connectionState = $('connection-state');
const displayContainer = $('display');
const bitrate = $('bitrate-pill');
const bitrateValue = $('bitrate-value');
const modeButton = $('mode-button');
const paneButton = $('pane-button');
let touchMode = 'relative';
let pane = 0;
let remote = null;
let generation = 0;
let active = false;
let configuredCredentials = false;
const textInput = createTextInput((text, enter) => remote.sendText(text, enter));
const specialKeys = createSpecialKeys(keysyms => {
  remote?.sendKeys(keysyms);
  remote?.focus();
});
createSettingsDialog(settings => {
  remote?.setPointerSpeed(settings.pointerSpeed);
  remote?.refreshSize();
});
$('text-dialog').addEventListener('close', () => remote?.refreshSize());

function connectionAction(label, state) {
  button.dataset.state = state;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(active));
  button.title = label;
}

function status(text, state = '') {
  connectionState.textContent = text;
  connectionState.title = text;
  connectionState.className = state;
}
function disconnect(text = '未接続', state = '') {
  generation++;
  remote?.close();
  remote = null;
  textInput.setConnected(false);
  specialKeys.setConnected(false);
  active = false;
  displayContainer.replaceChildren();
  bitrate.hidden = true;
  bitrateValue.textContent = '0';
  connectionAction('接続', 'disconnected');
  for (const control of [modeButton, paneButton]) control.disabled = true;
  button.disabled = false;
  status(text, state);
}
async function connect(credentials = {}) {
  const current = ++generation;
  active = true;
  button.disabled = true;
  connectionAction('切断', 'connecting');
  status('接続中…', 'connecting');
  let lastError = '';
  let wasConnected = false;
  try {
    const webp = await webpSupported;
    if (generation !== current) return;
    const { ticket, pointerSpeed } = await request('/api/connect', {
      ...credentials, width: viewer.clientWidth * 2, height: viewer.clientHeight, webp,
    });
    credentials = null;
    if (generation !== current) return;
    remote = openRemoteSession({
      ticket, container: displayContainer, viewer, touchMode, pointerSpeed, pane,
      isCurrent: () => generation === current,
      onBitrate: value => { bitrateValue.textContent = value; },
      onError: error => {
        lastError = `${error.message || 'RDP 接続に失敗しました。'} (${error.code})`;
        status(lastError, 'error');
      },
      onState: state => {
        if (state === 3) {
          wasConnected = true;
          connectionAction('切断', 'connected');
          status('接続済み', 'connected');
          bitrate.hidden = false;
          textInput.setConnected(true);
          specialKeys.setConnected(true);
          for (const control of [modeButton, paneButton]) control.disabled = false;
          remote.fit();
          remote.refreshSize();
          remote.focus();
        } else if (state === 5) {
          disconnect(lastError || '切断されました', lastError ? 'error' : '');
          // Rejoin the retained RDP once; a failure before connecting is not retried.
          if (wasConnected) restore();
        }
      },
    });
  } catch (error) {
    if (generation === current) disconnect(error.message, 'error');
  } finally {
    if (generation === current) button.disabled = false;
  }
}
button.addEventListener('click', async () => {
  if (active) {
    button.disabled = true;
    try {
      await request('/api/disconnect', {});
      disconnect();
    } catch (error) {
      // Still connected: show the error briefly instead of covering the desktop.
      const current = generation;
      status(error.message, 'error');
      setTimeout(() => {
        if (generation === current && button.dataset.state === 'connected') status('接続済み', 'connected');
      }, 4000);
    } finally { button.disabled = false; }
  } else if (configuredCredentials) connect();
  else dialog.showModal();
});
function toggle(button, value, label) {
  button.dataset.value = value;
  button.setAttribute('aria-label', label);
  button.title = label;
}
modeButton.addEventListener('click', () => {
  touchMode = touchMode === 'relative' ? 'direct' : 'relative';
  toggle(modeButton, touchMode, touchMode === 'relative' ? 'マウス：指を滑らせてカーソル移動（タップでTapに切替）' : 'Tap：画面を直接操作（タップでマウスに切替）');
  remote?.setTouchMode(touchMode);
  remote?.focus();
});
paneButton.addEventListener('click', () => {
  pane = 1 - pane;
  toggle(paneButton, pane, pane ? '右半分を表示中（タップで左半分に切替）' : '左半分を表示中（タップで右半分に切替）');
  remote?.setPane(pane);
  remote?.focus();
});
$('cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { $('password').value = ''; });
$('connect-form').addEventListener('submit', event => {
  event.preventDefault();
  const credentials = { username: $('username').value.trim(), password: $('password').value };
  $('password').value = '';
  dialog.close();
  connect(credentials);
});
window.addEventListener('blur', () => remote?.reset());
window.addEventListener('pagehide', () => disconnect());
new ResizeObserver(() => remote?.fit()).observe(viewer);
function restore() {
  return request('/api/status').then(result => {
    configuredCredentials = result.configuredCredentials;
    if (result.retained) return connect();
  }).catch(error => status(error.message, 'error')).finally(() => { button.disabled = false; });
}
const rejoin = () => { if (!active) restore(); };
window.addEventListener('pageshow', event => { if (event.persisted) rejoin(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) rejoin(); });
restore();
