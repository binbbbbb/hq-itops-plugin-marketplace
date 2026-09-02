import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticLogger } from "../src/diagnostic-logger.js";
import { createRemoteMcpServer } from "../src/http-mcp-server.js";

async function withServer(options, callback) {
  const server = createRemoteMcpServer({ token: "local-test-token", ...options });
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

test("Dify Streamable HTTP 提供健康检查、鉴权、请求和通知", async () => {
  await withServer({ handleMessage: echoHandler }, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "phishing-email-screening",
      transports: ["streamable-http", "sse"],
    });
    const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    assert.equal(unauthorized.status, 401);
    const headers = { Authorization: "Bearer local-test-token", "Content-Type": "application/json" };
    const request = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
    });
    assert.equal(request.status, 200);
    assert.equal((await request.json()).id, 7);
    const notification = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notification.status, 202);
  });
});

test("Dify 兼容 SSE 宣告消息端点并投递响应", async () => {
  await withServer({ handleMessage: echoHandler, heartbeatMs: 60000 }, async (baseUrl) => {
    const controller = new AbortController();
    const authorization = { Authorization: "Bearer local-test-token" };
    const streamResponse = await fetch(`${baseUrl}/sse`, { headers: authorization, signal: controller.signal });
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    const endpoint = first.match(/data: (\/messages\?sessionId=[^\n]+)/)?.[1];
    assert.ok(endpoint);
    const posted = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "initialize" }),
    });
    assert.equal(posted.status, 202);
    const delivered = decoder.decode((await reader.read()).value);
    assert.match(delivered, /event: message/);
    assert.match(delivered, /"id":8/);
    controller.abort();
  });
});

test("远程适配器强制独立 Token、可信 Origin 和 JSON", async () => {
  assert.throws(() => createRemoteMcpServer({ handleMessage: echoHandler }), /bearer token is required/);
  await withServer({ handleMessage: echoHandler }, async (baseUrl) => {
    const authorization = { Authorization: "Bearer local-test-token" };
    const untrusted = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...authorization, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }),
    });
    assert.equal(untrusted.status, 403);
    const wrongType = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "text/plain" },
      body: "{}",
    });
    assert.equal(wrongType.status, 415);
  });
  await withServer({ handleMessage: echoHandler, allowedOrigins: ["https://dify.example.com"] }, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local-test-token",
        Origin: "https://dify.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/list" }),
    });
    assert.equal(allowed.status, 200);
  });
});

test("远程诊断日志不记录 Token 或邮件参数", async () => {
  const lines = [];
  const logger = createDiagnosticLogger({
    format: "json",
    output: { write: (value) => lines.push(String(value)) },
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });
  await withServer({ handleMessage: echoHandler, logger }, async (baseUrl) => {
    await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "scan_phishing_emails", arguments: { begin: "private-mail-value" } },
      }),
    });
  });
  const rendered = lines.join("");
  assert.match(rendered, /scan_phishing_emails/);
  assert.doesNotMatch(rendered, /local-test-token|private-mail-value/);
});
