import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, brotliCompress, constants } from 'node:zlib';
import { minify } from 'vite';

const root = new URL('../dist/', import.meta.url);
const originalName = 'vendor/guacamole-1.6.0.js';
const original = await readFile(new URL(originalName, root), 'utf8');
// Script mode preserves the global Guacamole name used by the UI.
const result = await minify(originalName, original, { module: false });
if (result.errors.length) throw new Error('Guacamole minification failed.');
const license = original.match(/^\/\*[\s\S]*?\*\//)[0];
const code = `${license}\n${result.code}\n`;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
const name = `vendor/guacamole-1.6.0-${hash}.js`;
await writeFile(new URL(name, root), code);
const htmlPath = new URL('index.html', root);
const html = await readFile(htmlPath, 'utf8');
if (!html.includes(`/${originalName}`)) throw new Error('Guacamole script reference missing.');
await writeFile(htmlPath, html.replace(`/${originalName}`, `/${name}`));
await unlink(new URL(originalName, root));

const encodeGzip = promisify(gzip);
const encodeBrotli = promisify(brotliCompress);
const files = (await readdir(root, { recursive: true })).filter(name => /\.(html|js|css)$/.test(name));
await Promise.all(files.map(async name => {
  const path = new URL(name, root);
  const data = await readFile(path);
  const [gz, br] = await Promise.all([
    encodeGzip(data, { level: 9 }),
    encodeBrotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
  ]);
  await Promise.all([writeFile(new URL(`${name}.gz`, root), gz), writeFile(new URL(`${name}.br`, root), br)]);
  console.log(`${name}: ${data.length} bytes, gzip ${gz.length}, br ${br.length}`);
}));
