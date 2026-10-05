import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTouchMouse } from '../src/client/input/mouse.js';

function setup(mode) {
  // Guacamole's single-finger acceleration reads the clock; pin it for exact deltas.
  const clock = { now: 0 };
  const sandbox = { window: { devicePixelRatio: 1 }, document: {}, Date: class { getTime() { return clock.now; } } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/vendor/guacamole-1.6.0.js', import.meta.url), 'utf8'), sandbox);
  globalThis.window = { Guacamole: sandbox.Guacamole };
  const listeners = {};
  const element = {
    offsetWidth: 1000, offsetHeight: 1000, offsetLeft: 0, offsetTop: 0, offsetParent: null,
    addEventListener: (type, listener) => { (listeners[type] ??= []).push(listener); },
  };
  const events = [];
  createTouchMouse(element, mode, event => events.push({
    type: event.type, up: event.state.up, down: event.state.down, x: event.state.x, y: event.state.y,
  }));
  const touch = (type, ys, xs = ys.map((_, identifier) => 100 + identifier * 50)) => {
    const touches = ys.map((y, identifier) => ({ identifier, clientX: xs[identifier], clientY: y }));
    for (const listener of listeners[type] ?? []) listener({ touches, changedTouches: touches, preventDefault() {} });
  };
  return { events, touch, clock };
}

test('two-finger swipe in mouse mode moves content with the fingers', () => {
  const { events, touch } = setup('relative');
  touch('touchstart', [100, 100]);
  touch('touchmove', [200, 200]);
  assert.deepEqual(events.filter(event => event.type === 'mousedown').map(event => [event.up, event.down]), [[true, false]]);
  touch('touchmove', [100, 100]);
  assert.deepEqual(events.filter(event => event.type === 'mousedown').map(event => [event.up, event.down]).at(-1), [false, true]);
});
