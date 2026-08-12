# 现状与差距

## 1. 结论

Vetta 已经有正确的骨架，但一致性边界没有闭合：

- Kernel 在 Turn 开始时获取一次 `RuntimeSnapshotLease`，Turn 结束后释放；模型选择也按 Turn 绑定。
- `AtomicRuntimeSnapshotProvider` 能让旧 generation 在活动 lease 释放前继续存活。
- `RuntimeCapabilityComposition` 能原子替换后续 Turn 使用的 snapshot，并在重编译失败时保留当前有效代。
- Agent Mode 和部分 Plugin 配置已经通过 Runtime Host 的 pending 逻辑推迟到 Prompt/Turn 边界。

问题在于，当前 `RuntimeSnapshot` 内仍包含会读取可变 Session/进程状态的 Provider、Composer 和 Tool
wrapper。它们在同一 Turn 的下一次 Model Call、Tool execute 或 Hook dispatch 时重新读取当前目录，导致
“外层 snapshot 没换，内层事实已经换了”。

因此本次工作不是新增第二套 Agent Runtime，而是让现有 snapshot lease 真正闭包化：snapshot 中的对象
只能读取该 generation 的不可变值和 Turn-local state，不能回到全局 current pointer。

## 2. 已具备的正确基础

### 2.1 Kernel Turn lease

[`TurnPipeline`](../../../packages/runtime-core/src/kernel/turn-pipeline.ts) 在 `snapshot_binding` 阶段调用
`RuntimeSnapshotProvider.acquire()`，并在 `finally` 中释放 lease。`turn.started` 事件已经保存
`snapshotId`，具备追踪一次 Turn 绑定代的基础。

[`AtomicRuntimeSnapshotProvider`](../../../packages/runtime-core/src/kernel/runtime-snapshot-provider.ts) 维护
current generation、活动 lease 数和 retired 状态：

- `swap()` 只替换 current pointer；
- retired generation 有活动 lease 时不释放；
- 最后一个 lease 释放后才 dispose；
- `close()` 等待所有 generation 不再使用。

这正是 Plugin handler、MCP connection 和 Tool implementation 保活所需要的底层模型。

### 2.2 Session capability generation

[`RuntimeCapabilityComposition`](../../../packages/runtime-core/src/kernel/runtime-capability-composition.ts)
已经实现 newest-wins 重配置：编译完成后原子发布新 snapshot，失败不破坏旧代，旧代由 lease 延迟释放。

### 2.3 Turn 模型绑定

`RuntimeTurnModelBindingProvider.bind()` 与 snapshot 在同一 Pipeline 阶段读取。模型和 reasoning 已经满足
“运行中切模只影响后续 Turn”的目标，不应重新并入新的产品状态对象。

### 2.4 部分宿主 pending 语义

[`RuntimeHost`](../../../packages/runtime-core/src/runtime-host/runtime-host.ts) 已对两类更新做 Turn 边界处理：

- `setGlobalAgentMode()` 写入每个 Session 的 pending mode，在 Prompt/continue 前应用；
- `reconfigureAgentPlugins()` 保存 pending plugin config，Session busy 时不应用。

说明现有产品意图已经认可 Turn 边界，只是不同状态源各自实现，且没有覆盖全部动态贡献。

## 3. 当前会漂移的路径

| 领域 | 当前读取或变更边界 | 同一 Turn 内的风险 | 目标边界 |
| --- | --- | --- | --- |
| Coding Tool Catalog | 每次 Model Call refresh/snapshot | 第二次模型请求看到新增、删除或替换后的工具 | Turn admission |
| MCP | 每次 Model Call `refreshCatalogForModelCall()` | Tool schema、Prompt 和连接代发生变化 | Turn admission；同代 reconnect 例外 |
| Prompt/Settings | 每次 Model Call reload resource/settings | system prompt、persona、AGENTS.md、Skill 列表漂移 | Turn admission |
| Agent Mode | Host pending，但下层仍通过 callback 实时读取 | 非 Host 入口或直接 SDK 调用可能绕过 pending | Turn admission 的统一 state capture |
| Execution Mode | 活动时直接拒绝全局切换 | 用户无法先修改、等待下一 Turn 生效 | 立即发布 desired generation，活动 Turn 保持旧代 |
| Plugin Tool | 每次 Model Call 读 config，执行前再次读 current | 普通 reload 后，已公布的旧工具会被视为 revoked | Turn generation；仅 hard revoke 立即拒绝 |
| Plugin MCP | reconfigure 直接替换 Session runtime | 活动 Turn 的 MCP 工具和 server 可能变化 | generation + connection lease |
| Plugin Prompt/Continuation | Provider 第一次运行或 collect 时读 current | Turn 已开始但 Provider 尚未运行时可读到新插件 | Turn admission |
| Skill | Model Call 和 invoke 时刷新磁盘 | 同一 Turn 的 Skill 可消失或正文改变 | 内容寻址的 Turn Skill catalog |
| Extension Tool | 每次 Model Call 读 Session overlay | 后续 Model Call 看到新定义 | Turn generation |
| Desktop Hook | 每次 Hook dispatch 读取 Registry snapshot | 同一 Turn 前后 Hook 集合可不同 | Turn Hook generation |
| Tool Interceptor | Tool execute 时读取 Catalog snapshot | 不同 Tool Call 使用不同 interceptor 集 | Turn generation |

### 3.1 Model Call Provider 读取实时 Tool/MCP

[`createCodingToolsFeature`](../../../packages/runtime-tools/src/coding/coding-tools-feature.ts) 在每次
`contribute()` 时调用 `refreshCatalog`，再读取 `catalog.snapshot()`。Coding Agent 将该刷新接到
[`mcp-session-coordinator.ts`](../../../packages/coding-agent/src/composition/tool-surface/mcp-session-coordinator.ts)，
所以一个 Tool Loop 中的后续模型调用会再次读磁盘/MCP source。

现有测试也明确保护这种旧语义，例如：

- `runtime-core/test/kernel/model-call-frame.test.ts` 断言动态贡献不重编译 Feature 也会刷新；
- `runtime-tools/test/coding/coding-tools-feature.test.ts` 断言删除工具后下一 Model Call 刷新；
- `coding-agent/test/runtime-core/mcp-session-coordinator.test.ts` 断言每个 Model Call 可触发 MCP refresh。

这些测试需要改成“当前 Turn 不变、下一 Turn 变化”的新合同测试。

### 3.2 Prompt、资源和 Skill 读取实时磁盘

[`CodingAgentPromptRuntime`](../../../packages/coding-agent/src/model-context/prompt-runtime.ts) 在每次 resolve 时：

- refresh context resources；
- refresh skills；
- reload personalization settings；
- 读取当前 Agent Mode、Memory 和 Plugin config。

[`createCodingAgentInvokeSkillFeature`](../../../packages/coding-agent/src/resources/skills/invoke-skill-feature.ts)
不仅在 Model Call 重新扫描 Skill，执行 `invoke_skill` 时还再次读取正文。这避免了执行旧工具，但违背了本次
要求：普通文件刷新不应让活动 Turn 中已经公布的 Skill 消失或换正文。

### 3.3 Plugin 与 Hook 的普通更新被当成撤权

[`CodingAgentPluginToolRuntime`](../../../packages/coding-agent/src/plugins/runtime/tool-runtime.ts) 在 compose
和 execute 两次读取 `readAgentPlugins()`。只要普通 reload 删除或替换贡献，旧 Tool Call 就返回
`plugin_tool_revoked`。普通热重载和安全撤权因此没有区分。

Desktop Hook adapter 在每次 dispatch 调用
[`DesktopPluginHookRegistry.snapshot()`](../../../packages/desktop-app/src/main/plugins/coding-agent-hook-registry.ts)，
所以 `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 可能来自不同插件 activation 集。

Tool interception wrapper 也在工具真正执行时调用
[`catalog.snapshot()`](../../../packages/coding-agent/src/interception/tool/pipeline.ts)，保证的只是“单次 Tool
dispatch 内稳定”，不是 Turn 内稳定。

### 3.4 Execution Mode 的行为与目标不一致

`setGlobalExecutionMode()` 会先检查所有 Session；任一 Session busy 时整个更新报
`EXECUTION_MODE_SWITCH_BLOCKED`。这避免了运行中 swap，但没有提供“修改已接受、下一个 Turn 生效”的产品
体验，也使 Execution Mode 和 Agent Mode/Plugin 使用三套不同策略。

## 4. 根因

### 4.1 Snapshot 只冻结了对象拓扑，没有冻结对象的读取源

`FeatureCompiler` 会冻结 instructions、tools 和 Provider 数组，但无法冻结闭包内部的
`readAgentMode()`、`readAgentPlugins()`、`catalog.snapshot()` 或磁盘 reload。对象不可变不等于依赖不可变。

### 4.2 更新、发布、使用和撤权没有分离

当前许多 Registry 同时负责：

- 接收注册/删除；
- 暴露当前视图；
- 仲裁执行；
- 表达安全 revoke；
- 释放底层进程/handler。

这会迫使调用方在“继续使用旧定义”和“保证已删除能力不能执行”之间二选一。目标架构必须区分普通
generation retirement 与 hard revocation。

### 4.3 各领域各自维护 pending 状态

Agent Mode、Plugin、Execution Mode、MCP 和资源 reload 的 pending/refresh 策略不同，无法证明它们在同一
Turn 上构成一个一致的组合。需要一个单一 admission capture，而不是继续增加 `pendingXxx` 字段。

## 5. 与既有规则和 ADR 的冲突

以下内容是有意的合同变更，不能在编码时静默绕过：

- `packages/coding-agent/AGENTS.md` 当前要求动态 Tool、MCP、Skill、Plugin 和 Prompt 在 Model Call 边界读取
  最新状态。
- `packages/coding-agent/README.md` 当前声明同一 Turn 的后续模型调用可以观察运行时注册/移除。
- 全面重写方案的执行 Pipeline 文档把 Model Call Frame 定义为允许同一 Turn 观察受控外部变化。
- ADR-0064 把 Plugin Hook 的稳定边界定义为单次 dispatch。

ADR-0046 已经规定 Agent Mode 的 runtime/Prompt 重建推迟到下一 Turn，和目标方向一致，只需迁移到统一机制。

## 6. 外部实现参考的取舍

- Codex 的 `TurnContext + StepContext` 证明了按生命周期拆分快照有效，但它允许旧 Turn 的新 Step 绑定最新
  MCP；Vetta 不采用这一点。
- Grok 的 Plugin Registry snapshot 和 Toolset SwapPolicy 证明了 generation/Turn gate 可落地，但其 MCP、
  Hub Tool 和 Plugin fan-out 仍有活动 Turn 更新例外；Vetta 只为显式 hard revocation 保留例外。

## 7. 改造必须保持的不变量

- Provider role、Tool Call/Result 配对、usage、stop、错误和取消语义不变。
- ConversationDocument 仍是历史事实源，外部状态 revision 不写成用户消息。
- Tool schema、名称、描述、结果和副作用不因架构改造而变化。
- Session 切换、Conversation continuation、队列和压缩的身份/提交事务不退化。
- 普通 reload 不取消活动 Turn；hard revocation 可以收紧或取消，但不能扩大权限。
- 编译或发布失败不能破坏最后一个已发布 generation，也不能静默宣称新设置已生效。
