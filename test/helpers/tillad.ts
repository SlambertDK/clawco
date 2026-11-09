// KC-0280: the test-world dispatcher requires a judge (`adgang`). These tests are about routing, not identity, so they say
// out loud that the judge lets everyone through; the identity decision itself is covered in server-fremmed.test.ts.
import type { Adgang } from '../../src/testtilstand/kontakt.ts';

export const tilladAlle: Adgang = async () => null;
