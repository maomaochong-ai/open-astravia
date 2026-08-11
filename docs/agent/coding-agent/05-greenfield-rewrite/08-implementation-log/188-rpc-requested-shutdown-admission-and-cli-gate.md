# 第 188 阶段：RPC 请求关闭准入与 CLI 测试收口

## 阶段目标

修复 Extension 请求关闭时重入当前处理函数的 RPC 生命周期竞态，消除命令准入差异测试的 Host profile 干扰，并收口多进程 Runtime 选择测试的合理时间预算。

本阶段只调整共享 RPC 生命周期和测试组合，不改变 Legacy 或 Greenfield 的业务功能。

## 问题分析

### 1. 关闭请求与关闭执行发生重入

`ctx.shutdown()` 通过 `onShutdownRequested` 进入共享 RPC Mode。原实现会在该回调中立即调用 `session.shutdown()`，因此 `session_shutdown` Extension 事件可能在发起关闭的 Extension 处理函数返回前执行。

这会产生如下错误顺序：

1. `handler-before`；
2. `session-shutdown`；
3. `handler-after`。

`ctx.shutdown()` 的语义应是提交关闭请求，不应同步重入请求者。实际关闭仍由 RPC Mode 统一执行。

### 2. 命令准入差异测试混入 Host profile 差异

测试启动器默认让 `greenfield-im` 启用 `im-claw` Host Bridge，而 Legacy 默认不启用。等待 `host_response` 的用例因此无法在 Legacy 侧生成 `host_request`，该失败不是 Runtime 功能差异。

### 3. Runtime 选择用例使用了默认 5 秒预算

fresh、resume、continue 用例连续启动三个真实 CLI 进程，隔离运行能够通过，但在全量并行负载下可能超过 Vitest 默认 5 秒。

## 本阶段实施

### 共享 RPC Mode

修改 `packages/coding-agent/src/modes/rpc/rpc-mode.ts`：

- `onShutdownRequested` 只记录关闭意图并调度一次微任务；
- 关闭执行离开发起者的当前调用栈，避免 Extension 回调重入；
- 保留既有 `shutdownPromise` 幂等保护；
- 保留 Transport、Bridge、长操作、活动 Prompt、Session shutdown 与 dispose 的原有清理顺序。

没有在 Legacy adapter 或 Greenfield adapter 中增加分支修复，两者继续共享同一 RPC 生命周期合同。

### 回归测试

修改 `packages/coding-agent/test/rpc/rpc-command-dispatcher.test.ts`，新增失败优先测试，验证：

- 接受关闭请求时不会同步调用 `session.shutdown()`；
- 请求者完成后才执行 Session shutdown；
- shutdown 和 dispose 均只执行一次。

### CLI 差异测试

修改 `packages/cli-app/test/agent-runtime-command-admission-differential.test.ts`：

- 定义受 `StartAgentRpcOptions` 静态约束的共享 Host profile；
- Legacy 与 Greenfield 均启用 Host Bridge 并使用 `im-claw` 场景；
- 套件中的全部 RPC 进程使用相同 Host profile，只替换 backend。

修改 `packages/cli-app/test/agent-runtime-selection.test.ts`，仅为启动三个真实进程的 fresh/resume/continue 用例设置 30 秒局部超时，没有修改全局测试预算。

本阶段不需要 TypeBox 或 Zod。改动没有新增不可信运行时输入边界，测试选项已有 TypeScript 类型约束。

## 验证结果

- 失败优先验证：旧实现下 RPC 单元测试 15 项通过、1 项按预期失败；
- 修复后 RPC 定向测试：16/16 通过；
- 命令准入与 Runtime 选择定向测试：19/19 通过；
- CLI 默认并行套件：209/210 通过，本阶段原有 3 个失败全部消失；
- 默认并行套件唯一失败为既有 Subagent 状态持久化 revision 冲突，隔离运行 3/3 通过；
- CLI 单 worker 全量套件：210/210 通过；
- `bun run check:quick`：通过。
- `bun run check`：通过，包含 Biome、monorepo 与 CLI/desktop-app/admin 类型检查及质量守卫。

coding-agent 全包测试当前为 1018 项通过、76 项失败、45 项跳过，并有 3 个未处理错误。失败集中在既有 Windows 路径与 PowerShell 假设、模型 fixture、旧提示词、SettingsManager 和并发知识写入测试；本阶段新增 RPC 测试通过，未将这些独立基线问题混入当前修复。

## 阶段结果

RPC 关闭现在具有明确的非重入请求边界，Legacy 与 Greenfield 的命令准入比较不再受到 Host profile 默认值干扰，多进程 Runtime 选择用例也有局部且合理的时间预算。

本阶段负责的功能基线已经闭合。CLI 默认并行套件仍存在一个独立的 Subagent revision 竞态，应在后续阶段单独修复，不能通过串行化产品逻辑或放宽断言掩盖。
