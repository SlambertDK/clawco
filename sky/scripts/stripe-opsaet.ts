// `npm run stripe:opsaet [-- --anvend]` (KC-0190): makes Stripe hold exactly the products and prices
// in config/priser.json. Dry run by default. Wiring only; the logic is koerOpsaet in
// src/abonnement/opsaet.ts. The key comes from SKY_STRIPE_SECRET_KEY (sky/.env via --env-file).
import { koerOpsaet } from '../src/abonnement/opsaet.ts';
import { StripeBetalingsKlient } from '../src/abonnement/stripe-sdk.ts';

process.exitCode = await koerOpsaet({
  argv: process.argv.slice(2),
  env: process.env,
  skriv: (linje) => console.log(linje),
  lavKlient: (noegle) => new StripeBetalingsKlient(noegle),
});
