import net from 'node:net';
import { rdpDimensions } from '../dimensions.mjs';
import { randomUUID } from 'node:crypto';
import { instruction, InstructionParser } from './protocol.mjs';
import { connectInstructions } from './rdp-params.mjs';

export function bridge(ws, config, credentials, { transport, retain = false, select = 'rdp' }) {
  const tcp = net.createConnection({ host: config.guacdHost, port: config.guacdPort });
  tcp.setNoDelay(true);
  let phase = 'args';
  let ended = false;
  let bitrateTimer;
  let keepaliveTimer;
  let attached = true;
  let lastSync;
  let mouse;
  const keys = new Set();
  let ready;
  tcp.ready = new Promise(resolve => { ready = resolve; });
  const pending = [];
  const fail = (message, code = 512) => {
    if (ended) return;
    ended = true;
    clearInterval(bitrateTimer);
    clearInterval(keepaliveTimer);
    ready(null);
    if (ws.readyState === 1) {
      ws.send(instruction('error', message, code));
      ws.close(1011, String(code));
    } else ws.terminate();
    tcp.destroy();
    credentials.password = '';
  };
  const send = (raw, compress = true) => {
    if (ended || !attached || ws.readyState !== 1) return;
    if (ws.bufferedAmount > 16 * 1024 * 1024) {
      detach();
      ws.close(1011, 'Browser is too slow to receive the desktop.');
      return;
    }
    if (ws.bufferedAmount > 1024 * 1024) tcp.pause();
    const data = Buffer.from(raw);
    ws.send(data, { binary: false, compress }, error => {
      if (error) { detach(); ws.terminate(); }
      else if (!ended) {
        if (ws.bufferedAmount < 1024 * 1024) tcp.resume();
      }
    });
  };
  tcp.setTimeout(30000);
  tcp.on('timeout', () => fail('RDP handshake timed out. Check the host and credentials.', 514));
  tcp.on('error', () => fail('Cannot reach guacd. Check the container logs.', 516));
  tcp.on('connect', () => tcp.write(instruction('select', select)));
  const upstream = new InstructionParser((parts, raw) => {
    if (ended) return;
    const opcode = parts[0];
    if (opcode === 'error') return fail(parts[1] || 'RDP connection failed.', Number(parts[2]) || 512);
    if (phase === 'args') {
      if (opcode !== 'args') return fail('Unexpected guacd handshake.');
      tcp.write(connectInstructions(parts.slice(1), config, credentials));
      credentials.password = '';
      phase = 'ready';
    } else if (phase === 'ready') {
      if (opcode !== 'ready') return fail('RDP did not become ready.');
      phase = 'stream';
      ready(parts[1]);
      tcp.setTimeout(0);
      if (!attached) { keepAlive(); return; }
      // Count flushed WebSocket bytes, after compression and framing. This
      // socket ends at cloudflared when proxied, not at the mobile device.
      const sentBytes = () => transport.bytesWritten - transport.writableLength;
      let sampledBytes = sentBytes();
      let sampledAt = performance.now();
      send(instruction('', randomUUID()));
      bitrateTimer = setInterval(() => {
        const now = performance.now();
        const bytes = sentBytes();
        send(instruction('app-bitrate', ((bytes - sampledBytes) * 8 / (now - sampledAt)).toFixed(1)), false);
        sampledBytes = bytes;
        sampledAt = now;
      }, 1000).unref();
    } else {
      if (opcode === 'sync') lastSync = parts[1];
      if (attached) pending.push(raw);
      else if (opcode === 'sync') tcp.write(instruction('sync', parts[1]));
      else if (opcode === 'blob') tcp.write(instruction('ack', parts[1], 'OK', 0));
      else if (opcode === 'disconnect') fail('RDP connection ended.', 519);
    }
  });
  tcp.on('data', chunk => {
    try {
      upstream.receive(chunk);
      // One text frame per received batch, rather than one per drawing command.
      if (!ended && pending.length) send(pending.join(''));
    } catch { fail('Invalid guacd protocol stream.'); }
    pending.length = 0;
  });
  const downstream = new InstructionParser((parts, raw) => {
    if (parts[0] === '') { send(raw); return; } // Guacamole WebSocket tunnel pings.
    if (phase !== 'stream' || ended || !attached) return;
    if (parts[0] === 'size') {
      if (parts.length !== 3) throw new Error('Invalid size instruction.');
      const { width, height } = rdpDimensions(Number(parts[1]), Number(parts[2]), config.settings.get().resolutionScale);
      raw = instruction('size', width, height);
    }
    // Closing a page detaches the viewer, never the retained owner.
    if (parts[0] === 'disconnect') return;
    if (parts[0] === 'key') {
      if (parts[2] === '1') keys.add(parts[1]);
      else keys.delete(parts[1]);
    }
    if (parts[0] === 'mouse') mouse = parts.slice(1, 3);
    if (!tcp.write(raw)) ws.pause();
  }, 128 * 1024);
  tcp.on('drain', () => ws.resume());
  ws.on('message', (data, binary) => {
    if (binary) return fail('Guacamole requires text frames.');
    try { downstream.receive(data); } catch { fail('Invalid browser protocol stream.'); }
  });
  tcp.on('close', () => {
    clearInterval(keepaliveTimer);
    clearInterval(bitrateTimer);
    ready(null);
    if (!ended) fail('RDP connection ended. Another RDP client may have taken over this session.', 519);
  });
  const keepAlive = () => {
    keepaliveTimer ||= setInterval(() => tcp.write(instruction('nop')), 5000).unref();
  };
  const detach = () => {
    if (!attached) return;
    attached = false;
    clearInterval(bitrateTimer);
    if (ended) return;
    // Release input even if the browser vanished without sending keyup/mouseup.
    for (const key of keys) tcp.write(instruction('key', key, 0));
    keys.clear();
    if (mouse) tcp.write(instruction('mouse', ...mouse, 0));
    if (!retain) { ended = true; credentials.password = ''; ready(null); tcp.destroySoon(); return; }
    tcp.resume();
    if (lastSync !== undefined) tcp.write(instruction('sync', lastSync));
    if (phase === 'stream') keepAlive();
  };
  ws.on('error', detach);
  ws.on('close', detach);
  return tcp;
}
