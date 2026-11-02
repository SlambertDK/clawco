import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import type { AgentRunRequest } from '../src/agent/types.ts';
import type { Runner } from '../src/rooms/mail/source.ts';
import { mergeKort, type Kort, type KuratorState } from '../src/rooms/hjem/kort.ts';
import { fjernRegnskab, regnskabsfil, skrivRegnskab } from '../src/kurator/regnskab.ts';
import { laesKurator } from '../src/kurator/kurator.ts';
import { parseKuratorPlan } from '../src/scheduler.ts';
import { rejsenFaerdig } from './fixtures/start.ts';
import { udpak } from '../src/agent/udtroet.ts';

const NOW = new Date('2026-10-27T12:00:00Z');
const LINJE = { dato: '2026-10-27', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', art: 'abonnement' as const, emne: 'Your Vercel invoice' };

const kort = (over: Partial<Kort> = {}): Kort => ({ id: 'regning:vercel-7', type: 'regning', titel: 'Vercel-regning', betyder: 'En regning på 20 USD.', grundlag: [], kilder: [], anbefaling: 'Intet.', prioritet: 3, ...over });
const tom = (over: Partial<KuratorState> = {}): KuratorState => ({ kort: [], intet: [], afvist: [], sete: [], ...over });
const ingenMail: Runner = async () => ({ code: 0, stdout: '[]', stderr: '' });

async function opsaet(o: { vault?: boolean; runner?: Runner; answer?: (r: AgentRunRequest) => string; delayMs?: number; now?: Date } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-kurator-srv-'));
  const vaultRod = path.join(dir, 'vault');
  const store = createFileStore(path.join(dir, 'data'));
  await rejsenFaerdig(store);
  const hermes = createFakeAgent({ answer: o.answer ?? (() => 'Noteret.'), ...(o.delayMs ? { delayMs: o.delayMs } : {}) });
  const sut = createApp({
    store, hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), mailRunner: o.runner ?? ingenMail, mailStateDir: path.join(dir, 'state'),
    now: () => o.now ?? NOW, personer: '/vault/personer', ...(o.vault === false ? {} : { vaultInbox: path.join(vaultRod, '00-Indbakke') }),
  });
  const post = async (url: string, body?: unknown): Promise<Response> => sut.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  const fil = (hvor: 'shelfatlas' | 'privat'): string => regnskabsfil(vaultRod, hvor);
  const laes = async (hvor: 'shelfatlas' | 'privat'): Promise<string> => readFile(fil(hvor), 'utf8').catch(() => '');
  const skrevet = async (k: Kort, hvor: 'shelfatlas' | 'privat' = 'shelfatlas'): Promise<Kort> => {
    await skrivRegnskab(fil(hvor), k.id, { ...LINJE, hvor });
    return { ...k, regnskab: { ...LINJE, hvor }, skrevet: { hvor, fil: fil(hvor) } };
  };
  return { dir, store, hermes, sut, post, fil, laes, skrevet, ryd: () => rm(dir, { recursive: true, force: true }) };
}

test('luk removes the card and it never returns on the next merge', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a' }), kort({ id: 'k:b', titel: 'Anden' })], cursor: 'c1', sete: ['m1'] }));
    const res = await t.post('/api/rum/hjem/kort/k%3Aa/luk', {});
    assert.equal(res.status, 200);
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort.map((k) => k.id), ['k:b']);
    assert.deepEqual(s.afvist, ['k:a']);
    assert.equal(s.cursor, 'c1', 'the rest of the state is kept');
    assert.deepEqual(s.sete, ['m1']);
    assert.equal(t.hermes.calls.length, 0, 'no reason → no Hermes run');
    assert.match((await t.store.readLog('hjem'))[0]?.tekst ?? '', /^Lukkede "Vercel-regning"$/);
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Ab/ikke-relevant', {})).status, 404, 'KC-0039: the old route is gone');
    const igen = mergeKort(s, { nye: [kort({ id: 'k:a' })], behold: ['k:b'], opdater: [], fjern: [], intet: [] }, NOW, 'privat');
    assert.deepEqual(igen.kort.map((k) => k.id), ['k:b'], 'Hermes proposing it again changes nothing');
  } finally { await t.ryd(); }
});

test('luk with a reason keeps the reason for Kuratoren and starts a laer run that carries the card and the reason; a too long reason is 400', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', titel: 'Fødselsdag hos Rikke', betyder: 'Rikke har fødselsdag.' })] }));
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/luk', { grund: 'x'.repeat(301) })).status, 400);
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/luk', { grund: 42 })).status, 400);
    assert.equal((await laesKurator(t.store)).kort.length, 1, 'a rejected request changes nothing');
    const res = await t.post('/api/rum/hjem/kort/k%3Aa/luk', { grund: 'Rikke er min kollega, ikke familie' });
    assert.equal(res.status, 202);
    assert.deepEqual((await laesKurator(t.store)).lukket, [{ id: 'k:a', titel: 'Fødselsdag hos Rikke', grund: 'Rikke er min kollega, ikke familie', dato: NOW.toISOString(), zone: 'privat' }]);
    assert.ok((await t.store.readLog('hjem')).some((e) => e.kilde === 'henrik' && e.tekst === 'Lukkede "Fødselsdag hos Rikke": Rikke er min kollega, ikke familie'));
    const { runId } = (await res.json()) as { runId: string };
    const rec = t.sut.runs.get(runId)!;
    assert.equal(rec.kind, 'laer');
    assert.equal(rec.room, 'hjem');
    assert.equal((await rec.finished).status, 'done');
    const call = t.hermes.calls[0]!;
    const tekst = call.instructions + call.input;
    assert.match(tekst, /Fødselsdag hos Rikke/);
    assert.match(tekst, /Rikke har fødselsdag/);
    assert.match(tekst, /Rikke er min kollega, ikke familie/);
    assert.match(call.instructions, /har lukket et kort/);
    assert.match(call.instructions, /klaret/);
    assert.ok(!call.instructions.includes('Ikke relevant'), 'KC-0039: the lesson is read from his words, not from a button label');
    assert.match(tekst, /\/vault\/personer/);
    assert.match(call.instructions, /aldrig betale, sende mail til andre mennesker eller slette data/);
    assert.ok(call.instructions.includes('Flyt, arkivér, besvar, lav udkast til, slet eller send aldrig mail.'));
    assert.ok(!call.instructions.includes('Fødselsdag hos Rikke') && !call.instructions.includes('Rikke har fødselsdag'), 'card text is data in the input, not in the instructions');
    assert.deepEqual((await laesKurator(t.store)).kort, []);
  } finally { await t.ryd(); }
});

test('regnskab/fortryd removes the row and marks the log entry undone', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    await t.store.appendLog('hjem', { kilde: 'hermes', tekst: 'Skrev Vercel 20,00 USD ind i ShelfAtlas-regnskabet', handlingId: `regnskab:${k.id}` });
    assert.match(await t.laes('shelfatlas'), /kc:regning:vercel-7/);
    const res = await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/fortryd`, {});
    assert.equal(res.status, 200);
    assert.ok(!(await t.laes('shelfatlas')).includes('kc:regning:vercel-7'));
    const s = await laesKurator(t.store);
    assert.equal(s.kort[0]?.skrevet, undefined);
    assert.deepEqual(s.regnskab?.[k.id], { hvor: 'shelfatlas', status: 'fortrudt' });
    const e = (await t.store.readLog('hjem')).find((x) => x.handlingId === `regnskab:${k.id}`);
    assert.ok(e?.fortrudt, 'the log entry is marked undone');
    assert.equal((await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/fortryd`, {})).status, 409, 'nothing left to undo');
  } finally { await t.ryd(); }
});

test('flyt moves the row to the other file and keeps the state consistent', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    const res = await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/flyt`, {});
    assert.equal(res.status, 200);
    assert.ok(!(await t.laes('shelfatlas')).includes('kc:regning:vercel-7'));
    const privat = await t.laes('privat');
    assert.match(privat, /kc:regning:vercel-7/);
    assert.match(privat, /\| Vercel \|/);
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort[0]?.skrevet, { hvor: 'privat', fil: t.fil('privat') });
    assert.equal(s.kort[0]?.regnskab?.hvor, 'privat');
    assert.deepEqual(s.regnskab?.[k.id], { hvor: 'privat', status: 'skrevet', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', zone: 'privat' });
    assert.match((await t.store.readLog('hjem'))[0]?.tekst ?? '', /Flyttede Vercel/);
    const tilbage = await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/flyt`, {});
    assert.equal(tilbage.status, 200);
    assert.match(await t.laes('shelfatlas'), /kc:regning:vercel-7/);
    assert.ok(!(await t.laes('privat')).includes('kc:regning:vercel-7'));
  } finally { await t.ryd(); }
});

test('flyt: when the target ledger cannot be written, the row stays in the source, the state is unchanged and nothing is logged', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    const foer = await laesKurator(t.store);
    await mkdir(t.fil('privat'), { recursive: true }); // a directory where the file should be: the write fails
    const res = await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/flyt`, {});
    assert.equal(res.status, 500);
    assert.match(await t.laes('shelfatlas'), /kc:regning:vercel-7/, 'the row is not lost');
    assert.deepEqual(await laesKurator(t.store), foer);
    assert.equal((await t.store.readLog('hjem')).length, 0);
  } finally { await t.ryd(); }
});

test('flyt of a row Henrik removed by hand is 409 and does not bring it back', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    await fjernRegnskab(t.fil('shelfatlas'), k.id);
    const res = await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/flyt`, {});
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /Linjen står ikke længere i regnskabet/);
    assert.equal(await t.laes('privat'), '');
    assert.equal((await t.store.readLog('hjem')).length, 0);
  } finally { await t.ryd(); }
});

test('fortryd of a row that is no longer in the file is 409 and marks nothing undone', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    const e = await t.store.appendLog('hjem', { kilde: 'hermes', tekst: 'Skrev Vercel', handlingId: `regnskab:${k.id}` });
    await fjernRegnskab(t.fil('shelfatlas'), k.id);
    assert.equal((await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/regnskab/fortryd`, {})).status, 409);
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${e.id}`, {})).status, 409);
    assert.equal((await laesKurator(t.store)).regnskab?.[k.id]?.status, 'skrevet');
    assert.equal((await t.store.readLog('hjem')).find((x) => x.id === e.id)?.fortrudt, undefined);
  } finally { await t.ryd(); }
});

test('Hjem log Fortryd of a ledger row without a state.regnskab entry finds the row in either ledger file', async () => {
  const t = await opsaet();
  try {
    await skrivRegnskab(t.fil('privat'), 'regning:tabt', { ...LINJE, hvor: 'privat' });
    await t.store.writeState('hjem', tom());
    const e = await t.store.appendLog('hjem', { kilde: 'hermes', tekst: 'Skrev Vercel', handlingId: 'regnskab:regning:tabt', fortryd: 'fjern-raekke' });
    const ingen = await t.store.appendLog('hjem', { kilde: 'hermes', tekst: 'Skrev noget', handlingId: 'regnskab:regning:ingen', fortryd: 'fjern-raekke' });
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${e.id}`, {})).status, 200);
    assert.ok(!(await t.laes('privat')).includes('kc:regning:tabt'));
    assert.equal((await laesKurator(t.store)).regnskab?.['regning:tabt']?.status, 'fortrudt');
    assert.equal((await laesKurator(t.store)).regnskab?.['regning:tabt']?.hvor, 'privat');
    assert.ok((await t.store.readLog('hjem')).find((x) => x.id === e.id)?.fortrudt);
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${ingen.id}`, {})).status, 409, 'in neither file: nothing to undo');
  } finally { await t.ryd(); }
});

test('KC-0034: a written row whose card has expired (still in state) keeps its Fortryd under "Skrevet i regnskab"', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort({ id: 'regning:udloebet', gyldigTil: '2026-10-26' }));
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { 'regning:udloebet': { hvor: 'shelfatlas', status: 'skrevet', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD' } } }));
    const out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.ok(!out.includes('Vercel-regning'), 'the expired card itself is gone');
    assert.match(out, /data-regnskab-id="regning:udloebet"/);
    assert.equal((await t.post('/api/rum/hjem/kort/regning%3Audloebet/regnskab/fortryd', {})).status, 200);
    assert.ok(!(await t.laes('shelfatlas')).includes('kc:regning:udloebet'));
  } finally { await t.ryd(); }
});

test('a written row whose card is retired is listed under "Skrevet i regnskab" and can still be undone', async () => {
  const t = await opsaet();
  try {
    await skrivRegnskab(t.fil('shelfatlas'), 'regning:gammel', { ...LINJE, hvor: 'shelfatlas' });
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:aaben', type: 'tjeneste' })], regnskab: {
      'regning:gammel': { hvor: 'shelfatlas', status: 'skrevet', leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD' },
      'regning:fortrudt': { hvor: 'privat', status: 'fortrudt', leverandoer: 'Netto', beloeb: '1', valuta: 'DKK' },
    } }));
    let out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.match(out, /Skrevet i regnskab/);
    assert.match(out, /data-regnskab-id="regning:gammel"/);
    assert.match(out, /Vercel 20,00 USD/);
    assert.ok(!out.includes('regning:fortrudt'), 'an undone row is not listed');
    const res = await t.post('/api/rum/hjem/kort/regning%3Agammel/regnskab/fortryd', {});
    assert.equal(res.status, 200);
    assert.ok(!(await t.laes('shelfatlas')).includes('kc:regning:gammel'));
    assert.equal((await laesKurator(t.store)).regnskab?.['regning:gammel']?.status, 'fortrudt');
    out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.ok(!out.includes('data-regnskab-id="regning:gammel"'));
  } finally { await t.ryd(); }
});

test('an expired card (gyldigTil before today, Copenhagen) is not shown in Hjem, without waiting for a run', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:gammel', titel: 'Udløbet frist', gyldigTil: '2026-10-26' }), kort({ id: 'k:idag', titel: 'Frist i dag', gyldigTil: '2026-10-27' })] }));
    const out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.ok(!out.includes('Udløbet frist'));
    assert.match(out, /Frist i dag/);
  } finally { await t.ryd(); }
});

test('Hjem is live: its stream announces a change, and its fragment carries the Hermes status', async () => {
  const t = await opsaet({ answer: () => SVAR, runner: MAIL });
  try {
    const live = await t.sut.app.request('/api/rum/hjem/live');
    assert.equal(live.status, 200);
    assert.equal(live.headers.get('content-type')?.split(';')[0], 'text/event-stream');
    const reader = live.body!.getReader();
    const run = await t.sut.runs.get(((await (await t.post('/api/rum/hjem/kurator', {})).json()) as { runId: string }).runId)!.finished;
    assert.equal(run.status, 'done', run.error);
    let text = '';
    const deadline = Date.now() + 2000;
    while (!text.includes('event: changed') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    assert.match(text, /event: changed/);
    const frag = (await (await t.sut.app.request('/api/rum/hjem/fragment')).json()) as { html: string; hermesStatus?: string };
    assert.ok(frag.hermesStatus, 'the fragment says the Hermes status, as the other rooms do');
  } finally { await t.ryd(); }
});

test('uklart → /regnskab/privat writes there, clears regnskabUklart and records the choice', async () => {
  const t = await opsaet();
  try {
    const k = kort({ id: 'regning:uklar', titel: 'Ukendt regning', regnskabUklart: true });
    await t.store.writeState('hjem', tom({ kort: [k] }));
    const res = await t.post('/api/rum/hjem/kort/regning%3Auklar/regnskab/privat', {});
    assert.equal(res.status, 200);
    const privat = await t.laes('privat');
    assert.match(privat, /kc:regning:uklar/);
    assert.match(privat, /Ukendt regning/);
    assert.equal(await t.laes('shelfatlas'), '');
    const s = await laesKurator(t.store);
    assert.ok(!s.kort[0]?.regnskabUklart);
    assert.deepEqual(s.kort[0]?.skrevet, { hvor: 'privat', fil: t.fil('privat') });
    assert.deepEqual(s.regnskab?.['regning:uklar'], { hvor: 'privat', status: 'skrevet', leverandoer: 'Ukendt regning', beloeb: 'se mail', valuta: '', zone: 'privat' });
    assert.equal((await t.store.readLog('hjem')).filter((e) => e.handlingId === 'regnskab:regning:uklar').length, 1);
    assert.equal((await t.post('/api/rum/hjem/kort/regning%3Auklar/regnskab/shelfatlas', {})).status, 409, 'no longer unclear');
  } finally { await t.ryd(); }
});

test('KC-0066: after Fortryd a bill Hermes was sure about shows its write button again, and pressing it writes the same line back', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    const id = encodeURIComponent(k.id);
    assert.equal((await t.post(`/api/rum/hjem/kort/${id}/regnskab/fortryd`, {})).status, 200);
    const frag = (await (await t.sut.app.request('/api/rum/hjem/fragment')).json()) as { html: string };
    const art = /<article[^>]*data-kort-id="regning:vercel-7"[\s\S]*?<\/article>/.exec(frag.html)?.[0] ?? '';
    assert.match(art, /data-regnskab="shelfatlas">Skriv i ShelfAtlas</, 'the reverted card offers the write again');

    assert.equal((await t.post(`/api/rum/hjem/kort/${id}/regnskab/shelfatlas`, {})).status, 200);
    assert.match(await t.laes('shelfatlas'), /\| 2026-10-27 \| Vercel \| 20,00 \| USD \|[^\n]*<!-- kc:regning:vercel-7 -->/);
    const s = await laesKurator(t.store);
    assert.deepEqual(s.kort[0]?.skrevet, { hvor: 'shelfatlas', fil: t.fil('shelfatlas') });
    assert.equal(s.regnskab?.[k.id]?.status, 'skrevet');
    const aabne = (await t.store.readLog('hjem')).filter((e) => e.handlingId === `regnskab:${k.id}` && !e.fortrudt);
    assert.equal(aabne.length, 1, 'the new write has its own log entry, which can be undone');
    assert.equal((await t.post(`/api/rum/hjem/kort/${id}/regnskab/shelfatlas`, {})).status, 409, 'written again: not twice');
  } finally { await t.ryd(); }
});

test('uklart with Hermes\' proposed line writes that line (with the chosen ledger), not the fallback', async () => {
  const t = await opsaet();
  try {
    const k = kort({ id: 'regning:uklar2', titel: 'Ukendt', regnskabUklart: true, regnskabForslag: { dato: '2026-10-20', leverandoer: 'Cloudflare', beloeb: '5,00', valuta: 'USD', art: 'abonnement', emne: 'Invoice 9' } });
    await t.store.writeState('hjem', tom({ kort: [k] }));
    assert.equal((await t.post('/api/rum/hjem/kort/regning%3Auklar2/regnskab/shelfatlas', {})).status, 200);
    const fil = await t.laes('shelfatlas');
    assert.match(fil, /\| 2026-10-20 \| Cloudflare \| 5,00 \| USD \| {2}\| abonnement \| Invoice 9 \| <!-- kc:regning:uklar2 -->/);
    assert.equal((await laesKurator(t.store)).kort[0]?.regnskab?.hvor, 'shelfatlas');
  } finally { await t.ryd(); }
});

test('Hjem log Fortryd: a bill row is undone from the log even after its card is dismissed', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    const e = await t.store.appendLog('hjem', { kilde: 'hermes', tekst: 'Skrev Vercel 20,00 USD ind i ShelfAtlas-regnskabet', handlingId: `regnskab:${k.id}` });
    assert.equal((await t.post(`/api/rum/hjem/kort/${encodeURIComponent(k.id)}/luk`, {})).status, 200);
    assert.match(await t.laes('shelfatlas'), /kc:regning:vercel-7/, 'dismissing keeps the row');
    const res = await t.post(`/api/rum/hjem/fortryd/${e.id}`, {});
    assert.equal(res.status, 200);
    assert.ok(!(await t.laes('shelfatlas')).includes('kc:regning:vercel-7'));
    assert.deepEqual((await laesKurator(t.store)).regnskab?.[k.id], { hvor: 'shelfatlas', status: 'fortrudt' });
    assert.ok((await t.store.readLog('hjem')).find((x) => x.id === e.id)?.fortrudt);
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${e.id}`, {})).status, 409, 'already undone');
    assert.equal((await t.post('/api/rum/hjem/fortryd/findes-ikke', {})).status, 404);
    const uden = await t.store.appendLog('hjem', { kilde: 'henrik', tekst: 'Noget uden fortryd' });
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${uden.id}`, {})).status, 404, 'no fortryd stored');
  } finally { await t.ryd(); }
});

test('Hjem log Fortryd: Flyt and Vælg entries carry a fortryd; undoing Flyt moves the row back, undoing Vælg removes it', async () => {
  const t = await opsaet();
  try {
    const k = await t.skrevet(kort());
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    const id = encodeURIComponent(k.id);
    await t.post(`/api/rum/hjem/kort/${id}/regnskab/flyt`, {});
    const flyt = (await t.store.readLog('hjem')).find((x) => x.handlingId === `regnskab:${k.id}` && /Flyttede/.test(x.tekst))!;
    assert.ok(flyt.fortryd, 'the Flyt entry has a fortryd');
    assert.match(await t.laes('privat'), /kc:regning:vercel-7/);
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${flyt.id}`, {})).status, 200);
    assert.match(await t.laes('shelfatlas'), /kc:regning:vercel-7/, 'moved back');
    assert.ok(!(await t.laes('privat')).includes('kc:regning:vercel-7'));
    assert.ok((await t.store.readLog('hjem')).find((x) => x.id === flyt.id)?.fortrudt);
    assert.equal((await laesKurator(t.store)).regnskab?.[k.id]?.hvor, 'shelfatlas');

    const u = kort({ id: 'regning:uklar3', regnskabUklart: true });
    await t.store.writeState('hjem', { ...(await laesKurator(t.store)), kort: [u] });
    await t.post('/api/rum/hjem/kort/regning%3Auklar3/regnskab/privat', {});
    const vaelg = (await t.store.readLog('hjem')).find((x) => x.handlingId === 'regnskab:regning:uklar3')!;
    assert.ok(vaelg.fortryd, 'the Vælg entry has a fortryd');
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${vaelg.id}`, {})).status, 200);
    assert.ok(!(await t.laes('privat')).includes('kc:regning:uklar3'));
    assert.equal((await laesKurator(t.store)).regnskab?.['regning:uklar3']?.status, 'fortrudt');
  } finally { await t.ryd(); }
});

test('Hjem log Fortryd: a handling entry runs its stored instruction (kind fortryd, room hjem) and is marked undone', async () => {
  const t = await opsaet();
  try {
    const h = { id: 'k:a:h', label: 'Skift plan', instruktion: 'Skift planen til årlig.', fortryd: 'Skift planen tilbage til månedlig.' };
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', type: 'tjeneste', handling: h })] }));
    const gjort = t.sut.runs.get(((await (await t.post('/api/rum/hjem/kort/k%3Aa/handling', {})).json()) as { runId: string }).runId)!;
    await gjort.finished;
    const e = (await t.store.readLog('hjem')).find((x) => x.handlingId === 'k:a:h')!;
    const res = await t.post(`/api/rum/hjem/fortryd/${e.id}`, {});
    assert.equal(res.status, 202);
    const rec = t.sut.runs.get(((await res.json()) as { runId: string }).runId)!;
    assert.equal(rec.kind, 'fortryd');
    assert.equal(rec.room, 'hjem');
    assert.equal((await rec.finished).status, 'done');
    const call = t.hermes.calls.at(-1)!;
    assert.ok(udpak(call.input)[0]!.tekst.startsWith('Skift planen tilbage til månedlig.') && udpak(call.input)[0]!.tillid === 'afledt'); // KC-0123: quoted, never the task
    assert.ok(call.instructions.includes('Flyt, arkivér, besvar, lav udkast til, slet eller send aldrig mail.'));
    assert.ok((await t.store.readLog('hjem')).find((x) => x.id === e.id)?.fortrudt);
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${e.id}`, {})).status, 409);
  } finally { await t.ryd(); }
});

test('Hjem shows Gjort instead of the handling button once it has run, and a Fortryd button on its own log', async () => {
  const t = await opsaet();
  try {
    const h = { id: 'k:a:h', label: 'Skift plan', instruktion: 'Skift planen til årlig.', fortryd: 'Skift planen tilbage.' };
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', type: 'tjeneste', handling: h })] }));
    let out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.match(out, /data-kort-handling="k:a"/);
    await t.sut.runs.get(((await (await t.post('/api/rum/hjem/kort/k%3Aa/handling', {})).json()) as { runId: string }).runId)!.finished;
    out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.ok(!out.includes('data-kort-handling="k:a"'));
    assert.match(out, /Gjort/);
    const e = (await t.store.readLog('hjem')).find((x) => x.handlingId === 'k:a:h')!;
    assert.match(out, new RegExp(`data-hjem-fortryd="${e.id}"`));
    const fortryd = await t.post(`/api/rum/hjem/fortryd/${e.id}`, {});
    await t.sut.runs.get(((await fortryd.json()) as { runId: string }).runId)!.finished;
    out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.match(out, /data-kort-handling="k:a"/, 'undone: the button is back');
    assert.ok(!out.includes(`data-hjem-fortryd="${e.id}"`));
  } finally { await t.ryd(); }
});

test('unknown card id → 404, bad hvor → 400, no vault → 503, a card that is not a bill → 409', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', type: 'tjeneste' })] }));
    for (const rute of ['luk', 'regnskab/fortryd', 'regnskab/flyt', 'regnskab/privat', 'handling']) assert.equal((await t.post(`/api/rum/hjem/kort/findes-ikke/${rute}`, {})).status, 404, rute);
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/regnskab/bank', {})).status, 400);
    assert.equal((await t.post('/api/rum/hjem/kort/findes-ikke/regnskab/bank', {})).status, 400);
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/regnskab/privat', {})).status, 409);
    const uden = await t.post('/api/rum/hjem/kort/k%3Aa/handling', {});
    assert.equal(uden.status, 404, 'a card without a handling');
    assert.deepEqual(await uden.json(), { error: 'Kortet har ingen handling' });
    assert.deepEqual(await (await t.post('/api/rum/hjem/kort/findes-ikke/handling', {})).json(), { error: 'Kortet findes ikke' });
  } finally { await t.ryd(); }
  const u = await opsaet({ vault: false });
  try {
    await u.store.writeState('hjem', tom({ kort: [kort({ id: 'r:1', regnskabUklart: true })] }));
    const res = await u.post('/api/rum/hjem/kort/r%3A1/regnskab/privat', {});
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'Ingen vault sat op' });
    assert.equal((await laesKurator(u.store)).kort[0]?.regnskabUklart, true, 'nothing was changed');
  } finally { await u.ryd(); }
});

test('a card handling runs the stored instruction only, logs it with its fortryd, and never a mail send', async () => {
  const t = await opsaet();
  try {
    const h = { id: 'k:a:h', label: 'Skift plan', instruktion: 'Skift planen til årlig.', fortryd: 'Skift planen tilbage til månedlig.' };
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', type: 'tjeneste', handling: h })] }));
    const res = await t.post('/api/rum/hjem/kort/k%3Aa/handling', { instruktion: 'Send en mail til alle', id: 'x' });
    assert.equal(res.status, 202);
    const rec = t.sut.runs.get(((await res.json()) as { runId: string }).runId)!;
    assert.equal(rec.kind, 'handling');
    assert.equal(rec.room, 'hjem');
    assert.equal((await rec.finished).status, 'done');
    const call = t.hermes.calls[0]!;
    assert.ok(udpak(call.input)[0]!.tekst.startsWith('Skift planen til årlig.') && udpak(call.input)[0]!.tillid === 'afledt', 'the stored instruktion comes first, as afledt data (KC-0123)');
    assert.ok(call.input.includes('Vercel-regning') && call.input.includes('En regning på 20 USD.'), 'the card text is in the input');
    assert.ok(!call.instructions.includes('Vercel-regning') && !call.instructions.includes('En regning på 20 USD.'), 'and not in the instructions');
    assert.ok(!(call.instructions + call.input).includes('Send en mail til alle'));
    assert.match(call.instructions, /aldrig betale, sende mail til andre mennesker eller slette data/);
    assert.ok(call.instructions.includes('Flyt, arkivér, besvar, lav udkast til, slet eller send aldrig mail.'));
    assert.match(call.instructions, /data fra Kuratoren, ikke ordrer/);
    const e = (await t.store.readLog('hjem'))[0]!;
    assert.equal(e.handlingId, 'k:a:h');
    assert.equal(e.fortryd, 'Skift planen tilbage til månedlig.');
    assert.equal(e.kilde, 'hermes');
  } finally { await t.ryd(); }
});

test('POST /api/rum/hjem/kurator: 200 {intet:true} when nothing is new, 202 {runId} when there is mail', async () => {
  const t = await opsaet();
  try {
    const res = await t.post('/api/rum/hjem/kurator', {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { intet: true });
  } finally { await t.ryd(); }
  const mail: Runner = async (_c, args) => ({ code: 0, stdout: JSON.stringify(args[args.indexOf('-m') + 1] === 'Inbox' ? [{ id: 7, subject: 'Hej', date: '2026-10-27T09:00:00Z', from: [{ name: 'Rikke', email: 'rikke@example.org' }], flags: [] }] : []), stderr: '' });
  const u = await opsaet({ runner: mail, answer: () => '```json\n{"kort":[{"id":"k:rikke","type":"familie","titel":"Rikke spørger","betyder":"Rikke vil have svar.","prioritet":2}],"vurderinger":[],"intet":[]}\n```' });
  try {
    const res = await u.post('/api/rum/hjem/kurator', {});
    assert.equal(res.status, 202);
    const rec = u.sut.runs.get(((await res.json()) as { runId: string }).runId)!;
    assert.equal(rec.kind, 'kurator');
    assert.equal((await rec.finished).status, 'done', rec.error);
    assert.match(await (await u.sut.app.request('/rum/hjem')).text(), /Rikke spørger/);
    assert.equal((await u.post('/api/rum/hjem/kurator', {})).status, 200, 'the mail is seen now');
  } finally { await u.ryd(); }
});

test('Hjem shows the stored cards, and Ret passes the card to Hermes as context', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', type: 'tjeneste', titel: 'Cloudflare ændrer prisen', betyder: 'Dyrere fra november.', anbefaling: 'Skift til årlig.' })], intet: [{ titel: 'Nyhedsbrev', hvorfor: 'ingen handling' }] }));
    const out = await (await t.sut.app.request('/rum/hjem')).text();
    assert.match(out, /Lige nu/);
    assert.match(out, /data-element="Kortet: Cloudflare ændrer prisen"/);
    assert.match(out, /Intet at gøre/);
    const res = await t.post('/api/rum/hjem/chat', { besked: 'Det er forkert', kontekst: 'Kortet: Cloudflare ændrer prisen' });
    assert.equal(res.status, 202);
    await t.sut.runs.get(((await res.json()) as { runId: string }).runId)!.finished;
    const call = t.hermes.calls[0]!;
    assert.match(call.input, /Kortet: Cloudflare ændrer prisen/);
    assert.match(call.input, /Dyrere fra november\./);
    assert.match(call.input, /Det er forkert/);
    assert.equal((await t.store.readChat('hjem')).at(-2)?.tekst, 'Det er forkert', 'the stored chat keeps Henrik\'s own words');
  } finally { await t.ryd(); }
});

test('the dev answer for the Kuratoren is a valid answer: three cards (one with a ledger line) and some intet', async () => {
  const { devAnswer } = await import('../src/agent/devAnswers.ts');
  const { parseKuratorSvar } = await import('../src/rooms/hjem/kort.ts');
  const { extractJson } = await import('../src/rooms/dagen/schema.ts');
  const svar = parseKuratorSvar(extractJson(devAnswer({ instructions: 'Du er Kuratoren: …', input: '' })));
  assert.deepEqual(svar.nye.map((k) => k.type).sort(), ['familie', 'regning', 'tjeneste']);
  assert.equal(svar.nye.find((k) => k.type === 'regning')?.regnskab?.hvor, 'shelfatlas');
  assert.ok(svar.intet.length >= 1);
});

const NYHEDER_STATE = (genereret: string) => ({ dato: '2026-10-27', genereret, femLinjer: ['Eksempel Energi strammer reserverne.', 'Agentmodeller rykker.'], baner: [], forslag: [], nyhedsbreve: [], kilder: {}, gemt: [], hermesStatus: 'x' });
const SVAR = '```json\n{"kort":[],"vurderinger":[],"intet":[]}\n```';

/** The next Kuratoren run to appear (the start is async: it reads mail first). */
async function naesteKurator(t: Awaited<ReturnType<typeof opsaet>>, foer: number) {
  for (let i = 0; i < 100; i++) {
    const r = t.sut.runs.list().filter((x) => x.kind === 'kurator');
    if (r.length > foer) return t.sut.runs.get(r[0]!.id)!;
    await new Promise((res) => setTimeout(res, 10));
  }
  return null;
}
const ingenKurator = async (t: Awaited<ReturnType<typeof opsaet>>, foer: number): Promise<boolean> => {
  await new Promise((res) => setTimeout(res, 150));
  return t.sut.runs.list().filter((x) => x.kind === 'kurator').length === foer;
};

test('a finished Nyheder opdater starts a dyb kurator run once a day', async () => {
  const t = await opsaet({ answer: () => SVAR });
  const stop = t.sut.kurator('07-22/60');
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    const r1 = await naesteKurator(t, 0);
    assert.ok(r1, 'a kurator run started after the rebuild');
    assert.equal((await r1.finished).status, 'done', r1.error);
    assert.match(t.hermes.calls[0]?.instructions ?? '', /søg på nettet/, 'the first one is a deep run');
    assert.match(t.hermes.calls[0]?.input ?? '', /Eksempel Energi strammer reserverne/, 'today\'s Nyheder lines are passed');
    assert.ok((await laesKurator(t.store)).sidstDyb, 'sidstDyb is stored');

    // A second rebuild the same day: new Nyheder input, but no second deep run.
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T12:00:30Z'));
    await t.sut.runs.local('frontload', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    const r2 = await naesteKurator(t, 1);
    assert.ok(r2, 'a normal run starts');
    assert.equal((await r2.finished).status, 'done', r2.error);
    assert.doesNotMatch(t.hermes.calls[1]?.instructions ?? '', /søg på nettet/, 'no second deep run the same day');
  } finally { stop(); await t.ryd(); }
});

test('only a done opdater/frontload of Mail or Nyheder triggers; failed runs, other kinds and other rooms do not', async () => {
  const t = await opsaet({ answer: () => SVAR });
  const stop = t.sut.kurator('07-22/60');
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.sut.runs.local('opdater', async () => { throw new Error('boom'); }, { room: 'nyheder' }).finished;
    assert.ok(await ingenKurator(t, 0), 'a failed run does not trigger');
    await t.sut.runs.local('chat', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    assert.ok(await ingenKurator(t, 0), 'a chat run does not trigger');
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'dagen' }).finished;
    assert.ok(await ingenKurator(t, 0), 'another room does not trigger');
  } finally { stop(); await t.ryd(); }
});

test('kurator(spec) with an empty spec or "fra" starts nothing', async () => {
  const t = await opsaet({ answer: () => SVAR });
  const stop = t.sut.kurator('fra');
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    assert.ok(await ingenKurator(t, 0));
  } finally { stop(); await t.ryd(); }
});

test('the hourly check starts a normal run with new Nyheder, and is not due again within the hour', async () => {
  const t = await opsaet({ answer: () => SVAR });
  const plan = parseKuratorPlan('07-22/60')!;
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.store.writeState('hjem', tom({ sidstDyb: '2026-10-27T05:30:00Z' }));
    const run = await t.sut.kuratorTik(plan);
    assert.ok(run, 'new Nyheder → a run');
    assert.equal((await t.sut.runs.get(run.id)!.finished).status, 'done', run.error);
    assert.doesNotMatch(t.hermes.calls[0]?.instructions ?? '', /søg på nettet/, 'the deep run already ran today: the hourly run is normal');
    assert.equal(await t.sut.kuratorTik(plan), null, 'just ran (sidst = now) → not due');
  } finally { await t.ryd(); }
});

test('a Nyheder rebuild while a kurator run is in flight is not lost; the same state is not sent twice', async () => {
  const t = await opsaet({ answer: () => SVAR });
  const plan = parseKuratorPlan('07-22/60')!;
  const stop = t.sut.kurator('07-22/60');
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    const r1 = await t.sut.kuratorTik(plan);
    assert.ok(r1);
    // Nyheder is rebuilt (new genereret) before the run finishes.
    await t.store.writeState('nyheder', { ...NYHEDER_STATE('2026-10-27T11:59:59Z'), femLinjer: ['Ny linje efter ombygning.'] });
    assert.equal((await t.sut.runs.get(r1.id)!.finished).status, 'done', r1.error);
    const s = await laesKurator(t.store);
    assert.equal(s.nyhederSet, '2026-10-27T05:10:00Z', 'the run records the stamp it was given, not the newer one');
    // The next trigger (a rebuild finishing) still sees the new lines, even though sidst is later than genereret.
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    const r2 = await naesteKurator(t, 1);
    assert.ok(r2, 'the rebuilt Nyheder starts a run');
    assert.equal((await r2.finished).status, 'done', r2.error);
    assert.match(t.hermes.calls[1]?.input ?? '', /Ny linje efter ombygning/);
    assert.equal((await laesKurator(t.store)).nyhederSet, '2026-10-27T11:59:59Z');
    // The same state is not new input any more.
    assert.deepEqual(await (await t.post('/api/rum/hjem/kurator', {})).json(), { intet: true });
    assert.equal(t.hermes.calls.length, 2);
  } finally { stop(); await t.ryd(); }
});

test('a Nyheder rebuild while a kurator run is in flight: the deep run is not lost, the next check runs it', async () => {
  const t = await opsaet({ answer: () => SVAR, runner: MAIL, delayMs: 150 });
  const plan = parseKuratorPlan('07-22/60')!;
  const stop = t.sut.kurator('07-22/60');
  try {
    const r1 = t.sut.runs.get(((await (await t.post('/api/rum/hjem/kurator', {})).json()) as { runId: string }).runId)!;
    // Nyheder is built while that (normal) run is still thinking: its trigger is refused.
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T11:00:00Z'));
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    assert.equal(await t.sut.kuratorTik(plan), null, 'nothing starts while a run is in flight');
    assert.equal((await r1.finished).status, 'done', r1.error);
    assert.equal((await laesKurator(t.store)).sidstDyb, undefined);
    const r2 = await t.sut.kuratorTik(plan);
    assert.ok(r2, 'the deep run is still owed today, so the next check starts it');
    assert.equal((await t.sut.runs.get(r2.id)!.finished).status, 'done', r2.error);
    assert.match(t.hermes.calls.at(-1)?.instructions ?? '', /søg på nettet/);
    assert.ok((await laesKurator(t.store)).sidstDyb);
    assert.equal(await t.sut.kuratorTik(plan), null, 'paid: not due again within the hour');
  } finally { stop(); await t.ryd(); }
});

test('a Mail rebuild asks for the deep run when today\'s Nyheder is built and no deep run ran today', async () => {
  const t = await opsaet({ answer: () => SVAR, runner: MAIL });
  const stop = t.sut.kurator('07-22/60');
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'mail' }).finished;
    const r = await naesteKurator(t, 0);
    assert.ok(r);
    assert.equal((await r.finished).status, 'done', r.error);
    assert.match(t.hermes.calls[0]?.instructions ?? '', /søg på nettet/);
  } finally { stop(); await t.ryd(); }
});

test('a Nyheder state whose stamp is already seen is not new input', async () => {
  const t = await opsaet({ answer: () => SVAR });
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.store.writeState('hjem', tom({ sidst: '2026-10-27T06:00:00Z', nyhederSet: '2026-10-27T05:10:00Z' }));
    const res = await t.post('/api/rum/hjem/kurator', {});
    assert.deepEqual(await res.json(), { intet: true });
    assert.equal(t.hermes.calls.length, 0);
  } finally { await t.ryd(); }
});

const MAIL: Runner = async (_c, args) => ({ code: 0, stdout: JSON.stringify(args[args.indexOf('-m') + 1] === 'Inbox' ? [{ id: 7, subject: 'Hej', date: '2026-10-27T09:00:00Z', from: [{ name: 'Rikke', email: 'rikke@example.org' }], flags: [] }] : []), stderr: '' });

test('two hourly checks in the same hour with no new input read mail only once', async () => {
  let kald = 0;
  const t = await opsaet({ answer: () => SVAR, runner: async (c, a) => { kald++; return ingenMail(c, a); } });
  const plan = parseKuratorPlan('07-22/60')!;
  try {
    assert.equal(await t.sut.kuratorTik(plan), null);
    const efterFoerste = kald;
    assert.ok(efterFoerste > 0, 'the first check did read mail');
    assert.equal(await t.sut.kuratorTik(plan), null);
    assert.equal(kald, efterFoerste, 'the second check is gated by the in-memory sidstTjek, not by sidst');
  } finally { await t.ryd(); }
});

test('a failed hourly run is not retried within hverMin', async () => {
  const t = await opsaet({ answer: () => 'not json' });
  const plan = parseKuratorPlan('07-22/60')!;
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    const run = await t.sut.kuratorTik(plan);
    assert.ok(run);
    assert.equal((await t.sut.runs.get(run.id)!.finished).status, 'failed');
    assert.equal((await laesKurator(t.store)).sidst, undefined, 'a failed run stamps nothing in the state');
    assert.equal(await t.sut.kuratorTik(plan), null, 'not retried in the same hour');
    assert.equal(t.hermes.calls.length, 2, 'one run: the answer and its one correction (KC-0050), no second run');
  } finally { await t.ryd(); }
});

test('dismissing a card between two runs keeps nyhederSet (and the rest of the state), so the same news is not re-sent', async () => {
  const t = await opsaet({ answer: () => SVAR });
  try {
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a' })], cursor: 'c1', sete: ['m1'], nyhederSet: '2026-10-27T05:10:00Z', regnskab: { 'k:z': { hvor: 'privat', status: 'skrevet' } } }));
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/luk', {})).status, 200);
    const s = await laesKurator(t.store);
    assert.equal(s.nyhederSet, '2026-10-27T05:10:00Z');
    assert.equal(s.cursor, 'c1');
    assert.deepEqual(s.sete, ['m1']);
    assert.deepEqual(s.regnskab, { 'k:z': { hvor: 'privat', status: 'skrevet' } });
    assert.deepEqual(await (await t.post('/api/rum/hjem/kurator', {})).json(), { intet: true });
    assert.equal(t.hermes.calls.length, 0, 'the same news is not sent twice');
  } finally { await t.ryd(); }
});

test('stop() detaches the onFinished listener: a finished Nyheder opdater after stop starts nothing', async () => {
  const t = await opsaet({ answer: () => SVAR });
  const stop = t.sut.kurator('07-22/60');
  try {
    stop();
    await t.store.writeState('nyheder', NYHEDER_STATE('2026-10-27T05:10:00Z'));
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'nyheder' }).finished;
    assert.ok(await ingenKurator(t, 0));
  } finally { stop(); await t.ryd(); }
});

test('a finished Mail opdater triggers a non-deep run', async () => {
  const t = await opsaet({ answer: () => SVAR, runner: MAIL });
  const stop = t.sut.kurator('07-22/60');
  try {
    await t.sut.runs.local('opdater', async () => ({ text: 'ok' }), { room: 'mail' }).finished;
    const r = await naesteKurator(t, 0);
    assert.ok(r, 'a run started after the Mail rebuild');
    assert.equal((await r.finished).status, 'done', r.error);
    assert.doesNotMatch(t.hermes.calls[0]?.instructions ?? '', /søg på nettet/, 'Mail never asks for a deep run');
    assert.match(t.hermes.calls[0]?.input ?? '', /Hej/);
  } finally { stop(); await t.ryd(); }
});

const FLYT = (id: string, til = 'privat') => `Det er flyttet til det private regnskab.\n\`\`\`json\n{"flyt":"${id}","til":"${til}"}\n\`\`\``;

async function chatOgVent(t: Awaited<ReturnType<typeof opsaet>>, besked: string, kontekst?: string): Promise<void> {
  const res = await t.post('/api/rum/hjem/chat', { besked, ...(kontekst ? { kontekst } : {}) });
  assert.equal(res.status, 202);
  await t.sut.runs.get(((await res.json()) as { runId: string }).runId)!.finished;
}

test('Hjem chat: the open cards are in the input (afledt data), and a chat answer with {"flyt":"<id>"} moves the ledger row', async () => {
  const t = await opsaet({ answer: () => FLYT('regning:vercel-7') });
  try {
    const k = await t.skrevet(kort(), 'shelfatlas');
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    await chatOgVent(t, 'Den hører til det private', 'Kortet: Vercel-regning');
    const call = t.hermes.calls[0]!;
    assert.match(call.input, /regning:vercel-7/, 'the open card is listed with its id (as afledt data, KC-0123)');
    assert.match(call.instructions ?? '', /Retter Henrik et kort/);
    assert.match(call.input, /regning:vercel-7: Vercel-regning[^\n]*\[ligger i: ShelfAtlas-regnskabet\]/, 'where the row is now');
    assert.doesNotMatch(await t.laes('shelfatlas'), /Vercel/, 'removed from the old ledger');
    assert.match(await t.laes('privat'), /Vercel/);
    const s = await laesKurator(t.store);
    assert.equal(s.kort[0]!.skrevet?.hvor, 'privat');
    assert.equal(s.regnskab?.['regning:vercel-7']?.hvor, 'privat');
    assert.match((await t.store.readLog('hjem')).at(-1)?.tekst ?? '', /Flyttede/);
    const svar = (await t.store.readChat('hjem')).at(-1)!;
    assert.equal(svar.fra, 'hermes');
    assert.doesNotMatch(svar.tekst, /```|"flyt"/,'the json block is not shown');
    assert.match(svar.tekst, /Det er flyttet til det private regnskab\./);
  } finally { await t.ryd(); }
});

test('KC-0119: a stored card with the legacy kind forespoergsel is read as familie', async () => {
  const t = await opsaet();
  try {
    const gammel = { ...kort({ id: 'k:rikke' }), type: 'forespoergsel' } as unknown as Kort;
    await t.store.writeState('hjem', tom({ kort: [gammel] }));
    assert.equal((await laesKurator(t.store)).kort[0]!.type, 'familie');
  } finally { await t.ryd(); }
});

test('Hjem chat: a flyt for an unknown card, or for a card without a written row, is ignored', async () => {
  const t = await opsaet({ answer: (r) => FLYT(/Ukendt/.test(r.input) ? 'findes:ikke' : 'k:uden-raekke') });
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:uden-raekke', type: 'familie' })] }));
    await chatOgVent(t, 'Ukendt kort');
    await chatOgVent(t, 'Kort uden række');
    assert.equal(await t.laes('shelfatlas'), '');
    assert.equal(await t.laes('privat'), '');
    assert.equal((await t.store.readLog('hjem')).length, 0, 'nothing moved, nothing logged');
    const chat = await t.store.readChat('hjem');
    assert.doesNotMatch(chat.at(-1)!.tekst, /```/, 'the block is stripped even when ignored');
  } finally { await t.ryd(); }
});

test('Hjem chat: a flyt whose "til" is the ledger the row is already in does not move it and logs nothing', async () => {
  const t = await opsaet({ answer: () => FLYT('regning:vercel-7', 'shelfatlas') });
  try {
    const k = await t.skrevet(kort(), 'shelfatlas');
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    await chatOgVent(t, 'Den hører til ShelfAtlas');
    assert.match(await t.laes('shelfatlas'), /Vercel/, 'still in ShelfAtlas');
    assert.doesNotMatch(await t.laes('privat'), /Vercel/);
    assert.equal((await t.store.readLog('hjem')).length, 0);
    assert.equal((await laesKurator(t.store)).regnskab?.['regning:vercel-7']?.hvor, 'shelfatlas');
  } finally { await t.ryd(); }
});

test('Hjem chat: a flyt with a missing or invalid "til" is ignored', async () => {
  for (const svar of ['```json\n{"flyt":"regning:vercel-7"}\n```', FLYT('regning:vercel-7', 'andet')]) {
    const t = await opsaet({ answer: () => svar });
    try {
      const k = await t.skrevet(kort(), 'shelfatlas');
      await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
      await chatOgVent(t, 'Flyt den');
      assert.match(await t.laes('shelfatlas'), /Vercel/);
      assert.equal((await t.store.readLog('hjem')).length, 0);
    } finally { await t.ryd(); }
  }
});

test('Hjem chat: only the flyt block is stripped from the shown answer; other code blocks stay', async () => {
  const kode = 'Her er et eksempel:\n```js\nconsole.log(1)\n```\nOg tal:\n```json\n{"a":1}\n```';
  const t = await opsaet({ answer: () => `${kode}\n${FLYT('findes:ikke')}` });
  try {
    await chatOgVent(t, 'Vis et eksempel');
    const tekst = (await t.store.readChat('hjem')).at(-1)!.tekst;
    assert.ok(tekst.includes('```js\nconsole.log(1)\n```'));
    assert.ok(tekst.includes('{"a":1}'));
    assert.doesNotMatch(tekst, /"flyt"/);
  } finally { await t.ryd(); }
});

test('Hjem chat: a vault error while moving does not fail the run, and the answer is stored', async () => {
  const t = await opsaet({ answer: () => FLYT('regning:vercel-7') });
  const fejl = console.error;
  const set: unknown[][] = [];
  console.error = (...a: unknown[]) => { set.push(a); };
  try {
    const k = await t.skrevet(kort(), 'shelfatlas');
    await t.store.writeState('hjem', tom({ kort: [k], regnskab: { [k.id]: { hvor: 'shelfatlas', status: 'skrevet' } } }));
    await mkdir(t.fil('privat'), { recursive: true }); // the target ledger path is a directory → the write throws
    const res = await t.post('/api/rum/hjem/chat', { besked: 'Den er privat' });
    const run = t.sut.runs.get(((await res.json()) as { runId: string }).runId)!;
    await run.finished;
    assert.equal(run.status, 'done');
    assert.ok(set.some((a) => String(a[0]).includes('flyt mislykkedes')), 'the move really threw and was logged');
    assert.match((await t.store.readChat('hjem')).at(-1)!.tekst, /Det er flyttet/);
  } finally { console.error = fejl; await t.ryd(); }
});

// ---------- KC-0096: Senere ----------

const hjemHtml = async (t: Awaited<ReturnType<typeof opsaet>>): Promise<string> => ((await (await t.sut.app.request('/api/rum/hjem/fragment')).json()) as { html: string }).html;
const taeller = (html: string): number => Number(/(\d+) venter på dig/.exec(html)?.[1] ?? 0);

test('senere validates the card id and the choice, and writes nothing when it refuses', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a' })] }));
    assert.equal((await t.post('/api/rum/hjem/kort/findes-ikke/senere', { til: 'morgen' })).status, 404);
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/senere', {})).status, 400, 'no til');
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'i-overmorgen' })).status, 400, 'unknown til');
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 5 })).status, 400, 'til must be text');
    assert.equal((await laesKurator(t.store)).kort[0]?.udsatTil, undefined);
    assert.equal((await t.store.readLog('hjem')).length, 0);
  } finally { await t.ryd(); }
});

test('senere "i morgen": the card is gone at once and not counted; the log says so; Fortryd brings it straight back', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', titel: 'Kort A' }), kort({ id: 'k:b', titel: 'Kort B', prioritet: 4 })] }));
    const foer = await hjemHtml(t);
    assert.match(foer, /data-kort-id="k:a"/);
    assert.equal(taeller(foer), 2);
    const res = await t.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'morgen' });
    assert.equal(res.status, 200);
    assert.equal(t.hermes.calls.length, 0, 'no Hermes run: the app does it');
    const s = await laesKurator(t.store);
    assert.equal(s.kort.find((k) => k.id === 'k:a')?.udsatTil, '2026-10-28T06:00:00.000Z', 'tomorrow 07.00 Copenhagen');
    assert.deepEqual(s.afvist, [], 'a snoozed card is not dismissed');
    const efter = await hjemHtml(t);
    assert.ok(!efter.includes('data-kort-id="k:a"'), 'gone from Lige nu');
    assert.match(efter, /data-kort-id="k:b"/);
    assert.equal(taeller(efter), 1, 'not counted among those waiting');
    const e = (await t.store.readLog('hjem')).find((x) => x.handlingId === 'senere:k:a');
    assert.equal(e?.tekst, 'Udsat til i morgen kl. 07: Kort A');
    assert.equal(e?.kilde, 'henrik');
    assert.ok(e?.fortryd);
    assert.match(efter, new RegExp(`data-hjem-fortryd="${e?.id}"`), 'the log line offers Fortryd');

    const u = await t.post(`/api/rum/hjem/fortryd/${e?.id}`, {});
    assert.equal(u.status, 200);
    assert.equal(t.hermes.calls.length, 0, 'Fortryd needs no Hermes run either');
    assert.equal((await laesKurator(t.store)).kort.find((k) => k.id === 'k:a')?.udsatTil, undefined);
    const tilbage = await hjemHtml(t);
    assert.match(tilbage, /data-kort-id="k:a"/);
    assert.equal(taeller(tilbage), 2);
    assert.ok((await t.store.readLog('hjem')).find((x) => x.id === e?.id)?.fortrudt, 'the line is marked undone');
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${e?.id}`, {})).status, 409, 'already undone');
  } finally { await t.ryd(); }
});

test('senere "i aften" is 18.00 and is refused (409) from 17.00 on; "i morgen" always works', async () => {
  const t = await opsaet();
  const sent = await opsaet({ now: new Date('2026-10-27T16:00:00Z') }); // 17.00 Copenhagen
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', titel: 'Kort A' })] }));
    assert.equal((await t.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'aften' })).status, 200);
    assert.equal((await laesKurator(t.store)).kort[0]?.udsatTil, '2026-10-27T17:00:00.000Z');
    assert.equal((await t.store.readLog('hjem'))[0]?.tekst, 'Udsat til i aften kl. 18: Kort A');

    await sent.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a' })] }));
    assert.equal((await sent.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'aften' })).status, 409);
    assert.equal((await laesKurator(sent.store)).kort[0]?.udsatTil, undefined);
    assert.ok(!(await hjemHtml(sent)).includes('data-senere="aften"'), 'the choice is not even drawn after 17.00');
    assert.equal((await sent.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'morgen' })).status, 200);
  } finally { await t.ryd(); await sent.ryd(); }
});

test('a snoozed card is back by itself when the time comes, and a Kuratoren write of the same id in between does not wake it', async () => {
  const foerTid = await opsaet();
  const efterTid = await opsaet({ now: new Date('2026-10-28T06:00:00Z') });
  try {
    await foerTid.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', titel: 'Kort A' })] }));
    assert.equal((await foerTid.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'morgen' })).status, 200);
    // Kuratoren's hourly run re-emits the card id and writes the merged state.
    const s = await laesKurator(foerTid.store);
    await foerTid.store.writeState('hjem', mergeKort(s, { nye: [kort({ id: 'k:a', titel: 'Kort A, nyt ordlyd' })], behold: [], opdater: [], fjern: [], intet: [] }, NOW, 'privat'));
    assert.ok(!(await hjemHtml(foerTid)).includes('data-kort-id="k:a"'), 'still away');
    // Same stored state, but the clock is at 07.00 tomorrow.
    await efterTid.store.writeState('hjem', await laesKurator(foerTid.store));
    const frag = await hjemHtml(efterTid);
    assert.match(frag, /data-kort-id="k:a"/, 'back at 07.00');
    assert.equal(taeller(frag), 1, 'and counted again');
  } finally { await foerTid.ryd(); await efterTid.ryd(); }
});

test('Fortryd of a snooze when the card is gone is a 409, and snoozing a card twice moves the time', async () => {
  const t = await opsaet();
  try {
    await t.store.writeState('hjem', tom({ kort: [kort({ id: 'k:a', titel: 'Kort A' })] }));
    await t.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'morgen' });
    await t.post('/api/rum/hjem/kort/k%3Aa/senere', { til: 'aften' });
    assert.equal((await laesKurator(t.store)).kort[0]?.udsatTil, '2026-10-27T17:00:00.000Z', 'the latest choice wins');
    const e = (await t.store.readLog('hjem')).find((x) => x.tekst.startsWith('Udsat til i aften'));
    await t.post('/api/rum/hjem/kort/k%3Aa/luk', {});
    assert.equal((await t.post(`/api/rum/hjem/fortryd/${e?.id}`, {})).status, 409, 'the card is gone: nothing to bring back');
  } finally { await t.ryd(); }
});
