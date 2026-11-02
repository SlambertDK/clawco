// KC-0207: the status page templates of the breach plan (docs/beredskab/skabeloner/statusside.*.md) are texts for
// sky/scripts/haendelse.mjs. Invariant: once their placeholders are filled in with plain words, the incident rules of the
// status feed (tjekHaendelse) accept them, so the text written in the middle of an incident is never refused for form.
// The files are only read here (no import across the Sky boundary, sky/test/aftryk.test.ts); the main tests of the
// plan are test/beredskab.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tjekHaendelse } from '../../../src/drift/helbred/haendelse.ts';

const mappe = new URL('../../../../docs/beredskab/skabeloner/', import.meta.url);

/** The text under a `## ` heading (to the next one), trimmed. */
function afsnit(md: string, titel: string): string {
  const linjer = md.split('\n');
  const i = linjer.findIndex((l) => l === `## ${titel}`);
  if (i < 0) return '';
  const j = linjer.findIndex((l, k) => k > i && l.startsWith('## '));
  return linjer.slice(i + 1, j < 0 ? undefined : j).join('\n').trim();
}

for (const [fil, titel, tekst] of [['statusside.da.md', 'Titel', 'Tekst'], ['statusside.en.md', 'Title', 'Text']] as const) {
  test(`${fil}: filled in with plain words, the title and text pass the status feed's incident rules`, () => {
    const md = readFileSync(new URL(fil, mappe), 'utf8');
    const fyld = (s: string): string => s.replace(/\[[A-Z0-9-]+\]/g, 'noget');
    const h = { titel: fyld(afsnit(md, titel)), tekst: fyld(afsnit(md, tekst)), start: new Date('2026-11-02T10:00:00Z'), slut: null };
    assert.ok(h.titel && h.tekst, 'both sections are needed');
    assert.equal(tjekHaendelse(h), null);
  });
}
