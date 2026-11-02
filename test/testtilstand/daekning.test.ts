// Coverage (KC-0068, spec invariant 3): every function and design main has is
// on screen in at least one moment of the test world. The list is derived from
// the code wherever a source of truth exists, so a new kind fails here until it
// is listed and seeded (AGENTS.md §4 rule 11).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DAEKNING } from '../../src/testtilstand/daekning.ts';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { ALLE_MOMENTER as MOMENTER } from '../../src/testtilstand/indhold.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import { ROOM_MODULES } from '../../src/rooms/modules.ts';
import { BILLEDER, TONER, ZONER } from '../../src/shell/visuel.ts';
import { ART, HVOR, TYPER } from '../../src/rooms/hjem/kort.ts';
import { STATUSSER } from '../../src/udvikling/opgaver.ts';
import { ROLLER } from '../../src/identitet/roller.ts';
import { DATAZONER } from '../../src/identitet/zoner.ts';
import { SITUATION_IDER } from '../../src/situation/regler.ts';
import { BYGGET } from '../../src/shell/katalog.ts';
import { KILDE_TILSTANDE } from '../../src/shell/kilder.ts';
import { OMKOSTNING_SAMLET } from '../../src/shell/omkostninger.ts';
import { alleTrin } from '../../src/rooms/start/trin.ts';
import { TILSTANDE as FORESP_TILSTANDE } from '../../src/hushold/foresp.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-daekning-'));
after(() => rm(rod, { recursive: true, force: true }));

/** Every page of every moment, by "<moment> <path>": each built room, every univers the nav links, the meeting the situation points at, /viden and its Slet alt confirmation (KC-0146), and the Kø panel's Kilder (KC-0120) and cost card (KC-0212). */
const sider: Promise<Map<string, string>> = (async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
  const ud = new Map<string, string>();
  const hent = async (m: string, sti: string): Promise<string> => {
    const res = await v.app.request(sti);
    assert.equal(res.status, 200, `${m} ${sti} svarer ${res.status}`);
    const tekst = await res.text();
    ud.set(`${m} ${sti}`, tekst);
    return tekst;
  };
  for (const m of MOMENTER) {
    await v.hop(m.id);
    const stier = ROOMS.filter((r) => r.built).map((r) => `/rum/${r.id}`);
    const hjem = await hent(m.id, '/rum/hjem');
    for (const sti of stier) if (sti !== '/rum/hjem') await hent(m.id, sti);
    for (const [, id] of hjem.matchAll(/href="\/rum\/(univers-[a-z0-9-]+)"/g)) if (!ud.has(`${m.id} /rum/${id}`)) await hent(m.id, `/rum/${id}`);
    const { moede } = (await (await v.app.request('/api/situation')).json()) as { moede: { url: string } | null };
    if (moede) await hent(m.id, moede.url);
    // KC-0146: what Clawco knows, and Slet alt's confirmation (never the delete itself).
    await hent(m.id, '/viden');
    await hent(m.id, '/viden/slet-alt');
    // KC-0120: the Kø panel's Kilder section, as the open panel fetches it.
    const koe = await v.app.request('/api/koe?kilder=1');
    assert.equal(koe.status, 200, `${m.id} /api/koe svarer ${koe.status}`);
    const k = (await koe.json()) as { kilder?: string; omkostninger?: string };
    ud.set(`${m.id} /api/koe?kilder=1`, k.kilder ?? '');
    ud.set(`${m.id} /api/koe?kilder=1 omkostninger`, k.omkostninger ?? ''); // KC-0212: the owner's cost card
  }
  return ud;
})();

test('DAEKNING lists every value of every derived source, each once', () => {
  const ider = DAEKNING.map((d) => d.id);
  assert.deepEqual(ider.filter((id, i) => ider.indexOf(id) !== i), [], 'no id twice');
  const kilder: [string, readonly string[]][] = [
    ['rum', [...ROOMS.filter((r) => r.built).map((r) => r.id), ...ROOM_MODULES.map((m) => m.id)]],
    ['tone', TONER], ['zone', ZONER], ['billede', BILLEDER],
    ['kort', TYPER], ['regnskab', HVOR], ['art', ART], ['opgave', STATUSSER], ['rolle', ROLLER], ['husstand-rolle', ROLLER], ['datazone', DATAZONER],
    ['situation', SITUATION_IDER], ['blok', BYGGET], ['kilde-tilstand', KILDE_TILSTANDE], ['omkostninger', OMKOSTNING_SAMLET], ['foresp', FORESP_TILSTANDE],
  ];
  for (const [praefiks, vaerdier] of kilder) {
    for (const v of vaerdier) {
      const d = DAEKNING.find((x) => x.id === `${praefiks}:${v}`);
      assert.ok(d, `${praefiks}:${v} mangler i DAEKNING`);
      assert.equal(d.kilde, 'afledt', `${praefiks}:${v} er afledt af koden`);
    }
  }
  // KC-0131: every step of Start's journey, open and Klaret.
  for (const t of alleTrin()) {
    for (const tilstand of ['aaben', 'klaret']) assert.equal(DAEKNING.find((x) => x.id === `start-trin-${t.id}-${tilstand}`)?.kilde, 'afledt', `start-trin-${t.id}-${tilstand} mangler i DAEKNING`);
  }
  assert.ok(DAEKNING.some((d) => d.kilde === 'haand'), 'the hand-kept situations are listed too');
  for (const d of DAEKNING) assert.ok(d.marker.length >= 4, `${d.id} has a real marker`);
});

test('every item in DAEKNING is on screen in at least one moment', async () => {
  const alle = await sider;
  assert.ok(alle.size >= MOMENTER.length * ROOMS.filter((r) => r.built).length, 'every built room was rendered at every moment');
  const mangler = DAEKNING.filter((d) => ![...alle.values()].some((h) => h.includes(d.marker))).map((d) => `${d.id} (${d.marker})`);
  assert.deepEqual(mangler, [], 'items no moment shows: add test data in src/testtilstand/indhold/');
});

test('the marker check can fail: a marker no page has is reported', async () => {
  const alle = await sider;
  assert.ok(![...alle.values()].some((h) => h.includes('data-findes-ikke="kc-0068"')));
});

test('KC-0052: a room is out of the nav in one moment and in it in another', async () => {
  const alle = await sider;
  const skjult = (m: string, rum: string): boolean | undefined => {
    const h = alle.get(`${m} /rum/hjem`);
    const li = h ? new RegExp(`<li([^>]*)><a href="/rum/${rum}"`).exec(h) : null;
    return li ? /\shidden\b/.test(li[1] ?? '') : undefined;
  };
  const skifter = ROOMS.filter((r) => r.id !== 'hjem').map((r) => r.id)
    .filter((rum) => MOMENTER.some((m) => skjult(m.id, rum) === true) && MOMENTER.some((m) => skjult(m.id, rum) === false));
  assert.ok(skifter.length > 0, 'no room appears or disappears between moments');
});
