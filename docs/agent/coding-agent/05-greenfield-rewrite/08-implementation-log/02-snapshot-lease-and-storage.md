# 实施日志：Snapshot Lease 与文件会话仓储

本文件记录 Snapshot Lease 与文件会话仓储的实施与验证。

## 2026-07-26：Snapshot Lease 与文件会话仓储

### 目标

补齐第一轮实现中的两个生命周期缺口：

- Runtime Snapshot 热更新不能提前释放当前 Turn 仍在使用的 Feature 资源。
- `ConversationRepository` 不能只停留在接口和测试 Fake，需要由 `runtime-storage` 提供生产文件实现。

### 修改范围

- 将 `RuntimeSnapshotProvider` 从 `getCurrent()` 改为 `acquire()`：
  - 返回 `RuntimeSnapshotLease`。
  - Turn Pipeline 在 Finalization 或异常退出后统一 release。
- 新增 `AtomicRuntimeSnapshotProvider`：
  - 原子发布新 Snapshot。
  - 使用引用计数延迟释放 retired Snapshot。
  - close 等待活动 Turn 释放 lease。
- 新增 `@vetta/runtime-storage/conversation`：
  - `FileConversationRepository`。
  - 稳定存储错误码。
  - 版本化 JSONL 会话事件。
  - 原子 Snapshot 文件写入。
- 更新 root TypeScript path map，显式解析 `@vetta/runtime-core/kernel`。
- 扩展包边界守卫，禁止 `runtime-storage/src/conversation` 导入 `@vetta/coding-agent`。

### 明确未修改

- 未切换旧 `RuntimeHost` 使用新 Repository。
- 未迁移旧 JSONL 会话格式。
- 未实现跨进程文件锁。
- 未实现 Snapshot 读取、选择和自动恢复。
- 未实现真实 `@vetta/agent-core` Adapter。
- 未迁移 Coding Tools、MCP、Skill、知识库或 Subagent。

### 新增或修改的合同

- `RuntimeSnapshotProvider.acquire()`
  - 每个 Turn 获得独立且幂等 release 的 lease。
  - 当前 Turn 始终持有开始时绑定的 Snapshot。
- `AtomicRuntimeSnapshotProvider.swap()`
  - 新 Turn 立即获得新 Snapshot。
  - 旧 Snapshot 只有在所有活动 lease 释放后才 dispose。
  - Provider close 后拒绝 acquire，并释放被拒绝的 swap 输入。
- `FileConversationRepository`
  - Session ID 使用 base64url 文件名，不能形成目录穿越。
  - Header 和 Event Record 均带显式 schema version。
  - Event sequence 必须连续。
  - append 使用 expected version 做乐观并发控制。
  - 同一 Repository 实例内，同 Session 写入串行化。
  - Snapshot 只允许保存当前 conversation version。
  - 临时文件写完后 rename 发布 Snapshot，失败时删除临时文件。
  - 不完整 JSONL 尾记录、错误 sequence 和未知事件均视为损坏，不静默忽略。

### 数据兼容影响

- 新格式与旧 `coding-agent` SessionManager 格式隔离，尚未用于生产数据。
- Conversation 文件格式版本为 1。
- 当前只实现新格式读写；旧格式 importer 仍待实现。
- 包根旧 Auth、SessionManager 和 Settings 导出保持不变。

### 测试

- `packages/runtime-core`
  - `bun run test`
  - 3 个测试文件、17 个测试通过。
- `packages/runtime-storage`
  - `bun run test`
  - 1 个测试文件、7 个测试通过。
- 质量守卫
  - `bunx vitest --run scripts/quality/quality-gates.test.mjs`
  - 20 个测试通过。
- Root TypeScript
  - `bunx tsgo --noEmit -p tsconfig.json`
  - 通过。
- `bun run check:quick`
  - 通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- Snapshot 热更新不会再提前 dispose 当前 Turn 的 Feature 资源。
- Turn Pipeline 在完成、失败和取消路径都会尝试 release Snapshot lease。
- `runtime-storage` 已开始真正拥有新 Kernel 的会话持久化实现，而不是只 re-export `coding-agent`。
- 文件仓储的持久化重开、并发版本冲突、错误 Session、Snapshot 版本和损坏尾记录已有自动测试。
- 新增 Kernel 与 Conversation 源码均没有导入 `@vetta/coding-agent`。

### 未解决问题

- `FileConversationRepository` 当前只保证单 Repository 实例内串行写入，跨进程写入需要独立锁协议。
- Snapshot 目前写入但没有读取和恢复策略。
- 旧会话格式还没有只读 importer。
- 旧 `runtime-storage` 包根仍依赖 `@vetta/coding-agent` 以维持兼容导出。
- 没有真实 Turn Engine 时，新 Kernel 仍只通过 Fake Engine 执行。

### 下一步

1. 实现 `@vetta/agent-core` Turn Engine Adapter，并用录制模型流验证标准消息映射。
2. 为新会话格式实现 Snapshot 加载和旧格式只读 importer。
3. 设计跨进程会话 owner/lock 合同，不在 Repository 内静默覆盖冲突。
4. 在真实 Engine 闭环通过后迁移 Coding Tools Feature。
