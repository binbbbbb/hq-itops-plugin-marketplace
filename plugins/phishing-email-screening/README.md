# 钓鱼邮件初筛

## Codex 与 CodeBuddy 插件

本仓库可同时作为 Codex 插件和 CodeBuddy 插件市场加载：

- Codex 清单位于 `.codex-plugin/plugin.json`。
- CodeBuddy 插件清单位于 `.codebuddy-plugin/plugin.json`，市场清单位于 `.codebuddy-plugin/marketplace.json`。
- 两个平台都将 `skills/` 声明为 Skill 目录；`skills/phishing-email-screening` 是唯一可编辑 Skill 源。

使用 CodeBuddy 添加 GitHub `main` 分支 ZIP 市场：

```text
https://github.com/binbbbbb/phishing-email-screening/archive/refs/heads/main.zip
```

添加市场后安装 `phishing-email-screening@phishing-email-screening-marketplace`。正式发布时建议创建版本 tag，并改用 `https://github.com/binbbbbb/phishing-email-screening/archive/refs/tags/<tag>.zip`，避免分支内容变化与插件缓存版本不一致。

插件不随安装启动独立 MCP Server。Codex 中的 Notion 依赖继续通过 Skill 的 `agents/openai.yaml` 声明；CodeBuddy 运行前也需要在本机连接可用的 Notion MCP。

基于 Coremail 返回的邮件元数据和 Notion 白名单进行保守初筛。当前接口不含正文、链接、附件及 SPF/DKIM/DMARC，因此结果只分为“可信候选、待确认、可疑”，不代表最终安全结论。

## 配置

1. 将 `config/config.example.json` 复制为 `config/config.local.json`。
2. 在本机配置 `coremail.auth.username` 和 `coremail.auth.password`。扫描启动时会调用 Python Playwright 和本机 Chrome 自动登录，仅在进程内使用获取到的 Cookie；也可以用 `COREMAIL_USERNAME`、`COREMAIL_PASSWORD` 环境变量覆盖。Agent 模式使用 `notion.mode=mcp` 以及白名单、结果、执行日志三个普通页面 ID，不需要也无法从 MCP 导出 Notion Token。
3. 仅在改用 REST/Data Source 模式时，才配置 Notion Token、白名单 Data Source ID 和结果 Data Source ID。

不要把 Coremail 凭据、Cookie 或 Notion Token 粘贴到 Agent 对话、日志或版本库中。自动登录需要 Python Playwright 和 Google Chrome；可用 `python -m pip install playwright` 安装 Python 依赖。静态 Cookie 模式仍可将 `coremail.auth.mode` 设为 `cookie`，并通过 `COREMAIL_COOKIE` 或本地 `coremail.cookie` 提供。环境变量 `NOTION_TOKEN`、`NOTION_ALLOWLIST_DATA_SOURCE_ID`、`NOTION_RESULTS_DATA_SOURCE_ID` 可覆盖本地配置。

GitHub 自动生成的 ZIP 只包含已提交文件；`config/config.local.json` 被明确排除，不会进入插件市场包。安装后应在插件运行目录本地创建该文件，或通过受保护的环境变量提供可覆盖的敏感值，不要把真实凭据提交到 GitHub。

## 运行

```powershell
npm run scan -- --begin 2026-08-01 --end 2026-08-05
```

- `--no-notion`：不访问 Notion，使用配置中的本地白名单且不写结果。
- `--allowlist-file <path>`：读取 Agent 通过 Notion MCP 生成的临时白名单 JSON，格式为 `{ "emails": [], "domains": [] }`。
- `--page-size 50`：调整 Coremail 每页数量。
- `--json`：控制台输出 JSON 摘要，表格仍写入报告文件。
- `--config <path>`：使用其他本地配置文件。

鉴权失效退出码为 `2`；配置错误为 `3`；Notion 错误为 `4`；Coremail或数据错误为 `5`。报告写入 `reports/<run-id>/`，脱敏日志写入 `logs/`。

## Notion 字段

MCP 模式支持普通 Notion 页面：Agent 从白名单页面读取简单表格，把待确认/可疑结果写入结果页面，并把运行摘要写入执行日志页面。结果页面和执行日志页面均按运行 ID 去重、最新记录置顶，只保留最近 3 次运行记录；每次写入后会整体重建页面以清理更早记录。结果记录标题使用 Asia/Shanghai 时间并精确到秒，例如 `2026-08-06 09:21:44（Asia/Shanghai）`。运行 `npm run mcp-config` 可安全显示这三个页面 ID，不会输出 Cookie。

REST 模式下属性名称可在配置中映射。白名单默认包含规则值、类型（`email`/`domain`）、启用、生效时间、失效时间、备注。结果库默认使用示例配置列出的属性；程序启动时会校验属性是否存在且类型兼容。

结果库的 Select/Status 属性应预先包含运行会使用的选项：记录类型 `EMAIL`、`RUN`；分类 `可信候选`、`待确认`、`可疑`、`运行失败`；置信度 `低`、`中`、`高`；处理状态 `待处理`、`已解除`、`鉴权失败`。
