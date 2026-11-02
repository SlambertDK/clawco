// KC-0170 slice 3 (part B): the scenarios whose words the connectors, the limits and the trust pages say to the user:
// every card in each state, the fixed health words, the refusals a connect or a handling gives, the policy reasons and the
// "Hvad Clawco ved om dig" page. Each scenario returns plain data; test/fixtures/sprog-kilder/da.json was captured from
// these BEFORE the strings moved into the tekster.ts tables, and test/kilder/sprog-kilder.test.ts holds a Danish run (no
// language chosen, or da) to it byte for byte, and an English run to "no Danish word left" (fixtures hold no Danish words
// of their own: names are invented ASCII, a Danish word in a fixture would be a false positive).
// Change the golden only when the Danish copy changes on purpose.

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import { lavRegister, KILDER_LOG } from '../../src/kilder/register.ts';
import { KildeFejl, SLAGS, AUTH, type Auth, type Kilde, type KildeKontekst, type Slags } from '../../src/kilder/types.ts';
import { genforbindFelter, GENFORBIND_KANAL, KNAP, kortTekst, stemmeSaetning, type KortTilstand } from '../../src/kilder/helbred-tekst.ts';
import { gemKildeHemmelighed, HemmelighedFejl, laesKildeHemmelighed, saetAgentMiljoeNoegle, saetMiljoeNoegle, fjernKildeHemmelighed } from '../../src/kilder/hemmeligheder.ts';
import { renLaesning } from '../../src/kilder/laesning.ts';
import { googleOpsaetTrin, googleTilfoejTrin } from '../../src/kilder/google/opsaet.ts';
import { byttKode, forny, KALENDER_KRAV, MAIL_KRAV, SCOPE_ADRESSE, SCOPE_KALENDER, SCOPE_MAIL, type Hent } from '../../src/kilder/google/oauth.ts';
import { googleKalender } from '../../src/kilder/google-kalender/kilde.ts';
import { mailGmail } from '../../src/kilder/mail-gmail/kilde.ts';
import { GMAIL_FEJLTEKST, klassificerGmail } from '../../src/kilder/mail-gmail/fejl.ts';
import { mailImapKilde } from '../../src/kilder/mail-imap/mail-imap.ts';
import { FEJLTEKST, klassificer } from '../../src/kilder/mail-imap/fejl.ts';
import { forbindelse, PRESETS, TJENESTER } from '../../src/kilder/mail-imap/presets.ts';
import { nyhederRss } from '../../src/kilder/nyheder-rss/kilde.ts';
import { tjekAdresse } from '../../src/kilder/nyheder-rss/adresse.ts';
import { HentFejl } from '../../src/kilder/nyheder-rss/hent.ts';
import { parseFeed, parseOpml } from '../../src/kilder/nyheder-rss/parse.ts';
import { noterKilde, kiraNoter } from '../../src/kilder/noter/noter.ts';
import { lavNyVault, adopterVault } from '../../src/kilder/noter/vault.ts';
import { iRod, filnavn } from '../../src/kilder/noter/sti.ts';
import { beskederKilde } from '../../src/kilder/beskeder/kilde.ts';
import { LOG_FIL, STATUS_FIL } from '../../src/kilder/beskeder/jsonl.ts';
import { samtaleNoegle } from '../../src/kilder/beskeder/valg.ts';
import { aulaKalender } from '../../src/kilder/aula-kalender/kilde.ts';
import { afgoer, aldrigTilladt, ikkeEndnu } from '../../src/graenser/afgoer.ts';
import { vaerktoejTilladt } from '../../src/graenser/opsyn.ts';
import { NodstopNaegtet, startIgen, stopAlt, PauseFejl } from '../../src/graenser/nodstop.ts';
import { renderSletAlt, renderViden, type Viden } from '../../src/tillid/viden.ts';
import { parseRegler, serialiserRegler } from '../../src/tillid/regler.ts';
import { raekke, ugeLinje, ugeSoejler, ugeVisning, ugeTekst, type Dagstal } from '../../src/tillid/dagstal.ts';
import { sletAlt } from '../../src/tillid/slet.ts';
import { pauseForslag } from '../../src/tillid/forslag.ts';
import { skrivPerson, opdaterPerson } from '../../src/kilder/noter/personer.ts';
import { skrivProfil, fjernProfil } from '../../src/kilder/noter/profil.ts';
import { tilBesked } from '../../src/kilder/beskeder/besked.ts';
import { samtaler } from '../../src/kilder/beskeder/valg.ts';
import { parseLinjer } from '../../src/kilder/beskeder/jsonl.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const NU = new Date('2026-11-02T08:00:00Z');
const EJER: Person = { id: 'ella', login: null, navn: 'Ella', rolle: 'ejer' };
const GAEST: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };
const ctx = (valg: Record<string, string> = {}, hem: Record<string, string> | null = null, zone: KildeKontekst['zone'] = 'privat'): KildeKontekst => ({ nu: NU, zone, valg, hemmelighed: async () => hem });

/** The outcome of a call: its value, or the message (and status) of what it threw. Never a stack. */
async function fang(fn: () => unknown): Promise<unknown> {
  try { return { ok: await fn() }; } catch (err) {
    return { fejl: err instanceof Error ? err.message : String(err), ...(err instanceof KildeFejl ? { status: err.status } : {}) };
  }
}
/** Runs the calls one after the other (some change what the next sees). */
async function alle(liste: [string, () => unknown][]): Promise<Record<string, unknown>> {
  const ud: Record<string, unknown> = {};
  for (const [n, f] of liste) ud[n] = await fang(f);
  return ud;
}

async function medMappe<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-sprog-kilder-'));
  try {
    const ud = await fn(dir);
    // The folder's name is random and sits in some sentences: it is written as <tmp>, also as the real path of a symlinked tmp dir.
    const ren = JSON.stringify(ud).replaceAll(await realpath(dir), '<tmp>').replaceAll(dir, '<tmp>');
    return ren === undefined ? ud : JSON.parse(ren) as T;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const stub = (svar: () => { status: number; json?: unknown }): Hent => (async () => {
  const s = svar();
  return new Response(JSON.stringify(s.json ?? {}), { status: s.status, headers: { 'content-type': 'application/json' } });
}) as Hent;
const faldNed: Hent = (async () => { throw new Error('net'); }) as Hent;

type Scenarie = () => Promise<unknown>;

export const SCENARIER: Record<string, Scenarie> = {
  // --- the fixed words of a failing connection (KC-0139) ---
  'helbred-kort': async () => {
    const ud: Record<string, unknown> = {};
    for (const vist of ['snart-udloebet', 'log-ind-igen', 'nede'] as KortTilstand[]) for (const auth of AUTH) for (const slags of SLAGS) ud[`${vist}/${auth}/${slags}`] = kortTekst(vist, auth as Auth, slags as Slags);
    return ud;
  },
  'helbred-ord': async () => ({
    knap: { ...KNAP }, kanal: { ...GENFORBIND_KANAL },
    stemme: [stemmeSaetning('nede', 'oauth', 'kalender'), stemmeSaetning('log-ind-igen', 'bridge', 'beskeder'), stemmeSaetning('ok', 'oauth', 'mail')],
    felter: genforbindFelter([{ navn: 'adgangskode', etiket: 'Kode', type: 'hemmelig', paakraevet: true }], {}),
  }),

  // --- the registry's refusals and its log lines ---
  'register': async () => medMappe(async (dir) => {
    const store = createFileStore(dir, { now: () => NU });
    const felter = [
      { navn: 'konto', etiket: 'Konto', type: 'tekst' as const, paakraevet: true },
      { navn: 'valg', etiket: 'Valg', type: 'tekst' as const, paakraevet: false, muligheder: [{ vaerdi: 'a', etiket: 'A' }] },
      { navn: 'skjult', etiket: 'Skjult', type: 'tekst' as const, paakraevet: false, skjult: true },
    ];
    const lavK = (over: Partial<Kilde> = {}): Kilde => ({
      id: 'test-k', navn: 'Testen', slags: 'kalender', zone: 'privat', auth: 'bridge',
      read: async () => ({ slags: 'kalender', hentet: NU.toISOString(), uklar: true, data: { generated: NU.toISOString(), days: [], errors: [] } }),
      kort: async () => ({ titel: 'T', tekst: 't', handling: 'Forbind', felter }),
      helbred: async () => ({ status: 'ok' }),
      ...over,
    });
    const r = lavRegister({ dataDir: dir, store, nu: () => NU, adresse: 'https://kontrol.example.test' });
    r.registrer(lavK());
    r.registrer(lavK({ id: 'test-nede', helbred: async () => ({ status: 'nede' }) }));
    r.registrer(lavK({ id: 'test-fejler', read: async () => { throw new Error('boom'); } }));
    r.registrer(lavK({ id: 'test-slags', read: async () => ({ slags: 'mail', hentet: NU.toISOString(), uklar: true, data: [] }) }));
    r.registrer(lavK({ id: 'test-opsaet', opsaet: async () => { throw new Error('boom'); } }));
    r.registrer(lavK({ id: 'test-ugyldig', opsaet: async () => ({ tekst: 'x', valg: { ukendt: 'y' } }) }));
    r.registrer(lavK({ id: 'test-verb', verber: { flyt: { verb: 'sorter', tekst: 'Flyt' } }, act: async () => ({ ok: true, tekst: 'ok' }) }));
    const handl = (id: string, navn: string, person: Person, kanal: 'knap' | 'stemme' = 'knap') => r.handl(id, navn, {}, { person, kanal });
    return alle([
      ['ukendt-id', () => r.laes('findes-ikke')],
      ['ikke-forbundet', () => r.laes('test-k')],
      ['body-ikke-objekt', () => r.forbind('test-k', 5, EJER)],
      ['body-ukendt-felt', () => r.forbind('test-k', { x: 1 }, EJER)],
      ['body-ukendt-zone', () => r.forbind('test-k', { zone: 'x' }, EJER)],
      ['felter-ikke-objekt', () => r.forbind('test-k', { felter: 5 }, EJER)],
      ['felt-ukendt', () => r.forbind('test-k', { felter: { foo: 'a' } }, EJER)],
      ['felt-skjult', () => r.forbind('test-k', { felter: { skjult: 'a' } }, EJER)],
      ['felt-mangler', () => r.forbind('test-k', { felter: {} }, EJER)],
      ['felt-ugyldig', () => r.forbind('test-k', { felter: { konto: 'a\u0001b' } }, EJER)],
      ['felt-ikke-valg', () => r.forbind('test-k', { felter: { konto: 'a', valg: 'z' } }, EJER)],
      ['forbind-ok', async () => (await r.forbind('test-k', { felter: { konto: 'a' } }, EJER)) && 'forbundet'],
      ['laes-ok', async () => (await r.laes('test-k')).slags],
      ['forbind-opsaet-fejler', () => r.forbind('test-opsaet', { felter: { konto: 'a' } }, EJER)],
      ['forbind-opsaet-ugyldig', () => r.forbind('test-ugyldig', { felter: { konto: 'a' } }, EJER)],
      ['forbind-fejler-laes', async () => { await r.forbind('test-fejler', { felter: { konto: 'a' } }, EJER); return r.laes('test-fejler'); }],
      ['forbind-forkert-slags', async () => { await r.forbind('test-slags', { felter: { konto: 'a' } }, EJER); return r.laes('test-slags'); }],
      ['forbind-nede', async () => { await r.forbind('test-nede', { felter: { konto: 'a' } }, EJER); return r.laes('test-nede'); }],
      ['tilbage-ukendt-state', () => r.tilbage('test-k', 'x', 'kode', EJER)],
      ['aendre-ikke-forbundet', () => r.aendreValg('test-verb', EJER, async () => ({ tekst: 'x', valg: {} }))],
      ['aendre-fejler', () => r.aendreValg('test-k', EJER, async () => { throw new Error('boom'); })],
      ['aendre-ugyldigt', () => r.aendreValg('test-k', EJER, async () => ({ tekst: 'x', valg: { konto: 5 } }) as never)],
      ['aendre-ok', async () => { await r.aendreValg('test-k', EJER, async () => ({ tekst: 'Satte det.', valg: { konto: 'b' } })); return 'ok'; }],
      ['handl-ukendt', () => handl('test-k', 'flyv', EJER)],
      ['handl-ikke-forbundet', () => handl('test-verb', 'flyt', EJER)],
      ['handl-gaest', async () => { await r.forbind('test-verb', { felter: { konto: 'a' } }, EJER); return handl('test-verb', 'flyt', GAEST); }],
      ['handl-ok', () => handl('test-verb', 'flyt', EJER)],
      ['frakobl-ikke-forbundet', () => r.frakobl('test-slags', { ...EJER }).then(() => r.frakobl('test-slags', EJER))],
      ['frakobl-ok', () => r.frakobl('test-k', EJER)],
      ['log', async () => (await store.readLog(KILDER_LOG, 50)).map((e) => e.tekst)],
    ]);
  }),
  'laesning': async () => alle([['forkert-slags', () => renLaesning({ id: 'x', navn: 'Testen', slags: 'mail' } as Kilde, { slags: 'kalender' })]]),

  // --- the one secret module ---
  'hemmeligheder': async () => medMappe(async (dir) => alle([
    ['noegle-ikke-tilladt', () => saetMiljoeNoegle('PATH', 'x', { fil: path.join(dir, '.env'), env: {} })],
    ['vaerdi-ugyldig', () => saetMiljoeNoegle('KC_GOOGLE_CLIENT_ID', 'a b', { fil: path.join(dir, '.env'), env: {} })],
    ['agent-noegle', () => saetAgentMiljoeNoegle(path.join(dir, 'a.env'), 'KC_X', 'v', [])],
    ['kilde-id', () => gemKildeHemmelighed(dir, '../x', {})],
    ['kilde-felt', () => gemKildeHemmelighed(dir, 'k', { 'X!': 'v' })],
    ['laes-ugyldig', async () => { await mkdir(path.join(dir, 'hemmeligheder'), { recursive: true }); await writeFile(path.join(dir, 'hemmeligheder', 'k2.json'), 'ikke json'); return laesKildeHemmelighed(dir, 'k2'); }],
    ['laes-ikke-objekt', async () => { await writeFile(path.join(dir, 'hemmeligheder', 'k3.json'), '[]'); return laesKildeHemmelighed(dir, 'k3'); }],
    ['fjern-ukendt-id', () => fjernKildeHemmelighed(dir, '../x')],
    ['er-fejl', () => { throw new HemmelighedFejl('x'); }],
  ])),

  // --- Google: the setup steps, the refusals ---
  'google-trin': async () => ({
    fuld: googleOpsaetTrin({ tilbage: 'https://k.example.test/api/kilder/google-kalender/tilbage', api: 'Google Calendar API', scope: SCOPE_KALENDER }),
    uden: googleOpsaetTrin({ tilbage: null }),
    tilfoej: googleTilfoejTrin({ tilbage: 'https://k.example.test/x', scope: SCOPE_MAIL }),
    tilfoejUden: googleTilfoejTrin({ tilbage: null, scope: SCOPE_MAIL }),
  }),
  'google-krav': async () => ({ kalender: { mangler: KALENDER_KRAV.mangler, formeget: KALENDER_KRAV.formeget }, mail: { mangler: MAIL_KRAV.mangler, formeget: MAIL_KRAV.formeget } }),
  'google-oauth': async () => {
    const klient = { id: 'k', hemmelighed: 's' };
    const tok = (json: object): Hent => stub(() => ({ status: 200, json }));
    const kode = (hent: Hent) => byttKode({ hent, klient, kode: 'c', verifier: 'v'.repeat(43), tilbage: 'https://k.example.test/t', krav: KALENDER_KRAV });
    return alle([
      ['nede', () => forny({ hent: faldNed, klient, refresh: 'r' })],
      ['invalid_grant', () => forny({ hent: stub(() => ({ status: 400, json: { error: 'invalid_grant' } })), klient, refresh: 'r' })],
      ['invalid_client', () => forny({ hent: stub(() => ({ status: 401, json: { error: 'invalid_client' } })), klient, refresh: 'r' })],
      ['status', () => forny({ hent: stub(() => ({ status: 503 })), klient, refresh: 'r' })],
      ['ingen-adgang', () => forny({ hent: tok({}), klient, refresh: 'r' })],
      ['ingen-refresh', () => kode(tok({ access_token: 'a', scope: SCOPE_KALENDER }))],
      ['scope-mangler', () => kode(tok({ access_token: 'a', refresh_token: 'r', scope: 'openid' }))],
      ['scope-for-meget', () => kode(tok({ access_token: 'a', refresh_token: 'r', scope: `${SCOPE_KALENDER} https://www.googleapis.com/auth/calendar` }))],
      ['mail-for-meget', () => byttKode({ hent: tok({ access_token: 'a', refresh_token: 'r', scope: `${SCOPE_MAIL} ${SCOPE_ADRESSE.join(' ')} https://www.googleapis.com/auth/drive` }), klient, kode: 'c', verifier: 'v'.repeat(43), tilbage: 'https://k.example.test/t', krav: MAIL_KRAV })],
    ]);
  },

  // --- the cards, each state ---
  'kort-google-kalender': async () => {
    const ENV = { KC_GOOGLE_CLIENT_ID: 'k', KC_GOOGLE_CLIENT_SECRET: 's' };
    const uden = googleKalender({ env: {}, adresse: 'https://k.example.test' });
    const med = googleKalender({ env: ENV, adresse: 'https://k.example.test' });
    return {
      navn: med.navn,
      uden: await uden.kort(ctx()), udenAdresse: await googleKalender({ env: {} }).kort(ctx()), med: await med.kort(ctx()),
      helbredUden: await uden.helbred(ctx()), helbredIngenAdgang: await med.helbred(ctx()),
      fejl: await alle([
        ['start-uden-klient', () => uden.oauth!.start('s', 'https://k.example.test/t', ctx())],
        ['start-uden-adresse', () => med.oauth!.start('s', 'ikke-en-adresse', ctx())],
        ['tilbage-ukendt', () => med.oauth!.tilbage('c', ctx(), 'ukendt-state')],
        ['read-uden-klient', () => uden.read(ctx({}, { refresh_token: 'r' }))],
        ['read-uden-adgang', () => med.read(ctx())],
        ['read-nede', () => googleKalender({ env: ENV, hent: faldNed }).read(ctx({}, { refresh_token: 'r' }))],
        ['read-liste', () => googleKalender({ env: ENV, hent: stub(() => ({ status: 200, json: { access_token: 'a', expires_in: 3600 } })) }).read(ctx({}, { refresh_token: 'r' }))],
      ]),
    };
  },
  'kort-mail-gmail': async () => {
    const ENV = { KC_GOOGLE_CLIENT_ID: 'k', KC_GOOGLE_CLIENT_SECRET: 's' };
    const uden = mailGmail({ env: {}, adresse: 'https://k.example.test' });
    const med = mailGmail({ env: ENV, adresse: 'https://k.example.test' });
    const kalOgsaa = { ...ctx(), erForbundet: async (x: string) => x === 'google-kalender' };
    return {
      navn: med.navn,
      uden: await uden.kort(ctx()), med: await med.kort(ctx()), forbundetKalender: await med.kort(kalOgsaa),
      forbundet: await med.kort(ctx({}, { refresh_token: 'r', adresse: 'ella@gmail.example' })), forbundetUdenAdresse: await med.kort(ctx({}, { refresh_token: 'r' })),
      helbredUden: await uden.helbred(ctx()), helbredTom: await med.helbred(ctx()),
      tekster: { adgang: GMAIL_FEJLTEKST.adgang, tom: GMAIL_FEJLTEKST.tom },
      klassifikation: [klassificerGmail(new Error('x')), klassificerGmail({ authenticationFailed: true })],
      fejl: await alle([
        ['start-uden-klient', () => uden.oauth!.start('s', 'https://k.example.test/t', ctx())],
        ['start-uden-adresse', () => med.oauth!.start('s', 'ikke-en-adresse', ctx())],
        ['tilbage-ukendt', () => med.oauth!.tilbage('c', ctx(), 'ukendt-state')],
        ['read-uden-adgang', () => med.read(ctx())],
      ]),
    };
  },
  'kort-mail-imap': async () => {
    const k = mailImapKilde();
    const base = { tjeneste: 'proton-bridge', adresse: 'ella@proton.example' };
    const kode = { adgangskode: 'k' };
    return {
      navn: k.navn,
      tomt: await k.kort(ctx()), valgt: await k.kort(ctx(base)),
      pin: await k.kort(ctx({ ...base, fingeraftryk: 'AB'.repeat(32) })),
      helbredUdenOpsaetning: await k.helbred(ctx()), helbredKode: await k.helbred(ctx(base)),
      presets: TJENESTER.map((t) => PRESETS[t].navn),
      fejltekst: { ...FEJLTEKST },
      klassifikation: [klassificer(new Error('x'), { loopback: false }), klassificer({ code: 'ECONNREFUSED' }, { loopback: true }), klassificer({ authenticationFailed: true }, { loopback: false })],
      fejl: await alle([
        ['tjeneste', () => forbindelse({})],
        ['adresse', () => forbindelse({ tjeneste: 'fastmail' })],
        ['server', () => forbindelse({ tjeneste: 'anden', adresse: 'a@b.example' })],
        ['server-ugyldig', () => forbindelse({ tjeneste: 'anden', adresse: 'a@b.example', server: 'x y' })],
        ['port', () => forbindelse({ tjeneste: 'fastmail', adresse: 'a@b.example', port: '99999' })],
        ['opsaet-uden-kode', () => k.opsaet!(ctx(base))],
        ['opsaet-fingeraftryk', () => k.opsaet!(ctx({ ...base, fingeraftryk: 'xx' }, kode))],
        ['act-uden-args', () => k.act!('flyt', 5, ctx(base, kode))],
        ['act-ukendt-oplysning', () => k.act!('flyt', { id: '1', til: 'A', x: 1 }, ctx(base, kode))],
        ['act-mangler', () => k.act!('flyt', { id: '1' }, ctx(base, kode))],
        ['act-uid', () => k.act!('flyt', { id: 'x', til: 'A' }, ctx(base, kode))],
        ['act-mappe', () => k.act!('flyt', { id: '1', til: '' }, ctx(base, kode))],
        ['act-kladde', () => k.act!('kladde', { id: '1', tekst: '' }, ctx(base, kode))],
        ['act-ukendt-navn', () => k.act!('flyv', {}, ctx(base, kode))],
        ['act-uden-kode', () => k.act!('flyt', { id: '1', til: 'A' }, ctx(base))],
      ]),
      verber: Object.fromEntries(Object.entries(k.verber ?? {}).map(([n, s]) => [n, s.tekst])),
    };
  },
  'kort-nyheder-rss': async () => medMappe(async (dir) => {
    const FEED = '<?xml version="1.0"?><rss version="2.0"><channel><title>Daily Wire</title><item><title>One</title><link>https://wire.example/1</link></item></channel></rss>';
    const HTML = '<html><head><title>x</title></head><body>no feed</body></html>';
    const tabel: Record<string, string> = { 'https://wire.example/feed': FEED, 'https://other.example/': HTML };
    const hent = async (adresse: string) => {
      const t = tabel[adresse];
      if (t === undefined) throw new HentFejl('net', 'stub: no such feed');
      return { status: 'ny' as const, tekst: t, endeligAdresse: adresse };
    };
    const k = nyhederRss({ dataDir: dir, hent });
    const feeds = (...navne: string[]) => JSON.stringify(navne.map((n) => ({ url: `https://${n}.example/feed`, navn: n.toUpperCase(), tilfoejet: NU.toISOString() })));
    const c = (valg: Record<string, string>) => ctx(valg);
    const z = nyhederRss({ dataDir: dir, hent });
    await z.read(c({ feeds: feeds('wire', 'y') }));
    return {
      navn: k.navn,
      tomt: await k.kort(c({})), en: await k.kort(c({ feeds: feeds('a') })), flere: await k.kort(c({ feeds: feeds('a', 'b', 'c', 'd', 'e') })),
      helbredTom: await k.helbred(c({})),
      fejl: await alle([
        ['opsaet-tom', () => k.opsaet!(c({ adresser: '' }))],
        ['opsaet-adresse', () => k.opsaet!(c({ adresser: 'ftp://x.example/feed' }))],
        ['opsaet-intern', () => k.opsaet!(c({ adresser: 'http://169.254.169.254/' }))],
        ['opsaet-html', () => k.opsaet!(c({ adresser: 'https://other.example/' }))],
        ['opsaet-nede', () => k.opsaet!(c({ adresser: 'https://nede.example/feed' }))],
        ['opsaet-for-mange', () => k.opsaet!(c({ adresser: Array.from({ length: 21 }, (_, i) => `https://f${i}.example/feed`).join('\n') }))],
        ['opsaet-opml', () => k.opsaet!(c({ opml: 'ikke opml' }))],
        ['opsaet-ok', () => k.opsaet!(c({ adresser: 'https://wire.example/feed' }))],
        ['tilfoej-tom', () => k.tilfoejFeed('', c({}))],
        ['tilfoej-flere', () => k.tilfoejFeed('https://a.example/f https://b.example/f', c({}))],
        ['tilfoej-dublet', () => k.tilfoejFeed('https://wire.example/feed', c({ feeds: JSON.stringify([{ url: 'https://wire.example/feed', navn: 'Wire', tilfoejet: NU.toISOString() }]) }))],
        ['tilfoej-ok', () => k.tilfoejFeed('https://wire.example/feed', c({}))],
        ['fjern-ukendt', () => k.fjernFeed('f-000000000000', c({ feeds: feeds('a', 'b') }))],
        ['fjern-sidste', () => k.fjernFeed(k.feeds({ feeds: feeds('a') })[0]!.id, c({ feeds: feeds('a') }))],
        ['fjern-ok', () => k.fjernFeed(k.feeds({ feeds: feeds('a', 'b') })[0]!.id, c({ feeds: feeds('a', 'b') }))],
        ['read-ingen-svarer', () => k.read(c({ feeds: feeds('x', 'y') }))],
      ]),
      helbredNede: await k.helbred(c({ feeds: feeds('x', 'y') })),
      helbredEnNede: await z.helbred(c({ feeds: feeds('wire', 'y') })),
      adresse: await alle([
        ['intern', () => tjekAdresse('http://localhost/', { oprindelse: 'ekstern' })], ['lokal', () => tjekAdresse('http://192.168.1.5/', { oprindelse: 'ekstern' })],
        ['metadata', () => tjekAdresse('http://169.254.169.254/', { oprindelse: 'bruger' })],
        ['tom', () => tjekAdresse('', { oprindelse: 'bruger' })], ['skema', () => tjekAdresse('ftp://x.example', { oprindelse: 'bruger' })],
        ['bruger', () => tjekAdresse('https://u:p@x.example', { oprindelse: 'bruger' })], ['vaert', () => tjekAdresse('https://', { oprindelse: 'bruger' })],
      ]),
      parse: await alle([
        ['tomt', () => parseFeed('', { adresse: 'https://x.example' })], ['entitet', () => parseFeed('<!ENTITY x "y"><rss/>', { adresse: 'https://x.example' })],
        ['xml', () => parseFeed('<<<', { adresse: 'https://x.example' })], ['ikke-feed', () => parseFeed('<html/>', { adresse: 'https://x.example' })],
        ['opml', () => parseOpml('<opml/>')],
      ]),
    };
  }),
  'kort-noter': async () => medMappe(async (hjem) => {
    const k = noterKilde({ hjem, platform: 'linux' });
    const vault = path.join(hjem, 'min-vault');
    await mkdir(vault, { recursive: true });
    const vv = path.join(hjem, 'fyldt');
    await mkdir(vv);
    await writeFile(path.join(vv, 'x.md'), 'x');
    await writeFile(path.join(hjem, 'en-fil'), 'x');
    const borte = path.join(hjem, 'missing');
    return {
      navn: k.navn, kira: await kiraNoter({ rod: path.join(hjem, 'v'), personer: path.join(hjem, 'v', 'p') }).kort(ctx()),
      ikkeValgt: (await k.kort(ctx())).tekst,
      felter: (await k.kort(ctx())).felter.map((f) => [f.etiket, f.muligheder?.map((m) => m.etiket)]),
      mangler: (await k.kort(ctx({ mappe: borte }))).tekst,
      ny: (await k.kort(ctx({ mappe: vault, opsaetning: 'ny' }))).tekst, eksisterende: (await k.kort(ctx({ mappe: vault, opsaetning: 'eksisterende' }))).tekst,
      kortHandlinger: [(await k.kort(ctx())).handling, (await k.kort(ctx({ mappe: borte }))).handling, (await k.kort(ctx({ mappe: vault }))).handling],
      helbredManglende: await k.helbred(ctx({ mappe: borte })),
      fejl: await alle([
        ['opsaet-vault', () => k.opsaet!(ctx({ opsaetning: 'eksisterende' }))],
        ['opsaet-sti', () => k.opsaet!(ctx({ opsaetning: 'eksisterende', mappe: 'relativ/sti' }))],
        ['read-mangler', () => k.read(ctx({ mappe: borte }))],
        ['opsaet-ny', async () => (await k.opsaet!(ctx({ opsaetning: 'ny', mappe: path.join(hjem, 'frisk') })))],
        ['opsaet-ny-igen', async () => (await k.opsaet!(ctx({ opsaetning: 'ny', mappe: path.join(hjem, 'frisk') })))],
        ['opsaet-adopter', async () => (await k.opsaet!(ctx({ opsaetning: 'eksisterende', mappe: vault })))],
        ['vault-fil', () => lavNyVault(path.join(hjem, 'en-fil'))],
        ['vault-ikke-tom', () => lavNyVault(vv)],
        ['vault-findes-ikke', () => adopterVault(borte)],
        ['sti-ugyldig', () => iRod(vault, '')], ['sti-absolut', () => iRod(vault, '/etc/x')], ['sti-op', () => iRod(vault, '../x')],
        ['sti-rod', () => iRod(borte, 'x.md')],
        ['navn', () => filnavn('.skjult')],
      ]),
    };
  }),
  'kort-beskeder': async () => medMappe(async (dir) => {
    await mkdir(path.join(dir, 'beskeder'), { recursive: true });
    const linje = (o: Record<string, unknown>): string => `${JSON.stringify({ kanal: 'signal', samtale: '+4500000001', gruppe: false, afsender: '+4500000001', tid: '2026-11-02T06:00:00.000Z', tekst: 'Hi', ...o })}\n`;
    const k = beskederKilde({ dataDir: dir });
    const uden = await k.kort(ctx());
    const helbredUden = await k.helbred(ctx());
    const fejlUden = await alle([['read', () => k.read(ctx())], ['opsaet', () => k.opsaet!(ctx())], ['vaelg', () => k.vaelgSamtaler([], ctx())]]);
    await writeFile(path.join(dir, 'beskeder', LOG_FIL), '');
    const tom = await k.kort(ctx());
    const n1 = samtaleNoegle('signal', '+4500000001');
    const n2 = samtaleNoegle('telegram', '-1');
    await writeFile(path.join(dir, 'beskeder', LOG_FIL), linje({}) + linje({ kanal: 'telegram', samtale: '-1', gruppe: true, afsender: '9', samtaleNavn: 'Crew' }));
    const med = await k.kort(ctx());
    const valgt = await k.kort(ctx({ [n1]: 'privat', [n2]: 'husstand' }));
    const opsaet = await k.opsaet!(ctx({ [n1]: 'privat' }));
    const opsaetIngen = await k.opsaet!(ctx({}));
    const helbredIngen = await k.helbred(ctx({}));
    const helbredValgt = await k.helbred(ctx({ [n1]: 'privat' }));
    const visning = await k.samtalerMedValg({});
    const vaelg = await k.vaelgSamtaler([n1], ctx());
    const ukendt = await fang(() => k.vaelgSamtaler(['s-000000000000'], ctx()));
    await writeFile(path.join(dir, 'beskeder', STATUS_FIL), JSON.stringify({ platforms: ['telegram'], tid: '2026-11-02T05:00:00.000Z' }));
    const mistet = await alle([['read', () => k.read(ctx({ [n1]: 'privat' }))], ['helbred', () => k.helbred(ctx({ [n1]: 'privat' }))]]);
    return { navn: k.navn, uden, helbredUden, fejlUden, tom, med, valgt, opsaet, opsaetIngen, helbredIngen, helbredValgt, visning, vaelg, ukendt, mistet };
  }),
  'kort-aula': async () => {
    const LINK = 'https://www.aula.dk/kalender/ugekalender/TESTVAERDI-0000-1111-2222';
    const mkHent = (svar: unknown) => async () => {
      if (svar instanceof HentFejl) throw svar;
      return { status: 'ny' as const, tekst: svar as string, endeligAdresse: LINK };
    };
    const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:School\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Gym\r\nDTSTART:20261103T080000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const med = (svar: unknown) => aulaKalender({ hent: mkHent(svar), ur: () => 0 });
    const k = med(ICS);
    return {
      navn: k.navn, uden: await k.kort(ctx({}, null)), med: await k.kort(ctx({}, { link: LINK })),
      helbredUden: await k.helbred(ctx({}, null)),
      helbredOk: await k.helbred(ctx({}, { link: LINK })),
      helbredTilbagekaldt: await med(new HentFejl('status', 'x', 404)).helbred(ctx({}, { link: LINK })),
      helbredNede: await med(new HentFejl('net', 'x')).helbred(ctx({}, { link: LINK })),
      helbredLangsom: await (() => { let t = 0; return aulaKalender({ hent: async () => { t += 9000; return { status: 'ny' as const, tekst: ICS, endeligAdresse: LINK }; }, ur: () => t, langsomMs: 5000 }).helbred(ctx({}, { link: LINK })); })(),
      helbredIkkeKalender: await med('<html>').helbred(ctx({}, { link: LINK })),
      fejl: await alle([
        ['opsaet-tom', () => k.opsaet!(ctx({}, { link: '' }))],
        ['opsaet-ligner-ikke', () => k.opsaet!(ctx({}, { link: 'https://' }))],
        ['opsaet-http', () => k.opsaet!(ctx({}, { link: 'http://www.aula.dk/x' }))],
        ['opsaet-vaert', () => k.opsaet!(ctx({}, { link: 'https://www.example.com/x' }))],
        ['opsaet-ok', () => k.opsaet!(ctx({}, { link: LINK }))],
        ['opsaet-ikke-kalender', () => med('<html>').opsaet!(ctx({}, { link: LINK }))],
        ['opsaet-afvist', () => med(new HentFejl('status', 'x', 403)).opsaet!(ctx({}, { link: LINK }))],
        ['opsaet-nede', () => med(new HentFejl('tid', 'x')).opsaet!(ctx({}, { link: LINK }))],
        ['read-uden-link', () => k.read(ctx({}, null))],
        ['read-ikke-kalender', () => med('<html>').read(ctx({}, { link: LINK }))],
        ['read-tilbagekaldt', () => med(new HentFejl('status', 'x', 410)).read(ctx({}, { link: LINK }))],
        ['read-tid', () => med(new HentFejl('tid', 'x')).read(ctx({}, { link: LINK }))],
        ['read-stor', () => med(new HentFejl('stor', 'x')).read(ctx({}, { link: LINK }))],
        ['read-nede', () => med(new HentFejl('net', 'x')).read(ctx({}, { link: LINK }))],
      ]),
    };
  },

  // --- more of the words, driven directly ---
  'pause-forslag': async () => {
    const saet = parseRegler('naeste-id: R-0002\n\n## R-0001 · Newsletters sorted\n- trin: 1\n- gaelder: mail / indbakke\n- oprindelse: haand 2026-11-01\n- status: aktiv\n');
    const f = pauseForslag(saet.regler[0]!, { kort: { id: 'k_1', titel: 'Receipt', zone: 'privat', ejer: 'ella' } as never, nu: NU });
    return { titel: f.titel, tekst: f.tekst };
  },
  'noter-personer': async () => medMappe(async (dir) => {
    const mappe = path.join(dir, 'People');
    await mkdir(mappe, { recursive: true });
    const ok = { navn: 'Alma', relation: 'family', zone: 'privat' as const };
    return alle([
      ['zone', () => skrivPerson(mappe, { ...ok, zone: 'x' as never }, { mappe: 'familie', zone: 'privat' })],
      ['felt', () => skrivPerson(mappe, { ...ok, org: 'a\u0001b' }, { mappe: 'familie', zone: 'privat' })],
      ['foedselsdag', () => skrivPerson(mappe, { ...ok, foedselsdag: 'x'.repeat(100) }, { mappe: 'familie', zone: 'privat' })],
      ['relation', () => skrivPerson(mappe, { ...ok, relation: ' ' }, { mappe: 'familie', zone: 'privat' })],
      ['tekst', () => skrivPerson(mappe, { ...ok, tekst: 'a\u0000b' }, { mappe: 'familie', zone: 'privat' })],
      ['navn', () => skrivPerson(mappe, { ...ok, navn: '.skjult' }, { mappe: 'familie', zone: 'privat' })],
      ['opdater-findes-ikke', () => opdaterPerson(mappe, { navn: 'Ingen', diff: [{ felt: 'relation', nu: 'a', ny: 'b' }] })],
      ['opdater-ugyldig', () => opdaterPerson(mappe, { navn: 'Alma', diff: [{ felt: 'relation', nu: 'a', ny: '' }] })],
      ['opdater-foedselsdag', () => opdaterPerson(mappe, { navn: 'Alma', diff: [{ felt: 'foedselsdag', nu: 'a', ny: 'x'.repeat(100) }] })],
      ['profil-ugyldig', () => skrivProfil(dir, ' ')],
      ['profil-fjern', () => fjernProfil(dir, { sti: 'x.md', sha256: 'a' })],
    ]);
  }),
  'besked-data': async () => {
    const raa = (o: object) => ({ kanal: 'signal' as const, samtale: '+4500000009', gruppe: false, afsender: '+4500000009', tid: '2026-11-02T06:00:00.000Z', tekst: `Call +45 12 34 56 78 or @someone or ${['abc', 's.whatsapp.net'].join('@')} please` /* joined at run time: the mirror guard reads a literal as an address */, ...o });
    const b = tilBesked(raa({ vedhaeftning: [{ navn: 'plan +45 12 34 56 78.pdf', type: 'pdf' }] }) as never, { kontakter: [], zone: 'privat' });
    const l = parseLinjer(`${JSON.stringify({ kanal: 'signal', samtale: '9', gruppe: false, afsender: '9', tid: '2026-11-02T06:00:00.000Z', tekst: 'x', vedhaeftning: [{}] })}\n`).poster;
    return { sender: b.afsender, tekst: b.tekst, samtale: b.samtaleNavn, standardnavne: samtaler([raa({}), raa({ kanal: 'telegram', samtale: '-1', gruppe: true })] as never).map((x) => x.navn), vedhaeftning: l[0]?.vedhaeftning };
  },
  'google-kalender-laes': async () => {
    const ENV = { KC_GOOGLE_CLIENT_ID: 'k', KC_GOOGLE_CLIENT_SECRET: 's' };
    const hent = (liste: number, hændelser: number): Hent => (async (url: unknown) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 });
      if (u.includes('/calendarList')) return new Response(JSON.stringify({ items: liste === 200 ? [{ id: 'a@example.test', summary: 'Mine' }] : [] }), { status: liste });
      return new Response('{}', { status: hændelser });
    }) as Hent;
    const les = (h: Hent) => googleKalender({ env: ENV, hent: h }).read(ctx({}, { refresh_token: 'r' }));
    return alle([
      ['liste-fejl', () => les(hent(500, 200))],
      ['kalender-fejl', async () => { const l = await les(hent(200, 500)); return l.slags === 'kalender' ? l.data.errors : null; }],
      ['kalender-net', async () => {
        const h = (async (url: unknown) => {
          const u = String(url);
          if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 });
          if (u.includes('/calendarList')) return new Response(JSON.stringify({ items: [{ id: 'a@example.test', summary: 'Mine' }] }), { status: 200 });
          throw new Error('net');
        }) as Hent;
        const l = await les(h);
        return l.slags === 'kalender' ? l.data.errors : null;
      }],
      ['netvaerk', () => les((async (url: unknown) => { if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 }); throw new Error('net'); }) as Hent)],
    ]);
  },

  // --- the limits ---
  'afgoer': async () => {
    const regler = { tilstand: 'mangler' as const };
    const ud: Record<string, unknown> = { ikkeEndnu: ['sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd', 'x'].map(ikkeEndnu), aldrig: ['betal', 'kopier-paa-tvaers', 'flyv', 'laes', 'slet'].map(aldrigTilladt) };
    for (const verb of ['laes', 'sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd', 'send-til-andre', 'slet', 'betal', 'kopier-paa-tvaers', 'flyv']) {
      for (const kanal of ['knap', 'stemme', 'chat', 'baggrund'] as const) {
        for (const ja of [false, true]) ud[`${verb}/${kanal}/${ja ? 'ja' : 'nej'}`] = afgoer({ rum: 'r', id: 'i', verb, zoner: ['privat'], gaelder: { kilde: 'mail' } }, { person: EJER, kanal, ja, regler });
      }
    }
    ud['gaest'] = afgoer({ rum: 'r', id: 'i', verb: 'sorter', zoner: ['privat'] }, { person: GAEST, kanal: 'knap', ja: false });
    ud['blandet'] = afgoer({ rum: 'r', id: 'i', verb: 'laes', zoner: ['privat', 'arbejde'] }, { person: EJER, kanal: 'knap', ja: false });
    for (const kanal of ['knap', 'stemme', 'baggrund'] as const) for (const ja of [false, true]) ud[`tap/${kanal}/${ja}`] = afgoer({ rum: 'r', id: 'i', verb: 'laes', zoner: ['privat'], tap: true }, { person: EJER, kanal, ja, regler });
    const lavt = parseRegler('naeste-id: R-0002\n\n## R-0001 · Lav\n- trin: 1\n- gaelder: mail\n- oprindelse: haand 2026-11-01\n- status: aktiv\n');
    ud['for-lavt-trin'] = afgoer({ rum: 'r', id: 'i', verb: 'forbered', zoner: ['privat'], gaelder: { kilde: 'mail' } }, { person: EJER, kanal: 'baggrund', ja: false, regler: { tilstand: 'ok', saet: lavt, aendretUdenfor: false } });
    return ud;
  },
  'opsyn': async () => ({
    vaerktoej: vaerktoejTilladt('laes', 'cronjob_manage', ''), send: vaerktoejTilladt('laes', 'terminal', 'himalaya message send'), slet: vaerktoejTilladt('laes', 'terminal', 'himalaya message delete 1'),
    ok: vaerktoejTilladt('laes', 'read_file', ''),
  }),
  'nodstop': async () => {
    const skrevet: unknown[] = [];
    const revision = { skriv: async (e: unknown) => { skrevet.push(e); return undefined; } } as never;
    const runs = (n: number) => ({ stopAlle: async () => n, genoptag: async () => undefined, paaPause: () => true });
    const ud = await alle([
      ['stop-gaest', () => stopAlt({ runs: runs(2), revision, person: GAEST, kanal: 'knap' })],
      ['start-medlem', () => startIgen({ runs: runs(2), revision, person: { ...EJER, rolle: 'medlem' }, kanal: 'knap' })],
      ['stop-2', () => stopAlt({ runs: runs(2), revision, person: EJER, kanal: 'knap' })],
      ['stop-1', () => stopAlt({ runs: runs(1), revision, person: EJER, kanal: 'knap' })],
      ['stop-0', () => stopAlt({ runs: runs(0), revision, person: EJER, kanal: 'knap' })],
      ['start', () => startIgen({ runs: runs(2), revision, person: EJER, kanal: 'knap' })],
    ]);
    return { ...ud, revision: skrevet.map((e) => (e as { hvorfor: string }).hvorfor), pauseFejl: new PauseFejl().message, nodstop: new NodstopNaegtet('x').message };
  },

  // --- the trust pages ---
  'viden': async () => {
    const REGLER = 'naeste-id: R-0004\n\n## R-0001 · Mail sorteres i mapper\n- trin: 1\n- gaelder: mail / indbakke\n- oprindelse: import 2026-10-31\n- status: aktiv\n\n## R-0002 · Regnskab\n- trin: 2\n- gaelder: mail / regning\n- oprindelse: ret 2026-11-01 (kort k_1)\n- status: pause\n\n## R-0003 · Alt\n- trin: 3\n- gaelder: *\n- oprindelse: haand 2026-11-01\n- status: aktiv\n\n## R-9 · Daarlig\n- trin: 9\n';
    const uger = raekke([{ dato: '2026-10-26', kraevede: 6, fortryd: 1 }, { dato: '2026-10-19', kraevede: 9, fortryd: 0 }] as Dagstal[], '2026-10-26', 4);
    const tomt: Viden = { kilder: [], regler: null, personer: null, gemt: { rum: [], clawco: [], andre: 0, noegler: 0, bytes: 0 } };
    const fuld = (o: Partial<Viden> = {}): Viden => ({
      kilder: [
        { id: 'falsk-kalender', navn: 'Calendar', slags: 'kalender', zone: 'privat', forbundet: true },
        { id: 'mail-imap', navn: 'Mail', slags: 'mail', zone: 'arbejde', forbundet: true },
        { id: 'noter', navn: 'Notes', slags: 'noter', forbundet: false },
      ],
      regler: { fil: '/v/Clawco/regler.md', laest: { tilstand: 'ok', saet: parseRegler(REGLER), aendretUdenfor: true } },
      personer: { dir: '/v/40-People', liste: [{ navn: 'Alma', relation: 'family', sti: 'familie/alma.md' }] },
      gemt: { rum: [{ id: 'mail', log: 12, chat: 1, bytes: 2048, filer: [] }, { id: 'univers-trip', log: 1, chat: 2, bytes: 100, filer: [] }, { id: 'nav', log: 0, chat: 0, bytes: 10, filer: [] }, { id: 'husstand', log: 3, chat: 0, bytes: 500, filer: [] }], clawco: ['vault/Clawco/regler.md'], andre: 4, noegler: 2, bytes: 4096 },
      ugetal: uger,
      ...o,
    });
    const ok = fuld().regler!;
    return {
      fuld: String(renderViden(fuld())), slettet: String(renderViden(fuld({ slettet: true }))), tomt: String(renderViden(tomt)),
      mangler: String(renderViden(fuld({ regler: { ...ok, laest: { tilstand: 'mangler' } }, personer: { dir: '/v', liste: [] }, ugetal: [] }))),
      ulaeselig: String(renderViden(fuld({ regler: { ...ok, laest: { tilstand: 'ulaeselig', hvorfor: 'file unreadable', aendretUdenfor: false } } }))),
      sletAlt: String(renderSletAlt(fuld())), sletAltFejl: String(renderSletAlt(fuld(), { fejl: 'Try again' })), sletAltTom: String(renderSletAlt(tomt)),
    };
  },
  'dagstal': async () => {
    const dag = (dato: string, k: number, f: number): Dagstal => ({ dato, kraevede: k, fortryd: f });
    const l = (dage: Dagstal[], mandag: string, sidsteEr: 'denne' | 'sidste', hjaelp = false) => { const v = ugeVisning(raekke(dage, mandag, 4), sidsteEr); return v ? String(ugeLinje(v, { hjaelp })) : null; };
    const to = [dag('2026-10-19', 9, 1), dag('2026-10-26', 6, 1)];
    return {
      to: l(to, '2026-10-26', 'denne', true), faldt: l([dag('2026-10-19', 9, 2), dag('2026-10-26', 6, 1)], '2026-10-26', 'denne'), steg: l([dag('2026-10-19', 5, 0), dag('2026-10-26', 6, 3)], '2026-10-26', 'denne'),
      foerste: l([dag('2026-10-26', 6, 0)], '2026-10-26', 'denne'), sidste: l(to, '2026-11-02', 'sidste'), hul: l([dag('2026-10-05', 9, 1), dag('2026-10-26', 6, 1)], '2026-10-26', 'denne'),
      gammel: l([dag('2026-10-05', 9, 1), dag('2026-10-12', 6, 1)], '2026-10-26', 'denne'),
      tekst: ugeTekst(raekke(to, '2026-10-26', 4)), soejler: String(ugeSoejler(raekke(to, '2026-10-26', 4))),
    };
  },
  'regler': async () => {
    const saet = parseRegler('naeste-id: R-0002\n\n## R-0001 · A\n- trin: 1\n- gaelder: mail\n- oprindelse: haand 2026-11-01\n- status: aktiv\n');
    return { fil: serialiserRegler(saet) };
  },
  'slet-alt': async () => medMappe(async (dir) => {
    await mkdir(path.join(dir, 'data'), { recursive: true });
    await writeFile(path.join(dir, 'data', 'x.json'), '{}');
    const skrevet: unknown[] = [];
    const revision = { skriv: async (e: unknown) => { skrevet.push(e); return undefined; } };
    const r = await fang(() => sletAlt({ dataDir: path.join(dir, 'data') } as never, { person: 'ella', kanal: 'knap', revision }));
    return { r, revision: skrevet.map((e) => (e as { hvorfor: string }).hvorfor), roden: await fang(() => sletAlt({ dataDir: '' } as never, { person: 'ella', kanal: 'knap' })) };
  }),
};
