import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const defaults = { resolutionScale: 1.2, websocketCompressionLevel: 1 };

function validateSettings(value) {
  const invalid = message => { throw Object.assign(new Error(`Invalid settings: ${message}`), { code: 'INVALID_SETTINGS' }); };
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'resolutionScale')
    || !Object.hasOwn(value, 'websocketCompressionLevel')) invalid('require resolutionScale and websocketCompressionLevel only.');
  if (typeof value.resolutionScale !== 'number' || !(value.resolutionScale >= 0.5 && value.resolutionScale <= 4)) {
    invalid('resolutionScale must be a number from 0.5 to 4.');
  }
  if (!Number.isInteger(value.websocketCompressionLevel) || value.websocketCompressionLevel < 0 || value.websocketCompressionLevel > 9) {
    invalid('websocketCompressionLevel must be an integer from 0 to 9.');
  }
}

// Small synchronous saves serialize updates. Publish in memory only after rename succeeds.
export function openSettings(path) {
  const save = next => {
    writeFileSync(path + '.tmp', JSON.stringify(next, null, 2) + '\n');
    renameSync(path + '.tmp', path);
  };
  let current;
  try {
    let data;
    try { data = readFileSync(path, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      mkdirSync(dirname(path), { recursive: true });
      save(defaults);
      data = JSON.stringify(defaults);
    }
    current = JSON.parse(data);
    validateSettings(current);
  } catch (error) { throw new Error(`${path}: ${error.message}`, { cause: error }); }
  return {
    get: () => ({ ...current }),
    set(next) {
      validateSettings(next);
      const value = { ...next };
      save(value);
      current = value;
      return { ...current };
    },
  };
}
