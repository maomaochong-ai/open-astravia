# Extensions

TypeScript 模块，订阅生命周期、注册工具/命令/Provider。契约：`@vetta/coding-agent`（`ExtensionAPI`）。

产品模式为 print / RPC / SDK（无 TUI）。`ctx.ui` 在 RPC 下可转发到 Desktop；无 UI 宿主时多数为 no-op 或拒绝。

## 位置

| 路径 | 范围 |
|------|------|
| `~/.vetta/agent/extensions/*.ts` 或 `*/index.ts` | 全局 |
| `<cwd>/.vetta/extensions/` | 项目 |
| CLI `-e <path>` / settings `extensions` / packages | 显式 |

## 最小示例

```typescript
import type { ExtensionAPI } from "@vetta/coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
      const ok = await ctx.ui.confirm("危险操作", "允许 rm -rf？");
      if (!ok) return { block: true, reason: "用户拒绝" };
    }
  });

  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "按名字问候",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: "text", text: `Hello, ${params.name}` }], details: {} };
    },
  });
}
```

## API 要点

完整签名：`src/extensions/api-contracts.ts`。

| 能力 | 方法 |
|------|------|
| 事件 | `on(event, handler)` |
| 工具 | `registerTool` |
| 命令 / flag | `registerCommand`, `registerFlag`, `getFlag` |
| Provider | `registerProvider` |
| 消息 | `sendMessage`, `sendUserMessage`, `appendEntry` |
| 会话元数据 | `setSessionName`, `setLabel` |
| 工具集 | `getActiveTools`, `setActiveTools`, `getAllTools` |
| 模型 | `setModel`, `getThinkingLevel`, `setThinkingLevel` |
| 扩展间通信 | `events`（EventBus） |

常用事件：`session_*`、`agent_*`、`turn_*`、`message_*`、`tool_call` / `tool_result`、`tool_execution_*`、`input`、`context`、`resources_discover`、`before_agent_start`。可拦截/改写的结果类型见同文件。

自定义 Provider 示例：`examples/extensions/custom-provider-*/`。

## 示例索引

见 `examples/extensions/README.md`。
