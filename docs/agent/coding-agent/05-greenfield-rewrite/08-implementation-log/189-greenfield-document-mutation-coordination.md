# 阶段 189：Greenfield 文档变更协调

## 阶段目标

收敛 Runtime Session 内两条并发写入路径：

- Turn Pipeline 持久化 Kernel Journal 事件后更新 Conversation Document 投影；
- Todo、Context、Subagent 等 Document Participant 通过 Runtime Session 写入直接文档命令。

本阶段只修正架构边界和并发一致性，不改变工具、Subagent、会话事件或持久化格式的既有功能。

## 问题分析

直接文档命令原先在读取 revision 与执行命令之间可能被 Journal 写入抢先，导致存储拒绝过期 revision。初版协调又保留了事件载荷驱动的本地投影重放，因此完整并行测试进一步暴露了第二种交错：存储文档与投影可能处于相同 revision、不同 journalVersion 的分叉状态。

根因不是乐观锁本身，而是同一 Conversation Document 存在两个重建来源：

- `ConversationDocumentStore` 根据实际持久化记录重建权威文档；
- `GreenfieldSessionProjection` 根据稍后发布的 Kernel 事件再次本地推演文档。

Journal 事件的持久化先于观察事件发布，期间直接文档命令可以合法写入。事件载荷也不包含存储层生成的全部文档记录信息，因此本地重放不能可靠地与并发直接命令合并。

## 实施内容

### 1. 引入 Runtime Session 文档变更协调器

新增 `GreenfieldDocumentMutationCoordinator`，职责限定为：

- 串行化同一 Runtime Session 内的直接文档命令和投影刷新；
- 每次命令执行前从 `ConversationDocumentStore` 读取权威文档；
- 始终携带精确 expected revision 执行命令；
- revision 冲突后重新读取并重放确定性命令；
- 命令成功后使用存储返回的完整文档替换内存投影。

参与者的 `onDocumentChanged` / `onSessionEvent` 回调继续在协调队列之外执行，避免参与者回写文档时形成自锁。

### 2. Journal 观察事件改为刷新权威文档

`GreenfieldSessionEventSink` 收到已持久化的 `StoredSessionEvent` 后，不再把事件直接应用到现有投影；它通过协调器重新读取存储文档并替换投影。

这使 Journal 事件和直接命令始终从同一个持久化记录序列重建，不再依赖事件发布与参与者写入之间的时序。初始化阶段尚未绑定协调器时仍保留原有本地应用路径。

### 3. 动态能力与校验边界

本阶段没有引入 TypeBox 或 Zod。协调器只接收内部强类型 `ConversationDocumentCommand` 和 `ConversationDocument`；外部持久化记录的运行时校验仍由 runtime-storage 既有 schema 边界负责，在此重复校验不会增加正确性。

## 变更文件

- `packages/runtime-core/src/runtime-host/greenfield-document-mutation-coordinator.ts`
- `packages/runtime-core/src/runtime-host/greenfield-session-backend.ts`
- `packages/runtime-core/test/runtime-host/greenfield-document-mutation-coordinator.test.ts`

## 测试与验证

### 失败基线

- CLI 默认并行套件首次复现直接命令 revision 冲突。
- 初版串行协调后，默认并行套件复现 `document=8/6, projection=8/7`，证明仅串行化本地投影更新不能消除双重重建来源。

### 通过项

- Runtime Core 协调器与 Backend 定向测试：17/17 通过。
- CLI Subagent Runtime 定向测试：3/3 通过，并额外重复通过一次。
- `bun run check:quick`：通过。
- CLI 默认并行套件中原 Subagent 竞争用例通过。
- CLI 默认并行套件唯一失败为既有 `legacy-session-fallback-narrowing` 用例在全套负载下超过 5 秒；该文件单独运行 2/2 通过，未发现功能断言失败。
- Runtime Core 完整包测试：181/182 通过；唯一失败为既有 legacy fake session 缺少 `close()`，与本阶段改动无关。
- 根级 `bun run check`：通过（Biome、monorepo/CLI/Desktop/Admin 类型检查及 guards 全部通过）。

## 阶段结论

Runtime Session 现在拥有单一的文档变更协调边界：存储层负责事实与冲突检测，内存 Projection 只缓存存储层重建出的完整文档。该边界保留了原有功能和持久化格式，同时消除了 Journal 写入与动态 Participant 状态写入之间的 revision 竞争和投影分叉。
