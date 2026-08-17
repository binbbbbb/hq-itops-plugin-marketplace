#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, todayInTimezone, validateDateRange } from "./config.js";
import { fetchAllMail } from "./coremail.js";
import { resolveCoremailCookie } from "./coremail-auth.js";
import { classifyAll, makeAllowlist } from "./classifier.js";
import { normalizeRecord } from "./normalize.js";
import { createLogger } from "./logger.js";
import { consoleRows, summarize, writeReports } from "./report.js";
import { EXIT_CODES, AppError, AuthExpiredError, ConfigError } from "./errors.js";
import { NotionClient, loadAllowlist, syncScreeningResults, writeRunFailure } from "./notion.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = { noNotion: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--no-notion") args.noNotion = true;
    else if (token === "--json") args.json = true;
    else if (["--begin", "--end", "--page-size", "--config", "--allowlist-file"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ConfigError(`${token} 缺少参数值`);
      index += 1;
      if (token === "--begin") args.begin = value;
      if (token === "--end") args.end = value;
      if (token === "--config") args.configPath = value;
      if (token === "--allowlist-file") args.allowlistFile = value;
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
  console.log("用法: npm run scan -- [--begin YYYY-MM-DD] [--end YYYY-MM-DD] [--page-size 100] [--allowlist-file path] [--no-notion] [--json]");
}

function loadRuntimeAllowlist(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new ConfigError(`运行时白名单文件无效：${error.message}`);
  }
  if (!Array.isArray(parsed.emails) || !Array.isArray(parsed.domains)) {
    throw new ConfigError("运行时白名单必须包含 emails 和 domains 数组");
  }
  return makeAllowlist(parsed);
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
  const config = loadConfig({ configPath: args.configPath, noNotion: args.noNotion });
  const mcpMode = config.notion.mode === "mcp";
  const today = todayInTimezone(config.timezone);
  const { begin, end } = validateDateRange(args.begin ?? today, args.end ?? args.begin ?? today);
  const runId = makeRunId();
  const logger = createLogger(projectRoot, runId);
  let notionClient;

  try {
    logger.info(`开始扫描 ${begin} 至 ${end}`);
    config.coremail.cookie = await resolveCoremailCookie(config.coremail);
    logger.info(config.coremail.auth.mode === "playwright" ? "Coremail 自动登录成功" : "已加载 Coremail Cookie");
    let allowlist;
    if (args.allowlistFile) {
      allowlist = loadRuntimeAllowlist(args.allowlistFile);
      logger.info("已加载 Agent 提供的运行时白名单");
    } else if (args.noNotion || mcpMode) {
      allowlist = makeAllowlist(config.classification.localAllowlist);
      logger.info("本地模式：未访问 Notion，使用本地白名单");
    } else {
      notionClient = new NotionClient(config.notion);
      allowlist = await loadAllowlist(notionClient, config.notion);
      logger.info(`已加载 ${allowlist.rules.length} 条有效 Notion 白名单规则`);
    }

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
      notionMode: args.noNotion ? "disabled" : mcpMode ? "mcp" : "rest",
    });
    const reportPaths = writeReports({ projectRoot, runId, items, summary });
    logger.info(`报告已生成：${reportPaths.reportDir}`);

    if (args.json) console.log(JSON.stringify({ summary, reportPaths }, null, 2));
    else {
      console.table(consoleRows(items));
      console.log(`报告目录：${reportPaths.reportDir}`);
      console.log(`汇总：可信候选 ${summary.counts["可信候选"]}，待确认 ${summary.counts["待确认"]}，可疑 ${summary.counts["可疑"]}`);
    }

    if (!args.noNotion && !mcpMode) {
      const sync = await syncScreeningResults(notionClient, config.notion, items, { begin, end, runId });
      logger.info(`Notion 同步完成：新增 ${sync.created}，更新 ${sync.updated}，解除 ${sync.resolved}`);
      console.log(`Notion：新增 ${sync.created}，更新 ${sync.updated}，解除 ${sync.resolved}`);
    } else if (mcpMode) {
      console.log("Notion MCP 模式：请由 Agent 将异常表格同步到已配置页面。");
    }
    return EXIT_CODES.OK;
  } catch (error) {
    logger.error(`${error.code ?? "ERROR"}: ${error.message}`);
    if (error instanceof AuthExpiredError) {
      if (notionClient) {
        try {
          await writeRunFailure(notionClient, config.notion, { runId, begin, end, error });
        } catch (notionError) {
          logger.error(`Notion 运行失败记录写入失败：${notionError.message}`);
        }
      }
      console.error("Coremail 鉴权失败。自动登录模式请检查本机凭据、Chrome 和网络；静态 Cookie 模式请在本机更新 Cookie。不要在 Agent 对话中粘贴凭据或 Cookie。");
    } else {
      console.error(error.message);
    }
    console.error(`日志：${logger.logPath}`);
    return error instanceof AppError ? error.exitCode : EXIT_CODES.DATA;
  }
}

run()
  .then((exitCode) => { process.exitCode = exitCode; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof AppError ? error.exitCode : EXIT_CODES.DATA;
  });
