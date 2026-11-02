// KC-0233: the Digital Post window — what Nu and Start are told, and the two things a person can do (confirm the sender
// in Start, "Set den" on a notice). The composition root hands it a seam that reads the connected mail sources; this
// file knows nothing of the registry. The rule itself is pure (src/kilder/danmark/digital-post.ts); this is the glue:
// the small state file, a short cache of the mail read (Nu is fetched often, a mail login is not free), and the plain
// refusals. Nothing here reaches outside: no call, no write to the mail, no handling for Hermes.

import type { Kuvert } from '../kilder/types.ts';
import { erKendtDomaene, genkendDigitalPost, GENERISK_EMNE, KENDTE_DOMAENER, kandidatAfsendere, tilfoejSet, type Notits } from '../kilder/danmark/digital-post.ts';
import { erViser, VISERE, type DanmarkLager, type Viser } from './tilstand.ts';

/** What the mail seam answers: is a mail source connected into the person's own zone, and its envelopes — null = every one of them failed to read. */
export type MailSyn = { forbundet: boolean; kuverter: Kuvert[] | null };

/** A refusal with a plain Danish sentence and the status a route answers. */
export class DanmarkAfvist extends Error {
  readonly status: 400 | 409 | 503;
  constructor(status: 400 | 409 | 503, besked: string) { super(besked); this.name = 'DanmarkAfvist'; this.status = status; }
}

/** One notice as Nu draws it: the subject only when it says more than "you have new post". */
export type PostNotits = { id: string; modtaget: string; afsender: string; emne: string | null };
/** What Nu is told. null (no value) = nothing to show: no card at all. */
export type PostNu = { slags: 'notitser'; notitser: PostNotits[]; viser: { navn: string; url: string } } | { slags: 'kan-ikke-se'; viser: { navn: string; url: string } };
/** What Start is told while the step is open. */
export type PostStart = { kandidater: string[]; laeser: 'ok' | 'kan-ikke-se'; viser: Viser; visere: { id: Viser; navn: string }[]; domaener: readonly string[] };

const DAG_MS = 86_400_000;
/** How long "Ikke nu" puts Start's step away. */
const UDSAT_DAGE = 30;
export const AFSENDER_AFVIST = `Det er ikke en adresse, Digital Post sender fra. Skriv adressen i notifikationsmailen (den slutter på ${KENDTE_DOMAENER.join(', ')}), eller vælg en fra listen.`;

export function lavDanmark(o: { lager: DanmarkLager; laesMail: () => Promise<MailSyn>; nu: () => Date; domaener?: readonly string[]; cacheMs?: number }) {
  const domaener = o.domaener ?? KENDTE_DOMAENER;
  const cacheMs = o.cacheMs ?? 120_000;
  let cache: { tid: number; p: Promise<MailSyn> } | null = null;
  const mail = (): Promise<MailSyn> => {
    const nu = o.nu().getTime();
    if (cache && cacheMs > 0 && nu - cache.tid < cacheMs) return cache.p;
    const p = o.laesMail().catch((): MailSyn => ({ forbundet: true, kuverter: null }));
    cache = { tid: nu, p };
    return p;
  };
  const notitser = (kuverter: Kuvert[], afsendere: string[], set: string[]): Notits[] => genkendDigitalPost(kuverter, { afsendere, nu: o.nu(), set: new Set(set) });

  return {
    /** Nu's card: only once a sender is confirmed and a mail source is connected; "kan ikke se" when it cannot be read; nothing when there is no unseen notice. */
    async nu(): Promise<PostNu | null> {
      const s = await o.lager.laes();
      if (!s.afsendere.length) return null;
      const m = await mail();
      if (!m.forbundet) return null;
      if (m.kuverter === null) return { slags: 'kan-ikke-se', viser: { ...VISERE[s.viser] } };
      const n = notitser(m.kuverter, s.afsendere, s.set);
      return n.length ? { slags: 'notitser', notitser: n.map((x) => ({ id: x.id, modtaget: x.modtaget, afsender: x.afsender, emne: GENERISK_EMNE(x.emneKort) ? null : x.emneKort })), viser: { ...VISERE[s.viser] } } : null;
    },

    /** Start's step: a mail source is connected, no sender confirmed, and it was not put away. */
    async start(): Promise<PostStart | null> {
      const s = await o.lager.laes();
      if (s.afsendere.length) return null;
      if (s.afvist && o.nu().getTime() - Date.parse(s.afvist) < UDSAT_DAGE * DAG_MS) return null;
      const m = await mail();
      if (!m.forbundet) return null;
      return { kandidater: m.kuverter ? kandidatAfsendere(m.kuverter, domaener) : [], laeser: m.kuverter ? 'ok' : 'kan-ikke-se', viser: s.viser, visere: (Object.keys(VISERE) as Viser[]).map((id) => ({ id, navn: VISERE[id].navn })), domaener };
    },

    /** Whether Start is worth putting in the nav now: the step is open AND the inbox holds a sender on a hint domain. */
    async promover(): Promise<boolean> {
      const s = await this.start().catch(() => null);
      return !!s && s.kandidater.length > 0;
    },

    /** The person confirms the notification sender (and the viewer). Only an address on a hint domain. */
    async gem(afsender: string, viser: string): Promise<void> {
      const adresse = String(afsender ?? '').trim().toLowerCase();
      if (!erKendtDomaene(adresse, domaener)) throw new DanmarkAfvist(400, AFSENDER_AFVIST);
      if (!erViser(viser)) throw new DanmarkAfvist(400, 'Vælg, hvor du læser din Digital Post: mit.dk, e-Boks eller borger.dk.');
      if (!(await mail()).forbundet) throw new DanmarkAfvist(409, 'Forbind først den mail, Digital Post sender notifikationen til.');
      await o.lager.aendre((s) => { const { afvist: _afvist, ...rest } = s; return { ...rest, afsendere: [adresse], viser }; });
      cache = null;
    },

    /** "Ikke nu" on Start's step. */
    async ikkeNu(): Promise<void> {
      await o.lager.aendre((s) => ({ ...s, afvist: o.nu().toISOString() }));
    },

    /** KC-0236: whether the Aula card in Start's Danmark-pakke group was put away ("Ikke nu") less than 30 days ago. Needs no mail. */
    async aulaUdsat(): Promise<boolean> {
      const s = await o.lager.laes();
      return !!s.aulaAfvist && o.nu().getTime() - Date.parse(s.aulaAfvist) < UDSAT_DAGE * DAG_MS;
    },

    /** KC-0236: "Ikke nu" on the Aula card. */
    async aulaIkkeNu(): Promise<void> {
      await o.lager.aendre((s) => ({ ...s, aulaAfvist: o.nu().toISOString() }));
    },

    /** "Set dem": every unseen notice now is marked seen (the one card that folds more than three). */
    async setAlle(): Promise<void> {
      const s = await o.lager.laes();
      const m = await mail();
      if (!s.afsendere.length || !m.forbundet) throw new DanmarkAfvist(400, 'Der er ingen besked at sætte.');
      if (m.kuverter === null) throw new DanmarkAfvist(503, 'Clawco kan ikke læse din mail lige nu. Prøv igen om lidt.');
      const ider = notitser(m.kuverter, s.afsendere, s.set).map((n) => n.id);
      if (!ider.length) throw new DanmarkAfvist(400, 'Der er ingen besked at sætte.');
      await o.lager.aendre((x) => ({ ...x, set: ider.reduce(tilfoejSet, x.set) }));
    },

    /** "Set den": the notice (by its id, which must be one of the notices now) is marked seen. */
    async set(id: string): Promise<void> {
      const s = await o.lager.laes();
      if (!s.afsendere.length || typeof id !== 'string' || !id) throw new DanmarkAfvist(400, 'Den besked findes ikke længere.');
      const m = await mail();
      if (!m.forbundet) throw new DanmarkAfvist(400, 'Den besked findes ikke længere.');
      if (m.kuverter === null) throw new DanmarkAfvist(503, 'Clawco kan ikke læse din mail lige nu. Prøv igen om lidt.');
      if (!notitser(m.kuverter, s.afsendere, s.set).some((n) => n.id === id)) throw new DanmarkAfvist(400, 'Den besked findes ikke længere.');
      await o.lager.aendre((x) => ({ ...x, set: tilfoejSet(x.set, id) }));
    },
  };
}

export type Danmark = ReturnType<typeof lavDanmark>;
