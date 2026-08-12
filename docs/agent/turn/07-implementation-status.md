# 实施状态与边界结论

本文记录 ADR-0069 的当前实现事实。目标合同仍以
[02-consistency-contract.md](./02-consistency-contract.md) 为准。

## 1. 逻辑合同与资源身份隔离已经落地

### Turn admission 与释放

- `RuntimeSnapshotProvider.acquire(context)` 在一次 admission 中绑定 Runtime Snapshot、Model Binding、Prompt
  Preparer、Model Call providers/composer、Continuation、Context Strategy/Transformer 与 Message Finalizer。
- 所有 binder 在同一个 JavaScript job 中启动并先捕获各自 published pointer；异步物化完成前发生的更新不会
  让同一 Turn 混合新旧来源。
- 初始输入以原始 `SessionInputRequest` 入队，Prompt/Skill/Scene 展开和 `UserPromptSubmit` Hook 都在 acquire
  之后由已绑定 Preparer 执行。steer、follow-up 与自动 compaction 沿用同一 lease。
- 完成、失败、取消、preparer/binder 异常和 Session close 路径均释放已获取的子 lease；失败不会改绑 latest。

### Prompt、设置、模式与凭证

- AGENTS、Prompt、Skill 正文与目录、Personalization、图片策略、Agent Mode、active tool override、Plugin 配置、
  compaction 设置与 Extension context transformer 在 admission 捕获。
- Execution Mode/Sandbox Tool host 使用代际 Catalog；普通模式更新退休旧实现，活动 Turn 保留旧 sandbox policy。
- Model、reasoning 与不透明 credential binding 同 snapshot acquisition 返回。普通认证刷新只影响后续 Turn；
  显式清除/撤销认证会使旧 binding 的下一次 `resolve()` fail-closed。

### Tool、MCP、Plugin、Hook 与 Extension 实体

- Coding Tool Catalog 同时冻结 schema、activation、registration filter 与 implementation lease。普通
  replace/disable/unregister 不再撤销已广告给活动 Turn 的实现；显式 hard revoke 仍可即时拒绝。
- MCP Supervisor 使用 connection/process generation。完整候选 server set 成功后同步发布新 current，再异步退休
  旧连接；失败保留完整 last-known-good set，旧连接直到最后一个 Turn lease 释放后关闭。
- Plugin activation 采用 candidate staging 和原子 commit；激活失败保留上一个完整 activation。
- Desktop 主进程 Hook 与 Agent handler registry 都按 activation generation 路由并引用计数。Renderer handler key
  包含 `pluginId + handlerId + activationId`，普通 reload 后旧闭包保留到主进程 release 通知。
- Extension runner、custom tool、event/interceptor 与 compaction adapter 共享 generation owner，旧 runner 在最后
  一个相关 Turn 释放前不会 dispose；事件 host 只接收属于该 runner binding 的 `turnId`。

## 2. 更新与故障语义

- 普通设置、模式、资源、Plugin、MCP、Tool 与 Extension 更新只发布新 generation，不回写活动 Turn。
- candidate 构建失败不部分 publish；新 Turn 继续使用完整 last-known-good generation，并保留可诊断失败。
- normal retirement 与 hard revocation 使用不同 API。只有明确的安全撤权、凭证撤销或 deny/kill switch 可以
  在活动 Turn 的安全检查点收紧能力。
- Renderer/Plugin process 崩溃、MCP transport 断线、网络失败属于物理故障；它们可以让绑定代执行失败，但不允许
  静默切到新配置 generation 重试旧调用。

## 3. Subagent 决策

Subagent 是独立 Session/Turn：父 Turn 始终保持自己的 generation；child 首个 Turn 在自己的 admission 原子捕获
当时 current。父上下文快照、child profile 与过滤后的 MCP view 是显式不可变创建输入，不共享父 Tool 或 lease。
该边界避免跨 Session 资源所有权耦合，同时满足“普通配置更新不回写已经运行的 Turn”。它不保证父子 Turn
共享同一外部物理状态，也不提供无损执行保证。

## 4. 已覆盖的关键回归

- snapshot/model 同源捕获、异步 binder barrier、失败与精确释放；
- Prompt admission、queued request、Skill/Scene 内容冻结；
- Tool schema/handler 同代、activation/filter 冻结、ordinary retirement 与 hard revoke；
- MCP 同名 server 重载、失败 LKG、旧 connection/process lease；
- Plugin candidate commit、同 handler id 的多 activation 并存、Hook/Agent handler release；
- Extension runner、event、tool、interceptor、context/compaction binding；
- credential 普通刷新隔离与显式 revoke。

## 5. 不属于执行隔离的后续增强

当前执行正确性不依赖统一的 `generationId` UI，但产品仍可继续补充：

- 将各领域 revision id 汇总为统一的脱敏诊断 descriptor；
- 在 Desktop/CLI 完整展示 desired、published、effective、pending 与 apply-failed；
- 增加 generation lease age、retired count、LKG fallback 与 hard-revoke audit 指标；
- 增加包含真实 Electron wiring 的灰度/故障注入验证。

这些是可观测性与运营能力，不再是“普通热更新会改变活动 Turn 逻辑合同”的数据面缺口。

## 6. 当前结论

会改变模型可见能力、权限和执行语义的外部状态，已经从 live current lookup 收敛为 Turn-bound binding：
普通热更新只对后续 Turn 生效，资源普通 retirement 等待 lease drain，安全撤权显式且单向收紧。

该结论不覆盖网络、进程、文件系统、远端 Provider 等物理世界，也不承诺 Turn 无损完成；这些状态保持实时，
失败沿既有错误/取消/重试合同传播。边界分类见 [08-binding-boundaries.md](./08-binding-boundaries.md)。
