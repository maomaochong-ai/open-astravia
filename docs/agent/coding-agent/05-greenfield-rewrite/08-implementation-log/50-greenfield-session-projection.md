# Greenfield 同步会话投影与 Core Assembly

## 目标

让 Greenfield Session 在不伪装成完整 Legacy Assembly 的前提下，真实交付当前已经具备的会话核心能力，
并用版本化文件 Repository 验证 create、prompt、dispose、resume 后的同步状态恢复。

## 审计结论

阶段 49 已把 RuntimeHost 创建和进程级存储操作收敛到 Runtime-owned 合同，但 Greenfield Backend 仍有两个
基础问题：

1. `getState()` / `getMessages()` 每次异步加载 Repository，无法实现 RuntimeHost 的同步 State Reader。
2. `GreenfieldRuntimeAssembly` 没有显式提供 cwd、sessionPath、模型/上下文/活动工具状态，Adapter 若自行猜测
   只能返回固定值。

同时确认当前 `StoredSessionEvent` 尚未持久化完整的 entryId/parentId、活动 leaf、PromptRef/附件标记和旧
compaction token 数据。因此本轮不能安全实现 History Reader/Controller，更不能以顺序消息加伪造 ID 冒充
旧分支功能。

## 已实施

### 1. 同步消息投影

新增 `GreenfieldSessionProjection`：

- create/resume 完成后先从 `ConversationRepository.load()` 初始化消息快照；
- 只在 `message.appended` 已经持久化并发布到 EventSink 后增量更新；
- `readMessages()` 返回数组副本；
- 拒绝应用其他 session 的事件；
- RuntimeHost 读取路径不再临时访问 Repository，也不需要把同步 API 改成异步。

### 2. 必需 Identity 与动态状态源

`GreenfieldRuntimeAssembly` 现在必须交付：

- `GreenfieldRuntimeSessionIdentity`：cwd、sessionPath 和可选 fork 血缘；
- `GreenfieldRuntimeStateSource`：当前模型、thinking、Context usage 和活动工具名称。

这些值由 Composition Root 的真实模型、Snapshot 和存储实现提供。Backend 不提供默认值，也不从旧
AgentSession 推断。

### 3. 真实 Core Assembly

`GreenfieldRuntimeSession.createCoreAssembly()` 交付当前已经实现的能力：

- `RuntimeSessionIdentityLifecycle`；
- `RuntimeSessionWorkspaceView`；
- `RuntimeSessionTurnControl`；
- `RuntimeSessionEventStream`；
- `RuntimeSessionStateReader`。

Turn、Event 与 State 仍组合在 `RuntimeSessionCorePorts`。dispose 保持幂等；状态读取在 session 关闭后
fail closed。

### 4. 文件 Repository 身份与恢复集成

`FileConversationRepository.resolveConversationPath()` 向 Composition Root 提供稳定绝对会话文件路径。
真实文件集成测试覆盖：

```text
create -> prompt -> synchronous state/messages -> dispose
  -> reopen repository -> explicit resume -> synchronous state/messages
```

恢复不重放模型或工具，继续沿用 interrupted Turn Recovery 和乐观版本合同。

### 5. 可执行能力矩阵

新增由 `keyof RuntimeHostSessionAssembly` 约束的测试矩阵。当前状态为：

| Assembly 能力 | Greenfield |
| --- | --- |
| lifecycle | implemented |
| workspaceView | implemented |
| corePorts | implemented |
| historyReader / historyController | missing |
| modelController / modelView | missing |
| hostInteraction / executionController | missing |
| configurationController | missing |
| todoController / backgroundWorkController | missing |

`missing` 只存在于测试和文档中，不是运行时 fallback。Assembly 新增字段时，矩阵会在类型检查阶段要求显式
更新。

### 6. 架构守卫

包边界规则现在覆盖 `runtime-host/greenfield-*`，禁止 Greenfield Backend、事件适配和投影重新导入
`@vetta/coding-agent`。Legacy Adapter 仍是唯一允许依赖旧实现的边界。

## TypeBox / Zod

同步投影接收的是已经通过 Repository 校验的进程内 `StoredConversation` / `StoredSessionEvent`，不重复执行
Schema 校验。磁盘 JSONL 仍由 `runtime-storage` 的 TypeBox Schema 校验。本轮不引入 Zod，也不在 Adapter
重复定义第二套 Schema。

## 明确未实现

- 没有实现或伪造 HistoryEntry 分支、marker 和 compaction token 数据；
- 没有实现 History Controller、Catalog、旧 JSONL importer 或跨进程锁；
- 没有给 Model、Execution、Configuration、Todo、Background Work 提供 no-op；
- 没有让 Greenfield Backend 实现完整 `RuntimeHostSessionBackend`；
- 没有切换默认生产 Backend 或改变 Legacy 行为。

## 测试结果

- Runtime Core 定向测试：2 个文件、7 个测试通过；
- Runtime Storage 定向测试：2 个文件、10 个测试通过；
- Runtime Core 全量：21 个文件、97 个测试通过；
- Runtime Storage 全量：3 个文件、12 个测试通过；
- Quality Gates：22 个测试通过；
- `bun run check:quick`：通过；
- `bun run check`：Biome、monorepo/desktop 类型检查与质量守卫全部通过。

## 下一步

下一阶段应先扩展版本化持久事件与 Schema，使其真实表达历史图和会话元数据，再实现 Greenfield History
Reader/Controller、Session Catalog、旧 JSONL 兼容读取/迁移和跨进程锁。完成前不把顺序 Message 投影提升为
完整 History 能力。
