import test from 'node:test';
import assert from 'node:assert/strict';
import { createMouseSender } from '../src/client/input/mouse.js';

function setup(t) {
  let now = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => now);
  const sent = [];
  const cursors = [];
  const sender = createMouseSender({ sendMouseState: (state, scaled) => {
    assert.equal(scaled, true);
    sent.push({ ...state });
  } }, { getScale: () => 0.5, moveCursor: (x, y) => cursors.push([x, y]) });
  const tick = ms => { now += ms; t.mock.timers.tick(ms); };
  return { sender, sent, cursors, tick };
}

test('a burst sends the latest mouse position while the local cursor follows every event', t => {
  const { sender, sent, cursors, tick } = setup(t);
  const state = { x: 1, y: 2, left: false };
  sender.move(state);
  for (let x = 2; x <= 100; x++) { state.x = x; sender.move(state); }
  assert.equal(sent.length, 1);
  assert.equal(cursors.length, 100);
  assert.deepEqual(cursors.at(-1), [200, 4]);
  // Mutation without a new event must not change the pending snapshot.
  state.x = 999;
  tick(17);
  assert.deepEqual(sent.map(state => state.x), [1, 100]);
  tick(100);
  assert.equal(sent.length, 2);
});

test('click, drag release and wheel transitions are immediate and never followed by stale moves', t => {
  const { sender, sent, tick } = setup(t);
  sender.move({ x: 1, y: 1, left: false });
  sender.move({ x: 2, y: 2, left: false });
  sender.send({ x: 3, y: 3, left: true });
  sender.move({ x: 4, y: 4, left: true });
  sender.send({ x: 5, y: 5, left: false });
  sender.send({ x: 5, y: 5, left: false, down: true });
  sender.send({ x: 5, y: 5, left: false, down: false });
  assert.deepEqual(sent.map(state => [state.x, state.left, state.down]), [
    [1, false, undefined], [3, true, undefined], [5, false, undefined], [5, false, true], [5, false, false],
  ]);
  tick(100);
  assert.equal(sent.length, 5);
});

test('disconnect discards pending movement and stops subsequent sends', t => {
  const { sender, sent, tick } = setup(t);
  sender.move({ x: 1, y: 1 });
  sender.move({ x: 2, y: 2 });
  sender.dispose();
  tick(100);
  sender.move({ x: 3, y: 3 });
  sender.send({ x: 4, y: 4, left: true });
  assert.equal(sent.length, 1);
});
