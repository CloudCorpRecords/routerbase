/**
 * routerbase core: four tools against the hosted ssid.ai MCP service.
 *
 *   get_router_defaults      upstream tools/call
 *   check_router_compliance  upstream tools/call
 *   lookup_mac               local MAC classification (implemented
 *                            here for real) + upstream tools/call
 *                            for the vendor / OUI part
 *   submit_correction        upstream tools/call, gated on an API
 *                            key (ssid Pro tier per the public spec)
 *
 * Wire shape (documented reconstruction): the upstream is a hosted
 * JSON-RPC MCP endpoint, POST https://ssid.ai/mcp/http. This rebuild
 * is a local stdio MCP server; each tool call is forwarded as a
 * JSON-RPC 2.0 `tools/call` request to that endpoint. The base is
 * overridable with SSID_API_BASE (a host or a full endpoint URL).
 * SSID_API_KEY is optional for the read tools and is sent as a
 * Bearer token when present; submit_correction refuses to run
 * without it rather than faking a submission.
 *
 * All HTTP goes through an injected FetchFn so everything is
 * testable offline.
 */
import type {
  ClientConfig,
  ComplianceOptions,
  FetchFn,
  LookupMacOptions,
  LookupMacResult,
  MacClassification,
  RouterDefaultsOptions,
  SubmitCorrectionOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT = "https://ssid.ai/mcp/http";

export const BASE_ENV = "SSID_API_BASE";
export const API_KEY_ENV = "SSID_API_KEY";

/**
 * Resolve the upstream endpoint. An override may be a bare host
 * (https://example.test), a host with a path prefix, or a full
 * endpoint already ending in /mcp/http. Trailing slashes stripped.
 */
export function resolveEndpoint(value?: string): string {
  const v = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!v) return DEFAULT_ENDPOINT;
  if (v.endsWith("/mcp/http")) return v;
  return `${v}/mcp/http`;
}

function optionalParam(value: unknown): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v : undefined;
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = optionalParam(value);
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Local MAC classification
// ---------------------------------------------------------------------------

/**
 * Parse and classify a MAC address locally.
 *
 * Accepted forms: colon (AA:BB:CC:DD:EE:FF), hyphen
 * (AA-BB-CC-DD-EE-FF), Cisco dot (AABB.CCDD.EEFF), and bare
 * 12-hex-digit (AABBCCDDEEFF), in any case, with surrounding
 * whitespace ignored. Anything else is invalid.
 *
 * Classification uses the two low bits of the first octet:
 * bit 0 (I/G) set means multicast; otherwise bit 1 (U/L) set
 * means locally administered, which for a unicast address is the
 * randomized kind; neither bit set means a universal (factory
 * assigned) address. Multicast takes precedence when both bits
 * are set.
 */
export function classifyMac(input: string): MacClassification {
  const raw = typeof input === "string" ? input : "";
  const invalid: MacClassification = {
    mac: raw,
    normalized: null,
    valid: false,
    kind: "invalid",
    oui: null,
    isMulticast: false,
    isLocallyAdministered: false,
  };
  const s = raw.trim();
  let hex: string | null = null;
  if (/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(s)) hex = s.replace(/:/g, "");
  else if (/^[0-9A-Fa-f]{2}(-[0-9A-Fa-f]{2}){5}$/.test(s)) hex = s.replace(/-/g, "");
  else if (/^[0-9A-Fa-f]{4}(\.[0-9A-Fa-f]{4}){2}$/.test(s)) hex = s.replace(/\./g, "");
  else if (/^[0-9A-Fa-f]{12}$/.test(s)) hex = s;
  if (hex === null) return invalid;
  const upper = hex.toUpperCase();
  const octets: string[] = [];
  for (let i = 0; i < 12; i += 2) octets.push(upper.slice(i, i + 2));
  const first = parseInt(octets[0], 16);
  const isMulticast = (first & 0x01) !== 0;
  const isLocallyAdministered = (first & 0x02) !== 0;
  const kind = isMulticast ? "multicast" : isLocallyAdministered ? "randomized" : "universal";
  return {
    mac: raw,
    normalized: octets.join(":"),
    valid: true,
    kind,
    oui: octets.slice(0, 3).join(":"),
    isMulticast,
    isLocallyAdministered,
  };
}

// ---------------------------------------------------------------------------
// Upstream JSON-RPC forwarding
// ---------------------------------------------------------------------------

let nextId = 1;

/** Build the JSON-RPC 2.0 tools/call request body for one tool. */
export function buildToolsCallBody(name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

function extractTextContent(result: Record<string, unknown>): string | undefined {
  const content = result.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }
  return undefined;
}

/**
 * POST one tools/call to the upstream endpoint and unwrap the MCP
 * result envelope: a text content block is parsed as JSON when it
 * parses, otherwise returned as the raw string; structuredContent
 * is returned as-is. JSON-RPC errors, HTTP failures, and isError
 * results all throw honest errors.
 */
export async function callUpstreamTool(
  fetchFn: FetchFn,
  config: ClientConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const endpoint = resolveEndpoint(config.base);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const apiKey = optionalParam(config.apiKey);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let response;
  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildToolsCallBody(name, args)),
    });
  } catch (err) {
    throw new Error(
      `ssid.ai request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload)) {
        if (typeof payload.message === "string" && payload.message) detail = `: ${payload.message}`;
        else if (typeof payload.error === "string" && payload.error) detail = `: ${payload.error}`;
      }
    } catch {
      // A non-JSON error body still reports its HTTP status below.
    }
    throw new Error(
      `ssid.ai request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ssid.ai returned a response that was not valid JSON");
  }
  if (isRecord(payload) && isRecord(payload.error)) {
    const msg = typeof payload.error.message === "string" ? payload.error.message : JSON.stringify(payload.error);
    throw new Error(`ssid.ai returned a JSON-RPC error: ${msg}`);
  }
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error("ssid.ai response did not include a JSON-RPC result");
  }
  const result = payload.result;
  if (result.isError === true) {
    const text = extractTextContent(result);
    throw new Error(text ? `ssid.ai tool call failed: ${text}` : "ssid.ai tool call failed (isError)");
  }
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const text = extractTextContent(result);
  if (text !== undefined) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Factory login defaults for a router model, addressed either by
 * slug or by brand + model. The either/or is enforced here with an
 * honest error: the schema marks all three optional.
 */
export async function getRouterDefaults(
  fetchFn: FetchFn,
  config: ClientConfig,
  options: RouterDefaultsOptions = {},
): Promise<unknown> {
  const slug = optionalParam(options.slug);
  const brand = optionalParam(options.brand);
  const model = optionalParam(options.model);
  const args: Record<string, unknown> = {};
  if (slug) {
    args.slug = slug;
  } else if (brand && model) {
    args.brand = brand;
    args.model = model;
  } else {
    throw new Error(
      "get_router_defaults requires either slug, or both brand and model",
    );
  }
  return callUpstreamTool(fetchFn, config, "get_router_defaults", args);
}

/** Check a router model against UK PSTI / EU CRA default-password rules. */
export async function checkRouterCompliance(
  fetchFn: FetchFn,
  config: ClientConfig,
  options: ComplianceOptions,
): Promise<unknown> {
  const slug = requireNonEmpty(options.slug, "slug");
  return callUpstreamTool(fetchFn, config, "check_router_compliance", { slug });
}

/**
 * MAC lookup: the classification is computed locally (real logic,
 * see classifyMac); the vendor / OUI part comes from the upstream
 * call. An invalid address is reported locally and never sent
 * upstream.
 */
export async function lookupMac(
  fetchFn: FetchFn,
  config: ClientConfig,
  options: LookupMacOptions,
): Promise<LookupMacResult> {
  const mac = requireNonEmpty(options.mac, "mac");
  const c = classifyMac(mac);
  const base: LookupMacResult = {
    mac: c.mac,
    normalized: c.normalized,
    valid: c.valid,
    kind: c.kind,
    oui: c.oui,
    isMulticast: c.isMulticast,
    isLocallyAdministered: c.isLocallyAdministered,
    vendor: null,
    upstream: null,
  };
  if (!c.valid) return base;
  const upstream = await callUpstreamTool(fetchFn, config, "lookup_mac", { mac });
  let vendor: string | null = null;
  if (isRecord(upstream)) {
    for (const key of ["vendor", "manufacturer", "ouiVendor", "oui_vendor"]) {
      if (typeof upstream[key] === "string" && upstream[key]) {
        vendor = upstream[key] as string;
        break;
      }
    }
  }
  return { ...base, vendor, upstream };
}

/**
 * Submit a cited correction to a router record. The public spec
 * gates this write tool behind the ssid Pro tier, so without an
 * SSID_API_KEY this returns an honest error and sends nothing —
 * a submission is never faked.
 */
export async function submitCorrection(
  fetchFn: FetchFn,
  config: ClientConfig,
  options: SubmitCorrectionOptions,
): Promise<unknown> {
  const slug = requireNonEmpty(options.slug, "slug");
  const field = requireNonEmpty(options.field, "field");
  const proposedValue = requireNonEmpty(options.proposedValue, "proposedValue");
  const sourceUrl = requireNonEmpty(options.sourceUrl, "sourceUrl");
  if (!optionalParam(config.apiKey)) {
    throw new Error(
      "submit_correction requires an ssid Pro API key: set SSID_API_KEY to submit a correction (the correction write tool is gated behind the Pro tier, and no submission was sent)",
    );
  }
  return callUpstreamTool(fetchFn, config, "submit_correction", {
    slug,
    field,
    proposedValue,
    sourceUrl,
  });
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
