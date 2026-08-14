# ADR-0069: Turn 绑定不可变 Runtime Generation

## 状态

Accepted

## 背景

Runtime Kernel 已经在 Turn 开始时获取 `RuntimeSnapshotLease`，但 snapshot 内的 Prompt、Tool、Skill、
Plugin、MCP、Hook 与 Extension provider 仍会在每次 Model Call 或 dispatch 时读取 mutable current state。
模型绑定也在 snapshot acquisition 之后独立读取。结果是一个长 Turn 可能同时使用多个外部配置代，
Tool schema 与实际 handler 甚至可能来自不同 activation。

Agent Mode 已按 ADR-0046 采用“全局选择立即更新、下一个 Turn 生效”，而 Plugin Hook 的 ADR-0064
采用“下一次 dispatch 生效”。不同领域的生效边界和 pending 状态无法组成一个原子、可回退的运行时合同。

## 决策

外部运行时状态按 process、workspace 和 session scope 发布为不可变 revision。Coding Agent 在 Turn
admission 的第一次异步等待之前原子捕获三层 revision，并物化或复用一个可执行 `RuntimeSnapshot`。
Kernel 获取的单一 lease 同时携带 snapshot 和基于同一捕获产生的模型绑定；整个 Turn 的 Model Call、
Tool execution、Prompt、Skill、Plugin、MCP、Hook、Extension 与 Sandbox policy 只读取该 generation。

更新可以在活动 Turn 期间完成读取、校验和发布，但不回写活动 lease，只影响捕获发生在发布之后的
新 Turn。Session/Conversation 不被冻结；retry、显式 continue 和用户下一条输入创建新 Turn 并重新捕获。

外部对象不要求全部深拷贝。不可变 catalog 可以共享；Plugin activation、MCP supervisor、Extension
runner、Sandbox host 和 Tool implementation 等有生命周期资源由 generation lease 延迟普通 retirement 回收。
Lease 不快照物理世界，也不保证进程、连接、网络、凭证服务或远端 Provider 存活；这些故障按既有错误语义传播，
且不得为了恢复而静默切换到新配置 generation。

安全撤权使用独立 hard-revocation 通道。它必须携带 scope、reason 和 audit metadata，可以在声明的
安全检查点立即拒绝或取消敏感操作；普通更新不得复用该通道。权限放宽只对新 Turn 生效。

候选读取、解析或校验失败时不发布。Session-specific 物化失败时保留一个完整的 last-known-good
generation 并显式报告 `apply_failed`；不得使用部分新、部分旧的混合代。安全收紧在发布/物化失败时
仍由 hard revoke fail-closed。

`runtime-core` 只拥有通用 acquisition、lease 和 Turn 生命周期合同，不认识产品 revision。
`coding-agent` 拥有 revision capture 与产品 snapshot materialization；各 `runtime-*` 包拥有其资源
generation 和 lease 实现；Desktop/CLI 只发布来源并展示 desired、published 与 effective 状态。

完整一致性合同、目标架构和迁移计划见 [`docs/agent/turn`](../agent/turn/README.md)。

## 备选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 每次 Model Call 缓存一份 current state | 否决 | Tool execution 与 Hook dispatch 仍可跨代，同一 Turn 的后续 Model Call 仍会漂移 |
| 各领域分别维护 `pending*` | 否决 | 无法原子发布、失败回退或证明不存在混合代 |
| 整个 Session 冻结 | 否决 | 长生命周期 Conversation 无法及时使用更新 |
| 普通 reload 立即使旧 binding 失效 | 否决 | 破坏已经向模型公布的 schema/handler 合同，并把更新错误地等同安全撤权 |
| 活动 Turn 热替换 provider 对象 | 否决 | provider 闭包仍可能读取 mutable source，对象拓扑稳定不等于行为稳定 |

## 后果

- 同一 Turn 的外部能力与 Prompt 具有可证明的一致 generation；更新最迟从下一个 Turn 自动生效。
- Runtime acquire contract 同时绑定 snapshot 与 model，原有独立 post-acquire bind 路径被移除。
- Model Call provider 仍可根据本 Turn 的消息、Tool result、todo、usage 与 deferred activation 改变 Frame，
  但不能读取新的外部 revision。
- Tool、Plugin、MCP、Hook、Extension 和 Sandbox 需要 generation-aware resource ownership，更新期间可能短暂
  并存新旧资源，必须监控 retired generation 数和 lease age。
- Turn binding 保证逻辑合同与资源身份不因普通更新漂移，不保证 Turn 无损完成；执行状态、物理健康和明确的
  hard revocation 保持实时。
- UI 需要区分 desired、published、effective、pending 与 apply failure。
- ADR-0046 的 Turn 边界语义保留并进入统一 session overlay；ADR-0064 的 next-dispatch 可见性被本 ADR
  的 next-Turn generation 可见性取代。Hook adapter 的单一领域模型、权限和聚合决策继续有效。
