# 第 171 轮：真实 CLI 初始化失败门禁

## 目标

在第 170 轮已经统一初始化回滚事务的基础上，补齐生产入口的可执行证据：

1. 最终 Session/Host/Assembly 返回值必须构造成功后，初始化事务才能提交。
2. 单个 MCP Server 初始化失败时，失败 Client 及其 stdio 子进程必须立即释放。
3. 使用真实 Vetta RPC CLI 验证初始化中途失败不会遗留 Extension、Hook、MCP 或 conversation ownership，并能立即恢复同一会话。
4. 保持现有功能语义，尤其不把 MCP 单服务故障升级为整个 Agent 启动失败。

## 分析结论

### 1. `commit()` 不能早于最终发布对象

第 170 轮已经覆盖了主要资源获取阶段，但以下边界仍先调用 `rollback.commit()`，再构造并返回最终对象：

- Runtime Core 的 Greenfield Runtime Assembly；
- Coding Agent 的 Session Composition Resources；
- CLI IM Runtime Host 的 ready 结果；
- Extension Session Host 的 prepared binding。

最终对象构造并非天然无异常，例如 session path 解析、带 getter 的宿主投影或未来新增的最终校验都可能抛错。如果事务已经提交，这类失败无法触发已登记资源的逆序回滚。

本轮采用统一规则：

> acquire/prepare → 构造最终发布对象 → commit → return

没有引入新的通用抽象，只调整现有事务的提交位置。

### 2. MCP 失败隔离不等于放弃失败资源所有权

`McpServerSupervisor.initialize()` 使用服务级隔离：一个 MCP Server 失败不会阻止其他 Server 或 Agent Session 启动。这是既有功能合同，应继续保留。

问题在于 `startServer()` 的 initialize/auth 失败路径只更新 Server 状态，没有关闭已经创建的 Client。对 stdio transport 而言，这会让失败子进程一直存活到整个 Agent 关闭。

本轮在失败分支中立即关闭 Client，并清除失败 Server 的 client binding；关闭失败只记录诊断，不覆盖原始启动错误，也不改变 MCP 的非阻断语义。

### 3. 真实 CLI 门禁必须覆盖完整所有权链

单元测试只能证明局部回滚顺序，不能证明真实 CLI 的组合顺序。新的门禁使用仓库既有 `agent-rpc-cli` 可执行测试入口，实际完成：

```text
CLI process
  → conversation ownership
  → Greenfield Runtime Session
  → Extension session_start
  → Hook session state
  → MCP stdio process
  → resource discovery failure
  → RPC initialize failure
  → session.dispose()
  → Extension session_shutdown
  → Hook SessionEnd
  → MCP process exit
  → ownership lock release
```

失败后使用同一个 conversation path 再次启动 CLI，验证 Session 能恢复、ownership lock 能重新获取、MCP 能重新启动并在正常退出时释放。

## 实施内容

### Runtime 与宿主发布边界

- `ComposedGreenfieldRuntimeFactory`：先构造 `GreenfieldRuntimeAssembly`，再提交回滚事务。
- Coding Agent Composition：先构造 Session resources，再提交回滚事务。
- Greenfield IM Runtime Host：先构造 ready 结果，再提交回滚事务。
- Greenfield Extension Session Host：在事务作用域内构造 prepared binding，成功后提交并返回。

### MCP 失败 Client 清理

- `McpServerSupervisor.startServer()` 在 initialize/auth 失败时 best-effort 关闭已创建 Client。
- 无论关闭是否成功，都移除失败 Server 的 client binding。
- 保留 `Promise.allSettled` 服务级隔离与原有错误状态。

### 测试

- Runtime Factory 新增最终 Assembly 投影失败用例，验证 Kernel Session 先于 Composition resources 逆序释放，并保留原始错误。
- MCP Supervisor 测试验证普通 initialize 失败和 auth-required 失败的 Client 均已关闭，且不进入可用 bindings。
- 真实 RPC CLI 新增两条门禁：
  - Extension resource discovery 注入初始化失败，验证 Extension/Hook/MCP/ownership 全部释放，并可恢复同一 Session。
  - MCP stdio 返回非法协议响应，验证失败子进程立即退出，但 CLI Session 仍可正常提供 `get_state`。
- 修正既有 system prompt 测试基线，显式包含 Extension 上下文初始化预览；不修改该预览行为。

## 明确未修改

- 没有修改 Tool、Prompt、Skill、MCP、Extension 或 Session 的业务功能。
- 没有改变 MCP 单服务失败的容错策略。
- 没有改变 RPC wire、Conversation 文件格式或 ownership 文件格式。
- 没有引入 TypeBox/Zod。此次没有新增外部协议；无效 Extension resource path 仅作为真实初始化故障注入。若未来要把 Extension 贡献变成稳定外部合同，应在 Extension 边界单独设计 schema 与兼容诊断。

## 验证结果

- `runtime-core/test/runtime-host/greenfield-runtime-factory.test.ts`：2 个测试通过。
- `runtime-mcp/test/server-supervisor.test.ts`：4 个测试通过。
- `cli-app/test/agent-runtime-initialization-failure.test.ts`：2 个真实 CLI 测试通过。
- 相关 Greenfield IM Host、Extension Host 与 Composition 测试纳入本轮回归。
- 根级 `check:quick` 与完整 `check` 在本轮结束前执行，最终结果以交付说明为准。

## 下一步

下一阶段应把初始化与关闭生命周期门禁整理为按资源所有者划分的故障矩阵，重点补齐“清理本身失败后再次 dispose/restart”的真实 CLI 场景，并据此审计仍在组合根中手写的 acquire/release 配对；只有存在重复协议时再抽象，不新增万能生命周期框架。
