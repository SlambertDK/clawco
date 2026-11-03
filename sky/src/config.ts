// Sky's configuration, read once at start. Fail-closed (AGENTS §0 r7): a missing or invalid key
// stops the process, and the error names the key, never its value (a database URL holds a password).

/** The tenant domain (gate G7, KC-0211, answered again 2026-10-31): every customer's Clawco lives on <slug>.clawco.work
 *  (first-level names are covered by the free Universal SSL certificate; the account app is konto.clawco.work).
 *  This is the only place the literal may appear; a test fails on any other hit. */
export const STANDARD_BASEDOMAIN = 'clawco.work';
export const STANDARD_PORT = 8781;

export type SkyConfig = {
  databaseUrl: string;
  publicUrl: string;
  port: number;
  basedomain: string;
  /** The passkey relying-party id: the public host, or SKY_RP_ID when that is a dotted suffix of it. */
  rpId: string;
  /** SKY_DEV=1: local development (the outbox page shows mails from the fake Post). */
  dev: boolean;
  /** KC-0212: the fleet driver (SKY_FLAADE). `ingen` = nothing is provisioned or deprovisioned yet. */
  flaade: FlaadeValg;
  /** KC-0198: SKY_TILMELDING — `invitation` (closed beta, the default: an invite code instead of the plan step)
   *  or `open` (the plan step). Never both ways at once. */
  tilmelding: 'invitation' | 'open';
  /** KC-0264: SKY_INKLUDERET_MODEL=ja switches the included Calm model on: tenants are told the proxy's address
   *  (KC_MODEL_PROXY_URL) and the proxy answers. It still answers 503 until a provider key is set and the provider
   *  is a listed subprocessor (model/udbyder.ts). Off by default. */
  inkluderetModel: boolean;
};

export type FlaadeValg = { driver: 'ingen' } | { driver: 'hetzner' } | { driver: 'lokal'; billede: string; netvaerk: string; kontoPubkey: string;
  /** KC-0217: the NEXT public key while the gateway's signing key is being rotated (SKY_KONTO_PUBKEY_NY); absent = no rotation in progress. */
  kontoPubkeyNy?: string };
export const STANDARD_NETVAERK = 'clawco-sky';


function kraevet(env: Record<string, string | undefined>, noegle: string): string {
  const v = (env[noegle] ?? '').trim();
  if (!v) throw new Error(`${noegle} mangler — Sky starter ikke uden den (se sky/.env.example)`);
  return v;
}

function ugyldig(noegle: string, hvad: string): Error {
  return new Error(`${noegle} er ugyldig: ${hvad} — Sky starter ikke`);
}

export function laesConfig(env: Record<string, string | undefined>): SkyConfig {
  const databaseUrl = kraevet(env, 'SKY_DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw ugyldig('SKY_DATABASE_URL', 'skal begynde med postgres:// eller postgresql://');

  const publicUrl = kraevet(env, 'SKY_PUBLIC_URL');
  let protokol = '';
  let vaert = '';
  try { ({ protocol: protokol, hostname: vaert } = new URL(publicUrl)); } catch { /* reported below */ }
  if (protokol !== 'https:' && protokol !== 'http:') throw ugyldig('SKY_PUBLIC_URL', 'skal være en http(s)-adresse');
  // WebAuthn has no relying-party id for an IP address; use a name (localhost for local development).
  if (/^[\d.]+$/.test(vaert) || vaert.startsWith('[')) throw ugyldig('SKY_PUBLIC_URL', 'skal have et værtsnavn, ikke en IP-adresse (passkeys kræver et navn; brug localhost lokalt)');

  // Gate G7: the account app lives on the public host; the RP id defaults to exactly that host and
  // may only widen to a dotted suffix of it, never to something the host is not under.
  const rpId = (env['SKY_RP_ID'] ?? '').trim().toLowerCase() || vaert;
  if (rpId !== vaert && !(rpId.includes('.') && vaert.endsWith(`.${rpId}`))) throw ugyldig('SKY_RP_ID', 'skal være værtsnavnet i SKY_PUBLIC_URL eller et domæne med punktum, som det ligger under');

  const portTekst = (env['SKY_PORT'] ?? '').trim();
  const port = portTekst ? Number(portTekst) : STANDARD_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw ugyldig('SKY_PORT', 'skal være et heltal fra 1 til 65535');

  const dev = (env['SKY_DEV'] ?? '').trim() === '1';
  const basedomain = (env['SKY_BASEDOMAIN'] ?? '').trim() || STANDARD_BASEDOMAIN;
  // KC-0183: in local development tenants may live on <slug>.localhost (browsers resolve it to loopback and
  // treat it as secure, so the gateway's __Host- cookie works over plain http). Never in production.
  const devLokal = dev && basedomain === 'localhost';
  if (!devLokal && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(basedomain)) throw ugyldig('SKY_BASEDOMAIN', 'skal være et domænenavn uden protokol, fx eksempel.dk');

  const tilmelding = (env['SKY_TILMELDING'] ?? '').trim() || 'invitation';
  if (tilmelding !== 'invitation' && tilmelding !== 'open') throw ugyldig('SKY_TILMELDING', 'skal være invitation eller open');

  const model = (env['SKY_INKLUDERET_MODEL'] ?? '').trim() || 'nej';
  if (model !== 'ja' && model !== 'nej') throw ugyldig('SKY_INKLUDERET_MODEL', 'skal være ja eller nej');

  return { databaseUrl, publicUrl, port, basedomain, rpId, dev, flaade: flaadeValg(env), tilmelding, inkluderetModel: model === 'ja' };
}

function flaadeValg(env: Record<string, string | undefined>): FlaadeValg {
  const driver = (env['SKY_FLAADE'] ?? '').trim() || 'ingen';
  if (driver === 'ingen' || driver === 'hetzner') return { driver };
  if (driver !== 'lokal') throw ugyldig('SKY_FLAADE', 'skal være ingen, lokal eller hetzner');
  const billede = kraevet(env, 'SKY_TENANT_BILLEDE');
  if (!/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/.test(billede)) throw ugyldig('SKY_TENANT_BILLEDE', 'skal være et Docker-billede som navn:tag');
  const netvaerk = (env['SKY_TENANT_NETVAERK'] ?? '').trim() || STANDARD_NETVAERK;
  // Docker's own networks would put tenants on the host's network or with no network at all.
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(netvaerk) || ['host', 'bridge', 'none'].includes(netvaerk)) throw ugyldig('SKY_TENANT_NETVAERK', 'skal være et eget Docker-netværk, ikke et af Dockers indbyggede');
  // KC-0182: the gateway's Ed25519 public key (KC-0179/KC-0183), handed to every tenant as KC_KONTO_PUBKEY:
  // raw 32 bytes, base64url without padding. Without it a tenant refuses every request, so Sky refuses to
  // start instead. Its private half is SKY_GATEWAY_SIGNERINGSNOEGLE (gateway/noegle.ts), checked against it at start.
  const kontoPubkey = kraevet(env, 'SKY_KONTO_PUBKEY');
  if (!offentligNoegle(kontoPubkey)) throw ugyldig('SKY_KONTO_PUBKEY', PUBKEY_KRAV);
  // KC-0217: during a rotation (sky/deploy/gateway/README.md) every tenant is given the next key too, as
  // KC_KONTO_PUBKEY_NY, so it accepts both. Absent = no rotation in progress. The same key twice is a mistake.
  const kontoPubkeyNy = (env['SKY_KONTO_PUBKEY_NY'] ?? '').trim();
  if (kontoPubkeyNy && !offentligNoegle(kontoPubkeyNy)) throw ugyldig('SKY_KONTO_PUBKEY_NY', PUBKEY_KRAV);
  if (kontoPubkeyNy === kontoPubkey) throw ugyldig('SKY_KONTO_PUBKEY_NY', 'er den samme nøgle som SKY_KONTO_PUBKEY, og et nøgleskift skal have en ny nøgle (fjern SKY_KONTO_PUBKEY_NY, eller sæt den nye nøgle)');
  return { driver, billede, netvaerk, kontoPubkey, ...(kontoPubkeyNy ? { kontoPubkeyNy } : {}) };
}

const PUBKEY_KRAV = 'skal være en Ed25519-offentlig nøgle: 32 bytes som base64url uden udfyldning (43 tegn)';
const offentligNoegle = (v: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(v) && Buffer.from(v, 'base64url').toString('base64url') === v;

/** KC-0185: where the nightly copies go (Cloudflare R2, the free tier, an EU-jurisdiction bucket). The secret is a
 *  function so no JSON or log of this object can carry it. */
export type KopiConfig = { kontoId: string; jurisdiktion: string; bucket: string; noegleId: string; hemmelighed: () => string; testTenant: string | null };

export const R2_NOEGLER = ['SKY_R2_ACCOUNT_ID', 'SKY_R2_ACCESS_KEY_ID', 'SKY_R2_SECRET_ACCESS_KEY', 'SKY_R2_BUCKET'] as const;

/**
 * Reads the copy store's settings. None of the four R2 keys = backups off ({ kopi: null, fejl: null }); some of
 * them = backups off with an error naming the missing ones (fail closed, never half-configured). Reading removes
 * the two credentials from `env`, so child processes (docker, pg_dump) never inherit them. Errors name keys only.
 */
export function laesKopiConfig(env: Record<string, string | undefined>): { kopi: KopiConfig | null; fejl: string | null } {
  const v = (k: string) => (env[k] ?? '').trim();
  const noegleId = v('SKY_R2_ACCESS_KEY_ID');
  const hemmelighed = v('SKY_R2_SECRET_ACCESS_KEY');
  delete env['SKY_R2_ACCESS_KEY_ID'];
  delete env['SKY_R2_SECRET_ACCESS_KEY'];
  const vaerdier: Record<string, string> = { SKY_R2_ACCOUNT_ID: v('SKY_R2_ACCOUNT_ID'), SKY_R2_ACCESS_KEY_ID: noegleId, SKY_R2_SECRET_ACCESS_KEY: hemmelighed, SKY_R2_BUCKET: v('SKY_R2_BUCKET') };
  const mangler = R2_NOEGLER.filter((k) => !vaerdier[k]);
  if (mangler.length === R2_NOEGLER.length) return { kopi: null, fejl: null };
  if (mangler.length) return { kopi: null, fejl: `sikkerhedskopier er slået fra: ${mangler.join(', ')} mangler (se sky/.env.example)` };
  const kontoId = vaerdier['SKY_R2_ACCOUNT_ID']!;
  if (!/^[a-f0-9]{32}$/.test(kontoId)) return { kopi: null, fejl: 'sikkerhedskopier er slået fra: SKY_R2_ACCOUNT_ID er ugyldig (32 hex-tegn)' };
  const bucket = vaerdier['SKY_R2_BUCKET']!;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return { kopi: null, fejl: 'sikkerhedskopier er slået fra: SKY_R2_BUCKET er ugyldig' };
  // Unset = eu (the bucket lives in Cloudflare's EU jurisdiction); set but empty = the plain endpoint.
  const jurisdiktion = env['SKY_R2_JURISDICTION'] === undefined ? 'eu' : v('SKY_R2_JURISDICTION');
  if (jurisdiktion && !/^[a-z]{2,8}$/.test(jurisdiktion)) return { kopi: null, fejl: 'sikkerhedskopier er slået fra: SKY_R2_JURISDICTION er ugyldig (fx eu, eller tom)' };
  const testTenant = v('SKY_KOPI_TESTTENANT') || null;
  if (testTenant && !/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(testTenant)) return { kopi: null, fejl: 'sikkerhedskopier er slået fra: SKY_KOPI_TESTTENANT er ugyldig' };
  return { kopi: { kontoId, jurisdiktion, bucket, noegleId, hemmelighed: () => hemmelighed, testTenant }, fejl: null };
}

/** KC-0186: where an upgrade's restore points go while R2 is not set up — a 0700 directory on the Sky host
 *  (drift/backup/lager.ts lokalKopiLager). Absolute; default /srv/sky/kopier. */
export function lokaleKopier(env: Record<string, string | undefined>): string {
  const v = (env['SKY_LOKALE_KOPIER'] ?? '').trim() || '/srv/sky/kopier';
  if (!v.startsWith('/')) throw new Error('SKY_LOKALE_KOPIER skal være en absolut sti');
  return v;
}
