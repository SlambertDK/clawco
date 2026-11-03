// The page skeleton and stylesheet every Sky page shares (konto KC-0177, abonnement KC-0191): dark
// is the default and only theme, the CSP allows no inline style or script, so the CSS is served as
// /sky.css and scripts are files.
import { html, raw, type Markup } from './html.ts';

const PRODUKT = 'Clawco';

/** Served as /sky.css (the CSP allows no inline style). Dark is the default and only theme. */
export const CSS = `:root { color-scheme: dark; --bg: #0f1115; --flade: #171a21; --kant: #2a2f3a; --tekst: #e7e9ee; --daempet: #9aa3b2; --accent: #7aa2ff; --fare: #ff7a7a; }
* { box-sizing: border-box; }
body { margin: 0; background: #0f1115; color: var(--tekst); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 16px; border-bottom: 1px solid var(--kant); font-weight: 600; }
main { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 12px; }
h2 { font-size: 1.1rem; margin: 28px 0 8px; }
p, li { color: var(--tekst); }
.daempet, small { color: var(--daempet); }
a { color: var(--accent); }
section, .kort { background: var(--flade); border: 1px solid var(--kant); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
ul.liste { list-style: none; padding: 0; margin: 0; }
ul.liste li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--kant); flex-wrap: wrap; }
ul.liste li:first-child { border-top: 0; }
label { display: block; margin: 12px 0 4px; color: var(--daempet); }
input[type=email], input[type=text] { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--kant); background: #0b0d11; color: var(--tekst); font: inherit; }
button { font: inherit; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--kant); background: #222837; color: var(--tekst); cursor: pointer; margin-top: 12px; }
button.primaer { background: var(--accent); color: #0b0d11; border-color: var(--accent); font-weight: 600; }
button.fare { background: transparent; color: var(--fare); border-color: var(--fare); }
button.lille { padding: 4px 10px; margin: 0; }
form.inline { display: inline; margin: 0; }
.status { min-height: 1.5em; color: var(--fare); }
.besked { color: var(--accent); }
fieldset { border: 0; padding: 0; margin: 0; }
legend { color: var(--daempet); margin: 12px 0 4px; padding: 0; }
label.valg { display: flex; gap: 10px; align-items: flex-start; color: var(--tekst); background: var(--flade); border: 1px solid var(--kant); border-radius: 10px; padding: 12px 14px; margin: 8px 0; cursor: pointer; }
label.valg input { margin-top: 5px; accent-color: var(--accent); }
select { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--kant); background: #0b0d11; color: var(--tekst); font: inherit; }
p.kode strong { font: 600 2rem/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.1em; }
input[name=kode] { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.1em; text-transform: uppercase; }
pre.kort { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
a.knap { display: inline-block; text-decoration: none; padding: 10px 16px; border-radius: 8px; margin-top: 12px; }
a.knap.primaer { background: var(--accent); color: #0b0d11; font-weight: 600; }
.trin { color: var(--daempet); font-size: 0.9rem; margin: 0 0 8px; }
.sprogvalg { float: right; font-size: 0.9rem; }
label.flueben { display: flex; gap: 10px; align-items: flex-start; color: var(--tekst); margin: 8px 0; }
label.flueben input { margin-top: 5px; accent-color: var(--accent); }
ol.faser { list-style: none; padding: 0; margin: 0; }
ol.faser li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--kant); color: var(--daempet); }
ol.faser li:first-child { border-top: 0; }
ol.faser li[data-tilstand=faerdig] { color: var(--tekst); }
ol.faser li[data-tilstand=i-gang] { color: var(--accent); font-weight: 600; }
`;

/** The skeleton every account page shares. `csrf` (logged in) goes in a meta tag for konto.js. `sprog` sets
 *  the page language (KC-0198; Danish unless the page says otherwise); `skript` names another script file. */
export function side(titel: string, indhold: Markup, opts: { csrf?: string; script?: boolean; skript?: string; sprog?: 'da' | 'en' } = {}): string {
  return `<!doctype html>\n${html`<html lang="${opts.sprog ?? 'da'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="referrer" content="same-origin">
${opts.csrf ? html`<meta name="csrf" content="${opts.csrf}">` : ''}
<title>${titel} · ${PRODUKT}</title>
<link rel="stylesheet" href="/sky.css">
${opts.script ? raw('<script src="/konto.js" defer></script>') : ''}
${opts.skript ? html`<script src="${opts.skript}" defer></script>` : ''}
</head>
<body>
<header>${PRODUKT}</header>
<main>
${indhold}
</main>
</body>
</html>`}`;
}
