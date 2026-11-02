import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sigBeslutning, stemmeMail } from '../../src/rooms/mail/stemme.ts';
import { renderMail } from '../../src/rooms/mail/render.ts';
import type { Beslutning, MailState } from '../../src/rooms/mail/schema.ts';

const svar: Beslutning = { mailId: '242', emne: 'Tilbud på <b>eltavle</b>', fra: 'Elektrikeren ApS <post@elek.example>', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'Tilbud på 18.400 kr.', betydning: 'Du skal svare inden fredag', frist: '2026-10-30', udkast: 'Hej', arkivmappe: 'Folders/Afventer', muligheder: [{ id: '242-ring', label: 'Ring til dem', instruktion: 'i' }] };
const brev: Beslutning = { mailId: '243', emne: 'Ugens energinyt', fra: 'Nyhedsbrev', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'x', betydning: 'Du åbner det aldrig.', arkivmappe: 'Archive', muligheder: [{ id: '243-afmeld', label: 'Afmeld', instruktion: 'i' }] };
const klar: Beslutning = { mailId: '244', emne: 'Kvittering', fra: 'Shop', modtaget: '2026-10-24T09:12:00Z', type: 'kvittering', resume: 'x', betydning: 'Ingen handling.', arkivmappe: 'Folders/køb', muligheder: [], afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' } };

function state(beslutninger: Beslutning[]): MailState {
  return { dato: '2026-10-27', genereret: '2026-10-27T08:40:00.000Z', tal: { handling: 3, afventer: 0, regninger: 0, sorteretIDag: 0 }, beslutninger, ordnet: [], hermesStatus: 'ok' };
}

test('sigBeslutning names the sender without the address, the subject, the meaning, the deadline as words and the ready draft', () => {
  const s = sigBeslutning(svar);
  assert.match(s, /^Mail fra Elektrikeren ApS: Tilbud på <b>eltavle<\/b>\./);
  assert.match(s, /Du skal svare inden fredag\./);
  assert.match(s, /Fristen er fredag den 30\. oktober\./);
  assert.match(s, /Hermes har et udkast til svar klar\.$/);
  assert.doesNotMatch(s, /post@elek\.example|2026-10-30/);
});

test('sigBeslutning leaves out the draft sentence for non-svar types and the deadline when there is none', () => {
  const s = sigBeslutning(brev);
  assert.equal(s, 'Mail fra Nyhedsbrev: Ugens energinyt. Du åbner det aldrig.');
});

test('stemmeMail lists only undecided mails with the mulighed ids plus Færdig, and never a send option', () => {
  const r = stemmeMail(state([svar, brev, klar]));
  assert.equal(r.rum, 'mail');
  assert.equal(r.resume, '2 mails venter på din beslutning.');
  assert.deepEqual(r.punkter.map((p) => p.id), ['242', '243']);
  assert.deepEqual(r.punkter[0]?.valg, [{ id: '242-ring', label: 'Ring til dem' }, { id: 'aktion:faerdig:242', label: 'Færdig' }]);
  for (const p of r.punkter) for (const v of p.valg) assert.ok(!v.id.startsWith('aktion:send'), v.id);
});

test('stemmeMail résumé: none, one, many, and no state at all', () => {
  assert.equal(stemmeMail(null).resume, 'Ingen mails venter.');
  assert.equal(stemmeMail(state([klar])).resume, 'Ingen mails venter.');
  assert.equal(stemmeMail(state([brev])).resume, 'Én mail venter på din beslutning.');
  assert.equal(stemmeMail(state([svar, brev])).resume, '2 mails venter på din beslutning.');
  assert.deepEqual(stemmeMail(null).punkter, []);
});

test('renderMail puts the spoken text in data-sig on undecided mails only, escaped', () => {
  const out = String(renderMail(state([svar, klar]), [], new Date('2026-10-27T09:00:00Z')));
  assert.equal(out.match(/data-sig="/g)?.length, 1);
  assert.match(out, /data-element="Mailen: Tilbud på &lt;b&gt;eltavle&lt;\/b&gt;" data-datazone="privat" data-sig="Mail fra Elektrikeren ApS: Tilbud på &lt;b&gt;eltavle&lt;\/b&gt;\./);
  assert.doesNotMatch(out, /data-sig="[^"]*<b>/);
});

// KC-0223: a read-only connection is spoken as read-only: no draft is promised and no Færdig can be said.
test('the spoken view of a read-only mail room offers no choices and promises no draft', async () => {
  const { stemmeMail, sigBeslutning } = await import('../../src/rooms/mail/stemme.ts');
  const b = { mailId: '5', emne: 'Tilmelding', fra: 'Skolen', modtaget: '2026-11-01T06:00:00Z', type: 'svar' as const, resume: '', betydning: 'Skolen vil have svar.', arkivmappe: 'Archive', muligheder: [], zone: 'privat' as const };
  const rum = stemmeMail({ dato: '2026-11-01', genereret: '2026-11-01T08:00:00Z', tal: { handling: 1, afventer: 0, regninger: 0, sorteretIDag: 0 }, beslutninger: [b], ordnet: [], hermesStatus: 'x', forbindelse: 'Gmail', laeseKun: true });
  assert.deepEqual(rum.punkter[0]?.valg, []);
  assert.doesNotMatch(rum.punkter[0]?.sig ?? '', /udkast/);
  assert.match(sigBeslutning(b), /udkast/, 'an acting connection still promises the draft');
});
