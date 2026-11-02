/**
 * routerbase MCP server. Tools: get_router_defaults,
 * check_router_compliance, lookup_mac, submit_correction.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * Calls are forwarded to the hosted ssid.ai MCP endpoint
 * (JSON-RPC tools/call). Base from SSID_API_BASE, default
 * https://ssid.ai/mcp/http; SSID_API_KEY is sent when present.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  API_KEY_ENV,
  BASE_ENV,
  checkRouterCompliance,
  formatPayload,
  getRouterDefaults,
  lookupMac,
  submitCorrection,
  VERSION,
} from "./routerbase.js";
import type { ClientConfig, FetchFn } from "./types.js";

const RouterDefaultsArgs = z.object({
  slug: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
});
const ComplianceArgs = z.object({ slug: z.string() });
const LookupMacArgs = z.object({ mac: z.string() });
const SubmitCorrectionArgs = z.object({
  slug: z.string(),
  field: z.string(),
  proposedValue: z.string(),
  sourceUrl: z.string(),
});

const TOOLS = [
  {
    name: "get_router_defaults",
    description: "Get the manufacturer-cited factory login defaults for a router model by slug, or by brand and model.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Router model slug identifying the record to fetch." },
        brand: { type: "string", description: "Router brand name; used together with model when no slug is given." },
        model: { type: "string", description: "Router model name; used together with brand when no slug is given." },
      },
    },
  },
  {
    name: "check_router_compliance",
    description: "Check a router model against UK PSTI and EU CRA universal-default-password rules.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Router model slug to check against the UK PSTI and EU CRA rules." },
      },
      required: ["slug"],
    },
  },
  {
    name: "lookup_mac",
    description: "Look up a MAC address: vendor/OUI from the upstream service plus a local classification of the address kind.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mac: { type: "string", description: "MAC address to look up, in any common separator format." },
      },
      required: ["mac"],
    },
  },
  {
    name: "submit_correction",
    description: "Submit a cited correction to a router record for verification. Requires an ssid Pro API key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Slug of the router record the correction applies to." },
        field: { type: "string", description: "Record field the correction proposes to change." },
        proposedValue: { type: "string", description: "Proposed corrected value for the field." },
        sourceUrl: { type: "string", description: "URL of the source that cites the corrected value." },
      },
      required: ["slug", "field", "proposedValue", "sourceUrl"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "routerbase", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config: ClientConfig = {
    base: process.env[BASE_ENV],
    apiKey: process.env[API_KEY_ENV],
  };
  try {
    let out: unknown;
    if (name === "get_router_defaults") {
      out = await getRouterDefaults(fetchFn, config, RouterDefaultsArgs.parse(args ?? {}));
    } else if (name === "check_router_compliance") {
      out = await checkRouterCompliance(fetchFn, config, ComplianceArgs.parse(args ?? {}));
    } else if (name === "lookup_mac") {
      out = await lookupMac(fetchFn, config, LookupMacArgs.parse(args ?? {}));
    } else if (name === "submit_correction") {
      out = await submitCorrection(fetchFn, config, SubmitCorrectionArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
