# 第 117 轮：Legacy 边界隔离与 Knowledge Processing 反腐层

## 目标

- 清零 CLI、Desktop、Runtime Tools 和 Runtime Storage 生产源码对 Coding Agent 聚合根的精确依赖。
- 不创建等同于旧根入口的巨大 `legacy` barrel。
- 隔离 Desktop Knowledge Poller 对裸 `AgentSession` 和内部 Manager/Store 的依赖。
- 保留 Legacy、Runtime 包根和 Knowledge Processing 的全部既有行为。

## 实施假设

- Coding Agent 根入口是已发布兼容面，仓库内消费者归零不授权删除导出。
- CLI Legacy 启动、Desktop 具体 Host Service 和 Runtime 包根兼容转发具有不同生命周期，不能放进同一入口。
- Knowledge Poller 依赖的 Todo 锁定和轮级共享写页尚不能由 RuntimeHost 等价表达。
- 本轮建立可替换 Port 和 Legacy Adapter，不切换 Knowledge Processing Backend。

## 修改

### 用途明确的 Legacy/Compat 子路径

新增迁移期 package exports：

```text
@vetta/coding-agent/legacy/cli
@vetta/coding-agent/legacy/host-services
@vetta/coding-agent/compat/runtime-storage
@vetta/coding-agent/compat/runtime-tools
```

CLI selector、Desktop Runtime 以及 Runtime Storage/Tools 包根分别迁移到对应入口。Compat 文件直接从实际
所有者模块转发，未通过 Coding Agent 根入口二次聚合。Runtime Storage/Tools 对外根导出保持原样。

Poller 使用的既有 `createLimiter` 增加 `@vetta/coding-agent/concurrency` 子路径；实现、FIFO 和异常释放
语义均未改变。该子路径只是当前所有权的显式表达，不代表通用并发原语已完成最终归位。

### Knowledge Processing Session Port

Coding Agent Composition 新增：

- `KnowledgeProcessingSessionFactory`
- `KnowledgeProcessingSession`
- `KnowledgeProcessingSessionRequest`
- `KnowledgeProcessingPageWriter`
- `KnowledgeProcessingUsage`

Desktop Poller 只持有：

```text
run(prompt)
abort()
subscribeUsage(listener)
dispose()
```

Poller 不再导入或读取 `AgentSession`、`AgentSessionEvent`、`SessionManager`、`ToolDefinition`、
`modelRegistry` 和 `todoStore`。

### Legacy Adapter

`createLegacyKnowledgeProcessingSessionFactory()` 内部继续使用现有 `createAgentSession()`，并保持：

- 复用 Desktop 进程级共享 ModelRegistry。
- 模型解析前刷新远程模型。
- `setModel` 后设置 reasoning level。
- 按批次文件创建 Todo，并以 `scene` 锁定。
- 用轮级共享 `KbWriteSession` 注入 `kb_write_page`。
- `agent_end` 与 prompt settle 双完成边界。
- message usage 到稳定 usage Port 的投影。
- abort 与 dispose 的原透传语义。

### 根入口零允许守卫

包边界规则删除上一轮 5 个文件允许项。受治理生产源码只要精确引用
`@vetta/coding-agent` 就会失败；显式子路径和测试兼容合同继续允许。

## 明确未修改

- 没有删除或缩减 Coding Agent、Runtime Tools 或 Runtime Storage 根导出。
- 没有切换 CLI、RPC、IM、Desktop 或 Knowledge Processing 的默认 Runtime。
- 没有改变 Tool 名称、描述、Schema、顺序或执行结果。
- 没有改变 Knowledge 批次规划、并发数、Todo 内容、写页互斥、usage 上报或错误文本。
- 没有改变 Skill、MCP、Prompt、会话事件、RPC wire 或持久化格式。
- 没有为了接入 RuntimeHost 而删除 Todo 锁定或共享写页优化。

## TypeBox / Zod 判断

新增内容是进程内 TypeScript Port、Adapter 和 package export map，不包含新的 RPC、配置或持久化
反序列化输入，因此不新增 TypeBox/Zod Schema。

## 验证

- Knowledge Processing Legacy Adapter 与公开子路径合同：2 个文件、5 项测试通过。
- 包边界质量门禁：1 个文件、34 项测试通过。
- CLI Runtime selector：1 个文件、4 项测试通过。
- Root `tsgo --noEmit`、CLI `tsgo --noEmit` 和 Desktop 独立 `tsc --noEmit` 通过。
- `bun run check:quick` 通过，生产根入口扫描只剩两个测试文件。
- `bun run verify:artifact:installed`：1 个文件、3 项安装产物测试通过。
- `bun run check` 通过，覆盖 Biome、root tsgo、CLI、Desktop、Admin 和质量守卫。

## 下一步

实现 `KnowledgeProcessingSessionFactory` 的 Greenfield 版本。产品 Composition 应在创建 Session 时注入轮级
共享 Page Writer 和 Todo 初始化/锁定能力，不能把 Knowledge 对象或可写 Todo Store 下沉到 Runtime Core。
以 Legacy Adapter 作为 Oracle 比较模型选择、Tool Frame、Todo、写页、usage、abort 和 dispose；差分归零前
继续使用 Legacy Factory。
