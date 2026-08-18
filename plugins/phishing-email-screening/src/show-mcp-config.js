import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requirePageId(value, name) {
  if (typeof value !== "string" || !value.trim() || /^REPLACE_/i.test(value.trim())) {
    throw new Error(`缺少有效配置：notion.${name}`);
  }
  return value.trim();
}

export function readMcpConfig(configPath = "config/config.local.json") {
  const resolved = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const notion = config.notion ?? {};
  const resultsPageId = requirePageId(notion.resultsPageId, "resultsPageId");
  const executionLogPageId = requirePageId(notion.executionLogPageId, "executionLogPageId");
  if (resultsPageId === executionLogPageId) throw new Error("Notion 结果页和执行日志页不能使用同一个页面 ID");
  return { resultsPageId, executionLogPageId };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    console.log(JSON.stringify(readMcpConfig(process.argv[2]), null, 2));
  } catch (error) {
    console.error(`无法读取 MCP 页面配置：${error.message}`);
    process.exitCode = 3;
  }
}
