// Local dev (KC_AGENT=fake): no himalaya on the Mac, so the runner
// answers from the test fixture and a plan file for today is written into
// the data dir. Never used on kira-home.

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Runner } from './source.ts';

const FIXTURES = new URL('../../../test/fixtures/', import.meta.url);

export function devMailRunner(): Runner {
  const handling = readFileSync(new URL('himalaya_handling_sample.json', FIXTURES), 'utf8');
  return async (_cmd, args) => {
    const m = args[args.indexOf('-m') + 1];
    if (m === 'Folders/Handling') return { code: 0, stdout: handling, stderr: '' };
    const n = m === 'Folders/Regninger' ? 12 : m === 'Folders/Afventer' ? 1 : 0;
    const envelopes = Array.from({ length: n }, (_, i) => ({ id: String(900 + i), subject: `Mail ${i}`, from: [{ name: 'Afsender', email: 'a@b' }], date: '2026-10-20T10:00:00Z', flags: [] }));
    return { code: 0, stdout: JSON.stringify({ envelopes }), stderr: '' };
  };
}

export async function devMailStateDir(dataDir: string, now: Date): Promise<string> {
  const dir = path.join(dataDir, 'dev-hermes-state');
  await mkdir(dir, { recursive: true });
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  await writeFile(path.join(dir, `mail-plan-auto-${date}-080001.json`), readFileSync(new URL('mail-plan-auto-sample.json', FIXTURES), 'utf8'));
  return dir;
}
