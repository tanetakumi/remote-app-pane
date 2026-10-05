import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.mjs';
import { openSettings } from '../src/server/settings.mjs';

export function createTestApp(t, config) {
  const dir = mkdtempSync(join(tmpdir(), 'remote-app-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settings = openSettings(join(dir, 'config.json'));
  return { ...createApp(config, settings), settings };
}
