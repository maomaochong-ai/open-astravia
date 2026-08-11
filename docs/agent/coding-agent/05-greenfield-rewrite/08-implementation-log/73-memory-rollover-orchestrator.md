# 第 73 轮：Memory Rollover 产品编排

## 1. 本轮目标

在不把 MEMORY、JOURNAL 或 memory-mode 产品语义下沉到 Runtime Core / Storage 的前提下，将旧
`AgentSession` 的 memory-mode 长会话行为接入 Greenfield：

1. 保留 Session 启动时冻结的 MEMORY 提示词快照。
2. 保留既有 `memory` Tool 的定义、描述、Schema、执行和字符限制。
3. 保留 memory-mode 自动压缩约 70% 的触发策略。
4. 自动压缩前以被丢弃的消息前缀 best-effort flush MEMORY。
5. 压缩提交后通过第 72 轮的通用 continuation directive 续接到新 Conversation。
6. 保留每个成功 Turn 的 JOURNAL 行和每次成功 rollover 的摘要段落。
7. memory-mode 默认关闭，未启用的 Greenfield Session 不增加工具、提示词或文件副作用。

## 2. 旧行为基线

本轮先审计旧 `CompactionController`、`AgentSession`、memory store/flush/journal 和 memory Tool：

- 自动压缩设置使用 `max(base.minFreePercent, 30)` 和
  `max(base.reserveTokens, ceil(contextWindow * 0.3))`，即最多使用约 70% 上下文；手动压缩仍使用
  基础设置。
- MEMORY flush 使用 `preparation.messagesToSummarize`，失败不能阻止压缩或 rollover。
- MEMORY 内容在 Session 创建时读取并冻结；Session 运行期间 Tool 对文件的修改只影响后续 Session。
- `memory` Tool 仍绑定同一 MEMORY 文件和字符限制。
- 成功 Turn 取最后一条 assistant 消息写入一行 JOURNAL；rollover 成功后写入包含压缩摘要的段落；
  两者均为 best-effort。
- rollover 是同一个 Turn 跨 Conversation 续接，不是创建第二个 Turn。

## 3. 架构实现

新增 Coding Agent Session-local 产品编排：

```text
CodingAgentMemoryRolloverOrchestrator
  ├─ Prompt memory snapshot
  ├─ existing memory Tool registration
  ├─ memory-mode compaction policy
  │    ├─ 70% threshold settings
  │    ├─ MEMORY flush
  │    └─ generic continuation directive
  └─ Turn observer / continuation callback
       ├─ completed-turn JOURNAL line
       └─ rollover JOURNAL section
```

具体边界：

- `greenfield-memory-rollover-orchestrator.ts` 只位于 Coding Agent Adapter 层，直接复用既有
  memory store、flush、journal 和 Tool。
- `CodingAgentGreenfieldContextRuntime` 只依赖窄的
  `CodingAgentMemoryCompactionPolicy`，在自动压缩准备时调整设置、在压缩前 flush、提交后返回通用
  continuation directive；手动压缩路径未改变。
- CLI Greenfield Composition Root 根据 Session 的 `memoryMode` 显式创建 Runtime，并将其分别装配到
  Prompt、Feature、Context Strategy、Turn Observer 和 continuation callback。
- Conversation 切换后同步更新 Session-local 活动 id、Plugin Session 与 MCP Controller 索引；Kernel 和
  Storage 继续只理解通用 Conversation continuation。
- 既有 `createMemoryTool()` 仅把返回类型由旧 Extension `ToolDefinition` 校正为实际实现已经满足的
  `CodingAgentTool`，没有改变 Tool 的运行时定义或功能。

## 4. TypeBox / Zod 判断

本轮没有新增 TypeBox 或 Zod：

- `memoryMode`、压缩准备和 continuation callback 都是 Composition Root 内部已类型化对象，不是外部
  JSON 协议边界。
- memory Tool 的外部参数仍使用既有 TypeBox Schema。
- Conversation continuation 的持久化 seed/event 校验已由第 72 轮的 Runtime Storage TypeBox Schema
  覆盖。

如果后续由 RPC/IM 直接接收 memory 配置 payload，校验应放在对应宿主 Adapter 的反序列化边界，而不是
放进 Orchestrator。

## 5. 测试

### Coding Agent

```text
greenfield-context-runtime.test.ts
greenfield-memory-context-runtime.test.ts
greenfield-memory-rollover-orchestrator.test.ts
```

共 15 项通过，覆盖：

- MEMORY 快照冻结。
- 70% 阈值设置。
- flush 使用被摘要的消息前缀且失败为 best-effort。
- 自动压缩返回通用 continuation directive。
- 手动压缩不 flush、不 rollover。
- JOURNAL Turn 行与 rollover 段落。
- 既有 memory Tool 只在 memory Feature 中贡献。

### CLI Composition Root

```text
greenfield-runtime-composition.test.ts
greenfield-memory-runtime.test.ts
```

共 15 项通过，覆盖：

- memory-mode 开启后的真实 Prompt、Tool 执行和 JOURNAL。
- memory-mode 默认关闭时没有 memory Tool、Prompt 和 JOURNAL。
- 两个真实 Turn 后达到阈值，完成 MEMORY flush、源 Turn transfer、目标 Turn continue、Session id
  重绑定和 JOURNAL rollover 段落。
- 既有 Greenfield Composition Root 回归。

### 仓库门禁

- `bun run check:quick` 通过。
- `bun run check` 通过：Biome、根 Monorepo `tsgo --noEmit`、CLI 类型检查、Desktop
  `tsc --noEmit`、Admin `tsc -b` 和全部 guards 均通过。

## 6. 明确未修改

- 没有切换默认生产 `AgentSession`、Desktop、RPC 或 IM 入口。
- 没有删除旧 memory-mode、`SessionManager.rolloverToNewFile()` 或旧会话格式。
- 没有把 MEMORY/JOURNAL 字段加入 Runtime Core 事件或 Storage Schema。
- 没有改变 memory Tool 的描述、Schema、结果和文件操作语义。
- 没有迁移旧 RPC/IM 的主动 `flush_memory` 命令。

## 7. 尚存差距

旧自动压缩的顺序是 rollover 后再执行 Extension committed 回调、PostCompact Hook 和熔断成功记录；当前
Greenfield Context Strategy 必须先返回 `onCompactionCommitted()` 结果，Pipeline 才能执行
continuation，因此这些回调目前先于实际 Conversation 切换。

该差异不会影响默认生产路径，因为 Greenfield memory-mode 尚未作为默认入口；但它是生产切换阻断项。
不应通过让 Hook、Extension 或 Coding Agent 文件概念进入 Kernel 来规避。下一轮应先建立“续接事务完成后
回调”的通用时序合同，并决定 PostCompact 的 stop 结果如何与续接事务原子边界协作。

## 8. 下一步

下一阶段合并处理：

1. 为压缩提交后的 continuation 建立明确的 before/after transaction 回调合同，消除 Hook/Extension
   时序差异。
2. 在 Coding Agent/宿主 Adapter 增加显式的按需 MEMORY flush Port，迁移旧 `flush_memory` 调用能力。
3. 增加旧实现与 Greenfield 的顺序差分测试，再决定是否允许 CLI/IM 通过显式配置进入 Greenfield
   memory-mode；默认入口仍不切换。
