import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticLogger } from "../src/diagnostic-logger.js";
import { createRemoteMcpServer } from "../src/http-mcp-server.js";

async function withServer(options, callback) {
  const server = createRemoteMcpServer({ token: "local-secret", ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const echoHandler = async (message) => message.id === undefined
  ? null
  : { jsonrpc: "2.0", id: message.id, result: { method: message.method } };

test("Streamable HTTP supports health, bearer auth, requests, and notifications", async () => {
  await withServer({ handleMessage: echoHandler, token: "local-secret" }, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).transports, ["streamable-http", "sse"]);

    const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    assert.equal(unauthorized.status, 401);

    const headers = { Authorization: "Bearer local-secret", "Content-Type": "application/json" };
    const request = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })
    });
    assert.equal(request.status, 200);
    assert.deepEqual(await request.json(), {
      jsonrpc: "2.0",
      id: 7,
      result: { method: "tools/list" }
    });

    const notification = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    assert.equal(notification.status, 202);
  });
});

test("legacy SSE announces its message endpoint and delivers responses", async () => {
  await withServer({ handleMessage: echoHandler, heartbeatMs: 60000 }, async (baseUrl) => {
    const controller = new AbortController();
    const authorization = { Authorization: "Bearer local-secret" };
    const streamResponse = await fetch(`${baseUrl}/sse`, { headers: authorization, signal: controller.signal });
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    const endpoint = first.match(/data: (\/messages\?sessionId=[^\n]+)/)?.[1];
    assert.ok(endpoint);

    const post = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "initialize" })
    });
    assert.equal(post.status, 202);
    const delivered = decoder.decode((await reader.read()).value);
    assert.match(delivered, /event: message/);
    assert.match(delivered, /\"id\":8/);
    controller.abort();
  });
});

test("remote adapter requires a bearer token even on loopback", () => {
  assert.throws(
    () => createRemoteMcpServer({ handleMessage: echoHandler }),
    /bearer token is required/
  );
});

test("remote adapter rejects untrusted browser origins and non-JSON posts", async () => {
  await withServer({ handleMessage: echoHandler }, async (baseUrl) => {
    const authorization = { Authorization: "Bearer local-secret" };
    const untrusted = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: { ...authorization, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" })
    });
    assert.equal(untrusted.status, 403);

    const wrongContentType = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: { ...authorization, "Content-Type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/list" })
    });
    assert.equal(wrongContentType.status, 415);
  });
});

test("remote adapter accepts explicitly allowed browser origins", async () => {
  await withServer({ handleMessage: echoHandler, allowedOrigins: ["https://dify.example.com"] }, async (baseUrl) => {
    const response = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer local-secret",
        Origin: "https://dify.example.com",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/list" })
    });
    assert.equal(response.status, 200);
  });
});

test("diagnostic logs show tool calls without leaking headers or arguments", async () => {
  const lines = [];
  const logger = createDiagnosticLogger({
    format: "json",
    output: { write: (value) => lines.push(String(value)) },
    now: () => new Date("2026-08-31T12:00:00.000Z")
  });
  await withServer({ handleMessage: echoHandler, token: "local-secret", logger }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer local-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "search_servers", arguments: { keyword: "sensitive-server-name" } }
      })
    });
    assert.equal(response.status, 200);
  });

  const records = lines.map((line) => JSON.parse(line));
  assert.deepEqual(records.map((record) => record.event), ["mcp.call.start", "mcp.call.finish"]);
  assert.equal(records[0].tool, "search_servers");
  assert.equal(records[1].status, "ok");
  assert.equal(records[1].duration_ms >= 0, true);
  const rendered = lines.join("");
  assert.doesNotMatch(rendered, /local-secret/);
  assert.doesNotMatch(rendered, /sensitive-server-name/);
});
