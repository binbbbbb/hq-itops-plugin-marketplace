import readline from "node:readline";
import { safeErrorJson } from "./errors.js";
import { createMcpToolRuntime, MCP_TOOLS } from "./mcp-tools.js";

export const SERVER_INSTRUCTIONS = "Apply for Zeus server-login permission only. Resolve every user, server, permission type, and duration from live tools. prepare_application never submits. Display its full summary and keep confirmation_id private. A host with a stable opaque conversation key may pass the same conversation_key to prepare_application and submit_application instead of carrying confirmation_id. Never send both identifiers. Call submit_application only after the user's exact standalone phrase 确认提交. Never retry submit_application, including after timeout or an uncertain result.";

function rpcError(code, message, data) {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

export function createMessageHandler({ callTool = createMcpToolRuntime() } = {}) {
  return async function handleMessage(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return { jsonrpc: "2.0", id: message?.id ?? null, error: rpcError(-32600, "Invalid Request") };
    }

    const notification = message.id === undefined;
    if (notification) return null;

    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: String(message.params?.protocolVersion ?? "2024-11-05"),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "server-login-permission-application", version: "1.4.2" },
            instructions: SERVER_INSTRUCTIONS
          }
        };
      case "ping":
        return { jsonrpc: "2.0", id: message.id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id: message.id, result: { tools: MCP_TOOLS } };
      case "tools/call": {
        const name = message.params?.name;
        if (!MCP_TOOLS.some((tool) => tool.name === name)) {
          return { jsonrpc: "2.0", id: message.id, error: rpcError(-32602, "Unknown tool") };
        }
        try {
          const data = await callTool(name, message.params?.arguments ?? {});
          return {
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }] }
          };
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: JSON.stringify(safeErrorJson(error)) }], isError: true }
          };
        }
      }
      default:
        return { jsonrpc: "2.0", id: message.id, error: rpcError(-32601, "Method not found") };
    }
  };
}

export function startStdioServer({ input = process.stdin, output = process.stdout, callTool } = {}) {
  const handleMessage = createMessageHandler({ ...(callTool ? { callTool } : {}) });
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  let queue = Promise.resolve();

  lines.on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: rpcError(-32700, "Parse error") })}\n`);
        return;
      }
      const response = await handleMessage(message);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }).catch(() => {
      output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: rpcError(-32603, "Internal error") })}\n`);
    });
  });

  return lines;
}
