// SPDX-License-Identifier: MIT
// Run a separate, local Homebridge for testing this plugin: its own storage folder (.homebridge-test, gitignored),
// port and bridge name, so it never touches another Homebridge on the network. Nothing is installed globally.
//
//   CANDLES_HOST=<controller address> npm run dev        (or put <CONTROLLER_IP> in ../site.local.md)
//   npm run dev -- --insecure                            also allow local HAP requests for scripted checks
//
// The test bridge is not paired with anything until you add it in the Home app yourself.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storage = join(here, '.homebridge-test');
const plugins = join(storage, 'plugins');

function hostFromSiteFile() {
  const site = resolve(here, '..', 'site.local.md');
  if (!existsSync(site)) return '';
  const row = readFileSync(site, 'utf8').split('\n').find((l) => l.includes('`<CONTROLLER_IP>`'));
  return row ? row.split('|').map((c) => c.trim()).filter(Boolean).pop() ?? '' : '';
}

const host = process.env.CANDLES_HOST || hostFromSiteFile();
if (!host) {
  console.error('Set CANDLES_HOST=<controller address> (or fill in <CONTROLLER_IP> in site.local.md).');
  process.exit(1);
}

mkdirSync(plugins, { recursive: true });
const link = join(plugins, 'homebridge-wled-candles');
if (!existsSync(link)) symlinkSync(here, link, 'dir');

const cfgPath = join(storage, 'config.json');
let cfg;
if (existsSync(cfgPath)) {
  cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
} else {
  const mac = [...randomBytes(6)].map((b, i) => (i === 0 ? (b & 0xfe) | 0x02 : b).toString(16).padStart(2, '0')).join(':').toUpperCase();
  const d = () => String(Math.floor(Math.random() * 10));
  cfg = {
    bridge: { name: 'Candles Dev', username: mac, port: 51830, pin: `${d()}${d()}${d()}-${d()}${d()}-${d()}${d()}${d()}` },
    platforms: [{ platform: 'WledCandles', name: 'Candles Dev', host, debug: true }],
  };
}
cfg.platforms = cfg.platforms.map((p) => (p.platform === 'WledCandles' ? { ...p, host } : p));
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`Test bridge "${cfg.bridge.name}" on port ${cfg.bridge.port}, setup code ${cfg.bridge.pin}`);

const args = ['-U', storage, '-P', plugins, '--strict-plugin-resolution', '-D'];
if (process.argv.includes('--insecure')) args.push('-I');
const bin = join(here, 'node_modules', 'homebridge', 'bin', 'homebridge');
const child = spawn(process.execPath, [bin, ...args], { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
