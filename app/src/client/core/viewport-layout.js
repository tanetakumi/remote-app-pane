// Brave iOS resizes the layout viewport for the keyboard. Keep the background
// stable; dialogs independently follow visualViewport to stay above the keyboard.
export function preserveInputLayout(app, bar) {
  let locked = false;
  let width;
  let timer;
  const editing = () => document.activeElement?.matches(
    'textarea, input:is(:not([type]), [type="text"], [type="password"], [type="email"], [type="search"], [type="url"], [type="tel"], [type="number"])'
  ) || document.activeElement?.isContentEditable;
  const release = () => {
    app.style.removeProperty('--input-height');
    app.style.removeProperty('--input-bar-height');
    locked = false;
  };
  const lock = () => {
    width = app.clientWidth;
    app.style.setProperty('--input-height', `${app.clientHeight}px`);
    app.style.setProperty('--input-bar-height', `${bar.getBoundingClientRect().height}px`);
    locked = true;
  };
  const settle = () => {
    clearTimeout(timer);
    // Blur/close precedes the keyboard dismissal animation. Wait for both window
    // and visual viewport changes to stop before restoring the normal CSS height.
    timer = setTimeout(() => { if (!editing()) release(); }, 300);
  };
  document.addEventListener('focusin', () => {
    if (!editing()) return;
    clearTimeout(timer);
    if (!locked) lock();
  });
  document.addEventListener('focusout', () => { if (locked) settle(); });
  const resize = () => {
    if (!locked) return;
    // A width change is a real resize/rotation, rather than keyboard animation.
    if (app.clientWidth !== width) {
      release();
      if (editing()) lock();
      else clearTimeout(timer);
      return;
    }
    if (!editing()) settle();
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
}
