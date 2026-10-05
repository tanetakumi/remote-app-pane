import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { createTestApp } from './helpers.mjs';
import { instruction, InstructionParser } from '../src/server/guacamole/protocol.mjs';

test('minimal browser UI fills the viewport, sends input, and reconnects cleanly', async t => {
  const received = [];
  const sockets = new Set();
  let webpImage;
  const fake = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let width = 1280, height = 720;
    let connected = false;
    const draw = () => socket.write(
      instruction('size', 0, width, height) + instruction('rect', 0, 0, 0, width, height) +
      instruction('cfill', 14, 0, 12, 34, 56, 255) +
      instruction('img', 0, 14, 0, 'image/webp', 10, 10) + instruction('blob', 0, webpImage) +
      instruction('end', 0) + instruction('sync', Date.now())
    );
    const parser = new InstructionParser(parts => {
      received.push(parts);
      if (parts[0] === 'size') {
        [width, height] = [Number(parts[1]), Number(parts[2])];
        if (connected) draw();
      }
      if (parts[0] === 'select') socket.write(instruction('args', 'VERSION_1_5_0', 'hostname', 'username', 'password'));
      if (parts[0] === 'connect') {
        connected = true;
        socket.write(instruction('ready', '$browser-test') + instruction('name', '検証用画面') +
          instruction('name', 'A'.repeat(32768)));
        draw();
      }
    });
    socket.on('data', chunk => parser.receive(chunk));
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  const { server, closeConnections } = createTestApp(t, { guacdHost: '127.0.0.1', guacdPort: fake.address().port,
    rdpHost: '127.0.0.1', rdpPort: 3389, security: 'nla', ignoreCert: true, username: 'saved-user', password: 'saved-password' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  t.after(async () => {
    await browser?.close();
    closeConnections();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(done => server.close(done)), new Promise(done => fake.close(done))]);
  });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), configuredCredentials: false } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  webpImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 1, 1);
    return canvas.toDataURL('image/webp', 1).split(',')[1];
  });
  assert.equal(await page.locator('#bitrate-pill').isVisible(), false);
  assert.equal(await page.locator('#connection-button').getAttribute('data-state'), 'disconnected');
  assert.equal(await page.locator('#connection-state').isVisible(), true);
  const centered = await page.evaluate(() => {
    const label = document.getElementById('connection-state').getBoundingClientRect();
    const viewer = document.getElementById('viewer').getBoundingClientRect();
    return Math.abs(label.left + label.width / 2 - (viewer.left + viewer.width / 2)) < 2
      && Math.abs(label.top + label.height / 2 - (viewer.top + viewer.height / 2)) < 2;
  });
  assert.equal(centered, true);
  const connect = async () => {
    await page.locator('#connection-button').click();
    await page.locator('#username').fill('test-user');
    await page.locator('#password').fill('test-password');
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
    assert.equal(await page.locator('#connection-button').getAttribute('data-state'), 'connected');
    assert.ok((await page.locator('#connection-state').boundingBox()).width <= 1);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#display canvas');
      return canvas && canvas.getContext('2d').getImageData(20, 20, 1, 1).data[0] === 12;
    });
    await page.waitForFunction(() => document.querySelector('#display canvas')
      .getContext('2d').getImageData(10, 10, 1, 1).data[0] >= 250);
    assert.ok(received.filter(parts => parts[0] === 'image').at(-1).includes('image/webp'));
  };
  await connect();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#display canvas');
    return canvas && canvas.getContext('2d').getImageData(20, 20, 1, 1).data[0] === 12;
  });
  assert.equal(received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length, 1);
  assert.ok(received.some(parts => parts[0] === 'select' && parts[1] === '$browser-test'));
  assert.equal(await page.locator('#credentials-dialog').isVisible(), false);
  assert.equal(await page.locator('#bitrate-pill').isVisible(), true);
  assert.equal(await page.locator('.bitrate-unit').textContent(), 'kbps');
  await page.waitForFunction(() => Number(document.getElementById('bitrate-value').textContent) > 0);
  assert.equal(await page.locator('#password').inputValue(), '');
  assert.equal(await page.locator('#credentials-dialog').isVisible(), false);
  await page.locator('#display > div').focus();
  await page.keyboard.press('b');
  await page.waitForTimeout(50);
  assert.ok(received.some(parts => parts[0] === 'key' && parts[1] === '98' && parts[2] === '1'));
  assert.equal(await page.locator('#keys-palette').isVisible(), false);
  await page.locator('#keys-button').click();
  assert.equal(await page.locator('#keys-palette').isVisible(), true);
  const beforeKeys = received.length;
  await page.locator('#key-backspace').click();
  await page.locator('#key-shift-enter').click();
  await page.waitForTimeout(50);
  assert.deepEqual(received.slice(beforeKeys).filter(parts => parts[0] === 'key').map(parts => parts.slice(1)), [
    ['65288', '1'], ['65288', '0'],
    ['65505', '1'], ['65293', '1'], ['65293', '0'], ['65505', '0'],
  ]);
  const box = selector => page.locator(selector).boundingBox();
  const keyCount = () => received.filter(parts => parts[0] === 'key').length;
  const keysBeforeDrag = keyCount();
  const drag = async (dx, dy) => {
    const handle = await box('#keys-move');
    const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const initial = await box('#keys-palette');
  await drag(-200, 150);
  const moved = await box('#keys-palette');
  assert.equal(Math.round(moved.x - initial.x), -200);
  assert.equal(Math.round(moved.y - initial.y), 150);
  await drag(-5000, 5000);
  const clamped = await box('#keys-palette');
  const viewer = await box('#viewer');
  assert.equal(Math.round(clamped.x - viewer.x), 8);
  assert.equal(Math.round(viewer.y + viewer.height - clamped.y - clamped.height), 8);
  assert.equal(keyCount(), keysBeforeDrag);
  await page.locator('#keys-button').click();
  assert.equal(await page.locator('#keys-palette').isVisible(), false);
  await page.locator('#keys-button').click();
  assert.deepEqual(await box('#keys-palette'), clamped);
  await page.locator('#keys-button').click();
  // The desktop is requested at twice the viewer width; one half is shown at a time.
  assert.deepEqual(received.filter(parts => parts[0] === 'size').at(-1).slice(1), ['3072', '1020']);
  const viewerCenter = async target => {
    const bounds = await target.locator('#viewer').boundingBox();
    return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  };
  const clickViewerCenter = async () => {
    const beforeClick = received.length;
    await page.mouse.click(...await viewerCenter(page));
    await page.waitForTimeout(50);
    return received.slice(beforeClick).find(parts => parts[0] === 'mouse' && parts[3] === '1');
  };
  assert.equal(await page.locator('#pane-button').getAttribute('data-value'), '0');
  assert.ok(Math.abs(Number((await clickViewerCenter())[1]) - 768) < 3);
  await page.locator('#pane-button').click();
  assert.equal(await page.locator('#pane-button').getAttribute('data-value'), '1');
  assert.ok(Math.abs(Number((await clickViewerCenter())[1]) - 2304) < 3);
  await page.locator('#pane-button').click();
  assert.ok(Math.abs(Number((await clickViewerCenter())[1]) - 768) < 3);
  const waitForSize = async (width, height) => {
    await page.waitForFunction(([w, h]) => {
      const display = document.querySelector('#display > div > div');
      return display?.style.width === `${w}px` && display?.style.height === `${h}px`;
    }, [width, height]);
  };
  const initialConnections = received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length;
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#settings-dialog').isVisible(), true);
  await page.waitForFunction(() => !document.getElementById('settings-save').disabled);
  assert.equal(await page.locator('#settings-scale').inputValue(), '1.2');
  const keysBeforeSettings = received.filter(parts => parts[0] === 'key').length;
  await page.locator('#settings-scale').fill('1.5');
  await page.locator('#settings-compression').fill('0');
  await page.route('**/api/settings', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: '保存テストの失敗' } });
    else await route.continue();
  });
  await page.locator('#settings-save').click();
  await page.waitForFunction(() => document.getElementById('settings-status').textContent.includes('保存テストの失敗'));
  assert.equal(await page.locator('#settings-scale').inputValue(), '1.5');
  assert.equal((await (await page.request.get(`http://127.0.0.1:${server.address().port}/api/settings`)).json()).resolutionScale, 1.2);
  await page.unroute('**/api/settings');
  await page.locator('#settings-save').click();
  await page.waitForFunction(() => document.getElementById('settings-status').textContent.includes('保存しました'));
  await waitForSize(3840, 1275);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings-dialog').isVisible(), false);
  assert.equal(await page.locator('#settings-button').evaluate(el => el === document.activeElement), true);
  assert.equal(received.filter(parts => parts[0] === 'key').length, keysBeforeSettings);
  assert.ok(Math.abs(Number((await clickViewerCenter())[1]) - 960) < 3);
  await page.locator('#settings-button').click();
  await page.waitForFunction(() => !document.getElementById('settings-save').disabled);
  assert.equal(await page.locator('#settings-compression').inputValue(), '0');
  await page.locator('#settings-scale').fill('1.2');
  await page.locator('#settings-save').click();
  await waitForSize(3072, 1020);
  await page.locator('#close-settings').click();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
  await waitForSize(3072, 1020);
  assert.equal(received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length, initialConnections);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForSize(936, 953);
  await page.setViewportSize({ width: 1280, height: 900 });
  await waitForSize(3072, 1020);
  await page.locator('#text-button').click();
  const beforeKeyboardResize = received.filter(parts => parts[0] === 'size').length;
  await page.setViewportSize({ width: 1280, height: 750 });
  await page.waitForTimeout(250);
  assert.equal(received.filter(parts => parts[0] === 'size').length, beforeKeyboardResize);
  await page.locator('#close-text').click();
  await waitForSize(3072, 840);
  await page.setViewportSize({ width: 1280, height: 900 });
  await waitForSize(3072, 1020);
  const beforeBurst = received.length;
  await page.evaluate(() => {
    const element = document.querySelector('#display > div');
    const bounds = element.getBoundingClientRect();
    for (let i = 0; i < 100; i++) element.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: bounds.left + 20 + i, clientY: bounds.top + 20,
    }));
  });
  await page.waitForTimeout(40);
  const burst = received.slice(beforeBurst).filter(parts => parts[0] === 'mouse');
  assert.ok(burst.length > 0 && burst.length <= 3, `100 moves produced ${burst.length} messages`);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(40);
  assert.ok(received.some(parts => parts[0] === 'mouse' && parts[3] === '16'));
  await page.locator('#connection-button').click();
  await page.waitForFunction(() => document.getElementById('connection-state').textContent === '未接続');
  assert.equal(await page.locator('#connection-button').getAttribute('data-state'), 'disconnected');
  assert.equal(await page.locator('#connection-state').isVisible(), true);
  assert.equal(await page.locator('#display > div').count(), 0);
  assert.equal(await page.locator('#bitrate-pill').isVisible(), false);
  assert.equal(await page.locator('#bitrate-value').textContent(), '0');
  await connect();
  await page.locator('#connection-button').click();
  await page.waitForFunction(() => document.getElementById('connection-state').textContent === '未接続');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => {
    const header = document.getElementById('top-bar').getBoundingClientRect();
    const viewer = document.getElementById('viewer').getBoundingClientRect();
    return header.height === 50 && viewer.top === header.bottom && viewer.bottom === window.innerHeight &&
      viewer.width === window.innerWidth && document.documentElement.scrollWidth === window.innerWidth &&
      document.documentElement.scrollHeight === window.innerHeight;
  }), true);
  await connect();
  assert.equal(await page.evaluate(() => {
    const pill = document.getElementById('bitrate-pill').getBoundingClientRect();
    const button = document.getElementById('connection-button').getBoundingClientRect();
    const actions = document.getElementById('top-bar-actions').getBoundingClientRect();
    return pill.width > 0 && button.right <= pill.left && pill.right <= actions.left && actions.right <= window.innerWidth;
  }), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForSize(936, 953);
  const mobileClick = await clickViewerCenter();
  assert.ok(Math.abs(Number(mobileClick[1]) - 234) < 3 && Math.abs(Number(mobileClick[2]) - 476.5) < 3);
  await page.locator('#connection-button').click();
  await page.waitForFunction(() => document.getElementById('connection-state').textContent === '未接続');
  // A fresh page uses configured credentials without showing the login dialog.
  const savedContext = await browser.newContext({ hasTouch: true });
  let savedPage = await savedContext.newPage();
  // Exercise WebP probing and rendering through the Image fallback as on LAN HTTP.
  await savedPage.addInitScript(() => { window.ImageDecoder = undefined; });
  savedPage.on('pageerror', error => errors.push(error.message));
  await savedPage.goto(`http://127.0.0.1:${server.address().port}`);
  await savedPage.locator('#connection-button').click();
  await savedPage.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
  assert.equal(await savedPage.locator('#credentials-dialog').isVisible(), false);
  assert.ok(received.some(parts => parts[0] === 'connect' && parts[3] === 'saved-user' && parts[4] === 'saved-password'));
  await savedPage.waitForFunction(() => document.querySelector('#display canvas')
    .getContext('2d').getImageData(10, 10, 1, 1).data[0] >= 250);
  assert.ok(received.filter(parts => parts[0] === 'image').at(-1).includes('image/webp'));
  const beforeTouch = received.length;
  await savedPage.touchscreen.tap(...await viewerCenter(savedPage));
  await savedPage.waitForTimeout(500);
  assert.ok(received.slice(beforeTouch).some(parts => parts[0] === 'mouse' && parts[3] === '1'));
  assert.ok(received.slice(beforeTouch).some(parts => parts[0] === 'mouse' && parts[3] === '0'));
  const rdpConnections = received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length;
  await savedPage.close();
  assert.equal((await (await savedContext.request.get(`http://127.0.0.1:${server.address().port}/api/status`)).json()).retained, true);
  savedPage = await savedContext.newPage();
  savedPage.on('pageerror', error => errors.push(error.message));
  await savedPage.addInitScript(() => {
    window.tunnels = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native { constructor(...args) { super(...args); window.tunnels.push(this); } };
  });
  await savedPage.goto(`http://127.0.0.1:${server.address().port}`);
  await savedPage.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
  await savedPage.waitForFunction(() => document.querySelector('#display canvas')
    .getContext('2d').getImageData(10, 10, 1, 1).data[0] >= 250);
  assert.equal(received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length, rdpConnections);
  // A WebSocket that closes unexpectedly rejoins the retained RDP without a button press.
  const joins = () => received.filter(parts => parts[0] === 'select' && parts[1] === '$browser-test').length;
  const until = async check => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise(done => setTimeout(done, 50));
    assert.ok(check());
  };
  let joined = joins();
  await savedPage.evaluate(() => window.tunnels.at(-1).close());
  await until(() => joins() > joined);
  await savedPage.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
  assert.equal(received.filter(parts => parts[0] === 'select' && parts[1] === 'rdp').length, rdpConnections);
  // If the server is unreachable the header returns to 接続; becoming visible again rejoins.
  await savedPage.route('**/api/status', route => route.abort());
  joined = joins();
  await savedPage.evaluate(() => window.tunnels.at(-1).close());
  await savedPage.waitForFunction(() => document.getElementById('connection-button').dataset.state === 'disconnected');
  await savedPage.waitForTimeout(200);
  assert.equal(joins(), joined);
  await savedPage.unroute('**/api/status');
  await savedPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await until(() => joins() > joined);
  await savedPage.waitForFunction(() => document.getElementById('connection-state').textContent === '接続済み');
  await savedPage.locator('#connection-button').click();
  await savedPage.waitForFunction(() => document.getElementById('connection-state').textContent === '未接続');
  assert.equal((await (await savedContext.request.get(`http://127.0.0.1:${server.address().port}/api/status`)).json()).retained, false);
  assert.deepEqual(errors, []);
});
