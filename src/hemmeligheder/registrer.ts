// KC-0125: wraps a NoegleLager (env or encrypted file, KC-0180/0181) so every key it saves or hands out is registered
// with the one redactor (src/graenser/redaktion.ts). src/agent/ imports nothing of the app, so this lives here and the
// composition root (server.ts lavAgent) applies it.
import type { NoegleLager } from '../agent/noeglelager.ts';
import { registrerHemmelighed } from '../graenser/redaktion.ts';

export function registrerNoegleLager(lager: NoegleLager): NoegleLager {
  return {
    async hent(udbyder) {
      const v = await lager.hent(udbyder);
      if (v) registrerHemmelighed(v);
      return v;
    },
    findes: (udbyder) => lager.findes(udbyder),
    fjern: (udbyder) => lager.fjern(udbyder),
    async saet(udbyder, noegle) {
      const svar = await lager.saet(udbyder, noegle);
      registrerHemmelighed(noegle);
      return svar;
    },
  };
}
