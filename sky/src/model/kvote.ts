// KC-0264: the included model's month and cap, pure. A month is the UTC calendar month (the allowance is part of every
// Sky plan, not an add-on with its own billing anchor); it resets on the first day of the next month.

/** The month a call belongs to, as its first day: 'YYYY-MM-01'. */
export function maanedFor(nu: Date): string {
  return `${nu.getUTCFullYear()}-${String(nu.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** The day the allowance starts over: the first day of the next UTC month, 'YYYY-MM-DD'. */
export function nulstilles(nu: Date): string {
  return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** Whole percent of the cap used, 0..100 (100 when there is no cap to use). */
export function procent(brugtMikroUsd: number, loftMikroUsd: number): number {
  if (loftMikroUsd <= 0) return 100;
  return Math.min(100, Math.floor((brugtMikroUsd * 100) / loftMikroUsd));
}

/** True when the month's spend has reached the cap: the next call is refused before it is forwarded. */
export const loftNaaet = (brugtMikroUsd: number, loftMikroUsd: number): boolean => brugtMikroUsd >= loftMikroUsd;
