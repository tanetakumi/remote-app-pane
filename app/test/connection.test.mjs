import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from '../src/client/core/connection.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup(t, retained = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attempts = [], states = [];
  let visible = true, fail = false;
  const connection = createConnection({
    visible: () => visible,
    parameters: async () => ({}),
    request: async path => {
      if (fail) throw new Error('offline');
      return path === '/api/status' ? { retained, configuredCredentials: true } : { ticket: 'ticket' };
    },
    open: options => {
      const remote = { close() {}, check: async () => true };
      attempts.push({ options, remote });
      return remote;
    },
    onState: (state, message) => states.push([state, message]),
    onConfigured() {},
  });
  t.after(() => connection.stop());
  return { connection, attempts, states,
    setVisible: value => { visible = value; }, setFail: value => { fail = value; }, setRetained: value => { retained = value; } };
}

test('retries a retained session after failure, pauses hidden, and coalesces resume events', async t => {
  const h = setup(t);
  h.connection.restore(); await flush();
  assert.equal(h.attempts.length, 1);
  h.attempts[0].options.onState(3);
  h.setFail(true);
  h.attempts[0].options.onState(5); await flush();
  assert.equal(h.states.at(-1)[0], 'reconnecting');
  h.setVisible(false); h.connection.suspend();
  h.setFail(false); t.mock.timers.tick(60000); await flush();
  assert.equal(h.attempts.length, 1);
  h.setVisible(true);
  h.connection.resume(); h.connection.resume(); await flush();
  assert.equal(h.attempts.length, 2);
  h.attempts[1].options.onState(3);
  h.connection.resume(); await flush();
  assert.equal(h.attempts.length, 2);
});

test('stop cancels retries and ignores a late successful status response', async t => {
  const h = setup(t);
  h.connection.restore(); await flush();
  h.attempts[0].options.onState(3);
  h.setFail(true); h.attempts[0].options.onState(5); await flush();
  h.connection.stop(); h.setFail(false);
  t.mock.timers.tick(60000); await flush();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.states.at(-1)[0], 'idle');
  let resolve;
  const connection = createConnection({ request: () => new Promise(r => { resolve = r; }),
    visible: () => true, parameters: async () => ({}), open: () => assert.fail('late connection'),
    onState() {}, onConfigured() {} });
  connection.restore(); connection.stop(); resolve({ retained: true }); await flush();
});

test('an unresponsive open socket is replaced; initial failure is not retried', async t => {
  const h = setup(t);
  h.connection.restore(); await flush(); h.attempts[0].options.onState(3);
  h.attempts[0].remote.check = async () => false;
  h.connection.resume(); await flush(); t.mock.timers.tick(0); await flush();
  assert.equal(h.attempts.length, 2);
  // Obsolete close callbacks must not destroy the replacement.
  h.attempts[0].options.onState(5); await flush();
  assert.equal(h.attempts.length, 2);
  h.connection.stop(); h.setFail(true);
  h.connection.connect(); await flush();
  t.mock.timers.tick(60000); await flush();
  assert.equal(h.states.at(-1)[0], 'idle');
});

test('retries in the foreground with backoff and stops on permission errors', async t => {
  const h = setup(t);
  h.connection.restore(); await flush(); h.attempts[0].options.onState(3);
  h.setFail(true); h.attempts[0].options.onState(5);
  t.mock.timers.tick(0); await flush();
  h.setFail(false);
  t.mock.timers.tick(999); await flush(); assert.equal(h.attempts.length, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(h.attempts.length, 2);
  h.attempts[1].options.onState(3);
  h.attempts[1].options.onError({ code: 771, message: 'forbidden' });
  h.attempts[1].options.onState(5);
  t.mock.timers.tick(60000); await flush();
  assert.equal(h.attempts.length, 2);
  assert.deepEqual(h.states.at(-1), ['idle', 'forbidden']);
});

test('resume only opens retained sessions and bounds the wait for the first frame', async t => {
  const h = setup(t, false);
  h.connection.restore(); await flush();
  assert.equal(h.attempts.length, 0);
  assert.equal(h.connection.active, false);
  h.connection.connect(); await flush();
  assert.equal(h.attempts.length, 1);
  t.mock.timers.tick(20000); await flush();
  assert.equal(h.states.at(-1)[0], 'idle');
  assert.match(h.states.at(-1)[1], /タイムアウト/);
});

test('a lost retained session stops recovery without opening a fresh session', async t => {
  const h = setup(t);
  h.connection.restore(); await flush(); h.attempts[0].options.onState(3);
  h.setRetained(false);
  h.attempts[0].options.onState(5);
  t.mock.timers.tick(0); await flush();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.connection.active, false);
  assert.match(h.states.at(-1)[1], /終了/);
  // The upstream reason for the end is kept rather than replaced.
  h.setRetained(true); h.connection.restore(); await flush();
  h.attempts[1].options.onState(3);
  h.setRetained(false);
  h.attempts[1].options.onError({ code: 519, message: 'taken over' });
  h.attempts[1].options.onState(5);
  t.mock.timers.tick(0); await flush();
  assert.match(h.states.at(-1)[1], /taken over/);
});
