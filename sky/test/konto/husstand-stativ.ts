// Shared setup for KC-0184's invitation and membership tests: an owner with a klar tenant, the invited person (an
// account made from her own address), a stranger, another owner, a fake mail client, a plan limit that can be
// changed, a fake tenant call that records each operation (and can be made to fail) and a spy on the gateway cache.
import { nyDb, ur, type Ur } from './hjaelp.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { opretSession } from '../../src/konto/session.ts';
import { bestil, skift } from '../../src/fleet/tilstand.ts';
import { falskPost, type FalskPost } from '../../src/delt/post.ts';
import type { Database } from '../../src/db/pool.ts';
import type { MedlemOp, MedlemskabDeps } from '../../src/konto/medlemskab.ts';
import type { InvitationDeps } from '../../src/konto/invitation.ts';

export type Person = { id: number; email: string; sessionId: number };
export type HusStativ = {
  db: Database; u: Ur; post: FalskPost; slug: string; andenSlug: string;
  ejer: Person; nora: Person; fremmed: Person; andenEjer: Person;
  max: { n: number }; kald: { ops: { slug: string; op: MedlemOp }[]; fejl: boolean }; glemt: string[];
  inv: InvitationDeps & { post: FalskPost }; med: MedlemskabDeps;
};

export const PUBLIC = 'https://konto.example.test';

export async function husStativ(): Promise<HusStativ> {
  const db = await nyDb();
  const u = ur();
  const person = async (email: string): Promise<Person> => {
    const { konto } = await findEllerOpretKonto(db, email, u.nu());
    const { session } = await opretSession(db, { kontoId: konto.id, metode: 'link', enhed: '', nu: u.nu() });
    return { id: konto.id, email, sessionId: session.id };
  };
  const ejer = await person('ejer@example.test');
  const nora = await person('nora@example.test');
  const fremmed = await person('fremmed@example.test');
  const andenEjer = await person('anden-ejer@example.test');
  const a = await bestil(db, { kontoId: ejer.id, driver: 'lokal', nu: u.nu(), nySlug: () => 'hus-abcdefgh' });
  await skift(db, a.slug, ['bestilt'], 'klar', u.nu(), { adresse: 'http://127.0.0.1:1' });
  const b = await bestil(db, { kontoId: andenEjer.id, driver: 'lokal', nu: u.nu(), nySlug: () => 'hus-bbbbbbbb' });
  await skift(db, b.slug, ['bestilt'], 'klar', u.nu(), { adresse: 'http://127.0.0.1:2' });
  const post = falskPost();
  const max = { n: 6 };
  const kald = { ops: [] as { slug: string; op: MedlemOp }[], fejl: false };
  const glemt: string[] = [];
  const entitlements = { medlemmer: async () => max.n };
  return {
    db, u, post, slug: a.slug, andenSlug: b.slug, ejer, nora, fremmed, andenEjer, max, kald, glemt,
    inv: { db, publicUrl: PUBLIC, entitlements, post },
    med: {
      db, entitlements, glem: (s) => { glemt.push(s); },
      kald: { async medlem(t, op) { if (kald.fejl) throw new Error('tenant nede'); kald.ops.push({ slug: t.slug, op }); return { aendret: true }; } },
    },
  };
}

/** The token in the last sent mail's link. */
export function sidsteToken(s: HusStativ): string {
  const link = s.post.udbakke.at(-1)?.data['link'];
  if (!link) throw new Error('ingen mail sendt');
  return new URL(link).searchParams.get('t')!;
}
