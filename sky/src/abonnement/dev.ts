// Development only (SKY_DEV=1 with the fake client, never in production): a stand-in for Stripe's
// hosted Checkout page, so the KC-0191 flow can be clicked through locally without a key. Its button
// plays the person on Stripe's page, then delivers a signed checkout.session.completed through the
// real webhook handler, the way Stripe would.
import { Hono } from 'hono';
import type { FalskBetalingsKlient } from './falsk.ts';
import type { Priser } from './priser.ts';
import { signerTestHaendelse } from './stripe-sdk.ts';
import { modtagWebhook, type WebhookDeps } from './webhook.ts';
import { devCheckoutSide, beskedSide } from './render.ts';
import { sikkerhedsHoveder } from './ruter.ts';
import { T } from './tekster.ts';

export function devStripeRuter(d: { klient: FalskBetalingsKlient; priser: Priser; publicUrl: string; webhook: WebhookDeps }): Hono {
  const app = new Hono();
  app.use('/dev/stripe/*', sikkerhedsHoveder);
  let n = 0;

  app.get('/dev/stripe/checkout/:id', (c) => {
    const id = c.req.param('id');
    const p = d.klient.checkoutParams(id);
    if (!p) return c.html(beskedSide(T.ukendtTitel, T.ukendtTekst), 404);
    const plan = d.priser.planer[String(p.metadata?.['plan'] ?? '')]?.navn ?? '?';
    return c.html(devCheckoutSide({ id, plan, proeveDage: p.subscription_data?.trial_period_days ?? null, afbrydUrl: p.cancel_url ?? '/konto/abonnement' }));
  });

  app.post('/dev/stripe/checkout/:id', async (c) => {
    if (c.req.header('origin') !== new URL(d.publicUrl).origin) return c.text('Forbudt', 403);
    const id = c.req.param('id');
    const s = await d.klient.hentCheckout(id);
    if (!s || !d.webhook.hemmelighed) return c.html(beskedSide(T.ukendtTitel, T.ukendtTekst), 404);
    const tilbage = d.klient.fuldfoerCheckout(id, d.webhook.nu());
    const krop = JSON.stringify({ id: `evt_dev_${Date.now()}_${++n}`, object: 'event', type: 'checkout.session.completed', data: { object: { id, object: 'checkout.session', customer: s.kunde } } });
    await modtagWebhook(d.webhook, Buffer.from(krop), signerTestHaendelse(krop, d.webhook.hemmelighed));
    return c.redirect(tilbage, 303);
  });

  return app;
}
