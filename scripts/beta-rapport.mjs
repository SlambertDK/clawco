#!/usr/bin/env node
// Usage: npm run --silent beta:rapport [-- --json]
// KC-0203: the closed beta's report — retention, first-value and provisioning times, "ting der krævede dig", the
// ratings and the free-text list, and the end criteria (a)-(d) as ja/nej with the numbers. Reads Sky's database; changes
// nothing. Run it where Sky's environment file is (default /srv/sky/.env; SKY_ENV_FIL names another).
// The tenant never imports Sky code (sky/test/aftryk.test.ts), so this starts Sky's script as a child process.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sky = fileURLToPath(new URL('../sky/scripts/beta-rapport.ts', import.meta.url));
const r = spawnSync(process.execPath, [`--env-file-if-exists=${process.env.SKY_ENV_FIL ?? '/srv/sky/.env'}`, sky, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = r.status ?? 1;
