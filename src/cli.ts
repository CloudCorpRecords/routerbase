#!/usr/bin/env node
/**
 * routerbase CLI.
 *
 *   routerbase get_router_defaults --slug <slug>
 *   routerbase get_router_defaults --brand <brand> --model <model>
 *   routerbase check_router_compliance --slug <slug>
 *   routerbase lookup_mac <mac>
 *   routerbase submit_correction --slug <slug> --field <field> \
 *     --proposed-value <value> --source-url <url>
 *   routerbase mcp
 *
 * Upstream endpoint from SSID_API_BASE, default
 * https://ssid.ai/mcp/http. SSID_API_KEY is sent when present and
 * is required for submit_correction (ssid Pro tier).
 * Exit codes: 0 success, 1 call error, 2 usage error.
 */
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

function usage(): never {
  console.error(`Usage:
  routerbase get_router_defaults --slug <slug>
  routerbase get_router_defaults --brand <brand> --model <model>
  routerbase check_router_compliance --slug <slug>
  routerbase lookup_mac <mac>
  routerbase submit_correction --slug <slug> --field <field> --proposed-value <value> --source-url <url>
  routerbase mcp
  routerbase --version`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function positional(rest: string[]): string | undefined {
  return rest.find((a) => !a.startsWith("--"));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config: ClientConfig = {
    base: process.env[BASE_ENV],
    apiKey: process.env[API_KEY_ENV],
  };
  const known = [
    "get_router_defaults",
    "check_router_compliance",
    "lookup_mac",
    "submit_correction",
  ];
  if (!known.includes(cmd)) usage();
  try {
    let out: unknown;
    if (cmd === "get_router_defaults") {
      out = await getRouterDefaults(fetchFn, config, {
        slug: flag(rest, "--slug") ?? positional(rest),
        brand: flag(rest, "--brand"),
        model: flag(rest, "--model"),
      });
    } else if (cmd === "check_router_compliance") {
      const slug = flag(rest, "--slug") ?? positional(rest);
      if (!slug) usage();
      out = await checkRouterCompliance(fetchFn, config, { slug });
    } else if (cmd === "lookup_mac") {
      const mac = flag(rest, "--mac") ?? positional(rest);
      if (!mac) usage();
      out = await lookupMac(fetchFn, config, { mac });
    } else {
      const slug = flag(rest, "--slug");
      const field = flag(rest, "--field");
      const proposedValue = flag(rest, "--proposed-value") ?? flag(rest, "--proposedValue");
      const sourceUrl = flag(rest, "--source-url") ?? flag(rest, "--sourceUrl");
      if (!slug || !field || !proposedValue || !sourceUrl) usage();
      out = await submitCorrection(fetchFn, config, { slug, field, proposedValue, sourceUrl });
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
