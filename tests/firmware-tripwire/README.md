# Firmware-tripwire tests

A regression net that locks the **exact decoded output** of real captured Sonos payloads, so a
dependency bump (the fast-xml-parser v3→v4 swap these were written for) or a future Sonos
**firmware** change can't silently alter what a consuming proxy sees.

## What's here

| File | Locks |
|---|---|
| `zgt-parse.test.ts` | ZoneGroupTopology `GetZoneGroupState` — exact coordinator/member UUIDs, zone names, stereo-pair `ChannelMapSet` bonding, with `typeof` guards on coercion. |
| `avtransport-roundtrip.test.ts` (+ `avtransport-lastchange.fixture.ts`) | An AVTransport `LastChange` NOTIFY — Current + Next track metadata; album-art URI byte-exact (no `&amp;`, percent-encodings intact). |
| `corpus.test.ts` + `corpus/*.xml` | 16 real payloads across every parse path, each driven through its genuine service method and `toMatchSnapshot()`-locked, plus a tree-walking invariant backstop. |

## Why it's the oracle

These run through the **real** library paths (`GetParsedZoneGroupState`, `ParseEvent`,
`ParseDIDLTrack`, `BrowseParsedWithDefaults`, `ListAndParseAlarms`, …) — not the parser in
isolation — so they catch drift wherever it happens. The snapshots were locked against the
known-good output; the invariant asserts (no `NaN`; `TrackUri`/`AlbumArtUri`/`uuid`/`*UUID` are
strings; no `&amp;` in art) catch coercion/entity drift **independently of the snapshots**.

The whole point of pinning fast-xml-parser to v3-faithful options is so these stay green; if you
touch `XmlHelper.parse` or any parse path, these are your gate.

## How to extend (add a captured payload)

1. Capture a **real** payload verbatim — lift one from an existing service test under
   `tests/services/`, or capture from a device. XML goes in `corpus/<path>.<desc>.xml`.
2. Add a manifest entry in `corpus.test.ts` (`{ id, path, file, ... }`). `path` selects the
   parse path: `zgt` / `event` / `didl-track` / `didl-lite` / `browse` / `alarm` / `music` / `soap`
   (browse/event entries also need `objectId` / `service`).
3. `npx jest tests/firmware-tripwire/ -u` to generate the snapshot, then **read the snapshot
   diff** and confirm the decode is correct before committing it.
4. `npm run gate` must stay green.

## Rule

Never regenerate a snapshot (`jest -u`) to make a failing test pass without first proving the
change is benign — the invariant asserts must stay green AND the snapshot diff must be the
expected format-only / intended change. A snapshot diff is a **signal**, not a chore.
