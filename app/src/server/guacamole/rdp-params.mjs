import { instruction } from './protocol.mjs';

// Fixed RDP settings; the Guacamole `connect` arguments are filled by name.
function rdpParameters(config, credentials) {
  return {
    hostname: config.rdpHost, port: config.rdpPort,
    username: credentials.username, password: credentials.password,
    security: config.security, 'ignore-cert': String(config.ignoreCert),
    width: credentials.width, height: credentials.height, dpi: 96,
    'resize-method': 'display-update',
    'server-layout': 'ja-jp-qwerty',
    'enable-wallpaper': 'false', 'enable-theming': 'false', 'enable-font-smoothing': 'true',
    'disable-audio': 'true', 'disable-copy': 'true', 'disable-paste': 'false',
  };
}

// Instructions answering guacd's `args`: display capabilities, then `connect`.
export function connectInstructions(argNames, config, credentials) {
  const parameters = rdpParameters(config, credentials);
  return instruction('size', credentials.width, credentials.height, 96) +
    instruction('audio') + instruction('video') +
    instruction('image', 'image/png', 'image/jpeg', ...(credentials.webp ? ['image/webp'] : [])) +
    instruction('timezone', 'Asia/Tokyo') +
    instruction('connect', ...argNames.map(name => name.startsWith('VERSION_') ? 'VERSION_1_5_0' : (parameters[name] ?? '')));
}
