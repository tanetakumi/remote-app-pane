import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTouchMouse } from '../src/client/input/mouse.js';

function setup(mode, speed = () => 1, settings = { scrollSensitivity: 1, scrollAcceleration: 0, longPressMs: 700 }) {
  // Guacamole's single-finger acceleration reads the clock; pin it for exact deltas.
  const clock = { now: 0 };
  const sandbox = { window: { devicePixelRatio: 1, setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) }, document: {}, Date: class { getTime() { return clock.now; } } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/vendor/guacamole-1.6.0.js', import.meta.url), 'utf8'), sandbox);
  globalThis.window = { Guacamole: sandbox.Guacamole };
  const listeners = {};
  const element = {
    offsetWidth: 1000, offsetHeight: 1000, offsetLeft: 0, offsetTop: 0, offsetParent: null,
    addEventListener: (type, listener) => { (listeners[type] ??= []).push(listener); },
  };
  const events = [];
  createTouchMouse(element, mode, event => events.push({
    type: event.type, right: event.state.right, up: event.state.up, down: event.state.down, x: event.state.x, y: event.state.y,
  }), speed, settings);
  const touch = (type, ys, xs = ys.map((_, identifier) => 100 + identifier * 50)) => {
    const touches = ys.map((y, identifier) => ({ identifier, clientX: xs[identifier], clientY: y }));
    for (const listener of listeners[type] ?? []) listener({ touches, changedTouches: touches, timeStamp: clock.now, preventDefault() {} });
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

test('pointer speed scales relative cursor movement, follows live changes, and stays inside the screen', () => {
  let speed = 1;
  const { events, touch, clock } = setup('relative', () => speed);
  const moves = () => events.filter(event => event.type === 'mousemove');
  const drag = (to, from = [100, 100]) => {
    touch('touchstart', [from[1]], [from[0]]);
    clock.now += 100;
    touch('touchmove', [to[1]], [to[0]]);
    touch('touchend', []);
  };
  drag([110, 100]);
  const normal = moves().at(-1);
  assert.ok(normal.x > 10, 'Guacamole acceleration still applies');
  speed = 2;
  drag([110, 100]);
  const doubled = moves().at(-1).x - normal.x;
  assert.ok(Math.abs(doubled - normal.x * 2) < 1e-9);
  speed = 0.5;
  drag([110, 100]);
  assert.ok(Math.abs(moves().at(-1).x - moves().at(-2).x - normal.x / 2) < 1e-9);
  speed = 3;
  drag([1000, 1000], [0, 0]);
  assert.deepEqual([moves().at(-1).x, moves().at(-1).y], [999, 999]);
});

test('mouse mode right-clicks on a long press of the live set duration, not on a two-finger tap', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const buttons = events => events.filter(event => event.type !== 'mousemove').map(event => `${event.type}:${event.right}`);
    const settings = { scrollSensitivity: 1, scrollAcceleration: 0, longPressMs: 700 };
    const long = setup('relative', () => 1, settings);
    long.touch('touchstart', [100]);
    mock.timers.tick(699);
    assert.deepEqual(buttons(long.events), []);
    mock.timers.tick(1);
    long.clock.now += 700;
    long.touch('touchend', []);
    assert.deepEqual(buttons(long.events), ['mousedown:true', 'mouseup:false']);
    settings.longPressMs = 300;
    long.touch('touchstart', [100]);
    mock.timers.tick(300);
    assert.deepEqual(buttons(long.events), ['mousedown:true', 'mouseup:false', 'mousedown:true', 'mouseup:false']);

    const moved = setup('relative');
    moved.touch('touchstart', [100]);
    moved.touch('touchmove', [150]);
    mock.timers.tick(1000);
    moved.touch('touchend', []);
    assert.deepEqual(buttons(moved.events), []);

    const two = setup('relative');
    two.touch('touchstart', [100, 100]);
    two.touch('touchend', []);
    mock.timers.tick(1000);
    assert.deepEqual(buttons(two.events), []);

    // Holding still after a tap is the start of a drag, not a right click.
    const drag = setup('relative');
    drag.touch('touchstart', [100]);
    drag.touch('touchend', []);
    drag.touch('touchstart', [100]);
    mock.timers.tick(1000);
    assert.deepEqual(buttons(drag.events), ['mousedown:false']);
  } finally {
    mock.timers.reset();
  }
});

test('one-finger swipe in Tap mode scrolls before a full threshold of movement', () => {
  const { events, touch } = setup('direct');
  touch('touchstart', [100], [100]);
  touch('touchmove', [112], [100]);
  assert.deepEqual(events.filter(event => event.type === 'mousedown').map(event => [event.up, event.down]), [[true, false]]);
});

test('Tap scroll distance follows sensitivity and finger speed', () => {
  const notches = settings => {
    const { events, touch, clock } = setup('direct', () => 1, settings);
    touch('touchstart', [100], [100]);
    clock.now = settings.ms;
    touch('touchmove', [160], [100]);
    return events.filter(event => event.type === 'mousedown').length;
  };
  const steady = { scrollSensitivity: 1, scrollAcceleration: 0, ms: 600 };
  assert.equal(notches({ ...steady, scrollSensitivity: 2 }) > notches(steady), true);
  assert.equal(notches({ ...steady, scrollAcceleration: 1, ms: 20 }) > notches({ ...steady, ms: 20 }), true);
  assert.equal(notches({ ...steady, scrollAcceleration: 1 }), notches(steady));
});
