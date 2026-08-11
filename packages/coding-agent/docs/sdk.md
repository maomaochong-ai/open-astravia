# SDK

进程内嵌入 Coding Agent。类型与完整签名见 `@vetta/coding-agent/sdk` 与 `src/public-api/sdk/`。

## 创建会话

```typescript
import { createCodingAgentSession } from "@vetta/coding-agent/sdk";

const { session, diagnostics } = await createCodingAgentSession({
  storage: { kind: "memory" },
});

const unsub = session.subscribe((event) => {
  // event.type: message_update | tool_execution_* | agent_* | ...
});

await session.prompt("列出当前目录文件");
unsub();
await session.close();
```

存储意图：

| `storage.kind` | 含义 |
|----------------|------|
| `memory` | 不落盘 |
| `file-create` | 新建会话文件（需 `conversationDir`） |
| `file-resume` | 恢复已有会话（需 `conversationDir` + `sessionPath`） |

离线列会话用 `createCodingAgentSessionCatalog()`，与活动 Session 生命周期无关。

多 Session 生命周期：`createCodingAgentHost()`。共享 Auth / Model / Settings 时用 `@vetta/coding-agent/host-services`。

## 公开子路径

| 需求 | 导入 |
|------|------|
| 写 Extension | `@vetta/coding-agent` / `@vetta/coding-agent/extensions` |
| 嵌入 Session | `@vetta/coding-agent/sdk` |
| RPC | `@vetta/coding-agent/rpc` |
| Runtime 组合 | `@vetta/coding-agent/runtime` / `composition` |
| 宿主服务 | `@vetta/coding-agent/host-services` |
| Settings | `@vetta/coding-agent/settings` |
| Profile | `@vetta/coding-agent/profile` |
| 资源 | `@vetta/coding-agent/resources` |
| 历史会话 | `@vetta/coding-agent/historical-sessions` |

包根不再导出 `createAgentSession` / `SessionManager` 等旧 API。

## 能力摘要

Session 支持：prompt / steer / follow-up、abort、模型与 thinking、工具开关、compaction、retry、会话 new/switch/fork、资源 reload、bash、HTML export。

资源可用路径或内联值（Skill、prompt template、extension path、context file）；动态来源用 `skillSources` / `extensionSources`（`id + revision`），下一轮 prompt 或 `reload()` 生效。

示例：`examples/sdk/`。
