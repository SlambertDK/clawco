// KC-0160: laptop mode — one person on their own laptop, no server, no Tailscale needed. Switched on by KC_LAPTOP=ja
// (the installer's --laptop). What it means:
//  - the process binds loopback only: Clawco has no accounts, so anything on the same Wi-Fi could otherwise open it,
//    which would break "never exposed" (AGENTS.md product constraints); a LAN address with KC_LAPTOP=ja refuses to start;
//  - every request is the one owner (ENEBRUGER) and the Tailscale identity header is ignored entirely (server.ts hands
//    createApp `laptop`; Funnel traffic is still refused);
//  - Start leaves the household question out and the Tailscale card explains the phone limit honestly.
// Phone access is the same as on a box: Tailscale on laptop and phone plus Serve (KC-0161), reachable only while the
// laptop is awake. Tailscale Serve, as the proxy that adds the header, is the trust boundary in household mode only.

import { erLoopback } from './identitet.ts';

/** Whether the settings ask for laptop mode; throws, naming the key to fix, when they contradict it. */
export function laptopFraMiljoe(e: Record<string, string | undefined>): boolean {
  if ((e['KC_LAPTOP'] ?? '').trim().toLowerCase() !== 'ja') return false;
  const vaert = (e['KC_HOST'] ?? '').trim().replace(/^\[|\]$/g, '');
  if (vaert && vaert !== 'localhost' && !erLoopback(vaert)) {
    throw new Error(`KC_LAPTOP=ja lytter kun på denne maskine, men KC_HOST er ${vaert.slice(0, 60)}. Sæt KC_HOST til 127.0.0.1 eller fjern den.`);
  }
  if ((e['KC_IDENTITET'] ?? '').trim() === 'konto') throw new Error('KC_LAPTOP=ja kan ikke bruges sammen med KC_IDENTITET=konto. Fjern en af dem.');
  return true;
}
