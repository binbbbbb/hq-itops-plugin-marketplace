# 钓鱼邮件初筛

## Codex 与 CodeBuddy 插件

该目录是 `phishing-email-screening` 插件的唯一源码，包含：

- `.codex-plugin/plugin.json`：Codex 插件清单。
- `.codebuddy-plugin/plugin.json`：CodeBuddy 插件清单。
- `skills/phishing-email-screening`：两个平台共用的 Skill。
- `src/`、`scripts/`、`tests/`：运行代码和测试。

插件不启动独立 MCP Server。Codex 的可选 Notion 依赖通过 Skill 的 `agents/openai.yaml` 声明；CodeBuddy 需要连接可用的 Notion MCP 才能发布扫描记录。

本工具基于 Coremail 返回的邮件元数据、本地邮箱与域名白名单以及 CAC 主题黑名单进行保守初筛。数据源不包含正文、链接、附件及 SPF/DKIM/DMARC，因此分类结果不代表最终安全结论。

## 配置

1. 将 `config/config.example.json` 复制为 `config/config.local.json`。
2. 在本机配置 `coremail.auth.username` 和 `coremail.auth.password`，或使用 `COREMAIL_USERNAME`、`COREMAIL_PASSWORD` 环境变量。
3. 在 `classification.localAllowlist.emails` 和 `classification.localAllowlist.domains` 中维护本地白名单；域名可带或不带开头的 `@`，匹配时会统一为小写。
4. 在 `classification.cacSubjectBlacklist` 中维护 CAC 主题关键词。任一关键词命中即判为“可疑 / 高置信”。
5. 如需发布到 Notion，仅配置 `notion.resultsPageId` 和 `notion.executionLogPageId` 两个不同的普通页面 ID，不需要 Notion Token。

不要把 Coremail 凭据或 Cookie 提交到版本库或粘贴到 Agent 对话中。`config/config.local.json`、日志、报告和工作文件均被版本控制忽略。

## Python 与 Playwright 运行环境

自动登录模式不使用全局 Python 环境中的 Playwright，也不需要在共享配置中填写 Python 绝对路径。首次扫描时，插件会：

1. 查找 Python 3.9 或更高版本；Windows 优先尝试 `py -3`，然后尝试 `python3` 和 `python`。
2. 在当前用户的应用数据目录创建版本化的插件专属 venv。
3. 仅在该 venv 内安装 `requirements.lock` 声明的锁定依赖。
4. 后续扫描复用已校验的 venv。

可以在首次扫描前主动初始化或检查：

```powershell
npm run setup
npm run doctor
```

企业网络可通过 pip 标准环境变量（例如 `PIP_INDEX_URL`）使用内部镜像。可选的 `PHISHING_EMAIL_SCREENING_PYTHON` 环境变量只用于指定创建 venv 的基础解释器；`PHISHING_EMAIL_SCREENING_RUNTIME_DIR` 可用于覆盖用户级运行时目录。两者都不需要写入 `config.local.json`。

## 运行与测试

```powershell
npm run doctor
npm run scan -- --begin 2026-08-01 --end 2026-08-05
npm test
```

- `--page-size 50`：调整 Coremail 每页数量。
- `--json`：控制台输出 JSON 摘要。
- `--config <path>`：使用其他本地配置文件。

报告写入 `reports/<run-id>/`，脱敏日志写入 `logs/`。报告和日志按统一的运行 ID 仅保留最近 10 次，失败运行的日志也计入。

CLI 始终只生成本地结果。Skill 会先验证两个 Notion 页面 ID、MCP 读写能力和页面可访问性；只有预检全部成功才发布异常结果与执行日志，否则保留本地结果并跳过所有 Notion 写入。

## 发布

修改需要被用户获取的内容时，同时升级两套插件清单中的版本，然后在市场仓库根目录运行：

```powershell
npm run generate
npm test
```

CodeBuddy 使用根目录 `.codebuddy-plugin/marketplace.json` 安装此插件。
