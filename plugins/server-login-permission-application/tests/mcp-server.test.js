import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMessageHandler, SERVER_INSTRUCTIONS } from "../src/mcp-server.js";
import { createMcpToolRuntime, MCP_TOOLS } from "../src/mcp-tools.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const currentUser = { id: 7, name: "当前用户", badge: "100001", department: "IT", group: "OPS" };

test("plugin configuration declares only UAT-safe runtime variables", () => {
  const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.deepEqual(config.mcpServers["server-login-permission"].env_vars, ["ZEUS_API_BASE", "MCP_KEY"]);
  assert.equal(fs.existsSync(path.resolve(pluginRoot, config.mcpServers["server-login-permission"].args[0])), true);
});

test("tools/list exposes only Zeus-authorized tools", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const response = await handle(
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { allowedTools: new Set(["search_users", "submit_application"]) }
  );
  assert.deepEqual(response.result.tools.map((tool) => tool.name), ["search_users", "submit_application"]);
  assert.equal(MCP_TOOLS.find((tool) => tool.name === "submit_application").annotations.destructiveHint, true);
});

test("runtime resolves the authorized Zeus user by badge for default permission options", async () => {
  const userQueries = [];
  const calls = [];
  const callTool = createMcpToolRuntime({
    config: { apiBase: "https://zeus-uat.example", mcpKey: "server-permission-application", environment: "UAT" },
    clientFactory: () => ({
      async listUsers(keyword) {
        userQueries.push(keyword);
        return { items: [{ id: 7, name: "当前用户", badge: "100001", department: "IT", group: "OPS" }], truncated: false };
      },
      async permissionOptions(input) {
        calls.push(input);
        return { able_permission_type: [{ id: 1, name: "FTP" }], user_info: [{ id: 7, able_duration: [{ id: 30, name: "1个月" }] }] };
      }
    })
  });
  const result = await callTool("get_permission_options", { system_id: 196, server_id: 17205 }, {
    authorization: "Bearer uat-user-token", user: { badge: "100001", name: "当前用户" }, allowedTools: new Set(["get_permission_options"])
  });
  assert.deepEqual(userQueries, ["100001"]);
  assert.deepEqual(calls, [{ systemId: 196, assetId: 17205, userIds: [7] }]);
  assert.deepEqual(result.resolved_user_ids, [7]);
  assert.equal(result.defaulted_to_current_user, true);
});

test("read-only tools do not require a numeric ID in the authorization response", async () => {
  const calls = [];
  const callTool = createMcpToolRuntime({
    config: { apiBase: "https://zeus-uat.example", mcpKey: "server-permission-application", environment: "UAT" },
    clientFactory: () => ({
      async listUsers(keyword) {
        calls.push(keyword);
        return { items: [{ id: 9, name: "候选用户", badge: "100009" }], truncated: false };
      }
    })
  });
  const result = await callTool("search_users", { keyword: "candidate" }, {
    authorization: "Bearer uat-user-token", user: { badge: "100001", name: "当前用户" }, allowedTools: new Set(["search_users"])
  });
  assert.deepEqual(calls, ["candidate"]);
  assert.equal(result.users[0].id, 9);
});

test("runtime rejects calls outside the user authorization", async () => {
  const callTool = createMcpToolRuntime({
    config: { apiBase: "https://zeus-uat.example", mcpKey: "server-permission-application", environment: "UAT" }
  });
  await assert.rejects(
    () => callTool("search_users", { keyword: "100001" }, { authorization: "Bearer user-token", user: currentUser, allowedTools: new Set() }),
    (error) => error.code === "PERMISSION_DENIED"
  );
});

test("MCP initialization advertises the confirmation and no-retry policy", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const response = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { allowedTools: new Set() });
  assert.equal(response.result.protocolVersion, "2025-06-18");
  assert.equal(response.result.serverInfo.version, "2.0.3");
  assert.equal(response.result.instructions, SERVER_INSTRUCTIONS);
  assert.match(response.result.instructions, /确认提交/);
  assert.match(response.result.instructions, /Never retry/);
});

test("MCP rejects unknown tools at the protocol boundary", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const response = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "raw_zeus_request", arguments: {} } }, { allowedTools: new Set() });
  assert.equal(response.error.code, -32602);
});
