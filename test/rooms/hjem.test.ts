import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHjem, renderPlaceholder } from '../../src/rooms/hjem/render.ts';
import { dubletter, ider } from '../ider.ts';
import { baandDel, taelleTekst } from '../baand.ts';

test('renderHjem greets, lists what waits with links, and tiles every room', () => {
  const out = String(renderHjem({
    hilsen: 'Godmorgen, Henrik',
    venter: [{ roomId: 'dagen', tekst: 'Én anbefaling venter: Brug kl. 13 på udkastet.' }],
    hermes: [{ tid: '2026-10-26T05:00:00.000Z', tekst: 'Byggede Dagen.' }],
    now: new Date('2026-10-26T12:00:00Z'),
  }));
  assert.match(out, /Godmorgen, Henrik/);
  assert.match(out, /href="\/rum\/dagen"[^>]*>[\s\S]*?Én anbefaling venter/);
  for (const id of ['dagen', 'mail', 'skrive', 'nyheder']) assert.match(out, new RegExp(`data-room-tile="${id}"`));
  assert.match(out, /Byggede Dagen\./);
});

test('renderHjem says so when nothing waits', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [] }));
  assert.match(out, /Intet venter på dig/);
});

test('renderPlaceholder explains that the room is drawn but not built and links to the canvas', () => {
  const out = String(renderPlaceholder({ id: 'mail', navn: 'Mail', built: false, beskrivelse: 'Beslutninger om mails.' }));
  assert.match(out, /Mail/);
  assert.match(out, /ikke bygget/);
  assert.match(out, /claude\.ai\/artifact/);
});

test('KC-0024: on the phone Hjem shows the three most important waiting things; the rest, the tiles and the log are out of the way', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const venter = [1, 2, 3, 4, 5].map((i) => ({ roomId: 'mail', tekst: `Ting ${i}` }));
  const out = String(renderHjem({ hilsen: 'Hej', venter, hermes: [{ tid: '2026-10-26T05:00:00.000Z', tekst: 'Byggede Dagen.' }], now: new Date('2026-10-26T12:00:00Z') }));
  for (const t of ['Ting 1', 'Ting 2', 'Ting 3']) assert.ok(!iFold(out, t), t);
  assert.ok(iFold(out, 'Ting 4') && iFold(out, 'Ting 5'));
  assert.ok(foldet(out).has('alle 5'));
  assert.ok(foldet(out).has('ordnet (1)'));
  assert.ok(iFold(out, 'Byggede Dagen.'));
  assert.match(out, /<section class="tiles kun-stor">/);
  const kort = String(renderHjem({ hilsen: 'Hej', venter: venter.slice(0, 3), hermes: [] }));
  assert.ok(!foldet(kort).has('alle 3'));
});

const kort = (over: Record<string, unknown> = {}) => ({
  id: 'k:1', type: 'tjeneste', titel: 'Cloudflare ændrer prisen', betyder: 'Din plan bliver dyrere fra 1. november.', grundlag: ['Mail fra Cloudflare 25. okt.'], kilder: ['https://example.org/cf'],
  anbefaling: 'Skift til årlig betaling.', prioritet: 3, ...over,
}) as import('../../src/rooms/hjem/kort.ts').Kort;

test('Lige nu lists cards by prioritet with betyder, anbefaling and buttons; Intet at gøre is folded', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const kortene = [
    kort({ id: 'k:lav', titel: 'Lav prioritet', prioritet: 8 }),
    kort({ id: 'k:hoej', titel: 'Høj prioritet', prioritet: 1, handling: { id: 'k:hoej:h', label: 'Skift plan', instruktion: 'Skift planen.' }, mailId: '42' }),
    kort({ id: 'k:ny', type: 'nyhed', titel: 'Ny model', prioritet: 4, prompt: 'Prøv den nye model i ShelfAtlas.' }),
  ];
  const out = String(renderHjem({ hilsen: 'Hej', venter: [{ roomId: 'mail', tekst: 'En mail' }], hermes: [], kort: kortene, intet: [{ titel: 'Nyhedsbrev', hvorfor: 'Ingen handling' }, { titel: 'Kvittering', hvorfor: 'Ingen handling' }] }));
  assert.match(out, /<h3 class="eyebrow">Lige nu<\/h3>/);
  assert.ok(out.indexOf('Høj prioritet') < out.indexOf('Ny model') && out.indexOf('Ny model') < out.indexOf('Lav prioritet'), 'ranked by prioritet');
  assert.ok(out.indexOf('Lige nu') < out.indexOf('Venter på dig'), 'above Venter på dig');
  assert.match(out, /<article data-id="kort:k:hoej" class="card kort kort-stor" data-kort-id="k:hoej" data-kort-type="tjeneste" data-datazone="privat" data-element="Kortet: Høj prioritet" data-blok="kort">/);
  assert.match(out, /Din plan bliver dyrere fra 1\. november\./);
  assert.match(out, /<div class="pending"><span class="pending-label">Anbefaling<\/span><span>Skift til årlig betaling\.<\/span>/);
  assert.match(out, /data-kort-handling="k:hoej"[^>]*>Skift plan</);
  assert.match(out, /<a class="btn" href="\/rum\/mail">Svar i Mail<\/a>/);
  assert.match(out, /data-kopier="Prøv den nye model i ShelfAtlas\."[^>]*>Kopiér prompt</);
  assert.match(out, /data-ask="Kortet: Høj prioritet"[^>]*>(?:<svg[^>]*>[\s\S]*?<\/svg>)?<span>Ret<\/span>/);
  assert.match(out, /data-luk="k:hoej"[^>]*>Luk</);
  assert.ok(!out.includes('Ikke relevant'), 'KC-0039: one Luk button, no Ikke relevant');
  assert.match(out, /<span class="vis-etiket">Tjeneste<\/span>/);
  assert.match(out, /<span class="vis-etiket">Nyhed<\/span>/);
  assert.match(out, /<details class="vis-mere">(?:(?!<\/details>)[\s\S])*Din plan bliver dyrere(?:(?!<\/details>)[\s\S])*Mail fra Cloudflare 25\. okt\./, 'KC-0059: betyder, anbefaling and grundlag sit behind Hvorfor?');
  assert.match(out, /<a href="https:\/\/example\.org\/cf"/);
  const f = foldet(out);
  assert.ok([...f.keys()].includes('ordnet (2)'));
  assert.ok(iFold(out, 'Nyhedsbrev') && iFold(out, 'Kvittering'));
  assert.match(out, /class="baand baand-ordnet altid-foldet"[\s\S]*?Vis ordnet \(2\)/);
  assert.doesNotMatch(baandDel(out, 'ordnet'), /Vis intet at gøre/, 'no fold of its own inside Ordnet');
  assert.ok(!iFold(out, 'Høj prioritet'), 'the top cards stay out of any fold');
});

test('on the phone only the top three cards show; cards 4-7 sit in the "flere kort" fold', async () => {
  const { iFold, foldet } = await import('../foldet.ts');
  // no grundlag here: the test helper does not follow nested folds
  const kortene = [1, 2, 3, 4, 5, 6, 7].map((i) => kort({ id: `k:${i}`, titel: `Kort ${i}`, prioritet: i, grundlag: [], kilder: [] }));
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: kortene, intet: [] }));
  for (const t of ['Kort 1', 'Kort 2', 'Kort 3']) assert.ok(!iFold(out, t), t);
  for (const t of ['Kort 4', 'Kort 5', 'Kort 6', 'Kort 7']) assert.ok(iFold(out, t), t);
  assert.ok(foldet(out).has('flere kort'));
  assert.ok(![...foldet(out).keys()].some((k) => k.startsWith('intet at gøre')), 'no Intet section without entries');
});

test('a card with <script> in titel/betyder/grundlag/kilder/anbefaling is escaped; only http(s) sources become links', () => {
  const out = String(renderHjem({
    hilsen: 'Hej', venter: [], hermes: [],
    kort: [kort({ titel: '<script>alert(1)</script>', betyder: '<img src=x onerror=alert(2)> fra Rikke', grundlag: ['<b>x</b>'], kilder: ['javascript:alert(3)'], anbefaling: '<i>ja</i>' })],
    intet: [{ titel: '<script>x</script>', hvorfor: '"><svg onload=1>' }],
  }));
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('<img src=x'));
  assert.ok(!out.includes('<svg onload'));
  assert.ok(!out.includes('href="javascript:'), 'only http(s) sources become links');
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('bill cards: Fortryd + Flyt when written, two ledger buttons when unclear, nothing otherwise', () => {
  const skrevet = kort({ id: 'r:1', type: 'regning', titel: 'Vercel', skrevet: { hvor: 'shelfatlas', fil: '/v/x.md' }, regnskab: { hvor: 'shelfatlas', dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20', valuta: 'USD', art: 'abonnement', emne: 'x' } });
  const uklar = kort({ id: 'r:2', type: 'regning', titel: 'Ukendt', regnskabUklart: true });
  const ingen = kort({ id: 'r:3', type: 'regning', titel: 'Intet regnskab' });
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [skrevet, uklar, ingen], intet: [] }));
  const art = (id: string) => new RegExp(`<article(?: data-id="[^"]*")? class="card kort"[^>]*>(?:(?!</article>)[\\s\\S])*?data-luk="${id}"`).exec(out)![0];
  assert.match(art('r:1'), /Skrevet i ShelfAtlas-regnskabet/);
  assert.match(art('r:1'), /data-regnskab="fortryd"/);
  assert.match(art('r:1'), /data-regnskab="flyt"[^>]*>Flyt til privat</);
  assert.match(art('r:2'), /data-regnskab="shelfatlas"/);
  assert.match(art('r:2'), /data-regnskab="privat"/);
  assert.ok(!/data-regnskab=/.test(art('r:3')));
});

test('each card has its own Hvorfor, so opening one does not open the others', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [kort({ id: 'k:1' }), kort({ id: 'k:2', titel: 'Anden' })], intet: [] }));
  assert.equal((out.match(/<details class="vis-mere">/g) ?? []).length, 2);
});

test('KC-0059: a card is read from its pictogram, one headline and its picture; the title moves behind Hvorfor', () => {
  const visuel = { ikon: 'cloud-rain', tone: 'adv', overskrift: 'Løb kl. 12 — regn fra 16', billede: { art: 'dagslinje', fra: 6, til: 22, zoner: [{ fra: '16:00', til: '19:00', slags: 'regn' }], punkter: [{ tid: '12:00', ikon: 'footprints', tekst: 'Løb', flyttetFra: '17:00' }] } };
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [kort({ id: 'k:regn', type: 'nyhed', titel: 'Regn kl. 16–19', visuel, handling: { id: 'k:regn:h', label: 'Flyt løbet', instruktion: 'x' } })], intet: [] }));
  assert.match(out, /<span class="vis-ikon tilstand-kraever" data-tone="adv"><svg class="ikon"/);
  assert.match(out, /<h3 class="vis-overskrift">Løb kl\. 12 — regn fra 16<\/h3>/);
  assert.match(out, /class="dagslinje"/);
  assert.ok(out.indexOf('class="dagslinje"') < out.indexOf('data-kort-handling="k:regn"'), 'the picture comes before the button');
  assert.match(out, /<details class="vis-mere">(?:(?!<\/details>)[\s\S])*Regn kl\. 16–19/);
  assert.match(out, /data-element="Kortet: Regn kl\. 16–19"/, 'Ret still asks about the card by its title');
});

test('KC-0059: a card without a picture still gets the pictogram of its type and its title as headline', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [kort({ id: 'r:1', type: 'regning', titel: 'Vercel-regning' })], intet: [] }));
  assert.match(out, /<span class="vis-ikon tilstand-rolig"><svg class="ikon"[^>]*><path d="M4 2v20l2-1 2 1/, 'the receipt pictogram');
  assert.match(out, /<h3 class="vis-overskrift">Vercel-regning<\/h3>/);
  assert.ok(!/class="(dagslinje|beloeb|nedtaelling|uge|prikker|personer)"/.test(out));
});

test('a card whose handling is done shows Gjort instead of the button', () => {
  const h = { id: 'k:1:h', label: 'Skift plan', instruktion: 'x' };
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [kort({ id: 'k:1', handling: h }), kort({ id: 'k:2', titel: 'Anden', handling: { ...h, id: 'k:2:h' } })], intet: [], gjort: ['k:1:h'] }));
  assert.ok(!out.includes('data-kort-handling="k:1"'));
  assert.match(out, /<span class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>Gjort<\/span>/);
  assert.match(out, /data-kort-handling="k:2"/);
});

test('Hjem own log rows get a Fortryd button while there is something to undo (and it is not too old)', () => {
  const nu = new Date('2026-10-27T12:00:00Z');
  const hermes = [
    { tid: '2026-10-27T10:00:00Z', tekst: 'Ny handling', id: 'l1', handlingId: 'h1', fortryd: 'Gør om' },
    { tid: '2026-10-27T10:01:00Z', tekst: 'Skrev Vercel', id: 'l2', handlingId: 'regnskab:r1' },
    { tid: '2026-10-27T10:02:00Z', tekst: 'Allerede fortrudt', id: 'l3', handlingId: 'h2', fortryd: 'x', fortrudt: '2026-10-27T11:00:00Z' },
    { tid: '2026-10-25T10:00:00Z', tekst: 'For gammel', id: 'l4', handlingId: 'h3', fortryd: 'x' },
    { tid: '2026-10-27T10:03:00Z', tekst: 'En anden rums linje' },
  ];
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes, now: nu }));
  assert.match(out, /data-hjem-fortryd="l1"/);
  assert.match(out, /data-hjem-fortryd="l2"/);
  assert.ok(!out.includes('data-hjem-fortryd="l3"') && !out.includes('data-hjem-fortryd="l4"'));
  assert.match(out, /class="row log-row log-undone" data-log="l3"/);
  assert.equal((out.match(/data-hjem-fortryd=/g) ?? []).length, 2);
});

test('"Skrevet i regnskab" lists written rows with a Fortryd each, folded on the phone; none → no section', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], regnskab: [
    { id: 'regning:a', hvor: 'shelfatlas', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD' },
    { id: 'regning:<b>', hvor: 'privat' },
  ] }));
  assert.match(out, /Skrevet i regnskab/);
  assert.match(out, /data-fold-navn="ordnet \(2\)"/, 'folded with Ordnet');
  assert.doesNotMatch(out, /skrevet i regnskab \(2\)/, 'no fold of its own inside Ordnet');
  assert.match(out, /data-regnskab-id="regning:a"[^]*Vercel 20,00 USD[^]*ShelfAtlas-regnskabet[^]*data-regnskab="fortryd"/);
  assert.ok(out.includes('regning:&lt;b&gt;') && !out.includes('regning:<b>'), 'ids are escaped');
  assert.equal((out.match(/data-regnskab="fortryd"/g) ?? []).length, 2);
  assert.ok(!String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [] })).includes('Skrevet i regnskab'));
});

test('KC-0043: Hos Claude Code shows three opgaver and folds the rest; a parked one shows its reason', async () => {
  const { foldet, iFold } = await import('../foldet.ts');
  const raekke = (i: number | string, over: Record<string, string> = {}) => ({ id: `o-test${i}`, status: 'sendt' as const, projekt: 'Kontrolcenter', saetning: `Opgave ${i}`, oprettet: '2026-10-29T10:00:00.000Z', ...over });
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: [raekke('p', { status: 'parkeret', grund: 'Mangler din beslutning om farven', ticket: 'KC-0050' } as Record<string, string>), raekke(1), raekke(2), raekke(3), raekke(4)] }));
  assert.match(out, /Hos Claude Code/);
  assert.match(baandDel(out, 'kraever'), /Parkeret[\s\S]*Opgave p[\s\S]*KC-0050 — Mangler din beslutning om farven/);
  for (const t of ['Opgave 1', 'Opgave 2', 'Opgave 3']) assert.ok(!iFold(out, t), t);
  assert.ok(iFold(out, 'Opgave 4'));
  assert.ok(foldet(out).has('alle 4 opgaver'));
  assert.doesNotMatch(String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [] })), /Hos Claude Code/);
});

test('KC-0043: a link in the evidence is not repeated in the text — the PR has its own link', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: [{ id: 'o-test1', status: 'faerdig', projekt: 'Kontrolcenter', saetning: 'Ret knappen', oprettet: '2026-10-29T10:00:00.000Z', bevis: 'Rettet og set på telefonen. PR https://github.com/SlambertDK/kontrolcenter/pull/21', pr: 'https://github.com/SlambertDK/kontrolcenter/pull/21' }] }));
  assert.match(out, /Rettet og set på telefonen\.(?! PR)/);
  assert.equal(out.match(/github\.com\/SlambertDK\/kontrolcenter\/pull\/21/g)?.length, 1, 'only the link itself');
});

test('KC-0052: Hjem tiles only the rooms that are relevant now, and says how to get the others', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], synlige: new Set(['hjem', 'mail']) }));
  assert.match(out, /data-room-tile="mail"/);
  assert.doesNotMatch(out, /data-room-tile="(?:hjem|skrive|dagen|nyheder|univers)"/);
  assert.match(out, /Sig i chatten, hvad du vil/);
});

test('KC-0046: Send til Claude Code is on a card only when Kuratoren suggests it, with the project named', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [
    kort({ id: 'k:sentry', titel: 'Sentry-fejl', udvikling: { projekt: 'shelfatlas' } }),
    kort({ id: 'k:cf' }),
  ] }));
  assert.match(out, /<button type="button" class="btn btn-primary" data-cc-kort="k:sentry" data-cc-titel="Sentry-fejl" data-cc-projekt="shelfatlas" data-cc-projekt-navn="ShelfAtlas">Send til Claude Code · ShelfAtlas<\/button>/);
  assert.doesNotMatch(out, /data-cc-kort="k:cf"/);
});

test('KC-0059: each waiting line and each room tile carries the room pictogram', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [{ roomId: 'mail', tekst: '4 mails venter' }, { roomId: 'univers-havvind-nord', tekst: 'Mødet kl. 10' }], hermes: [] }));
  assert.match(out, /<a data-id="venter:mail" class="row row-link" href="\/rum\/mail"><span class="rum-ikon"><svg class="ikon"/);
  assert.match(out, /href="\/rum\/univers-havvind-nord"><span class="rum-ikon"><svg class="ikon"/);
  assert.match(out, /data-room-tile="dagen"><span class="rum-ikon"><svg class="ikon"/);
});

// ---- KC-0064: one primary per card, one look per meaning ----
const primaere = (s: string): number => (s.match(/btn-primary/g) ?? []).length;
const artikel = (out: string, id: string): string => new RegExp(`<article(?: data-id="[^"]*")? class="card kort[^"]*"[^>]*data-kort-id="${id}"[\\s\\S]*?</article>`).exec(out)![0];
const MED_CC = { udvikling: { projekt: 'shelfatlas' } };
const hand = (id: string) => ({ handling: { id: `${id}:h`, label: 'Skift plan', instruktion: 'x' } });

test('KC-0064: a card has at most one btn-primary — the handling, or Send til Claude Code once the handling is done', () => {
  const kortene = [kort({ id: 'k:a', ...hand('k:a'), ...MED_CC }), kort({ id: 'k:b', ...hand('k:b'), ...MED_CC }), kort({ id: 'k:c', type: 'regning', regnskabUklart: true })];
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: kortene, intet: [], gjort: ['k:b:h'] }));
  const a = artikel(out, 'k:a'), b = artikel(out, 'k:b'), c = artikel(out, 'k:c');
  assert.equal(primaere(a), 1);
  assert.match(a, /btn btn-primary" data-kort-handling="k:a"/);
  assert.match(a, /<button type="button" class="btn" data-cc-kort="k:a"/, 'Send til Claude Code steps down');
  assert.equal(primaere(b), 1);
  assert.match(b, /tilstand-ordnet[\s\S]*Gjort/);
  assert.match(b, /btn btn-primary" data-cc-kort="k:b"/, 'Send til Claude Code becomes the one primary');
  assert.equal(primaere(c), 0, 'two equal choices, no recommendation');
  assert.match(c, /data-regnskab="shelfatlas"/);
  assert.match(c, /data-regnskab="privat"/);
});

test('KC-0066: a reverted bill (its line kept, no longer written) offers exactly one way to write it again — its ledger, as the one primary', () => {
  const linje = { dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20', valuta: 'USD', art: 'abonnement', emne: 'x' };
  const sikker = kort({ id: 'r:s', type: 'regning', regnskab: { ...linje, hvor: 'shelfatlas' } });
  const valgt = kort({ id: 'r:v', type: 'regning', regnskab: { ...linje, hvor: 'privat' }, regnskabUklart: false });
  const medHandling = kort({ id: 'r:h', type: 'regning', regnskab: { ...linje, hvor: 'shelfatlas' }, ...hand('r:h') });
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [sikker, valgt, medHandling], intet: [] }));
  const s = artikel(out, 'r:s'), v = artikel(out, 'r:v'), h = artikel(out, 'r:h');
  assert.equal((s.match(/data-regnskab=/g) ?? []).length, 1, 'one write button, no Fortryd or Flyt');
  assert.match(s, /<button type="button" class="btn btn-primary" data-regnskab="shelfatlas">Skriv i ShelfAtlas<\/button>/);
  assert.equal(primaere(s), 1);
  assert.equal((v.match(/data-regnskab=/g) ?? []).length, 1, 'a bill Henrik once placed keeps the ledger he chose');
  assert.match(v, /btn btn-primary" data-regnskab="privat">Skriv i privat</);
  assert.equal(primaere(h), 1, 'the handling stays the one primary');
  assert.match(h, /<button type="button" class="btn" data-regnskab="shelfatlas">Skriv i ShelfAtlas<\/button>/);
});

test('KC-0069: only a bill whose ledger line was undone carries data-regnskab-igen on its write button (the test world\'s marker for "skriv igen")', () => {
  const linje = { dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20', valuta: 'USD', art: 'abonnement', emne: 'x' };
  const fortrudt = kort({ id: 'r:f', type: 'regning', regnskab: { ...linje, hvor: 'privat' } });
  const foerste = kort({ id: 'r:n', type: 'regning', regnskab: { ...linje, hvor: 'privat' }, kraeverRegel: true });
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [fortrudt, foerste], intet: [], skrivIgen: ['r:f'] }));
  assert.match(artikel(out, 'r:f'), /<button type="button" class="btn btn-primary" data-regnskab="privat" data-regnskab-igen="">Skriv i privat<\/button>/);
  assert.doesNotMatch(artikel(out, 'r:n'), /data-regnskab-igen/);
  assert.doesNotMatch(String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [fortrudt], intet: [] })), /data-regnskab-igen/, 'no undone bills known = never the marker');
});

test('KC-0143: a bill not written because no rule covers it asks which rule should, and offers Henrik\'s own write as the one primary', () => {
  const linje = { dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20', valuta: 'USD', art: 'abonnement', emne: 'x' };
  const venter = kort({ id: 'r:q', type: 'regning', regnskab: { ...linje, hvor: 'privat' }, kraeverRegel: true });
  const roligt = kort({ id: 'r:o', type: 'regning', regnskab: { ...linje, hvor: 'privat' } });
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [venter, roligt], intet: [] }));
  const q = artikel(out, 'r:q');
  assert.match(q, /<p class="row-note tilstand-kraever" data-kraever-regel>Jeg må ikke bogføre dette endnu: hvilken regel skal dække det\?<\/p>/);
  assert.match(q, /btn btn-primary" data-regnskab="privat">Skriv i privat</);
  assert.equal(primaere(q), 1);
  assert.doesNotMatch(artikel(out, 'r:o'), /data-kraever-regel/);
});

test('KC-0064: a done handling shows the ordnet chip and no chip-done', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [kort({ id: 'k:1', ...hand('k:1') })], intet: [], gjort: ['k:1:h'] }));
  assert.match(out, /chip tilstand-ordnet/);
  assert.match(out, /Gjort/);
  assert.doesNotMatch(out, /chip-done/);
});

test('KC-0064: Ret uses the one ask look', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [kort({ id: 'k:1', titel: 'Elregning' })], intet: [] }));
  assert.match(out, /<button type="button" class="btn btn-ghost spoerg" data-ask="Kortet: Elregning">[\s\S]*?<span>Ret<\/span><\/button>/);
});

test('KC-0064: the Claude Code question card has one primary (the recommendation)', () => {
  const rk = { id: 'o-q1', status: 'parkeret' as const, projekt: 'Kontrolcenter', saetning: 'Vælg farve', oprettet: '2026-10-29T10:00:00.000Z', spoergsmaal: { tekst: 'Hvilken farve?', valg: ['Blå', 'Grøn', 'Rød'] } };
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: [rk] }));
  const q = /<article(?: data-id="[^"]*")? class="card kort cc-spoergsmaal"[\s\S]*?<\/article>/.exec(out)![0];
  assert.equal(primaere(q), 1);
  assert.match(q, /btn btn-primary" data-cc-svar="o-q1" data-svar="Blå"/);
  assert.match(q, /data-svar="Grøn"/);
  assert.match(q, /anbefalet/);
});

test('KC-0064: Claude Code status chips — sendt, modtaget and i-gang are rolig, parkeret kraever, faerdig ordnet', () => {
  const r = (status: string) => ({ id: `o-${status}`, status, projekt: 'Kontrolcenter', saetning: `Opgave ${status}`, oprettet: '2026-10-29T10:00:00.000Z' });
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: ['sendt', 'modtaget', 'i-gang'].map(r) as never }));
  const chip = (t: string, tekst: string) => new RegExp(`class="chip tilstand-${t}">${tekst}<`).test(out);
  assert.ok(chip('rolig', 'Sendt') && chip('rolig', 'Modtaget') && chip('rolig', 'I gang'));
  const ud2 = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: [r('parkeret'), r('faerdig')] as never }));
  assert.match(ud2, /class="chip tilstand-kraever">Parkeret</);
  assert.match(ud2, /class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>Færdig</);
  assert.doesNotMatch(out + ud2, /chip-(pending|done|accent|muted)/);
});

test('KC-0064: a parked opgave Henrik has answered no longer waits on him — its chip is rolig', () => {
  const rk = { id: 'o-svaret', status: 'parkeret', projekt: 'Kontrolcenter', saetning: 'Vælg farve', oprettet: '2026-10-29T10:00:00.000Z', svar: 'Blå' };
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: [rk] as never }));
  assert.match(out, /class="chip tilstand-rolig">Parkeret</);
  assert.doesNotMatch(out, /tilstand-kraever">Parkeret/);
});

// ---- KC-0064 phase 2: the three bands ----
const NU = new Date('2026-10-30T12:00:00Z');
const cc = (id: string, status: string, over: Record<string, unknown> = {}) => ({ id, status, projekt: 'Kontrolcenter', saetning: `Opgave ${id}`, oprettet: '2026-10-29T10:00:00.000Z', ...over }) as never;

test('KC-0064: Hjem sorts into the three bands', () => {
  const out = String(renderHjem({
    hilsen: 'Hej', now: NU,
    venter: [{ roomId: 'mail', tekst: 'Fire mails' }],
    hermes: [{ tid: '2026-10-30T11:00:00Z', tekst: 'Byggede Dagen.' }],
    kort: [kort({ id: 'k1', prioritet: 1, ...hand('k1') }), kort({ id: 'k2', titel: 'Anden', prioritet: 2, ...hand('k2') })],
    gjort: ['k2:h'],
    intet: [{ titel: 'Nyhedsbrev', hvorfor: 'x' }],
    regnskab: [{ id: 'regning:a', hvor: 'privat' }],
    claudeCode: [cc('q', 'parkeret', { spoergsmaal: { tekst: 'Hvilken farve?', valg: ['Blå'] } }), cc('s', 'sendt'), cc('f', 'faerdig')],
    igang: [{ id: 'kc_1', label: 'Mail: bygger rummet', status: 'running' }],
  }));
  const k = baandDel(out, 'kraever');
  assert.match(k, /Claude Code spørger/);
  assert.match(k, /data-kort-id="k1"/);
  assert.match(k, /Venter på dig/);
  assert.doesNotMatch(k, /data-kort-id="k2"/);
  const ig = baandDel(out, 'igang');
  assert.match(ig, /data-cc-opgave="s"/);
  assert.match(ig, /Mail: bygger rummet/);
  const o = baandDel(out, 'ordnet');
  for (const t of ['data-kort-id="k2"', 'Skrevet i regnskab', 'Intet at gøre', 'data-cc-opgave="f"', 'Hermes har gjort']) assert.ok(o.includes(t), t);
  assert.doesNotMatch(out, /data-cc-opgave="q"/);
  assert.equal(taelleTekst(out), '3 venter på dig · 2 i gang · 5 ordnet');
});

test('KC-0064: exactly one large card — the first by prioritet with an open handling', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], intet: [], kort: [
    kort({ id: 'a', titel: 'A', prioritet: 2, anbefaling: 'Skift til årlig.', ...hand('a') }),
    kort({ id: 'b', titel: 'B', prioritet: 1 }),
    kort({ id: 'c', titel: 'C', prioritet: 3, anbefaling: 'Vent.', ...hand('c') }),
  ] }));
  assert.equal(out.match(/kort-stor/g)?.length, 1);
  const art = (id: string) => new RegExp(`<article(?: data-id="[^"]*")? class="card kort[^"]*" data-kort-id="${id}"[\\s\\S]*?</article>`).exec(out)![0];
  assert.match(art('a'), /^<article data-id="kort:a" class="card kort kort-stor"/);
  assert.ok(art('a').indexOf('class="pending"') >= 0 && art('a').indexOf('class="pending"') < art('a').indexOf('<details'), 'anbefaling on the face');
  assert.match(art('a'), /vis-ikon tilstand-kraever/);
  assert.ok(art('c').indexOf('class="pending"') > art('c').indexOf('<details'), 'c keeps its anbefaling behind Hvorfor?');
});

test('KC-0064: nothing pressing, nothing large', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], intet: [], gjort: ['a:h'], kort: [kort({ id: 'a', ...hand('a') })] }));
  assert.doesNotMatch(out, /kort-stor/);
  assert.doesNotMatch(out, /data-baand="kraever"/);
});

test('KC-0064: Fortryd puts a card back in Kræver dig', () => {
  const k = [kort({ id: 'a', ...hand('a') })];
  const klar = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], intet: [], kort: k, gjort: ['a:h'] }));
  assert.match(baandDel(klar, 'ordnet'), /data-kort-id="a"/);
  assert.doesNotMatch(baandDel(klar, 'kraever'), /data-kort-id="a"/);
  const fortrudt = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], intet: [], kort: k, gjort: [] }));
  assert.match(baandDel(fortrudt, 'kraever'), /data-kort-id="a"/);
  assert.doesNotMatch(baandDel(fortrudt, 'ordnet'), /data-kort-id="a"/);
});

test('KC-0064: a parked opgave with Henrik\'s answer is I gang; without a question it is Kræver dig', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], claudeCode: [cc('p1', 'parkeret', { svar: 'Blå' }), cc('p2', 'parkeret', { grund: 'Mangler adgang' })] }));
  assert.match(baandDel(out, 'igang'), /data-cc-opgave="p1"/);
  assert.match(baandDel(out, 'kraever'), /Claude Code parkerede[\s\S]*data-cc-opgave="p2"/);
  assert.doesNotMatch(baandDel(out, 'kraever'), /data-cc-opgave="p1"/);
});

test('KC-0064: the tiles stay below the bands, laptop only', () => {
  const out = String(renderHjem({ hilsen: 'Hej', venter: [{ roomId: 'mail', tekst: 'x' }], hermes: [], intet: [{ titel: 'y', hvorfor: 'z' }] }));
  assert.ok(out.indexOf('<section class="tiles kun-stor">') > out.lastIndexOf('<!--/baand-->'));
});

test('KC-0064 phase 3: every Hjem band element carries its stable id', () => {
  const out = String(renderHjem({
    hilsen: 'Hej', now: NU,
    venter: [{ roomId: 'mail', tekst: 'Fire mails' }],
    hermes: [{ tid: '2026-10-30T11:00:00Z', tekst: 'Byggede Dagen.', id: 'l-1' }],
    kort: [kort({ id: 'k1', prioritet: 1, ...hand('k1') }), kort({ id: 'k2', titel: 'Anden', prioritet: 2, ...hand('k2') })],
    gjort: ['k2:h'],
    intet: [{ titel: 'Nyhedsbrev', hvorfor: 'x' }],
    regnskab: [{ id: 'regning:a', hvor: 'privat' }],
    claudeCode: [cc('q', 'parkeret', { spoergsmaal: { tekst: 'Hvilken farve?', valg: ['Blå'] } }), cc('p', 'parkeret', { grund: 'x' }), cc('s', 'sendt'), cc('f', 'faerdig')],
    igang: [{ id: 'kc_1', label: 'Mail: bygger rummet', status: 'running' }],
  }));
  for (const id of ['kort:k1', 'kort:k2', 'venter:mail', 'cc:q', 'cc:p', 'cc:s', 'cc:f', 'regnskab:regning:a', 'intet:Nyhedsbrev', 'log:l-1', 'run:kc_1']) {
    assert.ok(out.includes(`data-id="${id}"`), id);
  }
});

test('KC-0064 phase 3: Hjem tiles carry rum:<id> and every id is unique', () => {
  const out = String(renderHjem({
    hilsen: 'Hej', now: NU,
    venter: [{ roomId: 'mail', tekst: 'Fire mails' }, { roomId: 'dagen', tekst: 'En anbefaling' }],
    hermes: [{ tid: '2026-10-30T11:00:00Z', tekst: 'Byggede Dagen.' }, { tid: '2026-10-30T11:00:00Z', tekst: 'Byggede Dagen.' }],
    kort: [kort({ id: 'k1', prioritet: 1, ...hand('k1') }), kort({ id: 'k2', titel: 'Anden', prioritet: 2, ...hand('k2') })],
    gjort: ['k2:h'],
    claudeCode: [cc('q', 'parkeret', { spoergsmaal: { tekst: 'Hvilken farve?', valg: ['Blå'] } }), cc('p', 'parkeret', { grund: 'x' }), cc('s', 'sendt'), cc('f', 'faerdig')],
  }));
  for (const id of ['rum:dagen', 'rum:mail', 'rum:skrive', 'rum:nyheder']) assert.ok(ider(out).includes(id), id);
  assert.deepEqual(dubletter(out), []);
});

// KC-0088: the next appointment sits under the greeting; nothing is shown when there is none.
test('renderHjem shows the next appointment under the greeting, and nothing without one', () => {
  const now = new Date('2026-10-30T09:10:00Z');
  const med = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], now, naeste: { titel: 'Havvind Nord', start: '2026-10-30T13:00:00Z', slut: '2026-10-30T14:00:00Z' } }));
  assert.match(med, /<h1>Hej<\/h1>\s*<p class="naeste" data-naeste[^>]*>Næste: <span class="naeste-titel">Havvind Nord<\/span> kl\. 14\.00 · <span class="naeste-om">om 3 t 50 min<\/span>/);
  const uden = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], now }));
  assert.doesNotMatch(uden, /naeste/);
  assert.doesNotMatch(uden, /ingen aftaler/i);
});

test('KC-0096: every card has a quiet Senere next to Ret and Luk; its two choices sit hidden in the card, "I aften" only before 17.00', () => {
  const k = kort({ id: 'k:1' });
  const foer = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [k], now: new Date('2026-10-27T12:00:00Z') })); // 13.00 Copenhagen
  assert.match(foer, /<button type="button" class="btn btn-ghost" data-senere-aabn="k:1" aria-expanded="false">Senere<\/button>/);
  const art = /<article[^>]*data-kort-id="k:1"[\s\S]*?<\/article>/.exec(foer)![0];
  assert.ok(art.indexOf('<span>Ret</span>') < art.indexOf('data-senere-aabn') && art.indexOf('data-senere-aabn') < art.indexOf('data-luk="k:1"'), 'Ret · Senere · Luk');
  assert.match(art, /<div class="senere-valg" data-senere-valg hidden[^>]*>/);
  assert.match(art, /data-senere="aften" data-senere-kort="k:1">I aften</);
  assert.match(art, /data-senere="morgen" data-senere-kort="k:1">I morgen</);
  const sent = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [k], now: new Date('2026-10-27T16:00:00Z') })); // 17.00 Copenhagen
  assert.ok(!sent.includes('data-senere="aften"'), 'after 17.00 only I morgen is offered');
  assert.match(sent, /data-senere="morgen"/);
});

// ---- KC-0099: nothing waits — a calm "Alt er ordnet" with what comes next ----
test('KC-0099: nothing waits — "Alt er ordnet" and the next thing today', () => {
  const nu = new Date('2026-10-26T09:00:00Z'); // 10.00 Copenhagen
  const out = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], now: nu, venterIalt: 0, naeste: { titel: 'Havvind <Nord>', start: '2026-10-26T10:00:00Z', slut: '2026-10-26T11:00:00Z' } }));
  assert.match(out, /<section class="card alt-ordnet"[^>]*>[\s\S]*?<h3 class="vis-overskrift">Alt er ordnet<\/h3>/);
  assert.match(out, /Det næste i dag er Havvind &lt;Nord&gt; kl\. 11\.00\./);
  const fri = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], now: nu, venterIalt: 0 }));
  assert.match(fri, /Hermes holder øje og siger til, når noget kræver dig\./);
});

test('KC-0099: "Alt er ordnet" only when nothing waits anywhere', () => {
  const nu = new Date('2026-10-26T09:00:00Z');
  const venter = String(renderHjem({ hilsen: 'Hej', venter: [{ roomId: 'mail', tekst: 'Mail: x' }], hermes: [], now: nu, venterIalt: 1 }));
  assert.doesNotMatch(venter, /alt-ordnet/);
  const andetSted = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], now: nu, venterIalt: 2 }));
  assert.doesNotMatch(andetSted, /alt-ordnet/, 'a waiting count elsewhere (a univers) is not "alt er ordnet"');
});

// ---------- KC-0115: the situation selects Nu's element kinds; decisions always show ----------
import { NU_ELEMENTER, SITUATIONER, SITUATION_IDER } from '../../src/situation/regler.ts';
import type { Kort as NuKort } from '../../src/rooms/hjem/kort.ts';

const nuKort = (id: string): NuKort => ({ id, type: 'tjeneste', titel: `Titel ${id}`, betyder: `Betyder ${id}`, grundlag: [], kilder: [], anbefaling: 'Gør noget', prioritet: 5, zone: 'privat' });
const fuldNu = (situation?: (typeof SITUATION_IDER)[number]) => String(renderHjem({
  hilsen: 'Hej', now: new Date('2026-10-26T09:00:00Z'),
  venter: [{ roomId: 'mail', tekst: 'To mails venter.' }],
  kort: [nuKort('k1')],
  hermes: [{ tid: '2026-10-26T08:00:00Z', tekst: 'Byggede Dagen.' }],
  igang: [{ id: 'kc_1', label: 'Mail: bygger rummet', status: 'running' }],
  naeste: { titel: 'Havvind Nord', start: '2026-10-26T13:00:00Z', slut: '2026-10-26T14:00:00Z' },
  moede: { titel: 'Arena <kickoff>', url: '/moede/arena/m1', slut: '2026-10-26T10:00:00Z' },
  ...(situation ? { situation } : {}),
}));
const MARKER: Record<(typeof NU_ELEMENTER)[number], RegExp> = {
  naeste: /data-naeste /, moede: /data-nu-moede/, igang: /data-baand="igang"/, ordnet: /data-baand="ordnet"/, fliser: /data-room-tile="/,
};

test('KC-0115: every situation selects only kinds from the closed list', () => {
  for (const s of SITUATION_IDER) for (const e of SITUATIONER[s].elementer) assert.ok((NU_ELEMENTER as readonly string[]).includes(e), `${s}: ${e}`);
});

test('KC-0115: Nu shows exactly the kinds the situation selected, and the decisions always', () => {
  for (const s of SITUATION_IDER) {
    const out = fuldNu(s);
    const valgt: readonly string[] = SITUATIONER[s].elementer;
    for (const e of NU_ELEMENTER) assert.equal(MARKER[e].test(out), valgt.includes(e), `${s}: ${e}`);
    assert.match(out, /data-baand="kraever"/, `${s}: Kræver dig`);
    assert.match(out, /data-kort-id="k1"/, `${s}: the waiting card`);
    assert.match(out, /To mails venter\./, `${s}: what waits in a room`);
  }
});

test('KC-0115: in a meeting Nu shows the meeting in I gang with a way into it, escaped', () => {
  const out = fuldNu('moede');
  assert.match(out, /data-nu-moede[^>]*>[\s\S]*?Arena &lt;kickoff&gt;[\s\S]*?href="\/moede\/arena\/m1"/);
  assert.doesNotMatch(out, /Arena <kickoff>/);
});

test('KC-0115: without a situation Nu behaves as in the day; Alt er ordnet still shows in a meeting', () => {
  assert.equal(fuldNu(), fuldNu('dagen'));
  const tom = String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], venterIalt: 0, situation: 'moede', now: new Date('2026-10-26T09:00:00Z') }));
  assert.match(tom, /class="card alt-ordnet"/);
});

test('KC-0138: a card on a message names its sender and channel, says Clawco only reads, and has no handling button', () => {
  const k = kort({ id: 'besked:ella', type: 'familie', titel: 'Ella spørger om cyklen', beskedId: 'b-0123456789abcdef', besked: { kanal: 'signal', afsender: 'Ella (datter) <b>' } });
  const a = artikel(String(renderHjem({ hilsen: 'Hej', venter: [], hermes: [], kort: [k], intet: [] })), 'besked:ella');
  assert.match(a, /data-besked-kanal="signal"/);
  assert.match(a, /Besked fra Ella \(datter\) &lt;b&gt; på Signal/);
  assert.match(a, /Clawco læser kun og svarer aldrig selv\. Svar selv i Signal\./);
  assert.ok(!/data-kort-handling/.test(a));
});

// ---- KC-0147: the day's count of what required Henrik reads the band itself ----
test('KC-0147: kraeverIder is exactly the element ids of the Kræver dig band that renderHjem draws', async () => {
  const { kraeverIder } = await import('../../src/rooms/hjem/render.ts');
  const d = {
    hilsen: 'Hej', now: NU,
    venter: [{ roomId: 'mail', tekst: 'Mail: elektrikeren' }, { roomId: 'mail', tekst: 'Mail: tilbuddet' }],
    hermes: [],
    kort: [kort({ id: 'k1', prioritet: 1, ...hand('k1') }), kort({ id: 'k2', titel: 'Anden', prioritet: 2, ...hand('k2') })],
    gjort: ['k2:h'], // k2 is done: it left the band
    claudeCode: [cc('q', 'parkeret', { spoergsmaal: { tekst: 'Hvilken farve?', valg: ['Blå'] } }), cc('p', 'parkeret', { grund: 'x' }), cc('s', 'sendt')],
    reglerFejl: { hvorfor: 'x', fil: 'regler.md' },
  };
  const ids = kraeverIder(d);
  // What the page draws in the band, by data-id.
  const band = baandDel(String(renderHjem(d)), 'kraever');
  const tegnet = [...band.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...ids].sort(), ['cc:p', 'cc:q', 'kort:k1', 'regler:ulaeselig', 'venter:mail:Mail: elektrikeren', 'venter:mail:Mail: tilbuddet'].sort());
  assert.equal(tegnet.length, ids.length, 'one id per element drawn in the band');
  for (const id of ['cc:p', 'cc:q', 'kort:k1', 'regler:ulaeselig']) assert.ok(tegnet.includes(id), id);
});

test('KC-0147: a waiting row keeps its identity when another row above it goes away; the band can be empty', async () => {
  const { kraeverIder } = await import('../../src/rooms/hjem/render.ts');
  const begge = kraeverIder({ hilsen: 'Hej', hermes: [], venter: [{ roomId: 'mail', tekst: 'Mail: a' }, { roomId: 'mail', tekst: 'Mail: b' }] });
  const kunB = kraeverIder({ hilsen: 'Hej', hermes: [], venter: [{ roomId: 'mail', tekst: 'Mail: b' }] });
  assert.ok(begge.includes(kunB[0]!));
  assert.deepEqual(kraeverIder({ hilsen: 'Hej', hermes: [], venter: [] }), []);
});

test('KC-0147: Nu shows the week line only when given one, inside the page and not in the band', async () => {
  const { ugeVisning, ugeLinje } = await import('../../src/tillid/dagstal.ts');
  const v = ugeVisning([{ uge: '2026-10-19', nr: 43, dage: 7, snit: 9, fortryd: 1 }, { uge: '2026-10-26', nr: 44, dage: 7, snit: 6, fortryd: 1 }], 'sidste')!;
  const med = String(renderHjem({ hilsen: 'Hej', hermes: [], venter: [{ roomId: 'mail', tekst: 'x' }], ugetal: ugeLinje(v) }));
  assert.match(med, /data-ugetal="linje">Sidste uge krævede i snit 6 ting dig om dagen/);
  assert.doesNotMatch(String(renderHjem({ hilsen: 'Hej', hermes: [], venter: [] })), /data-ugetal/);
});
