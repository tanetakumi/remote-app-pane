import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { openSettings } from '../src/server/settings.mjs';
import { rdpDimensions } from '../src/server/dimensions.mjs';
import { createTestApp } from './helpers.mjs';

const defaults = { resolutionScale: 1.2, pointerSpeed: 1, websocketCompressionLevel: 1 };
function location(t) {
  const dir = mkdtempSync(join(tmpdir(), 'remote-app-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'data', 'config.json');
}

test('settings generate defaults, persist edits, and preserve current values on failed saves', t => {
  const path = location(t);
  const settings = openSettings(path);
  assert.deepEqual(settings.get(), defaults);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), defaults);
  const next = { resolutionScale: 1.5, pointerSpeed: 2.5, websocketCompressionLevel: 0 };
  settings.set(next);
  next.resolutionScale = 4;
  assert.equal(settings.get().resolutionScale, 1.5);
  assert.deepEqual(openSettings(path).get(), { resolutionScale: 1.5, pointerSpeed: 2.5, websocketCompressionLevel: 0 });
  const copy = settings.get();
  copy.resolutionScale = 3;
  assert.equal(settings.get().resolutionScale, 1.5);
  const dir = dirname(path);
  renameSync(dir, dir + '-backup');
  writeFileSync(dir, 'not a directory');
  assert.throws(() => settings.set(defaults));
  assert.equal(settings.get().resolutionScale, 1.5);
  assert.deepEqual(JSON.parse(readFileSync(join(dir + '-backup', 'config.json'), 'utf8')), settings.get());
});

test('settings reject malformed, missing, unknown, and out-of-range values', t => {
  const path = location(t);
  const settings = openSettings(path);
  for (const invalid of [null, [], {}, { ...defaults, extra: true }, { ...defaults, resolutionScale: null },
    { ...defaults, resolutionScale: '1.2' }, { ...defaults, resolutionScale: 0.4 }, { ...defaults, resolutionScale: 4.1 },
    { ...defaults, pointerSpeed: null }, { ...defaults, pointerSpeed: '1' }, { ...defaults, pointerSpeed: 0.4 },
    { ...defaults, pointerSpeed: 3.1 }, { resolutionScale: 1.2, websocketCompressionLevel: 1 },
    { ...defaults, websocketCompressionLevel: 1.5 }, { ...defaults, websocketCompressionLevel: -1 },
    { ...defaults, websocketCompressionLevel: 10 }]) {
    assert.throws(() => settings.set(invalid), /settings/);
    writeFileSync(path, JSON.stringify(invalid));
    assert.throws(() => openSettings(path), /settings/);
  }
  writeFileSync(path, '{bad json');
  assert.throws(() => openSettings(path), /config.json/);
  assert.deepEqual(settings.get(), defaults);
});

test('RDP dimensions scale once, fit within bounds, and round the width to even pixels', () => {
  assert.deepEqual(rdpDimensions(2560, 850, 1.2), { width: 3072, height: 1020 });
  assert.deepEqual(rdpDimensions(8000, 4000, 1.2), { width: 4096, height: 2048 });
  assert.deepEqual(rdpDimensions(1000, 8000, 4), { width: 512, height: 4096 });
  assert.deepEqual(rdpDimensions(781, 795, 1.2), { width: 938, height: 954 });
  assert.deepEqual(rdpDimensions(20, 10, 0.5), { width: 200, height: 200 });
  for (const value of [0, -1, 1.5, NaN, Infinity, '640', undefined]) {
    assert.throws(() => rdpDimensions(value, 720, 1.2));
    assert.throws(() => rdpDimensions(1280, value, 1.2));
  }
});

test('settings API persists validated edits, rejects other origins, and reports storage failure', async t => {
  const { server, settings } = createTestApp(t, {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const save = (data, from = origin) => fetch(origin + '/api/settings', { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(data) });
  assert.deepEqual(await (await fetch(origin + '/api/settings')).json(), defaults);
  assert.equal((await save(defaults, 'http://wrong.example')).status, 403);
  assert.equal((await save({ ...defaults, websocketCompressionLevel: 10 })).status, 400);
  const next = { resolutionScale: 1.8, pointerSpeed: 0.5, websocketCompressionLevel: 9 };
  assert.deepEqual(await (await save(next)).json(), next);
  assert.deepEqual(settings.get(), next);
  settings.set = () => { throw new Error('disk unavailable'); };
  assert.equal((await save(defaults)).status, 500);
  assert.deepEqual(await (await fetch(origin + '/api/settings')).json(), next);
});
