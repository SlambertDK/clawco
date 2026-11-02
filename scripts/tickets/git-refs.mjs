// Ticket file names as seen by git across EVERY ref, not just the working
// tree. new.mjs uses this so a fresh id never collides with one already used
// on another branch or in a parallel session (a collision found late costs a
// renumbering everywhere the id was referenced). Outside a git repo, or if
// git is missing, it falls back to the working tree alone.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

/**
 * @param {string} ticketsDir absolute path to docs/tickets
 * @returns {string[]} unique file names (no directories) from the working tree plus every local and remote ref
 */
export function ticketFileNamesAcrossRefs(ticketsDir) {
  const names = new Set(readdirSync(ticketsDir));
  // --show-prefix is the path of ticketsDir relative to the repo root as git
  // sees it (a symlinked tmpdir, as on macOS, would defeat path.relative()).
  let rel;
  try { rel = git(ticketsDir, ['rev-parse', '--show-prefix']).trim().replace(/\/$/, ''); } catch { return [...names]; }
  const refs = git(ticketsDir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).split('\n').filter(Boolean);
  for (const ref of refs) {
    let listing = '';
    try { listing = git(ticketsDir, ['ls-tree', '-r', '--name-only', ref, '--', `:/${rel}`]); } catch { continue; }
    for (const p of listing.split('\n')) if (p) names.add(path.posix.basename(p));
  }
  return [...names];
}
