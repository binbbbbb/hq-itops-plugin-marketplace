import crypto from "node:crypto";
import http from "node:http";
import { createMessageHandler } from "./mcp-server.js";

const MAX_BODY_BYTES = 1024 * 1024;
const NOOP_LOGGER = { info() {} };

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  response.end(body);
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

async function processMessages(handleMessage, payload, { logger, transport, context }) {
  const messages = Array.isArray(payload) ? payload : [payload];
  const responses = [];
  for (const message of messages) {
    const traceId = context.traceId ?? crypto.randomUUID();
    const method = String(message?.method ?? "invalid");
    const tool = method === "tools/call" ? String(message?.params?.name ?? "unknown") : undefined;
    const startedAt = Date.now();
    logger.info("mcp.call.start", { trace_id: traceId, transport, method, tool, status: "started" });
    try {
      const response = await handleMessage(message, context);
      if (response) responses.push(response);
      logger.info("mcp.call.finish", {
        trace_id: traceId,
        transport,
        method,
        tool,
        ...(response ? resultStatus(response) : { status: "accepted" }),
        duration_ms: Date.now() - startedAt
      });
    } catch {
      logger.info("mcp.call.finish", {
        trace_id: traceId,
        transport,
        method,
        tool,
        status: "error",
        error_code: "INTERNAL_ERROR",
        duration_ms: Date.now() - startedAt
      });
      throw new Error("MCP message processing failed");
    }
  }
  return { batched: Array.isArray(payload), responses };
}

export function createRemoteMcpServer({
  handleMessage = createMessageHandler(),
  authorize,
  allowedOrigins = [],
  serviceName = "server-login-permission-application",
  serviceVersion = "unknown",
  logger = NOOP_LOGGER
} = {}) {
  if (typeof authorize !== "function") throw new Error("MCP request authorizer is required");
  const originAllowlist = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: String(serviceName),
        version: String(serviceVersion),
        transports: ["streamable-http"]
      });
    }

    if (!originAllowed(request, originAllowlist)) {
      return sendJson(response, 403, { error: "Forbidden origin" });
    }

    if (url.pathname === "/sse" || url.pathname === "/messages") return sendJson(response, 410, { error: "SSE is not enabled for UAT" });

    if (request.method === "POST" && url.pathname === "/mcp" && !hasJsonContentType(request)) {
      return sendJson(response, 415, { error: "Content-Type must be application/json" });
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      try {
        let context;
        const traceId = crypto.randomUUID();
        try {
          context = await authorize(request.headers.authorization, { traceId });
          context = { ...context, traceId: context?.traceId ?? traceId };
        } catch (error) {
          const statusCode = error?.code === "AUTH_EXPIRED" ? 401 : 403;
          return sendJson(response, statusCode, { error: statusCode === 401 ? "Unauthorized" : "Forbidden" }, statusCode === 401 ? { "WWW-Authenticate": "Bearer" } : {});
        }
        const result = await processMessages(handleMessage, await readJson(request), {
          logger,
          transport: "streamable-http",
          context
        });
        if (!result.responses.length) {
          response.writeHead(202, { "Cache-Control": "no-store" });
          return response.end();
        }
        return sendJson(response, 200, result.batched ? result.responses : result.responses[0]);
      } catch (error) {
        return sendJson(response, error.statusCode ?? 500, {
          error: error.statusCode ? error.message : "Internal error"
        });
      }
    }

    if (url.pathname === "/mcp") {
      response.setHeader("Allow", "POST");
      return sendText(response, 405, "Method Not Allowed");
    }
    return sendJson(response, 404, { error: "Not Found" });
  });

  return server;
}
