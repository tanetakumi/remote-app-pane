import { json, body, sameOrigin } from './util.mjs';
import { rdpDimensions } from '../dimensions.mjs';

// Handles /api/*; resolves to true when the request was answered.
export function createApi({ config, sessions }) {
  return async (req, res, url) => {
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      json(res, 200, config.settings.get());
      return true;
    }
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Same-origin request required.' }), true;
      const input = await body(req);
      try { json(res, 200, config.settings.set(input)); }
      catch (error) {
        if (error.code === 'INVALID_SETTINGS') json(res, 400, { error: error.message });
        else {
          console.error('Saving settings failed:', error.message);
          json(res, 500, { error: '設定を保存できませんでした。' });
        }
      }
      return true;
    }
    if (url.pathname === '/api/status' && req.method === 'GET') {
      json(res, 200, { configuredCredentials: Boolean(config.username && config.password),
        retained: sessions.has(sessions.sessionId(req)) });
      return true;
    }
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Same-origin request required.' }), true;
      sessions.close(sessions.sessionId(req));
      json(res, 200, {});
      return true;
    }
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Same-origin request required.' }), true;
      const input = await body(req);
      if (sessions.full()) return json(res, 429, { error: 'Too many pending connections.' }), true;
      const id = sessions.sessionId(req);
      const retained = sessions.has(id);
      const username = retained ? '' : input.username || config.username;
      const password = retained ? '' : input.password || config.password;
      if ([username, password].some(value => typeof value !== 'string' || value.length > 1024)) throw new Error('Invalid credentials.');
      if (!retained && (!username || !password)) throw new Error('Windows username and password are required (a Windows Hello PIN cannot be used).');
      if (input.webp !== undefined && typeof input.webp !== 'boolean') throw new Error('Invalid WebP capability.');
      const dimensions = rdpDimensions(input.width, input.height, config.settings.get().resolutionScale);
      const nextId = retained ? id : sessions.newSessionId();
      res.setHeader('Set-Cookie', `rdp-session=${nextId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      const ticket = sessions.issue({ sessionId: nextId, retained, credentials: { username, password,
        ...dimensions, webp: input.webp === true } });
      json(res, 200, { ticket, pointerSpeed: config.settings.get().pointerSpeed });
      return true;
    }
    return false;
  };
}
