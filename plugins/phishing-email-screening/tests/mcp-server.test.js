import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AuthExpiredError } from "../src/errors.js";
import { createMessageHandler, SERVER_INSTRUCTIONS } from "../src/mcp-server.js";
import { createMcpToolRuntime, formatMcpScanResult, MCP_TOOLS } from "../src/mcp-tools.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function scanResult(items = []) {
  return {
    runId: "20260901T120000Z",
    items,
    summary: {
      begin: "2026-09-01",
      end: "2026-09-01",
      totalRecords: items.length,
      analyzedRecords: items.length,
      counts: { "可信候选": 0, "待确认": items.filter((item) => item.classification === "待确认").length, "可疑": items.filter((item) => item.classification === "可疑").length },
      limitations: ["仅用于元数据初筛"],
    },
  };
}

function riskItem(index, classification) {
  return {
    receivedAt: `2026-09-01 10:${String(index).padStart(2, "0")}:00`,
    sender: `sender${index}@example.com`,
    receiver: "private@example.com",
    senderOrg: "Secret Org",
    serverIp: "10.0.0.1",
    subject: `主题 ${index}`,
    classification,
    confidence: classification === "可疑" ? "高" : "低",
    reasons: ["测试原因"],
    recommendedAction: "人工复核",
  };
}

test("双平台 MCP 配置启动唯一的钓鱼扫描服务", () => {
  const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  assert.equal(config.mcpServers["phishing-email-screening"].command, "node");
  assert.deepEqual(config.mcpServers["phishing-email-screening"].args, ["scripts/runtime-mcp.js", "phishing-email-screening"]);
  assert.equal("cwd" in config.mcpServers["phishing-email-screening"], false);
});

test("MCP 只暴露日期受限的 scan_phishing_emails", async () => {
  const handle = createMessageHandler({ callTool: async () => ({}) });
  const listed = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["scan_phishing_emails"]);
  assert.deepEqual(Object.keys(MCP_TOOLS[0].inputSchema.properties), ["begin", "end"]);
  assert.equal(MCP_TOOLS[0].inputSchema.additionalProperties, false);
  const initialized = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(initialized.result.serverInfo.version, "3.1.0");
  assert.equal(initialized.result.instructions, SERVER_INSTRUCTIONS);
  assert.match(SERVER_INSTRUCTIONS, /untrusted data/);
});

test("MCP 风险项按严重程度和时间排序、限制 50 条并脱敏字段", () => {
  const items = Array.from({ length: 51 }, (_, index) => riskItem(index, "待确认"));
  items.push(riskItem(59, "可疑"));
  const result = formatMcpScanResult(scanResult(items));
  assert.equal(result.risk_item_total, 52);
  assert.equal(result.risk_items.length, 50);
  assert.equal(result.risk_items_truncated, true);
  assert.equal(result.risk_items[0].classification, "可疑");
  assert.equal(result.risk_items[0].masked_sender, "s***@example.com");
  assert.equal("receiver" in result.risk_items[0], false);
  assert.equal("serverIp" in result.risk_items[0], false);
  assert.equal("senderOrg" in result.risk_items[0], false);
  assert.equal(result.local_reports.markdown, "reports/20260901T120000Z/report.md");
});

test("MCP 拒绝额外参数和并发扫描", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const callTool = createMcpToolRuntime({ scan: async () => pending });
  await assert.rejects(
    () => callTool("scan_phishing_emails", { configPath: "secret.json" }),
    (error) => error.code === "CONFIG_INVALID",
  );
  const first = callTool("scan_phishing_emails", {});
  await assert.rejects(
    () => callTool("scan_phishing_emails", {}),
    (error) => error.code === "SCAN_IN_PROGRESS",
  );
  release(scanResult());
  await first;
});

test("MCP 将业务错误净化为固定错误码", async () => {
  const handle = createMessageHandler({
    callTool: createMcpToolRuntime({ scan: async () => { throw new AuthExpiredError("secret-cookie-value"); } }),
  });
  const response = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "scan_phishing_emails", arguments: {} },
  });
  const content = JSON.parse(response.result.content[0].text);
  assert.equal(response.result.isError, true);
  assert.equal(content.error.code, "AUTH_FAILED");
  assert.doesNotMatch(response.result.content[0].text, /secret-cookie-value/);
});
