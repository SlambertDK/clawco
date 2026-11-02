// Frontloading: rebuild rooms at fixed Copenhagen times so the heavy work is
// done before Henrik looks. Spec: "mail=06:50,12:00,17:00;nyheder=07:08".

export type FrontloadSpec = { room: string; tider: string[] }[];

export function parseFrontload(spec: string): FrontloadSpec {
  const out: FrontloadSpec = [];
  for (const part of spec.split(';')) {
    const [room, times] = part.split('=').map((x) => x?.trim());
    if (!room || !times || !/^[a-z0-9-]+$/.test(room)) continue;
    const tider = times.split(',').map((t) => t.trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
    if (tider.length) out.push({ room, tider });
  }
  return out;
}

function copenhagenHHMM(d: Date): string {
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace('.', ':');
}
function copenhagenDay(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Rooms due at this minute; `seen` remembers "day minute room" so a minute fires once. */
export function dueNow(spec: FrontloadSpec, now: Date, seen: Set<string>): string[] {
  const hhmm = copenhagenHHMM(now);
  const key = `${copenhagenDay(now)} ${hhmm}`;
  const due: string[] = [];
  for (const s of spec) {
    if (!s.tider.includes(hhmm)) continue;
    const k = `${key} ${s.room}`;
    if (seen.has(k)) continue;
    seen.add(k);
    due.push(s.room);
  }
  if (seen.size > 500) { const first = seen.values().next().value; if (first) seen.delete(first); }
  return due;
}

/** `aktiv` (KC-0124): false while Clawco is paused — the tick does nothing then, and a minute it skipped is not marked seen. */
export function startScheduler(spec: FrontloadSpec, onDue: (room: string) => void, everyMs = 30_000, aktiv: () => boolean = () => true): () => void {
  const seen = new Set<string>();
  const tick = () => { if (!aktiv()) return; for (const room of dueNow(spec, new Date(), seen)) onDue(room); };
  const t = setInterval(tick, everyMs);
  t.unref();
  return () => clearInterval(t);
}

/**
 * KC-0149: a plain clock for state that changes with time (a request's reminders and expiry). Calls `tik` every
 * `everyMs` while `aktiv()`; a tick still running is not overlapped, and a tick that throws is said in the journal.
 */
export function startTik(tik: () => Promise<void>, everyMs = 60_000, aktiv: () => boolean = () => true): () => void {
  let igang = false;
  const t = setInterval(() => {
    if (igang || !aktiv()) return;
    igang = true;
    tik().catch((err: unknown) => console.error('tik:', err instanceof Error ? err.message : err)).finally(() => { igang = false; });
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}

// Kuratoren: "07-22/60" = every 60 minutes from 07:00 up to (not including) 22:00, Copenhagen time.
export type KuratorPlan = { fra: number; til: number; hverMin: number };

/** `""`, `"fra"` and anything unreadable mean off (null). */
export function parseKuratorPlan(spec: string): KuratorPlan | null {
  const m = /^(\d{1,2})-(\d{1,2})\/(\d{1,4})$/.exec(spec.trim());
  if (!m) return null;
  const fra = Number(m[1]); const til = Number(m[2]); const hverMin = Number(m[3]);
  if (fra > 23 || til > 24 || fra >= til || hverMin < 1) return null;
  return { fra, til, hverMin };
}

function copenhagenHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' }).format(d));
}

/** Inside [fra, til) in Copenhagen and at least hverMin minutes since `sidst` (ISO of the last run; unreadable = never). */
export function kuratorDue(plan: KuratorPlan, now: Date, sidst?: string): boolean {
  const h = copenhagenHour(now);
  if (h < plan.fra || h >= plan.til) return false;
  const last = sidst ? Date.parse(sidst) : NaN;
  return Number.isNaN(last) || now.getTime() - last >= plan.hverMin * 60_000;
}

// KC-0152: the Saturday conflict's check — Tuesdays from a clock time ("07:30"), Copenhagen time.
export type KonfliktPlan = { kl: string };

/** `""`, `"fra"` and anything but HH:MM mean off (null). */
export function parseKonfliktPlan(spec: string): KonfliktPlan | null {
  const kl = spec.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(kl) ? { kl } : null;
}

/** A Tuesday in Copenhagen, at or after the plan's time. Once per weekend is the room's own gate (it remembers the Saturday it checked), so a restart later on Tuesday catches up. */
export function konfliktDue(plan: KonfliktPlan, now: Date): boolean {
  const ugedag = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', weekday: 'short' }).format(now);
  return ugedag === 'Tue' && copenhagenHHMM(now) >= plan.kl;
}

/**
 * KC-0145: the Sunday sample — a Sunday in Copenhagen, from 18:00. Once per week is the job's own gate (the ledger holds
 * the week), so a restart later on Sunday evening catches up.
 */
export function soendagDue(now: Date): boolean {
  const ugedag = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', weekday: 'short' }).format(now);
  return ugedag === 'Sun' && copenhagenHHMM(now) >= '18:00';
}
