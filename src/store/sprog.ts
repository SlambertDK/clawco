// KC-0170: the language of the request being rendered, one place below the shell, so kilder/, graenser/, tillid/ and
// hushold/ can read it without importing shell/ (AGENTS §1 dependency direction). The composition root sets it once
// per request (medSprog in server.ts); shell/tekster.ts re-exports these. No language set = Danish: Henrik's
// installation, which predates the profile, renders exactly as before. Depends on nothing in src/ outside this folder.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Sprog } from './profil.ts';

export type { Sprog };

/** The language of an installation without a profile: Henrik's, from before Start existed. */
export const STANDARD_SPROG: Sprog = 'da';

const sprogNu$ = new AsyncLocalStorage<Sprog>();

/** Runs `fn` with `sprog` as the language of everything it renders (one request, one test). */
export const medSprog = <T>(sprog: Sprog, fn: () => T): T => sprogNu$.run(sprog, fn);

/** The language being rendered; STANDARD_SPROG when none is set (an installation without a profile). */
export const sprogNu = (): Sprog => sprogNu$.getStore() ?? STANDARD_SPROG;
