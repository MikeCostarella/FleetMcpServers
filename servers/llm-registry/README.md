# llm-registry

MCP server over the [LlmRegistry](https://github.com/MikeCostarella/LlmRegistry)
registry file (`C:\projects\LlmRegistry\registry\models.json`). Lets an AI
assistant list the LLMs on file, resolve tag-query groups, and **run an
operation across a model, a group, or a list of models**, returning every
answer with latency, token counts and estimated cost.

Reads the registry; never writes it. The app and this server share the same
file and the same group-filter semantics, so they always agree.

## Tools

| Tool | What it does |
|---|---|
| `registry_summary` | Counts by access / status / provider / vendor, groups with member counts, saved operations, which providers have a key in this environment, unverified model ids. Call first. |
| `list_models` | Models matching a tag query (`allTags`, `anyTags`, `noneTags`, `providers`, `vendors`, `access`, `status`, `capabilities`, `maxInputPrice`, `minContext`) plus `nameContains`. |
| `get_model` | Full entry by registry id, API model id or name; suggests close ids on a miss. |
| `list_groups` | Every group with its filter and current members. |
| `resolve_group` | Members of a group by id — or of an ad-hoc filter. |
| `list_operations` | Saved operations (system prompt + prompt). |
| `run_operation` | Fan one prompt out in parallel. `operation` or `prompt` (+ `system`); target with `group` or `models`; `maxTokens`, `temperature`, `concurrency`, `timeoutMs`, `includeText`. |

Providers without a key are reported as **skipped** (with the env var to set),
provider failures as **error** rows; the call itself never fails because one
model did.

## Configuration

All through environment variables on the process that starts the server:

| Variable | Meaning |
|---|---|
| `FLEET_ROOT` | Fleet folder (default `C:\projects`). |
| `LLM_REGISTRY` | Full path to a registry file (default `<FLEET_ROOT>\LlmRegistry\registry\models.json`). Point it at an export from the app's Settings to use your local edits. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` | One per provider, as named in the registry's `providers[].keyEnv`. Ollama and LM Studio need none. |
| `LLMREG_<PROVIDER>_BASE_URL` | Per-provider base URL override, e.g. `LLMREG_OLLAMA_BASE_URL=http://lvp-02:11434/v1`. Namespaced on purpose so `ANTHROPIC_BASE_URL` and the like, which other tools use, never redirect this server. |

## Build and test

**PowerShell**, from the workspace root (builds and tests every server):

```powershell
cd C:\projects\FleetMcpServers; npm install; npm run build; npm test
```

Smoke-test the built server against the real registry (no keys needed; calls
that need keys show as skipped):

```powershell
cd C:\projects\FleetMcpServers; npm run smoke:llm
```

## Connecting a client

**Claude Desktop** — Settings → Developer → Edit Config, under `mcpServers`:

```json
{
  "mcpServers": {
    "llm-registry": {
      "command": "node",
      "args": ["C:\\projects\\FleetMcpServers\\servers\\llm-registry\\dist\\index.js"],
      "env": {
        "FLEET_ROOT": "C:\\projects",
        "OPENROUTER_API_KEY": "sk-or-...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

**Claude Code** (PowerShell):

```powershell
claude mcp add llm-registry -e FLEET_ROOT=C:\projects -e OPENROUTER_API_KEY=sk-or-... -- node C:\projects\FleetMcpServers\servers\llm-registry\dist\index.js
```

Then, in a session: *"Using llm-registry, run the smoke-test operation on the
open-weight group and rank the answers by latency."*

## Layout

```
servers/llm-registry/
├── src/
│   ├── index.ts     MCP wiring: tool descriptions, zod schemas, JSON out
│   ├── registry.ts  load (mtime-cached), group filters, lookups, summary
│   ├── client.ts    one call to one model: OpenAI-compatible + Anthropic Messages (ported from the app)
│   ├── run.ts       resolve arguments → prompt + model list; bounded parallel fan-out
│   └── types.ts     mirrors registry/models.schema.json
└── test/            vitest: synthetic registry in a temp dir + an in-process mock provider
```
