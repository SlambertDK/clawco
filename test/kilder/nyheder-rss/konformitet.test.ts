// KC-0137: the connector passes the conformance suite every connector must pass.

import { test } from 'node:test';
import { nyhederRss } from '../../../src/kilder/nyheder-rss/kilde.ts';
import { kildeKonformitet } from '../konformitet.ts';
import { falskHenter } from './hjaelp.ts';

test('nyheder-rss conforms', async () => {
  await kildeKonformitet(nyhederRss({ hent: falskHenter({}) }));
});
