import crypto from "node:crypto";
import http from "node:http";
import { createMessageHandler } from "./mcp-server.js";

const MAX_BODY_BYTES = 1024 * 1024;
const NOOP_LOGGER = { info() {} };

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  response.end(body);
}

function tokenMatches(request, expectedToken) {
  const authorization = String(request.headers.authorization ?? "");
  if (!authorization.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function normalizeOrigin(value) {
  try {
    const origin = new URL(String(value ?? "").trim()).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

function originAllowed(request, allowedOrigins) {
  const supplied = String(request.headers.origin ?? "").trim();
  if (!supplied) return true;
  const origin = normalizeOrigin(supplied);
  return Boolean(origin && allowedOrigins.has(origin));
}

function hasJsonContentType(request) {
  return String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase() === "application/json";
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    const error = new Error("Invalid JSON", { cause });
    error.statusCode = 400;
    throw error;
  }
}

function resultStatus(response) {
  if (response?.error) return { status: "error", error_code: response.error.code };
  if (!response?.result?.isError) return { status: "ok" };
  try {
    const content = JSON.parse(response.result.content?.[0]?.text ?? "{}");
    return { status: "error", error_code: content?.error?.code ?? "TOOL_ERROR" };
  } catch {
    return { status: "error", error_code: "TOOL_ERROR" };
  }
}

async function processMessages(handleMessage, payload, { logger, transport }) {
  const messages = Array.isArray(payload) ? payload : [payload];
  const responses = [];
  for (const message of messages) {
    const traceId = crypto.randomUUID();
    const method = String(message?.method ?? "invalid");
    const tool = method === "tools/call" ? String(message?.params?.name ?? "unknown") : undefined;
    const startedAt = Date.now();
    logger.info("mcp.call.start", { trace_id: traceId, transport, method, tool, status: "started" });
    try {
      const response = await handleMessage(message);
      if (response) responses.push(response);
      logger.info("mcp.call.finish", {
        trace_id: traceId,
        transport,
        method,
        tool,
        ...(response ? resultStatus(response) : { status: "accepted" }),
        duration_ms: Date.now() - startedAt,
      });
    } catch {
      logger.info("mcp.call.finish", {
        trace_id: traceId,
        transport,
        method,
        tool,
        status: "error",
        error_code: "INTERNAL_ERROR",
        duration_ms: Date.now() - startedAt,
      });
      throw new Error("MCP message processing failed");
    }
  }
  return { batched: Array.isArray(payload), responses };
}

function writeSse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createRemoteMcpServer({
  handleMessage = createMessageHandler(),
  token = "",
  allowedOrigins = [],
  heartbeatMs = 15000,
  logger = NOOP_LOGGER,
} = {}) {
  const expectedToken = String(token).trim();
  if (!expectedToken) throw new Error("MCP adapter bearer token is required");
  const originAllowlist = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));
  const sessions = new Map();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "phishing-email-screening",
        transports: ["streamable-http", "sse"],
      });
    }
    if (!originAllowed(request, originAllowlist)) {
      return sendJson(response, 403, { error: "Forbidden origin" });
    }
    if (!tokenMatches(request, expectedToken)) {
      return sendJson(response, 401, { error: "Unauthorized" }, { "WWW-Authenticate": "Bearer" });
    }
    if (request.method === "POST" && ["/mcp", "/messages"].includes(url.pathname) && !hasJsonContentType(request)) {
      return sendJson(response, 415, { error: "Content-Type must be application/json" });
    }

    if (request.method === "GET" && url.pathname === "/sse") {
      const sessionId = crypto.randomUUID();
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      sessions.set(sessionId, response);
      response.write(`event: endpoint\ndata: /messages?sessionId=${encodeURIComponent(sessionId)}\n\n`);
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), heartbeatMs);
      heartbeat.unref?.();
      request.on("close", () => {
        clearInterval(heartbeat);
        sessions.delete(sessionId);
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/messages") {
      const stream = sessions.get(url.searchParams.get("sessionId") ?? "");
      if (!stream) return sendJson(response, 404, { error: "SSE session not found" });
      try {
        const result = await processMessages(handleMessage, await readJson(request), { logger, transport: "sse" });
        for (const item of result.responses) writeSse(stream, "message", item);
        response.writeHead(202, { "Cache-Control": "no-store" });
        return response.end();
      } catch (error) {
        return sendJson(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : "Internal error" });
      }
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      try {
        const result = await processMessages(handleMessage, await readJson(request), {
          logger,
          transport: "streamable-http",
        });
        if (!result.responses.length) {
          response.writeHead(202, { "Cache-Control": "no-store" });
          return response.end();
        }
        return sendJson(response, 200, result.batched ? result.responses : result.responses[0]);
      } catch (error) {
        return sendJson(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : "Internal error" });
      }
    }

    if (url.pathname === "/mcp") {
      response.setHeader("Allow", "POST");
      return sendText(response, 405, "Method Not Allowed");
    }
    return sendJson(response, 404, { error: "Not Found" });
  });

  server.on("close", () => {
    for (const response of sessions.values()) response.end();
    sessions.clear();
  });
  return server;
}

