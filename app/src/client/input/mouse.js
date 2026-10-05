export const MOUSE_MOVE_INTERVAL_MS = 1000 / 60;

export function createTouchMouse(element, mode, onEvent) {
  const controller = new AbortController();
  let disposed = false;
  let touching = false;
  let swipe = null;
  // Guacamole has no listener disposal API. Scope its DOM listeners to this
  // mode while forwarding element geometry unchanged.
  const target = new Proxy(element, {
    get(target, property) {
      if (property !== 'addEventListener') return Reflect.get(target, property, target);
      return (type, listener) => target.addEventListener(type, event => {
        if (type === 'touchstart') touching = true;
        if (!touching) return;
        if (mode === 'direct' && type === 'touchstart') {
          const finger = event.touches[0];
          swipe = event.touches.length === 1 && !mouse.currentState.left ? {
            id: finger.identifier, x: finger.clientX, y: finger.clientY,
            lastY: finger.clientY, remainder: 0, scrolling: false,
          } : null;
        }
        if (type === 'touchend' && swipe?.scrolling) {
          event.preventDefault();
          // End Guacamole's gesture without turning a swipe back to its
          // origin into a tap. This also clears its pending long press.
          listener({ touches: [], changedTouches: [] });
        } else listener(event);
        if (type === 'touchmove' && swipe && event.touches.length === 1) {
          const finger = event.touches[0];
          if (finger.identifier !== swipe.id) return;
          event.preventDefault();
          if (!swipe.scrolling && Math.hypot(finger.clientX - swipe.x, finger.clientY - swipe.y) >= mouse.clickMoveThreshold) {
            swipe.scrolling = true;
            // Scroll the content under the initial contact, without clicking.
            mouse.move(window.Guacamole.Position.fromClientPosition(target, swipe.x, swipe.y));
          }
          if (swipe.scrolling) {
            swipe.remainder += swipe.lastY - finger.clientY;
            swipe.lastY = finger.clientY;
            while (Math.abs(swipe.remainder) >= mouse.scrollThreshold) {
              const down = swipe.remainder > 0;
              mouse.click(down ? 'down' : 'up');
              swipe.remainder += down ? -mouse.scrollThreshold : mouse.scrollThreshold;
            }
          }
        }
        if (type === 'touchend' && event.touches.length === 0) {
          touching = false;
          swipe = null;
        }
      }, { passive: false, signal: controller.signal });
    },
  });
  const Mouse = window.Guacamole.Mouse;
  const mouse = mode === 'relative' ? new Mouse.Touchpad(target) : new Mouse.Touchscreen(target);
  if (mode === 'direct') mouse.clickMoveThreshold = 8;
  mouse.onEach(['mousedown', 'mousemove', 'mouseup'], event => {
    // Delayed clicks/long presses from a previous mode must not reach RDP.
    if (!disposed) {
      if (event.state.right) swipe = null;
      onEvent(event);
    }
  });
  return {
    state: mouse.currentState,
    dispose() {
      controller.abort();
      mouse.reset();
      disposed = true;
    },
  };
}

export function createMouseSender(session, display) {
  let pending = null;
  let timer = null;
  let lastSentAt = -Infinity;
  let disposed = false;
  const clearPending = () => {
    clearTimeout(timer);
    timer = pending = null;
  };
  const transmit = state => {
    lastSentAt = performance.now();
    session.sendMouseState(state, true);
  };
  return {
    move(state) {
      if (disposed) return;
      // The local cursor stays immediate even while remote moves are combined.
      const scale = display.getScale();
      display.moveCursor(Math.floor(state.x / scale), Math.floor(state.y / scale));
      // Guacamole mutates its state object for subsequent events.
      pending = { ...state };
      const delay = MOUSE_MOVE_INTERVAL_MS - (performance.now() - lastSentAt);
      if (delay <= 0) {
        const latest = pending;
        clearPending();
        transmit(latest);
      } else if (timer === null) {
        timer = setTimeout(() => {
          const latest = pending;
          clearPending();
          transmit(latest);
        }, delay);
      }
    },
    send(state) {
      if (disposed) return;
      // Button/wheel transitions carry the newest position and bypass batching.
      clearPending();
      transmit({ ...state });
    },
    dispose() {
      disposed = true;
      clearPending();
    },
  };
}
