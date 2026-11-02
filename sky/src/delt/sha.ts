import { execSync } from 'node:child_process';

/** The running commit, by the same mechanism as the tenant's gitSha() in src/server.ts (one scheme, mirrored). */
export function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}
