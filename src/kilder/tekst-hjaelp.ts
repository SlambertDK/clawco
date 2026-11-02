// KC-0170: the one helper the connector tables share. A table `{ da, en }` is read at call time through the language of
// the request (src/store/sprog.ts), never at module load; a CONSTANT that code and tests already import as one object
// (FEJLTEKST, GENFORBIND_KANAL, KNAP, the scope demands) stays one object: `sproglig` answers each property from the
// table of the language being rendered. src/kilder/ imports nothing from src/shell/ (AGENTS §1), so the seam is
// src/store/sprog.ts, which depends on nothing here.

import { sprogNu } from '../store/sprog.ts';

type Tabeller<T> = { da: T; en: T };

/** The table of the language being rendered (Danish when none is set). */
export const efterSprog = <T>(t: Tabeller<T>): T => t[sprogNu()];

/** An object whose every property is read from the table of the language being rendered, at the time it is read. */
export function sproglig<T extends object>(t: Tabeller<T>): T {
  return new Proxy({} as T, {
    get: (_mål, noegle) => Reflect.get(efterSprog(t), noegle),
    has: (_mål, noegle) => Reflect.has(efterSprog(t), noegle),
    ownKeys: () => Reflect.ownKeys(efterSprog(t)),
    getOwnPropertyDescriptor: (_mål, noegle) => {
      const d = Reflect.getOwnPropertyDescriptor(efterSprog(t), noegle);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}
