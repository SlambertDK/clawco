# Clawco threat model (KC-0125)

> Written for the person who connects things and the agent that builds them. English like the other specs. Source
> intent: `2026-10-31-clawco-produkt-design.md` §5 and D5–D7, ticket KC-0125 (E7 "secret handling review" and
> "written threat model"). Claims are labelled **VERIFIED** (read in code or run), **REASONED**, or **ASSUMED**.
> `test/graenser/trusselsmodel.test.ts` fails when a registered connector has no row below.

## Why this exists

An agent that can read private data, read text an outsider wrote, and talk to the outside can be talked into
sending the private data out. Every connection Clawco adds gives the agent one or more of those three legs. The
rule of this document is that **no surface may hold all three without a control that cuts one of them**, and that
every new surface says which leg it cuts before it is connected.

Why Clawco takes it seriously: the spec cites the February 2026 inbox incident (D5: limits live in code, not in the
prompt) and the prompt-injection cases against Gemini, Copilot and Comet (D6: everything the agent reads is data).
This document adds no detail to those cases beyond what the spec says.

## Assets

| Asset | Where | What protects it |
|---|---|---|
| The user folder `$KC_DATA_DIR` (room state, logs, chats, settings, audit log, `kilder.json`) | one host, never in the image | Tailscale-only (or the Sky gateway), loopback app, owner/member/guest roles (`src/identitet/`), data zones |
| The vault (notes, people register, rules `Clawco/regler.md`) | host or NAS mount | same; written only by the notes connector and Skrive/Nyheder "Gem" (no agent involved) |
| Secrets: `.env` on the host, `hemmeligheder/<kilde>.json` (`0600`), `hemmeligheder.enc` (AES-256-GCM, key delivered by Sky onto a tmpfs), `KC_MODEL_NOEGLE_<UDBYDER>`, the agent's own env file | host only | `src/kilder/hemmeligheder.ts` (one writer), `src/hemmeligheder/lager-fil.ts`, the redactor `src/graenser/redaktion.ts`; out of the export (KC-0108/0146); `npm run hemmeligheder` prints names and lengths only |
| The agent's tools (Hermes: terminal, web, mail CLI, schedules) | Hermes gateway on the host | policy layer (below) — **detective, not preventive** (see ASSUMED 1) |
| Henrik's accounts behind the connectors (mail, calendar) | third parties | read-only scopes, per-verb allowlists, no send, no delete |

## Actors

| Actor | Capability assumed | Main concern |
|---|---|---|
| A hostile sender | can put any text in a mail, an invite, a feed item, a shared note, an imported file | prompt injection: an instruction hidden in data |
| A hostile web page | can put any text where the agent's web tool fetches it | the same, plus exfiltration by URL |
| A household member | has a login (member role), can write requests and chat | reading another zone, sending under someone else's name |
| A curious guest | a guest-role login or a shared screen | seeing owner-only data; nothing else |
| A compromised model provider | sees every prompt and answer sent to it; can return anything | data exposure by design, and hostile output (a "rule", a button) |
| A stolen device on the tailnet | a tailnet node that is not the owner's | reaching the app at all |

## Trust boundaries

1. **Tailnet → Tailscale Serve → loopback app.** The app listens on loopback only; Serve adds identity headers
   (`tailnet` mode). In `konto` mode (KC-0179) only a request carrying the Clawco-Konto header signed (Ed25519) by the
   Sky gateway and arriving from the one configured gateway address counts. VERIFIED (code and tests, KC-0179).
2. **App → agent.** Every request passes `src/runs.ts`, which masks secret values in what is sent and in what comes
   back, and watches every `tool.started` (detective control, `src/graenser/opsyn.ts`).
3. **App → connectors.** `src/kilder/` is the only place that holds a connector credential; a connector reads under
   `read()` and can only act through verbs it declared, each with a policy verb (`src/graenser/verber.ts`); the verbs
   `betal`, `send-til-andre`, `slet`, `kopier-paa-tvaers` are refused at registration.
4. **Data → prompt.** `src/agent/prompt.ts` + `udtroet.ts` (KC-0123): everything not typed by the owner is wrapped as
   untrusted data with a random per-run boundary; the instructions say that it is data.
5. **Agent output → state.** Answers are validated against the room's schema (`rooms/*/schema.ts`); a handling an
   agent proposes passes `afgoer` with a verb the app sets (a model can only raise a denial, never lift one); rule
   creation always needs a human tap (`src/graenser/tegn.ts`); every decision lands in the audit log (KC-0124).
6. **App → people.** Nothing is sent to another person from the app in v1; there is no outbound channel. Drafts are
   `APPEND`ed to a Drafts folder and wait for the owner.

## Controls referenced in the table

| Code | Control | Cuts which leg |
|---|---|---|
| Z (KC-0117) | A run reads exactly one data zone (privat / arbejde / husstand); an element naming another zone is rejected; no cross-zone copy | private data (blast radius) |
| P (KC-0122) | Policy layer: every handling gets a verb from the app and passes `afgoer`; `send-til-andre`, `slet`, `betal` need a human tap token; the detective control aborts a run whose tool reaches past the verb | external communication |
| W (KC-0123) | Untrusted-content wrapping, random boundary, `utroet` / `afledt` tags | untrusted content (it becomes data, not instructions) |
| N (v1) | No outbound channel in v1: no send, no post, no webhooks from the app — with one exception since KC-0153: the go-between's Send to a household member's own channel, only on a human tap (row `husstand-kanal`) | external communication |
| R | Read-only connection: read-only scope or read-only wire command allowlist, no declared verbs | external communication, and no write-back of injected text |
| K (KC-0124) | Kill switch ("Stop alt") and the append-only audit log | none; limits damage and gives evidence |
| S (KC-0125) | Secret masking by value in every request, answer, error and log line | the secret never travels with the data |

## Per-connector table

Columns: the surface; the **private data** it can reach; the **untrusted content** it brings in; the **external
communication** reachable from a run that reads it; which **leg is cut**; the **controls** (codes above).

| Surface | Private data | Untrusted content | External communication | Leg cut | Controls |
|---|---|---|---|---|---|
| `kira-mail` (Proton Bridge via himalaya, Henrik's install) | the mailbox; the app reads envelopes read-only, Hermes may run himalaya for moves and drafts | every mail body and subject | Hermes' terminal could in principle send (`himalaya message send`) or fetch a URL | **partly**: send is cut only by the detective control (a terminal command matching send aborts the run unless the verb is `send-til-andre`); nothing in v1 cuts web fetch | P (detective, residual risk 1), W, Z, N, K; the app's own read is `himalaya envelope list` only |
| `mail-imap` (any IMAP account: Proton Bridge, Fastmail, iCloud, Gmail app password, other) | envelopes (never a body) of the account; the app password in `hemmeligheder/mail-imap.json` | envelope text: sender, subject | none in the connector: `EXAMINE` plus a wire-level command allowlist; the write verbs are `flyt` (sorter: `UID MOVE` inside the account, never to Trash or Junk, never creates a folder) and `kladde` (forbered: `APPEND` a reply to Drafts, header-injection safe); no `SMTP`, no delete, no expunge (KC-0214) | **external communication** (and bodies are never read, so the untrusted leg is thin) | R, P (verbs `sorter`, `forbered` only), W, Z, S; TLS always verified except Bridge's self-signed certificate on a loopback IP, pinned by fingerprint on first connect |
| `mail-gmail` (Gmail through "Log ind med Google", KC-0135: the generic IMAP reader over XOAUTH2) | envelopes (never a body) of the signed-in Gmail account; the refresh token and the account's address in `hemmeligheder/mail-gmail.json`, the install's own OAuth client in the env file (shared with `google-kalender`); the access token lives in memory only | envelope text: sender, subject | none: no verbs, no `act()`, `EXAMINE` plus the wire-level command allowlist of `mail-imap` (re-run on the XOAUTH2 path in `test/kilder/mail-gmail/xoauth2.test.ts`), no `SMTP`, no delete, no expunge. The scope `https://mail.google.com/` is full access in Google's own wording (it can read, send and delete); Google has no narrower scope for IMAP, so what stops writing is our code, not the grant — a stolen refresh token would be full Gmail access (residual risk, ASSUMED unverifiable from here) | **external communication** (and bodies are never read, so the untrusted leg is thin) | R (our own guard, not the scope), W, Z, S; TLS always verified (`imap.gmail.com`); a refused grant or login reads as `log-ind-igen`, never retried; the card says plainly that Google calls it full access |
| `google-kalender` | the calendars of the signed-in Google account, next seven days; the refresh token in `hemmeligheder/google-kalender.json`, the install's own OAuth client in the env file | invite titles, descriptions, attendee names (an invite is written by someone else) | none: scope `calendar.readonly`, no verbs, no `act()`; the connector cannot create, edit or answer an event | **external communication** | R, W, Z, S; the access token lives in memory only |
| `kira-kalender` | the calendar script's seven days (Kira's Google token script, host-only) | event titles and descriptions | none: read-only script, no verbs | **external communication** | R, W, Z |
| `kira-morgenavis` | none of the owner's private data beyond which feeds he follows | the morning paper's items: headlines and summaries from feeds (RSS and similar), written by publishers | none from the connector; Hermes' web tool exists on the host | **private data** (the paper holds public text) | W, Z, R |
| `nyheder-rss` (the user's own feeds, pasted or from OPML; KC-0137) | none of the owner's private data beyond which feeds he follows (the list in `kilder.json`); no credentials: a feed address with a user name or password is refused | the feeds' items: headlines and summaries written by publishers, plus the pages the user pasted (searched for a feed link) | none from a run that reads it; the fetch itself is the connector's only outbound call, and its address is chosen by the user or by a feed or page: http(s) only, no credentials, link-local and metadata addresses refused on every hop, loopback and LAN only for an address the user pasted (never for an OPML entry, a discovered link or a redirect), the host resolved once and the connection pinned to the address that was checked, 3 redirects, 10 s, 2 MB (also decompressed), 2 requests per host; no `act()`, no verbs | **private data** (the paper holds public text); the one outbound leg is the fetch, cut by the address guard | W, Z, R; text cleaned to plain text (markup, scripts, entities) and URLs to http(s) before anything reaches a model or the page; documents that declare XML entities are refused |
| `kira-noter` | the NAS vault (notes, people register) | notes the owner imported or clipped, including ChatGPT and Takeout exports, are untrusted text | none in the connector (no `act()`); writing back goes through Skrive "Gem i Obsidian", which involves no agent | **external communication** | R, W, Z |
| `beskeder` (messages that reach Hermes on Telegram, WhatsApp or Signal, KC-0138; Path B: Hermes' gateway hook `deploy/hermes/beskeder-hook.py` appends to `$KC_DATA_DIR/beskeder/indgaaende.jsonl`) | the messages of the conversations the user chose on the card, kept in `beskeder-clawco/laest.json` for 14 days (`KC_BESKEDER_DAGE`); un-chosen conversations are never shaped or stored, un-choosing deletes their cached messages; the hook's own log holds every message that reached Hermes and is the user's (outside Clawco's retention); senders mapped to the people register, phone numbers, platform ids and handles stripped from every card, read and prompt | every message: third parties write it, and it is the strongest injection channel (anyone allowed to write to Hermes' bot or number) | none in the connector: no verbs, no `act()`, it reads a local file only; a Kuratoren card built on a message never carries a handling (dropped at parse) and its sender line is the app's, not Hermes'; sending to people is E5 (KC-0109) behind the policy layer | **external communication** | R, W, Z (only `privat` conversations reach the privat Kuratoren run), P; what Hermes itself can see is set by the gateway's own allowlists, not by Clawco (findings: `2026-11-01-beskeder-gateway-fund.md`) |
| `noter` (a notes folder chosen on the card) | the chosen folder | its files, same as `kira-noter` | none: reads files; the connector may create the app's own folder structure and rules file in the chosen folder, no agent | **external communication** | R, W, Z |
| `falsk-*` (the fake connectors) | none: invented data from the test world | invented text | none; refused beside the real agent (KC-0128: `KC_KILDER_MODE=fake` requires `KC_AGENT=fake`) | **private data** (there is none) | exists only in dev and the test world |

## Surfaces that are not connectors

Same columns. These have a row because they bring text in or let something out.

| Surface | Private data | Untrusted content | External communication | Leg cut | Controls |
|---|---|---|---|---|---|
| `hermes-gateway` (messages through Hermes' gateway channels: Telegram, WhatsApp, Signal, SMS; the go-between to household members, D8) | the household week and requests the agent can see | every inbound message; the go-between is an external channel run by a third party | the channel itself is an outbound route; the agent's own `send_message` tool can reach it in any run | **external communication** for the app: its only send is the go-between's (row `husstand-kanal`), behind a human tap; the agent's own tool is cut only by the detective control | P (detective for the agent's tool), W, Z (husstand zone only), K. Inbound reaches the app only through the hook log (`beskeder`, `husstand-kanal`) |
| `husstand-kanal` (KC-0153, the go-between: a request sent as a message to a household member who installs nothing, and her reply read back; `src/hushold/kanal.ts`, `svar.ts`; outbound `hermes send --to <kanal>:<id> --file -`, no model; inbound from the hook's `indgaaende.jsonl`, spike in `2026-11-01-beskeder-gateway-fund.md` §5) | the member's handle (a Telegram chat id or a phone number) on the member in Husstanden's state; the request's title and time go to the channel's operator (Telegram, Meta, Signal) | every reply she writes, and anything a stranger sends to Hermes' bot or number | **yes, by design: messages to another person.** Only `POST /api/hushold/foresp/:id/send`, verb `send-til-andre`, with a one-time human-tap token bound to the request, the kind and a hash of the exact text shown (never by voice, chat or a clock; the scheduler's deps hold no send at all, `test/server-foresp-send.test.ts`); the text is built by the app from the request, `MEDIA:` and `[[` neutralised and refused; only a validated numeric id or E.164 number is passed (never a name the gateway would look up); opt-in: nothing before her first "ja" but the invitation (KC-0154), nothing after "stop"; one message and one reminder per request | **untrusted content**: a reply acts only when it is exactly `ja`, `nej` or `kl hh[:mm]` from her registered handle in a direct chat, for the one open request sent to her there (state machine `af` = her, `via: 'kanal'`); anything else is an escaped text line that never acts (data, never instructions); a stranger, a group or the wrong channel is ignored and never stored | P, W (text escaped, never in a prompt), Z (husstand), K; residual: Hermes also runs its own agent turn on her reply (gateway side, follow-up) and a WhatsApp privacy `@lid` id does not match her number |
| `husstand-invitation` (KC-0154: the owner invites a person — own entry by tailnet login, or phone only on the go-between's channel; `src/hushold/invitation.ts`, `rettigheder.ts`) | the invitee's tailnet login (husstand.json) or her channel handle (the room's state); the first message carries the owner's and her first names to the channel's operator | the name and handle the owner types (validated: a name of at most 80 characters without control characters, `gyldigHandle`); her later replies are `husstand-kanal`'s | **yes, one message: the invitation.** Only `POST /api/hushold/medlem/:id/inviter`, verb `send-til-andre`, a one-time human-tap token bound to the member and a hash of the exact first message shown (KC-0153's mechanism, slags `invitation`); the text is built by the app (`MEDIA:` and `[[` neutralised); `maaSende(…, 'invitation')`: once, only while she has not answered; the owner only; no clock path (`test/hushold/invitation.test.ts`). An own entry sends nothing: the owner shares the machine in Tailscale's admin himself (§9) | **external communication** is limited to that one message per invitee; no account, password or token of Clawco's own is created; a login the household does not know gets the plain "Du er ikke inviteret endnu" page with no data | P, W (names escaped), Z (husstand), K; roles and removal are the owner's only, removal (verb `slet`, the red yes) ends her entry and channel |
| `husstandsforespoergsler` (household requests, KC-0149/0150: text from one member to another) | the other member's shared week | the request text and any alternative a member writes | none: the state machine moves only on a party's tap; Hermes only writes suggestions beside the state | **external communication** (and Hermes cannot transition a request) | W (member text is `utroet`), Z (husstand zone only), P, K |
| `import` (Start step 5, KC-0129: pasted text and uploads from other assistants and exports) | the profile and register it proposes changes to | all of it: pasted text, files, contacts | none | **external communication**; also the output schema has no field for a rule or a handling, so an imported "forward all my mail" can only become profile text the owner reads and may delete | W, schema validation field by field, the diff is a proposal never a merge, Z (`privat`) |
| `stemme` (voice: ElevenLabs Scribe, Flash, Agents platform) | the spoken overview (a cross-room summary) is sent to the vendor | speech transcribed to text is the owner's own typed-equivalent; background speech is not distinguished | **yes, by design**: audio and the overview go to ElevenLabs through our server; the key never reaches the browser | none of the three; the exposure is to the vendor the owner chose | the Samtale agent runs only ids from the spoken overview, which never contains Send (AGENTS.md §9); P, S; residual risk 4 |
| `agent-vaerktoejer` (the agent's own tools on Hermes: terminal, web fetch, web search, schedules) | whatever the Hermes host can read | every fetched web page | web fetch and terminal reach the internet | **none cut by construction** in v1; only the verbs `send` and `delete` and a list of forbidden tools are caught, after the tool has started | P (detective control, `opsyn.ts`), W, Z, K; residual risk 1 and ASSUMED 1 |
| `sky-gateway` (Clawco Sky edge, KC-0179) | tenant traffic in transit | any request from the internet that reaches the gateway | the gateway forwards to the tenant only | **untrusted content** is not interpreted at the edge; the tenant accepts only the signed header from the pinned gateway address | Ed25519 signature check (a second key while the gateway's key rotates), one gateway address, fail-closed start on a missing or invalid key; the tenant holds only the gateway's public key |
| `direkte-agent` (`KC_AGENT=direkte`, KC-0180: no Hermes, one HTTP call per run to the chosen model provider) | everything the prompt contains goes to the provider | the wrapped data in the prompt | none of its own: **no tools**, it never emits `tool.*` events | **external communication** (no tools to call out with) | W, Z, S (the model key in `hemmeligheder.enc` when `KC_HEMMELIGHEDER_FIL` is set, never in an image; a provider error body only picks the kind of error, the message is a fixed sentence because a body can echo a key fragment); the provider sees the prompt (actor: compromised model provider) |
| `skrive-nyheder-vault` ("Gem i Obsidian" and "Gem til senere" write markdown into `KC_VAULT_INBOX`) | the note text | the text may have been derived from untrusted reads | none: a file write on the host, no agent | **external communication** | N; no Hermes involved; text goes through the escaper before display (§4 r9) |

## Residual risks

1. **Hermes' tools are not limited by the app before they run.** `/v1/runs` chooses its own tools from the gateway
   config; Clawco can only abort a run after `tool.started`. Terminal and web fetch remain able to exfiltrate over
   the network before an abort, and a truncated command preview can hide a send. Mitigation in v1 is the audit log,
   the kill switch and the narrow zone per run; the real fix is a Hermes toolset per run or a proxy that Clawco
   controls.
2. **Wrapping is a convention the model may ignore.** The wrapper marks data; it cannot force the model to obey. A
   successful injection can still change what is *written into room state* (a misleading card). It cannot lift a
   verb, create a rule or press a button; that is the point of D5.
3. **Secret masking is by value.** A secret transformed by the agent (base64, split over two streamed deltas,
   hashed) is not recognised; values below eight characters are not masked (`npm run hemmeligheder` says "for kort").
4. **Model providers and ElevenLabs see what is sent to them.** "Local model" is the only way for data not to leave
   the machine (VISION: "Mine data, mit valg af model"). The voice path always leaves the machine.
5. **A stolen tailnet node or a stolen laptop is a stolen account.** There are no per-user passwords on the tailnet
   install; the data folder is not encrypted at rest (out of scope for KC-0125; the key file of a Sky tenant is the
   exception).
6. **A household member reads what the member role may see.** Zones separate the data; roles separate the people;
   nothing separates two members of the same zone.
7. **Sky's own logging is out of this document's reach** (`sky/` is a separate package with its own log lines); a
   Sky log line that could carry a tenant secret must be reviewed with the same rule.

## ASSUMED — verify before relying on it

1. Whether `/v1/runs` can restrict tools per run (KC-0122's question). `src/graenser/opsyn.ts` records that Hermes'
   toolsets come from the gateway config and not per run (checked against hermes-agent on kira-home on 2026-10-31).
   **Re-verify on every Hermes upgrade**; if per-run toolsets arrive, the detective control becomes preventive and
   residual risk 1 shrinks.
2. That the `beskeder` connector, when it is built, can be limited to the husstand zone and to read-only.
3. That a provider's error body never carries more than a key fragment (the direct agent already discards bodies;
   Hermes' own error messages are masked by value, not by shape).
4. That the previews in `tool.started` events are complete enough for the send/delete patterns to catch real calls.

## Review rule

- A new connector or agent tool updates the per-connector table **in the same PR** (AGENTS.md §4 rule 12); the test
  above fails the build otherwise.
- A row says, in this order: what private data it reaches, what untrusted content it brings, what can leave, which
  leg is cut and by which control. A row with no cut leg is a blocker, not a note.
- Re-read this document when a control changes (zones, policy, wrapping), when Hermes is upgraded, and when a new
  actor appears (a new login type, a new channel).
- Real secrets are rotated by the owner (`§0 r1`); nothing here automates it.
