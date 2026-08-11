# Settings

JSON，项目覆盖全局。Schema：`src/settings/schema/settings-schema.ts`。

| 范围 | 路径 |
|------|------|
| 全局 | `~/.vetta/agent/settings.json` |
| 项目 | `<cwd>/.vetta/settings.json` |

相对路径相对各自配置目录；支持绝对路径与 `~`。

## 常用字段

| 字段 | 说明 |
|------|------|
| `defaultProvider` / `defaultModel` | 默认模型 |
| `defaultThinkingLevel` | `off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` |
| `thinkingBudgets` | 各级 thinking token 预算 |
| `steeringMode` / `followUpMode` | `all` \| `one-at-a-time` |
| `compaction.enabled` / `reserveTokens` / `keepRecentTokens` | 自动压缩 |
| `branchSummary.reserveTokens` | 分支摘要预算 |
| `retry.*` | 瞬时错误重试 |
| `packages` / `extensions` / `skills` / `prompts` | 资源路径或包源 |
| `enableMcp` / `mcpDebug` | MCP 总开关与调试 |
| `images.*` | 图片缩放/屏蔽/近期数量 |
| `personalization` | persona / customPrompt |
| `enabledModels` | 可切换模型列表 |
| `serverUrl` / `serverToken` | 远程模型配置服务 |
| `hideThinkingBlock` | 输出中隐藏 thinking |
| `quietStartup` | 减少启动日志 |
| `shellPath` | 自定义 shell 可执行文件 |
| `shellCommandPrefix` | 每条 shell 前缀（如展开 alias） |

完整键与类型以 schema 为准；部分历史 TUI 字段（`theme`、`editorPaddingX`、`doubleEscapeAction` 等）仍可能被解析，对 print/RPC/SDK 无产品面。

## Shell（含 Windows）

默认在 Windows 上查找 Git Bash / PATH 上的 `bash`；也可用 `shellPath` 指定：

```json
{
  "shellPath": "C:\\Program Files\\Git\\bin\\bash.exe",
  "shellCommandPrefix": "shopt -s expand_aliases\neval \"$(grep '^alias ' ~/.bashrc)\""
}
```

## Compaction

上下文超过阈值时自动摘要旧消息；也可 RPC/`compact` 手动触发。扩展可订阅 `session_before_compact` / `session_compact`。算法在 `src/compaction/`。
