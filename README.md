# FleetMcpServers

MCP servers that give an AI assistant (Claude Desktop, Claude Code, or any
MCP client) structured access to the Statehouse fleet under `C:\projects`.

One server per concern, each a small TypeScript program that speaks MCP over
stdio. Servers are read-only unless their README says otherwise. Shared code
and the Statehouse scripts stay where they are; these servers wrap them.

| Server | What it answers | Status |
|---|---|---|
| [`servers/fleet-registry`](servers/fleet-registry/README.md) | Which repos exist, what each one is, is it linked from every hub, does it follow the fleet conventions, what is on disk but unregistered | v0.1 |
| `servers/fleet-drift` (planned) | Per-county values copied between repos and never substituted; which repos are behind on voters-core / parcels-core / basemaps / a11y; PWA precache size vs the 5 MB ceiling | — |
| `servers/civic-data` (planned) | Read-only queries over OhioCivicData (`civic` schema), voter tables excluded by connection | — |
| `servers/ohio-lookup` (planned) | Address / lat-long → county, jurisdiction, precinct, income-tax collector, parcel | — |
| `servers/data-watch` (planned) | Stale outside datasets (`data-sources.json`), job runs | — |

## Setup (lvp-01 or lvp-02)

Needs Node 18 or newer. All commands below are **PowerShell**.

```powershell
cd C:\projects\FleetMcpServers; npm install; npm run build
```

Run the unit tests (synthetic fixture fleet, no fleet access needed):

```powershell
cd C:\projects\FleetMcpServers; npm test
```

Smoke-test the built server against the real fleet — spawns it the way a
client would, lists its tools and calls each one:

```powershell
cd C:\projects\FleetMcpServers; npm run smoke
```

## Connecting a client

Each server is started as `node <server>/dist/index.js`. The fleet root
defaults to `C:\projects`; set `FLEET_ROOT` to point elsewhere.

**Claude Desktop** — Settings → Developer → Edit Config, add under `mcpServers`:

```json
{
  "mcpServers": {
    "fleet-registry": {
      "command": "node",
      "args": ["C:\\projects\\FleetMcpServers\\servers\\fleet-registry\\dist\\index.js"],
      "env": { "FLEET_ROOT": "C:\\projects" }
    }
  }
}
```

**Claude Code** (PowerShell):

```powershell
claude mcp add fleet-registry -e FLEET_ROOT=C:\projects -- node C:\projects\FleetMcpServers\servers\fleet-registry\dist\index.js
```

Restart the client after editing its config; the server's tools then show up
as `fleet_summary`, `list_apps`, `get_app`, ... Rebuild (`npm run build`)
after changing any `src/` file; clients spawn the built `dist/index.js`.

## Layout

```
FleetMcpServers/
├── package.json            npm workspaces root: build / test / smoke all servers
├── tsconfig.base.json      shared compiler options (ES2022, NodeNext, strict)
├── scripts/smoke.mjs       MCP client that exercises a built server end to end
└── servers/
    └── fleet-registry/
        ├── src/            index.ts (MCP wiring) + one module per concern
        ├── test/           vitest, against a synthetic fleet built in a temp dir
        └── dist/           build output (git-ignored)
```

## Adding a server

1. Copy `servers/fleet-registry` to `servers/<name>`, rename it in its
   `package.json`, and replace `src/`.
2. Keep the MCP wiring in `src/index.ts` thin: tool descriptions, zod input
   schemas, JSON out. Put the logic in plain modules so the tests can call it
   without a transport.
3. Log to **stderr only** — stdout is the MCP transport.
4. Add it to the table above and to the Statehouse manifest if it needs its
   own repo (this repo holds all of them, so normally it does not).

---

Created by Mike Costarella, Costarella Innovations, LLC.
© 2026 Costarella Innovations, LLC. All rights reserved.
