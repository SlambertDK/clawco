// Shared setup for the status feed's tests (KC-0189): component seams that all answer well unless told otherwise,
// deterministic tenant slugs, and a fleet fixture whose ids, addresses and emails are distinctive enough to grep for.
import type { Database } from '../../../src/db/pool.ts';
import type { KomponentDeps } from '../../../src/drift/helbred/komponenter.ts';
import { findEllerOpretKonto } from '../../../src/konto/konto.ts';
import { noterPost } from '../../../src/drift/helbred/historik.ts';

const ALFABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** hus-<8 base32 letters>, distinct per i (the fleet's slug form). */
export function slugNr(i: number): string {
  let s = '';
  let n = i + 1_000_003 * 7;
  for (let k = 0; k < 8; k++) { s += ALFABET[n % 32]; n = Math.floor(n / 32); }
  return `hus-${s}`;
}

export const KONTO_ORIGIN = 'https://konto.example.test';

export function komponentDeps(db: Database, o: Partial<KomponentDeps> = {}): KomponentDeps {
  return {
    db,
    sky: async () => true,
    konto: async () => true,
    adgang: async () => ({ status: 302, location: `${KONTO_ORIGIN}/aabn?t=x` }),
    kontoOrigin: KONTO_ORIGIN,
    provisioneringer: async () => [],
    flaadeKlar: true,
    kopierSlaaetTil: true,
    kopiTenanter: async () => [],
    ...o,
  };
}

export type Fixture = { slugs: string[]; emails: string[]; adresser: string[]; kontoIder: string[]; tenantIder: string[] };

/** n accounts and n klar tenants, with identity values far from any count the feed could hold (6-digit ids). */
export async function flaade(db: Database, n: number, nu: Date, sha: string): Promise<Fixture> {
  await db.exec('ALTER TABLE konto ALTER COLUMN id RESTART WITH 913001; ALTER TABLE flaade.tenant ALTER COLUMN id RESTART WITH 827001;');
  const f: Fixture = { slugs: [], emails: [], adresser: [], kontoIder: [], tenantIder: [] };
  for (let i = 0; i < n; i++) {
    const email = `kunde-${i}@example.test`;
    const { konto } = await findEllerOpretKonto(db, email, nu);
    const slug = slugNr(i);
    const adresse = `http://10.77.${Math.floor(i / 200)}.${(i % 200) + 2}:8750`;
    const t = nu.toISOString();
    const [r] = await db.query<{ id: number }>(
      `INSERT INTO flaade.tenant (slug, ejer_konto_id, driver, tilstand, bestilt, startet, sund, i_gateway, klar, billede, release, adresse, oprettet, opdateret)
       VALUES ($1, $2, 'lokal', 'klar', $3, $3, $3, $3, $3, $4, $5, $6, $3, $3) RETURNING id`,
      [slug, konto.id, t, `sha256:${'c'.repeat(64)}`, sha, adresse],
    );
    f.slugs.push(slug);
    f.emails.push(email);
    f.adresser.push(adresse);
    f.kontoIder.push(String(konto.id));
    f.tenantIder.push(String(r!.id));
  }
  return f;
}

/** Sky's own database copied just now and one mail sent: the two components that need history to be ok. */
export async function godeKopierOgPost(db: Database, nu: Date): Promise<void> {
  await db.query("INSERT INTO drift.kopi (omfang, oprettet, sidste_forsoeg, sidste_succes) VALUES ('db', $1, $1, $1)", [nu.toISOString()]);
  await noterPost(db, { tid: nu, ok: true, kode: null });
}
