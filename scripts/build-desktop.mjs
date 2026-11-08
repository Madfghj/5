import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(await readFile(new URL('../mobile.config.json', import.meta.url), 'utf8'));
const api = new URL(process.env.VITE_API_URL || config.apiOrigin);
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || !['', '/'].includes(api.pathname)
  || ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(api.hostname)) {
  throw new Error('Desktop builds require the public HTTPS API origin, without credentials, /api, query or fragment.');
}
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dev')) throw new Error('Usage: node scripts/build-desktop.mjs [--dev]');
const dev = args.includes('--dev');
const env = { ...process.env, VITE_API_URL: api.origin, VITE_DESKTOP: '1' };
const steps = dev
  ? [['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort']]
  : [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-desktop', '--target', 'safari15']];
for (const step of steps) {
  const result = spawnSync(process.execPath, step, { stdio: 'inherit', env, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!dev) console.log(`Desktop UI targets Safari 15+ with cloud API ${api.origin}`);
