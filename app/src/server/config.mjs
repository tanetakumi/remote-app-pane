// Compression tuning stays internal; only the level is user-configurable.
export function websocketCompression(level) {
  return level === 0 ? false : {
    zlibDeflateOptions: { level, memLevel: 7 },
    threshold: 1024,
    concurrencyLimit: 4,
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
  };
}

export function configFromEnv(env = process.env) {
  const port = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    host: env.HOST || '0.0.0.0', port: port('PORT', 8443),
    guacdHost: 'guacd', guacdPort: 4822,
    rdpHost: env.RDP_HOST || 'host.docker.internal', rdpPort: 3389,
    security: 'nla', ignoreCert: true,
    username: env.RDP_USERNAME || '', password: env.RDP_PASSWORD || '',
  };
}
