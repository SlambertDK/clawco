// KC-0126: Start "returns when worth it" — the one hook foreslaaTilfoejelse
// asks the connector registry (through what the composition root hands Start)
// for sources not yet connected whose trigger fires. Triggers are keyed by the
// kind of source (slags); this ticket ships one: a calendar while connected
// mail has seen at least three calendar invites in 14 days. Further triggers
// come with the connector tickets (registrerTrigger). A dismissed suggestion
// stays away for 30 days. Mail is only read when a trigger could fire.

import type { Forslag } from './schema.ts';

/** A registered source as Start sees it. */
export type KildeSyn = { id: string; navn: string; slags: string; forbundet: boolean };
/** A mail the connected mail sources read: subject and time only, never a body. */
export type MailSyn = { emne: string; modtaget: string };
export type ForslagKontekst = { kilder: KildeSyn[]; mail: () => Promise<MailSyn[]>; nu: Date; afvist: Record<string, string> };
/** A trigger: the Danish reason when it fires for a source of its slags, else null. */
export type Trigger = (ctx: { mail: () => Promise<MailSyn[]>; nu: Date }) => Promise<string | null>;

const DAG_MS = 86_400_000;
export const AFVIST_DAGE = 30;
const INVITATION_DAGE = 14;
const INVITATIONER_MIN = 3;

/** Subjects calendars put on an invite (Google, Outlook; Danish and English). */
export function erInvitation(emne: string): boolean {
  return /^\s*(?:(?:opdateret|updated)\s+)?invitation(?:\s+opdateret)?\s*:|^\s*(?:mødeindkaldelse|meeting request)\b/i.test(emne);
}

const triggere = new Map<string, Trigger>();

/** Adds the trigger for one kind of source. Throws when that kind has one already. */
export function registrerTrigger(slags: string, t: Trigger): void {
  if (triggere.has(slags)) throw new Error(`slags ${slags} har allerede en trigger`);
  triggere.set(slags, t);
}

registrerTrigger('kalender', async ({ mail, nu }) => {
  const fra = nu.getTime() - INVITATION_DAGE * DAG_MS;
  const n = (await mail()).filter((m) => {
    const t = Date.parse(m.modtaget);
    return erInvitation(m.emne) && !Number.isNaN(t) && t >= fra && t <= nu.getTime() + DAG_MS;
  }).length;
  return n >= INVITATIONER_MIN ? `Du har fået ${n} invitationer i mailen de sidste ${INVITATION_DAGE} dage. Med kalenderen kan Hermes se, hvornår du er optaget.` : null;
});

/** The sources worth adding now: one per kind with no connected source, not dismissed in the last 30 days, whose trigger fires. */
export async function foreslaaTilfoejelse(ctx: ForslagKontekst): Promise<Forslag[]> {
  const forbundneSlags = new Set(ctx.kilder.filter((k) => k.forbundet).map((k) => k.slags));
  const afvist = (id: string): boolean => {
    const t = Date.parse(ctx.afvist[id] ?? '');
    return !Number.isNaN(t) && ctx.nu.getTime() - t < AFVIST_DAGE * DAG_MS;
  };
  const kandidater: KildeSyn[] = [];
  for (const k of ctx.kilder) {
    if (k.forbundet || forbundneSlags.has(k.slags) || !triggere.has(k.slags) || afvist(k.id)) continue;
    if (!kandidater.some((x) => x.slags === k.slags)) kandidater.push(k);
  }
  if (!kandidater.length) return [];
  // Read mail once, and only now that a trigger could fire.
  let mail: Promise<MailSyn[]> | undefined;
  const engang = (): Promise<MailSyn[]> => (mail ??= ctx.mail().catch(() => []));
  const ud: Forslag[] = [];
  for (const k of kandidater) {
    const grund = await triggere.get(k.slags)!({ mail: engang, nu: ctx.nu });
    if (grund) ud.push({ kildeId: k.id, navn: k.navn, slags: k.slags, grund });
  }
  return ud;
}
