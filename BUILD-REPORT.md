# routerbase — Build Report

MCP Rebuild 1000 (Batch 8). Clean-room rebuild of Drumworks/ssid-mcp
(rank 291, Tier C), built from the public README spec captured in
`specs-batch8/ssid.md` and
`harness/fixtures/ssid-mcp-tools-original.json`. That fixture is
docs-derived: the README enumerates exactly 4 tools and gives the
parameter shapes in prose call form; the schemas are documented
reconstructions of exactly those params — no original server was
probed. Parity proves the rebuild matches this program's defined
spec, labelled docs-derived. Local build only — nothing pushed or
published.

Identity: repo `routerbase`, npm `@reneturcios/routerbase`,
MCP name `io.github.CloudCorpRecords/routerbase`, version `0.1.0`,
bin `routerbase` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `routerbase: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Router defaults, PSTI/CRA compliance
  checks, and MAC lookup via the hosted ssid.ai MCP service." =
  **95 chars** (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/routerbase:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/routerbase"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (one subcommand per tool, `mcp`,
  `--version`; exit 2 usage / 1 call error), `src/mcp.ts`,
  `src/types.ts`, `src/routerbase.ts` (core logic, `VERSION = "0.1.0"`)
- `test/routerbase.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to routerbase)

## Tools implemented (4)

`get_router_defaults`, `check_router_compliance`, `lookup_mac`,
`submit_correction` — the full documented set, as recorded in the
fixture `_source`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server`
  (`sdk/server/index.js` + `StdioServerTransport`, ListTools/CallTool
  handlers) with explicit inputSchema literals matching the fixture
  exactly, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys absent from the defined spec. Zod still
  validates every `tools/call`.
- **Wire shape (documented reconstruction):** the upstream is a
  hosted JSON-RPC MCP endpoint, `POST https://ssid.ai/mcp/http`.
  This rebuild is a local stdio server; each tool is forwarded as a
  JSON-RPC 2.0 `tools/call` request to that endpoint, and the MCP
  result envelope is unwrapped (JSON text content parsed,
  structuredContent passed through, JSON-RPC errors / `isError` /
  HTTP failures thrown as honest errors). This shape is labelled a
  documented reconstruction in the fixture `_source` and here.
- Env: `SSID_API_BASE` overrides the base (a bare host gets
  `/mcp/http` appended; a full endpoint is used as-is; trailing
  slashes stripped). `SSID_API_KEY` is optional and, when present,
  sent as an `Authorization: Bearer` token.
- `get_router_defaults` addressing: the schema encodes
  slug/brand/model as optional (per the spec/README call forms);
  the handler enforces the either/or — slug alone, or brand+model
  together — and anything less fails with an honest error before
  any request.
- `lookup_mac` local classification is implemented for real in
  `classifyMac`: colon / hyphen / Cisco-dot / bare-hex forms are
  parsed and normalised to uppercase colon form, the OUI (first
  three octets) is extracted, and the first octet's bits decide
  the kind — multicast bit set → `multicast` (takes precedence),
  locally-administered bit set → `randomized`, neither →
  `universal`, unparseable → `invalid`. An invalid address is
  answered locally and never sent upstream. The vendor part comes
  from the upstream call and is merged into the result (`vendor`
  extracted from the payload when it carries one, plus the raw
  `upstream` payload).
- `submit_correction` gate: without `SSID_API_KEY` it returns an
  honest error explaining the ssid Pro/key gate and sends nothing —
  a submission is never faked. With a key it forwards slug, field,
  proposedValue, and sourceUrl.
- All HTTP flows through an injectable `FetchFn` (types.ts). The
  test suite uses a fake fetch only; no live call is made in tests.

## Verification (foreground, exact outputs)

### 1. Typecheck and build
```
$ npx tsc --noEmit ; echo exit=$?
exit=0
$ npm run build
build exit=0
```
`dist/` produced, including `dist/cli.js`.

### 2. Tests
```
$ npm test   (tsx --test test/*.test.ts)
ℹ tests 27
ℹ pass 27
ℹ fail 0
```
Covers: endpoint default / host-override / full-endpoint /
trailing-slash handling; MAC classification — universal, randomized
(locally administered), multicast (incl. both-bits precedence),
invalid forms, normalisation of hyphen/dot/bare-hex/lowercase, OUI
extraction; JSON-RPC request shaping (body shape, POST target,
content type, Bearer header when a key is present, none when
absent, base override); get_router_defaults slug mode, brand+model
mode, and the either/or rejections with zero upstream calls;
lookup_mac vendor merge, randomized kind, invalid-answered-locally
with zero upstream calls, empty-MAC rejection; envelope handling —
structuredContent unwrap, plain-text content, JSON-RPC error,
isError result, HTTP 500 with upstream message, network failure
wrapping, missing-slug rejection; the correction gate (no key →
honest error, nothing sent; with key → all four fields forwarded;
missing field rejected first).

### 3. CLI smoke
`--version` → `0.1.0` (exit 0); no args and unknown command print
Usage and exit 2; `submit_correction` with all fields but no
`SSID_API_KEY` exits 1 with the Pro/key-gate explanation (no live
call attempted). Parity (below) exercised the MCP `initialize` /
`tools/list` path over stdio. No live ssid.ai call was made in
smoke, and no live result is claimed.

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/ssid-mcp-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/routerbase/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/routerbase/parity-out
verdict=PASS parity_pct=100.0 original_tools=4 rebuild_tools=4 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
Original side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was generated clean via Route 3: a temp copy
holding only `package.json` (no `node_modules` / `dist`), offline
`npm install --package-lock-only --ignore-scripts --offline`,
verified after generation — parses as JSON, top-level `name` is
`@reneturcios/routerbase`, version `0.1.0`, `lockfileVersion` 3,
**128 package entries** — then only the lockfile was placed in the
build dir. Local `node_modules` is a sibling copy (from
builds/fxrates) used only for the local build/test; it is not part
of the lockfile generation.

## Gaps / honest notes

- Docs-derived spec: schemas are documented reconstructions from
  the README's prose call forms — no original ssid-mcp server was
  probed, so parity proves the rebuild matches this program's
  defined spec, not a hand-probed original.
- The upstream forwarding wire shape (JSON-RPC `tools/call` POST
  to `https://ssid.ai/mcp/http`, Bearer key header) is a documented
  reconstruction from the public description of the hosted
  endpoint; no live call was made, so the real endpoint's exact
  request/response envelope, auth header name, rate-limit
  behaviour, and payload field names (including the vendor field
  in lookup results) are unverified until the publish wave.
- `lookup_mac`'s merged result shape (`{mac, normalized, valid,
  kind, oui, isMulticast, isLocallyAdministered, vendor, upstream}`)
  is a local design choice; the classification half is fully
  unit-tested locally, the vendor half only against fake-fetch
  fixtures shaped like the documented result envelope.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
