// Three significant digits keep the header pill at four characters + a four-letter unit.
// Thresholds sit on the rounding boundary so a value never prints as "100.0" or "1000".
export function formatBitrate(kbps) {
  if (kbps < 99.95) return [kbps.toFixed(1), 'kbps'];
  if (kbps < 999.5) return [kbps.toFixed(0), 'kbps'];
  const mbps = kbps / 1000;
  if (mbps < 9.995) return [mbps.toFixed(2), 'Mbps'];
  return [mbps.toFixed(mbps < 99.95 ? 1 : 0), 'Mbps'];
}
