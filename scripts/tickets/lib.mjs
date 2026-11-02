// Pure helpers for the docs/tickets/ work queue. No I/O here — new.mjs and
// check.mjs do the reading and writing. Contract: docs/tickets/README.md.
//
// The ticket id PREFIX is not hardcoded here — it comes from
// docs/tickets/_template.md's `id: XX-0000` line (set once by /metode:init),
// so a project's scripts derive their prefix from a single source instead of
// a second, driftable constant. Callers get it via prefixFromTemplate().

export const STATUSES = ['open', 'in-progress', 'review', 'done', 'parked'];
export const PRIORITIES = ['P1', 'P2', 'P3'];
export const GATES = ['none', 'decision', 'publish'];
export const REQUIRED_SECTIONS = ['## Henriks ord', '## Færdig betyder', '## Log'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string} templateText contents of docs/tickets/_template.md
 * @returns {string} the ticket id prefix, e.g. "AB" from "id: AB-0000"
 */
export function prefixFromTemplate(templateText) {
  const m = /^id:\s*([A-Z]{2,5})-0000\s*$/m.exec(templateText);
  if (!m) {
    throw new Error('docs/tickets/_template.md must have a line "id: XX-0000" (XX = this project\'s ticket prefix)');
  }
  return m[1];
}

function idRe(prefix) { return new RegExp(`^${prefix}-\\d{4}$`); }
function fileRe(prefix) { return new RegExp(`^(${prefix}-\\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`); }

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  return { front: m[1].split(/\r?\n/), body: m[2] };
}

/**
 * @param {string} text
 * @returns {Record<string, any>} frontmatter fields plus `body`; `_error` when malformed
 *
 * Minimal YAML-subset parser: `key: scalar`, `key: []`, and `key:` followed by
 * `  - item` lines. Enough for the ticket contract; tickets must not use
 * anything richer.
 */
export function parseTicket(text) {
  const parts = splitFrontmatter(text);
  /** @type {Record<string, any>} */
  const out = parts
    ? { body: parts.body }
    : { _error: 'missing frontmatter block (--- … ---)', body: text };
  if (!parts) return out;
  let listKey = null;
  for (const raw of parts.front) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey) { out[listKey].push(stripQuotes(item[1])); continue; }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) { out._error = `unparseable frontmatter line: ${raw}`; continue; }
    const [, key, value] = kv;
    if (value === '') { out[key] = []; listKey = key; continue; }
    listKey = null;
    if (value === '[]') { out[key] = []; continue; }
    out[key] = stripQuotes(value);
  }
  return out;
}

function stripQuotes(s) {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/**
 * @param {string} text
 * @param {string} prefix ticket id prefix, from prefixFromTemplate()
 * @param {string} [fileName]
 * @returns {string[]} human-readable problems; empty list = valid
 */
export function validateTicket(text, prefix, fileName) {
  /** @type {string[]} */
  const errors = [];
  const t = parseTicket(text);
  if (t._error) errors.push(t._error);
  const need = (key, ok, hint) => {
    if (t[key] === undefined) errors.push(`missing field "${key}"`);
    else if (!ok(t[key])) errors.push(`invalid ${key}: "${t[key]}" (${hint})`);
  };
  need('id', (v) => idRe(prefix).test(v), `expected ${prefix}-0000 form`);
  need('title', (v) => typeof v === 'string' && v.trim().length > 0, 'non-empty');
  need('status', (v) => STATUSES.includes(v), `one of ${STATUSES.join('|')}`);
  need('priority', (v) => PRIORITIES.includes(v), `one of ${PRIORITIES.join('|')}`);
  need('created', (v) => DATE_RE.test(v), 'YYYY-MM-DD');
  need('updated', (v) => DATE_RE.test(v), 'YYYY-MM-DD');
  need('henrik_gate', (v) => GATES.includes(v), `one of ${GATES.join('|')}`);
  need('links', (v) => Array.isArray(v), 'a YAML list or []');
  if (fileName !== undefined) {
    const fm = fileRe(prefix).exec(fileName);
    if (!fm) errors.push(`file name "${fileName}" must look like ${prefix}-0000-kebab-slug.md`);
    else if (t.id && fm[1] !== t.id) errors.push(`file name id ${fm[1]} disagrees with frontmatter id ${t.id}`);
  }
  if (t.status === 'review' && t.henrik_gate === 'none') {
    errors.push('status review requires henrik_gate: decision|publish (what are they waiting to do?)');
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!t.body.includes(section)) errors.push(`missing body section "${section}"`);
  }
  return errors;
}

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function ticketFileName(id, title) {
  return `${id}-${slugify(title)}.md`;
}

export function nextTicketId(prefix, fileNames) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d{4})-`);
  for (const f of fileNames) {
    const m = re.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
