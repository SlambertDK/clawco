// KC-0170: fixed inputs for the shell and Start, rendered without a chosen language. The files in
// test/fixtures/sprog/ were captured from these inputs BEFORE the strings moved into src/shell/tekster.ts;
// test/shell/tekster.test.ts holds the renders to them byte for byte (the document head is left out, so a
// change to font or meta links does not count). Change a golden only when the Danish copy changes on purpose.

import { shell } from '../../src/shell/layout.ts';
import { baand, igangGruppe, afvistLinje } from '../../src/shell/sprog.ts';
import { html } from '../../src/shell/html.ts';
import { renderStart, type StartVisning } from '../../src/rooms/start/render.ts';
import { alleTrin, type ModelSyn } from '../../src/rooms/start/trin.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

const NU = new Date('2026-10-26T09:00:00.000Z');
const ejer = { id: FAMILIE.ejer.id, login: null, navn: FAMILIE.ejer.navn, rolle: 'ejer' as const };
const partner = { id: FAMILIE.partner.id, login: null, navn: FAMILIE.partner.navn, rolle: 'medlem' as const };

/** The head is dropped: the body is what the user reads. */
export const krop = (doc: string): string => doc.replace(/<head>[\s\S]*<\/head>/, '<head/>');

export const SHELL_FULD = (): string => krop(String(shell({
  roomId: 'dagen',
  hermesStatus: 'Holder øje med kalenderen',
  venter: { dagen: 1, mail: 3, 'univers-have': 2 },
  main: html`<p id="m">Indhold</p>`,
  kontekst: 'Mødet kl. 10',
  chat: [{ id: 'c1', tid: '2026-10-26T06:00:00.000Z', fra: 'hermes', tekst: 'Godmorgen <b>' }, { id: 'c2', tid: '2026-10-26T06:01:00.000Z', fra: 'henrik', tekst: 'Tak' }],
  stemme: 'samtale',
  live: true,
  univers: [{ id: 'have', navn: 'Haven' }],
  synlige: new Set(['hjem', 'dagen', 'mail', 'univers', 'univers-have', 'husstand']),
  person: ejer,
  husstand: [ejer, partner],
  pause: { pause: true, tid: '2026-10-26T08:00:00.000Z', person: FAMILIE.partner.id },
  hjaelp: { href: 'https://konto.example.com/hjaelp' },
  stoette: { adgang: { udloeber: '2026-10-26T12:00:00.000Z', grund: 'Mailen hænger' }, slaaTil: '/api/stoette/til', slaaFra: '/api/stoette/fra' },
})));

export const SHELL_MINIMAL = (): string => krop(String(shell({
  roomId: 'start',
  hermesStatus: 'Klar',
  venter: {},
  main: html``,
  chat: [],
  person: partner,
  stoette: { adgang: null, slaaTil: '/api/stoette/til', slaaFra: '/api/stoette/fra' },
})));

export const SHELL_STOETTE_FRA = (): string => krop(String(shell({
  roomId: 'hjem', hermesStatus: 'Klar', venter: {}, main: html``, chat: [], stemme: 'lyt',
  stoette: { adgang: null, slaaTil: '/api/stoette/til', slaaFra: '/api/stoette/fra' },
})));

export const BAAND = (): string => String(baand({
  kraever: [{ titel: 'Svar', form: 'kort', elementer: [{ id: 'k:1', html: html`<article>Et</article>` }] }],
  indhold: html`<p>Midt</p>`,
  igang: [igangGruppe([{ id: 'r1', label: 'Sorterer mail', status: 'running' }, { id: 'r2', label: 'Bygger Dagen', status: 'queued' }])],
  ordnet: [{ titel: 'Gjort', form: 'raekker', elementer: [{ id: 'o:1', html: html`<div>To</div>` }] }],
})) + String(baand({ kraever: [], igang: [], ordnet: [] })) + String(afvistLinje('Betal regningen', 'Clawco betaler aldrig.'));

const rev = { lille: 'anthropic:claude-haiku-4-5', taenker: 'anthropic:claude-sonnet-4-5' };
const syn = (ok: boolean): ModelSyn => ({
  udbyder: 'anthropic',
  modeller: { lille: 'claude-haiku-4-5', taenker: 'claude-sonnet-4-5' },
  test: { lille: { ok, tid: NU.toISOString(), ms: 812, rev: rev.lille, ...(ok ? {} : { fejl: 'model-noegle' }) }, taenker: { ok: true, tid: NU.toISOString(), ms: 1460, rev: rev.taenker } },
  rev,
});

const trin = (status: 'ikke-startet' | 'klaret') => alleTrin().map((t, i) => ({ trin: t, status: i === 0 ? status : 'ikke-startet' as const }));

const basis = (o: Partial<StartVisning>): string => String(renderStart({
  trin: trin('ikke-startet'), profil: null, standardNavn: '', forslag: [], kanGemme: true, now: NU, ...o,
}));

// KC-0247: Start shows one step at a time, so the cases about step 2 have step 1 done (step 2 is then the open card).
export const START: Record<string, () => string> = {
  koldt: () => basis({ model: { syn: { modeller: {}, test: {}, rev }, agent: 'klar', kanGemme: true } }),
  koldtLaptop: () => basis({ laptop: true }),
  ikkeEjer: () => basis({ trin: trin('klaret'), kanGemme: false, model: { syn: syn(true), agent: 'klar', kanGemme: false } }),
  profil: () => basis({
    trin: trin('klaret'),
    profil: { navn: FAMILIE.ejer.navn, sprog: 'da', husstand: 'husstand' },
    model: { syn: syn(false), agent: 'klar', kanGemme: true, gemt: { udbyder: 'anthropic', noegle: { laengde: 108, tid: NU.toISOString() } } },
    forslag: [{ kildeId: 'noter', navn: 'Noter', slags: 'noter', grund: 'Du skriver meget ned.' }],
    log: [{ id: 'l1', tid: '2026-10-26T08:30:00.000Z', kilde: 'henrik', tekst: 'Gemte profilen', fortryd: 'fjern' }, { id: 'l2', tid: '2026-10-26T08:40:00.000Z', kilde: 'henrik', tekst: 'Skiftede model', fortrudt: '2026-10-26T08:45:00.000Z' }],
    igang: [{ id: 'r1', label: 'Prøver modellen', status: 'running' }],
  }),
  profilEngelsk: () => basis({ trin: trin('klaret'), profil: { navn: FAMILIE.medlem.navn, sprog: 'en', husstand: 'alene' } }),
  manglerNoegle: () => basis({ trin: trin('klaret'), model: { syn: syn(true), agent: 'mangler-noegle', kanGemme: true } }),
  manglerNoegleIkkeEjer: () => basis({ trin: trin('klaret'), model: { syn: syn(true), agent: 'mangler-noegle', kanGemme: false } }),
  utilgaengelig: () => basis({ trin: trin('klaret'), model: { syn: syn(true), agent: 'utilgaengelig', kanGemme: true } }),
  kommando: () => basis({ trin: trin('klaret'), model: { syn: syn(true), agent: 'klar', kanGemme: true, gemt: { udbyder: 'anthropic', kommando: 'hermes config set ANTHROPIC_API_KEY' } } }),
  lokal: () => basis({ trin: trin('klaret'), model: { syn: { ...syn(true), udbyder: 'ollama' }, agent: 'klar', kanGemme: true, gemt: { udbyder: 'ollama', url: 'http://127.0.0.1:11434' } } }),
  ingenDatamappe: () => basis({}),
};
