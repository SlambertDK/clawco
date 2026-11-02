// KC-0163: the building blocks (src/shell/katalog.ts) as an A2UI v0.9.1 component catalog, so a renderer that speaks
// A2UI (OpenClaw's Canvas) can draw Clawco elements. The export is DERIVED from the catalog, the zone list and the
// trust ladder (AGENTS.md §0 r6: no second hand-kept list of blocks or fields); `docs/a2ui/clawco-katalog.json` is its
// output (`npm run katalog:a2ui`, `--tjek` fails when the file drifts).
//
// Form (A2UI v0.9.1 has no meta-schema for a catalog file; this follows the official basic catalog and the protocol
// document): one JSON Schema 2020-12 document with `$id` = `catalogId`, `components` (name → schema, each
// `allOf` [ComponentCommon, own properties] with `unevaluatedProperties: false`), `$defs.anyComponent` listing every
// component once, `$defs.theme`, `functions`. Text fields are `DynamicString`s from common_types.json, so a value may
// be a literal or a data binding ({"path": "/x"}).
//
// Invariants: structure only (names, enums, required lists; never user data, content or keys); zone and trust-ladder
// level are REQUIRED on every component, so no element can be drawn without them; two runs are byte-identical (key
// order follows the catalog order). Lives in src/shell/ and not src/agent/ because it must import the catalog, and
// src/agent/ may import nothing outside itself (test/agent/afhaengigheder.test.ts).

import { BLOKKE, VISUEL_FELT, type Blok, type JsonSkema } from './katalog.ts';
import { DATAZONER } from '../identitet/zoner.ts';
import { TRIN } from '../tillid/trin.ts';

export const A2UI_VERSION = 'v0.9.1';
const COMMON = 'https://a2ui.org/specification/v0_9/common_types.json';
export const KATALOG_ID = 'https://clawco.work/a2ui/katalog.json';

/** The only free text in the export: fixed English descriptions, never derived from data. */
export const BESKRIVELSER = {
  katalog: 'The Clawco building blocks as A2UI components. Structure only: no content, no user data, no keys.',
  zone: 'The data zone the element belongs to. Required: an element is never drawn without it.',
  trin: 'The trust-ladder level (0 see, 1 sort, 2 book-keep, 3 prepare, 4 execute with undo) at which Hermes may act on this element on its own. Required.',
  handlinger: 'What a person can do with the element; each handling carries the instruction Hermes runs and, when possible, the one that undoes it.',
  instruktion: 'The instruction Hermes runs when the handling is chosen.',
  fortryd: 'The instruction that undoes the handling, when there is one.',
  action: 'The A2UI event the renderer sends when the handling is chosen.',
} as const;

/** Everything the export is derived from. */
export type A2uiKilde = {
  blokke: readonly Blok[];
  /** The schemas the blocks refer to as `#/$defs/<name>` (the shared "visuel" field). */
  delt: Readonly<Record<string, JsonSkema>>;
  zoner: readonly string[];
  trin: readonly number[];
};

export type A2uiSkema = boolean | { [noegle: string]: unknown };
export type A2uiKatalog = {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  catalogId: string;
  components: Record<string, A2uiSkema>;
  functions: Record<string, never>;
  $defs: Record<string, A2uiSkema>;
};

/** The standard source: the app's own catalog, zones and trust ladder. */
export function a2uiKilde(): A2uiKilde {
  return { blokke: BLOKKE, delt: { visuel: VISUEL_FELT }, zoner: DATAZONER, trin: TRIN.map((t) => t.trin) };
}

const stor = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** The component name of a block id (`kort` → `Kort`). */
export const komponentNavn = stor;

const dyn = (navn: string): A2uiSkema => ({ $ref: `${COMMON}#/$defs/${navn}` });

/** A catalog field as an A2UI property: strings, numbers, booleans and string lists may be bound to the data model. */
function egenskab(s: JsonSkema): A2uiSkema {
  if (s.$ref) return { $ref: `#/$defs/${stor(s.$ref.replace('#/$defs/', ''))}` };
  if (s.enum) return { type: s.type ?? 'string', enum: [...s.enum] };
  switch (s.type) {
    case 'string': return dyn('DynamicString');
    case 'number': case 'integer': return dyn('DynamicNumber');
    case 'boolean': return dyn('DynamicBoolean');
    case 'array':
      if (s.items?.type === 'string' && !s.items.enum) return dyn('DynamicStringList');
      return { type: 'array', ...(s.items ? { items: egenskab(s.items) } : {}) };
    case 'object': return objekt(s);
    default: return {};
  }
}

function objekt(s: JsonSkema): A2uiSkema {
  const ud: Record<string, unknown> = { type: 'object', properties: Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, egenskab(v)])) };
  if (s.required?.length) ud['required'] = [...s.required];
  if (s.additionalProperties === false) ud['additionalProperties'] = false;
  return ud;
}

/** The handling every component may carry (the contract of AGENTS.md §1: instruction plus its undo). */
function handling(): A2uiSkema {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: dyn('DynamicString'),
      instruktion: { ...(dyn('DynamicString') as object), description: BESKRIVELSER.instruktion },
      fortryd: { ...(dyn('DynamicString') as object), description: BESKRIVELSER.fortryd },
      action: { $ref: `${COMMON}#/$defs/Action`, description: BESKRIVELSER.action },
    },
    required: ['id', 'label', 'instruktion', 'action'],
  };
}

const RESERVEREDE = ['id', 'component', 'accessibility', 'zone', 'trin', 'handlinger'];

/** The A2UI catalog of `kilde` (default: the app's own). Pure and deterministic. */
export function tilA2ui(kilde: A2uiKilde = a2uiKilde()): A2uiKatalog {
  const components: Record<string, A2uiSkema> = {};
  for (const b of kilde.blokke) {
    const navn = komponentNavn(b.id);
    if (navn in components) throw new Error(`block ${b.id} is in the catalog twice`);
    const felter = b.felter.properties ?? {};
    const kollision = Object.keys(felter).find((k) => RESERVEREDE.includes(k));
    if (kollision) throw new Error(`block ${b.id}: field "${kollision}" collides with a property every component carries`);
    components[navn] = {
      title: b.navn,
      type: 'object',
      allOf: [
        { $ref: `${COMMON}#/$defs/ComponentCommon` },
        {
          type: 'object',
          properties: {
            component: { const: navn },
            zone: { type: 'string', enum: [...kilde.zoner], description: BESKRIVELSER.zone },
            trin: { type: 'integer', enum: [...kilde.trin], description: BESKRIVELSER.trin },
            ...Object.fromEntries(Object.entries(felter).map(([k, v]) => [k, egenskab(v)])),
            handlinger: { type: 'array', items: { $ref: '#/$defs/Handling' }, description: BESKRIVELSER.handlinger },
          },
          required: ['component', 'zone', 'trin', ...(b.felter.required ?? [])],
        },
      ],
      unevaluatedProperties: false,
    };
  }
  const $defs: Record<string, A2uiSkema> = {
    anyComponent: { oneOf: Object.keys(components).map((n) => ({ $ref: `#/components/${n}` })) },
    // Clawco declares no client-side functions; a surface cannot call any.
    anyFunction: false,
    // Clawco is dark-only and has no theme parameters.
    theme: { type: 'object', properties: {}, additionalProperties: false },
    Handling: handling(),
  };
  for (const [navn, skema] of Object.entries(kilde.delt)) $defs[stor(navn)] = egenskab(skema);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: KATALOG_ID,
    title: 'Clawco',
    description: BESKRIVELSER.katalog,
    catalogId: KATALOG_ID,
    components,
    functions: {},
    $defs,
  };
}

/** The exact text of docs/a2ui/clawco-katalog.json: pretty JSON with a trailing newline. */
export const tilTekst = (k: A2uiKatalog): string => `${JSON.stringify(k, null, 2)}\n`;
