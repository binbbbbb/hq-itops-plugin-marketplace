import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticLogger } from "../src/diagnostic-logger.js";
import { createRemoteMcpServer } from "../src/http-mcp-server.js";

async function withServer(options, callback) {
  const server = createRemoteMcpServer({
    authorize: async (authorization) => {
      if (authorization !== "Bearer uat-user-token") {
        const error = new Error("Missing or invalid user token");
        error.code = "AUTH_EXPIRED";
        throw error;
      }
      return { user: { id: 7, badge: "100001" }, allowedTools: new Set(["search_users"]) };
    },
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const echoHandler = async (message, context) => message.id === undefined
  ? null
  : { jsonrpc: "2.0", id: message.id, result: { method: message.method, allowed: [...context.allowedTools] } };

test("Streamable HTTP authorizes every request with its Zeus user token", async () => {
  await withServer({ handleMessage: echoHandler }, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "server-login-permission-application",
      version: "unknown",
      transports: ["streamable-http"]
    });

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const request = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer uat-user-token", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })
    });
    assert.equal(request.status, 200);
    assert.deepEqual(await request.json(), {
      jsonrpc: "2.0", id: 7, result: { method: "tools/list", allowed: ["search_users"] }
    });
  });
});

test("Streamable HTTP rejects forbidden users and the retired SSE endpoints", async () => {
  await withServer({
    handleMessage: echoHandler,
    authorize: async () => { const error = new Error("Denied"); error.code = "PERMISSION_DENIED"; throw error; }
  }, async (baseUrl) => {
    const forbidden = await fetch(`${baseUrl}/mcp`, {
      method: "POST", headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await fetch(`${baseUrl}/sse`)).status, 410);
    assert.equal((await fetch(`${baseUrl}/messages`)).status, 410);
  });
});

test("remote adapter rejects untrusted browser origins and non-JSON posts", async () => {
  await withServer({ handleMessage: echoHandler }, async (baseUrl) => {
    const headers = { Authorization: "Bearer uat-user-token" };
    const untrusted = await fetch(baseUrl + "/mcp", {
      method: "POST", headers: { ...headers, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(untrusted.status, 403);
    const wrongContentType = await fetch(baseUrl + "/mcp", {
      method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "{}"
    });
    assert.equal(wrongContentType.status, 415);
  });
});

test("diagnostic logs omit authorization headers and tool arguments", async () => {
  const lines = [];
  let authorizationTraceId;
  const logger = createDiagnosticLogger({
    format: "json", output: { write: (value) => lines.push(String(value)) }, now: () => new Date("2026-08-31T12:00:00.000Z")
  });
  await withServer({
    handleMessage: echoHandler,
    logger,
    authorize: async (_authorization, diagnostics) => {
      authorizationTraceId = diagnostics.traceId;
      return { user: { id: 7, badge: "100001" }, allowedTools: new Set(["search_users"]) };
    }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer uat-user-token", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "search_users", arguments: { keyword: "sensitive" } } })
    });
    assert.equal(response.status, 200);
  });
  const rendered = lines.join("");
  assert.doesNotMatch(rendered, /uat-user-token|sensitive/);
  const start = JSON.parse(lines.find((line) => line.includes('"event":"mcp.call.start"')));
  assert.equal(start.trace_id, authorizationTraceId);
});
