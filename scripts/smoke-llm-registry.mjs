#!/usr/bin/env node
/**
 * Smoke test: spawn the built llm-registry server over stdio exactly as an MCP
 * client would, list its tools, and call each one against the real registry.
 * No API keys are needed; run_operation reports keyless providers as skipped.
 *
 *   PowerShell:  cd C:\projects\FleetMcpServers; npm run smoke:llm
 *   (set FLEET_ROOT or LLM_REGISTRY first if the registry is not at C:\projects\LlmRegistry)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverJs = join(here, "..", "servers", "llm-registry", "dist", "index.js");

const transport = new StdioClientTransport({ command: process.execPath, args: [serverJs], env: { ...process.env }, stderr: "pipe" });
transport.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
const client = new Client({ name: "llm-smoke", version: "0.1.0" });
await client.connect(transport);

const show = (title, result, max = 1800) => {
  const text = result.content.map((c) => c.text).join("\n");
  console.log(`\n=== ${title}${result.isError ? " (ERROR)" : ""} ===`);
  console.log(text.length > max ? text.slice(0, max) + `\n... (${text.length - max} more chars)` : text);
};

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

show("registry_summary", await client.callTool({ name: "registry_summary", arguments: {} }), 2500);
show("list_models access=open-weight", await client.callTool({ name: "list_models", arguments: { access: ["open-weight"] } }));
show("get_model claude-haiku-5-5", await client.callTool({ name: "get_model", arguments: { model: "claude-haiku-5-5" } }));
show("get_model (unknown)", await client.callTool({ name: "get_model", arguments: { model: "claude haiku" } }));
show("list_groups", await client.callTool({ name: "list_groups", arguments: {} }));
show("resolve_group cheap", await client.callTool({ name: "resolve_group", arguments: { group: "cheap" } }));
show("list_operations", await client.callTool({ name: "list_operations", arguments: {} }));
const t0 = Date.now();
show("run_operation hello on group local", await client.callTool({ name: "run_operation", arguments: { operation: "hello", group: "local", maxTokens: 64 } }), 3000);
console.log(`(run took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

await client.close();
