import { configFromEnv } from './config.mjs';
import { createApp } from './app.mjs';
import { openSettings } from './settings.mjs';
import { fileURLToPath } from 'node:url';

let config, settings;
try {
  config = configFromEnv();
  settings = openSettings(fileURLToPath(new URL('../../data/config.json', import.meta.url)));
}
catch (error) { console.error(error.message); process.exit(1); }
const { server, closeConnections, disconnectAll } = createApp(config, settings);
server.listen(config.port, config.host, () => {
  console.log(`Remote App Pane: http://${config.host}:${config.port}`);
  console.log(`RDP target: ${config.rdpHost}:${config.rdpPort} via guacd ${config.guacdHost}:${config.guacdPort}`);
});
const stop = () => { disconnectAll(); closeConnections(); server.close(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
