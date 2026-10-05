import './styles.css';
import { request } from './core/api.js';
import { webpSupported } from './core/webp.js';
import { openRemoteSession } from './core/remote-session.js';
import { createTextInput } from './input/text-input.js';
import { createSettingsDialog } from './ui/settings-dialog.js';

const $ = id => document.getElementById(id);
const button = $('connection-button');
const dialog = $('credentials-dialog');
const viewer = $('viewer');
const connectionState = $('connection-state');
const displayContainer = $('display');
const bitrate = $('bitrate-pill');
const bitrateValue = $('bitrate-value');
const modeButtons = [...$('touch-mode').querySelectorAll('button')];
const paneButtons = [...$('pane-switch').querySelectorAll('button')];
let touchMode = 'relative';
let pane = 0;
let remote = null;
let generation = 0;
let active = false;
let configuredCredentials = false;
const textInput = createTextInput((text, enter) => remote.sendText(text, enter));
createSettingsDialog(() => remote?.refreshSize());
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
  active = false;
  displayContainer.replaceChildren();
  bitrate.hidden = true;
  bitrateValue.textContent = '0';
  connectionAction('接続', 'disconnected');
  for (const control of [...modeButtons, ...paneButtons]) control.disabled = true;
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
  try {
    const webp = await webpSupported;
    if (generation !== current) return;
    const { ticket } = await request('/api/connect', {
      ...credentials, width: viewer.clientWidth * 2, height: viewer.clientHeight, webp,
    });
    credentials = null;
    if (generation !== current) return;
    remote = openRemoteSession({
      ticket, container: displayContainer, viewer, touchMode, pane,
      isCurrent: () => generation === current,
      onBitrate: value => { bitrateValue.textContent = value; },
      onError: error => {
        lastError = `${error.message || 'RDP 接続に失敗しました。'} (${error.code})`;
        status(lastError, 'error');
      },
      onState: state => {
        if (state === 3) {
          connectionAction('切断', 'connected');
          status('接続済み', 'connected');
          bitrate.hidden = false;
          textInput.setConnected(true);
          for (const control of [...modeButtons, ...paneButtons]) control.disabled = false;
          remote.fit();
          remote.refreshSize();
          remote.focus();
        } else if (state === 5) disconnect(lastError || '切断されました', lastError ? 'error' : '');
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
for (const modeButton of modeButtons) {
  modeButton.addEventListener('click', () => {
    const mode = modeButton.dataset.mode;
    if (mode === touchMode) return;
    touchMode = mode;
    remote?.setTouchMode(mode);
    for (const item of modeButtons) item.setAttribute('aria-pressed', String(item.dataset.mode === mode));
    remote?.focus();
  });
}
for (const paneButton of paneButtons) {
  paneButton.addEventListener('click', () => {
    pane = Number(paneButton.dataset.pane);
    remote?.setPane(pane);
    for (const item of paneButtons) item.setAttribute('aria-pressed', String(item === paneButton));
    remote?.focus();
  });
}
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
const restore = () => request('/api/status').then(result => {
  configuredCredentials = result.configuredCredentials;
  if (result.retained) return connect();
}).catch(error => status(error.message, 'error')).finally(() => { button.disabled = false; });
window.addEventListener('pageshow', event => { if (event.persisted) restore(); });
restore();
