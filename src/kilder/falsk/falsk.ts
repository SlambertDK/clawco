// The fake connectors (KC-0132): one per slags, so every flow can be tried
// without a real account. Deterministic: the data is injected (the test
// world's story, src/testtilstand/indhold/kilder.ts), and each one can be put
// in a mode — ok | log-ind-igen | nede | langsom — to show what a failing
// source looks like. Registered only under KC_KILDER_MODE=fake (npm run dev)
// and in the test world; a production app never has them.

import { KildeFejl, SLAGS, erSlags, type Auth, type Felt, type Helbred, type Kilde, type KildeKort, type Laesning, type Slags, type SlagsData } from '../types.ts';

export const FALSKE_TILSTANDE = ['ok', 'log-ind-igen', 'nede', 'langsom', 'snart-udloebet'] as const;
export type FalskTilstand = (typeof FALSKE_TILSTANDE)[number];
export type FalskData = { [S in Slags]: (nu: Date) => SlagsData[S] };

const HELBRED: Record<FalskTilstand, Helbred> = {
  ok: { status: 'ok' },
  'log-ind-igen': { status: 'log-ind-igen', tekst: 'Adgangen er udløbet. Log ind igen.' },
  nede: { status: 'nede', tekst: 'Kilden svarer ikke.' },
  langsom: { status: 'langsomt', tekst: 'Kilden svarer langsomt.' },
  // KC-0139: works, but its access is known to run out: the expiry is added from the clock (36 hours ahead).
  'snart-udloebet': { status: 'ok' },
};
const UDLOEBER_OM_MS = 36 * 3600_000;

/** Per slags: the name, auth kind and card fields of its fake. */
const OPSAET: Record<Slags, { navn: string; auth: Auth; tekst: string; felter: Felt[] }> = {
  kalender: { navn: 'Falsk kalender', auth: 'oauth', tekst: 'En kalender med opdigtede aftaler. Log ind for at se den i Dagen.', felter: [] },
  mail: {
    navn: 'Falsk mail', auth: 'bridge', tekst: 'En mailkonto med opdigtede breve.',
    felter: [{ navn: 'brugernavn', etiket: 'Brugernavn', type: 'tekst', paakraevet: true, maks: 200 }, { navn: 'adgangskode', etiket: 'Adgangskode', type: 'hemmelig', paakraevet: true }],
  },
  noter: { navn: 'Falske noter', auth: 'local', tekst: 'En mappe med opdigtede noter og mennesker.', felter: [{ navn: 'mappe', etiket: 'Mappe', type: 'mappe', paakraevet: true }] },
  nyheder: { navn: 'Falske nyheder', auth: 'local', tekst: 'Opdigtede nyheder fra opdigtede kilder.', felter: [{ navn: 'adresse', etiket: 'Feed-adresse', type: 'tekst', paakraevet: false }] },
  beskeder: { navn: 'Falske beskeder', auth: 'apikey', tekst: 'Opdigtede beskeder fra familien.', felter: [{ navn: 'noegle', etiket: 'Nøgle', type: 'hemmelig', paakraevet: true }] },
};

const FALSK_KODE = 'falsk-kode';

/**
 * `reparation` (KC-0139, the test world): the slags whose connection was made again — each reads as ok from then on,
 * whatever `tilstand` says (reconnecting is what fixes a fake there). The world empties it at every moment. Absent (dev,
 * other tests) = a fake keeps its own state when connected again, so a source that is down still connects down.
 */
export function falskeKilder(o: { data: FalskData; tilstand?: (slags: Slags) => FalskTilstand; forsinkelseMs?: number; reparation?: Set<Slags> }): Kilde[] {
  const repareret = o.reparation ?? new Set<Slags>();
  const kanRepareres = o.reparation !== undefined;
  const grundtilstand = o.tilstand ?? (() => 'ok');
  const tilstand = (slags: Slags): FalskTilstand => (repareret.has(slags) ? 'ok' : grundtilstand(slags));
  const forsinkelse = o.forsinkelseMs ?? 1500;
  return SLAGS.map((slags): Kilde => {
    const op = OPSAET[slags];
    const kort: KildeKort = { titel: op.navn, tekst: op.tekst, felter: op.felter, handling: op.auth === 'oauth' ? 'Log ind' : 'Forbind' };
    const k: Kilde = {
      id: `falsk-${slags}`, navn: op.navn, slags, zone: 'privat', auth: op.auth, tillid: 'uklar',
      async read(ctx) {
        const t = tilstand(slags);
        if (t === 'log-ind-igen' || t === 'nede') throw new KildeFejl(502, HELBRED[t].tekst ?? op.navn);
        if (t === 'langsom') await new Promise((res) => setTimeout(res, forsinkelse));
        return { slags, hentet: ctx.nu.toISOString(), uklar: true, data: o.data[slags](ctx.nu) } as Laesning;
      },
      kort: async () => kort,
      helbred: async (ctx) => {
        const t = tilstand(slags);
        return t === 'snart-udloebet' ? { status: 'ok', udloeber: new Date(ctx.nu.getTime() + UDLOEBER_OM_MS).toISOString() } : HELBRED[t];
      },
    };
    // Connecting again repairs the fake (a real source is mended the same way: a new login or password).
    if (kanRepareres && op.auth !== 'oauth') k.opsaet = async (ctx) => { repareret.add(slags); return { tekst: '', valg: { ...ctx.valg } }; };
    if (op.auth === 'oauth') {
      // The fake provider consents at once: the browser goes straight back with the state and a fixed code.
      k.oauth = {
        start: async (state, tilbage) => ({ url: `${tilbage}?state=${encodeURIComponent(state)}&code=${FALSK_KODE}` }),
        tilbage: async (kode) => {
          if (kode !== FALSK_KODE) throw new KildeFejl(400, 'Den falske udbyder kender ikke koden.');
          if (kanRepareres) repareret.add(slags);
          return { adgang: 'falsk-adgang' };
        },
      };
    }
    if (slags === 'mail') {
      k.verber = { flyt: { verb: 'sorter', tekst: 'Flyt mailen til en mappe' } };
      k.act = async () => ({ ok: true, tekst: 'Mailen er flyttet (falsk).' });
    }
    return k;
  });
}

/**
 * The connectors the host registers: the fakes under KC_KILDER_MODE=fake, else the host's own (legacy) ones.
 * KC-0128 invariant: the fakes never run beside the real agent (`agent: 'hermes-http'`), so a first value shown in
 * Nu can never come from invented data on a real install — only in dev and the test world.
 */
export function kilderFraMiljoe(env: Record<string, string | undefined>, o: { falsk: () => Kilde[]; legacy: () => Kilde[]; agent?: 'hermes-http' | 'fake' | 'direkte' }): Kilde[] {
  const mode = (env['KC_KILDER_MODE'] ?? '').trim();
  if (mode === 'fake' && o.agent !== undefined && o.agent !== 'fake') throw new Error('KC_KILDER_MODE=fake kræver KC_AGENT=fake (de falske kilder findes kun i udvikling og testverdenen)');
  if (mode === 'fake') return o.falsk();
  if (mode === '') return o.legacy();
  throw new Error('KC_KILDER_MODE skal være fake eller tom');
}

/** "kalender:nede,mail:langsom" (KC_KILDER_FALSK) → the mode per slags. Anything else is refused. */
export function parseFalskTilstand(spec: string): Partial<Record<Slags, FalskTilstand>> {
  const ud: Partial<Record<Slags, FalskTilstand>> = {};
  for (const del of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [slags, t] = del.split(':').map((x) => x.trim());
    if (!erSlags(slags) || !(FALSKE_TILSTANDE as readonly string[]).includes(t ?? '')) throw new Error(`ugyldig falsk tilstand: ${del.slice(0, 40)}`);
    ud[slags] = t as FalskTilstand;
  }
  return ud;
}
