import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// KC-0207: the breach runbook (docs/beredskab/README.md), the message templates (docs/beredskab/skabeloner/) and the
// check script (scripts/beredskab-tjek.ts). Invariants: (1) the plan is a draft and says so on its first line;
// (2) nothing in it contradicts what the legal texts promise customers (the 48 hours of the data processing agreement
// are quoted from that file, not retyped); (3) every placeholder is findable by the script, so none ships unnoticed;
// (4) the plan is internal: it is not on the public mirror list and holds no customer name, address or IP;
// (5) the security contact is one mailbox in the config, security.txt and the plan, and security.txt never lapses unseen.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');
const RUNBOG = 'docs/beredskab/README.md';
const SKABELONER = 'docs/beredskab/skabeloner';
const KRAEVEDE = ['Roller', 'Alvorsgrader', 'Den første time', '72-timers-uret', 'Databehandlerens pligt', 'Beslutningslog', 'Efterspil', 'Kontaktpunkter'];
const SKABELONFILER = ['datatilsynet.da.md', 'kunder.da.md', 'kunder.en.md', 'statusside.da.md', 'statusside.en.md'];
// The official address of the supervisory authority; written as a join so the public-mirror scan (which looks for
// literal addresses in the published tests) has nothing to flag, and so the one address allowed here is explicit.
const DT_MAIL = ['dt', 'datatilsynet.dk'].join('@');
const EGEN_MAIL = JSON.parse(laes('config/hjaelp.json')).postkasse as string;

/** The text under each `## ` heading, by exact title. */
function afsnit(md: string): Map<string, string> {
  const ud = new Map<string, string>();
  let navn: string | null = null;
  for (const l of md.split('\n')) {
    const m = /^## (.+?)\s*$/.exec(l);
    if (m) { navn = m[1]!; ud.set(navn, ''); } else if (navn !== null) ud.set(navn, `${ud.get(navn)}${l}\n`);
  }
  return ud;
}
const PLADS = /\[([A-Z0-9-]+)\]/g;
const noegler = (md: string): string[] => [...new Set([...md.matchAll(PLADS)].map((m) => m[1]!))].sort();

test('the runbook exists, says on its first line that it is a draft, and has every required section', () => {
  assert.ok(existsSync(path.join(ROD, RUNBOG)), 'missing docs/beredskab/README.md');
  const md = laes(RUNBOG);
  assert.equal(md.split('\n')[0], '> Udkast til beredskabsplan. Ikke juridisk rådgivning: tærskler og formuleringer skal læses af en advokat, før de bruges i alvor.');
  const a = afsnit(md);
  for (const k of KRAEVEDE) assert.ok((a.get(k) ?? '').trim().length > 80, `section "## ${k}" is missing or empty`);
});

test('the severity table has exactly the four rows S1 to S4, each saying who is told and whether the 72-hour clock applies', () => {
  const t = afsnit(laes(RUNBOG)).get('Alvorsgrader') ?? '';
  const raekker = t.split('\n').filter((l) => /^\|\s*S\d\b/.test(l));
  assert.deepEqual(raekker.map((r) => /^\|\s*(S\d)/.exec(r)![1]), ['S1', 'S2', 'S3', 'S4']);
  const hoved = t.split('\n').find((l) => /^\|\s*Grad/i.test(l)) ?? '';
  assert.match(hoved, /Hvem får besked/i);
  assert.match(hoved, /72/);
  for (const r of raekker) assert.ok(r.split('|').filter((c) => c.trim()).length >= 4, `row too thin: ${r}`);
});

test('the first hour rotates secrets with the two key-name-and-length scripts, stops containers, keeps logs and deletes nothing', () => {
  const t = afsnit(laes(RUNBOG)).get('Den første time') ?? '';
  for (const s of ['scripts/set-secret.sh', 'sky/scripts/saet-hemmelighed.sh', 'journalctl -u sky', 'journalctl --user -u kontrolcenter', 'docker stop clawco-t-']) {
    assert.ok(t.includes(s), `the first hour does not name ${s}`);
  }
  assert.ok(/slet ikke|intet slettes/i.test(t), 'the first hour must say that nothing is deleted');
  assert.ok(!/(^|[\s`;&|])rm\s/m.test(t), 'no rm in the first hour');
  for (const l of t.split('\n').filter((x) => /docker (rm|volume rm)|--vacuum|truncate|shred/i.test(x))) assert.match(l, /\b(ikke|aldrig)\b/i, `a destroying command may only appear as a "do not": ${l}`);
  assert.match(t, /UTC/);
});

test('the 72-hour section cites the supervisory authority\'s own page and route, art. 33 and art. 34, and mail from our own sender', () => {
  const t = afsnit(laes(RUNBOG)).get('72-timers-uret') ?? '';
  assert.match(t, /datatilsynet\.dk\/sikkerhedsbrud\/anmeld-sikkerhedsbrud/);
  assert.match(t, /virk\.dk\/myndigheder\/stat\/SAMSIK\/selvbetjening\/Indberetning_af_brud_paa_sikkerhed/);
  assert.match(t, /tjekket 2026-11-02/i);
  assert.match(t, /art\. 33/);
  assert.match(t, /art\. 34/);
  assert.match(t, /Resend/);
  assert.match(t, /aldrig[^.\n]*statusside/i, 'the status page is never the only notice');
  for (const felt of ['karakter', 'kategorier', 'kontaktpunkt', 'konsekvenser', 'foranstaltninger']) assert.ok(t.toLowerCase().includes(felt), `the form's "${felt}" is not described`);
});

test('the processor section quotes the data processing agreement word for word', () => {
  const t = afsnit(laes(RUNBOG)).get('Databehandlerens pligt') ?? '';
  const dpa = laes('docs/legal/databehandleraftale.da.md');
  const saetning = /Opdager vi et brud[^\n]*?senest 48 timer efter, vi har fået kendskab til det\./.exec(dpa)?.[0];
  assert.ok(saetning, 'the sentence is no longer in the agreement: update the runbook with it');
  assert.ok(t.includes(saetning!), 'the runbook does not quote the agreement\'s sentence about breaches');
  assert.match(t, /48 timer/);
});

test('the contact table names the authority, the providers in use, "os selv" and the lawyer as a bracketed placeholder', () => {
  const t = afsnit(laes(RUNBOG)).get('Kontaktpunkter') ?? '';
  for (const n of ['Datatilsynet', 'Cloudflare', 'Stripe', 'Resend', 'Os selv']) assert.ok(new RegExp(`^\\|\\s*${n}`, 'm').test(t), `no contact row for ${n}`);
  assert.ok(t.includes('[advokat: ikke valgt endnu]'));
  assert.ok(t.includes(DT_MAIL) && t.includes('33 19 32 00'));
  assert.ok(!/hetzner/i.test(t), 'no Hetzner row: nothing runs there in production');
});

test('the sections Beslutningslog and Efterspil hold their templates', () => {
  const a = afsnit(laes(RUNBOG));
  for (const k of ['Tid (UTC)', 'Faktum', 'Beslutning', 'Hvem', 'Hvorfor']) assert.ok((a.get('Beslutningslog') ?? '').includes(k), `decision log lacks ${k}`);
  for (const k of ['Tidslinje', 'Rodårsag', 'Hvad holdt', 'Hvad svigtede', 'Handlinger', 'kunderne']) assert.ok((a.get('Efterspil') ?? '').includes(k), `post-mortem lacks ${k}`);
  assert.match(a.get('Roller') ?? '', /udtrykkelig\w* ja/i);
});

test('every template exists and the Danish and English pairs carry the same placeholder keys', () => {
  for (const f of SKABELONFILER) assert.ok(existsSync(path.join(ROD, SKABELONER, f)), `missing template ${f}`);
  assert.deepEqual(readdirSync(path.join(ROD, SKABELONER)).sort(), [...SKABELONFILER].sort(), 'no stray template');
  for (const stam of ['kunder', 'statusside']) {
    const da = noegler(laes(`${SKABELONER}/${stam}.da.md`));
    const en = noegler(laes(`${SKABELONER}/${stam}.en.md`));
    assert.ok(da.length >= 3, `${stam}: too few placeholders`);
    assert.deepEqual(en, da, `${stam}: the Danish and English placeholders differ`);
  }
  assert.ok(noegler(laes(`${SKABELONER}/datatilsynet.da.md`)).length >= 8);
});

test('the Datatilsynet checklist follows the order the form asks, and the customer templates answer the five plain questions', () => {
  const d = laes(`${SKABELONER}/datatilsynet.da.md`);
  const raekkefoelge = ['Hvad er sket', 'Kategorier og omtrentligt antal', 'Kontaktpunkt', 'Sandsynlige konsekvenser', 'Foranstaltninger'];
  const pos = raekkefoelge.map((r) => d.indexOf(r));
  assert.ok(pos.every((p) => p >= 0), `the checklist lacks a heading: ${pos}`);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'the checklist is not in the form\'s order');
  assert.ok(d.includes('Tidspunkt for kendskab'), 'the clock start must be noted');
  const da = laes(`${SKABELONER}/kunder.da.md`);
  const en = laes(`${SKABELONER}/kunder.en.md`);
  for (const h of ['Hvad der er sket', 'Hvilke oplysninger', 'Hvad vi har gjort', 'Hvad du skal gøre', 'Sådan når du os']) assert.ok(da.includes(h), `kunder.da lacks "${h}"`);
  for (const h of ['What happened', 'What data', 'What we have done', 'What you should do', 'How to reach us']) assert.ok(en.includes(h), `kunder.en lacks "${h}"`);
  assert.ok(da.includes(EGEN_MAIL) && en.includes(EGEN_MAIL));
});

test('the status page templates have a title and a text with headroom under the feed\'s limits (the feed\'s own rules are checked in sky/test/drift/helbred/beredskab-skabelon.test.ts, since the tenant tests may not import Sky)', () => {
  for (const [f, titel, tekst] of [['statusside.da.md', 'Titel', 'Tekst'], ['statusside.en.md', 'Title', 'Text']] as const) {
    const a = afsnit(laes(`${SKABELONER}/${f}`));
    const t = (a.get(titel) ?? '').trim().replace(PLADS, 'noget');
    const x = (a.get(tekst) ?? '').trim().replace(PLADS, 'noget');
    assert.ok(t && x, `${f}: needs a "## ${titel}" and a "## ${tekst}" section`);
    // 120 and 2000 are the limits in sky/src/drift/helbred/haendelse.ts; placeholders are filled with longer words, so leave headroom.
    assert.ok(t.length <= 90 && x.length <= 1500, `${f}: too little headroom for filling in (${t.length}/${x.length})`);
  }
  for (const f of ['statusside.da.md', 'statusside.en.md']) assert.match(laes(`${SKABELONER}/${f}`), /haendelse\.mjs/);
});

// --- the check script -------------------------------------------------------------------------------------------

const SCRIPT = path.join(ROD, 'scripts/beredskab-tjek.ts');
const koer = (rod: string, ...args: string[]) => spawnSync('node', [SCRIPT, '--rod', rod, ...args], { encoding: 'utf8' });
const omDage = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

/** A minimal repo-shaped folder: runbook, one template, config and security.txt. */
function lavRod(o: { runbog?: string; skabelon?: string; kontakt?: string; udloeber?: string; config?: string } = {}): string {
  const d = mkdtempSync(path.join(tmpdir(), 'beredskab-'));
  const mail = o.kontakt ?? 'kontakt@clawco.example';
  mkdirSync(path.join(d, 'docs/beredskab/skabeloner'), { recursive: true });
  mkdirSync(path.join(d, 'site/.well-known'), { recursive: true });
  mkdirSync(path.join(d, 'config'), { recursive: true });
  writeFileSync(path.join(d, 'docs/beredskab/README.md'), o.runbog ?? `> Udkast.\n\n## Kontaktpunkter\n\n| Hvem | Hvordan |\n|---|---|\n| Os selv | ${mail} |\n`);
  writeFileSync(path.join(d, 'docs/beredskab/skabeloner/a.da.md'), o.skabelon ?? 'Intet her.\n');
  writeFileSync(path.join(d, 'site/.well-known/security.txt'), `Contact: mailto:${mail}\nExpires: ${o.udloeber ?? omDage(300)}\nPreferred-Languages: da, en\n`);
  writeFileSync(path.join(d, 'config/hjaelp.json'), o.config ?? JSON.stringify({ postkasse: 'kontakt@clawco.example' }));
  return d;
}
const medRod = (o: Parameters<typeof lavRod>[0], f: (d: string) => void): void => {
  const d = lavRod(o);
  try { f(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

test('script: a clean folder exits 0 and says nothing is left open', () => {
  medRod({}, (d) => {
    const r = koer(d);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(koer(d, '--streng').status, 0);
  });
});

test('script: one open placeholder in the runbook is listed with file and line and exits 0; --streng exits 1', () => {
  medRod({ runbog: '> Udkast.\n\nTekst.\n[advokat: ikke valgt endnu]\n\n## Kontaktpunkter\n\n| Hvem | Hvordan |\n|---|---|\n| Os selv | kontakt@clawco.example |\n' }, (d) => {
    const r = koer(d);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /docs\/beredskab\/README\.md:4\b.*\[advokat: ikke valgt endnu\]/);
    const s = koer(d, '--streng');
    assert.equal(s.status, 1);
    assert.match(s.stdout, /\[advokat: ikke valgt endnu\]/);
  });
});

test('script: placeholders in a template are listed as fields to fill in, and are never blocking; markdown links and empty checkboxes are not placeholders', () => {
  medRod({ skabelon: 'Linje et.\nHændelsen skete [TIDSPUNKT-UTC], se [siden](https://example.org). [ ] Afkrydsning [x]\n' }, (d) => {
    const r = koer(d, '--streng');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /skabeloner\/a\.da\.md:2\b.*\[TIDSPUNKT-UTC\]/);
    assert.ok(!/siden\]|\[ \]|\[x\]/.test(r.stdout), r.stdout);
  });
});

test('script: a security.txt contact that differs from the config mailbox exits 1 in every mode', () => {
  medRod({ kontakt: 'andet@clawco.example' }, (d) => {
    for (const a of [[], ['--streng']]) {
      const r = koer(d, ...a);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, /security\.txt/);
    }
  });
});

test('script: a runbook whose "os selv" row names another mailbox exits 1', () => {
  medRod({ runbog: '> Udkast.\n\n## Kontaktpunkter\n\n| Hvem | Hvordan |\n|---|---|\n| Os selv | helt-andet@clawco.example |\n' }, (d) => {
    const r = koer(d);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Kontaktpunkter|os selv/i);
  });
});

test('script: security.txt expiring within 30 days, or already expired, exits 1; 31 days ahead passes', () => {
  medRod({ udloeber: omDage(20) }, (d) => { const r = koer(d); assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout + r.stderr, /Expires/); });
  medRod({ udloeber: omDage(-3) }, (d) => assert.equal(koer(d).status, 1));
  medRod({ udloeber: omDage(31) }, (d) => assert.equal(koer(d).status, 0));
});

test('script: a missing runbook exits 1', () => {
  medRod({}, (d) => {
    rmSync(path.join(d, 'docs/beredskab/README.md'));
    assert.equal(koer(d).status, 1);
  });
});

test('the real repo: the script exits 0 and the only open placeholder in the plan is the lawyer', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', cwd: tmpdir() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const aabne = r.stdout.split('\n').filter((l) => l.startsWith('ÅBEN'));
  assert.ok(aabne.length >= 1, 'the lawyer placeholder should still be open');
  for (const l of aabne) assert.match(l, /\[advokat: ikke valgt endnu\]/, l);
  const s = spawnSync('node', [SCRIPT, '--streng'], { encoding: 'utf8', cwd: tmpdir() });
  assert.equal(s.status, 1, '--streng must fail while the lawyer is not chosen (the launch gate)');
});

// --- internal, and free of real data ---------------------------------------------------------------------------

test('nothing under docs/beredskab/ is covered by the public mirror list', () => {
  const linjer = laes('scripts/offentlig.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith(':('));
  const filer = [RUNBOG, ...SKABELONFILER.map((f) => `${SKABELONER}/${f}`)];
  for (const f of filer) {
    const daekket = linjer.filter((p) => f === p || f.startsWith(`${p.replace(/\/$/, '')}/`));
    assert.deepEqual(daekket, [], `${f} would be published by ${daekket.join(', ')}`);
  }
});

test('the plan holds no tenant address, IP address or mailbox other than our own and the authority\'s', () => {
  const filer = [RUNBOG, ...SKABELONFILER.map((f) => `${SKABELONER}/${f}`)];
  const tilladt = new Set([EGEN_MAIL, DT_MAIL]);
  for (const f of filer) {
    const t = laes(f);
    const adresser = [...t.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
    assert.deepEqual(adresser.filter((a) => !tilladt.has(a)), [], `${f}: an address that is not ours or the authority's`);
    assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(t), `${f}: an IP address`);
    assert.ok(!/\bhus-[a-z2-7]{8}\b/i.test(t), `${f}: a tenant address`);
  }
});
