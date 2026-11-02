// KC-0170 slice 3: the closed beta's own words in English or Danish — the page "Hvad deler jeg?" (side.ts) and the answers
// to a feedback post (feedback.ts). Danish (no language chosen, or da chosen) is byte for byte what it was (the page against
// fixtures captured from side.ts before this slice; the answers against literals captured from feedback.ts); English has
// no Danish word left. The JSON the page shows is the contract and is shown as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BETA_SIDE_TEKSTER, renderDeling } from '../../src/beta/side.ts';
import { BETA_FEEDBACK_TEKSTER } from '../../src/beta/tekster.ts';
import { parseFeedbackSvar } from '../../src/beta/feedback.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { danskeLinjer, DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const fixtur = (navn: string): string => readFileSync(new URL(`../fixtures/sprog-beta/${navn}`, import.meta.url), 'utf8');
const data = (samtykke: boolean) => ({ samtykke, nu: `{\n  "samtykke": ${samtykke}\n}`, ...(samtykke ? {} : { hvis: '{\n  "tal": 1\n}' }) });

for (const [navn, tabeller] of [['side', BETA_SIDE_TEKSTER], ['feedback', BETA_FEEDBACK_TEKSTER]] as const) {
  test(`${navn}: English has exactly Danish's keys and shapes; no string is empty; none copied over`, () => {
    assert.deepEqual(form(tabeller.en), form(tabeller.da));
    assert.deepEqual(tomme(tabel(tabeller.da)), []);
    assert.deepEqual(tomme(tabel(tabeller.en)), []);
    assert.deepEqual(ensStrenge(tabel(tabeller.da), tabel(tabeller.en)), []);
  });
}

test('the page: Danish, with no language chosen and with da chosen, is byte for byte what it was', () => {
  for (const [samtykke, fil] of [[false, 'deling-fra-da.html'], [true, 'deling-til-da.html']] as const) {
    assert.equal(String(renderDeling(data(samtykke))), fixtur(fil), `${fil}, no language`);
    assert.equal(String(medSprog('da', () => renderDeling(data(samtykke)))), fixtur(fil), `${fil}, da`);
  }
});

test('the page: English has no Danish word left; the JSON is shown as it is; the names stay', () => {
  for (const samtykke of [false, true]) {
    const sider = String(medSprog('en', () => renderDeling(data(samtykke))));
    assert.deepEqual(danskeLinjer(sider), []);
    assert.match(sider, /What am I sharing\?/);
    assert.match(sider, /Clawco/);
    assert.match(sider, /Henrik/);
    assert.ok(sider.includes(`&quot;samtykke&quot;: ${samtykke}`), 'the JSON of the pull route, unchanged');
    assert.equal(sider.includes('&quot;tal&quot;: 1'), !samtykke, 'the "if you switch on" JSON only with consent off');
    assert.match(sider, /data-beta-samtykke="(ja|nej)"/, 'the switch keeps its hooks');
  }
});

/** One body per refusal: [name, raw body, due day, status]. */
const SAGER: [keyof typeof BETA_FEEDBACK_TEKSTER.da, unknown, 3 | 7 | 14 | null, number][] = [
  ['ugyldigForespoergsel', 'ikke et objekt', 3, 400],
  ['ukendtSpoergsmaal', { dag: 5, vurdering: 3 }, 3, 400],
  ['venterIkke', { dag: 7, vurdering: 3 }, 3, 409],
  ['vaelgVurdering', { dag: 3, vurdering: 9 }, 3, 400],
  ['tekstForLang', { dag: 3, vurdering: 3, tekst: 'x'.repeat(501) }, 3, 400],
  ['ugyldigtBetale', { dag: 3, vurdering: 3, betale: 'ja' }, 3, 400],
];
const DA: Record<string, string> = {
  ugyldigForespoergsel: 'Ugyldig forespørgsel.',
  ukendtSpoergsmaal: 'Ukendt spørgsmål.',
  venterIkke: 'Det spørgsmål venter ikke på dig lige nu.',
  vaelgVurdering: 'Vælg en vurdering fra 1 til 5.',
  tekstForLang: 'Teksten må højst være 500 tegn.',
  ugyldigtBetale: 'Ugyldigt svar på spørgsmålet om at betale.',
};

test('feedback answers: Danish byte for byte as before (no language and da); English reads as English; the status is the same', () => {
  for (const [navn, raa, due, status] of SAGER) {
    const svar = (): { status: number; fejl: string } => {
      const u = parseFeedbackSvar(raa, { due });
      assert.equal(u.ok, false, navn);
      if (u.ok) throw new Error('unreachable');
      return u;
    };
    assert.equal(svar().status, status, navn);
    assert.equal(svar().fejl, DA[navn]);
    assert.equal(medSprog('da', svar).fejl, DA[navn]);
    const en = medSprog('en', svar);
    assert.equal(en.status, status);
    assert.ok(!DANSK.test(en.fejl), `${navn}: ${en.fejl}`);
    assert.notEqual(en.fejl, DA[navn]);
  }
  assert.equal(medSprog('en', () => (parseFeedbackSvar({ dag: 3, vurdering: 3, tekst: 'x'.repeat(501) }, { due: 3 }) as { fejl: string }).fejl), 'The text can be at most 500 characters.');
});

test('a good answer is the same in both languages (the person\'s own words are never translated)', () => {
  const raa = { dag: 14, vurdering: 4, tekst: 'Det virkede\nfint', betale: 'maaske' };
  const da = parseFeedbackSvar(raa, { due: 14 });
  assert.deepEqual(medSprog('en', () => parseFeedbackSvar(raa, { due: 14 })), da);
  assert.deepEqual(da, { ok: true, svar: { dag: 14, vurdering: 4, tekst: 'Det virkede fint', betale: 'maaske' } });
});
