# CLAUDE.md — node-sonos-ts (Mahisoft fork)

Guidance for any AI session working in this repo. Read before editing.

## What this repo is

Rick's fork of `@svrooij/sonos` (node-sonos-ts), forked because **upstream is
dormant** (v2.5.0, ~2022, EOL deps). It is a Sonos UPnP/SOAP control **library**
(not an app) consumed by the **spotPlaya** Node proxy
(`/Users/rick/Dev/spotplaya-proxy-node`), which **git-installs this fork pinned to a
tag**; `prepare: npm run build` makes the install produce `lib/`. **Requires Node ≥ 18**
(uses native `fetch`).

> NOTE: spotPlaya's *live* control at Timmy `:8099` appears to be a **Python/Flask +
> SoCo** proxy now (per its own devTracka metadata), not the Node proxy. Confirm whether
> the Node proxy still consumes this fork before assuming this library is live anywhere.

**Scope of work here is lib-internal only:** modernize the EOL dependency stack and add
firmware-tripwire regression tests. Tracked in devTracka project `node-sonos-ts`; the
working plan is `STAGE-2-3-PLAN.md`; the consumer handoff is `HANDOFF-spotplaya.md`.

**Status (2026-06-26):** Stage 2 + Stage 3 **complete**, tagged **`v2.5.0-mahi.1`**
(pushed to origin). All shipped EOL deps modernized; 333 tests green. Only open item is
deferred eslint 9 (devTracka #11).

## Hard boundary

- **Do NOT deploy anything from this repo.** Deploy / shadow-validate / re-pin is the
  consuming (spotPlaya) session's job — see `HANDOFF-spotplaya.md`.
- Branch `stage2-deps` + tag `v2.5.0-mahi.1` are pushed to `origin`
  (`github.com/mahirick/node-sonos-ts`, **private**, standalone repo — not a GitHub fork).
  Further pushes are an explicit, Rick-approved step — not automatic.

## The gate (run before claiming anything is done)

```
npm run gate        # tsc --noEmit && lint && jest (with coverage floor)
```

Baseline that must stay green after EVERY change:

- **333 tests (324 pass + 9 skip), 0 fail.** The 9 skips are env-gated real-device
  integration tests — expected offline.
- **Coverage floor enforced by jest** (`coverageThreshold` in `jest.config.js`):
  stmts 83 / branches 78 / funcs 68 / lines 82. Current ≈ 83.2% / 80.4%. The gate
  fails-closed if coverage drops.
- `tsc` clean, `eslint` clean.

## Iron rules

1. **The test suite is the oracle. Never edit, weaken, skip, or delete a test to
   make a change pass.** Especially the firmware-tripwire tests in
   `tests/firmware-tripwire/` — they exist to catch exactly the silent drift a dep
   or firmware change can introduce. If a test reddens, that is a real regression to
   fix in the *code/options*, or a real behavior change to **surface to Rick** — not
   to paper over. (Test-infra adaptations that don't touch assertions — e.g. swapping a
   fixed `Delay()` for a `waitUntil` poll under a new mock engine — are fine; weakening
   an assertion is not.)
2. **Reproduce the original (v3-era) observable output exactly.** The proxy runs
   against this library's current behavior; "modernize" means same output, newer
   deps — not "improve" the parse.
3. **One concern per commit; refactor XOR feature, never mixed.** Commit messages: use
   `git commit -F <file>` — inline `-m` with `()`/`/` gets eaten by zsh glob expansion.

## XML parsing — pinned on purpose (the risky surface)

All `fast-xml-parser` usage is centralized through `XmlHelper.parse()` in
`src/helpers/xml-helper.ts` (fast-xml-parser **v4.5.6**). Options are pinned to
reproduce the v3 defaults this codebase was written against:

- `processEntities: false` — v3 did **not** decode XML entities; the codebase
  decodes explicitly (`html-entities` for titles; the manual `&amp;`→`&` art-URI
  replace at `metadata-helper.ts:52`). Flipping this true double-decodes art URIs.
- `parseAttributeValue: false` — UUIDs / track URIs / art URIs stay **strings**
  (no number coercion). The tripwire pins `typeof === 'string'` on these.
- `parseTagValue: true` — mirrors v3 `parseNodeValue:true` (some ZGT numeric
  text-nodes are expected as numbers). The plan's suggested `false` is **wrong** —
  it over-stringifies those.
- `ignoreAttributes` defaults true (v3 default); the xml-helper sites override to
  `false`. `ignoreNameSpace` → renamed `removeNSPrefix` per site (`s:Envelope` kept
  where v3 kept it, stripped where v3 stripped it).

`fast-xml-parser` has a moderate advisory in its **XMLBuilder** (XML *building*) — this
lib only ever *parses*, so it does not apply; do not chase a v5 major for it.

If you touch parsing, the ZGT + AVTransport tripwires and the captured-payload corpus
(`tests/firmware-tripwire/`) are your gate.

## Network layer — native fetch (done)

`node-fetch` was removed; the lib uses Node's **native global `fetch`** (undici):

- **Requires Node ≥ 18.** A Node < 18 host throws `fetch is not defined` at runtime.
- **Tests mock fetch via `nock` 14** (`@mswjs/interceptors`) — nock 13 could NOT
  intercept undici. nock 14's more-async timing made the out-of-band event tests flaky;
  they now use `TestHelpers.waitUntil(predicate)` polling, not fixed delays.
- **Request timeouts use `AbortSignal.timeout(ms)`** (native fetch ignores `{timeout}`).
  4 sites in `base-service.ts`: SOAP 30s; subscribe/renew/cancel 15s each. App-level
  notification timeouts (tts-helper, sonos-device) are NOT fetch options — leave them.
- **Behavior change:** a timeout now rejects `DOMException TimeoutError` (was node-fetch
  `FetchError`/`request-timeout`); network failure throws `TypeError`. Both are wrapped by
  the lib's `EventsError`/`HttpError`, so consumers catching generic `Error` are insulated.

## Toolchain

TypeScript **5.9**, @types/node **22**, jest/ts-jest **29**. eslint is still **7** +
`airbnb-typescript` (eslintrc) — it lints clean under TS5; **eslint 9 was deliberately
deferred** (flat-config + airbnb-drop churn for ~zero value; devTracka #11). `npm audit`
is down to 2 dev-only moderate (js-yaml + the fast-xml-parser XMLBuilder one).

## Real-speaker validation (rare here)

Most gates are offline fixtures/mocks. Any real-device check follows the silent
rule: volume 0, a confirmed-solo zone that is **NOT Roamah**, verify via state not
by ear.
