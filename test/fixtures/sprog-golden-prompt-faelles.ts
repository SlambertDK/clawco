// KC-0241: fixed inputs for every shared part of a Hermes prompt (the agent folder's builder, the run registry's two
// lines and its correction run, the rules block, the block catalog and the visual rules, the direct model's no-tools
// line and Kuratoren's builders). `faelles(DA)` is rendered without a chosen language and inside medSprog('da', ...) and
// held byte for byte to the files in test/fixtures/sprog-prompt-faelles/, captured from the code BEFORE the words moved
// into the language tables. `faelles(EN)` has the same cases over English content, so an English render shows only the
// words the code itself owns. Change a golden only when the Danish copy changes on purpose.

import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, MODEL_TEST, omslutData, PEGER, pegerTekst, GRAENSER, SPROG } from '../../src/agent/prompt.ts';
import { UDEN_VAERKTOEJ } from '../../src/agent/direkte.ts';
import { omMennesker, omProfil, createRunRegistry } from '../../src/runs.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { SvarFejl } from '../../src/svarfejl.ts';
import { VERBER } from '../../src/graenser/verber.ts';
import { reglerTilPrompt, REGELFORSLAG_TEKST, REGLER_OVERSKRIFT } from '../../src/tillid/prompt.ts';
import { parseRegler } from '../../src/tillid/regler.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';
import { katalogTekst } from '../../src/shell/katalog.ts';
import { visuelRegler } from '../../src/shell/visuel.ts';
import { buildKuratorRun, type KuratorInput } from '../../src/kurator/prompt.ts';
import { buildKortFortrydRun, buildKortHandlingRun, buildLaerRun, buildSkjultRun } from '../../src/kurator/kortprompt.ts';
import type { Handling, Kort, Lukning } from '../../src/rooms/hjem/kort.ts';
import type { KuratorBesked } from '../../src/rooms/module.ts';
import type { DataSegment } from '../../src/agent/udtroet.ts';

/** The content a case is built from: Danish for the goldens, English for the "no Danish left" checks. */
export type Indhold = {
  opgave: string; regler: string; betroet: string; afledt: string; utroet: string; kontekst: string; handlingTekst: string; fortrydTekst: string;
  mdRegler: string; ulaeselig: string;
  kort: Kort; mail: { emne: string; fra: string }; nyhed: string; lukket: { titel: string; grund: string }; besked: string; samtale: string;
  handling: { label: string; instruktion: string }; grund: string; skjult: string; reglerTitel: string;
};

const NOW = new Date('2026-11-01T10:00:00Z');
const G = 'aaaaaaaaaaaaaaaaaaaaaaaa';
/** A run's random boundary (24 hex chars) is not part of the words. */
const norm = (s: string): string => s.replace(/\b[0-9a-f]{24}\b/g, 'GRAENSE');
const spec = (s: { instructions: string; input: string }): string => `=== instructions ===\n${norm(s.instructions)}\n=== input ===\n${norm(s.input)}\n`;

const mdRegler = (t: [string, string, string, string]): string => `naeste-id: R-0005

## R-0001 · ${t[0]}
- trin: 1
- gaelder: mail / indbakke
- oprindelse: import 2026-10-31
- status: aktiv

${t[3]}

## R-0002 · ${t[1]}
- trin: 2
- gaelder: mail / regning
- oprindelse: import 2026-10-31
- status: aktiv

## R-0003 · ${t[2]}
- trin: 3
- gaelder: kalender
- oprindelse: haand 2026-10-31
- status: pause

## R-0004 · Broken
- trin: grænse
- gaelder: mail
- oprindelse: haand 2026-10-31
- status: aktiv
`;

export const DA: Indhold = {
  opgave: 'OPGAVEN', regler: 'REGLERNE', betroet: 'Hej\n  med dig', afledt: 'Flyt mailen', utroet: 'Fra nettet', kontekst: 'Mødet kl. 10', handlingTekst: 'Arkivér mailen.', fortrydTekst: 'Flyt mailen tilbage.',
  mdRegler: mdRegler(['Sortér mail i mapper', 'Regnskabslinjer for abonnementer', 'På pause', 'Flyt fra Indbakken til mapperne. Aldrig papirkurven.']), ulaeselig: 'filen kunne ikke åbnes',
  kort: { id: 'mail:folders-handling:242', type: 'familie', titel: 'Rikke beder om hjælp', betyder: 'Rikke vil have svar inden fredag.', grundlag: ['mail fra Rikke'], kilder: ['mail fra Rikke'], anbefaling: 'Svar i dag', prioritet: 1, gyldigTil: '2026-10-30' },
  mail: { emne: 'Kan du hjælpe?', fra: 'Rikke' }, nyhed: 'PHP-sårbarhed rammer mange servere', lukket: { titel: 'Pakken er hentet', grund: 'Maja hentede den' },
  besked: 'Kan du hente Ella kl. 15?', samtale: 'Maja', handling: { label: 'Arkivér', instruktion: 'Arkivér mailen.' }, grund: 'Allerede klaret', skjult: 'Nyhedsbrev', reglerTitel: 'Nyhedsbreve',
};

export const EN: Indhold = {
  opgave: 'THE TASK', regler: 'THE RULES', betroet: 'Hello\n  there', afledt: 'Move the mail', utroet: 'From the web', kontekst: 'Meeting at 10', handlingTekst: 'Archive the mail.', fortrydTekst: 'Move the mail back.',
  mdRegler: mdRegler(['Sort mail into folders', 'Ledger lines for subscriptions', 'Paused', 'Move from the inbox to the folders. Never the bin.']), ulaeselig: 'the file could not be opened',
  kort: { id: 'mail:folders-handling:242', type: 'familie', titel: 'Alex asks for help', betyder: 'Alex wants an answer by Friday.', grundlag: ['mail from Alex'], kilder: ['mail from Alex'], anbefaling: 'Answer today', prioritet: 1, gyldigTil: '2026-10-30' },
  mail: { emne: 'Can you help?', fra: 'Alex' }, nyhed: 'A PHP vulnerability hits many servers', lukket: { titel: 'The parcel is collected', grund: 'Sam collected it' },
  besked: 'Can you pick up Ella at 3?', samtale: 'Sam', handling: { label: 'Archive', instruktion: 'Archive the mail.' }, grund: 'Already done', skjult: 'Newsletter', reglerTitel: 'Newsletters',
};

const lukket = (i: Indhold, zone: 'privat' | 'arbejde' | 'husstand'): Lukning => ({ id: `mail:inbox:3:${zone}`, titel: i.lukket.titel, grund: i.lukket.grund, dato: '2026-10-30', zone });
const besked = (i: Indhold, zone: 'privat' | 'arbejde' | 'husstand'): KuratorBesked => ({ id: 'b-0123456789abcdef', kanal: 'signal', samtaleNavn: i.samtale, afsender: { navn: i.samtale, personId: 'p1' }, tid: '2026-11-01T09:40:00.000Z', tekst: i.besked, zone });
const kortI = (i: Indhold, zone: 'privat' | 'arbejde' | 'husstand'): Kort => ({ ...i.kort, zone, ...(zone === 'privat' ? { skrevet: { hvor: 'privat' as const, fil: 'x.md' }, udvikling: { projekt: 'clawco' } } : {}) });

export type Tilfaelde = Record<string, () => string | Promise<string>>;

/** `engelskProfil` adds the lines of a profile that chose English (no Danish golden exists for them: they changed on purpose). */
export function faelles(i: Indhold, engelskProfil = false): Tilfaelde {
  const segmenter: DataSegment[] = [
    { kilde: 'henrik', zone: 'privat', tillid: 'betroet', tekst: i.betroet },
    { kilde: 'handling', zone: 'privat', tillid: 'afledt', tekst: i.afledt },
    { kilde: 'web', zone: 'privat', tillid: 'utroet', tekst: i.utroet },
  ];
  const kuratorPrivat: KuratorInput = {
    mails: [{ id: '242', mappe: 'Folders/Handling', emne: i.mail.emne, fra: i.mail.fra, modtaget: '2026-10-31T08:00:00Z' }, { id: '7', mappe: 'Inbox', emne: i.mail.emne, fra: '', modtaget: '2026-10-31T09:00:00Z' }],
    nyheder: [i.nyhed], aabne: [kortI(i, 'privat')], lukket: [lukket(i, 'privat')], dyb: false, now: NOW, stier: { vault: '/vault', personer: '/people' }, beskeder: [besked(i, 'privat')],
  };
  const kuratorZone = (zone: 'arbejde' | 'husstand', medBeskeder: boolean): KuratorInput => ({
    mails: [], nyheder: null, aabne: [kortI(i, zone)], lukket: [lukket(i, zone)], dyb: false, now: NOW, stier: { vault: '' }, ...(medBeskeder ? { beskeder: [besked(i, zone)] } : {}), zone,
  });
  const ok: ReglerLaest = { tilstand: 'ok', saet: parseRegler(i.mdRegler), aendretUdenfor: false };
  const regelHan = ok.tilstand === 'ok' ? ok.saet.regler[0]! : undefined;
  const handling = i.handling as Handling;
  const retur = async (profil: { navn: string; sprog: 'da' | 'en'; husstand: 'alene' | 'husstand' } | null, personer?: string): Promise<string> => {
    const hermes = createFakeAgent({ answer: (r) => (r.input === 'x' ? 'forkert' : 'ok') });
    const runs = createRunRegistry(hermes, { profil: () => profil, ...(personer ? { personer } : {}) });
    await runs.start({ kind: 'chat', zone: 'privat', spec: { input: 'x', instructions: i.opgave }, onDone: async (o) => { if (o === 'forkert') throw new SvarFejl(i.grund); return {}; } }).finished;
    return hermes.calls.map((c) => spec(c)).join('\n');
  };
  const t: Tilfaelde = {
    'konstanter': () => [GRAENSER, SPROG, PEGER, REGLER_OVERSKRIFT, REGELFORSLAG_TEKST, UDEN_VAERKTOEJ].join('\n---\n'),
    'modeltest': () => `${MODEL_TEST.instructions}\n${MODEL_TEST.input}`,
    'bygg-uden': () => spec(byggPrompt({ rum: 'x', zone: 'privat', opgave: i.opgave, data: [segmenter[0]!], graense: G })),
    'bygg-fuld': () => spec(byggPrompt({ rum: 'x', zone: 'arbejde', opgave: i.opgave, katalog: true, regler: i.regler, data: segmenter, graense: G })),
    'bygg-husstand-uden-data': () => spec(byggPrompt({ rum: 'x', zone: 'husstand', opgave: i.opgave, data: [], graense: G })),
    'omslut-data': () => { const o = omslutData(segmenter, G); return `${o.input}\n---\n${o.linje}`; },
    'omslut-betroet': () => { const o = omslutData([segmenter[0]!], G); return `${o.input}\n---\n${String(o.linje)}`; },
    'peger-henrik': () => pegerTekst('Henrik'),
    'peger-brugeren': () => pegerTekst('Brugeren'),
    'peger-standard': () => pegerTekst(),
    'element-henrik': () => JSON.stringify(elementSegment(i.kontekst, 'privat'), null, 1),
    'element-brugeren': () => JSON.stringify(elementSegment(i.kontekst, 'husstand', 'Brugeren'), null, 1),
    'element-uden': () => JSON.stringify(elementSegment(undefined, 'privat')),
    'fortryd': () => fortrydOpgave(),
    'verb-ukendt': () => handlingsOpgave('ukendt-verb'),
    'verb-tom': () => handlingsOpgave(''),
    'om-mennesker-uden': () => omMennesker(),
    'om-mennesker-med': () => omMennesker('/people'),
    'om-profil-da-alene': () => omProfil({ navn: 'Alma', sprog: 'da', husstand: 'alene' }),
    'om-profil-da-husstand': () => omProfil({ navn: 'Alma', sprog: 'da', husstand: 'husstand' }),
    'om-profil-ingen': () => `[${omProfil(null)}]`,
    'retur-uden-profil': () => retur(null, '/people'),
    'retur-profil-da': () => retur({ navn: 'Alma', sprog: 'da', husstand: 'husstand' }),
    'regler-ingen': () => reglerTilPrompt(undefined),
    'regler-mangler': () => reglerTilPrompt({ tilstand: 'mangler' }),
    'regler-ulaeselig': () => reglerTilPrompt({ tilstand: 'ulaeselig', hvorfor: i.ulaeselig, aendretUdenfor: false }),
    'regler-aktive': () => reglerTilPrompt(ok),
    'regler-ingen-aktive': () => reglerTilPrompt({ tilstand: 'ok', saet: { naesteId: 1, regler: [], ugyldige: [] }, aendretUdenfor: false }),
    'katalog': () => katalogTekst(),
    'visuel': () => visuelRegler(),
    'kurator-privat-fuld': () => spec(buildKuratorRun(kuratorPrivat)),
    'kurator-privat-dyb': () => spec(buildKuratorRun({ mails: [], nyheder: null, aabne: [], dyb: true, now: NOW, stier: { vault: '' }, mailKilde: 'forbindelse' })),
    'kurator-privat-tom-dyb': () => spec(buildKuratorRun({ mails: [], nyheder: [], aabne: [], lukket: [{ ...lukket(i, 'privat'), grund: '' }], dyb: true, now: NOW, stier: { vault: '/vault' } })),
    'kurator-arbejde-tom': () => spec(buildKuratorRun({ mails: [], nyheder: null, aabne: [], lukket: [{ ...lukket(i, 'arbejde'), grund: '' }], dyb: false, now: NOW, stier: { vault: '' }, zone: 'arbejde' })),
    'kurator-arbejde': () => spec(buildKuratorRun(kuratorZone('arbejde', true))),
    'kurator-husstand-uden-beskeder': () => spec(buildKuratorRun(kuratorZone('husstand', false))),
    'kort-handling': () => spec(buildKortHandlingRun(i.kort, handling, NOW)),
    'kort-fortryd': () => spec(buildKortFortrydRun(i.fortrydTekst, NOW)),
    'laer-uden': () => spec(buildLaerRun(i.kort, i.grund, NOW)),
    'laer-med': () => spec(buildLaerRun(i.kort, i.grund, NOW, '/people', { regler: ok })),
    'skjult-uden-regel': () => spec(buildSkjultRun({ titel: i.skjult, kilde: i === DA ? 'kuratoren' : 'andet' }, undefined, NOW, undefined)),
    'skjult-med-regel': () => spec(buildSkjultRun({ titel: i.skjult, kilde: 'andet' }, regelHan, NOW, ok)),
  };
  if (engelskProfil) {
    t['om-profil-en-alene'] = () => omProfil({ navn: 'Alma', sprog: 'en', husstand: 'alene' });
    t['om-profil-en-husstand'] = () => omProfil({ navn: 'Alma', sprog: 'en', husstand: 'husstand' });
  }
  if (engelskProfil) t['retur-profil-en'] = () => retur({ navn: 'Alma', sprog: 'en', husstand: 'husstand' }, '/people');
  for (const v of VERBER) t[`verb-${v}`] = () => handlingsOpgave(v);
  return t;
}
