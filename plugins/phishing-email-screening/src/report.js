import fs from "node:fs";
import path from "node:path";
import { CLASSIFICATIONS } from "./classifier.js";

const COLUMNS = [
  ["邮件时间", "receivedAt"],
  ["发件人", "sender"],
  ["收件人", "receiver"],
  ["主题", "subject"],
  ["发件组织", "senderOrg"],
  ["收件组织", "receiverOrg"],
  ["服务器", (item) => `${item.serverName || "-"}/${item.serverIp || "-"}`],
  ["白名单", "allowlistStatus"],
  ["分类", "classification"],
  ["置信度", "confidence"],
  ["判断原因", (item) => item.reasons.join("；")],
  ["建议动作", "recommendedAction"],
];

function valueOf(item, accessor) {
  return typeof accessor === "function" ? accessor(item) : item[accessor] ?? "";
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function markdownCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export function summarize(items, metadata = {}) {
  const counts = {
    [CLASSIFICATIONS.TRUSTED]: 0,
    [CLASSIFICATIONS.PENDING]: 0,
    [CLASSIFICATIONS.SUSPICIOUS]: 0,
  };
  for (const item of items) counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  return {
    ...metadata,
    analyzedRecords: items.length,
    counts,
    limitations: [
      "未分析邮件正文、链接和附件",
      "未获取 SPF、DKIM、DMARC 验证结果",
      "分类仅用于元数据初筛，不代表最终安全结论",
    ],
  };
}

export function consoleRows(items) {
  return items.map((item) => ({
    时间: item.receivedAt,
    发件人: item.sender,
    收件人: item.receiver,
    主题: item.subject,
    分类: item.classification,
    置信度: item.confidence,
    原因: item.reasons.join("；"),
  }));
}

export function writeReports({ projectRoot, runId, items, summary }) {
  const reportDir = path.join(projectRoot, "reports", runId);
  fs.mkdirSync(reportDir, { recursive: true });

  const csvLines = [COLUMNS.map(([name]) => csvCell(name)).join(",")];
  for (const item of items) {
    csvLines.push(COLUMNS.map(([, accessor]) => csvCell(valueOf(item, accessor))).join(","));
  }

  const markdown = [
    `# 钓鱼邮件初筛报告`,
    "",
    `- 运行 ID：${summary.runId}`,
    `- 扫描范围：${summary.begin} 至 ${summary.end}（含首尾日期）`,
    `- 接口记录：${summary.totalRecords}`,
    `- 去重后分析：${summary.analyzedRecords}`,
    `- 可信候选：${summary.counts[CLASSIFICATIONS.TRUSTED]}`,
    `- 待确认：${summary.counts[CLASSIFICATIONS.PENDING]}`,
    `- 可疑：${summary.counts[CLASSIFICATIONS.SUSPICIOUS]}`,
    "",
    "> 本报告仅基于邮件元数据、本地白名单和主题关键词进行初筛，不代表最终安全结论。",
    "",
    `| ${COLUMNS.map(([name]) => name).join(" | ")} |`,
    `| ${COLUMNS.map(() => "---").join(" | ")} |`,
    ...items.map((item) => `| ${COLUMNS.map(([, accessor]) => markdownCell(valueOf(item, accessor))).join(" | ")} |`),
    "",
  ].join("\n");

  const csvPath = path.join(reportDir, "analysis.csv");
  const markdownPath = path.join(reportDir, "report.md");
  const jsonPath = path.join(reportDir, "summary.json");
  fs.writeFileSync(csvPath, `\uFEFF${csvLines.join("\r\n")}\r\n`, "utf8");
  fs.writeFileSync(markdownPath, markdown, "utf8");
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return { reportDir, csvPath, markdownPath, jsonPath };
}
