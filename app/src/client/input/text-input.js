export function createTextInput(sendText) {
  const $ = id => document.getElementById(id);
  const button = $('text-button');
  const dialog = $('text-dialog');
  const input = $('remote-text-input');
  const error = $('text-input-error');
  const send = $('send-text');
  const sendEnter = $('send-text-enter');
  const closeButton = $('close-text');
  let connected = false;
  let active = false;
  let composing = false;
  let sending = false;
  let touchClosing = false;
  let backdropPress = false;

  const update = () => {
    button.disabled = !connected || sending;
    button.setAttribute('aria-expanded', String(active));
    input.readOnly = sending;
    send.disabled = sendEnter.disabled = !connected || !active || composing || sending || !input.value;
  };
  const positionDialog = () => {
    if (!active) return;
    const viewport = window.visualViewport;
    dialog.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`);
    dialog.style.setProperty('--visible-left', `${viewport?.offsetLeft ?? 0}px`);
    dialog.style.setProperty('--visible-width', `${viewport?.width ?? window.innerWidth}px`);
    dialog.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
  };
  const finishClosing = () => {
    if (!active) return;
    active = composing = false;
    input.blur();
    update();
    window.scrollTo(0, 0);
    if (touchClosing) button.blur();
    else if (connected) button.focus({ preventScroll: true });
  };
  const close = () => {
    dialog.close();
    finishClosing();
  };
  button.addEventListener('click', () => {
    if (!connected || active || sending) return;
    active = true;
    touchClosing = false;
    positionDialog();
    dialog.showModal();
    update();
    input.focus({ preventScroll: true });
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    if (!dialog.open) finishClosing();
  });
  dialog.addEventListener('cancel', event => {
    touchClosing = false;
    if (composing) event.preventDefault();
  });
  dialog.addEventListener('keydown', () => { touchClosing = false; });
  const outsideDialog = event => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener('pointerdown', event => {
    touchClosing = event.pointerType === 'touch';
    backdropPress = event.target === dialog && outsideDialog(event);
  });
  dialog.addEventListener('click', event => {
    if (backdropPress && event.target === dialog && outsideDialog(event)) close();
    backdropPress = false;
  });
  input.addEventListener('input', update);
  input.addEventListener('compositionstart', () => { composing = true; update(); });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  for (const item of [closeButton, send, sendEnter]) {
    // As in web-ui, retain textarea focus until click. Closing the keyboard
    // on pointerdown can move the close button before the touch completes.
    item.addEventListener('pointerdown', event => {
      if (active && event.pointerType === 'touch' && event.isPrimary && event.button === 0) {
        touchClosing = true;
        event.preventDefault();
      }
    });
  }
  for (const item of [send, sendEnter]) {
    item.addEventListener('click', async () => {
      if (!connected || composing || sending || !input.value) return;
      sending = true;
      error.textContent = '';
      update();
      try {
        await sendText(input.value, item === sendEnter);
        input.value = '';
        close();
      } catch (cause) {
        error.textContent = cause.message || '送信できませんでした。';
      } finally {
        sending = false;
        update();
      }
    });
  }
  window.addEventListener('resize', positionDialog);
  window.visualViewport?.addEventListener('resize', positionDialog);
  window.visualViewport?.addEventListener('scroll', positionDialog);
  update();
  return {
    setConnected(value) {
      connected = value;
      if (!connected) close();
      update();
    },
  };
}
