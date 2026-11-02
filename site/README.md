# site/ — clawco.work (KC-0164)

Static files only: no framework, no bundler, no server-side code, no analytics, no cookies, no
third-party request (system fonts, scripts and images come from the site itself). `_headers` adds a
content-security policy that forbids everything else, so a stray third-party reference fails in the browser too.

## Files

- `index.html`, `install.html`, `docs/*.html`: the pages. English text is written in the HTML; every visible
  string also lives in `strings.js` (English and Danish, keyed by id). `test/site.test.ts` fails when a key is
  missing in a language, a page uses an unknown key, or the English HTML differs from the table.
- `site.js`: the language toggle (`?lang=da`, remembered in `localStorage` only) and the copy button.
  `TAGLINE_DEFAULT` picks the hero headline (1 or 2); `?tagline=2` shows the other one on a preview.
- `billeder/`: real screenshots from the app's test world (fictional data, dark, phone width, WebP), under 1.5 MB in total.
- `install.sh` is not kept here: the build copies `deploy/install.sh` byte-identically.
- `egen-sky/hetzner.sh` is not kept here either (KC-0171): the build copies `deploy/egen-sky/hetzner.sh` byte-identically; the install page's "Run it in your own cloud" section links it.
- Source links point at the public mirror https://github.com/SlambertDK/clawco (KC-0228), the repository install.sh clones.

## The legal pages (KC-0204)

`/vilkaar`, `/privatliv`, `/databehandler`, `/cookies`, `/underdatabehandlere` and `/sletning-og-eksport` (Danish) and the
same under `/en/` are not files here: `scripts/site-byg.mjs` renders them from `docs/legal/*.md` with `scripts/juridisk.ts`
(plus the indexes `/juridisk` and `/legal`). Each text starts with frontmatter (`version`, `dato`, `status`, `sprog`);
the Danish and the English file of one document must agree on the first three. `status: udkast` shows the red "UDKAST —
ikke endeligt" banner, `status: laest` (read by the owner) the "Udkast — læst af ejeren, ikke endeligt" banner; both keep
the page out of search and the sitemap (only `udgivet` is indexed); the build fails when a text with
`status: udgivet` still contains `[Selskab]`, `[CVR]` or UDKAST. Every page names the SHA-256 of its source file
(`<meta name="clawco-kilde">`), checked again at the end of the build.

Changing a text: copy the current files to `docs/legal/arkiv/<fil>.<sprog>.<old version>.md` first (they get a page under
`/<sti>/v<version>` and the "earlier versions" list), then edit the text and raise `version` in both languages. Sky reads
the same `version` from `docs/legal/vilkaar.da.md` and `privatlivspolitik.da.md`, so every account is asked to accept
again; restart Sky after the deploy (it reads the versions at start).

## The documentation pages (KC-0165)

`docs/*.html` and `install.html`: install (Mac/Linux, Docker, backup and restore, laptop mode), `sources`, `trust-ladder`,
`household` and `security`. Invariant: a page documents only what is built and verified; an unbuilt feature is absent, not
"coming soon" (Sky's invitations by mail, a Danish source pack, per-platform guides and comparison pages are absent for that reason).
`test/docs.test.ts` derives every name from the code (rooms from `src/rooms/registry.ts`, blocks from `src/shell/katalog.ts`, connectors
as `main()` composes them, trust levels and limits from `src/tillid/trin.ts`, roles, zones, npm scripts) and compares the commands with
`install.sh --help`/`--dry-run` and `scripts/arkiv.mjs`; names are marked in the HTML (`data-rum`, `data-blok`, `data-kilde`, `data-trin`,
`data-graense`, `data-rolle`, `data-host`). The data-flow list on the security page must equal the outside hosts written in `src/`.
Every documentation page ends with `docs.checked`, the date it was last checked against the code: when you change what a page
describes, re-read the page and move the date (one key, so every page moves together only when all were re-read).

## The help pages and security.txt (KC-0201)

`/hjaelp` (the index), `/hjaelp/<article>` (eight articles) and `/hjaelp/security-report` are plain files here, English in the HTML and
both languages in `strings.js` like every other page; no form, no cookie, one mailbox. The mailbox and the response times
live in `config/hjaelp.json` (the account app reads the same file); `test/site-hjaelp.test.ts` fails when the site says anything else.
An article may only say what the code does: each step names the route it uses (`data-route`, checked against the routes in `sky/src`
and `src`), each quoted button the label the code holds (`data-etiket`), and the claims about what is not built (support look-along,
lock on a lapsed payment, import of clawco.zip) fail their test the day someone builds it, which is the cue to rewrite the article.
`/.well-known/security.txt` (RFC 9116) expires on the date in the file; the test fails 30 days before, so move `Expires` out (at most a
year ahead) and redeploy. A dot folder is copied by the build like any other; the test builds the site and checks it arrived.

## The price page (KC-0199)

`/priser` is not a file here: `scripts/site-byg.mjs` renders it from `site/priser.template.html` and `config/priser.json`
(`scripts/priser-side.ts`), the same file Stripe is set up from, so no amount is typed into the page or into `strings.js`
and the yearly saving is computed (12 x monthly minus yearly). Every amount sits in a `<span class="amt" data-minor="…">`;
`site.js` only picks which currency and interval are shown (default currency from the browser language, never an IP lookup)
and formats the amount for the language. Without a script every currency and interval is visible. The texts are the `pr.*`
keys in `strings.js`; a plan or add-on in the config that has no `pr.plan.<id>.*` / `pr.addon.<id>.*` words stops the build.
The three limits are `sec.three.p`, the security page's own key, never a copy.

The normal build **leaves the page out**, so a plain build and deploy cannot publish it:

```bash
node scripts/site-byg.mjs --preview   # include priser.html; the red draft banner and noindex while config status is "udkast"
node scripts/site-byg.mjs --live      # the publish build: refuses (exit 1, KC-0169) while the status is "udkast"; adds /priser to the sitemap
```

Publishing the page is Henrik's yes (status `godkendt` in the config is gate G5 only): build with `--live`, then deploy as below.
Before that, re-read the copy that states what exists today (the backups line says they are not switched on in the closed beta,
`pr.sky.f3`; sign-up is by invitation in the closed beta) and add `/priser` to the footer or the nav of the other pages.

## Build and check

```bash
node scripts/site-byg.mjs            # copies site/ + deploy/install.sh into .site-ud/ (gitignored), checks the hash
node --test test/site.test.ts
```

## Deploy (Cloudflare Pages, production on clawco.work since 2026-11-02)

```bash
npx wrangler pages deploy .site-ud --project-name clawco-site --branch main      # production: https://clawco.work
npx wrangler pages deploy .site-ud --project-name clawco-site --branch preview   # preview: noindex
```

Free tier, static assets, honours `_headers`. `clawco.work` is the project's custom domain (apex CNAME to
`clawco-site.pages.dev`, proxied, KC-0164); wrangler needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in its env. After a deploy, check the live file: the SHA-256 of `https://<preview>/install.sh`
must equal the SHA-256 of `deploy/install.sh` (the build prints it).

## Regenerating the screenshots

Start `npm run dev`, open the test world (cookie `kc_test=1`, `POST /test/taend`, then `POST /test/moment/<id>`),
screenshot at 375 px wide, dark, device scale 2, with the test bar and the chat button hidden, and convert with
`cwebp -q 84`. Never use real data.
