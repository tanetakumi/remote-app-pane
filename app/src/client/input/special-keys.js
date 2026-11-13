// Toolbar button and floating palette that send key presses and shortcuts to the remote desktop.
// Tapping toggles the palette, which can be dragged by its handle and stays inside the viewer.
// Holding pops up quick keys above the button; sliding onto one and releasing sends it once.
export function createSpecialKeys(sendKeys) {
  const $ = id => document.getElementById(id);
  const button = $('keys-button');
  const palette = $('keys-palette');
  const move = $('keys-move');
  const quick = $('keys-quick');
  const quickKeys = [...quick.querySelectorAll('button')];
  const margin = 8;
  let connected = false;
  let position = null;
  let drag = null;
  let hold = null;
  let suppressClick = false;

  const send = key => {
    if (connected) sendKeys(key.dataset.keys.split(' ').map(code => parseInt(code, 16)));
  };
  const select = (x, y) => {
    let selected = null;
    for (const key of quickKeys) {
      const rect = key.getBoundingClientRect();
      const hit = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      key.dataset.selected = String(hit);
      if (hit) selected = key;
    }
    return selected;
  };
  const cancelHold = () => {
    const current = hold;
    hold = null; // Cleared first so the lostpointercapture from the release below is ignored.
    if (current) {
      clearTimeout(current.timer);
      if (button.hasPointerCapture(current.id)) button.releasePointerCapture(current.id);
    }
    quick.hidden = true;
    button.classList.remove('key-holding');
    button.setAttribute('aria-expanded', String(!palette.hidden));
  };
  button.addEventListener('pointerdown', event => {
    if (!connected || !event.isPrimary || event.button !== 0 || hold) return;
    event.preventDefault();
    suppressClick = false;
    button.setPointerCapture(event.pointerId);
    button.classList.add('key-holding');
    hold = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      suppressClick = true;
      update(false);
      quick.hidden = false;
      const rect = button.getBoundingClientRect();
      const x = Math.max(8, Math.min(rect.left + rect.width / 2 - quick.offsetWidth / 2,
        window.innerWidth - quick.offsetWidth - 8));
      const y = rect.top - quick.offsetHeight - 12;
      Object.assign(quick.style, { left: `${x}px`, top: `${Math.max(8, Math.min(y, window.innerHeight - quick.offsetHeight - 8))}px` });
      select(-1, -1);
      button.setAttribute('aria-expanded', 'true');
    }, 350) };
  });
  button.addEventListener('pointermove', event => {
    if (hold?.id !== event.pointerId) return;
    if (!quick.hidden) select(event.clientX, event.clientY);
    else if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 12) {
      suppressClick = true;
      cancelHold();
    }
  });
  button.addEventListener('pointerup', event => {
    if (hold?.id !== event.pointerId) return;
    const key = quick.hidden ? null : select(event.clientX, event.clientY);
    cancelHold();
    if (key) send(key);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) button.addEventListener(type, () => {
    if (hold) { suppressClick = true; cancelHold(); }
  });
  button.addEventListener('contextmenu', event => event.preventDefault());
  for (const type of ['resize', 'blur', 'pagehide']) window.addEventListener(type, () => {
    if (hold) suppressClick = true;
    cancelHold();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHold(); });

  const clamp = (value, max) => Math.min(Math.max(value, margin), Math.max(margin, max));
  const place = point => {
    if (!point || palette.hidden) return;
    const viewer = palette.parentElement;
    position = {
      x: clamp(point.x, viewer.clientWidth - palette.offsetWidth - margin),
      y: clamp(point.y, viewer.clientHeight - palette.offsetHeight - margin),
    };
    Object.assign(palette.style, { left: `${position.x}px`, top: `${position.y}px`, right: 'auto' });
  };
  const update = open => {
    palette.hidden = !open;
    button.disabled = !connected;
    button.setAttribute('aria-expanded', String(open));
    for (const key of palette.querySelectorAll('button')) key.disabled = !connected;
    place(position);
  };
  button.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
    if (connected) update(palette.hidden);
  });
  palette.addEventListener('click', event => {
    const key = event.target.closest('button[data-keys]');
    if (key) send(key);
  });
  move.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const viewer = palette.parentElement.getBoundingClientRect();
    const rect = palette.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - rect.left + viewer.left, y: event.clientY - rect.top + viewer.top };
    move.setPointerCapture(event.pointerId);
  });
  move.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) place({ x: event.clientX - drag.x, y: event.clientY - drag.y });
  });
  for (const type of ['pointerup', 'pointercancel']) {
    move.addEventListener(type, event => { if (drag?.id === event.pointerId) drag = null; });
  }
  window.addEventListener('resize', () => place(position));
  update(false);
  return {
    setConnected(value) {
      connected = value;
      if (!connected) cancelHold();
      update(connected && !palette.hidden);
    },
  };
}
