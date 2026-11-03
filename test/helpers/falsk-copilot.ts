// KC-0263: fakes for the Copilot sign-in and transport in the server tests — a GitHub device flow (an injected fetch)
// and a Copilot runtime (a LavKlient) that answers every session with one short text. Nothing reaches GitHub.

import type { CopilotHaendelse, CopilotKlient, CopilotKlientValg, CopilotSession, CopilotSessionValg, LavKlient } from '../../src/agent/copilot.ts';

export const FALSK_TOKEN = 'gho_HEMMELIGfalsktoken0263abcdefghij';
export const FALSK_ENHED = 'dc_HEMMELIG_falsk_enhed_0263';
export const FALSK_KODE = 'WDJB-MJHT';

/** GitHub's device flow: a code, `ventRunder` polls of authorization_pending, then the token; GET /user answers the login. */
export function falskGithubFetch(o: { login?: string; ventRunder?: number; svar?: 'token' | 'access_denied' | 'expired_token' } = {}): { fetchImpl: typeof fetch; kald: string[] } {
  const kald: string[] = [];
  let polls = 0;
  const json = (d: unknown, status = 200): Response => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    kald.push(url);
    if (url.endsWith('/login/device/code')) return json({ device_code: FALSK_ENHED, user_code: FALSK_KODE, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    if (url.endsWith('/login/oauth/access_token')) {
      polls++;
      if (polls <= (o.ventRunder ?? 0)) return json({ error: 'authorization_pending' });
      if (o.svar && o.svar !== 'token') return json({ error: o.svar });
      return json({ access_token: FALSK_TOKEN, token_type: 'bearer', scope: 'read:user' });
    }
    if (url.endsWith('/user')) return json({ login: o.login ?? 'henrik-l', email: 'gemmes@ikke.example' });
    return json({}, 404);
  }) as typeof fetch;
  return { fetchImpl, kald };
}

/** A Copilot runtime that answers every prompt with `tekst`; records the client options, sessions and stops. */
export function falskCopilotKlient(tekst = 'klar'): { lavKlient: LavKlient; klienter: { valg: CopilotKlientValg; stoppet: number; sessioner: CopilotSessionValg[] }[] } {
  const klienter: { valg: CopilotKlientValg; stoppet: number; sessioner: CopilotSessionValg[] }[] = [];
  const lavKlient: LavKlient = (valg) => {
    const rec = { valg, stoppet: 0, sessioner: [] as CopilotSessionValg[] };
    klienter.push(rec);
    const k: CopilotKlient = {
      async start() {},
      async stop() { rec.stoppet++; return []; },
      async deleteSession() {},
      async createSession(cfg) {
        rec.sessioner.push(cfg);
        let h: ((e: CopilotHaendelse) => void) | undefined;
        const s: CopilotSession = {
          sessionId: `s${rec.sessioner.length}`,
          on(fn) { h = fn; return () => { h = undefined; }; },
          async send() {
            queueMicrotask(() => { h?.({ type: 'assistant.message_delta', data: { deltaContent: tekst } }); h?.({ type: 'session.idle', data: {} }); });
            return 'm1';
          },
          async abort() {},
          async disconnect() {},
        };
        return s;
      },
    };
    return k;
  };
  return { lavKlient, klienter };
}
