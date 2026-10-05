import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBitrate } from '../src/client/core/bitrate.js';

test('bitrate keeps three significant digits and switches to Mbps at 999.5 kbps', () => {
  const cases = [
    [0, ['0.0', 'kbps']], [5.24, ['5.2', 'kbps']], [99.94, ['99.9', 'kbps']], [99.95, ['100', 'kbps']],
    [999.4, ['999', 'kbps']], [999.5, ['1.00', 'Mbps']], [1234.5, ['1.23', 'Mbps']], [9995, ['10.0', 'Mbps']], [12345, ['12.3', 'Mbps']], [99950, ['100', 'Mbps']],
  ];
  for (const [kbps, expected] of cases) assert.deepEqual(formatBitrate(kbps), expected, String(kbps));
});
