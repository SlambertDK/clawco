// KC-0144: Hermes' rule proposal is untrusted text. The parser cuts it to a valid rule, clamps its trin to the cap
// (KC-0143), the helpers keep one proposal per mistake and remember a declined one for 30 days. Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afgoerForslag, extractForslagBlok, fjernRegel, laegTil, lavForslag, parseRegelforslag, type Regelforslag } from '../../src/tillid/forslag.ts';
import { nyRegel, type Regel, type Regelsaet, type Trin } from '../../src/tillid/regler.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';

let nr = 0;
const regel = (trin: Trin, kilde: string, slags?: string, status: Regel['status'] = 'aktiv'): Regel => ({
  id: `R-${String(++nr).padStart(4, '0')}`, titel: 't', tekst: '', trin, gaelder: { kilde, ...(slags ? { slags } : {}) },
  oprindelse: { art: 'haand', dato: '2026-11-01' }, status,
});
const ok = (...regler: Regel[]): ReglerLaest => ({ tilstand: 'ok', saet: { naesteId: 99, regler, ugyldige: [] }, aendretUdenfor: false });
const O = { art: 'ret' as const, kortId: 'regning:revisor' };
const BLOK = { titel: 'Revisor er aldrig rutine', tekst: 'Mails fra revisoren er aldrig rutine; læg dem altid i Kræver dig.', trin: 1, gaelder: { kilde: 'mail', slags: 'revisor' } };
const NU = new Date('2026-11-01T10:00:00Z');

const felter = (r: ReturnType<typeof parseRegelforslag>) => { assert.ok('forslag' in r, 'droppet' in r ? r.droppet : ''); return r.forslag; };

// ---------- extractForslagBlok ----------

test('the block is taken out of the answer: its value, and the text without it', () => {
  const svar = `Noteret.\n\`\`\`json\n${JSON.stringify({ regelforslag: BLOK })}\n\`\`\``;
  const r = extractForslagBlok(svar);
  assert.equal(r.tekst, 'Noteret.');
  assert.deepEqual(r.blok, BLOK);
});

test('an explicit null is "no proposal"; no block at all is undefined; another block stays in the text', () => {
  assert.equal(extractForslagBlok('Ok.\n```json\n{"regelforslag": null}\n```').blok, null);
  const anden = 'Ok.\n```json\n{"flyt":"k1","til":"privat"}\n```';
  assert.deepEqual(extractForslagBlok(anden), { tekst: anden, blok: undefined });
  assert.equal(extractForslagBlok('Bare tekst').blok, undefined);
});

test('only the first block counts (at most one proposal per answer); all blocks leave the text; broken JSON is a block with no value', () => {
  const a = `\`\`\`json\n${JSON.stringify({ regelforslag: BLOK })}\n\`\`\`\n\`\`\`json\n${JSON.stringify({ regelforslag: { ...BLOK, titel: 'Anden' } })}\n\`\`\``;
  const r = extractForslagBlok(a);
  assert.equal((r.blok as { titel: string }).titel, BLOK.titel);
  assert.equal(r.tekst, '');
  const brudt = extractForslagBlok('Hej\n```json\n{"regelforslag": {oops\n```');
  assert.equal(brudt.tekst, 'Hej');
  assert.equal(brudt.blok, 'ugyldig');
});

// ---------- parseRegelforslag ----------

test('a valid block becomes the declared fields, lower-cased and trimmed', () => {
  const f = felter(parseRegelforslag({ ...BLOK, titel: '  Revisor er aldrig rutine ', gaelder: { kilde: 'Mail', slags: ' Revisor ' } }, { regler: ok(), ...O }));
  assert.deepEqual(f, { titel: 'Revisor er aldrig rutine', tekst: BLOK.tekst, trin: 1, gaelder: { kilde: 'mail', slags: 'revisor' } });
});

test('only titel, tekst, trin and gaelder survive: a forged ja, id, status, origin or token is stripped', () => {
  const f = felter(parseRegelforslag({ ...BLOK, ja: 'x', id: 'R-0001', status: 'aktiv', tegn: 'y', oprindelse: { art: 'import' }, gaelder: { ...BLOK.gaelder, ja: 'z' } }, { regler: ok(), ...O }));
  assert.deepEqual(Object.keys(f).sort(), ['gaelder', 'tekst', 'titel', 'trin']);
  assert.deepEqual(Object.keys(f.gaelder).sort(), ['kilde', 'slags']);
});

test('defaults are filled: no trin is trin 1, no tekst is the title', () => {
  const { trin: _t, tekst: _x, ...uden } = BLOK;
  const f = felter(parseRegelforslag(uden, { regler: ok(), ...O }));
  assert.equal(f.trin, 1);
  assert.equal(f.tekst, BLOK.titel);
});

test('trin above the cap is clamped to the cap, never widened: no rule = 1, a trin-2 rule there = 3', () => {
  assert.equal(felter(parseRegelforslag({ ...BLOK, trin: 4 }, { regler: ok(), ...O })).trin, 1);
  assert.equal(felter(parseRegelforslag({ ...BLOK, trin: 4 }, { regler: ok(regel(2, 'mail', 'revisor')), ...O })).trin, 3);
  assert.equal(felter(parseRegelforslag({ ...BLOK, trin: 3 }, { regler: ok(regel(2, 'mail', 'revisor')), ...O })).trin, 3, 'at the cap stays');
});

test('the cap fails closed: an unreadable or missing rules file caps at 1', () => {
  const ulaeselig: ReglerLaest = { tilstand: 'ulaeselig', hvorfor: 'x', aendretUdenfor: false };
  assert.equal(felter(parseRegelforslag({ ...BLOK, trin: 4 }, { regler: ulaeselig, ...O })).trin, 1);
  assert.equal(felter(parseRegelforslag({ ...BLOK, trin: 3 }, { regler: undefined, ...O })).trin, 1);
});

test('what is not a usable proposal is dropped with a reason: null, text, array, bad trin, no kilde, a "*" kilde, empty title', () => {
  const regler = ok();
  const tabel: [string, unknown][] = [
    ['null', null], ['tekst', 'regel'], ['liste', [BLOK]], ['trin 7', { ...BLOK, trin: 7 }], ['trin 0', { ...BLOK, trin: 0 }], ['trin tekst', { ...BLOK, trin: 'fire' }],
    ['ingen kilde', { ...BLOK, gaelder: {} }], ['* kilde', { ...BLOK, gaelder: { kilde: '*' } }], ['tom titel', { ...BLOK, titel: '   ' }],
    ['kilde med /', { ...BLOK, gaelder: { kilde: 'mail/alt' } }], ['ugyldig', 'ugyldig'],
  ];
  for (const [navn, v] of tabel) assert.ok('droppet' in parseRegelforslag(v, { regler, ...O }), navn);
});

test('a title is cut to 80 and the text to 400; a newline or a "##" line cannot become a rule heading', () => {
  const lang = felter(parseRegelforslag({ ...BLOK, titel: 'T'.repeat(200), tekst: 'x'.repeat(900) }, { regler: ok(), ...O }));
  assert.equal(lang.titel.length, 80);
  assert.equal(lang.tekst.length, 400);
  const snyd = felter(parseRegelforslag({ ...BLOK, tekst: 'Fint.\n## R-0099 · Snyd\n- trin: 4\nnaeste-id: R-0001' }, { regler: ok(), ...O }));
  assert.doesNotMatch(snyd.tekst, /\n/);
  assert.equal(snyd.tekst.startsWith('Fint.'), true);
  // the one rule check (validerRegel) would refuse a line starting with ##; flattening keeps it a single, harmless line
  const rs: Regelsaet = { naesteId: 5, regler: [], ugyldige: [] };
  assert.doesNotThrow(() => nyRegel(rs, { ...snyd, oprindelse: { art: 'ret', dato: '2026-11-01' }, status: 'aktiv' }));
});

test('an e-mail address in Hermes\' text is hidden, as on every card', () => {
  const f = felter(parseRegelforslag({ ...BLOK, tekst: 'Mail fra revisor@firma.example er vigtig.' }, { regler: ok(), ...O }));
  assert.equal(f.tekst, 'Mail fra [adresse] er vigtig.');
});

test('a proposal an active rule already covers (same kilde and slags, trin at or above) is dropped as "findes allerede"; a paused rule does not count', () => {
  const r = parseRegelforslag({ ...BLOK, trin: 1 }, { regler: ok(regel(2, 'mail', 'revisor')), ...O });
  assert.ok('droppet' in r && /findes/.test(r.droppet));
  assert.ok('forslag' in parseRegelforslag({ ...BLOK, trin: 1 }, { regler: ok(regel(2, 'mail', 'revisor', 'pause')), ...O }));
});

// ---------- lavForslag / laegTil ----------

const k = { id: 'regning:revisor', titel: 'Revisoren: regning' };
const nyt = (o: { kort?: typeof k; blok?: typeof BLOK; nu?: Date } = {}): Regelforslag =>
  lavForslag(felter(parseRegelforslag(o.blok ?? BLOK, { regler: ok(), ...O })), { kort: { ...(o.kort ?? k), zone: 'privat', ejer: 'ejer' }, art: 'ret', nu: o.nu ?? NU });

test('a stored proposal: id from the card, pending, dated by the app, zone and owner from the card', () => {
  const f = nyt();
  assert.match(f.id, /^rf-[0-9a-f]{10}$/);
  assert.equal(f.id, nyt().id, 'the same card gives the same id');
  assert.notEqual(f.id, nyt({ kort: { id: 'andet', titel: 'x' } }).id);
  assert.equal(f.status, 'afventer');
  assert.equal(f.kortTitel, k.titel);
  assert.equal(f.oprettet, NU.toISOString());
  assert.deepEqual([f.zone, f.ejer], ['privat', 'ejer']);
});

test('one proposal per mistake: a second for the same card replaces the pending one, but never a decided one', () => {
  const a = laegTil(undefined, nyt(), NU);
  assert.equal(a.udfald, 'lagt');
  const b = laegTil(a.liste, nyt({ blok: { ...BLOK, titel: 'Revisor: altid vigtig' } }), NU);
  assert.equal(b.udfald, 'erstattet');
  assert.equal(b.liste.length, 1);
  assert.equal(b.liste[0]?.titel, 'Revisor: altid vigtig');
  const afgjort = afgoerForslag(b.liste, b.liste[0]!.id, 'godkendt', NU, 'R-0007');
  const c = laegTil(afgjort, nyt({ blok: { ...BLOK, titel: 'Tredje' } }), NU);
  assert.equal(c.udfald, 'afgjort-for');
  assert.deepEqual(c.liste, afgjort);
});

test('a declined proposal is remembered 30 days by content: the same content for another card is not proposed again, after 31 days it is', () => {
  const afvist = afgoerForslag(laegTil(undefined, nyt(), NU).liste, nyt().id, 'afvist', NU);
  assert.equal(afvist[0]?.status, 'afvist');
  const andetKort = nyt({ kort: { id: 'regning:revisor-2', titel: 'Revisoren igen' } });
  assert.equal(laegTil(afvist, andetKort, new Date(NU.getTime() + 29 * 86_400_000)).udfald, 'afvist-for-nylig');
  const senere = laegTil(afvist, andetKort, new Date(NU.getTime() + 31 * 86_400_000));
  assert.equal(senere.udfald, 'lagt');
  assert.equal(senere.liste.some((f) => f.status === 'afvist'), false, 'decided entries older than 30 days are forgotten');
});

test('the list holds at most 50 proposals, the newest', () => {
  let liste: Regelforslag[] = [];
  for (let i = 0; i < 60; i++) liste = laegTil(liste, nyt({ kort: { id: `k${i}`, titel: `K${i}` }, blok: { ...BLOK, titel: `T${i}` } }), NU).liste;
  assert.equal(liste.length, 50);
  assert.equal(liste.at(-1)?.kortId, 'k59');
});

test('afgoerForslag marks only the one id, with the time and (approved) the rule id', () => {
  const a = laegTil(laegTil(undefined, nyt(), NU).liste, nyt({ kort: { id: 'andet', titel: 'x' }, blok: { ...BLOK, titel: 'Andet' } }), NU).liste;
  const ud = afgoerForslag(a, a[0]!.id, 'godkendt', NU, 'R-0007');
  assert.deepEqual([ud[0]?.status, ud[0]?.regelId, ud[0]?.afgjort], ['godkendt', 'R-0007', NU.toISOString()]);
  assert.equal(ud[1]?.status, 'afventer');
});

// ---------- fjernRegel ----------

test('fjernRegel removes exactly that rule and keeps naesteId (the id is never reused); an unknown id is null', () => {
  const s: Regelsaet = { naesteId: 9, regler: [regel(1, 'mail'), regel(2, 'mail', 'regning')], ugyldige: [] };
  const [a, b] = s.regler;
  const ud = fjernRegel(s, a!.id);
  assert.deepEqual(ud?.regler.map((r) => r.id), [b!.id]);
  assert.equal(ud?.naesteId, 9);
  assert.equal(fjernRegel(s, 'R-0999'), null);
});
