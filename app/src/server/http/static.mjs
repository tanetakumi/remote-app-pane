import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { json } from './util.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function encodings(header = '') {
  const quality = new Map(header.toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';');
    const q = parameters.find(value => value.trim().startsWith('q='));
    const value = q === undefined ? 1 : Number(q.trim().slice(2));
    return [name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0];
  }));
  return ['br', 'gzip'].map(name => ({ name, q: quality.get(name) ?? quality.get('*') ?? 0 }))
    .filter(item => item.q > 0 && item.q >= (quality.get('identity') ?? 0))
    .sort((a, b) => b.q - a.q).map(item => item.name);
}

export async function serveStatic(req, res, path, contentType, immutable) {
  let content;
  let encoding;
  for (const candidate of encodings(req.headers['accept-encoding'])) {
    try {
      content = await readFile(path + (candidate === 'br' ? '.br' : '.gz'));
      encoding = candidate;
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  content ??= await readFile(path);
  const etag = `"${createHash('sha256').update(content).digest('hex')}"`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('ETag', etag);
  if (encoding) res.setHeader('Content-Encoding', encoding);
  if (req.headers['if-none-match']?.split(',').some(value => {
    const tag = value.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  })) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.setHeader('Content-Length', content.length);
  res.writeHead(200);
  res.end(content);
}

// Serves files below `directory`; hashed assets are cached as immutable.
export function createStaticHandler(directory) {
  const root = resolve(directory);
  return async (req, res, url) => {
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) return json(res, 403, { error: 'Invalid path.' });
    const immutable = url.pathname.startsWith('/assets/') || /^\/vendor\/guacamole-[\d.]+-[a-f0-9]{12}\.js$/.test(url.pathname);
    await serveStatic(req, res, path, mime[extname(path)] || 'application/octet-stream', immutable);
  };
}
