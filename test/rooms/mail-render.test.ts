import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMail, renderMailEmpty } from '../../src/rooms/mail/render.ts';
import type { MailState } from '../../src/rooms/mail/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { dubletter, ider } from '../ider.ts';
import { baandDel, taelleTekst } from '../baand.ts';
import { foldet } from '../foldet.ts';

const state: MailState = {
  dato: '2026-10-27', genereret: '2026-10-27T08:40:00.000Z',
  tal: { handling: 3, afventer: 1, regninger: 12, sorteretIDag: 3 },
  beslutninger: [
    { mailId: '242', emne: 'Tilbud på <eltavle>', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'Tilbud på 18.400 kr.', betydning: 'Svar inden fredag.', frist: '2026-10-31', udkast: 'Hej, tak for tilbuddet.', arkivmappe: 'Folders/Afventer', muligheder: [{ id: '242-ring', label: 'Ring til dem', instruktion: 'i' }] },
    { mailId: '243', emne: 'Ugens energinyt', fra: 'Nyhedsbrev', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'Nyhedsbrev.', betydning: 'Du åbner det aldrig.', arkivmappe: 'Archive', muligheder: [{ id: '243-afmeld', label: 'Afmeld', instruktion: 'i' }] },
    { mailId: '244', emne: 'Kvittering', fra: 'Shop', modtaget: '2026-10-24T09:12:00Z', type: 'kvittering', resume: 'Ordre 123.', betydning: 'Ingen handling.', arkivmappe: 'Folders/køb', muligheder: [], afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' } },
  ],
  ordnet: [{ mailId: '301', emne: 'Faktura', fra: 'Elselskabet', til: 'Folders/Regninger', hvorfor: 'faktura', tid: '2026-10-27T08:30:01', handling: { id: 'ordnet-301', label: 'Fortryd', instruktion: 'i', fortryd: 'f' } }],
  hermesStatus: 'Holder øje med Handling',
};

test('a svar card shows betydning, a type chip, the draft in a textarea, Gem som kladde, Send with confirmation and Færdig', () => {
  const out = String(renderMail(state, [], new Date('2026-10-27T09:00:00Z')));
  assert.match(out, /Tilbud på &lt;eltavle&gt;/);
  assert.match(out, /<span class="vis-etiket">Skal besvares · Elektrikeren ApS<\/span>/); // KC-0059: the type chip became the headline's label
  assert.match(out, /class="betydning">Svar inden fredag\./);
  assert.match(out, /<textarea[^>]*name="tekst"[^>]*id="udkast-242"[^>]*>Hej, tak for tilbuddet\.<\/textarea>/);
  assert.match(out, /data-aktion="kladde"[^>]*data-form="kladde-242"/);
  assert.match(out, /data-aktion="faerdig"[^>]*data-arg="[^"]*242/);
  assert.match(out, /data-handling="242-ring"/);
  assert.match(out, /<button[^>]*data-aktion="send"[^>]*data-form="kladde-242"[^>]*data-confirm="Send svaret til Elektrikeren ApS nu\?"[^>]*>Send<\/button>/);
});

test('a nyhedsbrev card offers Afmeld and Færdig; a finished card shows where it went', () => {
  const out = String(renderMail(state, [], new Date()));
  assert.match(out, /data-handling="243-afmeld"/);
  assert.match(out, /Færdig → køb/);
  assert.doesNotMatch(out, /data-aktion="faerdig"[^>]*data-arg="[^"]*244/);
});

test('renderMail lists what Hermes sorted today with a Fortryd button per mail', () => {
  const out = String(renderMail(state, [], new Date()));
  assert.match(out, /Ordnet af Hermes i dag/);
  assert.match(out, /data-handling="ordnet-301"/);
});

test('renderMailEmpty offers the refresh button', () => {
  assert.match(String(renderMailEmpty('Ikke hentet endnu.')), /data-opdater="opdater"/);
});

test('renderMail shows what Hermes answered inside a card and marks the numbers as an element', () => {
  const out = String(renderMail(state, [{ id: 'l1', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Jeg fandt nummeret.', handlingId: '242-ring' }], new Date()));
  assert.match(out, /class="resultat"[^>]*>[\s\S]*Jeg fandt nummeret\./);
  assert.match(out, /data-element="Tal: 3 i Handling"/);
});

test('a sent mail shows Sendt instead of Færdig', () => {
  const sent: MailState = { ...state, beslutninger: [{ ...state.beslutninger[0]!, afgjort: { mulighedId: 'sendt', tid: '2026-10-27T09:00:00Z' } }] };
  const out = String(renderMail(sent, [], new Date()));
  assert.match(out, /Sendt → Afventer/);
  assert.doesNotMatch(out, /data-aktion="send"/);
});

test('KC-0024: on the phone Mail keeps the decisions; sorted mail and the log fold, the numbers are laptop-only', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const out = String(renderMail(state, [], new Date()));
  assert.ok(foldet(out).has('ordnet (2)'), 'Ordnet af Hermes + Afgjort fold together');
  assert.ok(!iFold(out, 'Venter på din beslutning'));
  assert.match(out, /<section class="tiles tiles-stats kun-stor"/);
});

// KC-0059: a decision is read from its pictogram and headline; the explanation is one tap away.
const NU = new Date('2026-10-27T09:00:00Z');
const visuelRegning = { ikon: 'receipt', tone: 'adv', overskrift: 'Elregning 1.240 kr.', billede: { art: 'beloeb', vaerdi: 1240, graense: 1000, enhed: 'kr', tekst: 'denne måned', graenseTekst: 'Budget' } } as const;
const medVisuel = (i: number, visuel?: unknown): MailState => ({ ...state, beslutninger: [{ ...state.beslutninger[i]!, ...(visuel ? { visuel } : {}) } as MailState['beslutninger'][number]] });
const kort = (out: string): string => out.slice(out.search(/<article data-id="mail:[^"]*" class="card mail"/), out.indexOf('</article>'));

test('KC-0059: a decision shows its pictogram and one headline, the sender and type as the small label', () => {
  const out = kort(String(renderMail(medVisuel(0, visuelRegning), [], NU)));
  assert.match(out, /<span class="vis-ikon tilstand-kraever" data-tone="adv"><svg class="ikon"/);
  assert.match(out, /<h3 class="vis-overskrift">Elregning 1\.240 kr\.<\/h3>/);
  assert.match(out, /<span class="vis-etiket">Skal besvares · Elektrikeren ApS<\/span>/);
});

test('KC-0059: the picture comes before the buttons', () => {
  const out = kort(String(renderMail(medVisuel(0, visuelRegning), [], NU)));
  assert.match(out, /class="beloeb /);
  assert.ok(out.indexOf('class="beloeb ') < out.indexOf('data-aktion="send"'), 'picture before Send');
  assert.ok(out.indexOf('class="beloeb ') < out.indexOf('data-handling="242-ring"'));
});

test('KC-0059: without a visuel the pictogram follows the mail type and the subject is the headline', () => {
  const ikonFor = (t: MailState['beslutninger'][number]['type'], d: string): void => {
    const s: MailState = { ...state, beslutninger: [{ ...state.beslutninger[1]!, type: t }] };
    const out = kort(String(renderMail(s, [], NU)));
    assert.match(out, /<span class="vis-ikon tilstand-rolig"><svg class="ikon"/, t);
    assert.ok(out.includes(`<span class="vis-ikon tilstand-rolig"><svg class="ikon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}`), `${t} pictogram`);
    assert.match(out, /<h3 class="vis-overskrift">Ugens energinyt<\/h3>/);
    assert.ok(!/class="(dagslinje|beloeb|nedtaelling|uge|prikker|personer)"/.test(out));
  };
  return import('../../src/shell/ikoner.ts').then(({ IKONER }) => {
    for (const [t, n] of [['svar', 'message-circle'], ['aktion', 'target'], ['info', 'info'], ['nyhedsbrev', 'mail-x'], ['regning', 'receipt'], ['kvittering', 'circle-check']] as const) ikonFor(t, IKONER[n].slice(0, 30));
  });
});

test('KC-0059: the svar draft stays in the DOM behind Se udkastet, and Send still points at it', () => {
  const out = kort(String(renderMail(medVisuel(0), [], NU)));
  assert.match(out, /<details class="vis-mere"><summary>[\s\S]*?<span>Se udkastet<\/span><\/summary><div class="vis-mere-indhold"><form id="kladde-242" class="kladde"[\s\S]*?<textarea[^>]*id="udkast-242"[^>]*>Hej, tak for tilbuddet\.<\/textarea>[\s\S]*?<\/form>/);
  assert.match(out, /data-aktion="send"[^>]*data-form="kladde-242"/);
  assert.ok(out.indexOf('Se udkastet') < out.indexOf('<span>Hvorfor?</span>'), 'the draft opens before Hvorfor');
});

test('KC-0059: Hvorfor? holds betydning, resume, frist and the date; nothing of it sits outside', () => {
  const out = kort(String(renderMail(medVisuel(0), [], NU)));
  const hvorfor = out.slice(out.indexOf('<span>Hvorfor?</span>'));
  assert.match(hvorfor, /class="betydning">Svar inden fredag\./);
  assert.match(hvorfor, /Tilbud på 18\.400 kr\./);
  assert.match(hvorfor, /Frist 2026-10-31/);
  assert.match(hvorfor, /26\. okt\./);
  const udenfor = out.slice(0, out.indexOf('<span>Hvorfor?</span>')).replace(/ data-sig="[^"]*"/, '');
  assert.ok(!udenfor.includes('Svar inden fredag.') && !udenfor.includes('Tilbud på 18.400'));
});

test('KC-0059: a decided mail collapses to one line: check pictogram, subject and where it went', () => {
  const out = String(renderMail(state, [], NU));
  const i = out.search(/<article data-id="mail:[^"]*" class="card mail is-done"/);
  const done = out.slice(i, out.indexOf('</article>', i));
  assert.match(done, /<svg class="ikon"[\s\S]*?<\/svg>[\s\S]*Kvittering[\s\S]*Færdig → køb/);
  assert.ok(!done.includes('vis-hoved') && !done.includes('Ordre 123.') && !done.includes('Ingen handling.'));
});

test('KC-0059: each stat tile has a pictogram before its number', () => {
  const out = String(renderMail(state, [], NU));
  const tiles = out.slice(out.indexOf('class="tiles tiles-stats'), out.indexOf('<!--/baand-->', out.indexOf('class="tiles tiles-stats')));
  assert.equal([...tiles.matchAll(/<div class="tile"><span class="tile-ikon"><svg class="ikon"[\s\S]*?<\/svg><\/span><span class="stat">/g)].length, 3);
});

// ---- KC-0064: one look per meaning ----
const primaere = (s: string): number => (s.match(/btn-primary/g) ?? []).length;
const medType = (type: 'svar' | 'aktion' | 'nyhedsbrev' | 'info' | 'regning', ekstra: Partial<MailState['beslutninger'][number]> = {}): MailState => ({
  ...state,
  beslutninger: [{ ...state.beslutninger[0]!, type, muligheder: [{ id: 'a-1', label: 'Første', instruktion: 'i' }, { id: 'a-2', label: 'Anden', instruktion: 'i' }], ...ekstra }],
});

test('KC-0064: Send is the graense button — one press, still confirmed and wired', () => {
  const out = String(renderMail(state, [], NU));
  assert.match(out, /<button type="button" class="btn btn-graense" data-aktion="send" data-form="kladde-242"[^>]*data-confirm="Send svaret til Elektrikeren ApS nu\?"[^>]*data-status="sender" data-kraever-ja data-graense="kraever-ja">Send<\/button>/);
});

test('KC-0064: a decision has at most one btn-primary — none for svar, the first option for nyhedsbrev and aktion', () => {
  const tal = (type: Parameters<typeof medType>[0]): number => primaere(String(renderMail(medType(type), [], NU)).split(/<article data-id="mail:[^"]*" class="card mail"/)[1]!.split('</article>')[0]!);
  assert.equal(tal('svar'), 0);
  assert.equal(tal('nyhedsbrev'), 1);
  assert.equal(tal('aktion'), 1);
  assert.equal(tal('info'), 0);
  assert.equal(tal('regning'), 0);
  const aktion = String(renderMail(medType('aktion'), [], NU));
  assert.match(aktion, /class="btn btn-primary" data-handling="a-1"/);
  assert.match(aktion, /class="btn" data-handling="a-2"/);
});

test('KC-0064: the done mail card uses the ordnet chip, not an icon tile; Frist is a kraever chip', () => {
  const out = String(renderMail(state, [], NU));
  const i = out.search(/<article data-id="mail:[^"]*" class="card mail is-done"/);
  const done = out.slice(i, out.indexOf('</article>', i));
  assert.match(done, /class="chip tilstand-ordnet"/);
  assert.doesNotMatch(done, /vis-ikon/);
  assert.match(out, /class="chip tilstand-kraever">Frist 2026-10-31</);
  assert.doesNotMatch(out, /chip-pending/);
});

test('KC-0064: the ask control is the one spoerg look, with the same data-ask as before', () => {
  const out = String(renderMail(state, [], NU));
  assert.doesNotMatch(out, /class="ask"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="Mailen: Kvittering"/);
  assert.match(out, /class="btn btn-ghost spoerg" data-ask="Mailen: Tilbud på &lt;eltavle&gt;"/);
});

// ---- KC-0064 phase 2: the three bands ----
test('KC-0064: Mail sorts into the bands', () => {
  const med: MailState = { ...state, ordnet: [1, 2, 3].map((i) => ({ ...state.ordnet[0]!, mailId: `30${i}`, handling: { ...state.ordnet[0]!.handling, id: `ordnet-30${i}` } })) };
  const log = [{ id: 'l1', tid: '2026-10-27T08:00:00Z', kilde: 'hermes' as const, tekst: 'Læste Handling.' }];
  const out = String(renderMail(med, log, NU, [{ id: 'kc_1', label: 'Mail: bygger rummet', status: 'running' }]));
  assert.equal(taelleTekst(out), '2 venter på dig · 1 i gang · 5 ordnet');
  const k = baandDel(out, 'kraever');
  assert.match(k, /data-element="Mailen: Tilbud på &lt;eltavle&gt;"/);
  assert.ok(!k.includes('mail is-done'));
  assert.match(baandDel(out, 'ordnet'), /mail is-done/);
  assert.match(out, /id="kladde-242"/);
  assert.match(out, /data-confirm=/);
  assert.doesNotMatch(out, /kort-stor/);
});

test('KC-0064: the stats tiles have no second count', () => {
  const out = String(renderMail(state, [], NU));
  assert.doesNotMatch(out, /<span class="row-note">venter på dig<\/span>/);
  assert.match(baandDel(out, 'indhold'), /class="tiles tiles-stats/);
});

test('KC-0064: the "Vis alle" row stays with Ordnet af Hermes', () => {
  const mange: MailState = { ...state, beslutninger: [], ordnet: Array.from({ length: 10 }, (_, i) => ({ ...state.ordnet[0]!, mailId: `4${i}`, handling: { ...state.ordnet[0]!.handling, id: `o-${i}` } })) };
  const out = String(renderMail(mange, [], NU));
  assert.match(baandDel(out, 'ordnet'), /data-vis-alle="ordnet-more"/);
  assert.ok(foldet(out).has('ordnet (10)'), 'the row is `efter`, not counted');
});

test('KC-0064 phase 3: Mail decisions, ordnet rows and log rows carry their stable id', () => {
  const log: LogEntry[] = [{ id: 'l-9', tid: '2026-10-27T08:50:00.000Z', kilde: 'hermes', tekst: 'Flyttede en mail.' }];
  const out = String(renderMail(state, log, new Date('2026-10-27T09:00:00Z')));
  for (const id of ['mail:242', 'mail:243', 'mail:244', 'mail-ordnet:301', 'log:l-9']) assert.ok(out.includes(`data-id="${id}"`), id);
});

test('KC-0064 phase 3: Mail ids are unique per room', () => {
  assert.deepEqual(dubletter(String(renderMail(state, [], new Date('2026-10-27T09:00:00Z')))), []);
});

test('KC-0066: a mulighed marked tilAndre renders as the red graense button and never takes the primary place', () => {
  const b = state.beslutninger[1]!;
  const s: MailState = { ...state, beslutninger: [{ ...b, type: 'aktion', muligheder: [{ id: '243-bekraeft', label: 'Bekræft tiden', instruktion: 'i', tilAndre: true }, { id: '243-find', label: 'Find datoen', instruktion: 'i' }] }] };
  const out = String(renderMail(s, [], new Date('2026-10-27T09:00:00Z')));
  assert.match(out, /<button type="button" class="btn btn-graense" data-handling="243-bekraeft" data-indhold="[0-9a-f]{16}" data-kraever-ja data-graense="kraever-ja">Bekræft tiden<\/button>/);
  assert.doesNotMatch(out, /btn-primary[^>]*data-handling="243-bekraeft"/);
  assert.match(out, /<button type="button" class="btn" data-handling="243-find">Find datoen<\/button>/, 'the other option is not promoted to primary over a red one');
});

test('KC-0078: Mail header shows freshness; older than today gets the warning tone; empty room has none', () => {
  const idag = String(renderMail(state, [], new Date('2026-10-27T09:00:00Z'))); // built 09.40 CET
  assert.match(idag, /Hermes sorterer resten\.[^<]*<span class="friskhed">opdateret 09\.40<\/span>/);
  const igaar = String(renderMail(state, [], new Date('2026-10-28T09:00:00Z')));
  assert.match(igaar, /<span class="friskhed friskhed-gammel">fra i går 09\.40<\/span>/);
  assert.doesNotMatch(String(renderMailEmpty('x')), /friskhed/);
});

// ---- KC-0091: copy the draft in one tap ----
const afkod = (s: string): string => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('KC-0091: a svar card has a Kopiér button whose data-kopier decodes to the exact draft (quote, ampersand, newline, no subject)', () => {
  const udkast = 'Hej "Tom" & co\n\nTak for <tilbuddet>.\nVenlig hilsen\nHenrik';
  const s: MailState = { ...state, beslutninger: [{ ...state.beslutninger[0]!, udkast }] };
  const out = String(renderMail(s, [], new Date('2026-10-27T09:00:00Z')));
  const m = [...out.matchAll(/<button type="button" class="btn" data-kopier="([^"]*)" data-kopier-fra="udkast-([^"]+)">Kopiér<\/button>/g)];
  assert.equal(m.length, 1);
  assert.equal(afkod(m[0]![1]!), udkast);
  // Henrik's edits count: the button names the textarea it copies from when it is on the page.
  assert.match(out, new RegExp(`id="udkast-${m[0]![2]}"`));
});

test('KC-0091: no Kopiér without a draft — a nyhedsbrev card and a svar card with an empty draft', () => {
  const s: MailState = { ...state, beslutninger: [state.beslutninger[1]!, { ...state.beslutninger[0]!, udkast: '' }] };
  assert.doesNotMatch(String(renderMail(s, [], new Date())), /data-kopier/);
});

// KC-0097: one button for the mails whose only step is Færdig.
const orient = (id: string, type: 'info' | 'kvittering', extra: Record<string, unknown> = {}) => ({ mailId: id, emne: `Orientering ${id}`, fra: 'Lægehuset', modtaget: '2026-10-26T10:00:00Z', type, resume: 'r', betydning: 'Kun til orientering.', arkivmappe: 'Archive', muligheder: [], ...extra }) as MailState['beslutninger'][number];
const medOrient = (...b: MailState['beslutninger']): MailState => ({ ...state, beslutninger: [state.beslutninger[0]!, ...b] });
const alleKnap = /<button[^>]*data-aktion="faerdig-alle"[^>]*>([^<]*)<\/button>/;

test('KC-0097: two or more orientation mails give ONE group button naming the count and carrying exactly those ids', () => {
  const out = String(renderMail(medOrient(orient('301', 'info'), orient('302', 'info'), orient('303', 'info')), [], new Date('2026-10-27T09:00:00Z')));
  assert.equal((out.match(/data-aktion="faerdig-alle"/g) ?? []).length, 1);
  assert.match(out, /<button[^>]*data-aktion="faerdig-alle"[^>]*data-arg="\{&quot;mailIds&quot;:\[&quot;301&quot;,&quot;302&quot;,&quot;303&quot;\]\}"/);
  assert.equal(alleKnap.exec(out)?.[1], 'Færdig med de 3 til orientering');
  const kraever = baandDel(out, 'kraever');
  assert.ok(kraever.indexOf('faerdig-alle') < kraever.indexOf('Orientering 301'), 'the button sits in the group head, before the cards');
  assert.doesNotMatch(out.slice(out.indexOf('faerdig-alle') - 80, out.indexOf('faerdig-alle') + 400), /btn-primary/);
});

test('KC-0097: receipts count too and change the wording; mails with a real step never do', () => {
  const out = String(renderMail(medOrient(orient('301', 'info'), orient('302', 'kvittering'), orient('303', 'info', { muligheder: [{ id: '303-x', label: 'Ring', instruktion: 'i' }] })), [], new Date()));
  assert.equal(alleKnap.exec(out)?.[1], 'Færdig med de 2, der kun er til orientering');
  assert.match(out, /data-arg="\{&quot;mailIds&quot;:\[&quot;301&quot;,&quot;302&quot;\]\}"/);
});

test('KC-0097: no group button with fewer than two (or when they are already done)', () => {
  assert.doesNotMatch(String(renderMail(state, [], new Date())), /faerdig-alle/);
  assert.doesNotMatch(String(renderMail(medOrient(orient('301', 'info')), [], new Date())), /faerdig-alle/);
  const klar = { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' };
  assert.doesNotMatch(String(renderMail(medOrient(orient('301', 'info'), orient('302', 'info', { afgjort: klar })), [], new Date())), /faerdig-alle/);
});

test('KC-0214: built from the mail connector — no Send (IMAP cannot send), Gem som kladde and Færdig stay; the inbox is the one count', () => {
  const sky: MailState = { ...state, forbindelse: 'Mail', tal: { handling: 5, afventer: 0, regninger: 0, sorteretIDag: 0 } };
  const out = String(renderMail(sky, [], new Date('2026-10-27T09:00:00Z')));
  assert.doesNotMatch(out, /data-aktion="send"/);
  assert.match(out, /data-aktion="kladde"[^>]*data-form="kladde-242"/);
  assert.match(out, /data-aktion="faerdig"[^>]*data-arg="[^"]*242/);
  assert.match(out, /data-mail-kilde="forbindelse"/);
  assert.match(out, /Indbakken i Mail/);
  assert.match(out, /<span class="stat">5<\/span><span class="row-note">i indbakken<\/span>/);
  assert.doesNotMatch(out, /i Afventer|i Regninger|Folders\/Handling|Hermes sorterer resten/);
  // Henrik's install (no forbindelse): Send and the three folder tiles as before.
  const henrik = String(renderMail(state, [], new Date('2026-10-27T09:00:00Z')));
  assert.match(henrik, /data-aktion="send"/);
  assert.doesNotMatch(henrik, /data-mail-kilde/);
  assert.match(henrik, /i Afventer/);
});

// KC-0223: a connection Clawco may only read — the mails wait in the room and in the count, with nothing to press but the question.
test('a read-only mail room shows the waiting mails and the plain words, and no handling that moves or writes', () => {
  const laes: MailState = {
    dato: '2026-11-01', genereret: '2026-11-01T08:40:00.000Z',
    tal: { handling: 2, afventer: 0, regninger: 0, sorteretIDag: 0 },
    beslutninger: [
      { mailId: '5', emne: 'Svar <b>senest</b> fredag', fra: 'Skolen', modtaget: '2026-11-01T06:00:00Z', type: 'svar', resume: '', betydning: 'Skolen vil have svar.', arkivmappe: 'Archive', muligheder: [] },
      { mailId: '6', emne: 'Nyhedsbrev', fra: 'Avisen', modtaget: '2026-10-31T06:00:00Z', type: 'nyhedsbrev', resume: '', betydning: 'Et nyhedsbrev.', arkivmappe: 'Archive', muligheder: [] },
      { mailId: '7', emne: 'Info', fra: 'Banken', modtaget: '2026-10-31T06:00:00Z', type: 'info', resume: '', betydning: 'Orientering.', arkivmappe: 'Archive', muligheder: [] },
      { mailId: '8', emne: 'Kvittering', fra: 'Shop', modtaget: '2026-10-31T06:00:00Z', type: 'kvittering', resume: '', betydning: 'Kvittering.', arkivmappe: 'Archive', muligheder: [] },
    ],
    ordnet: [], hermesStatus: 'Holder øje med indbakken', forbindelse: 'Gmail', laeseKun: true,
  };
  const out = String(renderMail(laes, [], new Date('2026-11-01T09:00:00Z')));
  assert.match(out, /data-mail-kilde="laes-kun"/);
  assert.match(out, /Clawco kan kun læse den/);
  assert.match(out, /Svar &lt;b&gt;senest&lt;\/b&gt; fredag/, 'a hostile subject is escaped');
  assert.match(out, /data-element="Mailen: Skolen[^"]*"|data-element="Mailen: Svar/);
  for (const forbudt of [/data-aktion=/, /data-handling=/, /data-kopier/, /<textarea/, />Færdig</, />Send</, />Gem som kladde</, /faerdig-alle/]) assert.doesNotMatch(out, forbudt);
  assert.match(out, /2<\/span><span class="row-note">ulæste eller markerede/);
});
