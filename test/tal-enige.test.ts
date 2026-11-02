// KC-0093: the numbers agree everywhere. Invariant: a room's count in the nav is the
// "N venter på dig" inside that room, and the tab title's count (and the fragment's
// venter, which the client turns into the title and the app badge) is Hjem's
// "N venter på dig". Checked through the HTML at every moment of the test world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../src/testtilstand/verden.ts';
import { MOMENTER } from '../src/testtilstand/indhold.ts';
import { antalVenter } from '../src/shell/synlig.ts';

/** The nav's counts by room id (hidden rooms too). */
function navTal(side: string): Map<string, number> {
  const ud = new Map<string, number>();
  const nav = side.slice(side.indexOf('<nav'), side.indexOf('</nav>'));
  for (const m of nav.matchAll(/<a href="\/rum\/([a-z0-9-]+)"[^>]*><span>[^<]*<\/span>(?:<span class="count">(\d+)<\/span>)?/g)) ud.set(m[1] ?? '', Number(m[2] ?? 0));
  return ud;
}

/** The room's own "N venter på dig" (0 for "Intet venter på dig"); null when the room shows no count line. */
function rummetsTal(side: string): number | null {
  const linje = /<p class="taellelinje">([\s\S]*?)<\/p>/.exec(side)?.[1];
  if (linje === undefined) return null;
  return Number(/(\d+) venter på dig/.exec(linje)?.[1] ?? 0);
}

const titelTal = (side: string): number => Number(/<title>\((\d+)\) /.exec(side)?.[1] ?? 0);

test('KC-0093: nav count = the room\'s own count, and title = Hjem\'s count, at every moment', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-tal-'));
  try {
    const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
    for (const m of MOMENTER) {
      await verden.hop(m.id);
      const hjem = await (await verden.app.request('/rum/hjem')).text();
      const hjemTal = rummetsTal(hjem);
      assert.notEqual(hjemTal, null, `${m.id}: Hjem har en tællelinje`);
      assert.equal(titelTal(hjem), hjemTal, `${m.id}: fanens titel = Hjems "venter på dig"`);
      const frag = (await (await verden.app.request('/api/rum/hjem/fragment')).json()) as { venter: Record<string, number> };
      assert.equal(antalVenter(frag.venter), hjemTal, `${m.id}: titlen efter en live-opdatering = Hjems "venter på dig"`);
      for (const [id, n] of navTal(hjem)) {
        if (id === 'hjem') { assert.equal(n, hjemTal, `${m.id}: menuens tal ved Hjem = Hjems "venter på dig" (alt i alt)`); continue; }
        const res = await verden.app.request(`/rum/${id}`);
        if (res.status !== 200) continue;
        const side = await res.text();
        const egen = rummetsTal(side);
        if (egen === null) { assert.equal(n, 0, `${m.id}: ${id} har tal i menuen men ingen tællelinje`); continue; }
        assert.equal(n, egen, `${m.id}: menuens tal ved ${id} = rummets "venter på dig"`);
        assert.equal(titelTal(side), hjemTal, `${m.id}: fanens titel i ${id} = Hjems "venter på dig"`);
      }
    }
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
});
