// KC-0187: the alert rules. Each rule fires once while its condition holds, fires again only after it cleared, carries
// counts and tenant ids only, and goes to the operator by mail (the Post seam, KC-0178) and as an error event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmer, alarmLoekke, alarmModtager, alarmSignaler, ALARM_REGLER, type Signaler } from '../../src/drift/alarm.ts';
import { falskPost } from '../../src/delt/post.ts';
import { lavFejlrapport, type Haendelse } from '../../src/delt/fejlrapport-kerne.ts';
import { noterForsoeg, noterProeve, noterSucces } from '../../src/drift/backup/tilstand.ts';
import { gemUdgave, gribTenant, opretUdrulning, standsVed } from '../../src/drift/udrulning/tilstand.ts';
import { nyDb } from '../konto/hjaelp.ts';

const NU = new Date('2026-11-02T10:00:00.000Z');
const timer = (n: number) => new Date(NU.getTime() - n * 3_600_000);
const minutter = (n: number) => new Date(NU.getTime() - n * 60_000);
const dage = (n: number) => new Date(NU.getTime() + n * 86_400_000);
const TIL = 'drift@example.com';

/** One signal set per rule that must fire, and one that must not. */
const FYRER: Record<(typeof ALARM_REGLER)[number], { ja: Signaler; nej: Signaler }> = {
  'backup-gammel': {
    ja: { kopier: [{ omfang: 'db', oprettet: timer(100), sidsteSucces: timer(37) }, { omfang: 'maja', oprettet: timer(40), sidsteSucces: null }] },
    nej: { kopier: [{ omfang: 'db', oprettet: timer(100), sidsteSucces: timer(35) }, { omfang: 'ny', oprettet: timer(2), sidsteSucces: null }] },
  },
  'gendannelse-fejlet': {
    ja: { proever: [{ omfang: 'maja', slut: timer(3), ok: false }, { omfang: 'db', slut: timer(3), ok: true }] },
    nej: { proever: [{ omfang: 'maja', slut: timer(3), ok: true }] },
  },
  'udrulning-fejlet': {
    ja: { udrulning: { id: 4, tilstand: 'standset', problemer: [{ slug: 'maja', tilstand: 'fejlet' }, { slug: 'emil', tilstand: 'tilbagerullet' }] } },
    nej: { udrulning: { id: 4, tilstand: 'faerdig', problemer: [{ slug: 'ida', tilstand: 'sprunget-over' }] } },
  },
  provisionering: {
    ja: { provisionering: [{ slug: 'maja', startet: minutter(3), tilstand: 'igang' }, { slug: 'emil', startet: minutter(1), tilstand: 'fejlet' }] },
    nej: { provisionering: [{ slug: 'maja', startet: minutter(1), tilstand: 'igang' }] },
  },
  'faa-pladser': { ja: { ledigePladser: 2 }, nej: { ledigePladser: 3 } },
  'tenant-usund': {
    ja: { usunde: [{ slug: 'maja', siden: minutter(6) }] },
    nej: { usunde: [{ slug: 'maja', siden: minutter(4) }] },
  },
  certifikat: {
    ja: { certifikater: [{ navn: 'konto.example.com', udloeber: dage(13) }] },
    nej: { certifikater: [{ navn: 'konto.example.com', udloeber: dage(15) }] },
  },
  // KC-0194: paid invoices over the trailing 12 months reach the warning threshold (exactly at it fires).
  'moms-graense': {
    ja: { omsaetning: { oere: 4_000_000, graenseOere: 4_000_000, andreValutaer: 0 } },
    nej: { omsaetning: { oere: 3_999_999, graenseOere: 4_000_000, andreValutaer: 0 } },
  },
};

test('KC-0194: the VAT alert says what to do: the 12-month total, the threshold, CVR and VAT registration, the config switch', async () => {
  const { post, a } = opstil();
  await a.vurder({ omsaetning: { oere: 4_123_456, graenseOere: 4_000_000, andreValutaer: 2 } }, NU);
  const b = post.udbakke[0]!;
  assert.equal(b.data['titel'], 'Momsregistrering nærmer sig');
  assert.match(b.data['tekst']!, /41\.234,56 kr\./);
  assert.match(b.data['tekst']!, /40\.000 kr\./);
  assert.match(b.data['tekst']!, /CVR/);
  assert.match(b.data['tekst']!, /moms\.aktiv/);
  assert.match(b.data['tekst']!, /2 fakturaer i andre valutaer/);
});

function opstil(o: { til?: string | null } = {}) {
  const post = falskPost();
  const events: Haendelse[] = [];
  const rapport = lavFejlrapport({ transport: async (_k, h) => { events.push(h); }, release: 'abc1234' });
  const a = alarmer({ post, til: o.til === undefined ? TIL : o.til, rapport, log: () => {} });
  return { post, events, rapport, a };
}

for (const regel of ALARM_REGLER) {
  test(`${regel}: fires once, de-duplicates, fires again after it cleared; its text carries counts and ids only`, async () => {
    const { post, events, rapport, a } = opstil();
    assert.deepEqual((await a.vurder(FYRER[regel].nej, NU)).map((x) => x.regel), []);
    const foerste = await a.vurder(FYRER[regel].ja, NU);
    assert.deepEqual(foerste.map((x) => x.regel), [regel]);
    assert.deepEqual(await a.vurder(FYRER[regel].ja, NU), [], 'the same condition does not fire twice');
    assert.equal(post.udbakke.length, 1);
    const b = post.udbakke[0]!;
    assert.equal(b.til, TIL);
    assert.equal(b.skabelon, 'alarm');
    // Counts and ids: digits, the tenant slugs from the signal, fixed words. No host name, no free text from a signal.
    assert.doesNotMatch(b.data['tekst']!, /example\.com|@/);
    assert.match(b.data['tekst']!, /\d/);
    await rapport.vent();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.tags['alarm'], regel);
    assert.equal(events[0]!.level, 'warning');
    assert.equal(events[0]!.exception.values[0]!.value, b.data['tekst']!.slice(0, 200));
    // Cleared, then back: one more alert.
    await a.vurder(FYRER[regel].nej, NU);
    assert.deepEqual((await a.vurder(FYRER[regel].ja, NU)).map((x) => x.regel), [regel]);
    assert.equal(post.udbakke.length, 2);
  });
}

test('a rule whose signal is absent this pass neither fires nor forgets what it already sent', async () => {
  const { post, a } = opstil();
  await a.vurder(FYRER['faa-pladser'].ja, NU);
  await a.vurder({}, NU);
  await a.vurder(FYRER['faa-pladser'].ja, NU);
  assert.equal(post.udbakke.length, 1);
});

test('the text names the tenants of the signal and their number', async () => {
  const { post, a } = opstil();
  await a.vurder(FYRER['udrulning-fejlet'].ja, NU);
  const t = post.udbakke[0]!.data['tekst']!;
  assert.match(t, /\b2\b/);
  assert.match(t, /emil, maja/);
  assert.doesNotMatch(t, /: /, 'no colon: the error event keeps a safe message only up to one');
});

test('an id outside the tenant form is never written into the text', async () => {
  const { post, a } = opstil();
  await a.vurder({ usunde: [{ slug: 'MARKOER prompt tekst', siden: minutter(10) }, { slug: 'maja', siden: minutter(10) }] }, NU);
  const t = post.udbakke[0]!.data['tekst']!;
  assert.doesNotMatch(t, /markoer/i);
  assert.match(t, /\b2\b/);
});

test('a long list is cut to ten ids plus a count', async () => {
  const { post, a } = opstil();
  await a.vurder({ usunde: Array.from({ length: 25 }, (_, i) => ({ slug: `kunde-${String(i).padStart(2, '0')}`, siden: minutter(10) })) }, NU);
  const t = post.udbakke[0]!.data['tekst']!;
  assert.match(t, /\b25\b/);
  assert.match(t, /og 15 til/);
  assert.ok(t.length <= 300);
});

test('a mail the provider refuses is retried on the next pass (the alert is not marked sent)', async () => {
  const { post, events, rapport, a } = opstil();
  post.fejl = true;
  assert.deepEqual(await a.vurder(FYRER['faa-pladser'].ja, NU), []);
  post.fejl = false;
  assert.deepEqual((await a.vurder(FYRER['faa-pladser'].ja, NU)).map((x) => x.regel), ['faa-pladser']);
  assert.equal(post.udbakke.length, 1);
  await rapport.vent();
  assert.equal(events.length, 1, 'the error event went out once, on the first pass, mail or not');
});

test('no operator address: the alert is still an error event, and no mail is attempted', async () => {
  const { post, events, rapport, a } = opstil({ til: null });
  assert.deepEqual((await a.vurder(FYRER['faa-pladser'].ja, NU)).map((x) => x.regel), ['faa-pladser']);
  await rapport.vent();
  assert.equal(post.udbakke.length, 0);
  assert.equal(events.length, 1);
});

test('signals from the database: an old backup, a failed drill and a stopped rollout (KC-0185, KC-0186)', async () => {
  const db = await nyDb();
  try {
    await noterForsoeg(db, 'db', timer(50));
    await noterForsoeg(db, 'maja', timer(10));
    await noterSucces(db, { omfang: 'maja', id: '20261102T000000Z-0123abcd', tid: timer(10), bytes: 1, manifest: { antal: 1, digest: 'd'.repeat(64) } as never, kekVersion: 1 }, timer(10));
    await noterProeve(db, { omfang: 'maja', snapshot: 's', startet: timer(5), slut: timer(5), ok: false, trin: 'gendan', fejl: 'x' });
    await gemUdgave(db, { tag: 'clawco:bbbbbbb', sha: 'bbbbbbb', billedeId: `sha256:${'b'.repeat(64)}` }, timer(3));
    const id = await opretUdrulning(db, { udgave: 'clawco:bbbbbbb', hold: 'intern', tenanter: [{ slug: 'emil', hold: 'intern' }], nu: timer(3) });
    await gribTenant(db, id, 'emil', timer(3));
    await standsVed(db, id, 'emil', 'fejlet', 'sundhed', timer(2));
    const s = await alarmSignaler(db, NU);
    assert.deepEqual(s.kopier?.map((k) => k.omfang).sort(), ['db', 'maja']);
    assert.deepEqual(s.proever, [{ omfang: 'maja', slut: timer(5), ok: false }]);
    assert.deepEqual(s.udrulning, { id, tilstand: 'standset', problemer: [{ slug: 'emil', tilstand: 'fejlet' }] });
    const { a } = opstil();
    assert.deepEqual((await a.vurder(s, NU)).map((x) => x.regel).sort(), ['backup-gammel', 'gendannelse-fejlet', 'udrulning-fejlet']);
  } finally {
    await db.close();
  }
});

test('the operator address comes from SKY_ALARM_TIL; unset or not one address = no mail', () => {
  assert.equal(alarmModtager({ SKY_ALARM_TIL: ' drift@example.com ' }), 'drift@example.com');
  for (const v of [undefined, '', 'ikke en adresse', 'a@b', 'x@example.com, y@example.com']) assert.equal(alarmModtager({ SKY_ALARM_TIL: v }), null, String(v));
});

test('the loop runs the rules, and a pass that throws is reported, never thrown', async () => {
  const events: Haendelse[] = [];
  const rapport = lavFejlrapport({ transport: async (_k, h) => { events.push(h); } });
  const post = falskPost();
  const a = alarmer({ post, til: TIL, rapport, log: () => {} });
  let kald = 0;
  const signaler = async (): Promise<Signaler> => { kald += 1; if (kald > 1) throw new Error('MARKOER db nede'); return FYRER['faa-pladser'].ja; };
  const l = alarmLoekke({ signaler, alarm: a, rapport, interval: 60_000, nu: () => NU, log: () => {} });
  try {
    await l.gennemloeb(); // the first pass, already running: joined, not doubled (two passes at once could mail twice)
    assert.equal(kald, 1);
    await l.gennemloeb();
    await rapport.vent();
    assert.equal(post.udbakke.length, 1);
    assert.deepEqual(events.map((e) => e.tags['alarm']).sort(), ['faa-pladser', 'gennemloeb']);
    assert.doesNotMatch(JSON.stringify(events), /markoer/i);
  } finally {
    l.stop();
  }
});
