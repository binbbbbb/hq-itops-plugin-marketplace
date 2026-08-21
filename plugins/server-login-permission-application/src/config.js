import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowError } from "./errors.js";

const PRODUCTION_API = "https://zeusapi.huaqin.com";
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
    parsed = new URL(value || PRODUCTION_API);
  } catch (error) {
    throw new WorkflowError("CONFIG_INVALID", undefined, error);
  }
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password) throw new WorkflowError("CONFIG_INVALID");
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

export function loadConfig({ env = process.env, configPath = path.join(pluginRoot, "config", "config.local.json") } = {}) {
  const local = readLocalConfig(configPath);
  const tokenSign = env.ZEUS_TOKEN_SIGN || local.token_sign || "";
  if (!tokenSign) throw new WorkflowError("CONFIG_MISSING_SIGN");
  const apiBase = normalizeApiBase(env.ZEUS_API_BASE || local.api_base || PRODUCTION_API);
  return {
    apiBase,
    tokenSign,
    currentBadge: String(env.ZEUS_CURRENT_BADGE || local.current_badge || "").trim(),
    environment: apiBase === PRODUCTION_API ? "生产环境" : `本地配置环境 (${new URL(apiBase).host})`
  };
}

function badgeFromInstallPath(candidate) {
  const parts = path.resolve(candidate).split(path.sep);
  const index = parts.findIndex((part) => part.toLowerCase() === ".codebuddy" || part.toLowerCase() === ".codex");
  return index > 0 ? parts[index - 1] : "";
}

export function deriveCurrentBadge({ explicitBadge = "", installPath = fileURLToPath(import.meta.url), home = os.homedir(), env = process.env, exists = fs.existsSync } = {}) {
  if (String(explicitBadge).trim()) return String(explicitBadge).trim();
  const fromInstall = badgeFromInstallPath(installPath);
  if (fromInstall) return fromInstall;
  if (exists(path.join(home, ".codebuddy")) || exists(path.join(home, ".codex"))) {
    const fromHome = path.basename(home);
    if (fromHome) return fromHome;
  }
  return String(env.USERNAME || env.USER || "").trim();
}

export { PRODUCTION_API, pluginRoot };
