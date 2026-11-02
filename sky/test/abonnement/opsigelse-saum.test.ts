// KC-0209: the payment seam's cancel-at-period-end (the "Opsig" button) in the fake and the SDK client, and the
// invariant that no code in Sky can issue a Stripe refund: a refund is a task for the owner (AGENTS §9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stativ, startProeve } from './stativ.ts';
import { StripeBetalingsKlient } from '../../src/abonnement/stripe-sdk.ts';
import type { BetalingsKlient } from '../../src/abonnement/stripe-klient.ts';
import { byggPortalKonfiguration } from '../../src/abonnement/portal.ts';
import { laesPriser } from '../../src/abonnement/priser.ts';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('the fake cancels at period end: the subscription lives on, is flagged, and a webhook sink hears about it', async () => {
  const s = await stativ();
  const id = await startProeve(s);
  const hoert: string[] = [];
  s.klient.haendelsesSink = async (type, kunde) => { hoert.push(`${type} ${kunde}`); };
  await s.klient.opsigVedPeriodeslut(id);
  const [a] = await s.klient.listAbonnementer(s.kunde);
  assert.equal(a?.status, 'trialing', 'still live until the period ends');
  assert.equal(a?.opsigVedPeriodeslut, true);
  assert.deepEqual(hoert, [`customer.subscription.updated ${s.kunde}`]);
  assert.equal(s.klient.kald.filter((k) => k.metode === 'opsigVedPeriodeslut').length, 1);
  await assert.rejects(s.klient.opsigVedPeriodeslut('sub_findes_ikke'), /intet abonnement/);
});

test('the SDK client cancels at period end with one update call and never calls cancel or anything with money', async () => {
  const k = new StripeBetalingsKlient('rk_test_abc123');
  const kald: { id: string; params: unknown }[] = [];
  Object.assign(k, { stripe: { subscriptions: {
    update: async (id: string, params: unknown) => { kald.push({ id, params }); return {}; },
    cancel: async () => { throw new Error('cancel now is for deleted accounts and withdrawals only'); },
  } } });
  await (k as BetalingsKlient).opsigVedPeriodeslut('sub_1');
  assert.deepEqual(kald, [{ id: 'sub_1', params: { cancel_at_period_end: true } }]);
});

/** Source with comments and string literals removed, so only code remains. */
export function kodeUdenTekst(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

/** What would move money back to a customer through Stripe: refunds, credit notes, prorated cancellations. */
const PENGE = /\brefunds?\b|\bcreateRefund\b|\bcreditNotes?\b|\bcredit_notes?\b|\bprorat\w*|\binvoice_now\b|\bpayouts?\b|\bpaymentIntents\.cancel\b|\bcharges\.create\b|\btransfers\.create\b/i;

function alleKode(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? alleKode(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

test('the detector sees a refund call and ignores comments and text', () => {
  assert.match(kodeUdenTekst('await this.stripe.refunds.create({ charge });'), PENGE);
  assert.match(kodeUdenTekst('stripe.subscriptions.cancel(id, { prorate: true })'), PENGE);
  assert.doesNotMatch(kodeUdenTekst("// a refund is never made by code\nconst t = 'We refund within 14 days'; /* refund */"), PENGE);
});

test('invariant: no code path in Sky issues a Stripe refund, credit note, payout or prorated cancellation', () => {
  const filer = alleKode(src);
  assert.ok(filer.length > 100);
  const fund = filer.flatMap((f) => { const m = PENGE.exec(kodeUdenTekst(fs.readFileSync(f, 'utf8'))); return m ? [`${path.relative(src, f)}: ${m[0]}`] : []; });
  // KC-0195: the Portal's plan change prorates only upgrades; the test below holds that no downgrade can credit.
  assert.deepEqual(fund.filter((x) => x !== 'abonnement/portal.ts: proration_behavior'), []);
});

test('KC-0195: the Portal never moves money back — downgrades and shorter intervals wait for the period end, cancelling never prorates', () => {
  const p = byggPortalKonfiguration(laesPriser(), { 'clawco-sky-solo-maaned': 'p1', 'clawco-sky-solo-aar': 'p2', 'clawco-sky-husstand-maaned': 'p3', 'clawco-sky-husstand-aar': 'p4' }, 'https://sky.example.test/konto/abonnement');
  const op = p.features.subscription_update!;
  assert.deepEqual(op.schedule_at_period_end?.conditions?.map((c) => c.type).sort(), ['decreasing_item_amount', 'shortening_interval']);
  assert.equal(p.features.subscription_cancel?.mode, 'at_period_end');
  assert.equal(p.features.subscription_cancel?.proration_behavior, undefined);
  const kode = kodeUdenTekst(fs.readFileSync(path.join(src, 'abonnement/portal.ts'), 'utf8'));
  assert.equal(kode.match(/\bprorat\w*/gi)?.length, 1, 'one proration setting in the Portal, the one checked here');
});

test('invariant: the payment seam has no method that gives money back, and the SDK client calls only the reads, cancel and update it needs', () => {
  const klient = fs.readFileSync(path.join(src, 'abonnement/stripe-klient.ts'), 'utf8');
  const metoder = [...(/export interface BetalingsKlient \{([\s\S]*?)\n\}/.exec(klient)?.[1] ?? '').matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]!);
  assert.ok(metoder.includes('opsigVedPeriodeslut') && metoder.includes('opsigAbonnement'));
  assert.deepEqual(metoder.filter((m) => /refund|refusion|tilbagebetal|kredit/i.test(m)), []);
  const sdk = kodeUdenTekst(fs.readFileSync(path.join(src, 'abonnement/stripe-sdk.ts'), 'utf8'));
  const skriv = [...sdk.matchAll(/this\.stripe\.((?:\w+\.)+\w+)\(/g)].map((m) => m[1]!).filter((n) => !/\.(list|retrieve|retrieveCurrent)$/.test(n));
  assert.deepEqual([...new Set(skriv)].sort(), [
    'billingPortal.configurations.create', 'billingPortal.configurations.update', 'billingPortal.sessions.create', 'checkout.sessions.create', 'checkout.sessions.expire', 'customers.create', 'prices.create', 'prices.update',
    'products.create', 'products.update', 'subscriptions.cancel', 'subscriptions.update',
  ]);
});
