// Every string on the sign-up pages (KC-0198), Danish and English (KC-0170). Plain text only: render.ts escapes
// all of it. English must have exactly Danish's keys (the type and a test hold that). No legal text here: the
// consent lines only link to the routes where KC-0174's texts will live.

/** An amount in its own currency (KC-0194: kroner in Denmark, euro elsewhere); whole amounts without decimals. */
const kr = (oere: number, sprog: 'da' | 'en', valuta: 'dkk' | 'eur'): string => {
  const d = oere % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(sprog === 'da' ? 'da-DK' : 'en-GB', { style: 'currency', currency: valuta.toUpperCase(), maximumFractionDigits: d, minimumFractionDigits: d }).format(oere / 100);
};

const da = {
  trin: (n: number, af: number, navn: string): string => `Trin ${n} af ${af} · ${navn}`,
  trinNavn: { konto: 'Konto', plan: 'Plan', invitation: 'Invitation', betaling: 'Betaling', klargoering: 'Klargøring', aabn: 'Åbn Clawco' },
  andetSprog: 'English',

  kontoTitel: 'Kom i gang med Clawco i skyen',
  kontoIntro: 'Skriv din mail, så sender vi dig et link. Der er ingen adgangskode. Linket opretter din konto.',
  emailFelt: 'Din mail',
  sendLink: 'Send mig et link',
  harKonto: 'Har du allerede en konto med passkey?',
  logIndPasskey: 'Log ind med passkey',

  profilTitel: 'Om dig',
  profilIntro: 'Tre ting, så er din konto klar.',
  landFelt: 'Hvor bor du?',
  vaelgLand: 'Vælg land',
  sprogFelt: 'Sprog',
  sprogDa: 'Dansk',
  sprogEn: 'English',
  samtykkeTitel: 'Det skal du sige ja til',
  vilkaarFoer: 'Jeg accepterer ',
  vilkaarLink: 'vilkårene',
  privatlivFoer: 'Jeg har læst ',
  privatlivLink: 'privatlivspolitikken',
  fortsaet: 'Fortsæt',
  profilMangler: 'Vælg land og sprog, og sæt begge flueben for at fortsætte.',
  samtykkeNytTitel: 'Vilkårene er ændret',
  samtykkeNytIntro: 'Vi har opdateret vores vilkår eller privatlivspolitik. Sig ja til den nye version for at fortsætte. Dine data er urørte.',
  versionNr: (v: string): string => `(version ${v})`,
  samtykkeNytMangler: 'Sæt begge flueben for at fortsætte.',
  samtykkeNytHellere: 'Vil du ikke sige ja, kan du i stedet slette din konto. Det kræver ikke, at du accepterer.',
  samtykkeNytKonto: 'Gå til din konto',
  samtykkeNytSlet: 'Slet min konto',

  invitationTitel: 'Tilmelding kræver en invitation',
  invitationIntro: 'Clawco i skyen er i lukket beta. Har du fået en invitationskode, skriver du den her.',
  kodeFelt: 'Invitationskode',
  brugKode: 'Brug koden',
  kodeIkkeEndnu: 'Invitationskoder kan ikke indløses endnu. Din konto er gemt, så du kan fortsætte her, når du har fået adgang.',
  kodeUkendt: 'Den kode kender vi ikke. Tjek, at den er skrevet rigtigt.',

  planTitel: 'Vælg din plan',
  planIntro: (dage: number): string => `${dage} dage gratis, intet kort. Når prøven slutter, sættes din Clawco på pause, indtil du selv vælger at betale.`,
  planIntroUdenProeve: 'Du har haft en gratis prøve før, så abonnementet begynder, når du har betalt.',
  medlemmer: (n: number): string => (n === 1 ? 'Til 1 person' : `Op til ${n} personer`),
  pris: (maaned: number, aar: number, valuta: 'dkk' | 'eur'): string => `${kr(maaned, 'da', valuta)} om måneden · ${kr(aar, 'da', valuta)} om året`,
  intervalFelt: 'Betal',
  maanedlig: 'hver måned',
  aarlig: 'hvert år',
  startProeve: (dage: number): string => `Start ${dage} dages gratis prøve`,
  tilBetaling: 'Gå til betaling',
  videre: 'Videre til bekræftelse',
  // KC-0194 (G6): no VAT is mentioned while moms.aktiv is false; the second line is for when it is true.
  fuldPris: 'Prisen er den fulde pris.',
  fuldPrisMoms: 'Prisen er den fulde pris, inkl. moms.',
  afbrudt: 'Du afbrød betalingen. Dit valg er gemt herunder.',

  betalingProeveTitel: 'Prøven er i gang',
  betalingTitel: 'Betalingen er gennemført',
  betalingTekst: 'Vi venter på besked fra Stripe, så går vi i gang med din Clawco.',
  betalingVenter: 'Vi venter på Stripe, det plejer at tage få sekunder.',

  klargoeringTitel: 'Vi gør din Clawco klar…',
  klargoeringIntro: 'Din helt egen Clawco bliver sat op. Du kan lukke fanen. Logger du ind igen, fortsætter du her.',
  fase: { bestilt: 'Din Clawco er bestilt', startet: 'Den starter op', sund: 'Vi tjekker, at den svarer', 'i-gateway': 'Din egen adresse bliver åbnet' },
  faseFaerdig: 'færdig',
  faseIGang: 'i gang',
  faseVenter: 'venter',
  langsom: 'Det tager længere end normalt, vi har fået besked. Du behøver ikke gøre noget.',
  fejlet: 'Klargøringen gik i stå. Det er ikke noget, du har gjort. Prøv igen, så fortsætter vi, hvor den slap. Du får ikke to.',
  proevIgen: 'Prøv igen',

  aabnTitel: 'Din Clawco er klar',
  aabnTekst: 'Tryk på knappen, så er du inde.',
  aabnKnap: 'Åbn Clawco',

  abonnementTitel: 'Dit abonnement skal ses efter',
  abonnementTekst: 'Din prøve eller din betaling er sat på pause. Ret det på abonnementssiden, så kan du åbne din Clawco igen.',
  abonnementLink: 'Se abonnement',

  slettesTitel: 'Din Clawco bliver slettet',
  slettesTekst: 'Den kan ikke åbnes mere.',
  tilKonto: 'Til din konto',
};

export type Tekster = typeof da;

const en: Tekster = {
  trin: (n, af, navn) => `Step ${n} of ${af} · ${navn}`,
  trinNavn: { konto: 'Account', plan: 'Plan', invitation: 'Invitation', betaling: 'Payment', klargoering: 'Setting up', aabn: 'Open Clawco' },
  andetSprog: 'Dansk',

  kontoTitel: 'Get started with Clawco in the cloud',
  kontoIntro: 'Enter your email and we will send you a link. There is no password. The link creates your account.',
  emailFelt: 'Your email',
  sendLink: 'Send me a link',
  harKonto: 'Already have an account with a passkey?',
  logIndPasskey: 'Log in with a passkey',

  profilTitel: 'About you',
  profilIntro: 'Three things, and your account is ready.',
  landFelt: 'Where do you live?',
  vaelgLand: 'Choose a country',
  sprogFelt: 'Language',
  sprogDa: 'Dansk',
  sprogEn: 'English',
  samtykkeTitel: 'What you agree to',
  vilkaarFoer: 'I accept the ',
  vilkaarLink: 'terms',
  privatlivFoer: 'I have read the ',
  privatlivLink: 'privacy policy',
  fortsaet: 'Continue',
  profilMangler: 'Choose a country and a language, and tick both boxes to continue.',
  samtykkeNytTitel: 'The terms have changed',
  samtykkeNytIntro: 'We have updated our terms or privacy policy. Accept the new version to continue. Your data is untouched.',
  versionNr: (v: string): string => `(version ${v})`,
  samtykkeNytMangler: 'Tick both boxes to continue.',
  samtykkeNytHellere: 'If you would rather not accept, you can delete your account instead. That does not require you to accept.',
  samtykkeNytKonto: 'Go to your account',
  samtykkeNytSlet: 'Delete my account',

  invitationTitel: 'Sign-up needs an invitation',
  invitationIntro: 'Clawco in the cloud is in a closed beta. If you have an invitation code, enter it here.',
  kodeFelt: 'Invitation code',
  brugKode: 'Use the code',
  kodeIkkeEndnu: 'Invitation codes cannot be redeemed yet. Your account is saved, so you can continue here once you have access.',
  kodeUkendt: 'We do not know that code. Check that it is spelled correctly.',

  planTitel: 'Choose your plan',
  planIntro: (dage) => `${dage} days free, no card. When the trial ends, your Clawco is paused until you choose to pay.`,
  planIntroUdenProeve: 'You have had a free trial before, so the subscription starts once you have paid.',
  medlemmer: (n) => (n === 1 ? 'For 1 person' : `Up to ${n} people`),
  pris: (maaned, aar, valuta) => `${kr(maaned, 'en', valuta)} per month · ${kr(aar, 'en', valuta)} per year`,
  intervalFelt: 'Pay',
  maanedlig: 'every month',
  aarlig: 'every year',
  startProeve: (dage) => `Start the ${dage}-day free trial`,
  tilBetaling: 'Go to payment',
  videre: 'Continue to confirmation',
  fuldPris: 'The price is the full price.',
  fuldPrisMoms: 'The price is the full price, VAT included.',
  afbrudt: 'You cancelled the payment. Your choice is kept below.',

  betalingProeveTitel: 'Your trial has started',
  betalingTitel: 'Payment complete',
  betalingTekst: 'We are waiting for word from Stripe, then we start on your Clawco.',
  betalingVenter: 'We are waiting for Stripe, it usually takes a few seconds.',

  klargoeringTitel: 'We are getting your Clawco ready…',
  klargoeringIntro: 'Your very own Clawco is being set up. You can close this tab. Log in again and you will continue here.',
  fase: { bestilt: 'Your Clawco is ordered', startet: 'It is starting up', sund: 'We check that it answers', 'i-gateway': 'Your own address is being opened' },
  faseFaerdig: 'done',
  faseIGang: 'in progress',
  faseVenter: 'waiting',
  langsom: 'This is taking longer than usual, and we have been told. You do not need to do anything.',
  fejlet: 'The setup got stuck. It is nothing you did. Try again and we carry on where it stopped. You will not get two.',
  proevIgen: 'Try again',

  aabnTitel: 'Your Clawco is ready',
  aabnTekst: 'Press the button and you are in.',
  aabnKnap: 'Open Clawco',

  abonnementTitel: 'Your subscription needs a look',
  abonnementTekst: 'Your trial or your payment is paused. Fix it on the subscription page, and you can open your Clawco again.',
  abonnementLink: 'See subscription',

  slettesTitel: 'Your Clawco is being deleted',
  slettesTekst: 'It can no longer be opened.',
  tilKonto: 'To your account',
};

export const TEKSTER: { da: Tekster; en: Tekster } = { da, en };
