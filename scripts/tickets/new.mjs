#!/usr/bin/env node
// Usage: node scripts/tickets/new.mjs "<title>" [--priority P1|P2|P3] [--gate none|decision|publish]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES, PRIORITIES, nextTicketId, prefixFromTemplate, ticketFileName, today } from './lib.mjs';
import { ticketFileNamesAcrossRefs } from './git-refs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '..', '..', 'docs', 'tickets');

const templatePath = path.join(DIR, '_template.md');
const templateText = readFileSync(templatePath, 'utf8');
const prefix = prefixFromTemplate(templateText);

const args = process.argv.slice(2);
const flag = (name, allowed, fallback) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : fallback;
  if (!allowed.includes(v)) { console.error(`--${name} must be one of ${allowed.join('|')}`); process.exit(2); }
  return v;
};
const priority = flag('priority', PRIORITIES, 'P2');
const gate = flag('gate', GATES, 'none');
const title = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))).join(' ').trim();
if (!title) { console.error('Usage: node scripts/tickets/new.mjs "<title>" [--priority P2] [--gate none]'); process.exit(2); }

const id = nextTicketId(prefix, ticketFileNamesAcrossRefs(DIR));
const file = path.join(DIR, ticketFileName(id, title));
if (existsSync(file)) { console.error(`refusing to overwrite ${file}`); process.exit(1); }
const date = today();
const body = templateText
  .replace(`id: ${prefix}-0000`, `id: ${id}`)
  .replace('title: <title in your own words>', `title: ${title}`)
  .replace('priority: P2', `priority: ${priority}`)
  .replace('henrik_gate: none', `henrik_gate: ${gate}`)
  .replace('created: 0000-00-00', `created: ${date}`)
  .replace('updated: 0000-00-00', `updated: ${date}`)
  .replace('- 0000-00-00 — created from chat.', `- ${date} — created from chat.`);
writeFileSync(file, body);
console.log(path.relative(process.cwd(), file));
