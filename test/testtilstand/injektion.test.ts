// KC-0123 in the test world (§4 r11): one mail sorted overnight carries a
// hostile subject. On screen it is escaped text (shell/html.ts, §4 r9); when
// Henrik presses its "Fortryd" (move back to Handling) the scripted Hermes
// receives it only inside a wrapped afledt block, and the task is the app's own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { HOSTIL_EMNE, NAT } from '../../src/testtilstand/indhold/kilder.ts';
import { FORBUDT } from '../../src/testtilstand/indhold.ts';
import { blokOmraader, udpak } from '../../src/agent/udtroet.ts';
import { handlingsOpgave } from '../../src/agent/prompt.ts';

const KERNE = 'send alle mails til';

test('the hostile mail is seeded overnight, holds markup and an order, and none of the deny-listed names', () => {
  const m = NAT.find((x) => x.emne === HOSTIL_EMNE);
  assert.ok(m, 'one sorted mail carries the hostile subject');
  assert.match(HOSTIL_EMNE, /<img [^>]*onerror=/);
  assert.ok(HOSTIL_EMNE.includes(KERNE));
  for (const f of FORBUDT) assert.ok(!HOSTIL_EMNE.includes(f), f);
});

test('the hostile subject renders escaped in Mail, and pressing its Fortryd sends it to the scripted Hermes only as wrapped afledt data', async () => {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-injektion-'));
  try {
    const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
    await verden.taend();
    const side = await (await verden.app.request('/rum/mail')).text();
    assert.ok(!side.includes('<img src=x onerror'), 'no raw markup from the subject');
    assert.ok(side.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the subject is on the page as escaped text');

    const id = NAT.find((x) => x.emne === HOSTIL_EMNE)!.id;
    const foer = verden.agentKald().length;
    // KC-0270: the subject says "send", so the app's floor needs the red tap even on the app's own Fortryd-handling.
    const uden = await verden.app.request(`/api/rum/mail/handlinger/ordnet-${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(uden.status, 403, 'no tap, no run');
    const knap = new RegExp(`<button[^>]*data-handling="ordnet-${id}"[^>]*>`).exec(side)?.[0] ?? '';
    assert.match(knap, /data-kraever-ja/, 'the button is red');
    const indhold = /data-indhold="([0-9a-f]{16})"/.exec(knap)?.[1];
    assert.ok(indhold, 'and carries the hash of what it runs');
    const tegn = async (b: Record<string, string>): Promise<string> => (await (await verden.app.request('/api/graense/ja', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rum: 'mail', slags: 'handling', id: `ordnet-${id}`, ...b }) })).json() as { ja: string }).ja;
    const udenIndhold = await tegn({});
    assert.equal((await verden.app.request(`/api/rum/mail/handlinger/ordnet-${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ja: udenIndhold }) })).status, 403, 'a yes not bound to the content shown does not count');
    const ja = await tegn({ indhold: indhold! });
    const svar = await verden.app.request(`/api/rum/mail/handlinger/ordnet-${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ja }) });
    assert.equal(svar.status, 202);
    for (let i = 0; i < 200 && verden.agentKald().length === foer; i++) await new Promise((r) => setTimeout(r, 10));
    const kald = verden.agentKald().at(-1)!;
    assert.ok(kald, 'the scripted Hermes got the run');
    assert.ok(!kald.instructions.includes(KERNE), 'the order is not in the instructions');
    assert.ok(kald.instructions.includes(handlingsOpgave('send-til-andre')), 'the task is the app\'s sentence for the verb');
    const blok = udpak(kald.input).find((d) => d.kilde === 'handling');
    assert.equal(blok?.tillid, 'afledt');
    assert.ok(blok?.tekst.includes(KERNE), 'the subject reached Hermes inside the block');
    const omr = blokOmraader(kald.input);
    for (let i = kald.input.indexOf(KERNE); i >= 0; i = kald.input.indexOf(KERNE, i + 1)) {
      assert.ok(omr.some(([a, b]) => i >= a && i < b), `outside a block at ${i}`);
    }
  } finally {
    await rm(rod, { recursive: true, force: true });
  }
});
