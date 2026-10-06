// Header button and floating palette that send key presses and shortcuts to the remote desktop.
// The palette can be dragged by its handle and stays inside the viewer.
export function createSpecialKeys(sendKeys) {
  const $ = id => document.getElementById(id);
  const button = $('keys-button');
  const palette = $('keys-palette');
  const move = $('keys-move');
  const margin = 8;
  let connected = false;
  let position = null;
  let drag = null;

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
  button.addEventListener('click', () => update(palette.hidden));
  palette.addEventListener('click', event => {
    const key = event.target.closest('button[data-keys]');
    if (key) sendKeys(key.dataset.keys.split(' ').map(code => parseInt(code, 16)));
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
      update(connected && !palette.hidden);
    },
  };
}
