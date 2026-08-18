#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, todayInTimezone, validateDateRange } from "./config.js";
import { fetchAllMail } from "./coremail.js";
import { resolveCoremailCookie } from "./coremail-auth.js";
import { classifyAll, makeAllowlist } from "./classifier.js";
import { normalizeRecord } from "./normalize.js";
import { createLogger } from "./logger.js";
import { pruneLocalHistory } from "./history.js";
import { consoleRows, summarize, writeReports } from "./report.js";
import { EXIT_CODES, AppError, AuthExpiredError, ConfigError } from "./errors.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") args.json = true;
    else if (["--begin", "--end", "--page-size", "--config"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ConfigError(`${token} 缺少参数值`);
      index += 1;
      if (token === "--begin") args.begin = value;
      if (token === "--end") args.end = value;
      if (token === "--config") args.configPath = value;
      if (token === "--page-size") args.pageSize = Number(value);
    } else if (token === "--help" || token === "-h") args.help = true;
    else throw new ConfigError(`未知参数：${token}`);
  }
  if (args.pageSize !== undefined && (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 500)) {
    throw new ConfigError("--page-size 必须是 1 到 500 的整数");
  }
  return args;
}

function printHelp() {
  console.log("用法: npm run scan -- [--begin YYYY-MM-DD] [--end YYYY-MM-DD] [--page-size 100] [--json] [--config path]");
}

function makeRunId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return EXIT_CODES.OK;
  }
  const config = loadConfig({ configPath: args.configPath });
  const today = todayInTimezone(config.timezone);
  const { begin, end } = validateDateRange(args.begin ?? today, args.end ?? args.begin ?? today);
  const runId = makeRunId();
  const logger = createLogger(projectRoot, runId);

  const pruneHistory = () => {
    try {
      const result = pruneLocalHistory(projectRoot, 10);
      if (result.removedRunIds.length > 0) logger.info(`已清理 ${result.removedRunIds.length} 次过期本地运行记录`);
    } catch (error) {
      logger.error(`本地历史清理失败：${error.message}`);
    }
  };

  try {
    logger.info(`开始扫描 ${begin} 至 ${end}`);
    config.coremail.cookie = await resolveCoremailCookie(config.coremail);
    logger.info(config.coremail.auth.mode === "playwright" ? "Coremail 自动登录成功" : "已加载 Coremail Cookie");
    const allowlist = makeAllowlist(config.classification.localAllowlist);
    logger.info("已加载本地邮箱和域名白名单");

    const fetched = await fetchAllMail({
      config: config.coremail,
      begin,
      end,
      pageSize: args.pageSize,
    });
    const normalized = fetched.records.map(normalizeRecord);
    const items = classifyAll(normalized, allowlist, config.classification);
    const summary = summarize(items, {
      runId,
      begin,
      end,
      totalRecords: fetched.totalRecords,
      pageCount: fetched.pageCount,
      generatedAt: new Date().toISOString(),
      allowlistSource: "local",
    });
    const reportPaths = writeReports({ projectRoot, runId, items, summary });
    logger.info(`报告已生成：${reportPaths.reportDir}`);

    if (args.json) console.log(JSON.stringify({ summary, reportPaths }, null, 2));
    else {
      console.table(consoleRows(items));
      console.log(`报告目录：${reportPaths.reportDir}`);
      console.log(`汇总：可信候选 ${summary.counts["可信候选"]}，待确认 ${summary.counts["待确认"]}，可疑 ${summary.counts["可疑"]}`);
    }

    pruneHistory();
    return EXIT_CODES.OK;
  } catch (error) {
    logger.error(`${error.code ?? "ERROR"}: ${error.message}`);
    if (error instanceof AuthExpiredError) {
      console.error("Coremail 自动鉴权失败。请检查本机配置的账号密码、Chrome 和网络。插件会根据账号密码生成请求所需的 Cookie，不要在 Agent 对话中粘贴凭据或 Cookie。");
      if (error.diagnosticCode) console.error(`诊断：${error.message}（${error.diagnosticCode}）`);
    } else {
      console.error(error.message);
    }
    console.error(`日志：${logger.logPath}`);
    pruneHistory();
    return error instanceof AppError ? error.exitCode : EXIT_CODES.DATA;
  }
}

run()
  .then((exitCode) => { process.exitCode = exitCode; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof AppError ? error.exitCode : EXIT_CODES.DATA;
  });
