# 实施日志：Greenfield Kernel 第一纵向切片

本文件记录 Greenfield Kernel 第一纵向切片的实施与验证。

## 2026-07-26：Greenfield Kernel 第一纵向切片

### 目标

在不切换旧生产入口的前提下，建立不依赖 `coding-agent` 的新 Kernel 基础：

- Session 状态机。
- 固定阶段 Typed Turn Pipeline。
- Runtime Snapshot。
- Feature Compiler。
- 存储、上下文、Engine 和事件 Port。

### 修改范围

- 新增 `@vetta/runtime-core/kernel` 独立导出入口。
- 新增 `packages/runtime-core/src/kernel/`：
  - `contracts.ts`
  - `errors.ts`
  - `defaults.ts`
  - `agent-session.ts`
  - `turn-pipeline.ts`
  - `feature-compiler.ts`
  - `index.ts`
- 新增 `packages/runtime-core/test/kernel/`：
  - `turn-pipeline.test.ts`
  - `feature-compiler.test.ts`
- 扩展包边界守卫，禁止 `runtime-core/src/kernel` 导入 `@vetta/coding-agent`。
- 更新 `runtime-core` 包入口、README 和 CHANGELOG。

### 明确未修改

- 未修改旧 `RuntimeHost`、旧 `contracts.ts` 及现有生产调用链。
- 未切换 Desktop、CLI、RPC 或 IM。
- 未删除 `coding-agent` 旧代码。
- 未实现 `@vetta/agent-core` 的生产 Turn Engine Adapter。
- 未实现文件会话仓储、上下文摘要器、输入队列、steering 或事件 AsyncIterable。
- 未迁移 Tool、MCP、Skill、知识库和 Subagent。

### 新增或修改的合同

- `AgentSession`
  - 显式状态：idle、running、cancelling、closing、closed。
  - 同一 Session 只允许一个活动 Turn。
  - 支持 cancel 和活动 Turn 期间 close。
- `TurnPipeline`
  - 固定阶段：Admission、Snapshot Binding、Conversation Loading、Context Assembly、Context Preparation、Execution、Finalization。
  - Engine 必须产生唯一终止事件；缺失或终止后继续输出均视为协议错误。
  - Turn 开始、消息、压缩和终止状态通过 `ConversationRepository` 按版本追加。
- `ConversationRepository`
  - 使用会话领域合同和乐观版本，不暴露文件路径或数据库连接。
- `ContextStrategy` / `ContextProvider`
  - 通过 `AbortSignal` 接收取消。
  - 不直接访问 Session 或具体 Repository 实现。
- `FeatureCompiler`
  - 按依赖拓扑和稳定字符串顺序编译。
  - 检测 Feature、Tool、Instruction、Context Provider 和 Observer 冲突。
  - prepare / contribute 失败时逆序释放资源。
  - 编译结果使用冻结数组和无 mutation API 的只读 Map。
  - Snapshot lease dispose 幂等，并汇总释放失败。

### 数据兼容影响

- 无生产数据格式变化。
- 新 Repository 目前只有合同和测试内存实现。
- 旧 `RuntimeHost` 仍使用原会话存储。

### 测试

- `packages/runtime-core`
  - `bunx vitest --run test/kernel/turn-pipeline.test.ts test/kernel/feature-compiler.test.ts`
  - 2 个测试文件、12 个测试通过。
- 质量守卫
  - `bunx vitest --run scripts/quality/quality-gates.test.mjs`
  - 20 个测试通过。
- 包级类型检查
  - `bunx tsgo --noEmit -p tsconfig.build.json`
  - 通过。
- `bun run check:quick`
  - 本次变更的 Biome、私钥、冲突标记和包边界检查通过。
  - 整体命令因既有 Capability Catalog 文档过期而失败。
- `bun run check`
  - 全量 TypeScript 检查通过。
  - 整体命令因两个非本次变更问题失败：
    - Capability Catalog 文档过期。
    - `packages/admin/src/routeTree.gen.ts` 不符合当前 Biome 格式。

### 结果

- 新 Kernel 已能独立执行 Fake Engine 驱动的完整 Turn。
- Session 并发、取消、关闭、Pipeline 顺序、持久化终止和 Engine 协议错误已有自动测试。
- Feature Compiler 的确定性、冲突、失败回滚、只读 Snapshot 和 dispose 已有自动测试。
- 新 Kernel 源码没有导入 `@vetta/coding-agent`，并由质量守卫持续约束。
- 旧生产入口未受影响。

### 未解决问题

- `runtime-core` 包级依赖中仍存在旧 `@vetta/coding-agent`，因为旧 `RuntimeHost` 尚未迁移。
- 新 Kernel 还没有真实 `@vetta/agent-core` Adapter。
- `ConversationRepository` 还没有位于 `runtime-storage` 的生产实现。
- 当前 `AgentSession.send()` 对并发输入采用拒绝策略，输入队列和 steering 需在后续合同中实现。
- Snapshot 尚未支持后台编译后在 Turn 边界原子交换。
- 标准事件还没有转换成宿主使用的 AsyncIterable Session Event Stream。

### 下一步

1. 在 `runtime-storage` 实现版本化 Conversation Repository 和恢复测试。
2. 实现 `@vetta/agent-core` Turn Engine Adapter。
3. 增加 Runtime Snapshot 原子 Provider，验证当前 Turn 不受热更新影响。
4. 再迁移 Coding Tools Feature，不提前接入 MCP、Skill 和知识库。
