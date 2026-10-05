import { observeDisplaySize } from './display-resize.js';
import { createMouseSender, createTouchMouse } from '../input/mouse.js';

const Guacamole = window.Guacamole;

// Opens a Guacamole client in `container`, scaled so one half of the desktop fits `viewer`.
// Callbacks are skipped once isCurrent() turns false.
export function openRemoteSession({ ticket, container, viewer, touchMode = 'relative', pointerSpeed = 1, pane = 0, isCurrent, onBitrate, onError, onState }) {
  let closed = false;
  let connected = false;
  const tunnel = new Guacamole.WebSocketTunnel('/tunnel');
  const session = new Guacamole.Client(tunnel);
  const handleInstruction = tunnel.oninstruction;
  tunnel.oninstruction = (opcode, args) => {
    if (!isCurrent()) return;
    if (opcode === 'app-bitrate') onBitrate(args[0]);
    else handleInstruction(opcode, args);
  };
  const display = session.getDisplay();
  const element = display.getElement();
  element.tabIndex = 0;
  element.setAttribute('aria-label', 'リモートデスクトップへの入力');
  container.replaceChildren(element);
  element.style.cursor = 'none';
  // Discarding this element also discards Guacamole's input listeners.
  const keyboard = new Guacamole.Keyboard(element);
  keyboard.onkeydown = keysym => { session.sendKeyEvent(1, keysym); return false; };
  keyboard.onkeyup = keysym => session.sendKeyEvent(0, keysym);
  element.addEventListener('pointerdown', () => element.focus({ preventScroll: true }));
  const sender = createMouseSender(session, display);
  const send = event => {
    if (event.type === 'mousemove') sender.move(event.state);
    else sender.send(event.state);
  };
  const mouse = new Guacamole.Mouse(element);
  mouse.onEach(['mousedown', 'mousemove', 'mouseup'], event => {
    display.showCursor(true);
    send(event);
  });
  mouse.on('mouseout', () => display.showCursor(touchMode === 'relative'));
  let touch = null;
  const syncTouchPosition = () => {
    if (!touch) return;
    touch.state.x = display.cursorX * display.getScale();
    touch.state.y = display.cursorY * display.getScale();
  };
  // Start at the current cursor, including after physical mouse input.
  element.addEventListener('touchstart', syncTouchPosition, { passive: true });
  const setTouchMode = mode => {
    touch?.dispose();
    mouse.reset();
    touchMode = mode;
    touch = createTouchMouse(element, mode, event => {
      mouse.currentState.x = event.state.x;
      mouse.currentState.y = event.state.y;
      display.showCursor(touchMode === 'relative');
      send(event);
    }, () => pointerSpeed);
    syncTouchPosition();
    display.showCursor(touchMode === 'relative');
  };
  const reset = () => {
    if (closed) return;
    keyboard.reset();
    setTouchMode(touchMode);
  };
  element.addEventListener('blur', reset);
  element.addEventListener('touchcancel', reset);
  setTouchMode(touchMode);
  // The desktop is two viewers wide; show only the left (0) or right (1) half.
  const fit = () => {
    const width = display.getWidth() / 2;
    const height = display.getHeight();
    if (!width || !height) return;
    const scale = Math.min(viewer.clientWidth / width, viewer.clientHeight / height);
    display.scale(scale);
    // left/top, not transform: Guacamole's mouse position math follows offsetLeft/offsetTop.
    container.style.left = `${(viewer.clientWidth - width * scale) / 2 - pane * width * scale}px`;
    container.style.top = `${(viewer.clientHeight - height * scale) / 2}px`;
    container.style.clipPath = `inset(0 ${pane ? 0 : 50}% 0 ${pane ? 50 : 0}%)`;
    syncTouchPosition();
  };
  const setPane = value => {
    pane = value;
    fit();
  };
  const resizing = observeDisplaySize(viewer, (width, height) => {
    if (closed || !connected || !isCurrent()) return false;
    session.sendSize(width, height);
  }, () => document.getElementById('text-dialog').open);
  display.onresize = fit;
  session.onerror = error => { if (isCurrent()) onError(error); };
  // A dropped WebSocket must also end the session so the page learns it is disconnected.
  tunnel.onerror = error => { session.onerror(error); session.disconnect(); };
  session.onstatechange = state => {
    connected = state === Guacamole.Client.State.CONNECTED;
    if (isCurrent()) onState(state);
  };
  session.connect(`ticket=${encodeURIComponent(ticket)}`);
  const requireConnection = () => {
    if (closed || !isCurrent() || !connected) {
      throw new Error('接続が切れたため送信できませんでした。');
    }
  };
  const pressKey = keysym => {
    session.sendKeyEvent(1, keysym);
    session.sendKeyEvent(0, keysym);
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 150));
  return {
    fit,
    refreshSize: () => resizing.refresh(true),
    setPane,
    setTouchMode,
    setPointerSpeed: value => { pointerSpeed = value; },
    focus: () => element.focus({ preventScroll: true }),
    reset,
    async sendText(text, enter = false) {
      requireConnection();
      keyboard.reset();
      // TextEncoder preserves surrogate pairs (emoji). Guacamole chunks the
      // UTF-8 bytes into clipboard blobs within its protocol size limit.
      const writer = new Guacamole.ArrayBufferWriter(session.createClipboardStream('text/plain'));
      writer.sendData(new TextEncoder().encode(text.replace(/\r\n?|\n/g, '\r\n')));
      writer.sendEnd();
      // CLIPRDR propagation and application paste handling are asynchronous.
      await pause();
      requireConnection();
      session.sendKeyEvent(1, 0xffe3); // Control_L
      pressKey(0x76); // v
      session.sendKeyEvent(0, 0xffe3);
      if (enter) {
        await pause();
        requireConnection();
        pressKey(0xff0d); // Return
      }
    },
    close() {
      closed = true;
      resizing.dispose();
      touch.dispose();
      mouse.reset();
      sender.dispose();
      keyboard.reset();
      session.onstatechange = session.onerror = null;
      session.disconnect();
      container.replaceChildren();
    },
  };
}
