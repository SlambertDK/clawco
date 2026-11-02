// The household universe (KC-0148, spec §4 Husstanden, §5 src/hushold/): the
// state the room `husstand` keeps in its rum-lager. Who is in the household is
// the E1 identity's (husstand.json, src/identitet/); the stored `medlemmer`
// only add what identity does not know (relation, telefon). `ressourcer`
// (KC-0150, types in ressource.ts; a stored calendar is never double booked), `udkast`
// (KC-0151, a booking waiting for its person's tap),
// `forespoergsler` (KC-0149) and `sammenfald` (KC-0150's clashes) are the
// household's shared things. Every field is checked and capped. Pure — no I/O.

import { erRolle, type Rolle } from '../identitet/roller.ts';
import type { DataZone } from '../identitet/zoner.ts';
import { TILSTANDE, type ForespForslag, type Forespoergsel, type Historik, type Tilstand } from './foresp.ts';
import type { BookingUdkast } from './bil.ts';
import type { Blok, Konflikt, KonfliktValg } from './konflikt.ts';
import { dobbeltBooket, MAX_VALG, SLAGS, type Booking, type Ressource, type Sammenfald, type Slags, type Valg } from './ressource.ts';

export type { Forespoergsel } from './foresp.ts';
export type { Booking, Ressource, Sammenfald } from './ressource.ts';
export type { BookingUdkast } from './bil.ts';
export type { Konflikt } from './konflikt.ts';

/** The room id and the one zone its runs read. */
export const RUM = 'husstand';
export const KORSEL: DataZone = 'husstand';

export type Medlem = { id: string; navn: string; rolle: Rolle; relation?: string; tailnetLogin?: string; telefon?: string };
/** `konflikter` (KC-0152): the Saturday cards; `konfliktTjek`: the Saturday the Tuesday check last looked at (it runs once per weekend). */
export type HusstandState = { medlemmer: Medlem[]; ressourcer: Ressource[]; forespoergsler: Forespoergsel[]; sammenfald: Sammenfald[]; udkast: BookingUdkast[]; konflikter: Konflikt[]; konfliktTjek?: string };

export const TOM_HUSSTAND: HusstandState = { medlemmer: [], ressourcer: [], forespoergsler: [], sammenfald: [], udkast: [], konflikter: [] };

export class HusholdFejl extends Error {}

const MAX_LISTE = 50;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TELEFON = /^\+?[0-9 ]{3,20}$/;

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function id(v: unknown, hvad: string): string {
  if (typeof v !== 'string' || !ID.test(v)) throw new HusholdFejl(`${hvad}: ugyldigt id`);
  return v;
}
function tekst(v: unknown, max: number, hvad: string): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HusholdFejl(`${hvad}: ugyldig tekst`);
  return v.trim();
}
function valgfri(v: unknown, max: number, hvad: string): string | undefined {
  return v === undefined || v === null ? undefined : tekst(v, max, hvad);
}
function tid(v: unknown, hvad: string): string {
  if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) throw new HusholdFejl(`${hvad}: ugyldig tid`);
  return v;
}
function tidsrum(start: unknown, slut: unknown, hvad: string): { start: string; slut: string } {
  const s = tid(start, hvad); const e = tid(slut, hvad);
  if (Date.parse(e) <= Date.parse(s)) throw new HusholdFejl(`${hvad}: slut før start`);
  return { start: s, slut: e };
}
function liste<T>(v: unknown, hvad: string, parse: (x: unknown) => T & { id: string }): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_LISTE) throw new HusholdFejl(`${hvad}: ikke en liste`);
  const ud = v.map(parse);
  if (new Set(ud.map((x) => x.id)).size !== ud.length) throw new HusholdFejl(`${hvad}: samme id to gange`);
  return ud;
}
const obj = (v: unknown, hvad: string): Record<string, unknown> => {
  if (!erObj(v)) throw new HusholdFejl(`${hvad}: ikke et objekt`);
  return v;
};

export function parseMedlem(raw: unknown): Medlem {
  const o = obj(raw, 'medlem');
  const m: Medlem = { id: id(o['id'], 'medlem'), navn: tekst(o['navn'], 80, 'medlem'), rolle: 'gaest' };
  if (!erRolle(o['rolle'])) throw new HusholdFejl(`medlem ${m.id}: ukendt rolle`);
  m.rolle = o['rolle'];
  const relation = valgfri(o['relation'], 80, 'relation'); if (relation) m.relation = relation;
  const login = valgfri(o['tailnetLogin'], 200, 'login'); if (login) m.tailnetLogin = login;
  if (o['telefon'] !== undefined && o['telefon'] !== null) {
    if (typeof o['telefon'] !== 'string' || !TELEFON.test(o['telefon'].trim())) throw new HusholdFejl(`medlem ${m.id}: ugyldigt telefonnummer`);
    m.telefon = o['telefon'].trim();
  }
  return m;
}

function parseBooking(raw: unknown): Booking {
  const o = obj(raw, 'booking');
  const { start, slut } = tidsrum(o['start'], o['slut'], 'booking');
  const b: Booking = { id: id(o['id'], 'booking'), ressourceId: id(o['ressourceId'], 'booking'), af: id(o['af'], 'booking'), start, slut, titel: tekst(o['titel'], 200, 'booking') };
  if (o['foresporgselId'] !== undefined && o['foresporgselId'] !== null) b.foresporgselId = id(o['foresporgselId'], 'booking');
  return b;
}

/** KC-0150: a resource's calendar never holds two overlapping bookings, and every booking is its own. */
function parseRessource(raw: unknown): Ressource {
  const o = obj(raw, 'ressource');
  if (typeof o['slags'] !== 'string' || !(SLAGS as readonly string[]).includes(o['slags'])) throw new HusholdFejl('ressource: ukendt slags');
  const r: Ressource = {
    id: id(o['id'], 'ressource'), navn: tekst(o['navn'], 80, 'ressource'), slags: o['slags'] as Slags,
    ejere: strenge(o['ejere'], 20, 'ejere', (x) => ID.test(x)), kalender: liste(o['kalender'], 'kalender', parseBooking),
  };
  if (r.kalender.some((b) => b.ressourceId !== r.id)) throw new HusholdFejl(`ressource ${r.id}: en booking hører til en anden ting`);
  if (dobbeltBooket(r)) throw new HusholdFejl(`ressource ${r.id}: dobbeltbooket`);
  return r;
}

function parseValg(raw: unknown): Valg {
  const o = obj(raw, 'valg');
  const v = { id: id(o['id'], 'valg'), hvem: id(o['hvem'], 'valg') };
  if (o['slags'] === 'afgiv') return { ...v, slags: 'afgiv' };
  if (o['slags'] === 'anden') return { ...v, slags: 'anden', ressourceId: id(o['ressourceId'], 'valg') };
  throw new HusholdFejl('valg: ukendt slags');
}

function parseSammenfald(raw: unknown): Sammenfald {
  const o = obj(raw, 'sammenfald');
  const valg = liste(o['valg'], 'valg', parseValg);
  if (valg.length < 2 || valg.length > MAX_VALG) throw new HusholdFejl('sammenfald: 2–4 valg');
  const s: Sammenfald = {
    id: id(o['id'], 'sammenfald'), ressourceId: id(o['ressourceId'], 'sammenfald'),
    ny: parseBooking(o['ny']), mod: parseBooking(o['mod']), valg, oprettet: tid(o['oprettet'], 'sammenfald'),
  };
  if (s.ny.af === s.mod.af) throw new HusholdFejl('sammenfald: samme person på begge sider');
  if (valg.some((v) => v.hvem !== s.ny.af && v.hvem !== s.mod.af)) throw new HusholdFejl('sammenfald: et valg for en tredje person');
  const kendt = (x: unknown): string => {
    const v = id(x, 'sammenfald');
    if (!valg.some((y) => y.id === v)) throw new HusholdFejl('sammenfald: ukendt valg');
    return v;
  };
  if (o['forslag'] !== undefined && o['forslag'] !== null) {
    const f = obj(o['forslag'], 'forslag');
    s.forslag = { foerste: kendt(f['foerste']) };
    const anbefaling = valgfri(f['anbefaling'], 200, 'forslag'); if (anbefaling) s.forslag.anbefaling = anbefaling;
  }
  if (o['forespId'] !== undefined && o['forespId'] !== null) { s.forespId = id(o['forespId'], 'sammenfald'); s.forespValg = kendt(o['forespValg']); }
  if (o['afgjort'] !== undefined && o['afgjort'] !== null) {
    const a = obj(o['afgjort'], 'afgjort');
    s.afgjort = { valg: a['valg'] === 'bortfaldet' ? 'bortfaldet' : kendt(a['valg']), af: id(a['af'], 'afgjort'), tid: tid(a['tid'], 'afgjort') };
  }
  return s;
}

/** KC-0151: a booking waiting for its person's tap (never a calendar entry). */
function parseUdkast(raw: unknown): BookingUdkast {
  const o = obj(raw, 'udkast');
  const { start, slut } = tidsrum(o['start'], o['slut'], 'udkast');
  return { id: id(o['id'], 'udkast'), af: id(o['af'], 'udkast'), ressourceId: id(o['ressourceId'], 'udkast'), start, slut, titel: tekst(o['titel'], 200, 'udkast'), oprettet: tid(o['oprettet'], 'udkast') };
}

const DATO = /^\d{4}-\d{2}-\d{2}$/;
const NOEGLE = /^\d{4}-\d{2}-\d{2}\|(?:barn|ressource):[a-z0-9][a-z0-9-]{0,39}$/;

function parseBlok(raw: unknown, hvem: string): Blok {
  const o = obj(raw, 'blok');
  const { start, slut } = tidsrum(o['start'], o['slut'], 'blok');
  if (id(o['hvem'], 'blok') !== hvem) throw new HusholdFejl('blok: ikke partens');
  const med = strenge(o['med'], 20, 'blok', (x) => ID.test(x));
  if (!med.includes(hvem)) throw new HusholdFejl('blok: parten er ikke med');
  const b: Blok = { hvem, start, slut, med };
  const titel = valgfri(o['titel'], 120, 'blok'); if (titel) b.titel = titel;
  return b;
}

/** KC-0152: a weekend card — two distinct adults, their two blocks in that order, and exactly the three symmetric options. */
function parseKonflikt(raw: unknown): Konflikt {
  const o = obj(raw, 'konflikt');
  const p = o['parter'];
  if (!Array.isArray(p) || p.length !== 2) throw new HusholdFejl('konflikt: to parter');
  const parter: [string, string] = [id(p[0], 'konflikt'), id(p[1], 'konflikt')];
  if (parter[0] === parter[1]) throw new HusholdFejl('konflikt: samme person to gange');
  if (typeof o['dag'] !== 'string' || !DATO.test(o['dag'])) throw new HusholdFejl('konflikt: ugyldig dag');
  if (typeof o['noegle'] !== 'string' || !NOEGLE.test(o['noegle'])) throw new HusholdFejl('konflikt: ugyldig nøgle');
  const b = obj(o['behov'], 'behov');
  if (b['slags'] !== 'barn' && b['slags'] !== 'ressource') throw new HusholdFejl('behov: ukendt slags');
  const bl = o['blokke'];
  if (!Array.isArray(bl) || bl.length !== 2) throw new HusholdFejl('konflikt: to blokke');
  const valgRaa = o['valg'];
  if (!Array.isArray(valgRaa) || valgRaa.length !== 3) throw new HusholdFejl('konflikt: tre valg');
  const valg = liste(valgRaa, 'valg', (x): KonfliktValg & { id: string } => {
    const v = obj(x, 'valg');
    if (v['slags'] === 'tredje') return { id: id(v['id'], 'valg'), slags: 'tredje' };
    if (v['slags'] === 'tager') { const hvem = id(v['hvem'], 'valg'); if (!parter.includes(hvem)) throw new HusholdFejl('valg: en tredje person'); return { id: id(v['id'], 'valg'), slags: 'tager', hvem }; }
    throw new HusholdFejl('valg: ukendt slags');
  });
  const tagere = valg.flatMap((v) => (v.slags === 'tager' ? [v.hvem] : []));
  if (new Set(tagere).size !== 2 || valg.filter((v) => v.slags === 'tredje').length !== 1) throw new HusholdFejl('konflikt: valgene er ikke symmetriske');
  const k: Konflikt = {
    id: id(o['id'], 'konflikt'), noegle: o['noegle'], dag: o['dag'], parter, behov: { slags: b['slags'], id: id(b['id'], 'behov'), navn: tekst(b['navn'], 80, 'behov') },
    tid: tidsrum(obj(o['tid'], 'tid')['start'], obj(o['tid'], 'tid')['slut'], 'konflikt'), blokke: [parseBlok(bl[0], parter[0]), parseBlok(bl[1], parter[1])],
    valg, oprettet: tid(o['oprettet'], 'konflikt'),
  };
  if (o['tekst'] !== undefined && o['tekst'] !== null) {
    const t = obj(o['tekst'], 'tekst');
    const resume = tekst(t['resume'], 300, 'tekst'), spoergsmaal = tekst(t['spoergsmaal'], 100, 'tekst');
    k.tekst = { resume, spoergsmaal };
  }
  if (o['forespId'] !== undefined && o['forespId'] !== null) {
    k.forespId = id(o['forespId'], 'konflikt');
    const v = id(o['forespValg'], 'konflikt');
    if (!valg.some((x) => x.id === v)) throw new HusholdFejl('konflikt: ukendt valg');
    k.forespValg = v;
  }
  return k;
}

const PAAMINDELSE = /^[a-z0-9][a-z0-9-]{0,39}:(?:24t|4t)$/;
const KL = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function tilstandAf(v: unknown, hvad: string): Tilstand {
  if (typeof v !== 'string' || !(TILSTANDE as readonly string[]).includes(v)) throw new HusholdFejl(`${hvad}: ukendt tilstand`);
  return v as Tilstand;
}
function strenge(v: unknown, max: number, hvad: string, gyldig: (x: string) => boolean): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === 'string' && gyldig(x))) throw new HusholdFejl(`${hvad}: ugyldig liste`);
  return [...new Set(v as string[])];
}
function parseHistorik(raw: unknown): Historik {
  const o = obj(raw, 'historik');
  return { tid: tid(o['tid'], 'historik'), tilstand: tilstandAf(o['tilstand'], 'historik'), af: o['af'] === 'ur' ? 'ur' : id(o['af'], 'historik') };
}
function parseForslag(raw: unknown): ForespForslag {
  const o = obj(raw, 'forslag');
  const alt = o['alternativer'] ?? [];
  if (!Array.isArray(alt) || alt.length > 3) throw new HusholdFejl('forslag: ugyldige alternativer');
  const f: ForespForslag = {
    alternativer: alt.map((a) => {
      const x = obj(a, 'forslag');
      if (typeof x['kl'] !== 'string' || !KL.test(x['kl'])) throw new HusholdFejl('forslag: ugyldigt klokkeslæt');
      return { kl: x['kl'], tekst: tekst(x['tekst'], 40, 'forslag') };
    }),
  };
  const anbefaling = valgfri(o['anbefaling'], 200, 'forslag'); if (anbefaling) f.anbefaling = anbefaling;
  return f;
}

function parseForespoergsel(raw: unknown): Forespoergsel {
  const o = obj(raw, 'forespørgsel');
  const historik = o['historik'];
  if (!Array.isArray(historik) || historik.length < 1 || historik.length > MAX_LISTE) throw new HusholdFejl('forespørgsel: ugyldig historik');
  const f: Forespoergsel = {
    id: id(o['id'], 'forespørgsel'), fra: id(o['fra'], 'forespørgsel'), til: id(o['til'], 'forespørgsel'), titel: tekst(o['titel'], 200, 'forespørgsel'),
    tilstand: tilstandAf(o['tilstand'], 'forespørgsel'),
    oprettet: tid(o['oprettet'], 'forespørgsel'), udloeber: tid(o['udloeber'], 'forespørgsel'),
    paamindet: strenge(o['paamindet'], 10, 'påmindelser', (x) => PAAMINDELSE.test(x)),
    historik: historik.map(parseHistorik),
  };
  if (f.fra === f.til) throw new HusholdFejl('forespørgsel: fra og til er samme person');
  if (o['tid'] !== undefined && o['tid'] !== null) {
    const t = obj(o['tid'], 'forespørgsel');
    f.tid = tidsrum(t['start'], t['slut'], 'forespørgsel');
  }
  if (o['ressourceId'] !== undefined && o['ressourceId'] !== null) f.ressourceId = id(o['ressourceId'], 'forespørgsel');
  if (o['alternativ'] !== undefined && o['alternativ'] !== null) {
    const a = obj(o['alternativ'], 'alternativ');
    f.alternativ = { ...tidsrum(a['start'], a['slut'], 'alternativ'), tekst: tekst(a['tekst'], 80, 'alternativ') };
  }
  if (o['aarsag'] !== undefined && o['aarsag'] !== null) {
    if (o['aarsag'] !== 'trukket') throw new HusholdFejl('forespørgsel: ukendt årsag');
    f.aarsag = 'trukket';
  }
  if (o['forslag'] !== undefined && o['forslag'] !== null) f.forslag = parseForslag(o['forslag']);
  if (o['lukket'] !== undefined && o['lukket'] !== null) f.lukket = tid(o['lukket'], 'forespørgsel');
  const iKalender = strenge(o['iKalender'], 2, 'kalender', (x) => ID.test(x));
  if (iKalender.length) f.iKalender = iKalender;
  return f;
}

/** The stored state, validated. Nothing stored (null/undefined) is the empty household. Throws HusholdFejl. */
export function parseHusstandState(raw: unknown): HusstandState {
  if (raw === null || raw === undefined) return { ...TOM_HUSSTAND };
  const o = obj(raw, 'husstand');
  const konflikter = liste(o['konflikter'], 'konflikter', parseKonflikt);
  if (new Set(konflikter.map((k) => k.noegle)).size !== konflikter.length) throw new HusholdFejl('konflikter: samme behov to gange');
  const tjek = o['konfliktTjek'] === undefined || o['konfliktTjek'] === null ? undefined : o['konfliktTjek'];
  if (tjek !== undefined && (typeof tjek !== 'string' || !DATO.test(tjek))) throw new HusholdFejl('konfliktTjek: ugyldig dag');
  return {
    medlemmer: liste(o['medlemmer'], 'medlemmer', parseMedlem),
    ressourcer: liste(o['ressourcer'], 'ressourcer', parseRessource),
    forespoergsler: liste(o['forespoergsler'], 'forespørgsler', parseForespoergsel),
    sammenfald: liste(o['sammenfald'], 'sammenfald', parseSammenfald),
    udkast: liste(o['udkast'], 'udkast', parseUdkast),
    konflikter,
    ...(tjek ? { konfliktTjek: tjek } : {}),
  };
}
