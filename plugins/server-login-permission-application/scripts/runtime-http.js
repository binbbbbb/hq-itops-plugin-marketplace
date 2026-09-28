#!/usr/bin/env node
import fs from "node:fs";
import { createDiagnosticLogger } from "../src/diagnostic-logger.js";
import { createRemoteMcpServer } from "../src/http-mcp-server.js";
import { createMessageHandler } from "../src/mcp-server.js";
import { createMcpToolRuntime, createRequestAuthorizer } from "../src/mcp-tools.js";

const host = String(process.env.MCP_ADAPTER_HOST || "127.0.0.1").trim();
const port = Number(process.env.MCP_ADAPTER_PORT || 8001);
const allowedOrigins = String(process.env.MCP_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const packageMetadata = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("MCP_ADAPTER_PORT must be an integer between 1 and 65535.\n");
  process.exit(1);
}
const logger = createDiagnosticLogger();
const server = createRemoteMcpServer({
  authorize: createRequestAuthorizer({ logger }),
  handleMessage: createMessageHandler({ callTool: createMcpToolRuntime({ logger }) }),
  allowedOrigins,
  serviceName: packageMetadata.name,
  serviceVersion: packageMetadata.version,
  logger
});
server.listen(port, host, () => {
  process.stderr.write(`Server login permission MCP adapter listening on http://${host}:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
