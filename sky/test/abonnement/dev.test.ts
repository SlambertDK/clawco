// SKY_DEV=1 only: a stand-in for Stripe's hosted Checkout, so the whole flow can be clicked through
// locally without a key. Pressing its button completes the fake session and delivers a *signed*
// checkout.session.completed through the real webhook handler (signature check included).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stativ, fangLog, HEMMELIGHED, PUBLIC } from './stativ.ts';
import { devStripeRuter } from '../../src/abonnement/dev.ts';
import { hentRettigheder } from '../../src/abonnement/synk.ts';
import { lookupKey } from '../../src/abonnement/opsaet.ts';
import { byggCheckout } from '../../src/abonnement/checkout.ts';

test('the dev Checkout page shows the plan; its button completes the session, a signed webhook makes the trial real, and it returns to Clawco', async () => {
  const s = await stativ();
  const pris = await s.klient.prisForLookupKey(lookupKey('sky-husstand', 'aar'));
  const params = byggCheckout({
    kontoId: s.kontoId, kunde: s.kunde, plan: 'sky-husstand', interval: 'aar', land: 'DK', sprog: 'da', valuta: 'dkk', skat: null, prisId: pris!.id, proeve: true,
    publicUrl: PUBLIC, juridisk: { vilkaarUrl: null, privatlivUrl: null, fortrydelsesTekst: null }, tilstand: 'test',
  }, s.priser);
  const session = await s.klient.opretCheckout(params, 'dev');
  const app = devStripeRuter({ klient: s.klient, priser: s.priser, publicUrl: PUBLIC, webhook: { db: s.db, klient: s.klient, priser: s.priser, hemmelighed: HEMMELIGHED, nu: s.u.nu, taeller: { afvist: 0 } } });

  const side = await app.request(`${PUBLIC}/dev/stripe/checkout/${session.id}`);
  assert.equal(side.status, 200);
  const t = await side.text();
  assert.match(t, /Sky Husstand/);
  assert.match(t, /Start prøven/);
  assert.match(t, /href="https:\/\/sky\.example\.test\/konto\/abonnement\?plan=sky-husstand&amp;interval=aar/);

  assert.equal((await app.request(`${PUBLIC}/dev/stripe/checkout/${session.id}`, { method: 'POST', headers: { origin: 'https://ond.example' } })).status, 403);
  const { r } = await fangLog(async () => app.request(`${PUBLIC}/dev/stripe/checkout/${session.id}`, { method: 'POST', headers: { origin: PUBLIC } }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `${PUBLIC}/api/abonnement/tilbage?session=${session.id}`);
  const ret = await hentRettigheder(s.db, s.kontoId, s.priser, s.u.nu());
  assert.equal(ret.status, 'proeve');
  assert.equal(ret.plan, 'sky-husstand');
  assert.equal((await app.request(`${PUBLIC}/dev/stripe/checkout/cs_findes_ikke`)).status, 404);
});
