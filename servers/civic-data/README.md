# civic-data — SQL MCP Server over OhioCivicData

Read-only MCP access to the local **OhioCivicData** SQL Server database, served by
Microsoft's Data API builder (DAB) in MCP mode. Unlike the other servers in this
repo there is no TypeScript here: DAB is a .NET global tool and this folder only
holds its configuration. `package.json` exists so the workspace `npm run build` /
`npm test` still pass; `build` is a no-op and `test` just parses the config.

## What the MCP sees

| Entity | Source | Notes |
|---|---|---|
| County, Jurisdiction, Place, Boundary | `civic.*` tables | `geom` column excluded (geography type; lat/lon stay) |
| Precinct | `civic.v_precinct_summary` view | counts + polling place, no voter rows |
| Parcel | `civic.v_parcel_public` view | **not** `civic.parcel` — no `owner_name`, `legal_description`, `centroid` |
| LandUseCode, IncomeTax, Legislator, CountyLegislator | tables | |
| School, SchoolDistrict | tables | School `geom` excluded |
| CountyStat, CountyVendor, InfoLink | tables | |
| Election, CountyElectionSource, Source | tables | |

**Never exposed:** `civic.voter`, `civic.voter_election`, `civic.voter_contact`,
`civic.voter_contact_source`, raw `civic.parcel`, `civic.parcel_polygon`, `stg_*`.
They are not entities, so no MCP tool can name them.

Globally: only `describe-entities` and `read-records` are enabled; `create-record`,
`update-record`, `delete-record` and `execute-entity` are off. GraphQL off, REST on
at `/api/...` for the HTTP mode. Pages default to 100 rows, max 1000, so the 6M-row
parcel view cannot flood a context window.

Two roles are declared on every entity: `anonymous` (what plain `dab start` serves
in development mode) and `reader` (what the stdio client selects). Keeping a named
role means `anonymous` can be tightened or dropped later without touching clients.

## Files

| File | Purpose |
|---|---|
| `dab-config.json` | Entities, permissions, MCP settings. Versioned. |
| `.env.example` | Connection-string template. Copy to `.env` (git-ignored). |
| `sql/civic_mcp_reader.sql` | Optional DB role mirroring the config — second gate if DAB ever runs as anything but your own login. |
| `package.json` | Workspace stub + `npm run validate / start / start:http`. |

## One-time setup — PowerShell

```powershell
# 1. Install DAB. MCP needs the 1.7+ / 2.0 preview line, hence --prerelease.
dotnet tool install microsoft.dataapibuilder --prerelease -g
#    already installed:  dotnet tool update microsoft.dataapibuilder --prerelease -g

# 2. Confirm the MCP flag is there (prints the --mcp-stdio help line)
dab start --help | Select-String mcp-stdio

# 3. Connection string
cd C:\projects\FleetMcpServers\servers\civic-data; Copy-Item .env.example .env

# 4. Validate config against the live database — this is what catches a wrong object name
cd C:\projects\FleetMcpServers\servers\civic-data; dab validate
```

## Run

**stdio** (Claude Desktop / Claude Code launch this as a child process; no port, nothing
runs when the client is closed):

```powershell
cd C:\projects\FleetMcpServers\servers\civic-data; dab start --mcp-stdio role:reader --config .\dab-config.json
```

**HTTP** (REST + `/mcp` endpoint, for a browser, a remote agent, or Swagger-style poking):

```powershell
cd C:\projects\FleetMcpServers\servers\civic-data; dab start --config .\dab-config.json
# http://localhost:5000/api/counties     http://localhost:5000/mcp
```

## Client config

The `dab` shim lives in `%USERPROFILE%\.dotnet\tools\dab.exe`. Clients that spawn
without a shell may not see PATH, so the full path is safest.

**Claude Desktop** — Settings → Developer → Edit Config, under `mcpServers`:

```json
"civic-data": {
  "command": "C:\\Users\\<you>\\.dotnet\\tools\\dab.exe",
  "args": [
    "start", "--mcp-stdio", "role:reader",
    "--config", "C:\\projects\\FleetMcpServers\\servers\\civic-data\\dab-config.json"
  ],
  "env": {
    "SQL_CONNECTION_STRING": "Server=localhost;Database=OhioCivicData;Integrated Security=True;TrustServerCertificate=True;Encrypt=False"
  }
}
```

**Claude Code** — PowerShell:

```powershell
claude mcp add civic-data -e "SQL_CONNECTION_STRING=Server=localhost;Database=OhioCivicData;Integrated Security=True;TrustServerCertificate=True;Encrypt=False" -- dab start --mcp-stdio role:reader --config C:\projects\FleetMcpServers\servers\civic-data\dab-config.json
```

Restart the client, then ask it to describe the entities. First useful prompts:
"how many parcels per county?", "list Trumbull precincts with their polling places",
"which collector handles income tax for Girard?".

## Hardening (optional)

Run `sql\civic_mcp_reader.sql` in SSMS. It creates role `civic_mcp_reader` with SELECT
on exactly the objects above and explicit DENY on the voter tables and raw parcel.
If DAB is ever run as a SQL login or service account, put that principal in the role.

## Adding canned queries

Free-form SQL stays closed. To expose a safe, parameterised question, write a stored
procedure and register it as a custom tool — PowerShell:

```powershell
cd C:\projects\FleetMcpServers\servers\civic-data
dab add ParcelsByJurisdiction --source civic.usp_parcels_by_jurisdiction --source.type stored-procedure --permissions "reader:execute"
dab update ParcelsByJurisdiction --mcp.custom-tool true
```

## Known limits

- `geom` (geography) columns are excluded per entity. If `dab validate` still objects
  to an entity with a geography column, swap that entity to a view that omits it.
- `describe-entities` is DAB's schema tool; the model sees column names and types
  but not row samples. `read-records` takes `$filter`, `$orderby`, `$first`, `$select`.
- OhioDataLake: same recipe, sibling folder `servers/data-lake`, own `dab-config.json`
  and `SQL_CONNECTION_STRING` with `Database=OhioDataLake`.
