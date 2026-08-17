import fs from "node:fs";
import path from "node:path";

const configPath = path.resolve(process.argv[2] || "config/config.local.json");
try {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const notion = config.notion ?? {};
  console.log(JSON.stringify({
    mode: notion.mode,
    allowlistPageId: notion.allowlistPageId,
    resultsPageId: notion.resultsPageId,
    executionLogPageId: notion.executionLogPageId,
  }, null, 2));
} catch (error) {
  console.error(`无法读取 MCP 页面配置：${error.message}`);
  process.exitCode = 3;
}
