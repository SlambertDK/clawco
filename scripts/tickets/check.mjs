#!/usr/bin/env node
// Usage: node scripts/tickets/check.mjs — validates every ticket (exit 1 on any
// problem) and prints a compact board: status → id · priority · [gate] · title.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUSES, parseTicket, prefixFromTemplate, validateTicket } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '..', '..', 'docs', 'tickets');
if (!existsSync(DIR)) {
  // A checkout without the queue (the public mirror, KC-0228) has nothing to check.
  console.log('no ticket queue in this checkout (docs/tickets/), nothing to check');
  process.exit(0);
}

const prefix = prefixFromTemplate(readFileSync(path.join(DIR, '_template.md'), 'utf8'));
if (prefix === 'XX') {
  console.error('docs/tickets/_template.md still has the placeholder prefix XX — run /metode:init (or set a real prefix) first.');
  process.exit(1);
}
const fileRe = new RegExp(`^${prefix}-\\d{4}-.*\\.md$`);
const files = readdirSync(DIR).filter((f) => fileRe.test(f)).sort();

let problems = 0;
const byStatus = Object.fromEntries(STATUSES.map((s) => [s, []]));
const seen = new Set();
for (const f of files) {
  const text = readFileSync(path.join(DIR, f), 'utf8');
  const errors = validateTicket(text, prefix, f);
  const t = parseTicket(text);
  if (t.id && seen.has(t.id)) errors.push(`duplicate id ${t.id}`);
  seen.add(t.id);
  for (const e of errors) { console.error(`✗ ${f}: ${e}`); problems++; }
  if (errors.length === 0) {
    const gate = t.henrik_gate !== 'none' ? `[gate:${t.henrik_gate}] ` : '';
    byStatus[t.status].push(`${t.id} ${t.priority} ${gate}${t.title}`);
  }
}
for (const s of STATUSES) {
  if (byStatus[s].length === 0) continue;
  console.log(`\n${s} (${byStatus[s].length})`);
  for (const line of byStatus[s].sort()) console.log(`  ${line}`);
}
console.log(`\n${files.length} tickets, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
