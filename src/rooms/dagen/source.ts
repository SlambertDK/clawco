// Raw data in for Dagen: the JSON Kira's morning-paper pipeline writes on
// kira-home (`morgenavis_cron.py` → /tmp/avis_data_<date>.json, see
// hermes-kira-state). We trim it to what Hermes needs for judgment and never
// pass mail bodies, tasks payloads or raw health numbers on.

import { readFile } from 'node:fs/promises';

export type TrimmedKalender = { titel: string; start: string; slut?: string; kalender?: string; sted?: string; heldag?: boolean };
export type TrimmedNyhed = { titel: string; kilde: string; url?: string; resume?: string; udgivet?: string };
export type TrimmedForpligtelse = { titel: string; frist?: string; kilde?: string };

export type TrimmedAvis = {
  dato: string;
  hentet: string;
  helbred?: string;
  kalender: TrimmedKalender[];
  nyheder: TrimmedNyhed[];
  forpligtelser: TrimmedForpligtelse[];
  mail: { venter: number; emner: string[] };
};

const TZ = 'Europe/Copenhagen';
const MAX_NYHEDER = 30;

/** YYYY-MM-DD for `now` in Copenhagen time. */
export function copenhagenDate(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** HH.MM (Danish style) for an ISO datetime, in Copenhagen time. */
export function copenhagenTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

export function sourcePathFor(pattern: string, now: Date): string {
  return pattern.replaceAll('{date}', copenhagenDate(now));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const s = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Calendar events as the readers write them (the morning paper's kontroltaarn, kalender_uge.py) → what Hermes needs. */
function trimKalender(events: unknown): TrimmedKalender[] {
  const kalender: TrimmedKalender[] = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!isObj(e)) continue;
    const titel = s(e['title'], 200);
    if (!titel) continue;
    const allDay = e['all_day'] === true;
    const post: TrimmedKalender = { titel, start: allDay ? s(e['start'], 10) : copenhagenTime(s(e['start'], 40)) };
    if (!allDay) { const slut = copenhagenTime(s(e['end'], 40)); if (slut) post.slut = slut; }
    const kal = s(e['calendar'], 80); if (kal) post.kalender = kal;
    const sted = s(e['location'], 120); if (sted) post.sted = sted;
    if (allDay) post.heldag = true;
    kalender.push(post);
  }
  return kalender;
}

/**
 * KC-0133: the day without a morning paper (a product install, no Kira) — today's events from the connected calendar's
 * week (the kalender_uge.py JSON), nothing else. null when the week has no day for today.
 */
export function dagFraUge(uge: unknown, now: Date): TrimmedAvis | null {
  const root = isObj(uge) ? uge : {};
  const dato = copenhagenDate(now);
  const dag = (Array.isArray(root['days']) ? root['days'] : []).find((d): d is Record<string, unknown> => isObj(d) && d['date'] === dato);
  if (!dag) return null;
  return { dato, hentet: s(root['generated'], 40), kalender: trimKalender(dag['events']), nyheder: [], forpligtelser: [], mail: { venter: 0, emner: [] } };
}

export function trimAvisData(raw: unknown): TrimmedAvis {
  const root = isObj(raw) ? raw : {};
  const kt = isObj(root['kontroltaarn']) ? root['kontroltaarn'] : {};
  const cal = isObj(kt['calendar']) ? kt['calendar'] : {};

  const kalender = trimKalender(cal['events']);

  const nyheder: TrimmedNyhed[] = [];
  for (const src of Array.isArray(root['sources']) ? root['sources'] : []) {
    if (!isObj(src)) continue;
    const kilde = s(src['source'], 80);
    if (!kilde || src['type'] === 'tasks' || src['type'] === 'experiment') continue;
    for (const it of Array.isArray(src['items']) ? src['items'] : []) {
      if (!isObj(it)) continue;
      const titel = s(it['title'], 200);
      if (!titel) continue;
      const n: TrimmedNyhed = { titel, kilde };
      const url = s(it['url'], 2000); if (/^https?:\/\//i.test(url)) n.url = url;
      const resume = s(it['summary'], 240); if (resume) n.resume = resume;
      const udgivet = s(it['published'], 40); if (udgivet) n.udgivet = udgivet;
      nyheder.push(n);
    }
  }
  nyheder.sort((a, b) => (b.udgivet ?? '').localeCompare(a.udgivet ?? ''));

  const forpligtelser: TrimmedForpligtelse[] = [];
  for (const f of Array.isArray(kt['commitment_radar']) ? kt['commitment_radar'] : []) {
    if (!isObj(f)) continue;
    const titel = s(f['title'], 200);
    if (!titel) continue;
    const p: TrimmedForpligtelse = { titel };
    const frist = s(f['due'], 20); if (frist) p.frist = frist;
    const kilde = s(f['source'], 40); if (kilde) p.kilde = kilde;
    forpligtelser.push(p);
  }

  const proton = isObj(kt['proton']) ? kt['proton'] : {};
  const emner: string[] = [];
  for (const m of Array.isArray(proton['attention']) ? proton['attention'] : []) {
    if (isObj(m)) { const e = s(m['subject'], 160); if (e) emner.push(e); }
  }
  const venter = typeof proton['count_attention'] === 'number' ? proton['count_attention'] : emner.length;

  const health = isObj(root['health']) ? root['health'] : {};
  const out: TrimmedAvis = {
    dato: s(kt['generated_date'], 10) || s(root['fetched_at'], 10),
    hentet: s(root['fetched_at'], 40),
    kalender,
    nyheder: nyheder.slice(0, MAX_NYHEDER),
    forpligtelser,
    mail: { venter, emner: emner.slice(0, 10) },
  };
  const helbred = s(health['status'], 40); if (helbred) out.helbred = helbred;
  return out;
}

/** null when there is no file for today (before 07:00, or the cron failed). */
export async function readDagenSource(pattern: string, now: Date): Promise<TrimmedAvis | null> {
  const file = sourcePathFor(pattern, now);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const trimmed = trimAvisData(JSON.parse(text));
  if (!trimmed.dato) trimmed.dato = copenhagenDate(now);
  return trimmed;
}
