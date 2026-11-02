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
- Source links point at the public mirror https://github.com/SlambertDK/clawco (KC-0228), the repository install.sh clones.

## The legal pages (KC-0204)

`/vilkaar`, `/privatliv`, `/databehandler`, `/cookies`, `/underdatabehandlere` and `/sletning-og-eksport` (Danish) and the
same under `/en/` are not files here: `scripts/site-byg.mjs` renders them from `docs/legal/*.md` with `scripts/juridisk.ts`
(plus the indexes `/juridisk` and `/legal`). Each text starts with frontmatter (`version`, `dato`, `status`, `sprog`);
the Danish and the English file of one document must agree on the first three. `status: udkast` shows the red "UDKAST,
ikke juridisk gennemgået" banner and keeps the page out of search and the sitemap; the build fails when a text with
`status: udgivet` still contains `[Selskab]`, `[CVR]` or UDKAST. Every page names the SHA-256 of its source file
(`<meta name="clawco-kilde">`), checked again at the end of the build.

Changing a text: copy the current files to `docs/legal/arkiv/<fil>.<sprog>.<old version>.md` first (they get a page under
`/<sti>/v<version>` and the "earlier versions" list), then edit the text and raise `version` in both languages. Sky reads
the same `version` from `docs/legal/vilkaar.da.md` and `privatlivspolitik.da.md`, so every account is asked to accept
again; restart Sky after the deploy (it reads the versions at start).

## Build and check

```bash
node scripts/site-byg.mjs            # copies site/ + deploy/install.sh into .site-ud/ (gitignored), checks the hash
node --test test/site.test.ts
```

## Deploy (Cloudflare Pages, preview only until Henrik says yes)

```bash
npx wrangler pages deploy .site-ud --project-name clawco-site
```

Free tier, static assets, honours `_headers`, and gives a `*.pages.dev` preview URL. The DNS for `clawco.work` is
Henrik's and is not touched. After a deploy, check the live file: the SHA-256 of `https://<preview>/install.sh`
must equal the SHA-256 of `deploy/install.sh` (the build prints it).

## Regenerating the screenshots

Start `npm run dev`, open the test world (cookie `kc_test=1`, `POST /test/taend`, then `POST /test/moment/<id>`),
screenshot at 375 px wide, dark, device scale 2, with the test bar and the chat button hidden, and convert with
`cwebp -q 84`. Never use real data.
