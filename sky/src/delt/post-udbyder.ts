// The real Post (KC-0178): Resend over plain fetch (no SDK), the only file that knows the provider.
// Before sending, the sending domain must prove three things through Resend's own domain API: it is
// verified, it sends from the EU region (eu-west-1, Ireland), and open and click tracking are off
// (Resend has no per-message tracking flag; tracking is a per-domain setting, so we read it and refuse
// rather than change Henrik's account). A key that cannot read domains cannot prove that: refused.
// Note (read 2026-10-31, docs/superpowers/plans/2026-10-31-kc-0178-post-resend.md): the region decides
// where mail is sent from; Resend stores account data, metadata and logs in the USA (SCC + DPF).
// Logs name the template and a masked recipient (first character + domain), never the link.
import { randomUUID } from 'node:crypto';
import { PostFejl, falskPost, ingenPost, renderBesked, type Besked, type Post } from './post.ts';

export const RESEND_API = 'https://api.resend.com';
export const EU_REGION = 'eu-west-1';
/** How long a passed domain check holds before it is read again (a tracking change is seen within this). */
export const DOMAENE_CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;

/** The default sender: Clawco on the tenant domain (config.basedomain, so the literal stays in config.ts). */
export const standardAfsender = (basedomain: string): string => `Clawco <hej@${basedomain}>`;

export type ResendIndstillinger = {
  noegle: string;
  afsender: string;
  /** Tests point this at a local stand-in; production uses RESEND_API. */
  api?: string;
  nu?: () => number;
  log?: (linje: string) => void;
};

/** `h…@example.test`: enough to tell mails apart in a log, not enough to name the person. */
export function maskerModtager(adresse: string): string {
  const at = adresse.lastIndexOf('@');
  if (at < 1) return '…';
  return `${adresse[0]}…${adresse.slice(at)}`;
}

/** The provider's error name, only when it is a plain identifier (its message may echo the mail). */
function fejlNavn(krop: unknown): string {
  const n = (krop as { name?: unknown } | null)?.name;
  return typeof n === 'string' && /^[a-z_]{1,64}$/.test(n) ? n : 'ukendt';
}

const NOEGLE_NAVNE = new Set(['missing_api_key', 'restricted_api_key', 'suspended_api_key', 'invalid_permission']);

/** `opslag`: a domain lookup, where Resend answers an invalid key with 400 validation_error, so any
 *  refusal there (but a rate limit) is the key's fault; on /emails a 4xx is about the message. */
function somFejl(status: number, navn: string, hvad: string, opslag: boolean): PostFejl {
  const tekst = `Resend afviste ${hvad} (${status} ${navn})`;
  if (status === 401 || NOEGLE_NAVNE.has(navn)) return new PostFejl('noegle', tekst);
  if (opslag && status >= 400 && status < 500 && status !== 429) return new PostFejl('noegle', tekst);
  if (status === 429) return new PostFejl('kvote', tekst);
  if (status >= 400 && status < 500) return new PostFejl('afvist', tekst);
  return new PostFejl('udbyder', tekst);
}

export function resendPost(i: ResendIndstillinger): Post {
  const api = i.api ?? RESEND_API;
  const nu = i.nu ?? Date.now;
  const log = i.log ?? ((l: string) => console.log(l));
  const domaeneNavn = i.afsender.slice(i.afsender.lastIndexOf('@') + 1).replace(/>$/, '').toLowerCase();
  let godkendtTil = 0;

  async function kald(metode: 'GET' | 'POST', sti: string, hvad: string, krop?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${i.noegle}` };
    if (krop !== undefined) {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = randomUUID();
    }
    let svar: Response;
    try {
      svar = await fetch(`${api}${sti}`, { method: metode, headers, signal: AbortSignal.timeout(TIMEOUT_MS), ...(krop !== undefined ? { body: JSON.stringify(krop) } : {}) });
    } catch {
      throw new PostFejl('netvaerk', `Resend kunne ikke nås (${hvad})`);
    }
    let data: unknown = null;
    try { data = await svar.json(); } catch { /* an empty or non-JSON body; judged by the status below */ }
    if (!svar.ok) throw somFejl(svar.status, fejlNavn(data), hvad, metode === 'GET');
    return data;
  }

  async function tjekDomaene(): Promise<void> {
    if (nu() < godkendtTil) return;
    const liste = await kald('GET', '/domains', 'opslag af domæner') as { data?: { id?: unknown; name?: unknown }[] } | null;
    const fundet = (liste?.data ?? []).find((d) => d.name === domaeneNavn);
    if (!fundet || typeof fundet.id !== 'string') throw new PostFejl('domaene', `afsenderdomænet ${domaeneNavn} findes ikke i Resend`);
    const d = await kald('GET', `/domains/${encodeURIComponent(fundet.id)}`, 'opslag af domænet') as Record<string, unknown> | null;
    if (d?.['status'] !== 'verified') throw new PostFejl('domaene', `afsenderdomænet ${domaeneNavn} er ikke bekræftet i Resend`);
    if (d['region'] !== EU_REGION) throw new PostFejl('region', `afsenderdomænet ${domaeneNavn} sender ikke fra ${EU_REGION}`);
    if (d['open_tracking'] === true || d['click_tracking'] === true) throw new PostFejl('sporing', `afsenderdomænet ${domaeneNavn} har sporing slået til (open/click tracking)`);
    godkendtTil = nu() + DOMAENE_CACHE_MS;
  }

  return {
    async send(b: Besked) {
      const til = `${b.skabelon} til ${maskerModtager(b.til)}`;
      try {
        const mail = renderBesked(b);
        await tjekDomaene();
        const svar = await kald('POST', '/emails', 'mailen', { from: i.afsender, to: [b.til], subject: mail.emne, text: mail.tekst, html: mail.html }) as { id?: unknown } | null;
        if (typeof svar?.id !== 'string') throw new PostFejl('udbyder', 'Resend svarede uden et id');
        log(`sky post: ${til} sendt`);
      } catch (err) {
        const f = err instanceof PostFejl ? err : new PostFejl('udbyder', 'uventet fejl ved afsendelse');
        log(`sky post: ${til} ikke sendt (${f.kode}): ${f.message}`);
        throw f;
      }
    },
  };
}

// "Name <local@domain>" or a bare address; the name without quotes or angle brackets; a dotted domain.
const ADRESSE = /^[A-Za-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const NAVN = /^[^<>"\u0000-\u001f\u007f]{1,64}$/;

function gyldigAfsender(v: string): boolean {
  const m = /^(.*?)\s*<([^<>]*)>$/.exec(v);
  if (!m) return ADRESSE.test(v);
  return NAVN.test(m[1] ?? '') && ADRESSE.test(m[2] ?? '');
}

/** The Post Sky uses: the fake with SKY_DEV=1 (development never sends real mail), Resend when
 *  SKY_RESEND_API_KEY is set, otherwise ingenPost (every send refuses: fail closed, never the fake).
 *  A malformed key or sender throws at start, naming the key only. */
export function postFraEnv(env: Record<string, string | undefined>, config: { dev: boolean; basedomain: string }, ekstra: Pick<ResendIndstillinger, 'api' | 'log'> = {}): Post {
  if (config.dev) return falskPost();
  const noegle = (env['SKY_RESEND_API_KEY'] ?? '').trim();
  if (!noegle) return ingenPost();
  if (!/^re_[A-Za-z0-9_]+$/.test(noegle)) throw new Error('SKY_RESEND_API_KEY er ugyldig: skal være en Resend-nøgle (re_…) — Sky starter ikke');
  const afsender = (env['SKY_POST_AFSENDER'] ?? '').trim() || standardAfsender(config.basedomain);
  if (!gyldigAfsender(afsender)) throw new Error('SKY_POST_AFSENDER er ugyldig: skal være "Navn <adresse@domæne>" eller en adresse — Sky starter ikke');
  return resendPost({ noegle, afsender, ...ekstra });
}
