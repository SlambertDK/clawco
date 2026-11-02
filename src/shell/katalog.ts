// KC-0119: the seven blocks — the whole vocabulary of the screen — as data.
// One catalog feeds the renderers (each root carries data-blok="<id>"), the
// prompt (only built blocks are offered to the agent) and a plain JSON Schema
// (2020-12) for later exports (A2UI, KC-0112). Enums come from the code's own
// lists; the visual example is visuel.ts' VISUEL_SKEMA. Anatomy and colour
// rules: KC-0064. forespoergsel (KC-0149) and ressource (KC-0150) are built.

import { BILLEDER, TONER, VISUEL_SKEMA, ZONER, visuelRegler } from './visuel.ts';
import { IKONER } from './ikoner.ts';
import { TILSTANDE } from '../hushold/foresp.ts';
import { SLAGS } from '../hushold/ressource.ts';

/** The subset of JSON Schema the catalog uses (and `passer` checks). */
export type JsonSkema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  enum?: readonly unknown[];
  properties?: Record<string, JsonSkema>;
  required?: readonly string[];
  items?: JsonSkema;
  additionalProperties?: boolean;
  $ref?: string;
  description?: string;
};

export type BlokId = 'kort' | 'beslutning' | 'bunke' | 'ordnet' | 'samtale' | 'forespoergsel' | 'ressource';
export type Blok = { id: BlokId; navn: string; formaal: string; felter: JsonSkema & { type: 'object' }; status: 'bygget' | 'defineret'; anatomi: string; eksempel: unknown };

const tekst = { type: 'string' } as const;
const visuelRef = { $ref: '#/$defs/visuel' } as const;

/** The "visuel" field every element may carry (KC-0060): pictogram, headline, tone, one small picture. */
export const VISUEL_FELT = {
  type: 'object',
  properties: {
    ikon: { type: 'string', enum: Object.keys(IKONER) },
    overskrift: tekst,
    tone: { type: 'string', enum: [...TONER] },
    billede: {
      type: 'object',
      properties: {
        art: { type: 'string', enum: [...BILLEDER] },
        zoner: { type: 'array', items: { type: 'object', properties: { fra: tekst, til: tekst, slags: { type: 'string', enum: [...ZONER] } } } },
      },
      required: ['art'],
    },
  },
  required: ['ikon'],
} satisfies JsonSkema;

const visuelEksempel: unknown = JSON.parse(VISUEL_SKEMA);

export const BLOKKE: readonly Blok[] = [
  {
    id: 'kort', navn: 'Kort', status: 'bygget', anatomi: 'KC-0064: piktogram, overskrift, billede; teksten bag et tryk; én handling',
    formaal: 'Én ting, der kalder på Henrik, med det han skal vide og den ene anbefalede handling.',
    felter: { type: 'object', properties: { titel: tekst, betyder: tekst, anbefaling: tekst, prioritet: { type: 'number' }, visuel: visuelRef }, required: ['titel', 'betyder'] },
    eksempel: { titel: 'Elregningen er steget', betyder: '2.600 kr. over budget i oktober.', anbefaling: 'Tjek aftalen', prioritet: 1, visuel: visuelEksempel },
  },
  {
    id: 'beslutning', navn: 'Beslutning', status: 'bygget', anatomi: 'KC-0064: hvem og hvad øverst, betydning bag et tryk, mulighederne som knapper',
    formaal: 'Noget kun Henrik kan afgøre, med mulighederne som knapper.',
    felter: { type: 'object', properties: { emne: tekst, fra: tekst, resume: tekst, betydning: tekst, frist: tekst, visuel: visuelRef }, required: ['emne', 'fra', 'resume'] },
    eksempel: { emne: 'Tilbud på tag', fra: 'Tømreren', resume: 'Tilbud på 18.400 kr.', betydning: 'Over budget med 2.600 kr.' },
  },
  {
    id: 'bunke', navn: 'Bunke', status: 'bygget', anatomi: 'KC-0064: én linje per ting, én knap per linje, foldet efter de første',
    formaal: 'Mange små ting af samme slags, én knap per linje.',
    felter: { type: 'object', properties: { titel: tekst, elementer: { type: 'array', items: { type: 'object', properties: { tekst, knap: tekst }, required: ['tekst'] } } }, required: ['titel', 'elementer'] },
    eksempel: { titel: 'Til orientering', elementer: [{ tekst: 'Nyhedsbrev fra skolen', knap: 'Færdig' }] },
  },
  {
    id: 'ordnet', navn: 'Ordnet', status: 'bygget', anatomi: 'KC-0064: foldet bånd, tid og linje, Fortryd hvor det kan',
    formaal: 'Det, Hermes har gjort, så Henrik kan se og fortryde det.',
    felter: { type: 'object', properties: { linjer: { type: 'array', items: { type: 'object', properties: { tid: tekst, tekst, fortryd: tekst }, required: ['tid', 'tekst'] } } }, required: ['linjer'] },
    eksempel: { linjer: [{ tid: '2026-10-31T07:05:00.000Z', tekst: 'Byggede Dagen.' }] },
  },
  {
    id: 'samtale', navn: 'Samtale', status: 'bygget', anatomi: 'Chatten ved siden af rummet; tale ind og læs op',
    formaal: 'Henrik spørger, Hermes svarer, om rummet eller det markerede element.',
    felter: { type: 'object', properties: { beskeder: { type: 'array', items: { type: 'object', properties: { fra: { type: 'string', enum: ['henrik', 'hermes'] }, tekst, tid: tekst }, required: ['fra', 'tekst'] } } }, required: ['beskeder'] },
    eksempel: { beskeder: [{ fra: 'henrik', tekst: 'Hvad venter?' }, { fra: 'hermes', tekst: 'To mails.' }] },
  },
  {
    id: 'forespoergsel', navn: 'Forespørgsel', status: 'bygget', anatomi: 'KC-0064/KC-0149: hvem spørger hvem om hvad, tilstandschip, én anbefaling, knapperne; blå kun for den, der skal beslutte',
    formaal: 'Et medlem af husstanden beder et andet om noget; begge ser tilstanden. Kun et menneskes tryk flytter den; Hermes foreslår højst svar.',
    felter: { type: 'object', properties: { titel: tekst, fra: tekst, til: tekst, tilstand: { type: 'string', enum: [...TILSTANDE] }, tid: { type: 'object', properties: { start: tekst, slut: tekst }, required: ['start', 'slut'] }, udloeber: tekst }, required: ['titel', 'fra', 'til', 'tilstand'] },
    eksempel: { titel: 'Kan du tage Nora torsdag?', fra: 'henrik', til: 'maja', tilstand: 'spurgt', udloeber: '2026-11-04T08:00:00.000Z' },
  },
  {
    id: 'ressource', navn: 'Ressource', status: 'bygget', anatomi: 'KC-0109/KC-0150: navn, slags, ejerkreds, de næste bookinger, en lille ugestribe; Book (blå) for en ejer, Spørg en ejer (rød) for andre',
    formaal: 'En fælles ting (fx bilen) med ejere og en kalender; sammenfald bliver en beslutning for de to, der har booket.',
    felter: { type: 'object', properties: { navn: tekst, slags: { type: 'string', enum: [...SLAGS] }, ejere: { type: 'array', items: tekst }, bookinger: { type: 'array', items: { type: 'object', properties: { fra: tekst, til: tekst, hvem: tekst, titel: tekst }, required: ['fra', 'til', 'hvem'] } } }, required: ['navn', 'slags', 'ejere'] },
    eksempel: { navn: 'Den store bil', slags: 'bil', ejere: ['henrik', 'maja'], bookinger: [{ fra: '2026-11-07T08:00:00.000Z', til: '2026-11-07T16:00:00.000Z', hvem: 'maja', titel: 'Til Odense' }] },
  },
];

/** The blocks a renderer draws and the prompt offers. */
export const BYGGET: readonly BlokId[] = BLOKKE.filter((b) => b.status === 'bygget').map((b) => b.id);

/** One JSON Schema (2020-12) document: each block under $defs, plus the visual field. */
export function tilJsonSkema(): { $schema: string; $id: string; $defs: Record<string, JsonSkema> } {
  const $defs: Record<string, JsonSkema> = { visuel: VISUEL_FELT };
  for (const b of BLOKKE) $defs[b.id] = { ...b.felter, description: b.formaal };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://clawco.work/skema/blokke.json', $defs };
}

/** Does `v` fit `s`? The subset the catalog uses: type, enum, properties, required, items, additionalProperties, local $ref. */
export function passer(s: JsonSkema | undefined, v: unknown, rod: { $defs: Record<string, JsonSkema> } = tilJsonSkema()): boolean {
  if (!s) return false;
  if (s.$ref) return passer(rod.$defs[s.$ref.replace('#/$defs/', '')], v, rod);
  if (s.enum && !s.enum.includes(v)) return false;
  switch (s.type) {
    case 'string': if (typeof v !== 'string') return false; break;
    case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) return false; break;
    case 'integer': if (!Number.isInteger(v)) return false; break;
    case 'boolean': if (typeof v !== 'boolean') return false; break;
    case 'array': if (!Array.isArray(v) || (s.items && !v.every((x) => passer(s.items, x, rod)))) return false; break;
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      const o = v as Record<string, unknown>;
      if ((s.required ?? []).some((k) => o[k] === undefined)) return false;
      for (const [k, x] of Object.entries(o)) {
        const p = s.properties?.[k];
        if (p ? !passer(p, x, rod) : s.additionalProperties === false) return false;
      }
    }
  }
  return true;
}

/** The catalog section of a prompt: the built blocks and the rules of the visual field. */
export function katalogTekst(): string {
  const linjer = BLOKKE.filter((b) => b.status === 'bygget').map((b) => `- ${b.id}: ${b.formaal}`);
  return `Byggeklodserne (kun disse findes på skærmen):\n${linjer.join('\n')}\n\nFeltet "visuel":\n${visuelRegler()}`;
}
