import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMessageHandler, SERVER_INSTRUCTIONS } from "../src/mcp-server.js";
import { createMcpToolRuntime, MCP_TOOLS } from "../src/mcp-tools.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin MCP config starts the server from the installed plugin root", () => {
  const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.deepEqual(config["server-login-permission"], {
    command: "node",
    args: ["scripts/runtime-mcp.js"],
    cwd: ".",
    env_vars: ["ZEUS_TOKEN_SIGN", "ZEUS_API_BASE", "ZEUS_CURRENT_BADGE"]
  });
});

test("MCP exposes the five scoped permission tools with write annotations", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const response = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    "search_users",
    "search_servers",
    "get_permission_options",
    "prepare_application",
    "submit_application"
  ]);
  assert.equal(MCP_TOOLS.find((tool) => tool.name === "submit_application").annotations.destructiveHint, true);
  assert.equal(MCP_TOOLS.find((tool) => tool.name === "prepare_application").annotations.destructiveHint, false);
  assert.equal(MCP_TOOLS.find((tool) => tool.name === "search_servers").inputSchema.required, undefined);
  assert.deepEqual(MCP_TOOLS.find((tool) => tool.name === "prepare_application").inputSchema.required, ["description", "permissions"]);
});

test("search_servers supports global asset lookup without resolving a field/system first", async () => {
  const calls = [];
  const callTool = createMcpToolRuntime({
    config: { currentBadge: "100001", environment: "生产环境" },
    client: {
      async listAssets(input) {
        calls.push(input);
        return { items: [{ id: 913, host_name: "srv-01", field_id: 57, field_name: "物流领域", system_id: 10, system_name: "物流管理系统" }], truncated: false };
      }
    }
  });
  const result = await callTool("search_servers", { keyword: "srv-01" });
  assert.deepEqual(calls, [{ systemId: undefined, keyword: "srv-01" }]);
  assert.equal(result.servers[0].field_name, "物流领域");
  assert.equal(result.servers[0].system_name, "物流管理系统");
  assert.equal("field" in result, false);
  assert.equal("system" in result, false);
});

test("MCP initialization advertises the confirmation and no-retry policy", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const response = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(response.result.protocolVersion, "2025-06-18");
  assert.equal(response.result.instructions, SERVER_INSTRUCTIONS);
  assert.match(response.result.instructions, /确认提交/);
  assert.match(response.result.instructions, /Never retry/);
});

test("MCP tool calls return JSON content and sanitize business failures", async () => {
  const handle = createMessageHandler({
    callTool: async (name, input) => {
      if (name === "search_users") return { users: [{ id: 1, keyword: input.keyword }] };
      throw new Error("secret-token-value");
    }
  });
  const success = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_users", arguments: { keyword: "100001" } } });
  assert.deepEqual(JSON.parse(success.result.content[0].text), { ok: true, data: { users: [{ id: 1, keyword: "100001" }] } });

  const failure = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "submit_application", arguments: {} } });
  assert.equal(failure.result.isError, true);
  assert.equal(JSON.parse(failure.result.content[0].text).error.code, "API_UNAVAILABLE");
  assert.doesNotMatch(failure.result.content[0].text, /secret-token-value/);
});

test("MCP rejects unknown tools at the protocol boundary", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const response = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "raw_zeus_request", arguments: {} } });
  assert.equal(response.error.code, -32602);
});
