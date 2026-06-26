# node-sonos-ts fork — Stage 2/3 plan (modernize + firmware tripwire)

**This repo** is Rick's fork of `@svrooij/sonos` (node-sonos-ts), forked because upstream is
**dormant** (2.5.0, ~2022, EOL deps). It's the Sonos library powering the **spotPlaya Node
proxy** at `/Users/rick/Dev/spotplaya-proxy-node` (live on Timmy `:8099`). This is a
**dedicated context for the library work only** — Stage 2 + Stage 3 below. All work is
lib-internal and gated by **this repo's own test suite**. Do NOT deploy anything to Timmy/prod
from here — that's the spotPlaya session's job (see Handoff).

## Stage 1 (DONE) — baseline
- Branch `stage1-v2.5.0-baseline` @ `265202d` (303 commits of upstream history preserved).
- Only change vs upstream v2.5.0: added `"prepare": "npm run build"` so git installs produce
  `lib/` (byte-identical tsc output — the proxy pins this commit).
- **Baseline gates (must stay green after EVERY step):** `npm test` = **299 (290 pass + 9 skip), 0 fail**;
  `npm run build` + `npm run lint` clean. Coverage baseline: **83.2% stmts / 78.6% branches**.

## Stage 2 — modernize the EOL deps  (branch `stage2-deps` off `265202d`)
Riskiest-isolated; gate after EACH step (lib `npm test` stays 299/0, then re-pin the proxy to
the WIP fork commit and confirm proxy `npm run build` + `npm run test:phase3` stay PASS).

1. **`node-fetch@2` → native `fetch`** (low risk; Node 18+ global fetch). Remove `node-fetch` +
   `@types/node-fetch`, delete the import. Lib network calls are `nock`-mocked → well covered.
2. **`fast-xml-parser` 3.19.0 → 4.x — THE RISKY ONE.** Touches DIDL-Lite metadata + UPnP
   `LastChange`/ZGT parsing. v3→v4 is breaking: `parse()` → `new XMLParser(opts).parse()`;
   option renames (`ignoreAttributes`, `attributeNamePrefix`, `textNodeName`,
   `parseTagValue`/`parseAttributeValue`); **number/attribute coercion changed** — the bite is
   ZGT + `r:NextTrackMetaData`. Isolate to `lib/helpers/xml-helper.ts`. Pin options to
   reproduce v3 output (esp. `parseTagValue:false` / an explicit attributeValueProcessor) so
   track URIs/IDs aren't silently number-coerced. Gate on the XML/parser jest specs **plus** a
   before/after snapshot of a captured real ZGT payload.
3. **`debug` / `guid-typescript` / `typed-emitter` / `html-entities`** — bump within-major (or
   `guid-typescript` → `crypto.randomUUID`; `typed-emitter` is types-only). Batch last.
4. **Toolchain (optional):** `typescript` 3.8→5.x, eslint 7→9, jest 26→29/ts-jest,
   `@types/node` 16→22 — clears the heavy old-devDep install + the ~52 audit warnings. Own
   commit; refactor XOR feature, never mixed.

Tag the result `v2.5.0-mahi.1` when green.

## Stage 3 — firmware-tripwire smoke tests  (static fixtures; lib jest + mirrored in the proxy harness)
1. **ZGT parse:** feed a captured real `ZoneGroupTopology` `GetZoneGroupState` XML fixture
   through the parser; assert exact coordinator/member UUIDs, zone names, and bonded/stereo-pair
   grouping survive.
2. **AVTransport event round-trip:** feed a captured `LastChange` NOTIFY (embedded DIDL
   `CurrentTrackMetaData`) through `SonosEventListener` decode; assert `Track`
   Title/Artist/Album/TrackUri are correct and the **art URI is NOT number-coerced or
   entity-mangled** (the classic fast-xml-parser-v4 failure mode).
These double as the Stage-2 acceptance gate AND the early-warning if a future firmware update
breaks the parse paths spotPlaya depends on.

## Handoff back to the spotPlaya session (do NOT do this here)
When Stage 2/3 are green and the fork is tagged (`v2.5.0-mahi.1`):
1. In the spotPlaya session, re-pin `/Users/rick/Dev/spotplaya-proxy-node` package.json to the
   new fork tag.
2. Shadow-validate (deploy to a `:8098` read-only shadow, run the 96-check harness on-subnet,
   shadow-diff vs live) — exactly like the overnight-fixes promote.
3. Deploy to `:8099` with the Python-fallback watchdog + rollback armed.

## Silent-testing note
Any real-speaker validation (rare here — most gates are offline fixtures/mocks) follows the
silent rule: volume 0, a confirmed-solo zone that is NOT Roamah, verify via state not by ear.
