// KC-0163: the A2UI export of the building blocks. Invariants: the export is derived from src/shell/katalog.ts (no
// second list of blocks or fields), it carries structure only (no user data, content or keys), every element
// needs its zone and trust-ladder level, and the committed docs/a2ui/clawco-katalog.json cannot drift from the code.
// Validation: A2UI v0.9.1 has no meta-schema for a catalog file (see test/fixtures/a2ui/README.md), so this file
// holds (a) a structural validator for the rules of the protocol document, run on the official basic catalog too, and
// (b) a small JSON Schema validator that checks real messages against the vendored envelope schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOKKE, type Blok } from '../src/shell/katalog.ts';
import { IKONER } from '../src/shell/ikoner.ts';
import { TONER } from '../src/shell/visuel.ts';
import { DATAZONER } from '../src/identitet/zoner.ts';
import { TRIN } from '../src/tillid/trin.ts';
import type { Handling } from '../src/rooms/hjem/kort.ts';
import { BESKRIVELSER, a2uiKilde, komponentNavn, tilA2ui, tilTekst } from '../src/shell/a2ui.ts';

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROD, 'scripts', 'katalog-a2ui.mjs');
const FIL = path.join(ROD, 'docs', 'a2ui', 'clawco-katalog.json');
const laes = (n: string): any => JSON.parse(readFileSync(path.join(ROD, 'test', 'fixtures', 'a2ui', n), 'utf8'));
const COMMON_ID: string = laes('common_types.json').$id;
const common = laes('common_types.json');
const envelope = laes('server_to_client.json');
const officiel = laes('basic-catalog.json');

// ---- (a) structural validator: the rules of the A2UI protocol document, read from the official basic catalog ----

/** Every `$ref` string in a document (deep). */
function refs(x: unknown, ud: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((y) => refs(y, ud));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === '$ref' && typeof v === 'string') ud.push(v); else refs(v, ud); }
  return ud;
}
const pegerPaa = (dok: any, ptr: string): unknown => ptr.split('/').filter(Boolean).reduce((x: any, k) => x?.[k], dok);

/** Problems with a catalog file (empty = it follows the v0.9.1 catalog form). */
function katalogProblemer(k: any): string[] {
  const p: string[] = [];
  if (k.$schema !== 'https://json-schema.org/draft/2020-12/schema') p.push('$schema is not draft 2020-12');
  if (typeof k.$id !== 'string' || k.$id !== k.catalogId) p.push('$id and catalogId must be the same string');
  const navne = Object.keys(k.components ?? {});
  if (!navne.length) p.push('no components');
  for (const n of navne) {
    const c = k.components[n];
    const dele: any[] = c.allOf ?? [];
    if (!dele.some((d) => typeof d.$ref === 'string' && d.$ref.endsWith('common_types.json#/$defs/ComponentCommon'))) p.push(`${n}: no ComponentCommon`);
    if (!dele.some((d) => d.properties?.component?.const === n && (d.required ?? []).includes('component'))) p.push(`${n}: no required component const`);
    if (c.unevaluatedProperties !== false) p.push(`${n}: unevaluatedProperties is not false`);
  }
  const liste: string[] = (k.$defs?.anyComponent?.oneOf ?? []).map((o: any) => o.$ref);
  if (JSON.stringify([...liste].sort()) !== JSON.stringify(navne.map((n) => `#/components/${n}`).sort())) p.push('anyComponent does not list every component exactly once');
  for (const r of refs(k)) {
    const [fil, ptr = ''] = r.split('#');
    const dok = fil === '' ? k : fil === COMMON_ID || fil === 'common_types.json' ? common : fil === 'catalog.json' ? k : undefined;
    if (!dok || pegerPaa(dok, ptr) === undefined) p.push(`dangling $ref ${r}`);
  }
  return p;
}

// ---- (b) a small JSON Schema validator (the keywords A2UI and this catalog use) ----

type Kontekst = { katalog: any };
function slaaOp(ref: string, dok: any, ctx: Kontekst): [any, any] {
  const [fil, ptr = ''] = ref.split('#');
  const maal = fil === '' ? dok : fil === COMMON_ID || fil === 'common_types.json' ? common : fil === 'catalog.json' ? ctx.katalog : undefined;
  const ud = maal === undefined ? undefined : pegerPaa(maal, ptr);
  if (ud === undefined) throw new Error(`unresolved $ref ${ref}`);
  return [ud, maal];
}
const lig = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Evaluated property names when `v` fits `s`, else null. */
function valider(s: any, v: unknown, dok: any, ctx: Kontekst): Set<string> | null {
  if (s === true) return new Set();
  if (s === false) return null;
  let ev = new Set<string>();
  const tilfoej = (m: Set<string> | null): boolean => { if (!m) return false; m.forEach((x) => ev.add(x)); return true; };
  if (s.$ref) { const [t, d] = slaaOp(s.$ref, dok, ctx); if (!tilfoej(valider(t, v, d, ctx))) return null; }
  if ('const' in s && !lig(s.const, v)) return null;
  if (s.enum && !s.enum.some((e: unknown) => lig(e, v))) return null;
  const obj = v !== null && typeof v === 'object' && !Array.isArray(v);
  switch (s.type) {
    case 'string': if (typeof v !== 'string') return null; break;
    case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) return null; break;
    case 'integer': if (!Number.isInteger(v)) return null; break;
    case 'boolean': if (typeof v !== 'boolean') return null; break;
    case 'array': if (!Array.isArray(v)) return null; break;
    case 'object': if (!obj) return null; break;
  }
  if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) return null;
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return null;
    if (s.items !== undefined && !v.every((x) => valider(s.items, x, dok, ctx))) return null;
  }
  if (obj) {
    const o = v as Record<string, unknown>;
    if ((s.required ?? []).some((k: string) => o[k] === undefined)) return null;
    for (const [k, ps] of Object.entries<any>(s.properties ?? {})) {
      if (o[k] === undefined) continue;
      if (!valider(ps, o[k], dok, ctx)) return null;
      ev.add(k);
    }
    if (s.additionalProperties !== undefined) {
      for (const k of Object.keys(o)) {
        if (s.properties && k in s.properties) continue;
        if (!valider(s.additionalProperties, o[k], dok, ctx)) return null;
        ev.add(k);
      }
    }
  }
  for (const d of s.allOf ?? []) if (!tilfoej(valider(d, v, dok, ctx))) return null;
  if (s.oneOf) {
    const traf = s.oneOf.map((d: any) => valider(d, v, dok, ctx)).filter((m: Set<string> | null) => m);
    if (traf.length !== 1) return null;
    tilfoej(traf[0]);
  }
  if (s.anyOf) {
    const traf = s.anyOf.map((d: any) => valider(d, v, dok, ctx)).filter((m: Set<string> | null) => m);
    if (!traf.length) return null;
    traf.forEach((m: Set<string>) => tilfoej(m));
  }
  if (s.unevaluatedProperties === false && obj && Object.keys(v as object).some((k) => !ev.has(k))) return null;
  return ev;
}
const passerMod = (s: any, v: unknown, dok: any, katalog: any): boolean => valider(s, v, dok, { katalog }) !== null;

// ---- helpers ----

const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

const eksport = tilA2ui();
const stor = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);
/** One valid element per block: its catalog example plus what every element must carry. */
const element = (b: Blok, over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: `e-${b.id}`, component: komponentNavn(b.id), zone: 'privat', trin: 1, ...(b.eksempel as object), ...over });
const handlingEks = { id: 'tjek', label: 'Tjek aftalen', instruktion: 'Find aftalen og sammenlign.', fortryd: 'Gendan.', action: { event: { name: 'tjek', context: {} } } };
const besked = (k: any, components: unknown[]): unknown => ({ version: 'v0.9.1', updateComponents: { surfaceId: 's1', components } });
const opret = (k: any): unknown => ({ version: 'v0.9.1', createSurface: { surfaceId: 's1', catalogId: k.catalogId } });
const spring = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROD, encoding: 'utf8' });

// ---- tests ----

test('the vendored fixtures are A2UI v0.9.1 and say where they came from', () => {
  assert.ok(envelope.$defs.CreateSurfaceMessage.properties.version.enum.includes('v0.9.1'));
  const readme = readFileSync(path.join(ROD, 'test', 'fixtures', 'a2ui', 'README.md'), 'utf8');
  assert.match(readme, /v0\.9\.1/);
  assert.match(readme, /github\.com\/a2ui-project\/a2ui/);
  assert.match(readme, /2026-11-02/);
});

test('the structural validator accepts the official basic catalog and the export, and can fail', () => {
  assert.deepEqual(katalogProblemer(officiel), []);
  assert.deepEqual(katalogProblemer(eksport), []);
  const uden = structuredClone(eksport) as any; delete uden.catalogId;
  assert.ok(katalogProblemer(uden).length > 0, 'catalogId missing');
  const forkert = structuredClone(eksport) as any; forkert.components.Kort.allOf[1].properties.component.const = 'Andet';
  assert.ok(katalogProblemer(forkert).length > 0, 'wrong component const');
  const mangler = structuredClone(eksport) as any; mangler.$defs.anyComponent.oneOf.pop();
  assert.ok(katalogProblemer(mangler).length > 0, 'anyComponent misses one');
  const hang = structuredClone(eksport) as any; hang.components.Kort.allOf[1].properties.titel = { $ref: '#/$defs/findesikke' };
  assert.ok(katalogProblemer(hang).length > 0, 'dangling $ref');
});

test('every catalog block is exactly one component, counted from the catalog itself', () => {
  const navne = Object.keys(eksport.components);
  assert.equal(navne.length, BLOKKE.length);
  assert.deepEqual(navne, BLOKKE.map((b) => stor(b.id)));
  assert.equal(new Set(navne).size, navne.length);
  assert.deepEqual(eksport.$defs['anyComponent'], { oneOf: navne.map((n) => ({ $ref: `#/components/${n}` })) });
  for (const b of BLOKKE) {
    const c: any = eksport.components[stor(b.id)];
    const eget = c.allOf[1];
    assert.equal(eget.properties.component.const, stor(b.id));
    assert.equal(c.title, b.navn);
    for (const felt of Object.keys(b.felter.properties ?? {})) assert.ok(felt in eget.properties, `${b.id}.${felt}`);
    for (const kraevet of b.felter.required ?? []) assert.ok(eget.required.includes(kraevet), `${b.id} requires ${kraevet}`);
    assert.ok(eget.required.includes('component') && eget.required.includes('zone') && eget.required.includes('trin'));
    assert.equal(eget.properties.handlinger.items.$ref, '#/$defs/Handling');
    assert.equal(c.unevaluatedProperties, false);
  }
});

test('zone and trust-ladder level are enums from the code and required on every component', () => {
  for (const b of BLOKKE) {
    const eget: any = (eksport.components[stor(b.id)] as any).allOf[1];
    assert.deepEqual(eget.properties.zone.enum, [...DATAZONER]);
    assert.deepEqual(eget.properties.trin.enum, TRIN.map((t) => t.trin));
  }
});

test('ikon names and tone values are enums derived from the code', () => {
  const v: any = eksport.$defs['Visuel'];
  assert.deepEqual(v.properties.ikon.enum, Object.keys(IKONER));
  assert.deepEqual(v.properties.tone.enum, [...TONER]);
  assert.deepEqual(v.required, ['ikon']);
});

test('the handling carries the instruction and the undo instruction, as the code\'s Handling does', () => {
  const h: any = eksport.$defs['Handling'];
  const noegler: Record<keyof Handling, true> = { id: true, label: true, instruktion: true, fortryd: true }; // fails typecheck when Handling gains a field
  assert.deepEqual(Object.keys(h.properties).filter((k) => k !== 'action'), Object.keys(noegler));
  assert.deepEqual(h.required, ['id', 'label', 'instruktion', 'action']);
  assert.equal(h.properties.action.$ref, `${COMMON_ID}#/$defs/Action`);
});

test('real messages with one element per block validate against the vendored envelope, in the export as the catalog', () => {
  const alle = BLOKKE.map((b) => element(b));
  alle[0] = { ...alle[0]!, id: 'root', handlinger: [handlingEks] };
  assert.ok(passerMod(envelope, opret(eksport), envelope, eksport), 'createSurface');
  assert.ok(passerMod(envelope, besked(eksport, alle), envelope, eksport), 'updateComponents');
  for (const b of BLOKKE) assert.ok(passerMod(envelope, besked(eksport, [element(b)]), envelope, eksport), b.id);
  const bundet = element(BLOKKE[0]!, { titel: { path: '/titel' } });
  assert.ok(passerMod(envelope, besked(eksport, [bundet]), envelope, eksport), 'data binding is declared');
});

test('a consumer cannot render an element without zone and trust-ladder level, or with anything extra', () => {
  for (const b of BLOKKE) {
    const ok = element(b);
    assert.ok(passerMod(envelope, besked(eksport, [ok]), envelope, eksport), `${b.id} control`);
    for (const udelad of ['zone', 'trin']) {
      const { [udelad]: _, ...uden } = ok;
      assert.equal(passerMod(envelope, besked(eksport, [uden]), envelope, eksport), false, `${b.id} without ${udelad}`);
    }
    assert.equal(passerMod(envelope, besked(eksport, [{ ...ok, zone: 'ukendt' }]), envelope, eksport), false, `${b.id} wrong zone`);
    assert.equal(passerMod(envelope, besked(eksport, [{ ...ok, trin: 9 }]), envelope, eksport), false, `${b.id} wrong trin`);
    assert.equal(passerMod(envelope, besked(eksport, [{ ...ok, ekstra: 1 }]), envelope, eksport), false, `${b.id} extra property`);
    for (const kraevet of b.felter.required ?? []) {
      const { [kraevet]: _, ...uden } = ok;
      assert.equal(passerMod(envelope, besked(eksport, [uden]), envelope, eksport), false, `${b.id} without ${kraevet}`);
    }
  }
  const uden = { ...element(BLOKKE[0]!), handlinger: [{ ...handlingEks, instruktion: undefined }] };
  assert.equal(passerMod(envelope, besked(eksport, [uden]), envelope, eksport), false, 'a handling needs its instruction');
});

test('adding a block to a copy of the catalog changes the export; removing one removes its component', () => {
  const grund = a2uiKilde();
  const ny: Blok = { id: 'ny' as Blok['id'], navn: 'Ny', formaal: 'x', status: 'bygget', anatomi: 'x', eksempel: {}, felter: { type: 'object', properties: { overskrift: { type: 'string' } }, required: ['overskrift'] } };
  const stoerre = tilA2ui({ ...grund, blokke: [...grund.blokke, ny] });
  assert.notEqual(tilTekst(stoerre), tilTekst(eksport));
  assert.equal(Object.keys(stoerre.components).length, BLOKKE.length + 1);
  assert.ok('Ny' in stoerre.components && (stoerre.$defs['anyComponent'] as any).oneOf.length === BLOKKE.length + 1);
  assert.deepEqual(katalogProblemer(stoerre), []);
  const mindre = tilA2ui({ ...grund, blokke: grund.blokke.slice(1) });
  assert.equal(Object.keys(mindre.components).length, BLOKKE.length - 1);
  assert.ok(!('Kort' in mindre.components));
  const andet = tilA2ui({ ...grund, zoner: ['privat'] });
  assert.notEqual(tilTekst(andet), tilTekst(eksport), 'the zone list is read from the source, not copied');
  assert.throws(() => tilA2ui({ ...grund, blokke: [...grund.blokke, grund.blokke[0]!] }), /twice/);
});

test('two runs are byte-identical, in process and through the script', () => {
  assert.equal(tilTekst(tilA2ui()), tilTekst(tilA2ui()));
  assert.ok(tilTekst(eksport).endsWith('}\n') && !tilTekst(eksport).endsWith('\n\n'));
  const mappe = mkdtempSync(path.join(tmpdir(), 'a2ui-'));
  try {
    const a = path.join(mappe, 'a.json'); const b = path.join(mappe, 'b.json');
    assert.equal(spring(['--fil', a]).status, 0);
    assert.equal(spring(['--fil', b]).status, 0);
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
    assert.equal(readFileSync(a, 'utf8'), tilTekst(eksport));
  } finally { rmSync(mappe, { recursive: true, force: true }); }
});

test('the committed docs/a2ui/clawco-katalog.json equals the export (--tjek), and --tjek fails on drift', () => {
  assert.equal(readFileSync(FIL, 'utf8'), tilTekst(eksport));
  const ok = spring(['--tjek']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const mappe = mkdtempSync(path.join(tmpdir(), 'a2ui-'));
  try {
    const drift = path.join(mappe, 'drift.json');
    writeFileSync(drift, readFileSync(FIL, 'utf8').replace('"Kort"', '"Kortet"'));
    const bad = spring(['--tjek', '--fil', drift]);
    assert.equal(bad.status, 1, 'drift exits 1');
    assert.match(bad.stdout + bad.stderr, /katalog:a2ui/);
    assert.equal(spring(['--tjek', '--fil', path.join(mappe, 'findes-ikke.json')]).status, 1, 'a missing file exits 1');
  } finally { rmSync(mappe, { recursive: true, force: true }); }
});

test('structure only: no string in the export looks like content', () => {
  // The rule: a value is either a token (letters, digits, - and _, at most 40, no spaces: names, enum values, type
  // words), a pointer or schema URL from a fixed prefix list, or a description taken verbatim from the module's own
  // fixed English texts (BESKRIVELSER). `title` is a label (at most 40 characters, no full stop). No '@' anywhere,
  // no https:// outside the schema hosts, and none of the catalog's example texts (the only user-shaped text the
  // catalog holds) appears in the export; an example that is itself a token (e.g. the ikon name cloud-rain) is a
  // legitimate enum value and is not content.
  const URL_OK = /^https:\/\/(a2ui\.org|json-schema\.org|clawco\.work\/a2ui)\//;
  const faste = new Set<string>(Object.values(BESKRIVELSER));
  const eksempler: string[] = [];
  const samlEksempler = (x: unknown): void => { if (typeof x === 'string') { if (!TOKEN.test(x)) eksempler.push(x); } else if (x && typeof x === 'object') Object.values(x).forEach(samlEksempler); };
  BLOKKE.forEach((b) => samlEksempler(b.eksempel));
  assert.ok(eksempler.length > 10, 'the scan has examples to look for');
  const tekst = tilTekst(eksport);
  for (const e of eksempler) assert.ok(!tekst.includes(e), `example text leaked: ${e}`);
  assert.ok(!tekst.includes('@'), 'no @');
  const urls = tekst.match(/https:\/\/[^"]*/g) ?? [];
  for (const u of urls) assert.match(u, URL_OK, u);
  const maengde = { tokens: 0, beskrivelser: 0 };
  const gaa = (x: unknown, noegle: string): void => {
    if (Array.isArray(x)) { x.forEach((y) => gaa(y, noegle)); return; }
    if (x && typeof x === 'object') { for (const [k, v] of Object.entries(x)) gaa(v, k); return; }
    if (typeof x !== 'string') return;
    if (['$schema', '$id', 'catalogId'].includes(noegle)) { assert.match(x, URL_OK, noegle); return; }
    if (noegle === '$ref') { assert.ok(x.startsWith('#/') || URL_OK.test(x), x); return; }
    if (noegle === 'description') { assert.ok(faste.has(x), `description is not a fixed text: ${x}`); maengde.beskrivelser++; return; }
    if (noegle === 'title') { assert.ok(x.length <= 40 && !x.includes('.'), `title: ${x}`); return; }
    assert.match(x, TOKEN, `${noegle}: ${x}`); maengde.tokens++;
  };
  gaa(eksport, '');
  assert.ok(maengde.tokens > 100 && maengde.beskrivelser > 3, JSON.stringify(maengde));
});
