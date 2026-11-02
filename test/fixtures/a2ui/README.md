# Vendored A2UI schemas (KC-0163)

Copied byte-for-byte on 2026-11-02 so the tests need no network.

- Source: https://github.com/a2ui-project/a2ui (formerly github.com/google/A2UI), directory `specification/v0_9_1/`,
  `main` at commit c1baa4ee9c0cf2241a5b4b666005b62695480519. A2UI v0.9.1 is the current production release; the
  v0.9.1 specification is closed (v1.0 is a draft, v0.8 is legacy).
- Licence: Apache-2.0 (the A2UI repository's LICENSE).
- Files:
  - `common_types.json` ← `specification/v0_9_1/json/common_types.json` (ComponentCommon, Dynamic*, Action, ...)
  - `server_to_client.json` ← `specification/v0_9_1/json/server_to_client.json` (the message envelope; it refers to
    `catalog.json#/$defs/anyComponent`, which the test maps to the catalog under test)
  - `client_capabilities.json` ← `specification/v0_9_1/json/client_capabilities.json` (holds the only official
    "Catalog" definition: the inline-catalog shape)
  - `basic-catalog.json` ← `specification/v0_9_1/catalogs/basic/catalog.json` (the official catalog we follow in form)

There is NO official meta-schema for a catalog file in v0.9.1: the basic catalog is itself a JSON Schema document
(`$id` = `catalogId`, `components`, `functions`, `$defs.anyComponent`, `$defs.theme`), and the protocol document
(`docs/a2ui_protocol.md`, "The component catalog" and "Validator compliance when defining catalogs") states the
rules. `test/a2ui.test.ts` therefore carries a small structural validator for those rules, checked against the
official basic catalog as well, and validates real messages against the vendored envelope schema.
