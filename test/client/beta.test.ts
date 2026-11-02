// KC-0203: the feedback card shows, before anything is sent, exactly what will be sent. The preview line and the POST
// body are made from the same object (KCBeta.krop), and the server's validation keeps exactly that object — so what is
// read on screen is what Henrik receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../public/beta.js';
import { parseFeedbackSvar } from '../../src/beta/feedback.ts';

type V = { dag: number; vurdering: number | null; tekst: string; betale: string | null };
type Ord = { sendes: string; vurdering: string; betale: string; ja: string; maaske: string; nej: string; vaelg: string };
const KC = (globalThis as unknown as { KCBeta: { krop(v: V): { dag: number; vurdering: number; tekst: string | null; betale: string | null } | null; forhaandsvisning(v: V, o: Ord): string } }).KCBeta;
const ORD: Ord = { sendes: 'Sendes til Henrik', vurdering: 'vurdering', betale: 'betale', ja: 'ja', maaske: 'måske', nej: 'nej', vaelg: 'vælg en vurdering for at sende' };

test('no rating yet: nothing can be sent, and the line says so', () => {
  assert.equal(KC.krop({ dag: 3, vurdering: null, tekst: 'x', betale: null }), null);
  assert.equal(KC.forhaandsvisning({ dag: 3, vurdering: null, tekst: 'x', betale: null }, ORD), 'Sendes til Henrik: vælg en vurdering for at sende');
});

test('the preview names every value that will be sent, in the wording of the card', () => {
  assert.equal(KC.forhaandsvisning({ dag: 3, vurdering: 4, tekst: '', betale: null }, ORD), 'Sendes til Henrik: vurdering 4');
  assert.equal(KC.forhaandsvisning({ dag: 3, vurdering: 4, tekst: 'Mailen drillede', betale: null }, ORD), 'Sendes til Henrik: vurdering 4, «Mailen drillede»');
  assert.equal(KC.forhaandsvisning({ dag: 14, vurdering: 5, tekst: 'test', betale: 'maaske' }, ORD), 'Sendes til Henrik: vurdering 5, «test», betale: måske');
  assert.equal(KC.forhaandsvisning({ dag: 14, vurdering: 2, tekst: '', betale: 'nej' }, ORD), 'Sendes til Henrik: vurdering 2, betale: nej');
});

test('the preview and the body are made from the same cleaned object, and the server keeps exactly that object', () => {
  const tekster = ['', '  ', 'Mailen drillede', '  luft rundt om  ', 'to\nlinjer', 'a\u0000b', 'x'.repeat(500), '<b>fed</b>'];
  for (const dag of [3, 7, 14]) for (const vurdering of [1, 3, 5]) for (const tekst of tekster) for (const betale of dag === 14 ? [null, 'ja', 'maaske', 'nej'] : [null]) {
    const v = { dag, vurdering, tekst, betale };
    const krop = KC.krop(v)!;
    const fv = KC.forhaandsvisning(v, ORD);
    assert.ok(fv.includes(`vurdering ${krop.vurdering}`));
    assert.equal(fv.includes('«'), krop.tekst !== null, JSON.stringify(v));
    if (krop.tekst !== null) assert.ok(fv.includes(`«${krop.tekst}»`), JSON.stringify(v));
    assert.equal(fv.includes('betale: '), krop.betale !== null);
    const u = parseFeedbackSvar(krop, { due: dag as 3 | 7 | 14 });
    assert.equal(u.ok, true, JSON.stringify(v));
    assert.deepEqual((u as { svar: unknown }).svar, krop, `the server stores exactly what the card showed: ${JSON.stringify(v)}`);
  }
});

test('the text is cut at 500 characters by the card itself (the same limit the server holds)', () => {
  assert.equal(KC.krop({ dag: 3, vurdering: 3, tekst: 'y'.repeat(600), betale: null })!.tekst!.length, 500);
});
