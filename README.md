# routerbase

routerbase answers three kinds of questions about home routers:
what a model's factory login defaults are (gateway, login host,
username/password, credential type, reset steps, and the
manufacturer source the record cites), whether a model complies
with the UK PSTI and EU CRA rules against universal default
passwords, and who made the network hardware behind a MAC address.
One binary serves a command-line interface and a stdio MCP server.

The data lives in a hosted service. routerbase is a local stdio
server that forwards each call as a JSON-RPC `tools/call` request
to the ssid.ai MCP endpoint at `https://ssid.ai/mcp/http`; that
wire shape is a documented reconstruction from the service's
public description. Point it elsewhere with `SSID_API_BASE` (a
host or a full endpoint URL).

Read tools are free with no key. Setting `SSID_API_KEY` raises
the rate limits and is sent as a Bearer token when present.
`submit_correction` is different: the upstream gates that write
tool behind its Pro tier, so without `SSID_API_KEY` routerbase
refuses with an explanation and sends nothing — a correction is
never reported as submitted when it was not.

For `lookup_mac`, the address classification is worked out
locally, for real: the address is parsed and normalised (colon,
hyphen, dot, and bare-hex forms are accepted), the multicast and
locally-administered bits of the first octet decide between
multicast, randomized, and universal, and anything unparseable
is invalid. Only the vendor/OUI part comes from the upstream
call, and an invalid address is never sent upstream.

## Install

```bash
npx @reneturcios/routerbase lookup_mac 00:1A:2B:3C:4D:5E
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/routerbase
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
routerbase get_router_defaults --slug <slug>
routerbase get_router_defaults --brand <brand> --model <model>
routerbase check_router_compliance --slug <slug>
routerbase lookup_mac 00:1A:2B:3C:4D:5E
routerbase submit_correction --slug <slug> --field gateway_ip \
  --proposed-value 192.168.0.1 --source-url https://example.com/manual

routerbase --version
```

Successful commands print the result as JSON. Exit codes: `0` on
success, `1` when a call fails (including an upstream error or
the correction key gate), `2` for usage errors.
`get_router_defaults` needs either `--slug` or both `--brand`
and `--model`; anything less is an honest error, not a guess.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/routerbase mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "routerbase": {
      "command": "npx",
      "args": ["-y", "@reneturcios/routerbase", "mcp"],
      "env": {
        "SSID_API_KEY": "your key, optional for read tools"
      }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `get_router_defaults` | `slug`, or `brand` + `model` | The manufacturer-cited factory login record for the model. |
| `check_router_compliance` | `slug` (required) | The model's standing under UK PSTI / EU CRA universal-default-password rules. |
| `lookup_mac` | `mac` (required) | Local classification (universal / randomized / multicast / invalid), the normalised address and OUI, plus the upstream vendor payload. |
| `submit_correction` | `slug`, `field`, `proposedValue`, `sourceUrl` (all required) | Queues a cited correction for verification. Requires `SSID_API_KEY` (Pro tier). |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
