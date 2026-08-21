# Server Login Permission Application

该插件将自然语言服务器登录权限需求转换为 Zeus 工单。它会实时校验领域/系统、资源、申请人、权限类别和期限，并在最终写入前要求二次确认。

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

## 开发验证

```powershell
npm test
node scripts/runtime-cli.js systems
```

CLI 从标准输入读取 JSON，并向标准输出返回 JSON。`prepare` 生成一次性确认 ID；`submit` 同时要求该 ID 和精确短语 `确认提交`。

