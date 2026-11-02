// "Hent alt" in Sky (KC-0206): everything Clawco holds about an account, as one zip over a link that lives 24 hours.
// The link is stored as SHA-256 only and opens only for the account that made it; the zip is built when it is
// opened, so no copy of anyone's data is stored. An owner's zip carries the tenant's own KC-0146 export untouched
// (clawco.zip, the same file "Hent alt" gives inside the Clawco — never re-implemented here), beside the account
// data only the control plane holds. A member gets only their own account data (the household's Clawco is the
// owner's). Seams: `tenant` (the fleet + gateway, wired in server.ts) and `abonnement` (billing), so konto/ imports
// neither.
import type { Database } from '../db/pool.ts';
import { lavZip, type ZipFil } from '../delt/zip.ts';
import { hashToken, nytToken } from './token.ts';
import { hentKonto } from './konto.ts';
import { hentProfil } from './profil.ts';
import { passkeys } from './passkey.ts';
import { sessioner } from './session.ts';
import type { Husstand } from './slet.ts';

export const EKSPORT_MS = 24 * 3_600_000;

export async function opretEksportLink(db: Database, kontoId: number, nu: Date): Promise<string> {
  const token = nytToken();
  await db.query('INSERT INTO eksportlink (hash, konto_id, oprettet, udloeber) VALUES ($1, $2, $3, $4)',
    [hashToken(token), kontoId, nu.toISOString(), new Date(nu.getTime() + EKSPORT_MS).toISOString()]);
  return token;
}

export async function gyldigtEksportLink(db: Database, token: string, kontoId: number, nu: Date): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [r] = await db.query('SELECT 1 FROM eksportlink WHERE hash = $1 AND konto_id = $2 AND udloeber > $3', [hashToken(token), kontoId, nu.toISOString()]);
  return !!r;
}

export type EksportKilder = {
  /** The owner's tenant export (its own /api/tillid/eksport); null when the account has no running Clawco. Throws when it cannot be read. */
  tenant?: (kontoId: number) => Promise<Buffer | null>;
  /** Billing's view of the account (customer, plan history, invoices); plain JSON. */
  abonnement?: (kontoId: number) => Promise<unknown>;
};

const LAES_MIG = `Alt hvad Clawco har om dig

konto/konto.json       din konto: mail, land, sprog, hvilke vilkår du har accepteret og hvornår
konto/passkeys.json    dine passkeys (navn og datoer; selve nøglen bor på din enhed)
konto/sessioner.json   de steder, du er logget ind
konto/abonnement.json  dit abonnement, dets historik og dine fakturaer (hvis du har et)
clawco.zip             alt i din Clawco: det samme som "Hent alt" inde i Clawco (kun for ejeren)

Nøgler, adgangskoder og logins er aldrig med.
`;

const json = (navn: string, v: unknown): ZipFil => ({ navn, data: Buffer.from(`${JSON.stringify(v, null, 2)}\n`, 'utf8') });

export async function bygEksport(d: { db: Database; husstand: Pick<Husstand, 'forKonto'>; kilder: EksportKilder }, kontoId: number, nu: Date): Promise<Buffer> {
  const k = await hentKonto(d.db, kontoId);
  const p = await hentProfil(d.db, kontoId);
  if (!k || !p) throw new Error('ukendt konto');
  const [r] = await d.db.query<{ samtykke_ved: Date | null }>('SELECT samtykke_ved FROM konto WHERE id = $1', [kontoId]);
  const filer: ZipFil[] = [
    { navn: 'LAES-MIG.txt', data: Buffer.from(LAES_MIG, 'utf8') },
    json('konto/konto.json', {
      email: k.email, oprettet: k.oprettet, land: p.land, sprog: p.sprog,
      vilkaarVersion: p.vilkaar, privatlivVersion: p.privatliv, samtykkeVed: r?.samtykke_ved ? new Date(r.samtykke_ved) : null,
    }),
    json('konto/passkeys.json', (await passkeys(d.db, kontoId)).map((x) => ({ navn: x.navn, oprettet: x.oprettet, sidstBrugt: x.sidstBrugt }))),
    json('konto/sessioner.json', (await sessioner(d.db, kontoId, nu)).map((s) => ({ enhed: s.enhed, metode: s.metode, oprettet: s.oprettet, sidstSet: s.sidstSet }))),
  ];
  if (d.kilder.abonnement) filer.push(json('konto/abonnement.json', await d.kilder.abonnement(kontoId)));
  const t = await d.husstand.forKonto(kontoId);
  if (t?.rolle === 'ejer' && d.kilder.tenant) {
    const zip = await d.kilder.tenant(kontoId);
    if (zip) filer.push({ navn: 'clawco.zip', data: zip });
  }
  return lavZip(filer, { tid: nu });
}
