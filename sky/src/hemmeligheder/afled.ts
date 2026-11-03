// Purpose keys from a tenant's DEK (KC-0181): HKDF-SHA256 with one fixed label each, the tenant id in
// the info, so one leaked purpose key opens nothing else. `volume` = disk encryption (KC-0182),
// `backup` = the backup repository password (KC-0185), `lager` = the tenant's own secrets file
// (src/hemmeligheder/lager-fil.ts, the only key that ever enters the tenant's container), `model` = the seed of the
// tenant's model token (KC-0264, modeltoken.ts: the token, not this key, is what the container gets).
// Control-plane keys (KC-0185) come from the master key instead, under their own labels and salt:
// `db-backup` seals the nightly pg_dump of Sky's database.
import { hkdfSync } from 'node:crypto';
import { skjul, type Hemmelig } from './skjul.ts';

export const FORMAAL = ['volume', 'backup', 'lager', 'model'] as const;
export type Formaal = (typeof FORMAAL)[number];

const SALT = Buffer.from('clawco-sky/afled/v1', 'utf8');

export function afled(dek: Hemmelig, tenant: string, formaal: Formaal): Hemmelig {
  if (!FORMAAL.includes(formaal)) throw new Error(`ukendt formål: ${String(formaal).slice(0, 20)}`);
  return skjul(Buffer.from(hkdfSync('sha256', dek.aaben(), SALT, Buffer.from(`${formaal}\0${tenant}`, 'utf8'), 32)));
}

export const KONTROLPLAN_FORMAAL = ['db-backup'] as const;
export type KontrolplanFormaal = (typeof KONTROLPLAN_FORMAAL)[number];

const KONTROLPLAN_SALT = Buffer.from('clawco-sky/afled/kontrolplan/v1', 'utf8');

export function afledKontrolplan(kek: Hemmelig, formaal: KontrolplanFormaal): Hemmelig {
  if (!KONTROLPLAN_FORMAAL.includes(formaal)) throw new Error(`ukendt formål: ${String(formaal).slice(0, 20)}`);
  return skjul(Buffer.from(hkdfSync('sha256', kek.aaben(), KONTROLPLAN_SALT, Buffer.from(formaal, 'utf8'), 32)));
}
