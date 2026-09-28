import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowError } from "./errors.js";

export const MCP_KEY = "server-permission-application";
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readLocalConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    throw new WorkflowError("CONFIG_INVALID", undefined, error);
  }
}

function normalizeApiBase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new WorkflowError("CONFIG_INVALID", undefined, error);
  }
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password) throw new WorkflowError("CONFIG_INVALID");
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

export function loadConfig({ env = process.env, configPath = path.join(pluginRoot, "config", "config.local.json") } = {}) {
  const local = readLocalConfig(configPath);
  const mcpKey = String(env.MCP_KEY || local.mcp_key || MCP_KEY).trim();
  if (mcpKey !== MCP_KEY) throw new WorkflowError("CONFIG_INVALID");
  const apiBase = normalizeApiBase(env.ZEUS_API_BASE || local.api_base || "");
  return {
    apiBase,
    mcpKey,
    environment: `UAT (${new URL(apiBase).host})`
  };
}

export { pluginRoot };
