// KC-0146: "Hvad Clawco ved om dig" — the pure render (state in, HTML out).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSletAlt, renderViden, type Viden } from '../../src/tillid/viden.ts';
import { parseRegler } from '../../src/tillid/regler.ts';

const REGLER = `naeste-id: R-0003

## R-0001 · Mail sorteres i mapper
- trin: 1
- gaelder: mail / indbakke
- oprindelse: import 2026-10-31
- status: aktiv

## R-0002 · Regnskab
- trin: 2
- gaelder: mail / regning
- oprindelse: ret 2026-11-01 (kort k_1)
- status: pause
`;

const fuld = (o: Partial<Viden> = {}): Viden => ({
  kilder: [
    { id: 'falsk-kalender', navn: 'Kalender', slags: 'kalender', zone: 'privat', forbundet: true },
    { id: 'mail-imap', navn: 'Mail (IMAP)', slags: 'mail', zone: 'privat', forbundet: false },
  ],
  regler: { fil: '/v/Clawco/regler.md', laest: { tilstand: 'ok', saet: parseRegler(REGLER), aendretUdenfor: false } },
  personer: { dir: '/v/40-Mennesker/People', liste: [{ navn: '<img src=x onerror=alert(1)>', relation: 'familie', sti: 'familie/x.md' }] },
  gemt: { rum: [{ id: 'mail', log: 12, chat: 3, bytes: 2048, filer: [] }], clawco: ['vault/Clawco/regler.md'], andre: 4, noegler: 2, bytes: 4096 },
  ...o,
});

test('the page has every section and the two buttons', () => {
  const s = String(renderViden(fuld()));
  assert.match(s, /data-viden/);
  for (const del of ['kilder', 'regler', 'personer', 'gemt']) assert.match(s, new RegExp(`data-viden-del="${del}"`), del);
  assert.match(s, /<h1>Hvad Clawco ved om dig<\/h1>/);
  assert.match(s, /Kalender/);
  assert.doesNotMatch(s, /Mail \(IMAP\)/, 'only connected sources');
  assert.match(s, /href="\/api\/tillid\/eksport"[^>]*>Hent alt</);
  assert.match(s, /href="\/viden\/slet-alt"[^>]*>Slet alt</);
  assert.doesNotMatch(s, /data-viden-del="skjult"/, 'KC-0145 is not built: the section is gone, not greyed');
});

test('rules: id, trin sentence, origin, the file path and Slå fra / Slå til igen', () => {
  const s = String(renderViden(fuld()));
  assert.match(s, /R-0001/);
  assert.match(s, /Trin 1 · Hermes må sortere/);
  assert.match(s, /Importeret 2026-10-31/);
  assert.match(s, /\/v\/Clawco\/regler\.md/);
  assert.match(s, /<form method="post" action="\/api\/tillid\/regler\/R-0001\/pause"[^>]*data-regel-form="R-0001:pause"[\s\S]*?>Slå fra</);
  assert.match(s, /<form method="post" action="\/api\/tillid\/regler\/R-0002\/aktiv"[^>]*data-regel-form="R-0002:aktiv"[\s\S]*?>Slå til igen</);
  assert.doesNotMatch(s, /ændret uden for Clawco/);
});

test('KC-0143: each rule row carries its trin; a rule for every source says "gælder alt"', () => {
  const s = String(renderViden(fuld()));
  assert.match(s, /data-regel="R-0001"[^>]*data-regel-trin="1"/);
  assert.match(s, /data-regel="R-0002"[^>]*data-regel-trin="2"[\s\S]*?Trin 2 · Hermes må føre regnskab/);
  const alt = `naeste-id: R-0002\n\n## R-0001 · Alt\n- trin: 3\n- gaelder: *\n- oprindelse: haand 2026-11-01\n- status: aktiv\n`;
  const a = String(renderViden(fuld({ regler: { fil: '/v/r.md', laest: { tilstand: 'ok', saet: parseRegler(alt), aendretUdenfor: false } } })));
  assert.match(a, /data-regel-alt[^>]*>gælder alt</);
  assert.doesNotMatch(a, /· \*</);
});

test('rules changed outside Clawco, unreadable, or none', () => {
  const ok = fuld().regler!;
  assert.match(String(renderViden(fuld({ regler: { ...ok, laest: { tilstand: 'ok', saet: parseRegler(REGLER), aendretUdenfor: true } } }))), /filen er ændret uden for Clawco/i);
  const u = String(renderViden(fuld({ regler: { ...ok, laest: { tilstand: 'ulaeselig', hvorfor: 'linjen "naeste-id" mangler <b>', aendretUdenfor: false } } })));
  assert.match(u, /kan ikke læses/);
  assert.match(u, /&lt;b&gt;/);
  assert.match(String(renderViden(fuld({ regler: { ...ok, laest: { tilstand: 'mangler' } } }))), /Ingen regler endnu/);
});

test('a hostile person name is escaped; the link opens the file', () => {
  const s = String(renderViden(fuld()));
  assert.doesNotMatch(s, /<img src=x/);
  assert.match(s, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(s, /href="obsidian:\/\/open\?path=%2Fv%2F40-Mennesker%2FPeople%2Ffamilie%2Fx\.md"/);
});

test('Gemt: per room lines, sizes in Danish, the rest and the keys', () => {
  assert.match(String(renderViden(fuld({ gemt: { ...fuld().gemt, rum: [{ id: 'nav', log: 0, chat: 0, bytes: 10, filer: [] }] } }))), /Hvornår du åbnede rummene/, 'the nav store by a plain name');
  const s = String(renderViden(fuld()));
  assert.match(s, /Mail/);
  assert.match(s, /12 linjer i loggen · 3 beskeder · 2,0 kB/);
  assert.match(s, /4 andre filer/);
  assert.match(s, /2 filer med nøgler/);
});

test('empty: renders without errors and says so; after a delete it says Alt er slettet', () => {
  const tom: Viden = { kilder: [], regler: null, personer: null, gemt: { rum: [], clawco: [], andre: 0, noegler: 0, bytes: 0 } };
  const s = String(renderViden(tom));
  assert.match(s, /data-viden/);
  assert.match(s, /Ingen kilder er koblet til/);
  assert.match(s, /Clawco har ikke gemt noget/);
  assert.doesNotMatch(s, /Alt er slettet/);
  assert.match(String(renderViden({ ...tom, slettet: true })), /data-slettet[\s\S]*Alt er slettet/);
});

test('the confirmation names what goes, offers Hent alt først and asks for SLET on a red button', () => {
  const s = String(renderSletAlt(fuld()));
  assert.match(s, /data-slet-alt="bekraeft"/);
  assert.match(s, /Mail: 12 linjer i loggen og 3 beskeder/);
  assert.match(s, /\/v\/Clawco\/regler\.md/);
  assert.match(s, /1 fil i Clawco-mappen/);
  assert.match(s, /2 filer med nøgler/);
  assert.match(s, /personregisteret/, 'says the people register stays');
  assert.match(s, /href="\/api\/tillid\/eksport"[^>]*>Hent alt først</);
  assert.match(s, /<form method="post" action="\/api\/tillid\/slet-alt"/);
  assert.match(s, /name="bekraeft"[^>]*data-uden-stemme/, 'typed, never dictated: no mic on the field');
  assert.match(s, /SLET/);
  assert.match(s, /<button type="submit" class="btn btn-graense"[^>]*>Slet alt</);
});

// ---- KC-0147: the week's number on the page ----
const ugeRaekke = [9, 8, 8, 7, 7, 6, 9, 6].map((snit, i) => ({ uge: `2026-0${i + 1}-01`, nr: 37 + i, dage: 7, snit, fortryd: 1 }));

test('KC-0147: with eight weeks the page shows the line, its help text and the bars with their text alternative', () => {
  const s = String(renderViden(fuld({ ugetal: ugeRaekke })));
  assert.match(s, /data-viden-del="ugetal"/);
  assert.match(s, /data-ugetal="linje">I denne uge krævede i snit 6 ting dig om dagen \(sidste uge 9\)\. Fortryd: 1\./);
  assert.match(s, /data-ugetal="hjaelp"/);
  assert.match(s, /data-ugetal="soejler"/);
  assert.match(s, /aria-label="Ting der krævede dig om dagen, uge for uge: uge 37: 9, uge 38: 8/);
});

test('KC-0147: no data at all, or no data given: the section says so calmly / is gone', () => {
  const tom = ugeRaekke.map((u) => ({ ...u, dage: 0, snit: 0, fortryd: 0 }));
  assert.match(String(renderViden(fuld({ ugetal: tom }))), /Tallet kommer, når Clawco har talt en dag\./);
  assert.doesNotMatch(String(renderViden(fuld())), /data-viden-del="ugetal"/);
});

// KC-0240: with an empty data folder the page showed a data-folder path that is one 400 px token on a 375 px phone.
// A path has no break opportunity, so the invariant is two-sided: every long path in the markup sits in a `.mono`
// element, and the stylesheet lets `.mono` wrap anywhere (a path is the one thing that has no spaces).
test('KC-0240: a long path anywhere on the page sits in a .mono element, so the stylesheet can wrap it', async () => {
  const { readFileSync } = await import('node:fs');
  const lang = '/private/tmp/claude-501/-Users-slambert-projects-Clawco-work/8f8d5873-df7f-49a7-b7fa-7ab805a47e8f/data/clawco/regler.md';
  const toem = (o: Partial<Viden> = {}) => fuld({
    kilder: [],
    regler: { fil: lang, laest: { tilstand: 'ok', saet: parseRegler('naeste-id: R-0001\n'), aendretUdenfor: false } },
    personer: { dir: lang, liste: [] },
    gemt: { rum: [], clawco: [lang], andre: 0, noegler: 0, bytes: 0 },
    ...o,
  });
  for (const side of [String(renderViden(toem())), String(renderSletAlt(toem()))]) {
    const stier = [...side.matchAll(/<(\w+)([^>]*)>([^<]*\/private\/tmp[^<]*)</g)];
    assert.ok(stier.length >= 1, 'the long path is rendered');
    for (const [, tag, attrs, tekst] of stier) assert.match(`${tag}${attrs}`, /class="[^"]*\bmono\b/, `path "${tekst!.slice(0, 40)}…" is not in a .mono element`);
  }
  const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const mono = [...css.matchAll(/(?:^|\})\s*([^{}]*)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((x) => x.trim()).includes('.mono')).map((m) => m[2]).join(';');
  assert.match(mono, /overflow-wrap:\s*anywhere/, '.mono must be able to wrap inside a 375 px phone');
});

test('KC-0270 (B3): rules changed outside Clawco say they do not count, with one owner button that approves exactly this content', () => {
  const ok = fuld().regler!;
  const s = String(renderViden(fuld({ regler: { ...ok, laest: { tilstand: 'ok', saet: parseRegler(REGLER), aendretUdenfor: true, sha: 'a'.repeat(64) } } })));
  assert.match(s, /gælder ikke/);
  assert.match(s, /<form method="post" action="\/api\/tillid\/regler\/godkend"[^>]*data-regel-form="godkend:a{64}"[^>]*><button type="submit"[^>]*>Godkend reglerne<\/button><\/form>/);
  assert.doesNotMatch(String(renderViden(fuld())), /regler\/godkend/);
});

test('KC-0275 (B6): without a key the page says in one sentence that the audit log is not sealed; with a key it says nothing', () => {
  const uden = String(renderViden(fuld({ revisionNoegle: false })));
  assert.match(uden, /data-viden-revision-usikret/);
  assert.match(uden, /ikke forseglet med en nøgle/);
  assert.doesNotMatch(String(renderViden(fuld({ revisionNoegle: true }))), /data-viden-revision-usikret/);
});

test('KC-0275: the Slet alt confirmation says the pause and the household stay', () => {
  assert.match(String(renderSletAlt(fuld())), /pause og hvem der hører til i husstanden/);
});
