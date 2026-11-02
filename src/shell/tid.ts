// Wall-clock time in Copenhagen, the one place that knows about its offset.
// Pure: no I/O. Shared by rooms and the shell (moved out of rooms/univers so
// Dagen can use it without importing another room).

const TZ = 'Europe/Copenhagen';
const dele = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Copenhagen's offset from UTC at an instant, in minutes (60 in winter, 120 in summer). */
function forskydning(ms: number): number {
  const p: Record<string, number> = {};
  for (const x of dele.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const somUtc = Date.UTC(p['year'] ?? 1970, (p['month'] ?? 1) - 1, p['day'] ?? 1, p['hour'] ?? 0, p['minute'] ?? 0, p['second'] ?? 0);
  return (somUtc - Math.floor(ms / 1000) * 1000) / 60_000;
}

/**
 * A `datetime-local` value ("2026-10-28T10:00", seconds optional) read as Copenhagen wall time → the ISO instant.
 * Correct across DST (the offset is taken at the resulting instant). A wall time that does not exist (the
 * spring gap) lands an hour later; an ambiguous one (autumn) takes the later instant. Null when unreadable.
 */
export function koebenhavnTilIso(lokal: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(lokal ?? '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const naiv = Date.UTC(y, mo - 1, d, h, mi, s);
  const tjek = new Date(naiv);
  if (tjek.getUTCFullYear() !== y || tjek.getUTCMonth() !== mo - 1 || tjek.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  const gaet = naiv - forskydning(naiv) * 60_000;
  return new Date(naiv - forskydning(gaet) * 60_000).toISOString();
}

/** YYYY-MM-DD for `now` in Copenhagen. */
export function idagKbh(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
