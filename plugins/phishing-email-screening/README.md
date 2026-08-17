# 钓鱼邮件初筛

## Codex 与 CodeBuddy 插件

该目录是 `phishing-email-screening` 插件的唯一源码，包含：

- `.codex-plugin/plugin.json`：Codex 插件清单。
- `.codebuddy-plugin/plugin.json`：CodeBuddy 插件清单。
- `skills/phishing-email-screening`：两个平台共用的 Skill。
- `src/`、`scripts/`、`tests/`：运行代码和测试。

插件不启动独立 MCP Server。Codex 的 Notion 依赖通过 Skill 的 `agents/openai.yaml` 声明；CodeBuddy 运行前也需要连接可用的 Notion MCP。

本工具基于 Coremail 返回的邮件元数据和 Notion 白名单进行保守初筛。数据源不包含正文、链接、附件及 SPF/DKIM/DMARC，因此分类结果不代表最终安全结论。

## 配置

1. 将 `config/config.example.json` 复制为 `config/config.local.json`。
2. 在本机配置 `coremail.auth.username` 和 `coremail.auth.password`，或使用 `COREMAIL_USERNAME`、`COREMAIL_PASSWORD` 环境变量。
3. MCP 模式配置 `notion.mode=mcp` 以及白名单、结果、执行日志三个普通页面 ID，不需要 Notion Token。
4. 只有改用 REST/Data Source 模式时，才配置 Notion Token 和 Data Source ID。

不要把 Coremail 凭据、Cookie 或 Notion Token 提交到版本库或粘贴到 Agent 对话中。`config/config.local.json`、日志、报告和工作文件均被版本控制忽略。

## 运行与测试

```powershell
npm run scan -- --begin 2026-08-01 --end 2026-08-05
npm test
```

- `--no-notion`：使用本地白名单且不写入 Notion。
- `--allowlist-file <path>`：读取 Agent 通过 Notion MCP 生成的临时白名单。
- `--page-size 50`：调整 Coremail 每页数量。
- `--json`：控制台输出 JSON 摘要。
- `--config <path>`：使用其他本地配置文件。

报告写入 `reports/<run-id>/`，脱敏日志写入 `logs/`。

## 发布

修改需要被用户获取的内容时，同时升级两套插件清单中的版本，然后在市场仓库根目录运行：

```powershell
npm run generate
npm test
```

CodeBuddy 使用根目录 `.codebuddy-plugin/marketplace.json` 安装此插件。
