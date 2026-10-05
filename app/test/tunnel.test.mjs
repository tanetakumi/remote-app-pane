import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createTestApp } from './helpers.mjs';
import { instruction, InstructionParser } from '../src/server/guacamole/protocol.mjs';

test('retains the owner after browser exit, joins it without credentials, and explicitly disconnects', async t => {
  const sockets = new Set();
  const received = [];
  const fake = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const parser = new InstructionParser(parts => {
      received.push(parts);
      if (parts[0] === 'select') {
        const response = Buffer.from(instruction('args', 'VERSION_1_5_0', 'hostname', 'port', 'username', 'password', 'domain', 'security',
          'width', 'height', 'dpi', 'enable-wallpaper', 'enable-theming', 'enable-font-smoothing', 'resize-method'));
        socket.write(response.subarray(0, 9));
        setImmediate(() => socket.write(response.subarray(9)));
      }
      if (parts[0] === 'connect') {
        socket.write(instruction('ready', '$test') + instruction('name', 'デスクトップ😀') + instruction('size', 0, 640, 480));
      }
    });
    socket.on('data', chunk => parser.receive(chunk));
  });
  fake.listen(0, '127.0.0.1');
  await once(fake, 'listening');
  const { server, closeConnections, settings } = createTestApp(t, { guacdHost: '127.0.0.1', guacdPort: fake.address().port,
    rdpHost: '127.0.0.1', rdpPort: 3389, security: 'nla', ignoreCert: true,
    username: '', password: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    closeConnections();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(done => server.close(done)), new Promise(done => fake.close(done))]);
  });
  const denied = await fetch(origin + '/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://wrong.example' }, body: JSON.stringify({ width: 1280, height: 720 }) });
  assert.equal(denied.status, 403);
  const input = Buffer.from(JSON.stringify({ username: 'test-ユーザー😀', password: 'test-パスワード😀', width: 640, height: 480, webp: true }));
  const split = input.indexOf(Buffer.from('ユーザー')) + 1;
  // Force an HTTP chunk boundary inside a Japanese UTF-8 character.
  async function* chunks() {
    yield input.subarray(0, split);
    await new Promise(resolve => setTimeout(resolve, 10));
    yield input.subarray(split);
  }
  const response = await fetch(origin + '/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: chunks(), duplex: 'half' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const { ticket } = await response.json();
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + ticket, 'guacamole', { origin });
  const messages = [];
  const stream = new InstructionParser(parts => messages.push(parts));
  ws.on('message', data => stream.receive(data));
  await once(ws, 'open');
  await waitFor(() => messages.some(parts => parts[0] === 'size'));
  assert.equal(messages[0][0], '');
  assert.deepEqual(messages.find(parts => parts[0] === 'name'), ['name', 'デスクトップ😀']);
  assert.deepEqual(received.find(parts => parts[0] === 'connect'), ['connect', 'VERSION_1_5_0', '127.0.0.1', '3389',
    'test-ユーザー😀', 'test-パスワード😀', '', 'nla', '768', '576', '96', 'false', 'false', 'true', 'display-update']);
  assert.deepEqual(received.find(parts => parts[0] === 'image'), ['image', 'image/png', 'image/jpeg', 'image/webp']);
  assert.equal(ws.extensions, 'permessage-deflate');
  ws.send(instruction('size', 2560, 850));
  await waitFor(() => received.some(parts => parts[0] === 'size' && parts[1] === '3072' && parts[2] === '1020'));
  settings.set({ resolutionScale: 1.5, pointerSpeed: 1, websocketCompressionLevel: 0 });
  assert.equal(ws.extensions, 'permessage-deflate');
  ws.send(instruction('size', 2560, 850));
  await waitFor(() => received.some(parts => parts[0] === 'size' && parts[1] === '3840' && parts[2] === '1275'));
  ws.send(instruction('', 'ping', 123) + instruction('mouse', 10, 20, 1));
  await waitFor(() => received.some(parts => parts[0] === 'mouse') && messages.some(parts => parts[1] === 'ping'));
  assert.ok(!received.some(parts => parts[0] === ''));
  const reuse = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + ticket, 'guacamole', { origin });
  const rejected = await new Promise(resolve => reuse.on('unexpected-response', (_req, res) => { res.resume(); reuse.terminate(); resolve(res.statusCode); }).on('error', () => {}));
  assert.equal(rejected, 403);
  ws.send(instruction('key', 65505, 1) + instruction('mouse', 10, 20, 1) + instruction('disconnect'));
  await waitFor(() => received.some(parts => parts[0] === 'key' && parts[2] === '1'));
  ws.close();
  await once(ws, 'close');
  await waitFor(() => received.some(parts => parts[0] === 'key' && parts[2] === '0'));
  assert.equal(sockets.size, 1);
  assert.ok(!received.some(parts => parts[0] === 'disconnect'));
  assert.ok(received.some(parts => parts[0] === 'mouse' && parts[3] === '0'));
  const owner = [...sockets][0];
  owner.write(instruction('blob', 7, 'ignored') + instruction('sync', 1234));
  await waitFor(() => received.some(parts => parts[0] === 'sync' && parts[1] === '1234'));
  assert.ok(received.some(parts => parts[0] === 'ack' && parts[1] === '7'));
  const status = await fetch(origin + '/api/status', { headers: { Cookie: cookie } });
  assert.equal((await status.json()).retained, true);
  assert.equal((await (await fetch(origin + '/api/status')).json()).retained, false);
  const resume = await fetch(origin + '/api/connect', { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify({ width: 1280, height: 720 }) });
  assert.equal(resume.status, 200);
  const { ticket: next } = await resume.json();
  const joined = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + next, 'guacamole', { origin });
  const joinedMessages = [];
  const joinedParser = new InstructionParser(parts => joinedMessages.push(parts));
  joined.on('message', data => joinedParser.receive(data));
  await waitFor(() => joinedMessages.some(parts => parts[0] === 'size'));
  assert.equal(joined.extensions, '');
  assert.equal(received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length, 1);
  assert.ok(received.some(parts => parts[0] === 'select' && parts[1] === '$test'));
  joined.send(instruction('key', 98, 1));
  await waitFor(() => received.some(parts => parts[0] === 'key' && parts[1] === '98'));
  joined.close();
  await once(joined, 'close');
  await waitFor(() => sockets.size === 1);
  await waitFor(() => received.some(parts => parts[0] === 'nop'));
  assert.equal(sockets.size, 1);
  const deniedStop = await fetch(origin + '/api/disconnect', { method: 'POST', headers: {
    Origin: 'http://wrong.example', Cookie: cookie } });
  assert.equal(deniedStop.status, 403);
  assert.equal(sockets.size, 1);
  const stopped = await fetch(origin + '/api/disconnect', { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
  assert.equal(stopped.status, 200);
  await waitFor(() => sockets.size === 0);
  assert.equal((await (await fetch(origin + '/api/status', { headers: { Cookie: cookie } })).json()).retained, false);
});

test('upstream failures reach the browser as Guacamole errors', async t => {
  const closed = net.createServer();
  closed.listen(0, '127.0.0.1'); await once(closed, 'listening');
  const guacdPort = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  const { server } = createTestApp(t, { guacdHost: '127.0.0.1', guacdPort, rdpHost: '127.0.0.1', rdpPort: 3389,
    security: 'nla', ignoreCert: true, username: 'test', password: 'test' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ width: 1280, height: 720 }) });
  const { ticket } = await response.json();
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + ticket, 'guacamole', { origin, perMessageDeflate: false });
  const received = [];
  const parser = new InstructionParser(parts => received.push(parts));
  ws.on('message', data => parser.receive(data));
  await once(ws, 'close');
  assert.equal(ws.extensions, '');
  assert.equal(received[0][0], 'error');
  assert.match(received[0][1], /Cannot reach guacd/);
  const status = await fetch(origin + '/api/status', { headers: {
    Cookie: response.headers.get('set-cookie').split(';')[0] } });
  assert.equal((await status.json()).retained, false);
});

test('browser exit during handshake retains credentials until use, and shutdown closes owner and viewers', async t => {
  const sockets = new Set();
  const received = [];
  const fake = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const parser = new InstructionParser(parts => {
      received.push(parts);
      if (parts[0] === 'select' && parts[1] !== 'rdp') socket.write(instruction('args', 'username', 'password'));
      if (parts[0] === 'connect') socket.write(instruction('ready', '$pending') + instruction('sync', 42));
    });
    socket.on('data', chunk => parser.receive(chunk));
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  const { server, closeConnections, disconnectAll } = createTestApp(t, { guacdHost: '127.0.0.1', guacdPort: fake.address().port,
    rdpHost: '127.0.0.1', rdpPort: 3389, username: 'test', password: 'secret' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    disconnectAll();
    closeConnections();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(done => server.close(done)), new Promise(done => fake.close(done))]);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/connect', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ width: 1280, height: 720 }) });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const { ticket } = await response.json();
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + ticket, 'guacamole', { origin });
  await once(ws, 'open');
  await waitFor(() => received.some(parts => parts[0] === 'select'));
  ws.close(); await once(ws, 'close');
  // The owner must finish the pending handshake even though the page has gone.
  [...sockets][0].write(instruction('args', 'username', 'password'));
  await waitFor(() => received.some(parts => parts[0] === 'sync'));
  assert.deepEqual(received.find(parts => parts[0] === 'connect'), ['connect', 'test', 'secret']);
  const resume = await fetch(origin + '/api/connect', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify({ width: 1280, height: 720 }) });
  const { ticket: next } = await resume.json();
  const joined = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + next, 'guacamole', { origin });
  await once(joined, 'open');
  await waitFor(() => received.some(parts => parts[0] === 'select' && parts[1] === '$pending'));
  const closed = once(joined, 'close');
  disconnectAll();
  await closed;
  await waitFor(() => sockets.size === 0);
  assert.equal((await (await fetch(origin + '/api/status', { headers: { Cookie: cookie } })).json()).retained, false);
});

for (const compressed of [true, false]) test(`reports socket download kbps with compression ${compressed ? 'enabled' : 'disabled'}`, async t => {
  const payload = instruction('name', '日本語😀'.repeat(2048)) + instruction('size', 0, 640, 480);
  const sockets = new Set();
  const fake = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const parser = new InstructionParser(parts => {
      if (parts[0] === 'select') socket.write(instruction('args', 'hostname'));
      if (parts[0] === 'connect') socket.write(instruction('ready', '$rate-test') + payload);
    });
    socket.on('data', chunk => parser.receive(chunk));
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  const { server, closeConnections } = createTestApp(t, { guacdHost: '127.0.0.1', guacdPort: fake.address().port,
    rdpHost: '127.0.0.1', rdpPort: 3389, security: 'nla', ignoreCert: true, username: 'test', password: 'test' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    closeConnections();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(done => server.close(done)), new Promise(done => fake.close(done))]);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/connect', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ width: 1280, height: 720 }) });
  const { ticket } = await response.json();
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/tunnel?ticket=' + ticket, 'guacamole', {
    origin, perMessageDeflate: compressed });
  const frames = [];
  const reports = [];
  let baseline;
  ws.once('open', () => { baseline = { bytes: ws._socket.bytesRead, at: performance.now() }; });
  const parser = new InstructionParser((parts, raw) => {
    if (parts[0] !== 'app-bitrate') return;
    // Stats frames are uncompressed. Exclude this report itself to compare
    // the server's sample with independently received bytes at the client.
    const length = Buffer.byteLength(raw);
    reports.push({ kbps: Number(parts[1]), at: performance.now(),
      bytes: ws._socket.bytesRead - length - (length < 126 ? 2 : 4) });
  });
  ws.on('message', (data, binary) => {
    frames.push({ text: data.toString(), binary });
    parser.receive(data);
  });
  await waitFor(() => reports.length >= 2);
  assert.equal(ws.extensions, compressed ? 'permessage-deflate' : '');
  assert.ok(frames.some(frame => frame.text === payload));
  assert.ok(frames.every(frame => !frame.binary));
  for (const [index, report] of reports.entries()) {
    const previous = reports[index - 1] ?? baseline;
    const expected = (report.bytes - previous.bytes) * 8 / (report.at - previous.at);
    assert.ok(Math.abs(report.kbps - expected) < Math.max(0.2, expected * 0.05),
      `${report.kbps} kbps reported, ${expected} kbps received at the client`);
  }
  if (compressed) assert.ok(reports[0].kbps < Buffer.byteLength(payload) * 8 / 1000 / 4);
  assert.ok(reports[1].kbps > 0 && reports[1].kbps < 1, 'idle traffic includes the preceding stats frame');
  ws.close(); await once(ws, 'close');
  assert.equal(sockets.size, 1);
  await fetch(origin + '/api/disconnect', { method: 'POST', headers: {
    Origin: origin, Cookie: response.headers.get('set-cookie').split(';')[0] } });
  await waitFor(() => sockets.size === 0);
});

async function waitFor(condition) {
  const deadline = Date.now() + 6000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for tunnel');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
