// Every string on the subscription pages and in the Checkout terms line, in one place so English can
// follow (the KC-0170 pattern). Plain text only: render.ts escapes all of it. The Checkout terms
// message is markdown (Stripe renders its links); the URLs in it come from the deps, never from a person.

const dato = (iso: string): string => new Date(iso).toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen', dateStyle: 'medium' });
const kr = (oere: number): string => (oere / 100).toLocaleString('da-DK', { maximumFractionDigits: 2 });

export const T = {
  planTitel: 'Vælg din plan',
  planIntro: 'Prøv Clawco gratis i 14 dage. Du skal ikke taste et kort. Når prøven slutter, sættes din Clawco på pause, indtil du selv vælger at betale. Der bliver aldrig trukket penge uden dit ja.',
  planIntroUdenProeve: 'Du har haft en gratis prøve før, så abonnementet begynder med det samme, når du har betalt.',
  afbrudt: 'Du afbrød betalingen. Dit valg er gemt herunder.',
  pris: (maaned: number, aar: number): string => `${kr(maaned)} kr. om måneden · ${kr(aar)} kr. om året`,
  medlemmer: (n: number): string => (n === 1 ? 'Til 1 person' : `Op til ${n} personer`),
  intervalTitel: 'Betal',
  maanedlig: 'hver måned',
  aarlig: 'hvert år',
  landFelt: 'Hvor bor du?',
  startProeve: 'Start 14 dages gratis prøve',
  tilBetaling: 'Gå til betaling',
  ingenMoms: 'Priserne er hele priser. Der er ingen moms oveni.',
  tilbage: 'Tilbage til din konto',

  abonnementTitel: 'Dit abonnement',
  status: {
    proeve: (slut: string | null): string => (slut ? `Gratis prøve til ${dato(slut)}` : 'Gratis prøve'),
    aktiv: (periode: string | null): string => (periode ? `Aktivt · næste betaling ${dato(periode)}` : 'Aktivt'),
    forfalden: (siden: string | null): string => (siden ? `Betalingen mangler siden ${dato(siden)}` : 'Betalingen mangler'),
    pause: 'På pause: prøven er slut. Vælg at betale for at fortsætte.',
    opsagt: 'Opsagt',
    ingen: 'Intet abonnement',
  },
  opsiges: (d: string): string => `Slutter ${dato(d)}`,
  gave: 'Gave (privat beta)',
  portalKnap: 'Kort, fakturaer og planskift',
  overGraense: (antal: number, max: number, plan: string, forslag: string | null): string =>
    `I er ${antal}, ${plan} er til ${max}: ${forslag ? `vælg ${forslag} eller ret medlemmerne` : 'ret medlemmerne'}. Ingen mister adgangen, men I kan ikke invitere flere lige nu.`,
  ejerTitel: 'Spørg den, der ejer abonnementet',
  ejerTekst: 'Det er ejeren af jeres Clawco, der vælger plan og betaler.',
  ikkeKlarTitel: 'Betaling er ikke slået til endnu',
  ikkeKlarTekst: 'Prøv igen senere. Intet er ændret.',
  fejlTitel: 'Det gik ikke',
  fejlTekst: 'Vi kunne ikke åbne betalingen lige nu. Intet er trukket. Prøv igen om lidt.',
  ugyldigtValg: 'Vælg en plan, hvor ofte du vil betale, og hvor du bor.',

  tilbageProeveTitel: 'Prøven er i gang',
  tilbageProeveTekst: (slut: string | null): string => `Din gratis prøve ${slut ? `slutter ${dato(slut)}` : 'er startet'}. Du skal ikke gøre mere nu.`,
  tilbageAktivTitel: 'Abonnementet er i gang',
  tilbageAktivTekst: 'Tak. Din betaling er modtaget.',
  tilbageAabenTitel: 'Betalingen er ikke gennemført',
  tilbageAabenTekst: 'Intet er trukket. Du kan vælge en plan igen.',
  ukendtTitel: 'Vi kender ikke den betaling',
  ukendtTekst: 'Linket hører ikke til din konto.',
  vaelgPlan: 'Vælg en plan',

  kontoResumeIngen: 'Intet abonnement endnu',

  devTitel: 'Stripe Checkout (falsk, kun udvikling)',
  devTekst: 'Her ville Stripes side stå. Intet kort, ingen betaling.',
  devKnap: 'Start prøven',
  devAfbryd: 'Afbryd',
} as const;

/** The line next to Stripe's terms checkbox (custom_text.terms_of_service_acceptance), markdown. */
export const VILKAAR = {
  da: (vilkaar: string, privatliv: string): string => `Jeg accepterer Clawcos [Vilkår](${vilkaar}) og har læst [Privatlivspolitikken](${privatliv}).`,
  en: (vilkaar: string, privatliv: string): string => `I accept Clawco's [Terms](${vilkaar}) and have read the [Privacy Policy](${privatliv}).`,
  udkast: { da: 'Vilkår og privatlivspolitik er udkast (testtilstand).', en: 'Terms and privacy policy are drafts (test mode).' },
} as const;
