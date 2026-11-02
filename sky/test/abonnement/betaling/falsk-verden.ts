// KC-0193: the fake layer. Each scenario gets its own FalskBetalingsKlient (with the config's catalogue, set up by
// the real planlaeg/anvend) and its own clock; the fake's time model (falsk.ts) plays trial ends, renewals and
// cancellations and records the events Stripe would send. No network, deterministic, part of `npm test`.
import { ur } from '../../konto/hjaelp.ts';
import { FalskBetalingsKlient } from '../../../src/abonnement/falsk.ts';
import { anvend, planlaeg } from '../../../src/abonnement/opsaet.ts';
import { laesPriser } from '../../../src/abonnement/priser.ts';
import { koerselsPriser, type Tidslinje, type Verden } from './koer.ts';

export function falskVerden(start = '2026-10-31T10:00:00.000Z'): Verden {
  const priser = koerselsPriser(laesPriser(), '');
  return {
    navn: 'falsk',
    koersel: 'falsk',
    priser,
    plan: (id) => id,
    forbered: async () => {},
    ryd: async () => [],
    async tidslinje(scenarie): Promise<Tidslinje> {
      const u = ur(start);
      const klient = new FalskBetalingsKlient('test');
      await anvend((await planlaeg(priser, klient)).skridt, klient);
      let set = 0;
      return {
        klient,
        nu: u.nu,
        async start(params) {
          const s = await klient.opretCheckout(params, `tjek-${scenarie}`);
          klient.fuldfoerCheckout(s.id, u.nu());
          return (await klient.hentCheckout(s.id))!.abonnement!.id;
        },
        kort: async (kunde, pm) => { klient.vedhaeftBetalingsmiddel(kunde, pm); },
        frem: async (ms) => { u.frem(ms); klient.spolFrem(u.nu()); },
        skiftPris: async (abonnement, prisId) => { klient.skiftPris(abonnement, prisId); },
        betal: async (kunde) => { klient.betalAabne(kunde); },
        haendelser: async (kunde) => {
          const alle = klient.haendelser();
          const nye = alle.slice(set).filter((h) => h.kunde === kunde);
          set = alle.length;
          return nye.map((h) => ({ id: h.id, type: h.type, krop: h.krop }));
        },
      };
    },
  };
}
