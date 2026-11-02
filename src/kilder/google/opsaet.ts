// The steps of making one's own Google app, shared by the Google connectors
// (KC-0133 calendar, KC-0135 Gmail): one entry per step, in the words of the
// Google Cloud console's Google Auth platform (checked 2026-10-31). Text only.

import { googleTekst } from './tekster.ts';
import type { KildeKort } from '../types.ts';

type Trin = NonNullable<KildeKort['trin']>;

/** The step that tells Google where to send the person back: a value to copy, or why it cannot be shown yet. */
function klientTrin(tilbage: string | null): Trin[number] {
  const t = googleTekst();
  return tilbage ? { tekst: t.klientTrinMedAdresse, kopier: tilbage } : { tekst: t.klientTrinUdenAdresse };
}

/**
 * Making the app from scratch. `api`: the Google API to enable (the calendar needs one; IMAP mail needs none).
 * `scope`: a scope the app must be allowed to ask for under "Data Access", shown ready to copy.
 */
export function googleOpsaetTrin(o: { tilbage: string | null; api?: string; scope?: string }): Trin {
  const t = googleTekst();
  return [
    { tekst: t.trinProjekt },
    ...(o.api ? [{ tekst: t.trinApi(o.api) }] : []),
    { tekst: t.trinBranding },
    { tekst: t.trinTestbruger },
    ...(o.scope ? [{ tekst: t.trinScope, kopier: o.scope }] : []),
    klientTrin(o.tilbage),
    { tekst: t.trinPublicer },
    { tekst: t.trinNoegler },
  ];
}

/**
 * Adding a second connector to an app that already works for another one: the same app and the same client keys, but
 * Google must be told this connector's return address, and the app allowed to ask for its scope.
 */
export function googleTilfoejTrin(o: { tilbage: string | null; scope: string }): Trin {
  const t = googleTekst();
  return [
    o.tilbage ? { tekst: t.tilfoejMedAdresse, kopier: o.tilbage } : { tekst: t.tilfoejUdenAdresse },
    { tekst: t.trinScope, kopier: o.scope },
  ];
}
