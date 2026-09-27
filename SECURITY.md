# 安全说明

## 凭据与本地数据

- 不要提交 API Key、Token、密码、证书、用户数据或本地调试日志。
- 开发脚本使用环境变量，或使用根目录下已被忽略的本地凭据文件：`.step-api-key`、`.minimax-api-key`、`.minimax-group-id`、`.mimo-api-key`。
- 桌面客户端保存的在线语音 Key 位于 Electron `userData` 目录，并通过 Windows `safeStorage` 加密；清除 Key 应使用客户端设置里的清除操作。
- `release/`、`www/`、缓存和试听产物均为本地构建内容，不应手动强制加入版本库。

## 推送前检查

```powershell
git status --short --ignored
git ls-files | Select-String -Pattern '(^|/)(\.env|.*(secret|token|api[-_]?key|credential|password).*)$'
```

确认没有把凭据文件、个人数据或临时产物加入暂存区后，再执行提交和推送。

## 报告问题

仓库保持私密时，请通过仓库私下联系维护者报告安全问题，并避免在公开 Issue 中粘贴密钥、完整日志或用户数据。仓库公开前应启用 GitHub 的私密漏洞报告或明确维护者联系方式。
