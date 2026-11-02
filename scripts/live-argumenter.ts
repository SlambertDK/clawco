// KC-0069: how `npm run live:tjek` reads its command line, kept pure so a test can hold it (scripts/live-tjek.mjs does the browsing).
//   npm run live:tjek -- [/sti …] [--skaermbillede <dir>] [--sha <sha>] [--test | --kold]
// Without --test every positional argument is a path. With --test (KC-0068) the run walks the test world: a path limits the
// check to that route (at every moment), a moment id (a word that is not a path) limits it to that moment, and with neither
// each moment is checked at its own landing page. --kold is a test run over the cold start's moments only.

export type LiveArgumenter = {
  test: boolean;
  kold: boolean;
  /** Explicit paths; without --test, `/rum/hjem` when none were given. With --test, empty = each moment's own landing page. */
  stier: string[];
  /** Moment ids given with --test; empty = every moment. */
  momenter: string[];
  skaermDir?: string;
  sha?: string;
  /** What could not be understood; the script prints these and stops. */
  fejl: string[];
};

/** `sti` null = the page the jump itself lands on (the moment's own url, which only the server's answer to the jump tells). */
export type PlanTrin = { moment: string; sti: string | null; navn: string };

export function parseLiveArgumenter(args: readonly string[]): LiveArgumenter {
  const fejl: string[] = [];
  let skaermDir: string | undefined;
  let sha: string | undefined;
  let kold = false;
  let test = false;
  const stier: string[] = [];
  const ord: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--skaermbillede' || a === '--sha') {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) { fejl.push(`${a} mangler sin værdi`); continue; }
      i++;
      if (a === '--sha') sha = v; else skaermDir = v;
    } else if (a === '--test') test = true;
    else if (a === '--kold') { kold = true; test = true; }
    else if (a.startsWith('/')) stier.push(a);
    else ord.push(a);
  }
  const momenter = test ? ord : [];
  if (!test) for (const o of ord) fejl.push(`"${o}" er ikke en sti (en sti begynder med /); et øjeblik kan kun vælges sammen med --test`);
  return { test, kold, stier: !test && stier.length === 0 ? ['/rum/hjem'] : stier, momenter, ...(skaermDir !== undefined ? { skaermDir } : {}), ...(sha !== undefined ? { sha } : {}), fejl };
}

/** What to visit in the test world: the chosen moments (all, or the cold ones for --kold) × the chosen paths (or the moment's own landing page, `sti` null). */
export function testPlan(momenter: readonly { id: string }[], a: LiveArgumenter): { plan: PlanTrin[]; fejl: string[] } {
  const ukendte = a.momenter.filter((id) => !momenter.some((m) => m.id === id));
  if (ukendte.length) return { plan: [], fejl: [`ukendt øjeblik: ${ukendte.join(', ')}. De findes: ${momenter.map((m) => m.id).join(', ')}`] };
  const valgt = a.momenter.length ? a.momenter.map((id) => momenter.find((m) => m.id === id)!) : a.kold ? momenter.filter((m) => m.id.startsWith('kold')) : [...momenter];
  const plan = valgt.flatMap((m): PlanTrin[] => (a.stier.length ? a.stier.map((sti) => ({ moment: m.id, sti, navn: `test-${m.id} ${sti}` })) : [{ moment: m.id, sti: null, navn: `test-${m.id}` }]));
  return { plan, fejl: [] };
}
