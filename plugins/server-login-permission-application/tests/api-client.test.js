import assert from "node:assert/strict";
import test from "node:test";
import { normalizePermissionOptions, ZeusClient } from "../src/api-client.js";

function response(body, { ok = true, status = 200, url = "", redirected = false } = {}) {
  return { ok, status, url, redirected, async json() { return body; } };
}

function client(fetchImpl) {
  return new ZeusClient({ apiBase: "https://zeus-uat.example", authorization: "Bearer uat-user-token", fetchImpl });
}

test("MCP authorization forwards the request's Zeus token and preserves the Zeus authorization user", async () => {
  const calls = [];
  const result = await client(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response({ data: {
      user: { badge: "100001", name: "Test User" },
      authorization: { access: true, mcp_key: "server-permission-application", allowed_tools: ["search_users", "unknown"] }
    } });
  }).getMcpAuthorization("server-permission-application");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/mcp/me");
  assert.equal(calls[0].url.searchParams.get("mcp_key"), "server-permission-application");
  assert.equal(calls[0].options.headers.Authorization, "Bearer uat-user-token");
  assert.deepEqual(result.user, { badge: "100001", name: "Test User" });
  assert.deepEqual(result.allowedTools, ["search_users", "unknown"]);
});

test("submission forwards the supplied Zeus token exactly once", async () => {
  const calls = [];
  const result = await client(async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ code: 100000, data: 42 });
  }).submit({ field_id: 1, system_id: 2, description: "reason", submit_type: 2, permissions: [] });
  assert.equal(result, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer uat-user-token");
});

test("authentication and submission failures use safe workflow errors", async () => {
  await assert.rejects(
    () => client(async () => response({}, { ok: false, status: 401 })).listUsers("100001"),
    (error) => error.code === "AUTH_EXPIRED"
  );
  await assert.rejects(
    () => client(async () => { throw new Error("network detail"); }).submit({}),
    (error) => error.code === "SUBMISSION_UNCERTAIN" && !/network detail/.test(error.message)
  );
});

test("Zeus diagnostics correlate a request without recording its token or query", async () => {
  const logs = [];
  const logger = { info(event, fields) { logs.push({ event, fields }); } };
  const diagnosticClient = new ZeusClient({
    apiBase: "https://zeus-uat.example",
    authorization: "Bearer uat-user-token",
    traceId: "trace-123",
    logger,
    fetchImpl: async () => response({}, { ok: false, status: 401, url: "https://zeus-uat.example/api/user" })
  });
  await assert.rejects(() => diagnosticClient.listUsers("sensitive-keyword"), (error) => error.code === "AUTH_EXPIRED");
  assert.deepEqual(logs.map((entry) => entry.event), ["zeus.request.start", "zeus.request.finish"]);
  assert.equal(logs[0].fields.trace_id, "trace-123");
  assert.equal(logs[0].fields.upstream_origin, "https://zeus-uat.example");
  assert.equal(logs[0].fields.upstream_path, "/api/user");
  assert.equal(logs[0].fields.authorization_present, "true");
  assert.match(logs[0].fields.authorization_fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(logs[1].fields.upstream_http_status, 401);
  assert.equal(logs[1].fields.redirected, "false");
  assert.doesNotMatch(JSON.stringify(logs), /uat-user-token|sensitive-keyword/);
});

test("global asset search omits system_id and preserves field/system metadata", async () => {
  let assetUrl;
  const result = await client(async (url) => {
    assetUrl = new URL(url);
    return response({ code: 100000, data: [{
      id: 913, host_name: "srv-01", field_id: 57, field_name: "物流领域", system_id: 10, system_name: "物流管理系统"
    }] });
  }).listAssets({ keyword: "srv-01" });
  assert.equal(assetUrl.searchParams.has("system_id"), false);
  assert.equal(result.items[0].field_name, "物流领域");
  assert.equal(result.items[0].system_name, "物流管理系统");
});

test("keyword asset searches normalize Zeus generic no-result responses to ASSET_NOT_FOUND", async () => {
  await assert.rejects(
    () => client(async () => response({ code: 400001, msg: "no matching assets" })).listAssets({ keyword: "not-found" }),
    (error) => error.code === "ASSET_NOT_FOUND"
  );
  await assert.rejects(
    () => client(async () => response({ code: 400001, msg: "unexpected backend rejection" })).listAssets({}),
    (error) => error.code === "API_REJECTED"
  );
});

test("permission options normalize alternate labels and per-user nested types", () => {
  assert.deepEqual(normalizePermissionOptions({
    able_permission_type: [],
    userInfo: [{
      user_id: 7,
      permission_type_options: [{ dict_id: 3, label: "FTP" }],
      duration_options: [{ dict_value: 30, title: "1个月" }]
    }]
  }), {
    able_permission_type: [{ id: 3, name: "FTP" }],
    user_info: [{ id: 7, able_duration: [{ id: 30, name: "1个月" }], able_permission_type: [{ id: 3, name: "FTP" }] }]
  });
});
