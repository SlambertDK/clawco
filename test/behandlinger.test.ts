import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { laesDokumenter, parseDokument, tjekUdgivelse } from '../scripts/juridisk.ts';
import {
  laesBehandlinger, renderFortegnelse, renderUnderdatabehandlere, skrivFiler, tjekBehandlinger, tjekFiler, valider,
  type Behandlinger,
} from '../scripts/behandlinger.ts';

// KC-0205: one data file (docs/legal/behandlinger.json) is the source of the public subprocessor page (da/en) and of
// the internal record of processing activities (GDPR art. 30). Invariants: the generated files equal what the data
// says (nobody edits them by hand); a provider outside the EU/EEA has a stated basis (spec D13); every outbound host
// in sky/src belongs to a listed provider, so a new third party cannot be added without a visible change to the file.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const DOCS = path.join(ROD, 'docs/legal');
const DATA = path.join(DOCS, 'behandlinger.json');
const les = (f: string): string => readFileSync(path.join(DOCS, f), 'utf8');
const rigtige = (): Behandlinger => laesBehandlinger(DATA);
/** A deep copy of the real data to bend in a test. */
const kopi = (): any => JSON.parse(readFileSync(DATA, 'utf8'));
const meta = (d: Behandlinger, sprog: 'da' | 'en') => ({ version: d.udgave.version, dato: d.dato, status: d.udgave.status, sprog });

// --- the file and its schema ---------------------------------------------------------------------------------

test('the real file validates, has the rule in its header, and breaks no invariant', () => {
  const d = rigtige();
  assert.deepEqual(tjekBehandlinger(d), []);
  assert.match(d.regel, /outbound call to a third party/);
  assert.match(d.regel, /test\/behandlinger\.test\.ts/);
  assert.match(d.regel, /node scripts\/behandlinger\.ts --skriv/);
  assert.equal(d.tjekketDPF, '2026-11-02');
  assert.deepEqual(d.behandlinger.map((b) => b.id), [
    'konto-login', 'betaling', 'instans', 'transaktionsmail', 'fejlrapporter', 'sikkerhedskopier', 'support-indblik', 'statusfeed',
  ]);
  assert.deepEqual(d.underdatabehandlere.map((u) => u.id), ['cloudflare', 'stripe', 'resend', 'aws']); // KC-0266: AWS runs the included model
});

test('valider: a missing or empty field is refused with its path', () => {
  const a = kopi(); delete a.behandlinger[0].formaal.en;
  assert.throws(() => valider(a), /behandlinger\[0\]\.formaal\.en/);
  const b = kopi(); b.behandlinger[2].sikkerhed.da = '  ';
  assert.throws(() => valider(b), /behandlinger\[2\]\.sikkerhed\.da/);
  const c = kopi(); c.underdatabehandlere[1].eu = 'ja';
  assert.throws(() => valider(c), /underdatabehandlere\[1\]\.eu/);
  const d = kopi(); d.behandlinger[1].modtagere = 'stripe';
  assert.throws(() => valider(d), /behandlinger\[1\]\.modtagere/);
  const e = kopi(); e.dato = '2. november';
  assert.throws(() => valider(e), /dato/);
  const f = kopi(); delete f.ansvarlig.kontakt;
  assert.throws(() => valider(f), /ansvarlig\.kontakt/);
  const g = kopi(); g.behandlinger[0].overfoersel = { tredjeland: true };
  assert.throws(() => valider(g), /behandlinger\[0\]\.overfoersel\.grundlag/);
  assert.throws(() => valider([]), /top level|object/);
});

test('every entry has both languages, a role, and ids are unique', () => {
  const d = rigtige();
  for (const b of d.behandlinger) {
    for (const f of ['formaal', 'kategorier', 'registrerede', 'retsgrundlag', 'opbevaring', 'sikkerhed'] as const) {
      assert.ok(b[f].da.trim() && b[f].en.trim(), `${b.id}.${f}`);
    }
    assert.ok(b.rolle === 'dataansvarlig' || b.rolle === 'databehandler', `${b.id}.rolle`);
  }
  const dup = kopi(); dup.behandlinger[1].id = 'konto-login';
  assert.match(tjekBehandlinger(valider(dup)).join('\n'), /konto-login.*(twice|more than once|duplicate)/i);
  const dup2 = kopi(); dup2.underdatabehandlere[1].id = 'cloudflare';
  assert.match(tjekBehandlinger(valider(dup2)).join('\n'), /cloudflare.*(twice|more than once|duplicate)/i);
});

test('the record says plainly what is not in use and what holds no personal data', () => {
  const d = rigtige();
  const get = (id: string) => d.behandlinger.find((b) => b.id === id)!;
  assert.match(get('statusfeed').kategorier.da, /^Ingen/);
  assert.match(get('statusfeed').kategorier.en, /^None/);
  assert.deepEqual(get('statusfeed').modtagere, []);
  assert.match(get('fejlrapporter').formaal.da, /ikke i brug/i);
  assert.match(get('fejlrapporter').formaal.en, /not in use/i);
  assert.deepEqual(get('fejlrapporter').modtagere, []);
  assert.match(get('sikkerhedskopier').formaal.da, /ikke slået til/i);
  assert.match(get('betaling').kategorier.da, /aldrig kortnumre|ingen kortnumre/i);
});

// --- the invariants -------------------------------------------------------------------------------------------

test('a recipient that is not a listed provider is refused', () => {
  const d = kopi(); d.behandlinger[0].modtagere = ['cloudflare', 'ukendt'];
  assert.match(tjekBehandlinger(valider(d)).join('\n'), /behandlinger\[0\].*ukendt/);
});

test('D13: a provider outside the EU/EEA needs a stated basis in both languages; a US provider without one fails', () => {
  const d = kopi();
  d.underdatabehandlere.push({
    id: 'usa-leverandoer', navn: 'US Provider, Inc.', hvad: { da: 'x', en: 'x' }, hvor: { da: 'USA', en: 'USA' }, land: 'USA', eu: false,
    grundlag: { da: '', en: '' }, dpa: 'https://usa.example/dpa', ibrugtagning: null, kunHvisValgt: false, vaerter: ['api.usa.example'],
  });
  d.behandlinger[0].modtagere.push('usa-leverandoer');
  const fejl = tjekBehandlinger(valider(d)).join('\n');
  assert.match(fejl, /usa-leverandoer.*grundlag|usa-leverandoer.*basis/i);
  d.underdatabehandlere.find((u: { id: string }) => u.id === 'usa-leverandoer')!.grundlag = { da: 'EU\'s standardkontrakter', en: 'EU Standard Contractual Clauses' };
  assert.deepEqual(tjekBehandlinger(valider(d)), []);
  d.underdatabehandlere.find((u: { id: string }) => u.id === 'usa-leverandoer')!.grundlag = { da: 'EU\'s standardkontrakter', en: '' };
  assert.match(tjekBehandlinger(valider(d)).join('\n'), /usa-leverandoer/);
});

test('D13: an activity that sends to a non-EU provider says so, and a transfer needs a non-empty basis', () => {
  const a = kopi(); a.behandlinger[0].overfoersel = { tredjeland: false };
  assert.match(tjekBehandlinger(valider(a)).join('\n'), /konto-login.*(third country|tredjeland)/i);
  const b = kopi(); b.behandlinger[0].overfoersel = { tredjeland: true, grundlag: { da: 'ok', en: ' ' } };
  assert.match(tjekBehandlinger(valider(b)).join('\n'), /konto-login.*grundlag|konto-login.*basis/i);
});

test('every listed provider is a recipient of some activity, and its hosts are well formed', () => {
  const a = kopi(); for (const b of a.behandlinger) b.modtagere = b.modtagere.filter((m: string) => m !== 'stripe');
  assert.match(tjekBehandlinger(valider(a)).join('\n'), /stripe.*(no activity|ingen behandling|not a recipient)/i);
  const b = kopi(); b.underdatabehandlere[0].vaerter = ['https://api.x.com/path'];
  assert.match(tjekBehandlinger(valider(b)).join('\n'), /cloudflare.*vaerter|cloudflare.*host/i);
  const c = kopi(); c.underdatabehandlere[0].vaerter = [];
  assert.match(tjekBehandlinger(valider(c)).join('\n'), /cloudflare.*vaerter|cloudflare.*host/i);
});

test('the change log ends on the date of the list, and an unknown {placeholder} in a text is refused', () => {
  const a = kopi(); a.dato = '2026-12-01';
  assert.match(tjekBehandlinger(valider(a)).join('\n'), /aendringslog/);
  const b = kopi(); b.underdatabehandlere[0].hvad.da += ' {noget}';
  assert.match(tjekBehandlinger(valider(b)).join('\n'), /\{noget\}/);
  const c = kopi(); c.underdatabehandlere[0].hvad.da += ' a | b';
  assert.match(tjekBehandlinger(valider(c)).join('\n'), /cloudflare.*(\||pipe|table)/i);
});

// --- the generated files ----------------------------------------------------------------------------------------

test('generated files are current: the two public texts and the internal record equal the data byte for byte', () => {
  const d = rigtige();
  assert.equal(les('underdatabehandlere.da.md'), renderUnderdatabehandlere(d, 'da', meta(d, 'da')), 'run: node scripts/behandlinger.ts --skriv');
  assert.equal(les('underdatabehandlere.en.md'), renderUnderdatabehandlere(d, 'en', meta(d, 'en')), 'run: node scripts/behandlinger.ts --skriv');
  assert.equal(les('fortegnelse-art30.md'), renderFortegnelse(d), 'run: node scripts/behandlinger.ts --skriv');
  assert.deepEqual(tjekFiler(ROD), []);
});

test('a hand edit of a generated file is caught by tjekFiler, and skrivFiler repairs it', () => {
  const rod = mkdtempSync(path.join(tmpdir(), 'clawco-beh-'));
  try {
    mkdirSync(path.join(rod, 'docs/legal'), { recursive: true });
    cpSync(DATA, path.join(rod, 'docs/legal/behandlinger.json'));
    assert.ok(tjekFiler(rod).length >= 3, 'nothing generated yet: all three differ');
    skrivFiler(rod);
    assert.deepEqual(tjekFiler(rod), []);
    const f = path.join(rod, 'docs/legal/underdatabehandlere.da.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('Stripe', 'Strip'));
    assert.match(tjekFiler(rod).join('\n'), /underdatabehandlere\.da\.md/);
    skrivFiler(rod);
    assert.deepEqual(tjekFiler(rod), []);
    assert.equal(readFileSync(f, 'utf8'), les('underdatabehandlere.da.md'));
  } finally { rmSync(rod, { recursive: true, force: true }); }
});

test('the CLI reports the files as current (exit 0) on the real repo', () => {
  const r = spawnSync('node', [path.join(ROD, 'scripts/behandlinger.ts')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the generated public texts are valid published documents: frontmatter, no placeholder, no UDKAST', () => {
  const d = rigtige();
  for (const sprog of ['da', 'en'] as const) {
    const raa = les(`underdatabehandlere.${sprog}.md`);
    const p = parseDokument(raa);
    assert.deepEqual(p.meta, { version: d.udgave.version, dato: d.dato, status: 'udgivet', sprog });
    assert.deepEqual(tjekUdgivelse(p.meta.status, raa), []);
    assert.ok(raa.includes(`Version ${d.udgave.version} · ${d.dato}`));
    assert.ok(!/\[dato\]|\[date\]|\{[a-zA-Z]+\}/.test(raa), 'no placeholder is left');
    for (const u of d.underdatabehandlere) assert.ok(raa.includes(u.navn), `${sprog} names ${u.navn}`);
    assert.ok(raa.endsWith('\n') && !raa.endsWith('\n\n'), 'ends with exactly one newline');
  }
});

test('v1.2 (AWS added, KC-0266) replaces v1.1 and v1.0; the published earlier versions are archived unchanged so the page can show them', () => {
  const alle = laesDokumenter(DOCS);
  for (const sprog of ['da', 'en'] as const) {
    const dok = alle.find((x) => x.id === 'underdatabehandlere' && x.sprog === sprog)!;
    assert.equal(dok.meta.version, '1.3');
    assert.deepEqual(dok.tidligere.map((t) => t.meta.version).sort(), ['1.0', '1.1', '1.2']);
    for (const t of dok.tidligere) assert.equal(t.meta.status, 'udgivet');
    const v10 = dok.tidligere.find((t) => t.meta.version === '1.0')!;
    assert.match(v10.raa, /\[dato\]|\[date\]/, 'the archive keeps the text as it was published');
    const v11 = dok.tidligere.find((t) => t.meta.version === '1.1')!;
    assert.doesNotMatch(v11.raa, /Amazon Web Services/, 'the archived 1.1 is the list before AWS');
  }
});

test('the public list is the one Danish and English page for every listed provider, with the basis from the data', () => {
  const d = rigtige();
  for (const sprog of ['da', 'en'] as const) {
    const raa = les(`underdatabehandlere.${sprog}.md`);
    for (const u of d.underdatabehandlere) {
      const rk = raa.split('\n').find((l) => l.startsWith(`| ${u.navn}`));
      assert.ok(rk, `${sprog}: a row for ${u.navn}`);
      assert.ok(rk.includes(u.hvor[sprog].trim()), `${sprog}: ${u.navn} where`);
    }
  }
  const da = les('underdatabehandlere.da.md');
  assert.ok(da.includes('2. november 2026'));
  assert.ok(les('underdatabehandlere.en.md').includes('2 November 2026'));
});

test('kunHvisValgt: a provider that exists only if the customer chooses it is marked as such on the page', () => {
  const d = kopi();
  d.underdatabehandlere.push({
    id: 'valgfri', navn: 'Valgfri ApS', hvad: { da: 'x', en: 'x' }, hvor: { da: 'Danmark', en: 'Denmark' }, land: 'Danmark', eu: true,
    grundlag: { da: '', en: '' }, dpa: 'https://valgfri.example/dpa', ibrugtagning: null, kunHvisValgt: true, vaerter: ['api.valgfri.example'],
  });
  d.behandlinger[0].modtagere.push('valgfri');
  const v = valider(d);
  assert.deepEqual(tjekBehandlinger(v), []);
  assert.match(renderUnderdatabehandlere(v, 'da', meta(v, 'da')), /\| Valgfri ApS \(kun hvis du vælger det\) \|/);
  assert.match(renderUnderdatabehandlere(v, 'en', meta(v, 'en')), /\| Valgfri ApS \(only if you choose it\) \|/);
});

test('the internal record has one section per activity, says it is generated and not legal advice, and is not published', () => {
  const d = rigtige();
  const t = les('fortegnelse-art30.md');
  for (const b of d.behandlinger) assert.ok(t.includes(`### ${b.id}`), b.id);
  assert.match(t, /Genereret/);
  assert.match(t, /ikke juridisk rådgivning/i);
  assert.ok(t.includes(d.tjekketDPF));
  for (const u of d.underdatabehandlere) assert.ok(t.includes(u.navn) && t.includes(u.dpa), u.id);
  const liste = readFileSync(path.join(ROD, 'scripts/offentlig.txt'), 'utf8');
  assert.match(liste, /^:\(exclude\)docs\/legal\/fortegnelse-art30\.md$/m);
});

// --- the outbound hosts of the control plane ---------------------------------------------------------------------

function tsFiler(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : tsFiler(p)) : p.endsWith('.ts') ? [p] : [];
  });
}
const SKY = path.join(ROD, 'sky/src');

/** Our own hosts and the placeholders of tests and examples: not third parties. `www.w3.org` is the XML namespace of the
 *  Atom feed (KC-0202), an identifier the code never connects to. */
const egen = (h: string): boolean =>
  h === 'host' || h === 'localhost' || h === '127.0.0.1' || h === 'clawco.work' || h.endsWith('.clawco.work') || h === 'www.w3.org'
  || h === 'x.invalid' || h.endsWith('.invalid') || h.endsWith('.test') || h.endsWith('.example') || h.endsWith('.localhost')
  || /(^|\.)eksempel\./.test(h);

/** `*.x.y` covers x.y itself and anything under it; otherwise an exact name. */
const daekker = (vaerter: string[], h: string): boolean =>
  vaerter.some((v) => (v.startsWith('*.') ? h === v.slice(2) || h.endsWith(v.slice(1)) : v === h));

function fremmedeVaerter(): Map<string, Set<string>> {
  const fund = new Map<string, Set<string>>();
  const mark = (h: string, f: string) => {
    const host = h.replace(/\.+$/, '').toLowerCase();
    if (!host || egen(host)) return;
    (fund.get(host) ?? fund.set(host, new Set()).get(host)!).add(path.relative(ROD, f));
  };
  for (const f of tsFiler(SKY)) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/https?:\/\/([A-Za-z0-9*.-]+)/g)) mark(m[1]!, f);
    // A name without a scheme (a host built in a template, e.g. `${id}.r2.cloudflarestorage.com`), comments left out. `dev` is left out:
    // it is a property name in the code (config.dev), never a host here.
    const udenKommentarer = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w])\/\/.*$/gm, '$1');
    // Whole tokens: one with a slash or an @ is a URL or an address (the scheme scan above owns URLs), so only bare names count.
    for (const m of udenKommentarer.matchAll(/[A-Za-z0-9@/._-]+/g)) {
      const tok = m[0].replace(/^\.+/, '').toLowerCase();
      if (!/[/@]/.test(tok) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|cloud|eu|ai|co|app|dk)$/.test(tok)) mark(tok, f);
    }
  }
  return fund;
}

test('every outbound host literal in sky/src belongs to a listed provider (a new third-party host without an entry fails)', () => {
  const d = rigtige();
  const vaerter = d.underdatabehandlere.flatMap((u) => u.vaerter);
  const fund = fremmedeVaerter();
  assert.ok(fund.size >= 4, 'the scan finds the real hosts (stripe, resend, r2)');
  const uden = [...fund].filter(([h]) => !daekker(vaerter, h)).map(([h, f]) => `${h} (${[...f].join(', ')})`);
  assert.deepEqual(uden, [], 'add the provider (or its host) to docs/legal/behandlinger.json, then run node scripts/behandlinger.ts --skriv');
  // The real providers are all seen.
  for (const h of ['api.resend.com', 'checkout.stripe.com', 'billing.stripe.com', 'r2.cloudflarestorage.com']) assert.ok(fund.has(h), `${h} is in the code`);
});

test('the matcher: an unlisted host fails, a wildcard covers its own subdomains, own and example hosts are ignored', () => {
  assert.equal(daekker(['api.resend.com'], 'api.evil.com'), false);
  assert.equal(daekker(['*.r2.cloudflarestorage.com'], 'abc.eu.r2.cloudflarestorage.com'), true);
  assert.equal(daekker(['*.r2.cloudflarestorage.com'], 'r2.cloudflarestorage.com'), true);
  assert.equal(daekker(['*.r2.cloudflarestorage.com'], 'cloudflarestorage.com'), false);
  for (const h of ['clawco.work', 'konto.clawco.work', 'localhost', '127.0.0.1', 'www.w3.org', 'x.invalid', 'a.test', 'b.example', 'host', 'status.eksempel.dk']) assert.ok(egen(h), h);
  for (const h of ['api.stripe.com', 'evil.com']) assert.ok(!egen(h), h);
});

/** The files in sky/src that can open a connection to something outside the process, and whom each one talks to.
 *  A provider id is an entry in `underdatabehandlere`; a behandling id is an activity; `intern` is our own
 *  tenant containers. A new file that calls out fails here until it is put on the right line. */
const UDGAAENDE: Record<string, { til: 'underdatabehandler' | 'behandling' | 'intern' | 'planlagt'; id?: string; vaerter?: string[] }> = {
  'drift/backup/lager.ts': { til: 'underdatabehandler', id: 'cloudflare' },
  'abonnement/stripe-sdk.ts': { til: 'underdatabehandler', id: 'stripe', vaerter: ['api.stripe.com'] },
  'delt/post-udbyder.ts': { til: 'underdatabehandler', id: 'resend' },
  'delt/fejlrapport-kerne.ts': { til: 'behandling', id: 'fejlrapporter' },
  'fleet/provisioner.ts': { til: 'intern' },
  'gateway/kontrolkald.ts': { til: 'intern' },
  'gateway/tenantkald.ts': { til: 'intern' },
  // KC-0264: the included model's providers. 'planlagt' = Sky can call them only once they are listed here (the runtime gate
  // juridiskGodkendt in that file keeps the proxy at 503 until then); KC-0266 lists them and turns this line into 'underdatabehandler'.
  // KC-0266: the included model runs on Bedrock (AWS, EU); Anthropic direct stays unlisted and its gate refuses it.
  'model/udbyder.ts': { til: 'underdatabehandler', id: 'aws', vaerter: ['bedrock-runtime.eu-north-1.amazonaws.com'] },
};

/** The hosts the model proxy's providers live on (config/modelpriser.json, {region} filled in). */
function modelVaerter(): string[] {
  const p = JSON.parse(readFileSync(path.join(ROD, 'config/modelpriser.json'), 'utf8')) as { udbydere: Record<string, { url: string; region?: string }> };
  return Object.values(p.udbydere).map((u) => new URL(u.url.replace('{region}', u.region ?? '')).hostname);
}

test('the files in sky/src that call out are the known ones, each tied to a listed provider or activity', () => {
  const d = rigtige();
  const moenster = /(^|[^.A-Za-z0-9_])fetch\(|\?\? *fetch\b|= *fetch\b|new Stripe\(|new Anthropic\(|new AnthropicBedrock\(|new AnthropicBedrockMantle\(|node:https|https\.request|net\.connect|tls\.connect/;
  const fundet = tsFiler(SKY).filter((f) => moenster.test(readFileSync(f, 'utf8'))).map((f) => path.relative(SKY, f)).sort();
  assert.deepEqual(fundet, Object.keys(UDGAAENDE).sort(), 'a new file that calls out needs an entry in docs/legal/behandlinger.json and a line here');
  for (const [fil, e] of Object.entries(UDGAAENDE)) {
    if (e.til === 'underdatabehandler') {
      const u = d.underdatabehandlere.find((x) => x.id === e.id);
      assert.ok(u, `${fil}: ${e.id} is a listed provider`);
      for (const h of e.vaerter ?? []) assert.ok(daekker(u.vaerter, h), `${fil}: ${h} is among ${e.id}'s hosts`);
    } else if (e.til === 'behandling') {
      assert.ok(d.behandlinger.some((b) => b.id === e.id), `${fil}: ${e.id} is a recorded activity`);
    } else if (e.til === 'planlagt') {
      assert.match(readFileSync(path.join(SKY, fil), 'utf8'), /juridiskGodkendt/, `${fil}: carries the gate that refuses an unlisted provider`);
      const vaerter = d.underdatabehandlere.flatMap((u) => u.vaerter);
      for (const h of modelVaerter()) assert.ok(!daekker(vaerter, h), `${h} is listed now: tie ${fil} to its provider instead of 'planlagt' (${e.id})`);
    }
  }
});

test('error reports: the sender exists but the record says no recipient is in use (the DSN is unset)', () => {
  const d = rigtige();
  const b = d.behandlinger.find((x) => x.id === 'fejlrapporter')!;
  assert.deepEqual(b.modtagere, []);
  assert.match(b.bemaerkning?.da ?? '', /underdatabehandler/i);
});
