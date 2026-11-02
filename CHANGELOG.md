# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `routerbase get_router_defaults|check_router_compliance|lookup_mac|submit_correction`
  and `routerbase mcp`.
- MCP server (`routerbase mcp`, stdio) with four tools:
  `get_router_defaults`, `check_router_compliance`, `lookup_mac`,
  and `submit_correction`.
- Calls are forwarded as JSON-RPC `tools/call` requests to the
  hosted ssid.ai MCP endpoint under the base from `SSID_API_BASE`,
  defaulting to `https://ssid.ai/mcp/http` (documented
  reconstruction of the upstream wire shape).
- `SSID_API_KEY` is sent when present; `submit_correction`
  requires it (ssid Pro tier) and otherwise fails honestly without
  sending anything.
- MAC classification (universal / randomized / multicast /
  invalid, plus normalisation and OUI extraction) is computed
  locally; only the vendor part of `lookup_mac` comes from the
  upstream call.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
