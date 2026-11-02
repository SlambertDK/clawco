// KC-0149: the forespørgsel block as HTML — lead (who asks whom, what), a state
// chip whose tone follows the state, one recommendation line, buttons. The one
// blue button only for whoever decides now; anything that goes to another
// person is red (KC-0067); every name and title escaped (§4 r9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forespBlok, forespLog, forespSektion } from '../../src/hushold/foresp-render.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { anvend, nyForespoergsel, tik, type Forespoergsel, type Haendelse } from '../../src/hushold/foresp.ts';
import type { Medlem } from '../../src/hushold/schema.ts';

const NU = new Date('2026-11-02T08:00:00.000Z');
const MEDLEMMER: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer' },
  { id: 'maja', navn: 'Maja', rolle: 'medlem' },
  { id: 'ella', navn: 'Ella', rolle: 'barn' },
  { id: 'farmor', navn: 'Farmor', rolle: 'gaest' },
];
const TID = { start: '2026-11-05T15:00:00.000Z', slut: '2026-11-05T16:00:00.000Z' };
const ny = (): Forespoergsel => nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Kan du tage Nora torsdag?', tid: TID }, NU);
function efter(f: Forespoergsel, h: Haendelse, timer = 1): Forespoergsel {
  const r = anvend(f, h, new Date(NU.getTime() + timer * 3600_000));
  assert.ok(r.ok, h.slags);
  return r.f;
}
const blok = (f: Forespoergsel, person: string): string => String(forespBlok({ f, person, medlemmer: MEDLEMMER, now: NU }));
const antal = (h: string, re: RegExp): number => (h.match(re) ?? []).length;
const PRIMAER = /class="btn btn-primary"/g;
const ROED = /class="btn btn-graense"/g;

test('the block: data-blok, the state, the lead names who asks whom, one recommendation line', () => {
  const f = ny();
  const hos = blok(f, 'maja');
  assert.match(hos, /data-blok="forespoergsel"/);
  assert.match(hos, /data-foresp="f1"/);
  assert.match(hos, /data-foresp-tilstand="spurgt"/);
  assert.match(hos, /Henrik spørger dig/);
  assert.match(hos, /Kan du tage Nora torsdag\?/);
  assert.match(hos, /kl\. 16\.00–17\.00/);
  assert.equal(antal(hos, /data-foresp-anbefaling/g), 1);
  assert.match(blok(f, 'henrik'), /Du spurgte Maja/);
  assert.match(blok(f, 'henrik'), /Maja har ikke svaret endnu/);
});

test('spurgt: the recipient gets Ja (the one blue), Nej and another time; the asker no blue, only Træk tilbage', () => {
  const f = { ...ny(), forslag: { anbefaling: 'Du er fri torsdag.', alternativer: [{ kl: '16:30', tekst: 'Kan 16.30' }] } };
  const hos = blok(f, 'maja');
  assert.equal(antal(hos, PRIMAER), 1);
  assert.match(hos, /class="btn btn-primary" data-aktion="svar" data-arg="\{&quot;id&quot;:&quot;f1&quot;,&quot;svar&quot;:&quot;ja&quot;\}"[^>]*>Ja</);
  assert.match(hos, />Nej</);
  assert.match(hos, /data-arg="\{&quot;id&quot;:&quot;f1&quot;,&quot;svar&quot;:&quot;alternativ&quot;,&quot;kl&quot;:&quot;16:30&quot;\}"[^>]*>Kan 16\.30</);
  assert.match(hos, /Du er fri torsdag\./, 'Hermes\' recommendation is the line');
  assert.equal(antal(hos, ROED), 0, 'answering is not sending: no red');
  const fra = blok(f, 'henrik');
  assert.equal(antal(fra, PRIMAER), 0, 'never blue for the one who waits');
  assert.match(fra, /data-aktion="traek"/);
  assert.doesNotMatch(fra, /data-aktion="svar"/);
});

test('alternativ: the asker decides (Tag imod is the blue), the recipient waits with no buttons', () => {
  const f = efter(ny(), { slags: 'alternativ', af: 'maja', alternativ: { start: '2026-11-05T15:30:00.000Z', slut: '2026-11-05T16:30:00.000Z', tekst: 'Kan 16.30' } });
  const fra = blok(f, 'henrik');
  assert.match(fra, /data-foresp-tilstand="alternativ"/);
  assert.equal(antal(fra, PRIMAER), 1);
  assert.match(fra, /class="btn btn-primary"[^>]*&quot;svar&quot;:&quot;tag-imod&quot;[^>]*>Tag imod</);
  assert.match(fra, /Maja foreslår/);
  assert.match(fra, /kl\. 16\.30–17\.30/);
  const til = blok(f, 'maja');
  assert.equal(antal(til, PRIMAER), 0);
  assert.doesNotMatch(til, /data-aktion=/);
});

test('udloebet without answer: the asker gets Spørg igen (red, it goes to another person) and Drop; never blue', () => {
  const f = efter(ny(), { slags: 'udloeb' }, 49);
  const fra = blok(f, 'henrik');
  assert.match(fra, /Ingen svar fra Maja/);
  assert.equal(antal(fra, PRIMAER), 0);
  assert.equal(antal(fra, ROED), 1);
  assert.match(fra, /class="btn btn-graense" data-aktion="spoerg-igen"[^>]*data-kraever-ja/);
  assert.match(fra, /data-aktion="drop"/);
  assert.doesNotMatch(blok({ ...f, lukket: NU.toISOString() }, 'henrik'), /data-aktion=/, 'dropped: no card buttons');
  assert.doesNotMatch(blok(f, 'maja'), /data-aktion=/);
  const trukket = efter(ny(), { slags: 'traek', af: 'henrik' });
  assert.match(blok(trukket, 'maja'), /trak forespørgslen tilbage/);
  assert.doesNotMatch(blok(trukket, 'henrik'), /data-aktion=/);
});

test('accepteret: green chip, the agreed time, and "Læg i din kalender" until that party took it', () => {
  const f = efter(ny(), { slags: 'ja', af: 'maja' });
  for (const p of ['henrik', 'maja']) {
    const h = blok(f, p);
    assert.match(h, /chip tilstand-ordnet/);
    assert.match(h, /href="\/rum\/husstand\/dok\/aftale-f1\.ics"[^>]*>Læg i din kalender</);
    assert.equal(antal(h, PRIMAER), 0);
  }
  assert.doesNotMatch(blok({ ...f, iKalender: ['maja'] }, 'maja'), /Læg i din kalender/);
  assert.match(blok({ ...f, iKalender: ['maja'] }, 'henrik'), /Læg i din kalender/);
});

test('afvist: who said no, no buttons', () => {
  const f = efter(ny(), { slags: 'nej', af: 'maja' });
  assert.match(blok(f, 'henrik'), /Maja sagde nej/);
  assert.match(blok(f, 'maja'), /Du sagde nej/);
  assert.doesNotMatch(blok(f, 'henrik'), /data-aktion=/);
});

test('a reminder shows on the decider\'s block, marked', () => {
  const { tid: _utenTid, ...udenTid } = ny();
  const r = tik({ ...udenTid, udloeber: '2026-11-04T08:00:00.000Z' }, new Date('2026-11-03T09:00:00.000Z'));
  assert.equal(r.paamindelse, true);
  const h = blok(r.f, 'maja');
  assert.match(h, /data-foresp-paamindelse/);
  assert.match(h, /Påmindelse: Henrik venter på dit svar/);
  assert.doesNotMatch(blok(r.f, 'henrik'), /data-foresp-paamindelse/);
});

test('hostile text is escaped: title, alternative text, a name, Hermes\' recommendation', () => {
  const ond = '<img src=x onerror=alert(1)>';
  const f: Forespoergsel = { ...ny(), titel: ond, forslag: { anbefaling: ond, alternativer: [{ kl: '16:30', tekst: '<b>x</b>' }] } };
  const h = String(forespBlok({ f, person: 'maja', medlemmer: [{ id: 'henrik', navn: '<script>', rolle: 'ejer' }, MEDLEMMER[1]!], now: NU }));
  assert.doesNotMatch(h, /<img|<script>|<b>x/);
  assert.match(h, /&lt;img src=x/);
});

test('the section: only the viewer\'s own requests, the new-request form offers the others (a guest too, KC-0154; not oneself) with a red Spørg', () => {
  const egen = ny();
  const andres = nyForespoergsel({ id: 'f2', fra: 'maja', til: 'ella', titel: 'Hemmelig gave', tid: TID }, NU);
  const h = String(forespSektion({ forespoergsler: [egen, andres], person: 'henrik', medlemmer: MEDLEMMER, now: NU }));
  assert.match(h, /data-foresp="f1"/);
  assert.doesNotMatch(h, /data-foresp="f2"|Hemmelig gave/, 'a third person sees nothing');
  assert.match(h, /<form id="foresp-ny"/);
  assert.match(h, /<option value="maja">Maja<\/option>/);
  assert.match(h, /<option value="ella">Ella<\/option>/);
  assert.match(h, /<option value="farmor">Farmor<\/option>/, 'a guest can be asked: requests addressed to her are what she sees');
  assert.doesNotMatch(h, /<option value="henrik"/);
  assert.match(h, /class="btn btn-graense" data-aktion="opret" data-form="foresp-ny"[^>]*data-kraever-ja/);
  assert.equal(antal(h, PRIMAER), 0, 'the asker\'s view has no blue');
});

test('udloebet after its own time has passed: only Drop (asking again for a time gone makes no sense)', () => {
  const u = efter(ny(), { slags: 'udloeb' }, 80);
  const h = String(forespBlok({ f: u, person: 'henrik', medlemmer: MEDLEMMER, now: new Date('2026-11-06T08:00:00.000Z') }));
  assert.match(h, /data-aktion="drop"/);
  assert.doesNotMatch(h, /data-aktion="spoerg-igen"/);
});

test('the log: the viewer\'s own lines, Fortryd only while the step can still be undone, escaped', () => {
  const f = efter(ny(), { slags: 'ja', af: 'maja' });
  const linjer: LogEntry[] = [
    { id: 'l2', tid: '2026-11-02T09:00:00.000Z', kilde: 'henrik', tekst: 'Du sagde ja: <b>x</b>', zone: 'privat', ejer: 'maja', fortryd: 'foresp:f1:2' },
    { id: 'l1', tid: '2026-11-02T08:00:00.000Z', kilde: 'henrik', tekst: 'Henrik spurgte dig', zone: 'privat', ejer: 'maja' },
    { id: 'l0', tid: '2026-11-02T08:00:00.000Z', kilde: 'henrik', tekst: 'Du spurgte Maja', zone: 'privat', ejer: 'henrik', fortryd: 'foresp:f1:1' },
  ];
  const h = String(forespLog({ log: linjer, forespoergsler: [f], person: 'maja', now: new Date(NU.getTime() + 2 * 3600_000) }));
  assert.match(h, /data-fortryd="l2"/);
  assert.doesNotMatch(h, /data-log="l0"/, 'another person\'s line is not shown');
  assert.doesNotMatch(h, /<b>x/);
  const senere = String(forespLog({ log: linjer, forespoergsler: [{ ...f, historik: [...f.historik, { tid: NU.toISOString(), tilstand: 'spurgt' as const, af: 'maja' }] }], person: 'maja', now: NU }));
  assert.doesNotMatch(senere, /data-fortryd="l2"/, 'no longer the latest step: no Fortryd');
  assert.equal(String(forespLog({ log: [], forespoergsler: [], person: 'maja', now: NU })), '');
});
