// Test data for the account app's export view and delete confirmation (KC-0206; the testtilstand rule, AGENTS §4 r11,
// for Sky): one fictional input per state, so the render tests cover each one and SKY_DEV shows them all at
// /dev/konto without an account. No real person, no real address.
import type { KontoEksempel } from './render.ts';

const csrf = 'eksempel-csrf';
const email = 'eksempel@eksempel.test';

export const EKSEMPLER: Record<string, KontoEksempel> = {
  'hent-alt': { side: 'hent-alt', a: { csrf, frisk: true } },
  'hent-alt-ikke-frisk': { side: 'hent-alt', a: { csrf, frisk: false } },
  'hent-alt-klar': { side: 'hent-alt-klar', a: { csrf, link: '/konto/hent-alt/fil?t=eksempel-eksempel-eksempel-eksempel-eksempe', udloeber: new Date('2026-11-02T10:00:00Z') } },
  'hent-alt-doed': { side: 'hent-alt-doed' },
  'hent-alt-fejl': { side: 'hent-alt-fejl' },
  'slet-ejer': { side: 'slet', a: { csrf, frisk: true, oversigt: { email, rolle: 'ejer', medlemmer: ['mor@eksempel.test'] } } },
  'slet-medlem': { side: 'slet', a: { csrf, frisk: true, oversigt: { email, rolle: 'medlem', medlemmer: [] } } },
  'slet-alene': { side: 'slet', a: { csrf, frisk: true, oversigt: { email, rolle: null, medlemmer: [] } } },
  'slet-forkert-email': { side: 'slet', a: { csrf, frisk: true, oversigt: { email, rolle: 'ejer', medlemmer: [] }, fejl: 'Det er ikke mailen på denne konto.' } },
  'slet-ikke-frisk': { side: 'slet', a: { csrf, frisk: false, oversigt: { email, rolle: 'ejer', medlemmer: [] } } },
  slettet: { side: 'slettet' },
};
