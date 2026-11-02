import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildToolsCallBody,
  checkRouterCompliance,
  classifyMac,
  getRouterDefaults,
  lookupMac,
  resolveEndpoint,
  submitCorrection,
} from "../src/routerbase.js";
import type { ClientConfig, FetchFn, HttpResponse } from "../src/types.js";

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** Wrap a tool payload in the upstream MCP result envelope (JSON text content). */
function envelope(payload: unknown) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  };
}

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  calls: number;
}

function fakeFetch(captured: Captured, body: unknown = envelope({})): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    captured.url = url;
    captured.method = init?.method;
    captured.headers = init?.headers;
    captured.body = init?.body;
    captured.calls++;
    return jsonResponse(body);
  };
}

function newCaptured(): Captured {
  return { calls: 0 };
}

function sentBody(c: Captured): Record<string, any> {
  return JSON.parse(c.body ?? "{}");
}

const EP = "https://ssid.ai/mcp/http";

describe("endpoint resolution", () => {
  it("defaults to the hosted endpoint and strips trailing slashes", () => {
    assert.equal(resolveEndpoint(undefined), EP);
    assert.equal(resolveEndpoint("  "), EP);
    assert.equal(resolveEndpoint("https://ssid.ai/mcp/http/"), EP);
  });

  it("accepts a bare host override and appends /mcp/http", () => {
    assert.equal(resolveEndpoint("https://example.test"), "https://example.test/mcp/http");
    assert.equal(resolveEndpoint("https://example.test/"), "https://example.test/mcp/http");
  });
});

describe("MAC classification (local logic)", () => {
  it("classifies a factory address as universal and extracts the OUI", () => {
    const c = classifyMac("00:1A:2B:3C:4D:5E");
    assert.equal(c.valid, true);
    assert.equal(c.kind, "universal");
    assert.equal(c.normalized, "00:1A:2B:3C:4D:5E");
    assert.equal(c.oui, "00:1A:2B");
    assert.equal(c.isMulticast, false);
    assert.equal(c.isLocallyAdministered, false);
  });

  it("classifies a locally administered unicast address as randomized", () => {
    const c = classifyMac("02:11:22:33:44:55");
    assert.equal(c.kind, "randomized");
    assert.equal(c.isLocallyAdministered, true);
    assert.equal(c.isMulticast, false);
  });

  it("classifies a multicast address, with precedence over the local bit", () => {
    assert.equal(classifyMac("01:00:5E:00:00:01").kind, "multicast");
    const both = classifyMac("03:00:00:00:00:01");
    assert.equal(both.kind, "multicast");
    assert.equal(both.isMulticast, true);
    assert.equal(both.isLocallyAdministered, true);
  });

  it("normalises hyphen, dot, and bare-hex forms, in any case", () => {
    assert.equal(classifyMac("aa-bb-cc-dd-ee-ff").normalized, "AA:BB:CC:DD:EE:FF");
    assert.equal(classifyMac("aabb.ccdd.eeff").normalized, "AA:BB:CC:DD:EE:FF");
    assert.equal(classifyMac("aabbccddeeff").normalized, "AA:BB:CC:DD:EE:FF");
    assert.equal(classifyMac("  AA:BB:CC:DD:EE:FF ").normalized, "AA:BB:CC:DD:EE:FF");
  });

  it("rejects malformed addresses as invalid", () => {
    for (const bad of ["ZZ:11:22:33:44:55", "00:11:22:33:44", "00:11:22:33:44:55:66", "", "not-a-mac", "0:11:22:33:44:55"]) {
      const c = classifyMac(bad);
      assert.equal(c.valid, false, bad);
      assert.equal(c.kind, "invalid", bad);
      assert.equal(c.normalized, null, bad);
      assert.equal(c.oui, null, bad);
    }
  });
});

describe("JSON-RPC request shaping", () => {
  it("builds a tools/call body with jsonrpc, id, method and params", () => {
    const body = buildToolsCallBody("lookup_mac", { mac: "00:1A:2B:3C:4D:5E" }) as Record<string, any>;
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(typeof body.id, "number");
    assert.equal(body.method, "tools/call");
    assert.equal(body.params.name, "lookup_mac");
    assert.deepEqual(body.params.arguments, { mac: "00:1A:2B:3C:4D:5E" });
  });

  it("POSTs to the default endpoint with a JSON content type and no key by default", async () => {
    const c = newCaptured();
    await checkRouterCompliance(fakeFetch(c, envelope({ compliant: true })), {}, { slug: "acme-r1" });
    assert.equal(c.url, EP);
    assert.equal(c.method, "POST");
    assert.equal(c.headers?.["Content-Type"], "application/json");
    assert.equal(c.headers?.Authorization, undefined);
    assert.equal(sentBody(c).params.name, "check_router_compliance");
    assert.deepEqual(sentBody(c).params.arguments, { slug: "acme-r1" });
  });

  it("sends the API key as a Bearer token when present, and honours a base override", async () => {
    const c = newCaptured();
    const cfg: ClientConfig = { base: "https://example.test", apiKey: "secret-key" };
    await checkRouterCompliance(fakeFetch(c, envelope({})), cfg, { slug: "acme-r1" });
    assert.equal(c.url, "https://example.test/mcp/http");
    assert.equal(c.headers?.Authorization, "Bearer secret-key");
  });
});

describe("get_router_defaults addressing", () => {
  it("forwards slug mode", async () => {
    const c = newCaptured();
    const out = (await getRouterDefaults(fakeFetch(c, envelope({ gateway: "192.168.1.1" })), {}, { slug: "acme-r1" })) as Record<string, unknown>;
    assert.equal(out.gateway, "192.168.1.1");
    assert.deepEqual(sentBody(c).params.arguments, { slug: "acme-r1" });
  });

  it("forwards brand+model mode", async () => {
    const c = newCaptured();
    await getRouterDefaults(fakeFetch(c, envelope({})), {}, { brand: "Acme", model: "R1" });
    assert.deepEqual(sentBody(c).params.arguments, { brand: "Acme", model: "R1" });
  });

  it("rejects neither-mode and half-of-brand/model before any request", async () => {
    const c = newCaptured();
    const f = fakeFetch(c, envelope({}));
    await assert.rejects(() => getRouterDefaults(f, {}, {}), /either slug, or both brand and model/);
    await assert.rejects(() => getRouterDefaults(f, {}, { brand: "Acme" }), /either slug, or both brand and model/);
    await assert.rejects(() => getRouterDefaults(f, {}, { model: "R1" }), /either slug, or both brand and model/);
    assert.equal(c.calls, 0);
  });
});

describe("lookup_mac merging", () => {
  it("merges the upstream vendor with the local classification", async () => {
    const c = newCaptured();
    const out = await lookupMac(fakeFetch(c, envelope({ vendor: "Acme Networks" })), {}, { mac: "00:1A:2B:3C:4D:5E" });
    assert.equal(out.kind, "universal");
    assert.equal(out.normalized, "00:1A:2B:3C:4D:5E");
    assert.equal(out.oui, "00:1A:2B");
    assert.equal(out.vendor, "Acme Networks");
    assert.deepEqual(sentBody(c).params.arguments, { mac: "00:1A:2B:3C:4D:5E" });
  });

  it("reports a randomized address kind while still asking upstream for the vendor", async () => {
    const c = newCaptured();
    const out = await lookupMac(fakeFetch(c, envelope({ vendor: null })), {}, { mac: "02-11-22-33-44-55" });
    assert.equal(out.kind, "randomized");
    assert.equal(out.vendor, null);
    assert.equal(c.calls, 1);
  });

  it("answers an invalid MAC locally and never calls upstream", async () => {
    const c = newCaptured();
    const out = await lookupMac(fakeFetch(c, envelope({ vendor: "Nobody" })), {}, { mac: "ZZ:ZZ:ZZ:ZZ:ZZ:ZZ" });
    assert.equal(out.valid, false);
    assert.equal(out.kind, "invalid");
    assert.equal(out.vendor, null);
    assert.equal(out.upstream, null);
    assert.equal(c.calls, 0);
  });

  it("rejects an empty MAC before classifying or calling", async () => {
    const c = newCaptured();
    await assert.rejects(() => lookupMac(fakeFetch(c), {}, { mac: "  " }), /mac must be a non-empty string/);
    assert.equal(c.calls, 0);
  });
});

describe("envelope and error handling", () => {
  it("unwraps structuredContent when the upstream provides it", async () => {
    const c = newCaptured();
    const body = { jsonrpc: "2.0", id: 1, result: { structuredContent: { compliant: false } } };
    const out = (await checkRouterCompliance(fakeFetch(c, body), {}, { slug: "acme-r1" })) as Record<string, unknown>;
    assert.equal(out.compliant, false);
  });

  it("returns non-JSON text content as a plain string", async () => {
    const c = newCaptured();
    const body = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "plain answer" }] } };
    const out = await checkRouterCompliance(fakeFetch(c, body), {}, { slug: "acme-r1" });
    assert.equal(out, "plain answer");
  });

  it("surfaces a JSON-RPC error's message", async () => {
    const c = newCaptured();
    const body = { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "unknown slug" } };
    await assert.rejects(() => checkRouterCompliance(fakeFetch(c, body), {}, { slug: "nope" }), /JSON-RPC error: unknown slug/);
  });

  it("surfaces an isError result's text", async () => {
    const c = newCaptured();
    const body = { jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "rate limited" }] } };
    await assert.rejects(() => checkRouterCompliance(fakeFetch(c, body), {}, { slug: "acme-r1" }), /rate limited/);
  });

  it("surfaces HTTP failures with their status", async () => {
    const failing: FetchFn = async () => jsonResponse({ message: "boom" }, 500, "Server Error");
    await assert.rejects(() => checkRouterCompliance(failing, {}, { slug: "acme-r1" }), /HTTP 500.*boom/);
  });

  it("wraps network failures with context", async () => {
    const failing: FetchFn = async () => { throw new Error("socket hang up"); };
    await assert.rejects(() => checkRouterCompliance(failing, {}, { slug: "acme-r1" }), /ssid\.ai request failed: socket hang up/);
  });

  it("rejects a missing slug for compliance before any request", async () => {
    const c = newCaptured();
    await assert.rejects(() => checkRouterCompliance(fakeFetch(c), {}, { slug: "" }), /slug must be a non-empty string/);
    assert.equal(c.calls, 0);
  });
});

describe("submit_correction Pro/key gate", () => {
  const correction = {
    slug: "acme-r1",
    field: "gateway_ip",
    proposedValue: "192.168.0.1",
    sourceUrl: "https://example.com/manual",
  };

  it("without an API key it errors honestly and sends nothing", async () => {
    const c = newCaptured();
    await assert.rejects(
      () => submitCorrection(fakeFetch(c, envelope({ queued: true })), {}, correction),
      /SSID_API_KEY.*Pro/,
    );
    assert.equal(c.calls, 0);
  });

  it("with an API key it forwards all four fields", async () => {
    const c = newCaptured();
    const out = (await submitCorrection(fakeFetch(c, envelope({ queued: true })), { apiKey: "pro-key" }, correction)) as Record<string, unknown>;
    assert.equal(out.queued, true);
    assert.equal(sentBody(c).params.name, "submit_correction");
    assert.deepEqual(sentBody(c).params.arguments, correction);
    assert.equal(c.headers?.Authorization, "Bearer pro-key");
  });

  it("rejects missing correction fields before the gate and any request", async () => {
    const c = newCaptured();
    await assert.rejects(
      () => submitCorrection(fakeFetch(c), { apiKey: "pro-key" }, { ...correction, sourceUrl: "" }),
      /sourceUrl must be a non-empty string/,
    );
    assert.equal(c.calls, 0);
  });
});
