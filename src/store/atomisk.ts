// The one atomic file write (§4 r5): a tmp file next to the target (unique name, mode 0600), fsync'd, then rename,
// then the directory fsync'd (Linux, best effort) so the rename itself survives a power cut (KC-0275, E4).
// A failure leaves no temp file behind.

import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export async function skrivAtomisk(fil: string, indhold: string): Promise<void> {
  const tmp = `${fil}.tmp-${randomUUID()}`;
  try {
    const h = await open(tmp, 'w', 0o600);
    try {
      await h.writeFile(indhold, 'utf8');
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(tmp, fil);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  if (process.platform === 'linux') {
    try {
      const d = await open(path.dirname(fil), 'r');
      try { await d.sync(); } finally { await d.close(); }
    } catch { /* best effort: a file system that cannot fsync a directory still has the file */ }
  }
}
