import test from "node:test";
import assert from "node:assert/strict";
import { NotionClient, loadAllowlist, syncScreeningResults } from "../src/notion.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const allowlistConfig = {
  allowlistDataSourceId: "allowlist-id",
  allowlistProperties: {
    value: "规则值", type: "类型", enabled: "启用", validFrom: "生效时间", validUntil: "失效时间", note: "备注",
  },
};

test("从 Notion Data Source 读取有效邮箱和域名白名单", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return jsonResponse({ properties: {
        规则值: { type: "title" }, 类型: { type: "select" }, 启用: { type: "checkbox" },
        生效时间: { type: "date" }, 失效时间: { type: "date" }, 备注: { type: "rich_text" },
      } });
    }
    return jsonResponse({ has_more: false, next_cursor: null, results: [
      { properties: {
        规则值: { type: "title", title: [{ plain_text: "Safe@Example.com" }] },
        类型: { type: "select", select: { name: "email" } },
        启用: { type: "checkbox", checkbox: true },
        生效时间: { type: "date", date: null },
        失效时间: { type: "date", date: null },
        备注: { type: "rich_text", rich_text: [] },
      } },
      { properties: {
        规则值: { type: "title", title: [{ plain_text: "partner.com" }] },
        类型: { type: "select", select: { name: "domain" } },
        启用: { type: "checkbox", checkbox: true },
        生效时间: { type: "date", date: null },
        失效时间: { type: "date", date: null },
        备注: { type: "rich_text", rich_text: [] },
      } },
    ] });
  };
  const client = new NotionClient({ token: "test", fetchImpl });
  const allowlist = await loadAllowlist(client, allowlistConfig, new Date("2026-08-05T00:00:00Z"));
  assert.equal(allowlist.emails.has("safe@example.com"), true);
  assert.equal(allowlist.domains.has("partner.com"), true);
  assert.equal(calls[0].options.headers["Notion-Version"], "2026-03-11");
});

const resultNames = {
  title: "标题", messageId: "邮件 ID", recordType: "记录类型", mailTime: "邮件时间", sender: "发件人",
  receiver: "收件人", subject: "主题", classification: "分类", confidence: "置信度", reasons: "判断原因",
  action: "建议动作", fromOrg: "发件组织", toOrg: "收件组织", server: "服务器", scanRange: "扫描范围",
  runId: "运行 ID", handlingStatus: "处理状态",
};
const resultSchema = {
  标题: { type: "title" }, "邮件 ID": { type: "rich_text" }, 记录类型: { type: "select" },
  邮件时间: { type: "date" }, 发件人: { type: "email" }, 收件人: { type: "email" }, 主题: { type: "rich_text" },
  分类: { type: "select" }, 置信度: { type: "select" }, 判断原因: { type: "rich_text" }, 建议动作: { type: "rich_text" },
  发件组织: { type: "rich_text" }, 收件组织: { type: "rich_text" }, 服务器: { type: "rich_text" },
  扫描范围: { type: "rich_text" }, "运行 ID": { type: "rich_text" }, 处理状态: { type: "select" },
};

function analyzed(mid, classification) {
  return {
    mid, receivedAt: "2026-08-05 08:45:06", sender: `${mid}@example.com`, receiver: "to@example.com",
    subject: `主题${mid}`, classification, confidence: "中", reasons: ["原因"], recommendedAction: "复核",
    senderOrg: "A", receiverOrg: "B", serverName: "app", serverIp: "10.0.0.1",
  };
}

test("Notion 同步新增异常并解除已有异常", async () => {
  const writes = [];
  const fetchImpl = async (url, options) => {
    if (options.method === "GET") return jsonResponse({ properties: resultSchema });
    if (url.endsWith("/query")) {
      return jsonResponse({ has_more: false, next_cursor: null, results: [{
        id: "existing-page", properties: { "邮件 ID": { type: "rich_text", rich_text: [{ plain_text: "m1" }] } },
      }] });
    }
    writes.push({ url, method: options.method, body: JSON.parse(options.body) });
    return jsonResponse({ id: "written" });
  };
  const client = new NotionClient({ token: "test", fetchImpl });
  const result = await syncScreeningResults(
    client,
    { resultsDataSourceId: "results-id", resultProperties: resultNames },
    [analyzed("m1", "可信候选"), analyzed("m2", "可疑")],
    { begin: "2026-08-05", end: "2026-08-05", runId: "run1" },
  );
  assert.deepEqual(result, { created: 1, updated: 0, resolved: 1 });
  assert.equal(writes.some((item) => item.method === "PATCH" && item.url.includes("existing-page")), true);
  assert.equal(writes.some((item) => item.method === "POST" && item.url.endsWith("/pages")), true);
});
