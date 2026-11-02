// Test data for every sign-up screen (KC-0198; the testtilstand rule, AGENTS §4 r11, for Sky): one fictional
// input per state, so the render tests cover each one and SKY_DEV shows them all at /dev/tilmelding without
// provisioning anything. No real person, no real address.
import { laesSamtykke } from './samtykke.ts';
import { FASER } from './trin.ts';
import type { Faelles, SideInput } from './render.ts';

export const PUBLIC = 'https://konto.eksempel.test';

const faelles: Faelles = { sprog: 'da', csrf: 'eksempel-csrf', tilstand: 'open' };
// Fictional plans and countries (the real ones come from config/priser.json and billing's list, via server.ts).
const planer = [
  { id: 'sky-solo', navn: 'Sky Solo', medlemmer: 1, maaned: 1000, aar: 10000 },
  { id: 'sky-husstand', navn: 'Sky Husstand', medlemmer: 6, maaned: 2000, aar: 20000 },
] as const;
const lande = ['DK', 'SE', 'DE', 'NL'] as const;
const samtykke = laesSamtykke();

export type Eksempel = { faelles: Faelles; side: SideInput };

export const EKSEMPLER: Record<string, Eksempel> = {
  konto: { faelles: { ...faelles, csrf: null }, side: { visning: { trin: 'konto' }, til: '/tilmeld?plan=sky-solo&interval=maaned' } },
  profil: { faelles, side: { visning: { trin: 'profil' }, lande, land: null, valgtSprog: null, samtykke, mangler: false, behold: { plan: 'sky-solo', interval: 'maaned' } } },
  'profil-mangler': { faelles, side: { visning: { trin: 'profil' }, lande, land: 'SE', valgtSprog: 'en', samtykke, mangler: true, behold: { plan: null, interval: null } } },
  samtykke: { faelles, side: { visning: { trin: 'samtykke' }, samtykke, mangler: false } },
  'samtykke-mangler': { faelles, side: { visning: { trin: 'samtykke' }, samtykke, mangler: true } },
  invitation: { faelles: { ...faelles, tilstand: 'invitation' }, side: { visning: { trin: 'invitation' }, svar: null } },
  'invitation-ikke-endnu': { faelles: { ...faelles, tilstand: 'invitation' }, side: { visning: { trin: 'invitation' }, svar: 'ikke-endnu' } },
  plan: { faelles, side: { visning: { trin: 'plan' }, planer, proeveDage: 14, valg: { plan: null, interval: null }, land: 'DK', proeve: true, afbrudt: false } },
  'plan-afbrudt': { faelles, side: { visning: { trin: 'plan' }, planer, proeveDage: 14, valg: { plan: 'sky-husstand', interval: 'aar' }, land: 'DK', proeve: true, afbrudt: true } },
  betaling: { faelles, side: { visning: { trin: 'betaling' }, proeve: true, session: 'cs_test_eksempel' } },
  ...Object.fromEntries(FASER.map((fase) => [`klargoering-${fase}`, { faelles, side: { visning: { trin: 'klargoering', fase, status: 'i-gang' } } }])),
  'klargoering-langsom': { faelles, side: { visning: { trin: 'klargoering', fase: 'startet', status: 'langsom' } } },
  'klargoering-fejlet': { faelles, side: { visning: { trin: 'klargoering', fase: 'startet', status: 'fejlet' } } },
  aabn: { faelles, side: { visning: { trin: 'aabn' }, aabnUrl: `${PUBLIC}/aabn?t=hus-abcdefgh&n=%2Frum%2Fstart&s=eksempel` } },
  abonnement: { faelles, side: { visning: { trin: 'abonnement' } } },
  slettes: { faelles, side: { visning: { trin: 'slettes' } } },
};
