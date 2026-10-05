// Keep the remote desktop sized to two panes; ignore keyboard-only height changes.
export function observeDisplaySize(viewer, sendSize, isSuspended) {
  let timer;
  let forcePending = false;
  let last;
  const sync = () => {
    const force = forcePending;
    forcePending = false;
    const width = viewer.clientWidth * 2, height = viewer.clientHeight;
    if (!width || !height) return;
    if (isSuspended() && last && width === last.width && height !== last.height) return;
    if (!force && last && width === last.width && height === last.height) return;
    if (sendSize(width, height) !== false) last = { width, height };
  };
  const refresh = (force = false) => {
    forcePending ||= force;
    clearTimeout(timer);
    timer = setTimeout(sync, 120);
  };
  const observer = new ResizeObserver(() => refresh());
  observer.observe(viewer);
  return {
    refresh,
    dispose() {
      clearTimeout(timer);
      observer.disconnect();
    },
  };
}
