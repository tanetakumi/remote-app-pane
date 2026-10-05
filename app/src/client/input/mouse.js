export const MOUSE_MOVE_INTERVAL_MS = 1000 / 60;
const LONG_PRESS_MS = 500;

export function createTouchMouse(element, mode, onEvent, getSpeed) {
  const controller = new AbortController();
  let disposed = false;
  let touching = false;
  let swipe = null;
  let longPress = null;
  const cancelLongPress = () => {
    clearTimeout(longPress?.timer);
    longPress = null;
  };
  // A single finger held still sends a right click, unless it continues a tap-drag.
  const trackLongPress = (type, event) => {
    if (type === 'touchstart') {
      cancelLongPress();
      if (event.touches.length !== 1 || mouse.currentState.left) return;
      const { clientX: x, clientY: y } = event.touches[0];
      longPress = {
        x, y,
        timer: setTimeout(() => {
          longPress = null;
          press.call(mouse, 'right', event);
          release.call(mouse, 'right', event);
        }, LONG_PRESS_MS),
      };
    } else if (type === 'touchmove' && longPress) {
      const { clientX, clientY } = event.touches[0];
      if (Math.hypot(clientX - longPress.x, clientY - longPress.y) >= mouse.clickMoveThreshold) cancelLongPress();
    } else if (type === 'touchend') cancelLongPress();
  };
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
        if (mode === 'relative') trackLongPress(type, event);
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
  const { press, release } = mouse;
  if (mode === 'direct') mouse.clickMoveThreshold = 8;
  else {
    // Touchpad taps with two or three fingers press right/middle; only the long press may.
    const ignored = new Set(['right', 'middle']);
    mouse.press = (button, events) => !ignored.has(button) && press.call(mouse, button, events);
    mouse.release = (button, events) => !ignored.has(button) && release.call(mouse, button, events);
    // Touchpad sends a two-finger swipe down as wheel-down; make content follow the fingers.
    const click = mouse.click;
    const reversed = { up: 'down', down: 'up' };
    mouse.click = (button, events) => click.call(mouse, reversed[button] ?? button, events);
    // Scale Touchpad's (already accelerated) step; it only moves the cursor inside this call.
    const move = mouse.move;
    mouse.move = (position, events) => {
      const speed = getSpeed();
      const { x, y } = mouse.currentState;
      move.call(mouse, {
        x: Math.min(Math.max(0, x + (position.x - x) * speed), element.offsetWidth - 1),
        y: Math.min(Math.max(0, y + (position.y - y) * speed), element.offsetHeight - 1),
      }, events);
    };
  }
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
      cancelLongPress();
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
