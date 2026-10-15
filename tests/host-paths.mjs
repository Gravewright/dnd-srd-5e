import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const moduleRoot = fileURLToPath(new URL('../', import.meta.url));
const isHost = root => existsSync(resolve(root, 'gravewright/modules/static/gravewright_modules/i18n.js')) && existsSync(resolve(root, 'config/settings.py'));
let root;
if (process.env.GRAVEWRIGHT_TEST_HOST_ROOT) {
  root = resolve(process.env.GRAVEWRIGHT_TEST_HOST_ROOT);
  if (!isHost(root)) throw new Error('GRAVEWRIGHT_TEST_HOST_ROOT must point to a Gravewright VTT source checkout (0.2.3 or newer).');
} else {
  for (let candidate = dirname(moduleRoot); candidate !== dirname(candidate); candidate = dirname(candidate)) {
    if (isHost(candidate)) { root = candidate; break; }
  }
}
if (!root) throw new Error('The Translator integration suite needs a Gravewright VTT source checkout (0.2.3 or newer). Set GRAVEWRIGHT_TEST_HOST_ROOT to its root; host code is not bundled in this system.');

export const hostModule = relative => pathToFileURL(resolve(root, relative)).href;
