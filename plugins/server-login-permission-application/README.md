# Server Login Permission Application

该插件将自然语言服务器登录权限需求转换为 Zeus 工单。Skill 负责收集字段和二次确认。

> **UAT 2.0 部署规则优先于本文其余历史说明。** UAT 仅使用 Streamable HTTP `POST /mcp`；Runtime 必须在每次请求的 `Authorization` 头中原样传递 Zeus UAT 用户 Bearer Token。MCP 以固定 `MCP_KEY=server-permission-application` 调用 `/api/mcp/me`，只展示并允许该用户已授权的 Tool。不得配置 `ZEUS_TOKEN_SIGN`、`ZEUS_CURRENT_BADGE` 或 `MCP_ADAPTER_TOKEN`，也不得使用 STDIO、SSE 或 CLI 作为 UAT 接入方式。

## UAT 2.0 配置

```powershell
$env:ZEUS_API_BASE = "https://<zeus-uat-host>"
$env:MCP_KEY = "server-permission-application"
$env:MCP_ADAPTER_HOST = "127.0.0.1"
$env:MCP_ADAPTER_PORT = "8001"
npm run remote
```

Runtime 调用地址为 `http://<mcp-host>:8001/mcp`。`/health` 不返回用户或权限信息；`/mcp` 的每个请求必须有 `Content-Type: application/json` 及真实用户的 Bearer Token。Token 不进入 Tool 参数、模型上下文、确认记录或诊断日志。

MCP 暴露以下工具：

- `search_users`
- `search_servers`
- `get_permission_options`
- `prepare_application`
- `submit_application`

`search_servers` 默认通过 `asset_info_list` 查询全量资产，不要求先选领域/系统。每个资产候选会保留接口返回的领域和系统 ID/名称；选定资产后，`prepare_application` 可自动使用其所属领域和系统。显式传入领域/系统时仍会按原方式限定查询范围。若 Zeus 对带关键词但无匹配资产返回通用业务拒绝，MCP 会规范为 `ASSET_NOT_FOUND`。同一张申请中的多个资产必须属于同一领域和系统。

`get_permission_options` 传入明确申请人时使用非空 `user_ids`；默认申请人为当前用户时应省略 `user_ids`，MCP 会以 `/api/mcp/me` 返回的当前用户工号通过 `/api/user` 精确解析 Zeus 数值用户 ID。工具会把 Zeus 常见的顶层或用户级权限/期限字段归一化为 `able_permission_type` 和 `user_info`。显式空数组仍会被拒绝，避免把“默认本人”和“申请人缺失”混为一谈。

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

## UAT 服务部署与版本切换

UAT 使用单实例、不可变版本目录和 `current` 软链接，不会同时运行两个 MCP 版本。每次切换会短暂中断请求：发布人员切换链接，再由启动脚本重启服务并做基础健康检查；MCP 业务功能仍由人工验收。

固定目录如下。用户将完整、干净的项目目录直接复制到应用根目录，建议以 `YYYYMMDD-HHMMSS` 日期时间命名；启动脚本不限制历史目录名。`current` 是唯一的运行版本标识，不使用 `previous` 软链接。目录名只用于发布历史，`package.json` 的版本仍用于健康检查。

```text
/opt/hq-itops/server-permission-mcp/
  start-mcp.sh
  20260928-101500/
  20261003-093000/
  current -> 20261003-093000
```

首次部署时安装 Node.js 20+，将 `ops/start-mcp.sh` 复制为上述 `start-mcp.sh`，并把 `ops/server-login-permission-mcp.service`、`ops/server-login-permission-mcp.nginx.conf` 安装为固定的 systemd/Nginx 配置。只在首次安装时替换 Nginx 的示例站点域名和 TLS 路径，随后执行 `systemctl daemon-reload`、`systemctl enable --now server-login-permission-mcp` 和 Nginx 配置校验/重载。每个版本发布均不得修改 systemd、Nginx、端口或环境文件。

固定环境文件为 `/etc/mcp/server-login-permission.env`，可由 `ops/server-login-permission.env.example` 初始化。服务仅需要以下环境变量：

```ini
ZEUS_API_BASE=https://<zeus-uat-host>
MCP_KEY=server-permission-application
MCP_ADAPTER_HOST=127.0.0.1
MCP_ADAPTER_PORT=8001
MCP_LOG_LEVEL=info
MCP_LOG_FORMAT=json
```

不要配置 `ZEUS_TOKEN_SIGN`、`ZEUS_CURRENT_BADGE` 或 `MCP_ADAPTER_TOKEN`。`GET /health` 仅用于健康检查；唯一的 MCP 入口是 `POST /mcp`，SSE 和 `/messages` 已禁用并返回 `410`。

在 Nginx 或其他反向代理中，必须将客户端的 `Authorization` 请求头透传至 `/mcp`。Runtime 不保存或记录 Token，且会对每个 MCP HTTP 请求重新校验当前 Token 的 Zeus MCP 授权。对浏览器跨域访问，使用 `MCP_ALLOWED_ORIGINS` 配置精确 Origin 白名单；服务端调用通常不需要该变量。

### 发布与回退

本机只需完成根目录测试和人工代码审查。随后通过受控传输方式，将完整且干净的插件项目目录直接复制为服务器上的日期版本目录，例如 `/opt/hq-itops/server-permission-mcp/20260928-101500`。不得复制本地配置、日志、报告、缓存、`node_modules` 或嵌套 Git 目录。

复制完成后，发布人员在服务器应用根目录以原子替换方式更新 `current`，再执行启动脚本：

```bash
ln -s 20260928-101500 .current-next
mv -Tf .current-next current
./start-mcp.sh restart
./start-mcp.sh status
```

启动脚本固定读取 `current` 指向的项目，重启 `server-login-permission-mcp.service`，并验证 `http://127.0.0.1:8001/health` 返回目标服务名和 `package.json` 版本。它不创建、修改或推断历史版本链接。健康检查失败时，发布人员将 `current` 明确改回历史目录后再次重启：

```bash
ln -s 20260920-143000 .current-next
mv -Tf .current-next current
./start-mcp.sh restart
```

`status` 可显示当前链接目标与项目版本；历史目录不会被脚本自动删除。生产前人工验收仅使用健康检查、已授权用户的 `tools/list` 和只读 Tool；不得以 `submit_application` 作为发布测试。发布窗口应由人工避开待确认的申请，本次未改变确认记录的临时目录策略。

### 终端诊断日志

远程适配器默认将脱敏的 MCP 调用日志写入标准错误流，因此会直接显示在运行 `npm run remote` 的终端中，但不会混入 MCP 工具响应。除传输方式、JSON-RPC 方法、工具名、状态、耗时、安全错误码和随机追踪 ID 外，Zeus 下游调用还会记录请求与最终响应的域名/路径、HTTP 状态、是否发生重定向、认证头是否存在，以及仅用于同次排障关联的不可逆截短摘要。不会记录请求头、Token、Cookie、查询参数、原始参数、确认 ID 或 Zeus 原始响应。

默认文本格式无需额外配置。可通过环境变量关闭日志或改为便于采集的 JSON 行格式：

```powershell
$env:MCP_LOG_LEVEL = "info"  # 可选：info 或 off
$env:MCP_LOG_FORMAT = "text" # 可选：text 或 json
npm run remote
```

工具调用时终端会显示类似：

```text
2026-08-31T12:00:00.000Z INFO zeus.request.start trace_id=... upstream_origin=https://zeus-uat.example upstream_path=/api/mcp/me authorization_present=true authorization_fingerprint=...
2026-08-31T12:00:00.030Z INFO zeus.request.finish trace_id=... upstream_final_origin=https://zeus-uat.example upstream_final_path=/api/mcp/me upstream_http_status=200 redirected=false duration_ms=30
2026-08-31T12:00:00.031Z INFO mcp.call.start trace_id=... transport=streamable-http method=tools/call tool=search_servers status=started
2026-08-31T12:00:00.040Z INFO zeus.request.start trace_id=... upstream_origin=https://zeus-uat.example upstream_path=/api/resource_center/asset_info_list authorization_present=true authorization_fingerprint=...
2026-08-31T12:00:00.100Z INFO zeus.request.finish trace_id=... upstream_final_origin=https://zeus-uat.example upstream_final_path=/api/resource_center/asset_info_list upstream_http_status=401 redirected=false duration_ms=60
2026-08-31T12:00:00.125Z INFO mcp.call.finish trace_id=... transport=streamable-http method=tools/call tool=search_servers status=error error_code=AUTH_EXPIRED duration_ms=94
```

## 开发验证

```powershell
npm test
node scripts/runtime-http.js
```
