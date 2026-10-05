import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
import { serveStatic } from '../src/server/http/static.mjs';

test('static assets negotiate compression, preserve content and revalidate each representation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'remote-app-assets-'));
  const file = join(dir, 'asset.js');
  const data = Buffer.from('console.log("日本語😀");\n'.repeat(100));
  await Promise.all([writeFile(file, data), writeFile(file + '.gz', gzipSync(data)), writeFile(file + '.br', brotliCompressSync(data))]);
  const server = http.createServer((req, res) => {
    serveStatic(req, res, file, 'text/javascript; charset=utf-8', req.url === '/immutable')
      .catch(() => { res.writeHead(500); res.end(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(done => server.close(done)); await rm(dir, { recursive: true }); });
  const get = (encoding, path = '/', etag) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path,
      headers: { 'Accept-Encoding': encoding, ...(etag ? { 'If-None-Match': etag } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const br = await get('gzip, br', '/immutable');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.deepEqual(brotliDecompressSync(br.data), data);
  assert.match(br.headers['cache-control'], /immutable/);
  assert.equal(br.headers.vary, 'Accept-Encoding');
  const gzip = await get('br;q=0, gzip;q=1');
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(gzip.data), data);
  assert.equal(gzip.headers['cache-control'], 'no-cache');
  const raw = await get('gzip;q=0, br;q=0');
  assert.equal(raw.headers['content-encoding'], undefined);
  assert.deepEqual(raw.data, data);
  assert.notEqual(raw.headers.etag, br.headers.etag);
  assert.equal((await get('br', '/', br.headers.etag)).status, 304);
  assert.equal((await get('identity', '/', br.headers.etag)).status, 200);
  // Precompressed files are optional, allowing old/uncompressed builds to run.
  await rm(file + '.br'); await rm(file + '.gz');
  assert.deepEqual((await get('br, gzip')).data, data);
});
