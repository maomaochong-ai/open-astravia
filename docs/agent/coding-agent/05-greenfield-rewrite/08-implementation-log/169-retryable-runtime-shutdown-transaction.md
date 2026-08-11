# 第 169 轮：可重试 Runtime 最终关闭事务

## 目标

第 168 轮解决了 Session replacement 已提交后的旧资源清理诊断，但最终关闭链仍普遍采用“先标记 disposed，再顺序释放”的一次性实现。一旦中间资源失败，业务入口虽然关闭，失败资源却无法再次释放，后续资源也可能被短路。

本轮将 Runtime Session、Coding Agent Composition、Extension Host 与 IM RPC Host 的最终关闭统一为可重试资源事务，同时保持既有业务功能、RPC wire、Hook/Extension 事件和错误文案边界。

## 关闭合同

关闭状态按以下语义推进：

1. `open`：允许业务操作。
2. `closing`：首次关闭立即停止新的业务准入，并等待已经接收的切换或 Turn 静默。
3. `cleanup-pending`：所有资源均已尝试；失败任务仍被关闭事务持有。
4. `closed`：所有任务成功，后续 `dispose()` 为无副作用成功。

具体约束：

- 同一时刻的多个 `dispose()` 共享同一个在途清理 Promise。
- 同一 phase 的资源并行释放；前一 phase 失败不阻止后一 phase 尝试。
- 成功任务立即从 pending 集合移除，后续只重试失败任务。
- 单个失败保持原错误；多个失败才聚合为 `AggregateError`。原本已经对外聚合错误的 RPC/Composition 边界继续保留原聚合文案。
- `session_shutdown`、Hook `SessionEnd` 等生命周期事件最多发送一次，资源重试不得重复制造业务事件。

## 实施

### Runtime Core

新增 `RetryableCleanup`：以稳定任务 id、phase 和清理函数描述关闭计划。它只管理进程内资源生命周期，不理解 Session、Extension、MCP 或具体产品概念。

`GreenfieldRuntimeSession` 现在按以下阶段关闭：

1. 中止 Context compaction。
2. 释放 document participants。
3. 清空事件订阅。
4. 关闭 Kernel Session。
5. 释放 Composition-owned Session assembly。

第一次失败后 Session 仍保持 `session_closed`，再次 `dispose()` 只执行失败项。Kernel Session 与已经成功的 assembly 资源不会重复关闭。

### Coding Agent

- Active Session Host 将每次 replacement 后遗留的 finalize/previous Session 清理按原 transition 独立登记；最终 Host dispose 会再次尝试失败项，避免把旧错误错误归因给后续 replacement。活动 Session、事件订阅和监听器进入独立的最终关闭计划。
- Extension Event Host 将 `session_shutdown` 与错误监听、执行观察监听、事件 binding、Action Host 分阶段释放；retired binding 的 `emitSessionShutdown: false` 语义保持不变。
- 每个 Greenfield Session assembly 独立持有关闭计划，覆盖 Subagent、Context、Memory、Hook、Plugin MCP、Execution、Todo、Capability、各 Session registry 与 Conversation ownership。
- Composition 最终关闭对仍登记的 Session 资源、Repository、MCP synchronizer 和 Coding Tools 全部尝试；失败资源留在关闭计划中，下一次 `dispose()` 只重试失败项。

### CLI / IM Host

- Extension Session Host、RPC Session Adapter 和最终 IM Runtime Host 使用同一关闭合同。
- Host Tool 注销、Active Session、Composition、Extension、MCP source 分阶段清理；一个失败不会阻止其他资源释放。
- RPC Adapter 与最终 Runtime Host 继续抛出原有聚合错误文案，没有新增协议字段。
- CLI Vitest 增加 `@vetta/coding-agent/config` 与 `@vetta/coding-agent/hooks` 的源码 alias，使真实 Greenfield IM Runtime Host 测试能够从 package root 独立执行，不依赖陈旧 `dist`。

## 兼容性判断

本轮没有改变 Tool、Prompt、Skill、MCP、Knowledge、Extension 命令或 Session replacement 的业务行为。变化仅发生在资源所有者如何记录和重试失败清理：

- 成功关闭路径的调用次数和顺序保持不变。
- replacement 的 post-commit 清理仍只诊断、不把已提交 target 伪装为失败。
- 最终关闭仍返回清理错误；现在错误不会同时销毁重试资格。
- Conversation ownership、Hook Session 与 Extension shutdown 仍由原事实源保证幂等，不引入第二套生命周期状态。

## TypeBox / Zod 判断

`RetryableCleanupTask` 是纯进程内 TypeScript 合同，没有解析 JSON、RPC frame、配置或持久化数据，因此不需要 TypeBox/Zod。既有外部 RPC 输入继续使用原 TypeBox validator。

## 测试合同

- `RetryableCleanup`：并发调用共享在途操作；所有 phase 都会执行；第二次只重试失败项；完成后再次调用无副作用。
- Greenfield Runtime Session：participant 首次释放失败时，Runtime assembly 仍会释放；Session 立即拒绝 Prompt；第二次只重试 participant。
- Active Session Host：retired finalize 与 previous Session 首次失败后，在最终 dispose 重试，活动 Session 只释放一次。
- RPC Adapter：Session Host 首次失败不阻止 Tool 注销和 Runtime 释放，并发 dispose 不重复调用成功项。
- Composition ownership：Session 阶段首次释放失败后，最终 Composition 关闭仍能重试并成功释放。
- 真实 IM Runtime Host：16 项生产组合测试继续通过，包括 Extension `session_start/session_shutdown` 恰好一次与最终 Active Session 关闭。

## 明确未修改

- 没有新增 RPC wire、持久化 schema 或生产故障注入开关。
- 没有修改动态 Tool、Prompt、Skill 或 MCP 的运行时刷新语义。
- 没有以重建整份 Runtime snapshot 代替资源级失败跟踪。
- 没有删除 Legacy 实现或缩小既有功能面。

## 验证结果

- Runtime Core 关闭事务与 Session Backend：14 项通过。
- Active Session Transition Host：14 项通过。
- RPC Adapter 与 ownership 重试：16 项通过。
- 真实 Greenfield IM Runtime Host：16 项通过。
- `bun run check:quick` 通过。
- 根目录完整 `bun run check` 通过。

## 下一步

第 170 轮建议把同一原则应用到“构造失败回滚”而不是继续扩展最终关闭：审计 Runtime/Extension/MCP 初始化中已经创建部分资源后失败的释放顺序、错误聚合与重试边界，并增加真实 CLI 初始化失败后无锁、无子进程、无重复生命周期事件的门禁。仍不改变业务协议。
