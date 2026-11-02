// KC-0187: the alert rules. Signals in, alerts out: a mail to the operator through the Post seam (KC-0178) and a
// warning event through the error report. A rule fires once while its condition holds and again only after it cleared
// (de-duplicated in this process: a restart may send an alert that is still active once more). An alert's text carries
// counts and tenant ids only — never a host name, an error text or anything a customer wrote.
// Other tickets plug their signal in: KC-0189 fills `usunde`, KC-0182 `provisionering` and `ledigePladser`, the
// certificate check `certifikater`. Signals that exist today are read by alarmSignaler (KC-0185 backups and drills,
// KC-0186 rollouts).
import type { Database } from '../db/pool.ts';
import type { Post } from '../delt/post.ts';
import { medSikkerBesked, type Fejlrapport } from '../delt/fejlrapport-kerne.ts';
import { kopiTilstand, proeverSiden } from './backup/tilstand.ts';
import { udrulStatus } from './udrulning/udrul.ts';

export const ALARM_REGLER = ['backup-gammel', 'gendannelse-fejlet', 'udrulning-fejlet', 'provisionering', 'faa-pladser', 'tenant-usund', 'certifikat'] as const;
export type RegelId = (typeof ALARM_REGLER)[number];

export const GRAENSER = {
  backupTimer: 36,
  provisioneringMinutter: 2,
  ledigePladser: 3,
  usundMinutter: 5,
  certifikatDage: 14,
  /** How far back a failed restore drill counts (the drill is monthly). */
  proeveDage: 35,
} as const;

/** What the rules read. An absent field = that signal is unknown this pass: its rule neither fires nor clears. */
export type Signaler = {
  /** KC-0185: per scope (`db` or a tenant id) when it was first seen and when its last copy succeeded. */
  kopier?: { omfang: string; oprettet: Date; sidsteSucces: Date | null }[];
  /** KC-0185: restore drills within GRAENSER.proeveDage. */
  proever?: { omfang: string; slut: Date; ok: boolean }[];
  /** KC-0186: the latest rollout and its tenants that did not upgrade. null = no rollout yet. */
  udrulning?: { id: number; tilstand: string; problemer: { slug: string; tilstand: string }[] } | null;
  /** KC-0182: tenants being provisioned, or failed. */
  provisionering?: { slug: string; startet: Date; tilstand: 'igang' | 'fejlet' }[];
  /** Free tenant slots on the fleet. */
  ledigePladser?: number;
  /** KC-0189: tenants seen unhealthy, since when. */
  usunde?: { slug: string; siden: Date }[];
  /** TLS certificates and when they expire (the name is never written into an alert). */
  certifikater?: { navn: string; udloeber: Date }[];
};

export type Alarm = { regel: RegelId; noegle: string; titel: string; tekst: string };

const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const TIME = 3_600_000;

/** At most ten ids, sorted, the rest as a count; an id outside the tenant form is counted but never written. */
function idListe(ids: string[]): string {
  const gyldige = [...new Set(ids.filter((s) => SLUG.test(s)))].sort();
  const vist = gyldige.slice(0, 10);
  const resten = ids.length - vist.length;
  if (!vist.length) return '';
  return ` (${vist.join(', ')}${resten > 0 ? ` og ${resten} til` : ''})`;
}

const flertal = (n: number, en: string, flere: string): string => `${n} ${n === 1 ? en : flere}`;

/** Each rule: null when its signal is absent, else the alerts that hold now (one per rule, keyed by who is affected). */
const VURDER: Record<RegelId, (s: Signaler, nu: Date) => Alarm[] | null> = {
  'backup-gammel': (s, nu) => {
    if (!s.kopier) return null;
    const graense = nu.getTime() - GRAENSER.backupTimer * TIME;
    const gamle = s.kopier.filter((k) => (k.sidsteSucces ?? k.oprettet).getTime() < graense).map((k) => k.omfang);
    if (!gamle.length) return [];
    return [{ regel: 'backup-gammel', noegle: gamle.slice().sort().join(','), titel: 'Backup for gammel', tekst: `${flertal(gamle.length, 'sikkerhedskopi', 'sikkerhedskopier')} er ældre end ${GRAENSER.backupTimer} timer${idListe(gamle)}.` }];
  },
  'gendannelse-fejlet': (s) => {
    if (!s.proever) return null;
    const fejlede = s.proever.filter((p) => !p.ok);
    if (!fejlede.length) return [];
    return [{ regel: 'gendannelse-fejlet', noegle: fejlede.map((p) => `${p.omfang}@${p.slut.toISOString()}`).sort().join(','), titel: 'Gendannelsesprøve fejlede', tekst: `${flertal(fejlede.length, 'gendannelsesprøve', 'gendannelsesprøver')} fejlede de seneste ${GRAENSER.proeveDage} dage${idListe(fejlede.map((p) => p.omfang))}.` }];
  },
  'udrulning-fejlet': (s) => {
    if (s.udrulning === undefined) return null;
    const u = s.udrulning;
    if (!u) return [];
    const fejl = u.problemer.filter((p) => p.tilstand === 'fejlet' || p.tilstand === 'tilbagerullet').map((p) => p.slug);
    if (!fejl.length && u.tilstand !== 'standset' && u.tilstand !== 'tilbagerullet') return [];
    return [{ regel: 'udrulning-fejlet', noegle: `${u.id}:${fejl.slice().sort().join(',')}`, titel: 'Udrulning standset', tekst: `Udrulning ${u.id} gik ikke igennem, ${flertal(fejl.length, 'kunde', 'kunder')} fejlede eller blev rullet tilbage${idListe(fejl)}.` }];
  },
  provisionering: (s, nu) => {
    if (!s.provisionering) return null;
    const graense = nu.getTime() - GRAENSER.provisioneringMinutter * 60_000;
    const ramt = s.provisionering.filter((p) => p.tilstand === 'fejlet' || p.startet.getTime() < graense).map((p) => p.slug);
    if (!ramt.length) return [];
    return [{ regel: 'provisionering', noegle: ramt.slice().sort().join(','), titel: 'Oprettelse fejlede eller er langsom', tekst: `${flertal(ramt.length, 'ny kunde', 'nye kunder')} fejlede eller ventede over ${GRAENSER.provisioneringMinutter} minutter på sin Clawco${idListe(ramt)}.` }];
  },
  'faa-pladser': (s) => {
    if (s.ledigePladser === undefined) return null;
    if (s.ledigePladser >= GRAENSER.ledigePladser) return [];
    return [{ regel: 'faa-pladser', noegle: 'faa', titel: 'Få ledige pladser', tekst: `Kun ${flertal(Math.max(0, s.ledigePladser), 'ledig kundeplads', 'ledige kundepladser')} tilbage (grænsen er ${GRAENSER.ledigePladser}).` }];
  },
  'tenant-usund': (s, nu) => {
    if (!s.usunde) return null;
    const graense = nu.getTime() - GRAENSER.usundMinutter * 60_000;
    const ramt = s.usunde.filter((u) => u.siden.getTime() <= graense).map((u) => u.slug);
    if (!ramt.length) return [];
    return [{ regel: 'tenant-usund', noegle: ramt.slice().sort().join(','), titel: 'Kunde svarer ikke', tekst: `${flertal(ramt.length, 'kunde', 'kunder')} har ikke svaret rask i over ${GRAENSER.usundMinutter} minutter${idListe(ramt)}.` }];
  },
  certifikat: (s, nu) => {
    if (!s.certifikater) return null;
    const graense = nu.getTime() + GRAENSER.certifikatDage * 24 * TIME;
    const snart = s.certifikater.filter((c) => c.udloeber.getTime() < graense);
    if (!snart.length) return [];
    const dage = Math.max(0, Math.floor((Math.min(...snart.map((c) => c.udloeber.getTime())) - nu.getTime()) / (24 * TIME)));
    return [{ regel: 'certifikat', noegle: snart.map((c) => c.udloeber.toISOString()).sort().join(','), titel: 'Certifikat udløber snart', tekst: `${flertal(snart.length, 'certifikat', 'certifikater')} udløber inden for ${GRAENSER.certifikatDage} dage, det første om ${flertal(dage, 'dag', 'dage')}.` }];
  },
};

class Alarmering extends Error {}

/** The operator's address (SKY_ALARM_TIL): one plain address, or null (alerts go to the error report and the log only). */
export function alarmModtager(env: Record<string, string | undefined>): string | null {
  const v = (env['SKY_ALARM_TIL'] ?? '').trim();
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(v) ? v : null;
}

/** The rules engine. `til` is the operator's address (SKY_ALARM_TIL); null = alerts go to the error report only.
 *  `vurder` returns the alerts delivered this pass (mailed, or reported when there is no address). The error event
 *  and the log line go out once per alert; a mail the provider refuses is tried again on the next pass. */
export function alarmer(o: { post: Post | null; til: string | null; rapport: Fejlrapport; log?: (linje: string) => void }): { vurder(s: Signaler, nu: Date): Promise<Alarm[]> } {
  const log = o.log ?? ((l: string) => { console.log(l); });
  const mail = o.post && o.til ? { post: o.post, til: o.til } : null;
  /** Per rule: the keys still holding that were reported, and those that were also mailed. */
  const rapporteret = new Map<RegelId, Set<string>>(ALARM_REGLER.map((r) => [r, new Set<string>()]));
  const mailet = new Map<RegelId, Set<string>>(ALARM_REGLER.map((r) => [r, new Set<string>()]));
  return {
    async vurder(s, nu) {
      const leveret: Alarm[] = [];
      for (const regel of ALARM_REGLER) {
        const nye = VURDER[regel](s, nu);
        if (nye === null) continue;
        const holder = new Set(nye.map((a) => a.noegle));
        for (const sat of [rapporteret.get(regel)!, mailet.get(regel)!]) for (const k of [...sat]) if (!holder.has(k)) sat.delete(k);
        for (const a of nye) {
          const r = rapporteret.get(regel)!;
          const m = mailet.get(regel)!;
          const nyRapport = !r.has(a.noegle);
          if (nyRapport) {
            o.rapport.rapporter(medSikkerBesked(new Alarmering(a.titel), a.tekst), { alarm: a.regel, niveau: 'warning' });
            log(`sky alarm: ${a.regel} ${a.tekst}`);
            r.add(a.noegle);
          }
          if (!mail) { if (nyRapport) leveret.push(a); continue; }
          if (m.has(a.noegle)) continue;
          try {
            await mail.post.send({ til: mail.til, skabelon: 'alarm', data: { titel: a.titel, tekst: a.tekst } });
          } catch {
            if (nyRapport) log(`sky alarm: ${a.regel} kunne ikke mailes, prøver igen ved næste gennemløb`);
            continue;
          }
          m.add(a.noegle);
          leveret.push(a);
        }
      }
      return leveret;
    },
  };
}

/** The signals Sky has today, from its own tables. */
export async function alarmSignaler(db: Database, nu: Date): Promise<Signaler> {
  const kopier = [...(await kopiTilstand(db)).values()].map((k) => ({ omfang: k.omfang, oprettet: k.oprettet, sidsteSucces: k.sidsteSucces }));
  const proever = (await proeverSiden(db, new Date(nu.getTime() - GRAENSER.proeveDage * 24 * TIME))).map((p) => ({ omfang: p.omfang, slut: p.slut, ok: p.ok }));
  const st = await udrulStatus({ db, nu: () => nu });
  const udrulning = st.udrulning ? { id: st.udrulning.id, tilstand: st.udrulning.tilstand, problemer: st.problemer.map((p) => ({ slug: p.slug, tilstand: p.tilstand })) } : null;
  return { kopier, proever, udrulning };
}

/** Every `interval` ms: read the signals and run the rules. A failing pass is reported, never thrown. One pass at a
 *  time: a call while a pass runs joins it (two passes at once could both mail the same alert). */
export function alarmLoekke(o: { signaler: (nu: Date) => Promise<Signaler>; alarm: ReturnType<typeof alarmer>; rapport: Fejlrapport; interval: number; nu?: () => Date; log?: (linje: string) => void }): { stop(): void; gennemloeb(): Promise<void> } {
  const nu = o.nu ?? (() => new Date());
  let igang: Promise<void> | null = null;
  const koer = async (): Promise<void> => {
    try {
      const t = nu();
      await o.alarm.vurder(await o.signaler(t), t);
    } catch (err) {
      o.rapport.rapporter(err, { alarm: 'gennemloeb' });
      (o.log ?? ((l: string) => { console.error(l); }))('sky alarm: et gennemløb fejlede');
    }
  };
  const gennemloeb = (): Promise<void> => {
    igang ??= koer().finally(() => { igang = null; });
    return igang;
  };
  void gennemloeb();
  const t = setInterval(() => { void gennemloeb(); }, o.interval);
  t.unref();
  return { stop: () => { clearInterval(t); }, gennemloeb };
}
