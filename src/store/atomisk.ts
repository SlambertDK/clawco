// The one atomic file write (§4 r5): a tmp file next to the target, then rename.

import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';

export async function skrivAtomisk(fil: string, indhold: string): Promise<void> {
  const tmp = `${fil}.tmp-${randomUUID()}`;
  await writeFile(tmp, indhold, 'utf8');
  await rename(tmp, fil);
}
