import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { websocketCompression } from './config.mjs';
import { createApi } from './http/api.mjs';
import { createStaticHandler } from './http/static.mjs';
import { createSessions } from './sessions.mjs';
import { createUpgrade } from './http/upgrade.mjs';
import { json } from './http/util.mjs';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));

export function createApp(config, settings) {
  config = { ...config, settings };
  const sessions = createSessions();
  const servers = new Map();
  const getWebSocketServer = () => {
    const level = settings.get().websocketCompressionLevel;
    if (!servers.has(level)) servers.set(level, new WebSocketServer({ noServer: true,
      maxPayload: 128 * 1024, perMessageDeflate: websocketCompression(level) }));
    return servers.get(level);
  };
  const closeConnections = () => {
    for (const wss of servers.values()) for (const ws of wss.clients) ws.terminate();
  };
  const api = createApi({ config, sessions });
  const files = createStaticHandler(root);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (await api(req, res, url)) return;
      if (req.method !== 'GET') return json(res, 404, { error: 'Not found.' });
      await files(req, res, url);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, 404, { error: 'Not found.' });
      json(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message });
    }
  });
  server.on('upgrade', createUpgrade({ getWebSocketServer, config, sessions }));
  server.on('close', () => {
    sessions.closeAll();
    sessions.dispose();
    closeConnections();
    for (const wss of servers.values()) wss.close();
  });
  return { server, closeConnections, disconnectAll: sessions.closeAll };
}
