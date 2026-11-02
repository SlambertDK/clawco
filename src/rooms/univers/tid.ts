// The calendar poller's window. koebenhavnTilIso lives in shell/tid.ts (shared with Dagen);
// it is re-exported here so the univers code keeps one import.
export { koebenhavnTilIso } from '../../shell/tid.ts';

const TZ = 'Europe/Copenhagen';

/** The calendar poller runs between 06:00 and 22:00 Copenhagen time. */
export function iVinduet(now: Date): boolean {
  const t = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return t >= 6 && t < 22;
}
