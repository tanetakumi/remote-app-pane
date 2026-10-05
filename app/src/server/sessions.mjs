import { randomBytes } from 'node:crypto';
import { bridge } from './guacamole/tunnel.mjs';

const TICKET_TTL_MS = 60000;
const MAX_TICKETS = 32;

// One-time connection tickets and the retained RDP sessions they attach to.
export function createSessions() {
  const tickets = new Map();
  const sessions = new Map();
  const sessionId = req => /(?:^|;\s*)rdp-session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const close = id => {
    const session = sessions.get(id);
    sessions.delete(id);
    for (const [ticket, entry] of tickets) if (entry.sessionId === id) tickets.delete(ticket);
    if (!session) return;
    for (const tcp of session.sockets) tcp.destroy();
  };
  const prune = setInterval(() => {
    for (const [ticket, entry] of tickets) if (entry.expires < Date.now()) tickets.delete(ticket);
  }, 10000).unref();
  return {
    sessionId,
    newSessionId: () => randomBytes(32).toString('hex'),
    has: id => sessions.has(id),
    full: () => tickets.size >= MAX_TICKETS,
    issue(entry) {
      const ticket = randomBytes(32).toString('hex');
      tickets.set(ticket, { ...entry, expires: Date.now() + TICKET_TTL_MS });
      return ticket;
    },
    // Returns the entry once; expired or unknown tickets yield undefined.
    take(ticket) {
      const entry = tickets.get(ticket);
      tickets.delete(ticket);
      return entry && entry.expires >= Date.now() ? entry : undefined;
    },
    // The first connection owns the guacd session; later ones join it by id.
    async attach(entry, ws, config, transport) {
      let session = sessions.get(entry.sessionId);
      if (!session) {
        if (entry.retained) { ws.close(1011); return; }
        const owner = bridge(ws, config, entry.credentials, { retain: true, transport });
        session = { owner, sockets: new Set([owner]) };
        sessions.set(entry.sessionId, session);
        owner.on('close', () => close(entry.sessionId));
        return;
      }
      const select = await session.owner.ready;
      if (!select || sessions.get(entry.sessionId) !== session) { ws.close(1011); return; }
      if (ws.readyState !== 1) return;
      const tcp = bridge(ws, config, entry.credentials, { select, transport });
      session.sockets.add(tcp);
      tcp.on('close', () => session.sockets.delete(tcp));
    },
    close,
    closeAll() { for (const id of sessions.keys()) close(id); },
    dispose() { clearInterval(prune); tickets.clear(); },
  };
}
