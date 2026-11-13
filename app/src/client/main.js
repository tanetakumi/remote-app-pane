import './styles.css';
import { createConnection } from './core/connection.js';
import { request } from './core/api.js';
import { webpSupported } from './core/webp.js';
import { openRemoteSession } from './core/remote-session.js';
import { formatBitrate } from './core/bitrate.js';
import { preserveInputLayout } from './core/viewport-layout.js';
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
const bitrateUnit = $('bitrate-unit');
const modeButton = $('mode-button');
const paneButton = $('pane-button');
let touchMode = 'relative';
let pane = 0;
let configuredCredentials = false;
preserveInputLayout($('app'), $('top-bar'));
const textInput = createTextInput((text, enter) => connection.remote.sendText(text, enter));
const specialKeys = createSpecialKeys(keysyms => {
  connection.remote?.sendKeys(keysyms);
  connection.remote?.focus();
});
const touchSettings = createSettingsDialog(settings => {
  connection.remote?.setPointerSpeed(settings.pointerSpeed);
  connection.remote?.refreshSize();
});

function connectionAction(label, state) {
  button.dataset.state = state;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(connection.active));
  button.title = label;
}

function status(text, state = '') {
  connectionState.textContent = text;
  connectionState.title = text;
  connectionState.className = state;
}

function showBitrate(kbps) {
  [bitrateValue.textContent, bitrateUnit.textContent] = formatBitrate(kbps);
}

const connection = createConnection({
  request,
  visible: () => !document.hidden,
  parameters: async () => ({ width: viewer.clientWidth * 2, height: viewer.clientHeight, webp: await webpSupported }),
  open: options => openRemoteSession({ ...options, container: displayContainer, viewer,
    touchMode, touchSettings, pane, onBitrate: kbps => showBitrate(Number(kbps)),
  }),
  onConfigured: value => { configuredCredentials = value; },
  onState: (state, message) => {
    const connected = state === 'connected';
    viewer.setAttribute('aria-busy', String(state !== 'idle' && !connected));
    connection.remote?.setInputEnabled(connected);
    textInput.setConnected(connected);
    specialKeys.setConnected(connected);
    for (const control of [modeButton, paneButton]) control.disabled = !connected;
    bitrate.hidden = !connected;
    button.disabled = false;
    if (connected) {
      connectionAction('切断', 'connected');
      status('接続済み', 'connected');
      connection.remote?.fit();
      connection.remote?.refreshSize();
      connection.remote?.focus();
    } else if (state === 'idle') {
      displayContainer.replaceChildren();
      showBitrate(0);
      connectionAction('接続', 'disconnected');
      status(message || '未接続', message ? 'error' : '');
    } else {
      connectionAction('切断', state === 'checking' ? 'connected' : state);
      status(state === 'checking' ? '接続を確認中…' : state === 'connecting' ? '接続中…' : '再接続中…', 'connecting');
    }
  },
});
button.addEventListener('click', async () => {
  if (connection.active) {
    // Stop local recovery immediately, including when the server is unreachable.
    connection.stop();
    button.disabled = true;
    try { await request('/api/disconnect', {}); }
    catch (error) { status(`サーバー側の切断を確認できませんでした: ${error.message}`, 'error'); }
    finally { button.disabled = false; }
  } else if (configuredCredentials) connection.connect();
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
  connection.remote?.setTouchMode(touchMode);
  connection.remote?.focus();
});
paneButton.addEventListener('click', () => {
  pane = 1 - pane;
  toggle(paneButton, pane, pane ? '右半分を表示中（タップで左半分に切替）' : '左半分を表示中（タップで右半分に切替）');
  connection.remote?.setPane(pane);
  connection.remote?.focus();
});
$('cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { $('password').value = ''; });
$('connect-form').addEventListener('submit', event => {
  event.preventDefault();
  const credentials = { username: $('username').value.trim(), password: $('password').value };
  $('password').value = '';
  dialog.close();
  connection.connect(credentials);
});
window.addEventListener('blur', () => connection.remote?.reset());
window.addEventListener('pagehide', () => connection.stop());
new ResizeObserver(() => connection.remote?.fit()).observe(viewer);
window.addEventListener('pageshow', event => { if (event.persisted) connection.restore(); });
window.addEventListener('online', () => connection.resume());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) connection.suspend();
  else connection.resume();
});
connection.restore();
