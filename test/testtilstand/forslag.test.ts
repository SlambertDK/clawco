// KC-0077: every suggestion the empty chat offers gets a real answer in the
// test world at every moment, not the "I have no good answer" fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatSvar } from '../../src/testtilstand/indhold/samtale.ts';
import { fakta } from '../../src/testtilstand/indhold/fakta.ts';
import { FORSLAG, forslagTil } from '../../src/shell/forslag.ts';

test('every chat suggestion is answered by the scripted Hermes at all six moments', () => {
  const f = fakta('2026-10-30');
  const rum = [...Object.keys(FORSLAG), 'univers-havvind-nord'];
  for (const r of rum) {
    // "Jeg vil skrive" and "Hvad kan jeg sige?" are not sent to Hermes: the chat matcher answers first (shell/aabn.ts).
    for (const s of forslagTil(r).filter((x) => x !== 'Jeg vil skrive' && x !== 'Hvad kan jeg sige?')) {
      for (let n = 0; n < 6; n++) {
        const svar = chatSvar(r, n, s, f);
        assert.notEqual(svar.art, 'fallback', `${r} / "${s}" / moment ${n} falls through`);
      }
    }
  }
});
