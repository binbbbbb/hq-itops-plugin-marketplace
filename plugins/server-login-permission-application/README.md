# Server Login Permission Application

该插件将自然语言服务器登录权限需求转换为 Zeus 工单。Skill 负责收集字段和二次确认，本地 STDIO MCP 负责实时查询、校验、准备和提交。

MCP 暴露以下工具：

- `search_users`
- `search_servers`
- `get_permission_options`
- `prepare_application`
- `submit_application`

`search_servers` 默认通过 `asset_info_list` 查询全量资产，不要求先选领域/系统。每个资产候选会保留接口返回的领域和系统 ID/名称；选定资产后，`prepare_application` 可自动使用其所属领域和系统。显式传入领域/系统时仍会按原方式限定查询范围。同一张申请中的多个资产必须属于同一领域和系统。

只有 `submit_application` 会写入 Zeus。它要求 `prepare_application` 生成的一次性确认 ID，以及用户精确回复 `确认提交`。提交请求不会自动重试。

## 本地配置

复制 `config/config.example.json` 为 `config/config.local.json`，填入 Token 换取接口所需的签名；也可以设置环境变量 `ZEUS_TOKEN_SIGN`。本地配置已被忽略，禁止提交到版本库。

```json
{
  "token_sign": "replace-with-local-secret"
}
```

可选配置：

- `api_base`：默认 `https://zeusapi.huaqin.com`，仅能通过本地配置或 `ZEUS_API_BASE` 修改。
- `current_badge`：仅在无法从 CodeBuddy/Codex 安装路径或用户主目录可靠推导工号时使用。

Token 仅保存在当前进程内，不会写入本地文件或输出。插件不会自动重试最终 POST。

通过插件市场安装时，本地忽略文件不会进入安装缓存，因此推荐在启动 Codex 或 CodeBuddy 前设置 `ZEUS_TOKEN_SIGN` 环境变量；`.mcp.json` 仅声明转发变量名，不保存变量值。源码开发模式仍可使用 `config/config.local.json`。

## Codex 部署

Codex 安装插件后会读取根目录 `.mcp.json` 并启动 `node scripts/runtime-mcp.js`。本地市场已配置时可执行：

```powershell
codex plugin add server-login-permission-application@hq-itops-plugin-marketplace
```

安装或更新后重启 Codex，在对话中输入 `/mcp`，确认 `server-login-permission` 及 5 个工具已经加载。

## CodeBuddy 部署

CodeBuddy 2.109.2 会自动发现插件根目录的 `.mcp.json`。通过本仓库市场安装或更新插件后重启 CodeBuddy，再执行 `/mcp` 检查服务：

```text
/plugin marketplace add https://github.com/binbbbbb/hq-itops-plugin-marketplace.git
/plugin install server-login-permission-application@hq-itops-plugin-marketplace
/mcp
```

如果已安装旧版本，先在插件管理界面更新；若客户端没有更新入口，则卸载后重新安装。不要在 `.mcp.json` 中写入 Token 或签名。

## 开发验证

```powershell
npm test
node scripts/runtime-mcp.js
node scripts/runtime-cli.js systems
```

`runtime-mcp.js` 通过标准输入输出运行 MCP。旧 CLI 仅保留用于兼容和底层调试；正常对话必须使用 MCP。
