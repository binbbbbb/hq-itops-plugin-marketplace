# Server Login Permission Application

该插件将自然语言服务器登录权限需求转换为 Zeus 工单。Skill 负责收集字段和二次确认，本地 STDIO MCP 负责实时查询、校验、准备和提交。

MCP 暴露以下工具：

- `search_users`
- `search_servers`
- `get_permission_options`
- `prepare_application`
- `submit_application`

`search_servers` 默认通过 `asset_info_list` 查询全量资产，不要求先选领域/系统。每个资产候选会保留接口返回的领域和系统 ID/名称；选定资产后，`prepare_application` 可自动使用其所属领域和系统。显式传入领域/系统时仍会按原方式限定查询范围。同一张申请中的多个资产必须属于同一领域和系统。

`get_permission_options` 传入明确申请人时使用非空 `user_ids`；默认申请人为当前用户时应省略 `user_ids`，MCP 会根据本地当前工号解析规范用户 ID。工具会把 Zeus 常见的顶层或用户级权限/期限字段归一化为 `able_permission_type` 和 `user_info`。显式空数组仍会被拒绝，避免把“默认本人”和“申请人缺失”混为一谈。

只有 `submit_application` 会写入 Zeus。它要求用户精确回复 `确认提交`，并使用以下两种确认关联方式之一：传统客户端私下保存 `prepare_application` 返回的一次性确认 ID；或对话流平台在准备和提交时传入同一个稳定 `conversation_key`。后者会与当前工号一起哈希绑定，原始会话标识不会写入确认记录。提交请求不会自动重试。

## Dify 对话流配置

Dify 无需保存或展示 `confirmation_id`，也不需要代码执行节点或变量赋值节点。使用最短主链路：

```text
开始 -> Agent -> 直接回复
```

开始节点只保留业务输入（例如服务器 IP/主机名），不要新增 `confirmation_id` 输入字段。Agent 的 Query 使用 `sys.query`，直接回复节点引用 `Agent.text`。在 Agent 指令中通过变量选择器插入 `sys.conversation_id`，并加入以下约束：

```text
当前 Dify 会话标识：{{sys.conversation_id}}

每次调用 prepare_application 时，必须传入：
conversation_key = 当前 Dify 会话标识

只有当用户本轮去除首尾空格后精确等于“确认提交”时，才能调用 submit_application，并传入：
conversation_key = 当前 Dify 会话标识
confirmation_phrase = 确认提交

使用 conversation_key 模式时：
- 不得向 prepare_application 或 submit_application 传 confirmation_id；
- 修改申请后，使用相同 conversation_key 重新调用 prepare_application，不传 previous_confirmation_id；
- 不得向用户展示 conversation_key 或 confirmation_id；
- submit_application 不得自动重试。
```

Agent 保留五个 MCP 工具。若 Dify 的工具参数面板支持变量绑定，优先把 `prepare_application.conversation_key` 和 `submit_application.conversation_key` 固定绑定到 `sys.conversation_id`，避免由模型复制会话标识。`confirmation_phrase` 不要固定预填，仍由 Agent 仅在用户精确确认后传入。若提交超时或返回 `SUBMISSION_UNCERTAIN`，只提示前往 Zeus“我的申请”核对，不得再次调用。必须在同一个 Dify 会话中完成准备和确认；新建聊天会得到新的会话标识，不会命中旧确认。

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

## 本地远程 MCP 联调

插件保留原有 STDIO MCP，同时提供一个不依赖第三方包的本地联调适配器：

- Streamable HTTP：`POST /mcp`
- 旧版 SSE：`GET /sse`，消息发送到服务端返回的 `/messages?sessionId=...`
- 健康检查：`GET /health`

默认仅监听 `127.0.0.1:8001`。无论监听地址是什么，远程适配器都必须配置独立的 Bearer Token；需要让内网对话流平台访问时，再将监听地址设为 `0.0.0.0`：

```powershell
$env:ZEUS_TOKEN_SIGN = "<Zeus签名>"
$env:ZEUS_CURRENT_BADGE = "<联调人工号>"
$env:MCP_ADAPTER_HOST = "0.0.0.0"
$env:MCP_ADAPTER_PORT = "8001"
$env:MCP_ADAPTER_TOKEN = "<独立的MCP访问令牌>"
npm run remote
```

不要将 `ZEUS_TOKEN_SIGN` 当作 MCP 请求头传给平台。平台只使用独立的 `MCP_ADAPTER_TOKEN`：

```text
Authorization: Bearer <MCP_ADAPTER_TOKEN>
```

Dify 等服务端调用通常不发送 `Origin`，可直接使用。浏览器发送的跨站请求会默认被拒绝；只有确需从受信任的浏览器来源联调时，才用逗号分隔的完整 Origin 配置白名单，例如：

```powershell
$env:MCP_ALLOWED_ORIGINS = "https://dify.example.com"
```

不要配置通配符，也不要填写路径。`POST /mcp` 和 `POST /messages` 必须使用 `Content-Type: application/json`。

平台使用 Streamable HTTP 时填写 `http://<本机内网IP>:8001/mcp`；使用 SSE 时填写 `http://<本机内网IP>:8001/sse`。建议连接超时 `30000` ms、读取超时 `300000` ms。启动后可先检查：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8001/health"
```

这是单用户、单进程联调入口。`ZEUS_CURRENT_BADGE` 固定代表当前联调人；准备申请后必须保持同一进程运行到用户完成 `确认提交`。多人共享、负载均衡、可信 SSO 工号传递和跨实例确认存储不在此联调版本范围内。

### 终端诊断日志

远程适配器默认将脱敏的 MCP 调用日志写入标准错误流，因此会直接显示在运行 `npm run remote` 的终端中，但不会混入 MCP 工具响应。日志只包含传输方式、JSON-RPC 方法、工具名、状态、耗时、安全错误码和随机追踪 ID；不会记录请求头、Token、Cookie、原始参数、确认 ID 或 Zeus 原始响应。

默认文本格式无需额外配置。可通过环境变量关闭日志或改为便于采集的 JSON 行格式：

```powershell
$env:MCP_LOG_LEVEL = "info"  # 可选：info 或 off
$env:MCP_LOG_FORMAT = "text" # 可选：text 或 json
npm run remote
```

工具调用时终端会显示类似：

```text
2026-08-31T12:00:00.000Z INFO mcp.call.start trace_id=... transport=streamable-http method=tools/call tool=search_servers status=started
2026-08-31T12:00:00.125Z INFO mcp.call.finish trace_id=... transport=streamable-http method=tools/call tool=search_servers status=ok duration_ms=125
```

## 开发验证

```powershell
npm test
node scripts/runtime-mcp.js
node scripts/runtime-http.js
node scripts/runtime-cli.js systems
```

`runtime-mcp.js` 通过标准输入输出运行 MCP。旧 CLI 仅保留用于兼容和底层调试；正常对话必须使用 MCP。
