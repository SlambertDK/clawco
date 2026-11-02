// KC-0235: the Aula reader passes the conformance suite every connector must pass.

import { test } from 'node:test';
import { aulaKalender } from '../../../src/kilder/aula-kalender/kilde.ts';
import { kildeKonformitet } from '../konformitet.ts';
import { falskHenter, ics, LINK, status } from './hjaelp.ts';

test('aula-kalender conforms', async () => {
  await kildeKonformitet(aulaKalender({ hent: falskHenter({ tekst: ics() }) }), { nede: aulaKalender({ hent: falskHenter(status(503)) }), hemmelighed: { link: LINK } });
});
