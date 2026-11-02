/**
 * routerbase types.
 *
 * The upstream service is a hosted MCP endpoint spoken to over
 * JSON-RPC 2.0 (POST <base>/mcp/http, tools/call). HTTP access is
 * described by a minimal response surface so tests can inject a
 * fake fetch and never touch the network.
 */

export interface RouterDefaultsOptions {
  slug?: string;
  brand?: string;
  model?: string;
}

export interface ComplianceOptions {
  slug: string;
}

export interface LookupMacOptions {
  mac: string;
}

export interface SubmitCorrectionOptions {
  slug: string;
  field: string;
  proposedValue: string;
  sourceUrl: string;
}

/** Client configuration: endpoint override plus optional API key. */
export interface ClientConfig {
  /** SSID_API_BASE value (host or full endpoint); default https://ssid.ai/mcp/http. */
  base?: string;
  /** SSID_API_KEY value; sent as a Bearer token when present. */
  apiKey?: string;
}

export type MacKind = "universal" | "randomized" | "multicast" | "invalid";

/** Result of the local MAC classification (no network involved). */
export interface MacClassification {
  /** The address exactly as supplied. */
  mac: string;
  /** Canonical uppercase colon form, or null when invalid. */
  normalized: string | null;
  valid: boolean;
  kind: MacKind;
  /** First three octets in colon form (the OUI), or null when invalid. */
  oui: string | null;
  isMulticast: boolean;
  isLocallyAdministered: boolean;
}

/** lookup_mac result: local classification merged with the upstream vendor payload. */
export interface LookupMacResult {
  mac: string;
  normalized: string | null;
  valid: boolean;
  kind: MacKind;
  oui: string | null;
  isMulticast: boolean;
  isLocallyAdministered: boolean;
  /** Vendor string extracted from the upstream payload, when it carries one. */
  vendor: string | null;
  /** The upstream payload itself (parsed JSON or text), or null for an invalid MAC (no upstream call). */
  upstream: unknown;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
