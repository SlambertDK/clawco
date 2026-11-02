import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The running commit, by the same mechanism as the tenant's gitSha() in src/server.ts (one scheme, mirrored). */
export function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

/** Sky's own version, from sky/package.json (KC-0201: one of the facts "Få hjælp" puts in the mail). */
export function skyVersion(): string {
  try { return String((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? 'unknown'); } catch { return 'unknown'; }
}
