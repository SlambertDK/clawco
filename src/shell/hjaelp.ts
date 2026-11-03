// KC-0201: "Få hjælp" in the Clawco app's settings. Only under Clawco Sky (KC_SKY=ja, set by the fleet for a hosted
// Clawco); a self-installed Clawco never shows it. The link leads to the account app's help page, which builds the mail
// from an allowlist and shows it before anything is sent. The app builds no mail text itself and holds no plan or
// account number: Sky and the app share no code (sky/test/aftryk.test.ts), so the facts stay on Sky's side.

/** KC_SKY_URL reduced to its origin; https only (http for loopback in local development); no credentials. */
function skyOrigin(rå: string): string | null {
  let u: URL;
  try { u = new URL(rå.trim()); } catch { return null; }
  if (u.username || u.password || !u.hostname) return null;
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u.origin;
  return null;
}

/** The link for the settings panel, or null: not under Sky, or no usable address to point at (never a guess). */
export function hjaelpFraMiljoe(env: Record<string, string | undefined>): { href: string } | null {
  if ((env['KC_SKY'] ?? '').trim() !== 'ja') return null;
  const origin = skyOrigin(env['KC_SKY_URL'] ?? '');
  return origin ? { href: `${origin}/konto/hjaelp` } : null;
}

/** KC-0274 (C2): whether this install runs on Clawco Sky's server (KC_SKY=ja, set by the fleet). The connectors then never reach the host's own network. */
export function erSkyHostet(env: Record<string, string | undefined>): boolean {
  return (env['KC_SKY'] ?? '').trim() === 'ja';
}
