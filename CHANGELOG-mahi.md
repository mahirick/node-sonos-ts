# Changelog — Mahisoft fork

Changes in this fork relative to upstream `@svrooij/sonos` v2.5.0. Mahi releases are
tagged `v2.5.0-mahi.X`. The **public API is unchanged**; the observable output of the UPnP
parse paths is reproduced exactly and locked by the firmware-tripwire suite.

## v2.5.0-mahi.1 — 2026-06-26

Modernized the EOL dependency stack (Stage 2) and added a firmware-tripwire regression net
(Stage 3). Gate: **333 tests (324 pass + 9 skip) 0 fail**; coverage 83.2% stmts / 80.4% br;
`npm run build` (lib/) clean. `npm audit` **51 → 2** (both dev-only moderate).

### Dependencies (shipped runtime)

- **fast-xml-parser 3.19.0 → 4.5.6** — breaking v3→v4 API (`parse()` → `new XMLParser()`).
  All 7 call sites centralized through `XmlHelper.parse()` with options pinned to reproduce
  v3 output exactly (`processEntities:false`, `parseAttributeValue:false`, `parseTagValue:true`,
  per-site `ignoreAttributes` / `removeNSPrefix`). Album-art + track URIs stay byte-exact
  strings (no number-coercion / entity-mangling).
- **node-fetch → native global `fetch`** (undici). **Requires Node ≥ 18.** The 4 SOAP/event
  request timeouts became `AbortSignal.timeout()` (native fetch ignores `{timeout}`).
  ⚠️ **Behavior change:** a request timeout now rejects `DOMException 'TimeoutError'` (was
  node-fetch `FetchError` type `request-timeout`); a network failure throws `TypeError`. Both
  are wrapped by the lib's `EventsError`/`HttpError`, so generic catches are insulated.
- **guid-typescript → `crypto.randomUUID()`** — removed an unmaintained dep.
- **debug 4.3.1 → 4.4.3**, **html-entities 2.3.2 → 2.6.0**. `typed-emitter` kept (types-only).

### Toolchain (dev)

- **TypeScript 3.8 → 5.9**, **@types/node 16 → 22**, **jest / ts-jest 26 → 29**.
- jest 29 forbids `async` tests that also take a `done` callback; all 7 such suites migrated to
  async/await (behaviour-sensitive ones via deferred Promises, each mutation-proven).
- **nock 13 → 14** (intercepts native fetch via `@mswjs/interceptors`); out-of-band event tests
  use a `TestHelpers.waitUntil` poll instead of fixed `Delay()`s (also fixes a pre-existing flake).
- eslint left at **7** (lints clean under TS5; eslint 9 deferred — see devTracka #11).

### Tests (new)

- `tests/firmware-tripwire/` — 34 tests: ZGT topology + AVTransport `LastChange`
  characterization + a 16-payload captured-corpus snapshot net. See its `README.md`.

### Tooling

- `jest.config.js`: `coverageThreshold` floor (stmts 83 / br 78 / fn 68 / lines 82) — the gate
  fails-closed on a coverage drop. New `npm run gate` = `tsc --noEmit && lint && jest`.

## v2.5.0 (baseline) — `stage1-v2.5.0-baseline`

Upstream `@svrooij/sonos` v2.5.0, byte-identical except commit `265202d` which added
`prepare: npm run build` so a git-install produces `lib/`. 303 commits of upstream history
preserved.
