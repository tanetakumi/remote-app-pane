import { sameOrigin } from './util.mjs';

// Accepts /tunnel WebSocket upgrades that carry a valid one-time ticket.
export function createUpgrade({ getWebSocketServer, config, sessions }) {
  return (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    let entry;
    if (url.pathname !== '/tunnel' || !sameOrigin(req) || req.headers['sec-websocket-protocol'] !== 'guacamole'
      || !(entry = sessions.take(url.searchParams.get('ticket')))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    getWebSocketServer().handleUpgrade(req, socket, head, ws => {
      ws.on('error', () => ws.terminate());
      sessions.attach(entry, ws, config, socket);
    });
  };
}
