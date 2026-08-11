# 第 168 轮：Session Replacement 提交与清理合同

## 目标

第 164 至 167 轮已经覆盖 replacement 的资源事务、并发准入、Extension/Hook 生命周期和真实 CLI 时间线。本轮收敛最后一个易产生身份歧义的边界：target 已经提交后，旧 Extension binding、旧 Session 或 Conversation ownership 清理失败时，RPC 返回、当前身份与后续工作必须一致。

本轮仍遵循“只重构架构，不重构功能”：不改变 new、switch、fork、Prompt、Tool、Skill、MCP、Hook 或 Extension 协议。

## 事实基线与问题

Legacy 在完成会话身份替换和 `session_switch/session_fork` 后，当前 Session 已是 target；它没有 Greenfield 双 Session 架构中的“提交后释放旧 Session 对象”阶段。

Greenfield 原实现已经使用 `Promise.allSettled` 同时尝试 binding `finalize` 与 previous Session `dispose`，也不会把活动身份切回 source。但任一清理失败仍会从 replacement 命令抛出异常，因此可出现：

- RPC 返回失败；
- 紧接着 `get_state` 却显示 target；
- 调用方按失败重试后重复创建或再次切换；
- source Hook 被误判为需要恢复的风险。

另一个实际问题位于 ownership 释放链：Composition 在释放前先移除 binding，binding 和文件 lease 又在 I/O 成功前标记 disposed/released。一次瞬时文件系统错误会让最终 Runtime 清理失去重试机会。

## 提交与清理合同

Replacement 明确分为三段：

1. **Prepare**：target 尚未成为权威身份；prepare、binding commit 或 after 失败时回滚到 source。
2. **Commit**：活动 Session、事件订阅、Extension binding 与 after 事件均已切到 target；此后不可伪回滚。
3. **Cleanup**：并行尝试旧 binding finalize 与 previous Session dispose；失败进入诊断，但 replacement 仍按成功返回。

因此 post-commit 清理失败后的稳定结果是：

- `new_session/switch_session/fork` 不返回会诱导重试的伪失败；
- `readSession/get_state` 均指向 target；
- 下一 Prompt 在 target 上执行；
- source 不重新产生 `SessionStart("resume")`；
- 所有清理动作均被尝试，一个失败不会短路另一个；
- 后续 replacement 继续可进入，不被前一次诊断永久阻塞。

## 实施

### Active Session Host

`CodingAgentGreenfieldActiveSessionHostOptions` 新增窄 `onTransitionCleanupError` 诊断端口。Host 将多个 post-commit 清理错误聚合为 `AggregateError` 后交给该端口；未注入端口时使用现有 stderr warning。诊断端口自身异常也被隔离，不会改变已经提交的业务结果。

没有新增通用 Transaction Manager，也没有让 Runtime Core 理解 Extension、RPC 或 ownership 细节。

### Ownership 重试链

- `ConversationOwnershipBinding` 只在 lease 真实释放成功后标记 disposed，并复用并发中的同一个释放 Promise；失败后允许再次调用。
- `GreenfieldRuntimeComposition` 只在 binding 释放成功后从 ownership 集合移除；Session dispose 失败时，binding 仍由 Composition 持有。
- `FileConversationOwnershipManager` 的 lease 只在锁删除成功、锁已不存在或 token 已不属于本 lease 后标记 released 并停止心跳；瞬时文件系统错误保留重试资格。

最终 Runtime dispose 因而可以对 Session 阶段未释放的 ownership 再尝试一次。

## 测试合同

- Active Session Host 同时注入 finalize 与 previous dispose 失败，验证两项错误均被聚合、replacement 返回成功、target 可 Prompt、后续 replacement 可继续且 source Hook 不恢复。
- RPC Adapter 验证 replacement 成功响应、`get_state` 和下一 Prompt 使用同一 target identity。
- Composition 验证 Session ownership 首次释放失败后，最终 Runtime dispose 会执行第二次释放。
- Binding 单元测试验证失败后可重试。
- Runtime Storage 使用真实锁路径制造首次文件系统释放失败，恢复锁文件后第二次 release 必须真正删除锁。

## TypeBox / Zod 判断

本轮没有新增外部 JSON、RPC frame、配置或持久化格式。新增诊断端口和清理状态均为进程内类型化合同；RPC 外部输入仍由既有 TypeBox validator 校验，因此不引入新的 TypeBox/Zod Schema。

## 明确未修改

- 没有新增或修改 RPC wire 字段。
- 没有把 cleanup error 当成静默成功；它仍通过显式诊断端口或 stderr 暴露。
- 没有改变提交前失败的回滚、target 删除或 Hook 恢复语义。
- 没有改变 ownership lock 文件格式、冲突检测、token 校验或 stale reclaim 规则。
- 没有增加生产故障注入开关。

## 验证结果

- Active Session Host：13 项通过。
- Greenfield RPC Adapter 与 ownership 最终清理：15 项通过。
- Conversation Ownership Binding：3 项通过。
- Runtime Storage ownership lease：4 项通过。
- `bun run check:quick` 通过。
- 根目录完整 `bun run check` 通过（Biome、monorepo/CLI/Desktop/Admin 类型检查与质量守卫）。

## 下一步

第 169 轮建议审计 Runtime/Host 最终关闭的“多资源失败但全部尝试”合同：重点检查 Active Session、Extension Session Host、Greenfield Composition 与 RPC Adapter 各自的 dispose 幂等性、错误聚合和 ownership/Hook 去重，避免某一层提前标记 disposed 后让同层剩余资源永远失去清理机会。仍应先冻结 Legacy 与当前真实 CLI 的可观察关闭结果，不扩展 RPC 协议。
