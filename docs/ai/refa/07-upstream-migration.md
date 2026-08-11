# 上游应用与类型迁移

## 1. 为什么必须改上游

只重排 `packages/ai` 和 `packages/agent` 的目录无法消除当前维护问题。`coding-agent` 广泛直接引用 Agent 类型，Desktop/CLI 又存在对 AI 类型和 Runtime 兼容面的直连。若不迁移：

- 旧类型会迫使新 engine 继续承载 Session/UI 语义。
- `AgentCoreTurnEngine` 适配层会永久存在并继续增长。
- Context report 会在 Runtime、Coding Agent 和 Desktop 出现三份结构。
- Provider API 变化仍可能传导到应用。

## 2. 目标依赖规则

### `runtime-core`

允许依赖：

- `@vetta/ai/protocol`、模型调用端口。
- `@vetta/agent-core` engine。

负责导出：

- Session/Turn/Conversation types。
- RuntimeMessageEnvelope、SessionEvent、execution observation。
- ContextCompositionReport 和 Host Ports。
- RuntimeToolDefinition 契约。

### `coding-agent`

允许依赖：

- AI protocol/model catalog。
- Runtime kernel/host 的公开子路径。
- runtime-tools 的公开子路径。

对 `agent-core` 的依赖只允许出现在 engine composition/adapter 目录。compaction、memory、RPC、sessions、extensions 和 public SDK 不得依赖 Agent 类型。

### `desktop-app` / `cli-app`

会话功能只依赖 Runtime Host/Public SDK。允许直接使用 AI 的纯 `ModelDescriptor` 做模型目录 UI，但不能导入 Provider adapter、stream event 或认证实现。

## 3. 类型迁移表

| 旧入口 | 新入口 | 上游调整 |
| --- | --- | --- |
| `@vetta/agent-core#ThinkingLevel` | `@vetta/ai/protocol#ReasoningEffort` | settings、CLI、model selection 统一命名 |
| `AgentMessage` | `Message` / `RuntimeMessageEnvelope` | 模型输入与 Session 自定义 entry 分离 |
| `AgentEvent` | `AgentExecutionEvent` / `SessionEvent` | SDK/RPC 消费 Runtime SessionEvent |
| `ToolPhase` | `@vetta/runtime-core#ToolPhase` | observation、document、UI 归 Runtime |
| `AgentTool*` | `RuntimeToolDefinition`/Runtime Tool result | extension tool contracts 迁移 |
| `StreamFn` | AI model invocation port | composition 不再暴露具体 stream function |
| `AgentCoreTurnEngineOptions` | `TurnEnginePort`/`ModelRuntimeOptions` | coding composition 不依赖具体实现类 |

迁移时先提供 type alias，随后改 import，最后删除 alias。禁止通过在 Agent 根入口继续 re-export 新类型来“兼容”，否则依赖方向没有真正改变。

## 4. `runtime-core` 改动

1. 为 Turn Engine Request 增加明确 checkpoint callback，删除双向 checkpoint event。
2. 为 Snapshot/Profile 增加结构化 AgentRunLimits。
3. `ModelCallFrame` 增加 call/snapshot identity 和 composition provenance。
4. 最终模型调用准备阶段生成 ContextCompositionReport。
5. Host Port 暴露 context composition，Kernel backend 缓存当前 Session 的最后 prepared/completed report。
6. Runtime 自己拥有 ToolPhase 和 execution observation types。
7. TurnPipeline 继续验证 engine 必须发出唯一 terminal result。

## 5. `coding-agent` 改动

1. `CodingAgentModelCallFrameComposer` 返回 prompt provenance，不再仅通过 `onPromptDiagnostics` callback。
2. SystemPromptDraft 为每个 skill/plugin contribution 保留稳定 source id；聚合 block 提供 segment diagnostics。
3. Context Runtime 返回消息与 origin 对应关系，不能只返回 `Message[]`。
4. extension/plugin/MCP tool 全部产出带 TypeBox 泛型的 RuntimeToolDefinition。
5. `runtime-composition-options.ts` 不再引用具体 `AgentCoreTurnEngineOptions`。
6. public SDK/RPC 从 AgentEvent 迁到 Runtime SessionEvent；旧事件只做兼容投影。
7. memory/compaction/session 代码从 AgentMessage 改为 Runtime conversation 类型。

## 6. Desktop 与 CLI 改动

Desktop：

- 通过 Runtime session port/IPC 获取 ContextCompositionReport。
- `contextUsageAtom` 升级为版本化 report 或拆分 total/composition state，避免平行真相。
- Context Ring 只负责展示与交互，不引入 tokenizer 和 Provider 分支。
- 新文案全部走 desktop i18n。
- Session 切换、新建 Session 和模型切换时清理/标记 report freshness。

CLI：

- 可复用同一 report 输出诊断命令或调试信息。
- 不从 Agent 导入 reasoning/settings 类型。
- 不因终端展示需要而扩大 Runtime Host Port。

## 7. 兼容策略

兼容层只允许以下形式：

- 旧 type alias 指向新类型。
- 旧函数委托新实现，并有等价测试。
- 旧事件由 canonical Runtime event 单向投影。

每个 compat 项必须记录：

- owner。
- 引入版本。
- 替代 API。
- 仓库内剩余调用数。
- 最早删除版本/条件。

禁止：

- 新实现调用旧实现。
- 新旧两套状态双写且没有差分验证。
- 为避免改 import 而永久 re-export 错误所有权的类型。
- compat 层新增功能。

## 8. 依赖守卫

在迁移后增加 guard：

- `packages/ai` 不得导入 agent/runtime/app。
- `packages/agent` 不得导入 runtime/coding/app。
- `coding-agent` 只有指定 composition adapter 可导入 `@vetta/agent-core`。
- desktop renderer 不得导入 AI Provider 实现或 runtime kernel。
- compat 目录禁止被新模块导入。

Guard 应基于目录和 import specifier，错误信息给出允许入口。先迁移再启用强制失败，避免一次引入大量历史噪声。

