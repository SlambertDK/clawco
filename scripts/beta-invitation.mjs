#!/usr/bin/env node
// Usage: npm run --silent beta:invitation -- --antal 10   (also --annuller <kode>, --annuller-alle, --forlaeng-til ÅÅÅÅ-MM-DD)
// KC-0203: single-use invitation codes for the closed beta. The codes are printed once, by Sky's own script, and
// nothing else goes to stdout (this wrapper prints nothing of its own). Run it where Sky's environment file is
// (default /srv/sky/.env on the server; SKY_ENV_FIL names another); it needs `npm --prefix sky ci`.
// The tenant never imports Sky code (sky/test/aftryk.test.ts), so this starts Sky's script as a child process.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sky = fileURLToPath(new URL('../sky/scripts/beta-invitation.ts', import.meta.url));
const r = spawnSync(process.execPath, [`--env-file-if-exists=${process.env.SKY_ENV_FIL ?? '/srv/sky/.env'}`, sky, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = r.status ?? 1;
