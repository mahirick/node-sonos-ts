# CLAUDE.md — node-sonos-ts (Mahisoft fork)

Guidance for any AI session working in this repo. Read before editing.

## What this repo is

Rick's fork of `@svrooij/sonos` (node-sonos-ts), forked because **upstream is
dormant** (v2.5.0, ~2022, EOL deps). It is the Sonos UPnP control library that
powers the **spotPlaya** Node proxy (`/Users/rick/Dev/spotplaya-proxy-node`,
live on Timmy `:8099`). The proxy git-installs this fork pinned to a tag/commit;
`prepare: npm run build` makes the install produce `lib/`.

**Scope of work here is lib-internal only:** modernize the EOL dependency stack
and add firmware-tripwire regression tests. Tracked in devTracka project
`node-sonos-ts`; the working plan is `STAGE-2-3-PLAN.md`.

## Hard boundary

- **Do NOT deploy anything from this repo.** Deploy/shadow-validate/re-pin is the
  **spotPlaya session's** job (the documented handoff). From here we only finish
  the lib work and tag `v2.5.0-mahi.1`.
- The handoff requires the branch + tag be **pushed to `origin`**
  (`github.com/mahirick/node-sonos-ts`) — that is an explicit, Rick-approved step,
  not automatic.

## The gate (run before claiming anything is done)

```
npm run gate        # tsc --noEmit && lint && jest (with coverage floor)
```

Baseline that must stay green after EVERY change:

- **314 tests (305 pass + 9 skip), 0 fail.** The 9 skips are env-gated real-device
  integration tests — expected offline.
- **Coverage floor enforced by jest** (`coverageThreshold` in `jest.config.js`):
  stmts 83 / branches 78 / funcs 68 / lines 82. Current ≈ 83.24% / 78.84%. The gate
  fails-closed if coverage drops.
- `tsc` clean, `eslint` clean.

## Iron rules

1. **The test suite is the oracle. Never edit, weaken, skip, or delete a test to
   make a change pass.** Especially the firmware-tripwire tests in
   `tests/firmware-tripwire/` — they exist to catch exactly the silent drift a dep
   or firmware change can introduce. If a test reddens, that is a real regression to
   fix in the *code/options*, or a real behavior change to **surface to Rick** — not
   to paper over.
2. **Reproduce the original (v3-era) observable output exactly.** The proxy runs
   against this library's current behavior; "modernize" means same output, newer
   deps — not "improve" the parse.
3. **One concern per commit; refactor XOR feature, never mixed.**

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

If you touch parsing, the ZGT + AVTransport tripwires and the captured-payload
corpus are your gate.

## Known gotcha — node-fetch → native fetch is NOT a drop-in

If/when removing `node-fetch`:

- **`nock` 13.0.11 cannot intercept native `fetch` (undici)** — the whole mocked
  network suite would break. Requires `nock` **14+** (verified to intercept fetch).
- **Native `fetch` ignores `{timeout}`.** This codebase passes `timeout` at 5 sites
  (`base-service.ts`, `tts-helper.ts`). They must be converted to
  `AbortSignal.timeout(ms)` or timeouts are silently lost.
- Fetch globals (`fetch`/`Request`/`Response`) are untyped under `@types/node@16` +
  no DOM lib — needs `@types/node@18+` (preferred) or `lib:["DOM"]`.

Net: do this **after** the toolchain bump (which brings `@types/node@22`), or defer.

## Real-speaker validation (rare here)

Most gates are offline fixtures/mocks. Any real-device check follows the silent
rule: volume 0, a confirmed-solo zone that is **NOT Roamah**, verify via state not
by ear.
