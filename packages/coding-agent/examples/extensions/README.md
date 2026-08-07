# Extension Examples

Coding Agent Extension 示例。扩展契约从 `@vetta/coding-agent` 导入。

当前产品宿主为 print / RPC / SDK（交互式 TUI 已移除）。`ctx.ui` 方法在 RPC 宿主下会转发到 Desktop 等宿主；无 UI 宿主时多数为 no-op 或默认拒绝。

## Usage

```bash
# 以扩展路径加载（CLI 入口因产品配置而异）
# 或复制到 agent 扩展目录以便自动发现
```

## Examples

### Lifecycle & Safety

| Extension | Description |
|-----------|-------------|
| `permission-gate.ts` | 危险 bash 命令确认 |
| `protected-paths.ts` | 阻止写入受保护路径 |
| `confirm-destructive.ts` | 会话破坏性操作确认 |
| `dirty-repo-guard.ts` | 未提交变更时拦截会话切换等操作 |

### Custom Tools

| Extension | Description |
|-----------|-------------|
| `hello.ts` | 最小自定义工具 |
| `tool-override.ts` | 覆盖内置 `read`（日志/访问控制） |
| `antigravity-image-gen.ts` | 通过 Google Antigravity 生成图片 |

### Commands & Host UI

| Extension | Description |
|-----------|-------------|
| `commands.ts` | 自定义 slash 命令 |
| `status-line.ts` | `ctx.ui.setStatus()` 状态文案 |
| `model-status.ts` | 模型切换时更新 status |
| `send-user-message.ts` | `sendUserMessage` 注入用户消息 |
| `timed-confirm.ts` | 带超时的 `confirm` / `select` |
| `shutdown-command.ts` | `/quit` 与 `ctx.shutdown()` |
| `reload-runtime.ts` | `/reload-runtime` 与 runtime reload 工具 |
| `inline-bash.ts` | 提示词中展开 `!{command}` |
| `input-transform.ts` | `input` 事件改写用户输入 |

### Git Integration

| Extension | Description |
|-----------|-------------|
| `git-checkpoint.ts` | 每轮 git stash，fork 时恢复 |
| `auto-commit-on-exit.ts` | 退出时自动 commit |

### System Prompt & Compaction

| Extension | Description |
|-----------|-------------|
| `pirate.ts` | 动态改写 system prompt |
| `claude-rules.ts` | 扫描 `.claude/rules/` 并注入提示 |
| `system-prompt-header.ts` | 展示 system prompt 信息 |
| `custom-compaction.ts` | 自定义 compaction 摘要 |
| `trigger-compact.ts` | 超阈值触发 compaction |

### Resources & Events

| Extension | Description |
|-----------|-------------|
| `dynamic-resources/` | `resources_discover` 动态资源 |
| `event-bus.ts` | 扩展间 `api.events` 通信 |
| `file-trigger.ts` | 监视触发文件并注入消息 |

### Session Metadata

| Extension | Description |
|-----------|-------------|
| `session-name.ts` | `setSessionName` |
| `bookmark.ts` | `setLabel` 标记 entry |

### Custom Providers

| Extension | Description |
|-----------|-------------|
| `custom-provider-anthropic/` | 自定义 Anthropic provider |
| `custom-provider-gitlab-duo/` | GitLab Duo provider |
| `custom-provider-qwen-cli/` | Qwen CLI OAuth provider |

### Dependencies

| Extension | Description |
|-----------|-------------|
| `with-deps/` | 扩展自带 `package.json` 依赖（jiti 解析） |

## Writing Extensions

完整文档见 [docs/extensions.md](../../docs/extensions.md)。

```typescript
import type { ExtensionAPI } from "@vetta/coding-agent";
import { Type } from "@sinclair/typebox";

export default function (api: ExtensionAPI) {
  api.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  api.registerTool({
    name: "greet",
    label: "Greeting",
    description: "Generate a greeting",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });
}
```
