// The steps of making one's own Google app, shared by the Google connectors
// (KC-0133 calendar, KC-0135 Gmail): one entry per step, in the words of the
// Google Cloud console's Google Auth platform (checked 2026-10-31). Text only.

import type { KildeKort } from '../types.ts';

type Trin = NonNullable<KildeKort['trin']>;

/** The step that tells Google where to send the person back: a value to copy, or why it cannot be shown yet. */
function klientTrin(tilbage: string | null): Trin[number] {
  return tilbage
    ? { tekst: 'Under "Clients": tryk "Create client", vælg "Web application", og indsæt denne adresse under "Authorized redirect URIs".', kopier: tilbage }
    : { tekst: 'Under "Clients": tryk "Create client" og vælg "Web application". Clawco kender ikke sin egen adresse endnu (KC_ADRESSE), så adressen, Google skal sende dig tilbage til, kan ikke vises. Ejeren skal sætte den først.' };
}

/**
 * Making the app from scratch. `api`: the Google API to enable (the calendar needs one; IMAP mail needs none).
 * `scope`: a scope the app must be allowed to ask for under "Data Access", shown ready to copy.
 */
export function googleOpsaetTrin(o: { tilbage: string | null; api?: string; scope?: string }): Trin {
  return [
    { tekst: 'Åbn console.cloud.google.com med din egen Google-konto, og lav et nyt projekt, fx "Clawco".' },
    ...(o.api ? [{ tekst: `Gå til "APIs & Services" og "Library", søg efter "${o.api}", og tryk "Enable".` }] : []),
    { tekst: 'Gå til "Google Auth platform" og "Branding", tryk "Get started", giv appen et navn og din mail, og vælg "External" som målgruppe.' },
    { tekst: 'Under "Audience": tilføj din egen Google-konto som testbruger.' },
    ...(o.scope ? [{ tekst: 'Under "Data Access": tryk "Add or remove scopes", og tilføj denne tilladelse.', kopier: o.scope }] : []),
    klientTrin(o.tilbage),
    { tekst: 'Under "Audience": tryk "Publish app", så adgangen ikke udløber efter syv dage. Google kalder appen ikke godkendt; det er i orden, når det er din egen app til dig selv.' },
    { tekst: 'Kopiér klient-id og klienthemmelighed fra "Clients", og sæt dem ind herunder.' },
  ];
}

/**
 * Adding a second connector to an app that already works for another one: the same app and the same client keys, but
 * Google must be told this connector's return address, and the app allowed to ask for its scope.
 */
export function googleTilfoejTrin(o: { tilbage: string | null; scope: string }): Trin {
  return [
    o.tilbage
      ? { tekst: 'Google-appen kender endnu kun den første forbindelses returadresse. Åbn din klient under "Clients" i "Google Auth platform", og tilføj denne adresse under "Authorized redirect URIs".', kopier: o.tilbage }
      : { tekst: 'Google-appen skal kende denne forbindelses returadresse under "Authorized redirect URIs", men Clawco kender ikke sin egen adresse endnu (KC_ADRESSE). Ejeren skal sætte den først.' },
    { tekst: 'Under "Data Access": tryk "Add or remove scopes", og tilføj denne tilladelse.', kopier: o.scope },
  ];
}
