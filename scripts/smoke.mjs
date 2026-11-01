#!/usr/bin/env node
/**
 * Smoke test: spawn the built fleet-registry server over stdio exactly as an
 * MCP client would, list its tools, and call each one against the real fleet.
 *
 *   PowerShell:  cd C:\projects\FleetMcpServers; npm run smoke
 *   (set FLEET_ROOT first if the fleet is not at C:\projects)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverJs = join(here, "..", "servers", "fleet-registry", "dist", "index.js");

const transport = new StdioClientTransport({ command: process.execPath, args: [serverJs], env: { ...process.env }, stderr: "pipe" });
transport.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
const client = new Client({ name: "fleet-smoke", version: "0.1.0" });
await client.connect(transport);

const show = (title, result, max = 1800) => {
  const text = result.content.map((c) => c.text).join("\n");
  console.log(`\n=== ${title}${result.isError ? " (ERROR)" : ""} ===`);
  console.log(text.length > max ? text.slice(0, max) + `\n... (${text.length - max} more chars)` : text);
};

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

show("fleet_summary", await client.callTool({ name: "fleet_summary", arguments: {} }));
show("list_apps county=Trumbull", await client.callTool({ name: "list_apps", arguments: { county: "Trumbull" } }));
show("get_app TrumbullCountyVoters", await client.callTool({ name: "get_app", arguments: { name: "TrumbullCountyVoters" } }));
show("get_app (unknown)", await client.callTool({ name: "get_app", arguments: { name: "TrumbullVoters" } }));
show("check_hub_links (fleet)", await client.callTool({ name: "check_hub_links", arguments: {} }), 3000);
show("county_coverage Information", await client.callTool({ name: "county_coverage", arguments: { kind: "Information" } }));
show("convention_audit TrumbullCountyVoters", await client.callTool({ name: "convention_audit", arguments: { names: ["TrumbullCountyVoters"] } }));
const t0 = Date.now();
show("convention_audit (fleet)", await client.callTool({ name: "convention_audit", arguments: {} }), 4000);
console.log(`(fleet audit took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
show("find_unregistered", await client.callTool({ name: "find_unregistered", arguments: {} }));

await client.close();
