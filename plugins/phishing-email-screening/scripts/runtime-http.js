#!/usr/bin/env node
import { createDiagnosticLogger } from "../src/diagnostic-logger.js";
import { createRemoteMcpServer } from "../src/http-mcp-server.js";

const host = String(process.env.PHISHING_MCP_HOST || "127.0.0.1").trim();
const port = Number(process.env.PHISHING_MCP_PORT || 8002);
const token = String(process.env.PHISHING_MCP_TOKEN || "").trim();
const allowedOrigins = String(process.env.PHISHING_MCP_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("PHISHING_MCP_PORT must be an integer between 1 and 65535.\n");
  process.exit(1);
}
if (!token) {
  process.stderr.write("PHISHING_MCP_TOKEN is required for the remote MCP adapter.\n");
  process.exit(1);
}

const server = createRemoteMcpServer({ token, allowedOrigins, logger: createDiagnosticLogger() });
server.listen(port, host, () => {
  process.stderr.write(`Phishing email screening MCP adapter listening on http://${host}:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

