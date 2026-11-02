import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDagen, renderDagenEmpty } from '../../src/rooms/dagen/render.ts';
import { dagenGammel, ventendeDagen, venterDagen, type DagenState } from '../../src/rooms/dagen/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { dubletter, ider } from '../ider.ts';
import { baandDel, taelleTekst } from '../baand.ts';

const state: DagenState = {
  dato: '2026-10-26', genereret: '2026-10-26T06:00:00.000Z', vejr: '7 °C, regn fra 11',
  treLinjer: ['Vigtigste møde kl. 10.', 'Kl. 13 er ledig.', 'Toget går 16.42.'],
  anbefaling: { tekst: 'Brug kl. 13 på <udkastet>.', handling: { id: 'blok-13', label: 'Blokér kl. 13', instruktion: 'i', fortryd: 'f' } },
  kalender: [
    { tid: '10.00', slut: '11.00', titel: 'Driften: vinterberedskab', note: 'Materialet er klar.', status: 'klar', handling: { id: 'kal-1-forbered', label: 'Forbered', instruktion: 'i' } },
    { tid: '14.30', titel: 'Internt: leverandørvalg', status: 'flyttet' },
  ],
  morgenavis: [{ titel: 'Eksempel Energi strammer reserver', hvorfor: 'Relevant for mødet.', kilde: 'Eksempel Energi', url: 'https://example.org/a' }],
  hermesStatus: 'Holder øje med kalenderen',
};
const log: LogEntry[] = [
  { id: 'l1', tid: '2026-10-26T06:00:00.000Z', kilde: 'hermes', tekst: 'Byggede Dagen.', fortryd: 'x' },
  { id: 'l2', tid: '2026-10-26T05:00:00.000Z', kilde: 'hermes', tekst: 'Flyttede mødet.', fortrudt: '2026-10-26T05:30:00.000Z' },
];

test('renderDagen shows the three lines, the recommendation and its handling button with the stored id', () => {
  const out = String(renderDagen(state, log, new Date('2026-10-26T07:00:00Z')));
  assert.match(out, /Vigtigste møde kl\. 10\./);
  assert.match(out, /Brug kl\. 13 på &lt;udkastet&gt;\./);
  assert.match(out, /data-handling="blok-13"/);
  assert.match(out, /Blokér kl\. 13/);
});

test('renderDagen lists calendar rows with time, status and per-row handling', () => {
  const out = String(renderDagen(state, log, new Date()));
  assert.match(out, /10\.00/);
  assert.match(out, /data-handling="kal-1-forbered"/);
  assert.match(out, /flyttet/);
});

test('renderDagen renders news items as external links and marks elements for the context chip', () => {
  const out = String(renderDagen(state, log, new Date()));
  assert.match(out, /href="https:\/\/example\.org\/a"[^>]*rel="noopener"/);
  assert.match(out, /data-element="Mødet kl\. 10\.00: Driften: vinterberedskab"/);
});

test('renderDagen shows the log newest first with Fortryd only where allowed and not yet undone', () => {
  const out = String(renderDagen(state, log, new Date('2026-10-26T07:00:00Z')));
  assert.match(out, /data-fortryd="l1"/);
  assert.doesNotMatch(out, /data-fortryd="l2"/);
  assert.match(out, /Fortrudt/);
});

test('renderDagen hides Fortryd after 24 hours', () => {
  const out = String(renderDagen(state, log, new Date('2026-10-28T07:00:00Z')));
  assert.doesNotMatch(out, /data-fortryd="l1"/);
});

test('renderDagenEmpty offers the button that asks Hermes to fetch the day', () => {
  const out = String(renderDagenEmpty('Ingen data for i dag endnu.'));
  assert.match(out, /data-opdater="hent"/);
  assert.match(out, /Ingen data for i dag endnu\./);
});

test('renderDagen shows the result of a done handling inside its element and hides the button', () => {
  const done: LogEntry[] = [{ id: 'l9', tid: '2026-10-26T07:30:00.000Z', kilde: 'hermes', tekst: 'Blokken er oprettet 13-14.', handlingId: 'blok-13', fortryd: 'f' }];
  const out = String(renderDagen(state, done, new Date('2026-10-26T08:00:00Z')));
  assert.match(out, /class="resultat"[^>]*>[\s\S]*Blokken er oprettet 13-14\./);
  assert.doesNotMatch(out, /data-handling="blok-13"/);
});

test('KC-0024: on the phone Dagen keeps the three lines, the recommendation and the calendar; the paper and the log fold', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const out = String(renderDagen(state, log, new Date('2026-10-26T07:00:00Z')));
  assert.ok(foldet(out).has('Morgenavisen'));
  assert.ok(foldet(out).has('ordnet (2)'));
  for (const kerne of ['Dagen i tre linjer', 'Anbefaling', '>Kalender<']) assert.ok(out.includes(kerne) && !iFold(out, kerne), kerne);
});

const visuelState: DagenState = {
  ...state,
  visuel: { ikon: 'sun', billede: { art: 'dagslinje', fra: 7, til: 19, zoner: [{ fra: '11:00', til: '14:00', slags: 'regn' }], punkter: [{ tid: '10:00', ikon: 'calendar', tekst: 'Driften' }] } },
  anbefaling: { ...state.anbefaling, ikon: 'clock' },
  kalender: [{ ...state.kalender[0]!, ikon: 'users' }, state.kalender[1]!],
};

test('KC-0059: the picture of the day comes first, before the anbefaling', () => {
  const out = String(renderDagen(visuelState, log, new Date('2026-10-26T07:00:00Z')));
  const billede = out.indexOf('class="dagslinje"');
  assert.ok(billede > 0);
  assert.ok(billede < out.indexOf('Brug kl. 13 på'));
  assert.ok(billede < out.indexOf('Dagen i tre linjer'));
});

test('KC-0059: the anbefaling is a pictogram + headline with the label, and keeps its element and button', () => {
  const out = String(renderDagen(visuelState, log, new Date('2026-10-26T07:00:00Z')));
  assert.match(out, /class="vis-hoved"[\s\S]*?class="vis-etiket">Anbefaling<[\s\S]*?<h3 class="vis-overskrift">Brug kl\. 13 på &lt;udkastet&gt;\.<\/h3>/);
  assert.match(out, /data-element="Anbefalingen: Brug kl\. 13 på &lt;udkastet&gt;\."[^>]*data-sig=/);
  assert.match(out, /data-handling="blok-13"/);
});

test('KC-0059: the anbefaling pictogram falls back to a lightbulb', async () => {
  const { ikon } = await import('../../src/shell/visuel.ts');
  // The fixture's own day (KC-0095: on a later day the anbefaling is yesterday's and calm).
  const medIkon = String(renderDagen(visuelState, log, NU));
  const uden = String(renderDagen(state, log, NU));
  const kolbe = String(ikon('lightbulb'));
  const ur = String(ikon('clock'));
  assert.ok(medIkon.includes(`<span class="vis-ikon tilstand-kraever" data-tone="adv">${ur}`));
  assert.ok(uden.includes(`<span class="vis-ikon tilstand-kraever" data-tone="adv">${kolbe}`));
});

test('KC-0059: the three lines sit behind a mere() tap, not in the open', async () => {
  const out = String(renderDagen(state, log, new Date()));
  const m = /<details class="vis-mere"><summary>[\s\S]*?<span>Dagen i tre linjer<\/span><\/summary>([\s\S]*?)<\/details>/.exec(out);
  assert.ok(m);
  for (const l of state.treLinjer) assert.ok(m[1]!.includes(l), l);
  assert.equal(out.split('Vigtigste møde kl. 10.').length, 2);
});

test('KC-0059: a calendar row shows its pictogram before the time, with a calendar as fallback', async () => {
  const { ikon } = await import('../../src/shell/visuel.ts');
  const out = String(renderDagen(visuelState, log, new Date()));
  const raekker = out.split(/<div data-id="aftale:[^"]*" class="row" data-element="Mødet kl\./).slice(1);
  assert.equal(raekker.length, 2);
  assert.ok(raekker[0]!.includes(`<span class="kal-ikon">${ikon('users')}</span>`));
  assert.ok(raekker[1]!.includes(`<span class="kal-ikon">${ikon('calendar')}</span>`));
  for (const r of raekker) assert.ok(r.indexOf('kal-ikon') < r.indexOf('class="mono time"'));
});

test('KC-0059: the weather in the header gets a pictogram from its text', async () => {
  const { ikon } = await import('../../src/shell/visuel.ts');
  const hoved = (vejr: string | undefined): string => {
    const { vejr: _bort, ...uden } = state;
    return String(renderDagen(vejr === undefined ? uden : { ...uden, vejr }, log, new Date())).split('</header>')[0]!;
  };
  assert.ok(hoved('7 °C, regn fra 11').includes(`<span class="vejr-ikon">${ikon('cloud-rain')}</span>`));
  assert.ok(hoved('Byger sidst på dagen').includes(ikon('cloud-rain').toString()));
  assert.ok(hoved('Sol og 12 °C').includes(`<span class="vejr-ikon">${ikon('sun')}</span>`));
  assert.ok(hoved('Skyet, 9 °C').includes(`<span class="vejr-ikon">${ikon('cloud-sun')}</span>`));
  assert.doesNotMatch(hoved(undefined), /vejr-ikon/);
});

test('KC-0059: a short anbefaling headline leads; the full sentence moves behind Hvorfor', async () => {
  const { parseDagenState } = await import('../../src/rooms/dagen/schema.ts');
  const st = parseDagenState({ dato: '2026-10-29', treLinjer: ['a', 'b', 'c'], anbefaling: { tekst: 'Læs Claras dagsorden i toget kl. 07.42, så du er klar.', overskrift: 'Læs dagsordenen i toget' }, kalender: [], morgenavis: [] }, new Date('2026-10-29T06:00:00Z'));
  assert.equal(st.anbefaling.overskrift, 'Læs dagsordenen i toget');
  const out = String(renderDagen(st, [], new Date('2026-10-29T06:00:00Z')));
  assert.match(out, /<h3 class="vis-overskrift">Læs dagsordenen i toget<\/h3>/);
  assert.match(out, /<details class="vis-mere">(?:(?!<\/details>)[\s\S])*Læs Claras dagsorden i toget kl\. 07\.42/);
  assert.match(out, /data-element="Anbefalingen: Læs Claras dagsorden i toget kl\. 07\.42, så du er klar\."/);
});

// ---- KC-0064: one look per meaning ----
test('KC-0064: status klar and flyttet render the ordnet chip, others rolig', () => {
  const st: DagenState = { ...state, kalender: [{ tid: '10.00', titel: 'A', status: 'klar' }, { tid: '11.00', titel: 'B', status: 'flyttet' }, { tid: '12.00', titel: 'C', status: 'aflyst' }] };
  const out = String(renderDagen(st, [], new Date('2026-10-26T07:00:00Z')));
  assert.match(out, /class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>klar</);
  assert.match(out, /class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>flyttet</);
  assert.match(out, /class="chip tilstand-rolig">aflyst</);
  assert.doesNotMatch(out, /chip-(done|muted)/);
});

test('KC-0064: no element renders class="ask"; the ask control is the spoerg look with the same data-ask', () => {
  const out = String(renderDagen(state, [], new Date('2026-10-26T07:00:00Z')));
  assert.doesNotMatch(out, /class="ask"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="Dagen i tre linjer"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="Nyheden: Eksempel Energi strammer reserver"/);
});

test('KC-0064: the recommendation carries the one primary; calendar handlings are plain', () => {
  const out = String(renderDagen(state, [], new Date('2026-10-26T07:00:00Z')));
  assert.equal((out.match(/btn-primary/g) ?? []).length, 1);
  assert.match(out, /class="btn btn-primary" data-handling="blok-13"/);
  assert.match(out, /class="btn" data-handling="kal-1-forbered"/);
});

// ---- KC-0064 phase 2: bands, the overblik as the large element ----
const NU = new Date('2026-10-26T07:00:00Z');

test('KC-0064: an open anbefaling is Kræver dig and the one large element', () => {
  const out = String(renderDagen(state, [], NU));
  assert.match(baandDel(out, 'kraever'), /dagen-overblik kort-stor/);
  assert.equal(out.match(/kort-stor/g)?.length, 1);
  // KC-0093: the calendar's open handling (kal-1-forbered) waits too — the same number as the nav.
  assert.ok(taelleTekst(out).startsWith('2 venter på dig'));
  assert.match(baandDel(out, 'indhold'), /Kalender/);
  assert.doesNotMatch(baandDel(out, 'indhold'), /dagen-overblik/);
});

test('KC-0064: a done anbefaling is calm', () => {
  const gjort: LogEntry[] = [{ id: 'l9', tid: '2026-10-26T06:30:00Z', kilde: 'hermes', tekst: 'Blokerede kl. 13.', handlingId: 'blok-13' }];
  const out = String(renderDagen(state, gjort, NU));
  assert.doesNotMatch(out, /kort-stor/);
  assert.doesNotMatch(out, /data-baand="kraever"/);
  assert.match(baandDel(out, 'indhold'), /dagen-overblik[\s\S]*vis-ikon tilstand-rolig/);
  assert.equal(taelleTekst(out), '1 venter på dig · 1 ordnet', 'the calendar\'s handling still waits (KC-0093)');
});

test('KC-0064: Dagen shows its running rebuild', () => {
  const out = String(renderDagen(state, [], NU, [{ id: 'kc_9', label: 'Dagen: bygger rummet', status: 'running' }]));
  assert.match(baandDel(out, 'igang'), /data-run="kc_9"/);
  assert.match(baandDel(out, 'igang'), /Dagen: bygger rummet/);
});

test('KC-0064: an anbefaling without a handling is never Kræver dig', () => {
  const uden: DagenState = { ...state, anbefaling: { tekst: 'Bare en tanke.' } };
  const out = String(renderDagen(uden, [], NU));
  assert.doesNotMatch(out, /kort-stor|data-baand="kraever"/);
  assert.match(baandDel(out, 'indhold'), /dagen-overblik/);
});

test('KC-0064 phase 3: the Dagen anbefaling and the log rows carry their stable id', () => {
  const out = String(renderDagen(state, log, new Date('2026-10-26T07:00:00Z')));
  for (const id of ['dagen:anbefaling', 'log:l1', 'log:l2']) assert.ok(out.includes(`data-id="${id}"`), id);
});

test('KC-0064 phase 3: Dagen content items carry ids, unique per room', () => {
  const rig: DagenState = { ...state, kalender: [...state.kalender, state.kalender[0]!], morgenavis: [...state.morgenavis, state.morgenavis[0]!, { titel: 'Uden url', hvorfor: 'x' }], ugen: [{ dato: '2026-10-27', note: 'x', aftaler: [{ tid: '09.00', titel: 'Tandlæge' }] }, { dato: '2026-10-28', note: 'y', aftaler: [] }] };
  const ud = String(renderDagen(rig, log, new Date('2026-10-26T07:00:00Z')));
  const alle = ider(ud);
  for (const id of ['aftale:10.00|Driften: vinterberedskab', 'aftale:14.30|Internt: leverandørvalg', 'avis:https://example.org/a', 'avis:Uden url', 'uge:2026-10-27', 'uge:2026-10-28', 'dagen:anbefaling']) assert.ok(alle.includes(id), id);
  assert.deepEqual(dubletter(ud), []);
  // The overblik keeps its id when it is not the large element (anbefaling without a handling) and so sits in the room content.
  const rolig = String(renderDagen({ ...state, anbefaling: { tekst: 'Ro på.' } }, [], new Date('2026-10-26T07:00:00Z')));
  assert.deepEqual(ider(rolig).filter((i) => i === 'dagen:anbefaling'), ['dagen:anbefaling']);
});

test('KC-0102: Morgenavisen shows Del next to Spørg only for an item with a url', () => {
  const nu = new Date('2026-10-26T07:00:00Z');
  const rig: DagenState = { ...state, morgenavis: [...state.morgenavis, { titel: 'Uden url', hvorfor: 'x' }] };
  const out = String(renderDagen(rig, log, nu));
  assert.match(out, /data-del-titel="Eksempel Energi strammer reserver" data-del-url="https:\/\/example\.org\/a"/);
  assert.equal((out.match(/data-del-url=/g) ?? []).length, 1);
  const farlig = String(renderDagen({ ...state, morgenavis: [{ titel: 'A "B" <i>', hvorfor: 'x', url: 'https://example.org/?a=1&b="2"' }] }, log, nu));
  assert.match(farlig, /data-del-titel="A &quot;B&quot; &lt;i&gt;"/);
  assert.match(farlig, /data-del-url="https:\/\/example\.org\/\?a=1&amp;b=&quot;2&quot;"/);
});

test('KC-0066: a handling marked tilAndre renders as the red graense button, in the anbefaling and in the kalender, never primary', () => {
  const s: DagenState = {
    ...state,
    anbefaling: { tekst: 'Send dagsordenen.', handling: { id: 'anb-dags', label: 'Send dagsorden', instruktion: 'i', tilAndre: true } },
    kalender: [{ tid: '14.30', titel: 'Leverandørvalg', handling: { id: 'kal-dags', label: 'Send dagsorden', instruktion: 'i', tilAndre: true } }, state.kalender[0]!],
  };
  const out = String(renderDagen(s, [], new Date('2026-10-26T07:00:00Z')));
  assert.match(out, /<button type="button" class="btn btn-graense" data-handling="anb-dags" data-kraever-ja data-graense="kraever-ja">Send dagsorden<\/button>/);
  assert.match(out, /<button type="button" class="btn btn-graense" data-handling="kal-dags" data-kraever-ja data-graense="kraever-ja">Send dagsorden<\/button>/);
  assert.match(out, /<button type="button" class="btn" data-handling="kal-1-forbered">Forbered<\/button>/, 'an ordinary handling stays ordinary');
  assert.doesNotMatch(out, /btn-primary[^>]*data-handling="(anb|kal)-dags"/);
});

test('KC-0078: Dagen header shows when Hermes built the room, warning tone when older than today', () => {
  const idag = String(renderDagen(state, [], new Date('2026-10-26T07:00:00Z'))); // built 07.00 CET same day
  assert.match(idag, /<p class="muted">[^<]*Mandag[^]*?<span class="friskhed">opdateret 07\.00<\/span><\/p>/i);
  const igaar = String(renderDagen(state, [], new Date('2026-10-27T07:00:00Z')));
  assert.match(igaar, /<span class="friskhed friskhed-gammel">fra i går 07\.00<\/span>/);
});

test('KC-0078: Dagen freshness is escaped and absent when the time is unusable', () => {
  const ude = String(renderDagen({ ...state, genereret: '<script>x</script>' }, [], new Date('2026-10-26T07:00:00Z')));
  assert.doesNotMatch(ude, /<script>x/);
  assert.doesNotMatch(ude, /friskhed/);
});

test('KC-0084: the day line in Dagen marks now from the render clock, and only when the room is for that day', () => {
  const med = (dato: string): DagenState => ({ ...visuelState, dato, visuel: { ikon: 'sun', billede: { art: 'dagslinje', fra: 7, til: 19, zoner: [], punkter: [] } } });
  const nu = new Date('2026-10-26T12:00:00Z'); // 13:00 in Copenhagen: (13 - 7) / 12 = 50 %
  assert.match(String(renderDagen(med('2026-10-26'), log, nu)), /class="dl-nu" style="left:50%"/);
  assert.doesNotMatch(String(renderDagen(med('2026-10-25'), log, nu)), /dl-nu/);
});

// ---- KC-0095: Dagen not built today ----
// The fixture was built 2026-10-26 07.00 Copenhagen; the next morning is 2026-10-27 (UTC+1 after the DST switch).
const NAESTE_MORGEN_0800 = new Date('2026-10-27T07:00:00Z');
const NAESTE_MORGEN_0700 = new Date('2026-10-27T06:00:00Z');

test('KC-0095: dagenGammel — today null, an earlier day "vent" before 07.30 and "byg" from 07.30', () => {
  assert.equal(dagenGammel(state, new Date('2026-10-26T15:00:00Z')), null);
  assert.equal(dagenGammel(state, NAESTE_MORGEN_0700), 'vent');
  assert.equal(dagenGammel(state, new Date('2026-10-27T06:30:00Z')), 'byg');
  assert.equal(dagenGammel(state, NAESTE_MORGEN_0800), 'byg');
});

test('KC-0095: yesterday\'s Dagen waits with one thing only — build it — and yesterday\'s handlinger no longer count', () => {
  assert.deepEqual(ventendeDagen(state, [], NAESTE_MORGEN_0800), ['Dagen er ikke bygget i dag']);
  assert.equal(venterDagen(state, [], NAESTE_MORGEN_0800), 1);
  assert.deepEqual(ventendeDagen(state, [], NAESTE_MORGEN_0700), [], 'before 07.30 the morning build may still come');
  assert.equal(venterDagen(state, [], new Date('2026-10-26T15:00:00Z')), 2, 'today: the handlinger as before');
});

test('KC-0095: the room puts "Byg Dagen nu" under Kræver dig and yesterday\'s anbefaling is not the large element', () => {
  const out = String(renderDagen(state, [], NAESTE_MORGEN_0800));
  assert.match(baandDel(out, 'kraever'), /<button type="button" class="btn btn-primary" data-opdater="opdater">Byg Dagen nu<\/button>/);
  assert.doesNotMatch(baandDel(out, 'kraever'), /dagen-overblik/);
  assert.doesNotMatch(out, /kort-stor/);
  assert.ok(taelleTekst(out).startsWith('1 venter på dig'));
  assert.equal((out.match(/btn-primary/g) ?? []).length, 1, 'one primary on the page: build it');
});
