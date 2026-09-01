#!/usr/bin/env node
import { createDiagnosticLogger } from "../src/diagnostic-logger.js";
import { createRemoteMcpServer } from "../src/http-mcp-server.js";

const host = String(process.env.MCP_ADAPTER_HOST || "127.0.0.1").trim();
const port = Number(process.env.MCP_ADAPTER_PORT || 8001);
const token = String(process.env.MCP_ADAPTER_TOKEN || "").trim();
const allowedOrigins = String(process.env.MCP_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("MCP_ADAPTER_PORT must be an integer between 1 and 65535.\n");
  process.exit(1);
}
if (!token) {
  process.stderr.write("MCP_ADAPTER_TOKEN is required for the remote MCP adapter.\n");
  process.exit(1);
}

const server = createRemoteMcpServer({ token, allowedOrigins, logger: createDiagnosticLogger() });
server.listen(port, host, () => {
  process.stderr.write(`Server login permission MCP adapter listening on http://${host}:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
