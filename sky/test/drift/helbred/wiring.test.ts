// KC-0189: the components as server.ts wires them, against the real gateway (KC-0183) on a local listener: the canary
// is a klar tenant's host asked through Sky's own port, and an anonymous visitor must be sent to the account host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesConfig } from '../../../src/config.ts';
import { laesGatewayNoegle } from '../../../src/gateway/noegle.ts';
import { ruteTabel } from '../../../src/gateway/rute.ts';
import { helbredKomponenter } from '../../../src/server.ts';
import { maalKomponenter } from '../../../src/drift/helbred/komponenter.ts';
import { FROE, OFFENTLIG, opsaet } from '../../gateway/hjaelp.ts';
import { startGateway } from '../../gateway/net.ts';

const PUBLIC = 'https://konto.eksempel.test';
const ANTAL = { sund: 1, traeg: 0, syg: 0, opdaterer: 0 };

for (const [navn, noegle, forventet] of [
  ['with the gateway key the canary route is ok', laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, OFFENTLIG).noegle, 'ok'],
  ['without the gateway key (503) the canary route is nede', null, 'nede'],
] as const) {
  test(navn, async () => {
    const o = await opsaet();
    const gw = await startGateway({ db: o.db, publicUrl: PUBLIC, basedomain: 'eksempel.test', noegle, ruter: ruteTabel({ db: o.db }), samtykkeOk: async () => true, log: () => {} });
    try {
      const config = laesConfig({ SKY_DATABASE_URL: 'postgres://sky@db.eksempel.test/sky', SKY_PUBLIC_URL: PUBLIC, SKY_BASEDOMAIN: 'eksempel.test', SKY_PORT: String(gw.port) });
      const k = helbredKomponenter({ config, db: o.db, sha: 'abc1234', startet: 0, flaadeKlar: true, kopierSlaaetTil: false });
      const s = await maalKomponenter(k, ANTAL, o.ur.nu());
      assert.equal(s.adgang, forventet);
      assert.equal(s.login, 'ok');
      assert.equal(s.oprettelse, 'ok');
      assert.equal(s.sikkerhedskopi, 'nede');
      assert.equal(s.clawco, 'ok');
    } finally { await gw.luk(); await o.db.close(); }
  });
}
