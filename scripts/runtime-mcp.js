#!/usr/bin/env node
// CodeBuddy 本地工作区市场模式下，插件 .mcp.json 中的相对路径
// "scripts/runtime-mcp.js" 会以仓库根目录为基准解析，所有插件共享本入口。
// 通过 argv（.mcp.json args 第二项，各模式均透传）或 HQ_ITOPS_MCP_PLUGIN
// 环境变量确定目标插件，分发到对应插件的 MCP server。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginName = process.argv[2] || process.env.HQ_ITOPS_MCP_PLUGIN;
if (!pluginName || !/^[\w-]+$/.test(pluginName)) {
  console.error("runtime-mcp: plugin name argument is missing; cannot dispatch to a plugin MCP server.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "plugins", pluginName, "scripts", "runtime-mcp.js");
if (!fs.existsSync(entry)) {
  console.error(`runtime-mcp: plugin entry not found: ${entry}`);
  process.exit(1);
}

await import(pathToFileURL(entry).href);
