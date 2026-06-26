# Handoff: node-sonos-ts fork → `v2.5.0-mahi.1` (for the spotPlaya / consumer session)

The `@svrooij/sonos` fork (`mahirick/node-sonos-ts`) has been modernized and tagged
**`v2.5.0-mahi.1`** (pushed to origin, commit `e5b5924`). The library work (Stage 2 deps
+ Stage 3 regression tests) is **done, gated, and consumer-validated**. The consumer side
is: re-pin → shadow-validate → promote. No deploys happen from the node-sonos-ts repo.

## 1. The one-line integration

`/Users/rick/Dev/spotplaya-proxy-node/package.json` currently pins:
```json
"@svrooij/sonos": "github:mahirick/node-sonos-ts#265202d83e6c0524a438d1a13c9a06ac489452a3",
```
Change the ref to the new tag:
```json
"@svrooij/sonos": "github:mahirick/node-sonos-ts#v2.5.0-mahi.1",
```
Then reinstall so the git dep is re-fetched at the new ref (its `prepare` builds `lib/`):
```bash
npm install @svrooij/sonos@github:mahirick/node-sonos-ts#v2.5.0-mahi.1
# (or: rm -rf node_modules/@svrooij/sonos && npm install)
npm run build && npm run test:phase3   # the proxy's own gates
```
The fork's public API is **unchanged** — `SonosDevice` / `SonosManager` / `SonosEvents`
all resolve identically; a TS5 consumer compiles clean against the shipped `.d.ts`.

## 2. TWO integration gotchas — check these FIRST

1. **Node ≥ 18 required (hard).** node-fetch is gone; the lib now uses Node's native
   global `fetch` (undici). If the proxy's container/host runs Node < 18, the fork will
   throw at runtime (`fetch is not defined`). **Confirm the proxy's Node version is 18+
   before promoting.** This is the single most likely break.

2. **Request-timeout error shape changed.** A timed-out Sonos request now rejects with a
   `DOMException` named **`TimeoutError`** (was node-fetch `FetchError` with
   `type: 'request-timeout'`); a network failure throws `TypeError` (was `FetchError`).
   The library catches generic `Error` and wraps these in its own `EventsError`/`HttpError`,
   so if the proxy only catches the wrapped errors you're fine — **but if anywhere the
   proxy inspects `err.type === 'request-timeout'`, `err.name`, or `err instanceof
   FetchError` on errors bubbling from the lib, update that check.** Timeout DURATIONS are
   identical (SOAP 30s; subscribe/renew/cancel 15s each).

## 3. What changed under the hood (what to watch in shadow-diff)

- **fast-xml-parser 3.19 → 4.5.6** — the riskiest change. All parsing centralized through
  one `XmlHelper.parse()` with options pinned to reproduce v3 output exactly. The parse
  paths the proxy depends on (ZoneGroupTopology, AVTransport `LastChange`, DIDL track
  metadata incl. album-art URIs) are locked by **34 firmware-tripwire tests** + a
  **16-payload captured-corpus snapshot** suite — album-art URIs verified byte-exact (no
  number-coercion / entity-mangling). If a future firmware change breaks a parse path,
  these tests trip.
- **node-fetch → native fetch** (see gotchas above).
- **guid-typescript → `crypto.randomUUID`**, **debug 4.4.3**, **html-entities 2.6.0**
  (typed-emitter kept — types-only).
- **Toolchain**: TypeScript 5.9, @types/node 22, jest 29. `npm audit` 51 → 2 (both
  dev-only moderate; critical + all highs cleared). eslint intentionally left at 7.
- Gate: **jest 333 (324 pass + 9 skip) 0 fail**, coverage 83.2% stmts / 80.4% br,
  `npm run build` (lib/) exits 0.

## 4. Consumer validation path (per the plan)

1. Re-pin in a branch; `npm run build` + `npm run test:phase3` PASS.
2. Shadow-validate: deploy to the `:8098` read-only shadow, run the 96-check harness
   on-subnet, shadow-diff vs live `:8099`. Watch the parse-derived fields (zone topology,
   now-playing track + art URI) for any drift.
3. Promote to `:8099` with the Python-fallback watchdog + rollback armed.

## 5. Confirm this is even the right consumer (possible doc drift)

The original plan has this fork powering the **Node** proxy at `spotplaya-proxy-node`
(`:8099`), and that repo does pin `@svrooij/sonos`. But devTracka's spotPlaya metadata
describes the live control proxy as **Python/Flask + SoCo** (`mahirick/spotplaya-artproxy`).
If control actually migrated to the Python/SoCo proxy, then this fork (and this re-pin)
only matters for whatever still runs the Node proxy — **confirm which proxy is live at
`:8099` before investing in the re-pin.**

---

Questions on parse-path specifics: the tripwire tests in `tests/firmware-tripwire/`
document the exact expected decode for each payload type. Tag: `v2.5.0-mahi.1` → `e5b5924`.
