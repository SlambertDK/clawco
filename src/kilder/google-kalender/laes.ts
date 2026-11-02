// The week ahead from Google Calendar (KC-0133): calendarList, then
// events.list per calendar for seven days from Copenhagen midnight, written
// in exactly the JSON scripts/kalender_uge.py prints, so Dagen's trimUge and
// naeste.ts read it unchanged. Calendar fields only — never a description or
// a conference link. One calendar failing goes to `errors`; the list failing
// is a KildeFejl (never an empty week). Event text is untrusted (the
// connector's read is uklar; invites carry other people's text).
//
// Where the script differs, on purpose: an event that began before the window
// (a multi-day all-day event, a night shift) stands on the first day instead
// of being dropped; a declined invite and a cancelled event are left out; a
// calendar the user renamed carries their name (summaryOverride).

import { KildeFejl, type KalenderData } from '../types.ts';
import { ENDPOINTS, type Hent } from '../google/oauth.ts';

const TZ = 'Europe/Copenhagen';
const MAKS_KALENDERE = 50;
const MAKS_SIDER = 4;

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const DATO = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const TID = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });

/** YYYY-MM-DD in Copenhagen (the same as src/rooms/dagen/source.ts copenhagenDate; src/kilder may not import rooms). */
export const kbhDato = (d: Date): string => DATO.format(d);
/** "+01:00" / "+02:00" at that instant in Copenhagen. */
function kbhOffset(d: Date): string {
  const navn = OFFSET.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return navn === 'GMT' ? '+00:00' : navn.replace('GMT', '');
}
const offsetMin = (o: string): number => (o.startsWith('-') ? -1 : 1) * (Number(o.slice(1, 3)) * 60 + Number(o.slice(4, 6)));
const plusDage = (dato: string, n: number): string => {
  const [y, m, d] = dato.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Copenhagen midnight of `dato` as RFC 3339 with its own offset (summer or winter time). */
function midnat(dato: string): string {
  const utc = Date.parse(`${dato}T00:00:00Z`);
  let o = kbhOffset(new Date(utc - 60 * 60_000));
  o = kbhOffset(new Date(utc - offsetMin(o) * 60_000));
  return `${dato}T00:00:00${o}`;
}
const iso = (d: Date): string => `${kbhDato(d)}T${TID.format(d)}${kbhOffset(d)}`;

type Svar = { status: number; json: unknown };

/** One API GET with the bearer token; a 401 asks `adgang(true)` for a fresh token once and retries. */
async function hentApi(hent: Hent, adgang: (ny?: boolean) => Promise<string>, url: string): Promise<Svar> {
  for (let forsoeg = 0; ; forsoeg += 1) {
    const tok = await adgang(forsoeg > 0);
    const r = await hent(url, { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } });
    if (r.status === 401 && forsoeg === 0) continue;
    let json: unknown = null;
    try { json = await r.json(); } catch { /* status says enough */ }
    return { status: r.status, json };
  }
}

/** Every page of a list endpoint (`items` + `nextPageToken`), at most MAKS_SIDER pages. */
async function alleSider(hent: Hent, adgang: (ny?: boolean) => Promise<string>, base: string, q: Record<string, string>): Promise<{ ok: true; items: unknown[] } | { ok: false; status: number }> {
  const items: unknown[] = [];
  let side: string | null = null;
  for (let i = 0; i < MAKS_SIDER; i += 1) {
    const p = new URLSearchParams({ ...q, ...(side ? { pageToken: side } : {}) });
    const s = await hentApi(hent, adgang, `${base}?${p}`);
    if (s.status !== 200 || !erObj(s.json)) return { ok: false, status: s.status };
    if (Array.isArray(s.json['items'])) items.push(...s.json['items']);
    side = str(s.json['nextPageToken']);
    if (!side) break;
  }
  return { ok: true, items };
}

type Begivenhed = Record<string, unknown> & { start: string; all_day: boolean };

function begivenhed(e: unknown, kalender: string): { dag: string; ms: number; ud: Begivenhed } | null {
  if (!erObj(e) || e['status'] === 'cancelled') return null;
  const st = erObj(e['start']) ? e['start'] : {};
  const en = erObj(e['end']) ? e['end'] : {};
  const heldag = typeof st['date'] === 'string';
  const start = str(heldag ? st['date'] : st['dateTime']);
  if (!start) return null;
  const ms = Date.parse(heldag ? `${start}T00:00:00Z` : start);
  if (Number.isNaN(ms)) return null;
  const deltagere = (Array.isArray(e['attendees']) ? e['attendees'] : []).filter(erObj);
  if (deltagere.some((p) => p['self'] === true && p['responseStatus'] === 'declined')) return null;
  const creator = erObj(e['creator']) ? str(e['creator']['email']) : null;
  return {
    dag: heldag ? start.slice(0, 10) : kbhDato(new Date(ms)),
    ms,
    ud: {
      start, end: str(heldag ? en['date'] : en['dateTime']), all_day: heldag, title: str(e['summary']) ?? '(uden titel)', calendar: kalender,
      location: str(e['location']), creator, id: str(e['id']),
      attendees: deltagere.filter((p) => p['resource'] !== true).map((p) => ({ name: str(p['displayName']), email: str(p['email']), self: p['self'] === true })),
    },
  };
}

/** The week from `nu` (Copenhagen midnight), `dage` days (default 7), in the kalender_uge.py shape. */
export async function laesUge(o: { hent: Hent; adgang: (ny?: boolean) => Promise<string>; nu: Date; dage?: number }): Promise<KalenderData> {
  const n = o.dage ?? 7;
  const foerste = kbhDato(o.nu);
  const datoer = Array.from({ length: n }, (_, i) => plusDage(foerste, i));
  const timeMin = midnat(foerste);
  const timeMax = midnat(plusDage(foerste, n));
  const dage = new Map<string, { ms: number; e: Begivenhed }[]>(datoer.map((d) => [d, []]));
  const errors: string[] = [];

  let liste;
  try { liste = await alleSider(o.hent, o.adgang, `${ENDPOINTS.kalender}/users/me/calendarList`, {}); } catch (err) {
    if (err instanceof KildeFejl) throw err;
    throw new KildeFejl(502, 'Google Kalender kunne ikke nås.');
  }
  if (!liste.ok) throw new KildeFejl(502, `Kalenderlisten kunne ikke hentes fra Google (fejl ${liste.status}).`);

  for (const kal of liste.items.filter(erObj).slice(0, MAKS_KALENDERE)) {
    const id = str(kal['id']);
    if (!id) continue;
    const navn = str(kal['summaryOverride']) ?? str(kal['summary']) ?? id;
    let r;
    try {
      r = await alleSider(o.hent, o.adgang, `${ENDPOINTS.kalender}/calendars/${encodeURIComponent(id)}/events`, { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    } catch (err) {
      if (err instanceof KildeFejl) throw err; // the token itself failed: the whole read fails, health says why
      errors.push(`${navn}: netværksfejl`);
      continue;
    }
    if (!r.ok) { errors.push(`${navn}: HTTP ${r.status}`); continue; }
    for (const raw of r.items) {
      const b = begivenhed(raw, navn);
      if (!b) continue;
      const dag = b.dag < foerste ? foerste : b.dag;
      dage.get(dag)?.push({ ms: b.ms, e: b.ud });
    }
  }

  return {
    generated: iso(o.nu),
    days: datoer.map((date) => ({
      date,
      events: (dage.get(date) ?? []).sort((a, b) => Number(b.e.all_day) - Number(a.e.all_day) || a.ms - b.ms).map((x) => x.e),
    })),
    errors,
  };
}
