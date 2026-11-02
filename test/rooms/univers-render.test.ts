import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOversigt, renderUnivers, renderMoedeVisning } from '../../src/rooms/univers/render.ts';
import { dubletter, ider } from '../ider.ts';
import { baandDel, taelleTekst } from '../baand.ts';
import { foldet } from '../foldet.ts';
import { tomtIndeks, tomtUnivers, type UniversIndeks, type UniversInfo, type UniversState, type Moede } from '../../src/rooms/univers/schema.ts';

const NOW = new Date('2026-10-27T10:00:00Z'); // 11.00 in Copenhagen
const info: UniversInfo = { id: 'arena', navn: 'Min <arena>', om: 'Lederrollen & mere', oprettet: '2026-10-01T08:00:00Z' };

const indeks: UniversIndeks = {
  univers: [info, { id: 'gammelt', navn: 'Gammelt', om: '', oprettet: 't', arkiveret: 't2' }, { id: 'hus', navn: 'Huset', om: 'Renovering', oprettet: 't' }],
  nyeMoeder: [{ eventId: 'ev<1>', titel: 'Kickoff <script>x</script>', start: '2026-10-28T08:30:00Z', slut: '2026-10-28T09:30:00Z', sted: 'Rum 4', deltagere: [{ navn: 'Jonas Holm' }, { navn: 'Anne' }] }],
  skjulteMoeder: [],
};

const praeget: Moede = {
  id: 'moede-1', kilde: 'kalender', eventId: 'e1', titel: 'Pitch <b>til</b> Tom', start: '2026-10-27T10:30:00Z', slut: '2026-10-27T11:30:00Z', sted: 'Teams',
  deltagere: [{ navn: 'Jonas Holm' }],
  forberedelse: {
    maal: 'Få rollen <afklaret>', talepunkter: ['Først <i>dette</i>', 'Så hint'], dokumentId: 'dok-1', tid: '2026-10-27T09:00:00Z',
    deltagere: [{ navn: 'Jonas Holm', hvem: 'Chef', baggrund: 'Kom fra Ørsted', vil: 'Tryghed' }],
  },
};
const ufoert: Moede = { id: 'moede-2', kilde: 'manuel', titel: 'Intern', start: '2026-10-29T10:00:00Z', slut: '2026-10-29T11:00:00Z', deltagere: [{ navn: 'Mette' }] };
const gammelt: Moede = { id: 'moede-0', kilde: 'manuel', titel: 'Overstået', start: '2026-10-26T10:00:00Z', slut: '2026-10-26T11:00:00Z', deltagere: [] };

const state: UniversState = {
  dokumenter: [
    { id: 'dok-1', titel: 'Pitch <script>alert(1)</script>', html: '<script>alert(1)</script><p>Slide</p>', tekst: 'Slide', versioner: [{ html: 'a', tekst: 'a', tid: 't' }], moedeId: 'moede-1', oprettet: '2026-10-27T08:00:00Z', aendret: '2026-10-27T09:00:00Z' },
    { id: 'dok-2', titel: 'Brief', html: '<p>x</p>', tekst: 'x', versioner: [], oprettet: '2026-10-26T08:00:00Z', aendret: '2026-10-26T09:00:00Z' },
  ],
  noter: [{ id: 'note-1', titel: 'Tanke <u>x</u>', tekst: 'Husk at spørge', oprettet: '2026-10-27T08:00:00Z' }],
  opgaver: [
    { id: 'opg-1', titel: 'Find <tal>', status: 'aaben', moedeId: 'moede-1', note: 'fra Q3' },
    { id: 'opg-2', titel: 'Ring', status: 'igang' },
    { id: 'opg-3', titel: 'Færdig ting', status: 'faerdig' },
  ],
  moeder: [gammelt, ufoert, praeget],
};

// ---------- Oversigt ----------

test('renderOversigt lists active universes as tiles with counts and links, never archived ones', () => {
  const out = String(renderOversigt(indeks, { arena: { moeder: 2, aabneOpgaver: 3, dokumenter: 1 } }, NOW));
  assert.match(out, /href="\/rum\/univers-arena"/);
  assert.match(out, /href="\/rum\/univers-hus"/);
  assert.ok(!out.includes('univers-gammelt'));
  assert.match(out, /2 møder · 3 åbne opgaver/);
  assert.match(out, /Min &lt;arena&gt;/);
  assert.ok(!out.includes('Min <arena>'));
});

test('KC-0148: renderOversigt links to Husstanden as the first tile when it is there, and not otherwise', () => {
  const med = String(renderOversigt(indeks, {}, NOW, [], { husstand: true }));
  assert.match(med, /<div class="tiles">\s*<a class="tile" href="\/rum\/husstand"[^>]*>\s*<span class="tile-name">Husstanden<\/span>/);
  assert.ok(!String(renderOversigt(indeks, {}, NOW)).includes('/rum/husstand'));
  const tomMed = String(renderOversigt(tomtIndeks(), {}, NOW, [], { husstand: true }));
  assert.match(tomMed, /href="\/rum\/husstand"/);
  assert.match(tomMed, /Ingen universer endnu/);
});

test('renderOversigt has a Nyt univers form with navn and om', () => {
  const out = String(renderOversigt(indeks, {}, NOW));
  assert.match(out, /<form id="nyt-univers"[^>]*>/);
  assert.match(out, /name="navn"/);
  assert.match(out, /name="om"/);
  assert.match(out, /data-aktion="nytUnivers"[^>]*data-form="nyt-univers"|data-form="nyt-univers"[^>]*data-aktion="nytUnivers"/);
});

test('renderOversigt shows new meetings with time, escaped title, participants, a select of active universes and both buttons', () => {
  const out = String(renderOversigt(indeks, {}, NOW));
  assert.match(out, /Nye møder/);
  assert.match(out, /Kickoff &lt;script&gt;x&lt;\/script&gt;/);
  assert.ok(!out.includes('<script>x'));
  assert.match(out, /Jonas Holm, Anne/);
  assert.match(out, /09\.30/);
  const select = /<select[^>]*>([\s\S]*?)<\/select>/.exec(out)?.[1] ?? '';
  assert.match(select, /value="arena"/);
  assert.match(select, /value="hus"/);
  assert.ok(!select.includes('gammelt'));
  assert.match(out, /data-aktion="placerMoede"[^>]*data-arg="[^"]*ev&lt;1&gt;/);
  assert.match(out, /data-aktion="skjulMoede"[^>]*data-arg="[^"]*ev&lt;1&gt;/);
  assert.match(out, /Læg i univers/);
  assert.match(out, /Ikke et møde for mig/);
});

test('renderOversigt empty states are in Danish', () => {
  const out = String(renderOversigt(tomtIndeks(), {}, NOW));
  assert.match(out, /Ingen universer endnu/);
  assert.equal(taelleTekst(out), 'Intet venter på dig');
  assert.doesNotMatch(out, /data-baand="kraever"/);
});

test('renderOversigt with new meetings but no universe asks to create one first (no empty select)', () => {
  const out = String(renderOversigt({ ...tomtIndeks(), nyeMoeder: indeks.nyeMoeder }, {}, NOW));
  assert.ok(!out.includes('<select'));
  assert.match(out, /Opret først et univers/);
});

// ---------- Univers ----------

test('renderUnivers shows name and purpose escaped, and Næste with the next meeting and open task count', () => {
  const out = String(renderUnivers(info, state, NOW));
  assert.match(out, /<h1>Min &lt;arena&gt;<\/h1>/);
  assert.match(out, /Lederrollen &amp; mere/);
  assert.match(out, /Næste/);
  assert.match(out, /Pitch &lt;b&gt;til&lt;\/b&gt; Tom/);
  assert.match(out, /2 åbne opgaver/);
});

test('renderUnivers lists upcoming meetings first, offers Forbered with the optional line, and links the meeting view when prepared', () => {
  const out = String(renderUnivers(info, state, NOW));
  // KC-0064: the unprepared meeting waits on Henrik (Kræver dig); the prepared one and the past one are the room's content.
  assert.match(baandDel(out, 'kraever'), /data-element="Møde: Intern"/);
  assert.ok(out.indexOf('Intern') < out.indexOf('Pitch &lt;b&gt;'));
  assert.ok(out.indexOf('Pitch &lt;b&gt;') < out.indexOf('Overstået'));
  assert.match(out, /Hvad vil du have ud af mødet\?/);
  assert.match(out, /data-aktion="forbered"[^>]*data-arg="[^"]*moede-2/);
  assert.match(out, /href="\/moede\/arena\/moede-1"/);
  assert.match(out, /Åbn mødevisningen/);
  assert.match(out, /Få rollen &lt;afklaret&gt;/);
  assert.match(out, /data-element="Møde: Intern"/);
});

test('renderUnivers task board has three columns with status buttons', () => {
  const out = String(renderUnivers(info, state, NOW));
  assert.match(out, /class="uv-tavle"/);
  for (const kol of ['Åben', 'I gang', 'Færdig']) assert.match(out, new RegExp(`uv-kolonne[^>]*>[\\s\\S]*?${kol}`));
  assert.equal((out.match(/class="[^"]*uv-kolonne[^"]*"/g) ?? []).length, 3);
  assert.match(out, /Find &lt;tal&gt;/);
  assert.match(out, /data-aktion="opgaveStatus"[^>]*data-arg="[^"]*opg-1[^"]*igang/);
  assert.match(out, /data-aktion="opgaveStatus"[^>]*data-arg="[^"]*opg-3[^"]*aaben/);
});

test('renderUnivers documents: escaped title, version count, sandboxed iframe without allow-scripts, Åbn link', () => {
  const out = String(renderUnivers(info, state, NOW));
  assert.match(out, /Pitch &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!out.includes('<script>alert(1)</script>'));
  const iframes = out.match(/<iframe[^>]*>/g) ?? [];
  assert.equal(iframes.length, 2);
  for (const f of iframes) {
    assert.match(f, /\ssandbox="allow-same-origin"[\s>]/);
    assert.ok(!/allow-(scripts|forms|popups|top-navigation|modals)/.test(f));
    assert.match(f, /loading="lazy"/);
  }
  assert.match(out, /src="\/rum\/univers-arena\/vis\/dok-1\.html"/);
  assert.match(out, /href="\/rum\/univers-arena\/vis\/dok-1\.html"/);
  assert.match(out, /2 versioner|version/);
  assert.ok(!out.includes('<p>Slide</p>'));
});

test('renderUnivers notes, and the Nyt møde form with the fields the action needs', () => {
  const out = String(renderUnivers(info, state, NOW));
  assert.match(out, /Tanke &lt;u&gt;x&lt;\/u&gt;/);
  assert.match(out, /<form id="nyt-moede"/);
  assert.match(out, /name="titel"/);
  assert.match(out, /name="start" type="datetime-local"/);
  assert.match(out, /name="varighed"/);
  assert.match(out, /name="deltagere"/);
  assert.match(out, /data-aktion="nytMoede"/);
});

test('renderUnivers of an empty universe says so in each section', () => {
  const out = String(renderUnivers(info, tomtUnivers(), NOW));
  assert.match(out, /Ingen møder endnu/);
  assert.match(out, /Ingen opgaver endnu/);
  assert.match(out, /Ingen dokumenter endnu/);
  assert.match(out, /Ingen noter endnu/);
  assert.match(out, /Ingen kommende møder/);
});

// ---------- Mødevisning ----------

test('renderMoedeVisning shows time left, goal, ordered talking points, participants and the meeting tasks', () => {
  const out = String(renderMoedeVisning(info, praeget, state, new Date('2026-10-27T10:35:00Z')));
  assert.match(out, /Pitch &lt;b&gt;til&lt;\/b&gt; Tom/);
  assert.match(out, /55 min tilbage/);
  assert.match(out, /Få rollen &lt;afklaret&gt;/);
  assert.match(out, /<ol[^>]*>[\s\S]*Først &lt;i&gt;dette&lt;\/i&gt;[\s\S]*Så hint[\s\S]*<\/ol>/);
  assert.match(out, /Jonas Holm/);
  assert.match(out, /Chef/);
  assert.match(out, /Kom fra Ørsted/);
  assert.match(out, /Find &lt;tal&gt;/);
  assert.ok(!out.includes('Ring'));
});

test('renderMoedeVisning says how long until it starts, before the start', () => {
  const out = String(renderMoedeVisning(info, praeget, state, new Date('2026-10-27T10:20:00Z')));
  assert.match(out, /om 10 min/);
});

test('renderMoedeVisning embeds the presentation in a large sandboxed iframe and links back to Dagen', () => {
  const out = String(renderMoedeVisning(info, praeget, state, NOW));
  const iframe = /<iframe[^>]*uv-praesentation[^>]*>|<iframe[^>]*>/.exec(out)?.[0] ?? '';
  assert.match(iframe, /uv-praesentation/);
  assert.match(iframe, /\ssandbox="allow-same-origin"[\s>]/);
  assert.ok(!/allow-(scripts|forms|popups|top-navigation|modals)/.test(iframe));
  assert.match(iframe, /src="\/rum\/univers-arena\/vis\/dok-1\.html"/);
  assert.match(out, /<a[^>]*href="\/rum\/dagen"[^>]*data-forlad-moede="moede-1"|<a[^>]*data-forlad-moede="moede-1"[^>]*href="\/rum\/dagen"/);
  assert.match(out, /Til Dagen/);
  assert.match(out, /data-element="Mødet: Pitch/);
});

test('renderMoedeVisning without preparation says so and offers Forbered; without a presentation shows no iframe', () => {
  const out = String(renderMoedeVisning(info, ufoert, state, NOW));
  assert.match(out, /Ikke forberedt endnu/);
  assert.match(out, /data-aktion="forbered"[^>]*data-arg="[^"]*moede-2/);
  assert.ok(!out.includes('<iframe'));
  assert.match(out, /Til Dagen/);
  const udenSlide = String(renderMoedeVisning(info, { ...praeget, forberedelse: { ...(praeget.forberedelse as NonNullable<Moede['forberedelse']>), dokumentId: 'findes-ikke' } }, state, NOW));
  assert.ok(!udenSlide.includes('<iframe'));
});

// ---------- KC-0059: visual meeting view and meeting card ----------

const medIkoner: Moede = {
  ...praeget,
  deltagere: [{ navn: 'Jonas Holm' }, { navn: 'Line Berg' }],
  forberedelse: {
    ...(praeget.forberedelse as NonNullable<Moede['forberedelse']>),
    talepunkter: ['Først', 'Så', 'Til sidst'],
    talepunktIkoner: ['users', undefined],
    deltagere: [
      { navn: 'Jonas Holm', hvem: 'Chef; leder af arenaen', baggrund: 'Kom fra Ørsted', vil: 'Tryghed' },
      { navn: 'Line Berg', hvem: '', baggrund: '', vil: '' },
    ],
  },
};
const stateIkoner: UniversState = { ...state, moeder: [medIkoner] };
const tpListe = (out: string, container: string): string[] => {
  const blok = new RegExp(`class="${container}[\\s\\S]*?<ol class="lines">([\\s\\S]*?)</ol>`).exec(out)?.[1] ?? '';
  return blok.match(/<li>[\s\S]*?<\/li>/g) ?? [];
};

test('renderMoedeVisning shows every participant as a face: avatar with initials, name, role small, in a .uv-deltager row', () => {
  const out = String(renderMoedeVisning(info, medIkoner, stateIkoner, NOW));
  const rows = out.match(/<div class="row uv-deltager">[\s\S]*?<\/div>(?=\s*(<div class="row uv-deltager">|<\/section>))/g) ?? [];
  assert.equal(rows.length, 2);
  assert.match(rows[0] ?? '', /<span class="avatar" style="--hue:\d+" aria-hidden="true">JH<\/span>/);
  assert.match(rows[1] ?? '', /<span class="avatar"[^>]*>LB<\/span>/);
  assert.match(rows[0] ?? '', /<span class="row-title">Jonas Holm<\/span>/);
  assert.match(rows[0] ?? '', /<span class="row-note">Chef; leder af arenaen<\/span>/);
});

test('renderMoedeVisning folds a participant\'s background and expectation behind mere()', () => {
  const out = String(renderMoedeVisning(info, medIkoner, stateIkoner, NOW));
  const tom = /<div class="row uv-deltager">[\s\S]*?Line Berg/.exec(out)?.[0] ?? '';
  assert.match(tom, /<details class="vis-mere">[\s\S]*Kom fra Ørsted[\s\S]*Vil sandsynligvis: Tryghed[\s\S]*<\/details>/);
  assert.ok(tom.indexOf('<details') < tom.indexOf('Kom fra Ørsted'));
  // Anne has nothing to unfold: no details in her row
  const anne = /Line Berg<\/span>[\s\S]*?<\/section>/.exec(out)?.[0] ?? '';
  assert.ok(!anne.includes('<details'));
});

test('renderMoedeVisning without preparation-participants shows the calendar participants as faces', () => {
  const m: Moede = { ...medIkoner, forberedelse: { ...(medIkoner.forberedelse as NonNullable<Moede['forberedelse']>), deltagere: [] } };
  const out = String(renderMoedeVisning(info, m, { ...stateIkoner, moeder: [m] }, NOW));
  assert.ok(!out.includes('uv-deltager'));
  assert.match(out, /class="personer"/);
  assert.match(out, /<span class="avatar"[^>]*>JH<\/span>/);
  assert.match(out, /Line Berg/);
});

test('renderMoedeVisning shows the goal as a headline with the target pictogram and the label Mål', () => {
  const out = String(renderMoedeVisning(info, medIkoner, stateIkoner, NOW));
  const hoved = /<div class="vis-hoved">[\s\S]*?<\/h3><\/div><\/div>/.exec(out)?.[0] ?? '';
  assert.match(hoved, /<svg class="ikon"/);
  assert.match(hoved, /<circle cx="12" cy="12" r="2"/); // the target pictogram
  assert.match(hoved, /<span class="vis-etiket">Mål<\/span>/);
  assert.match(hoved, /<h3 class="vis-overskrift">Få rollen &lt;afklaret&gt;<\/h3>/);
});

test('renderMoedeVisning gives each talepunkt its pictogram and falls back to chevron-right', () => {
  const out = String(renderMoedeVisning(info, medIkoner, stateIkoner, NOW));
  const li = tpListe(out, 'uv-moedevisning');
  assert.equal(li.length, 3);
  assert.match(li[0] ?? '', /^<li><span class="vis-ikon tilstand-rolig tp-ikon"><svg class="ikon"[\s\S]*<path d="M16 21v-2a4 4 0 0 0-4-4H6/); // users
  for (const i of [1, 2]) assert.match(li[i] ?? '', /<path d="m9 18 6-6-6-6" \/>/); // chevron-right, for an empty slot and a missing one
  assert.match(li[0] ?? '', /Først/);
  assert.equal(li[0]?.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim(), 'Først');
});

test('renderMoedeVisning without talepunktIkoner uses the fallback pictogram for every talepunkt (old stored preparations)', () => {
  const out = String(renderMoedeVisning(info, praeget, state, NOW));
  const li = tpListe(out, 'uv-moedevisning');
  assert.equal(li.length, 2);
  for (const l of li) assert.match(l, /<path d="m9 18 6-6-6-6" \/>/);
});

test('renderMoedeVisning keeps the hooks the demo\'s Find mere script uses', () => {
  const out = String(renderMoedeVisning(info, medIkoner, stateIkoner, NOW));
  assert.equal((out.match(/class="row uv-deltager"/g) ?? []).length, 2);
  assert.match(out, /<div class="row uv-deltager"><span class="avatar"[^>]*>JH<\/span><span class="row-main"><span class="row-title">Jonas Holm<\/span>/);
  assert.match(out, /<div class="uv-moedevisning">[\s\S]*<ol class="lines"><li>/);
  assert.match(out, /data-forlad-moede="moede-1"/);
  assert.match(out, /data-element="Talepunkter"/);
  assert.match(out, /data-element="Deltagerne"/);
});

test('renderUnivers meeting card shows participants as faces, the goal headline and talepunkter with pictograms', () => {
  const out = String(renderUnivers(info, { ...stateIkoner, moeder: [medIkoner] }, NOW));
  const kort = /<article(?: data-id="[^"]*")? class="card uv-moede-kort"[\s\S]*?<\/article>/.exec(out)?.[0] ?? '';
  assert.match(kort, /<span class="avatar"[^>]*>JH<\/span>/);
  assert.match(kort, /<span class="avatar"[^>]*>LB<\/span>/);
  assert.match(kort, /Chef/);
  assert.ok(!kort.includes('leder af arenaen')); // only the first clause of the role
  assert.match(kort, /<span class="vis-etiket">Mål<\/span>/);
  assert.match(kort, /<h3 class="vis-overskrift">Få rollen &lt;afklaret&gt;<\/h3>/);
  assert.match(kort, /<circle cx="12" cy="12" r="2"/);
  const li = tpListe(out, 'card uv-moede-kort');
  assert.equal(li.length, 3);
  assert.match(li[0] ?? '', /M16 21v-2a4 4 0 0 0-4-4H6/);
  assert.match(li[1] ?? '', /<path d="m9 18 6-6-6-6" \/>/);
  assert.match(kort, /href="\/moede\/arena\/moede-1"/);
  assert.match(kort, /data-element="Møde: Pitch &lt;b&gt;til&lt;\/b&gt; Tom"/);
});

test('renderUnivers meeting card without preparation shows the calendar participants as faces and still offers Forbered', () => {
  const out = String(renderUnivers(info, state, NOW));
  const kort = /<article data-id="moede:[^"]*" class="card uv-moede-kort" data-element="Møde: Intern">[\s\S]*?<\/article>/.exec(out)?.[0] ?? '';
  assert.match(kort, /<span class="avatar"[^>]*>M<\/span>/);
  assert.match(kort, /Mette/);
  assert.match(kort, /data-aktion="forbered"/);
});

test('renderUnivers meeting card keeps talepunkter as li inside ol.lines inside .uv-moede-kort (demo hook)', () => {
  const out = String(renderUnivers(info, { ...stateIkoner, moeder: [medIkoner] }, NOW));
  assert.match(out, /<article(?: data-id="[^"]*")? class="card uv-moede-kort"[\s\S]*<ol class="lines"><li>[\s\S]*<\/ol>[\s\S]*<\/article>/);
});

test('KC-0064: Forberedt is the ordnet chip, an upcoming Ikke forberedt is kraever, talepunkt tiles are rolig; a meeting card has one primary', () => {
  const out = String(renderUnivers(info, state, NOW));
  assert.match(out, /class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>Forberedt</);
  assert.match(out, /class="chip tilstand-kraever">Ikke forberedt</);
  assert.doesNotMatch(out, /chip-(done|pending)/);
  const kort = (titel: string): string => new RegExp(`<article(?: data-id="[^"]*")? class="card uv-moede-kort" data-element="Møde: ${titel}">[\\s\\S]*?</article>`).exec(out)![0];
  assert.equal((kort('Pitch &lt;b&gt;til&lt;/b&gt; Tom').match(/btn-primary/g) ?? []).length, 1, 'Åbn mødevisningen only; Forbered igen is not primary');
  assert.equal((kort('Intern').match(/btn-primary/g) ?? []).length, 1);
  const ud = String(renderUnivers(info, { ...stateIkoner, moeder: [medIkoner] }, NOW));
  assert.match(ud, /vis-ikon tilstand-rolig tp-ikon/);
});

// ---- KC-0064 phase 2: bands ----
test('KC-0064: a univers sorts into the bands', () => {
  const log = [{ id: 'l1', tid: '2026-10-27T09:00:00Z', kilde: 'hermes' as const, tekst: 'Lavede et slide.' }];
  const out = String(renderUnivers(info, state, NOW, { log, igang: [{ id: 'kc_1', label: 'Min arena: forbereder mødet', status: 'running' }] }));
  // KC-0093: the two open opgaver wait too, as the nav counts them.
  assert.equal(taelleTekst(out), '3 venter på dig · 1 i gang · 1 ordnet');
  assert.match(baandDel(out, 'kraever'), /Møde: Intern/);
  assert.match(baandDel(out, 'kraever'), /id="forbered-moede-2"/);
  assert.match(baandDel(out, 'indhold'), /Pitch &lt;b&gt;til/);
  assert.ok(foldet(String(baandDel(out, 'indhold'))).has('tidligere møder'));
  assert.doesNotMatch(out, /kort-stor/);
});

test('KC-0064: the overview\'s new meetings are Kræver dig', () => {
  const out = String(renderOversigt(indeks, {}, NOW));
  assert.equal(indeks.nyeMoeder.length, 1);
  const med: UniversIndeks = { ...indeks, nyeMoeder: [...indeks.nyeMoeder, { ...indeks.nyeMoeder[0]!, eventId: 'ev2', titel: 'Andet' }] };
  const to = String(renderOversigt(med, {}, NOW));
  assert.equal((baandDel(to, 'kraever').match(/uv-kandidat/g) ?? []).length, 2);
  assert.ok(taelleTekst(to).startsWith('2 venter på dig'));
  assert.doesNotMatch(to, /data-baand="ordnet"/);
  assert.match(out, /data-baand="kraever"/);
});

test('KC-0064: the meeting view has no bands', () => {
  const out = String(renderMoedeVisning(info, praeget, state, NOW));
  assert.doesNotMatch(out, /data-baand|taellelinje/);
});

test('KC-0064 phase 3: Univers candidates, unprepared meetings and log rows carry their stable id', () => {
  const log = [{ id: 'l-7', tid: '2026-10-27T09:30:00.000Z', kilde: 'hermes', tekst: 'Forberedte et møde.' }] as import('../../src/store/types.ts').LogEntry[];
  const ov = String(renderOversigt(indeks, {}, NOW));
  assert.ok(ov.includes('data-id="kandidat:ev&lt;1&gt;"'));
  const out = String(renderUnivers(info, state, NOW, { log }));
  for (const id of ['moede:moede-2', 'log:l-7']) assert.ok(out.includes(`data-id="${id}"`), id);
});

test('KC-0064 phase 3: Univers documents, notes and tasks carry ids, unique per room', () => {
  const ud = String(renderUnivers(info, state, NOW));
  const alle = ider(ud);
  assert.ok(alle.some((i) => i.startsWith('dok:')) && alle.some((i) => i.startsWith('note:')) && alle.some((i) => i.startsWith('opg:')) && alle.some((i) => i.startsWith('moede:')));
  assert.deepEqual(dubletter(ud), []);
  assert.deepEqual(dubletter(String(renderOversigt(indeks, {}, NOW))), []);
});
