// KC-0120: the conformance suite every connector must pass — the fakes, the
// legacy adapters, and every future one (E3). `kildeKonformitet(k)` throws an
// AssertionError on the first breach: the registry accepts it, it has exactly
// one valid zone, health never throws (also when the source is down), a read
// is its own slags and untrusted (uklar, tillid), a mail read never carries a
// body, declared verbs are on the policy list and none of its limits, act()
// exists exactly when verbs do, and the onboarding card is data, not HTML.

import assert from 'node:assert/strict';
import { lavRegister, FORBUDTE_VERBER } from '../../src/kilder/register.ts';
import { KUVERT_NOEGLER } from '../../src/kilder/laesning.ts';
import { HELBRED, KildeFejl, type Kilde, type KildeKontekst } from '../../src/kilder/types.ts';
import { DATAZONER } from '../../src/identitet/zoner.ts';
import { erVerb } from '../../src/graenser/verber.ts';
import type { RumLager } from '../../src/store/types.ts';

const NU = new Date('2026-10-31T10:00:00Z');

/**
 * `o.nede`: the same connector with its source down (a failing runner, a missing file, a fake in mode nede).
 * `o.hemmelighed`: the credentials a connected source holds (KC-0133: an OAuth source reads only with its token).
 */
export async function kildeKonformitet(k: Kilde, o: { nede?: Kilde; hemmelighed?: Record<string, string> } = {}): Promise<void> {
  // The registry's own checks (id, slags, zone, auth, verbs, act, oauth) accept it.
  lavRegister({ dataDir: '/nonexistent', store: {} as RumLager }).registrer(k);
  assert.equal(typeof k.zone, 'string', `${k.id}: exactly one zone`);
  assert.ok((DATAZONER as readonly string[]).includes(k.zone), `${k.id}: zone ${String(k.zone)} is not a data zone`);
  assert.ok(k.tillid === undefined || k.tillid === 'uklar', `${k.id}: tillid must be uklar`);

  const verber = Object.entries(k.verber ?? {});
  for (const [navn, spec] of verber) {
    assert.ok(erVerb(spec.verb), `${k.id}.${navn}: ${String(spec.verb)} is not on the verb list`);
    assert.ok(!FORBUDTE_VERBER.has(spec.verb), `${k.id}.${navn}: a connector may never ${spec.verb}`);
  }
  assert.equal(Boolean(k.act), verber.length > 0, `${k.id}: act() exactly when verbs are declared`);

  const ctx: KildeKontekst = { nu: NU, zone: k.zone, valg: {}, hemmelighed: async () => o.hemmelighed ?? null };
  const kort = await k.kort(ctx);
  for (const felt of ['titel', 'tekst', 'handling'] as const) {
    assert.ok(typeof kort[felt] === 'string' && kort[felt].trim().length > 0, `${k.id}: the card has a ${felt}`);
    assert.ok(!/[<>]/.test(kort[felt]), `${k.id}: the card's ${felt} is text, not HTML`);
  }
  assert.ok(Array.isArray(kort.felter), `${k.id}: the card's fields are a list`);
  for (const t of kort.trin ?? []) assert.ok(!/[<>]/.test(t.tekst + (t.kopier ?? '')), `${k.id}: a setup step is text, not HTML`);

  for (const x of [k, ...(o.nede ? [o.nede] : [])]) {
    let h: unknown;
    await assert.doesNotReject(async () => { h = await x.helbred(ctx); }, `${x.id}: helbred() threw`);
    const status = (h as { status?: unknown } | undefined)?.status;
    assert.ok((HELBRED as readonly unknown[]).includes(status), `${x.id}: helbred() said ${String(status)}`);
  }

  const l = await k.read(ctx);
  assert.equal(l.slags, k.slags, `${k.id}: read() returns its own slags`);
  assert.equal(l.uklar, true, `${k.id}: read() is untrusted (uklar)`);
  assert.equal(typeof l.hentet, 'string', `${k.id}: read() says when it was fetched`);
  if (l.slags === 'mail') {
    for (const kuvert of l.data) {
      const ekstra = Object.keys(kuvert).filter((n) => !(KUVERT_NOEGLER as readonly string[]).includes(n));
      assert.deepEqual(ekstra, [], `${k.id}: a mail read carries only envelope keys, never a body`);
    }
  }
  if (o.nede) await assert.rejects(o.nede.read(ctx), KildeFejl, `${o.nede.id}: a source that is down fails with KildeFejl`);
}
