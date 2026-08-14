# 分领域迁移方案

## 1. 迁移原则

迁移不是在所有 `getCurrent*()` 外再套一层缓存，而是把动态读取分成三类：

1. **发布期读取**：文件、设置、Plugin、MCP 等外部来源，只在构造候选 revision 时读取；
2. **Turn admission 读取**：只捕获不可变 revision 指针并物化或复用 snapshot；
3. **Turn-local 读取**：只读当前 Turn 自己产生的消息、工具结果和运行状态。

每个领域的完成标准都是：从 `RuntimeSnapshotLease` 获取到的执行路径中，不再访问该领域的 mutable global/session current state。

## 2. Kernel 与 Session composition

### 当前问题

`packages/runtime-core/src/kernel/turn-pipeline.ts` 已经在 Turn 开始时获取 `RuntimeSnapshotLease`，但 `RuntimeSnapshotProvider.acquire()` 没有 admission context，且 snapshot 内部 provider 可以继续读取实时状态。

`packages/runtime-core/src/kernel/runtime-capability-composition.ts` 已支持 generation swap、newest-wins 和 lease drain，可以作为资源管理基础，不需要重写一套 generation 容器。

### 目标改造

- 为 `RuntimeSnapshotProvider.acquire()` 增加 `sessionId`、`turnId`、`signal` context；
- 将 `RuntimeTurnModelBinding` 纳入同一次 lease acquisition，删除 acquire 后独立读取 live model runtime 的竞态；
- 把 acquisition 提前到所有动态 Prompt、Plugin hook、preparer 之前；
- 在 `RuntimeSnapshot` 中增加最小 generation descriptor；
- 保持 lease 在 Kernel `finally` 统一释放；
- 让 snapshot `dispose()` 级联释放产品物化时获取的 resource leases；
- 保留现有 compile failure 保持旧代、retired generation 延迟释放语义。

### 主要文件

- `packages/runtime-core/src/kernel/contracts.ts`
- `packages/runtime-core/src/kernel/turn-pipeline.ts`
- `packages/runtime-core/src/kernel/runtime-snapshot-provider.ts`
- `packages/runtime-core/src/kernel/runtime-capability-composition.ts`
- `packages/runtime-core/src/kernel/contracts.ts` 中的 Turn event contracts

如果公共 exports 发生变化，同步更新 `packages/runtime-core/package.json#exports` 和对应合同测试。

## 3. Coding Agent 发布与物化

### 当前问题

`packages/coding-agent/src/host/session-configuration/configuration-state.ts` 暴露多个 mutable getter；`RuntimeHost` 又分别维护 Agent Mode 和 Plugin pending 状态。这样无法证明一次 Turn 绑定的是完整一致的一组配置。

### 目标改造

在 Coding Agent composition 层新增统一模块，建议目录：

```text
packages/coding-agent/src/composition/turn-state/
  published-state-coordinator.ts
  published-state-revision.ts
  session-state-overlay.ts
  session-turn-snapshot-provider.ts
  turn-snapshot-materializer.ts
  generation-diagnostics.ts
```

模块职责：

- `PublishedStateCoordinator` 聚合 process/workspace 级来源；
- process 与 workspace 分 scope 发布，workspace revision 显式记录父 process revision；
- `SessionStateOverlay` 原子发布 session 级设置；
- `SessionTurnSnapshotProvider` 在 admission 捕获 composite key；
- `TurnSnapshotMaterializer` 构建稳定 `AgentProfile` 与 resource leases；
- 对相同 key 的并发物化做 single-flight；
- 每个 Session 维护最后成功 generation、当前目标 revision 和失败诊断。

`RuntimeHost` 的 `pendingAgentMode`、`pendingAgentPlugins` 和 Execution Mode busy 拒绝路径最终删除，由 session overlay publisher 统一替代。设置操作返回“已发布，将从下一 Turn 生效”，而不是等待当前 Turn 完成后才接受更新。

### 主要文件

- `packages/coding-agent/src/host/session-configuration/configuration-state.ts`
- `packages/coding-agent/src/host/session-execution/execution-runtime.ts`
- `packages/coding-agent/src/composition/runtime-composition.ts`
- `packages/runtime-core/src/runtime-host/runtime-host.ts`
- `packages/runtime-core/src/runtime-host/types.ts`

其中 `runtime-core` 的 Host 只能接收通用 session overlay/update port，不能依赖 Coding Agent 的产品 revision 类型。

## 4. Prompt、Resource、Skill 与 Personalization

### 当前问题

`packages/coding-agent/src/model-context/prompt-runtime.ts` 会在 Model Call 时刷新 context resources、Skill 与 personalization，并读取当前 mode、memory 和 plugins。`packages/coding-agent/src/resources/skills/invoke-skill-feature.ts` 也明确按 Model Call 或 invoke 读取最新 Skill。

这会让一次 Turn 的 System Prompt、Skill 列表和实际 Skill 内容来自不同时间点。

### 目标改造

- watcher/loader 在控制面生成 immutable resource revision；
- admission 物化时解析本 Turn 的 System Prompt 片段、Skill metadata 和 personalization；
- `PromptRuntime` 改为消费 `TurnPromptSnapshot`，不得主动 reload；
- `invoke_skill` 按 Turn-bound skill catalog 解析与读取内容；
- 同一 Turn 内允许根据上下文决定是否展示某个已捕获 Skill，但候选集合与内容 revision 不变；
- memory/todo 分为 generation 外部基线与 Turn-local overlay：本 Turn 自己写入的内容可以在后续 Model Call 可见，外部写入只能下个 Turn 可见；
- 文件读取失败在发布/物化阶段报告，不能在第二次 Model Call 静默更换内容。

建议引入的不可变产品对象：

```text
TurnPromptSnapshot
TurnResourceCatalog
TurnSkillCatalog
TurnPersonalizationSnapshot
```

这些对象可以共享内容寻址缓存，但 lookup 必须包含捕获的 revision/hash，不能只用路径查最新文件。

### 主要文件

- `packages/coding-agent/src/model-context/prompt-runtime.ts`
- `packages/coding-agent/src/resources/skills/invoke-skill-feature.ts`
- `packages/coding-agent/src/resources/runtime/context-resources.ts`
- `packages/coding-agent/src/settings/runtime/settings-state.ts`
- `packages/coding-agent/src/model-context/system-prompt-sources.ts`
- `packages/coding-agent/src/composition/model-call/**`

## 5. Tool catalog 与 Tool execution

### 当前问题

`packages/runtime-tools/src/coding/coding-tools-feature.ts` 在每个 Model Call 前 refresh catalog；`packages/coding-agent/src/composition/tool-surface/runtime-tool-surface.ts` 又从当前配置计算 activation。普通 unregister/deactivate 后，availability guard 会拒绝旧 Turn 已经看到的 Tool，实际上把普通更新当成撤权。

### 目标改造

将 Tool 生命周期拆成三个对象：

1. `ToolCatalogRevision`：不可变的 schema、metadata 和 activation 候选；
2. `ToolImplementationLease`：把 tool id 绑定到具体 implementation generation；
3. `HardRevocationRegistry`：独立、可即时查询的拒绝/取消通道。

admission 物化时获取 catalog 与 implementation leases。Model Call 仍可基于上下文、预算或 deferred activation 从该固定 catalog 选择工具，但不能 refresh 外部 registry。

执行规则：

| 情况 | 已绑定 Turn | 新 Turn |
| --- | --- | --- |
| 普通 disable/unregister/update | 继续使用旧 implementation | 不再获取旧 implementation |
| implementation reload | 继续使用旧 generation | 使用新 generation |
| hard revoke | 在下一安全检查点拒绝或取消 | 不可获取 |
| 进程/连接物理失败 | 返回真实执行错误 | 按该 generation 的恢复策略处理 |

`ToolAvailabilityGuard` 只检查 Turn-bound binding 的结构有效性和 hard revoke，不再用 live catalog 判断普通可用性。

### 主要文件

- `packages/runtime-tools/src/coding/coding-tools-feature.ts`
- `packages/runtime-tools/src/coding/coding-tool-catalog.ts`
- `packages/runtime-tools/src/coding/coding-tool-availability.ts`
- `packages/coding-agent/src/composition/tool-surface/runtime-tool-surface.ts`
- `packages/coding-agent/src/host/session-execution/execution-runtime.ts`

## 6. MCP

### 当前问题

`packages/coding-agent/src/composition/tool-surface/mcp-session-coordinator.ts` 在 Model Call 边界刷新 MCP catalog。配置变更、server reload 或工具清单变化可能在同一 Turn 内改变可见 Tool 和执行目标。

### 目标改造

- MCP 配置 watcher 发布 `McpConfigurationRevision`；
- 每个 revision 对应 immutable `McpToolCatalog` 与 generation-aware supervisor binding；
- admission 获取 `McpGenerationLease`；
- 同一 Turn 的 schema 与 execution 使用同一个 binding；
- 更新后的 server/config 只提供给新 lease；
- 旧 supervisor 在引用归零后关闭；
- 未变化的 server 可按配置 fingerprint 共享 ref-counted connection；
- 相同配置下的断线重连属于物理恢复，可以替换 transport，但不得借机切换配置 revision 或 Tool schema；
- 凭证按 [一致性合同](./02-consistency-contract.md) 绑定为不透明 Turn credential lease；普通更新只影响后续 Turn。

MCP refresh API 应从 Model Call 路径移到控制面 publisher。若 server 主动发出 tools-changed 通知，则该通知生成新 revision，而不是直接改写活动 catalog。

### 主要文件

- `packages/coding-agent/src/composition/tool-surface/mcp-session-coordinator.ts`
- `packages/runtime-mcp/src/**`
- MCP 配置来源与 Desktop/CLI 适配器

## 7. Plugin、Plugin Tool 与 Hook

### 当前问题

Plugin tool composition 读取当前 Plugin 配置，execute 又重复检查当前配置。Desktop hook adapter 每次 dispatch 获取全局 registry snapshot。Plugin reload 如果直接卸载旧 activation，活动 Turn 持有的 handler id 也无法继续执行。

### 目标改造

#### Plugin generation

Plugin reload 采用 activate-new / retire-old：

1. 校验并激活新 generation；
2. 原子发布新 Plugin revision；
3. 老 generation 从新 Turn 不可见；
4. 老 generation 的 Tool、Hook、MCP 和 handler 保留到 lease 归零；
5. 最后执行 deactivate/dispose。

#### Handler routing

handler 调用标识必须包含 generation，不再只有逻辑 `handlerId`：

```ts
interface PluginHandlerBinding {
  readonly pluginId: string;
  readonly generationId: string;
  readonly handlerId: string;
}
```

Desktop 主进程维护 generation router。Renderer/UI 卸载不等于立即删除执行端旧 handler；旧 handler 可处于 hidden-retired 状态，仅服务已有 lease。

#### Hooks and interceptors

Turn-affecting Hook/Interceptor 的注册集合在 admission 捕获，dispatch 使用 `TurnHookBinding`，不得每次查全局 registry。事件中已有 `turnId` 时直接路由到该 Turn binding。

SessionStart/SessionEnd 等非 Turn 事件可以在事件发生时使用当时 published generation；UserPromptSubmit、PreToolUse、PostToolUse、Stop 等属于某一 Turn 的事件，必须使用该 Turn generation。

#### Ordinary retirement vs hard revoke

普通 Plugin disable/reload 不再返回 `plugin_tool_revoked` 给旧 Turn。只有管理员撤权、安全响应、签名失效等显式 hard revoke 才使用该错误，并携带 reason/audit id。

### 主要文件

- `packages/coding-agent/src/plugins/runtime/tool-runtime.ts`
- `packages/coding-agent/src/plugins/runtime/run-orchestrator.ts`
- `packages/coding-agent/src/interception/tool/pipeline.ts`
- `packages/desktop-app/src/main/plugins/coding-agent-hook-adapter.ts`
- `packages/desktop-app/src/main/plugins/**`
- `packages/plugins/plugin-sdk/src/**`

Plugin SDK 如果新增 generation-aware binding，必须保留旧 Plugin 的兼容适配层，并明确旧 API 只能在宿主包装后进入 Turn-bound runtime。

## 8. Extension custom tools

### 当前问题

Extension tool 目录和 runner 可能按 Model Call 读取当前列表。更新或卸载后，活动 Turn 的 schema 与执行端可能不匹配。

### 目标改造

- Extension discovery 生成 immutable revision；
- runner/handler 以 generation lease 暴露；
- custom tool schema 与执行 binding 同代捕获；
- reload 普通 retirement，安全撤销走 hard revoke；
- Extension 进程意外退出作为物理故障返回，不切换到新 generation 重试旧调用。

### 主要文件

- `packages/coding-agent/src/extensions/**`
- Extension host/runner 所在 runtime 包
- `packages/coding-agent/src/composition/model-call/**`

## 9. Agent Mode、Execution Mode 与 Sandbox

### 当前问题

Agent Mode 和 Plugin 已有部分 pending 语义，但各自实现；Execution Mode 在 Session busy 时直接拒绝更新。这既不统一，也不满足“更新可以立即接受、下一 Turn 生效”。

### 目标改造

- Mode、Execution Mode、Sandbox policy 都写入 `SessionStateOverlayRevision`；
- 更新命令立即发布 desired/session revision，不修改 active snapshot；
- 下一 Turn 物化 mode-specific Prompt、Tool catalog、permission policy 和 sandbox binding；
- 旧 sandbox/tool host 保留到旧 lease 归零；
- 安全收紧同时写入 hard revocation/authorization epoch，使活动 Turn 在下一敏感操作检查点 fail-closed；
- 安全放宽永不回写活动 Turn，只在下一 Turn 生效；
- UI 同时展示 selected/desired 与 active Turn effective 值。

移除“只要任一 Session busy 就不能改全局 Execution Mode”的策略；替换为发布新 revision 与 per-session effective generation 追踪。

## 10. Model binding 与 Provider 凭证

模型绑定当前已有 Turn-scoped contract，应继续保留。需要补齐的是：

- binding 必须由 `SessionTurnSnapshotProvider` 基于已捕获 revision 产生，并随同一 lease 返回；
- `turn-pipeline.ts` 与 `runtime-session-context-controller.ts` 不得在 snapshot capture 之后再次独立 `bind()` 当前 model runtime；
- model selection policy、provider endpoint、组织/项目身份和允许的模型集随 generation 捕获；
- 一次 Turn 的 fallback/retry 只能在捕获策略允许的集合内进行；
- 普通设置更新不能改变当前 Turn 的 fallback 目标；
- secret value 不写入 revision、descriptor 或日志，执行只持有不透明 credential binding；
- 普通 rotation 由后续 Turn 获取；显式 credential revoke 递增撤销 epoch，使旧 binding fail-closed；
- Provider usage、stop、tool-call 与取消语义保持现有协议。

## 11. 文档与 ADR 同步

实施第一阶段必须先解决规范冲突：

- 更新 `packages/coding-agent/AGENTS.md` 中“Model Call 边界读取最新动态状态”的规则；
- 更新 `packages/coding-agent/README.md` 对 Prompt/Tool/Skill/Plugin 刷新时机的说明；
- 更新 `docs/agent/coding-agent/05-greenfield-rewrite/03-product-capability-modules.md` 中允许同 Turn 后续 Model Call 看到外部变更的描述；
- 统一 `docs/agent/coding-agent/05-greenfield-rewrite/02-runtime-core-contracts.md` 与本方案的 Turn snapshot 语义；
- 修订 ADR-0046，使 Agent Mode、Plugin 和 Execution Mode 进入统一 session overlay；
- 修订或以新 ADR supersede ADR-0064，把 Plugin Hook 从 next-dispatch 可见改为 next-Turn generation 可见；
- 新增一个跨模块 ADR，记录 Turn isolation、ordinary retirement、hard revoke 和失败回退决策。

ADR 被接受前可以实现无争议的测试基础和内部 lease 抽取，但不应先改变公共运行时行为。

## 12. 迁移后的删除项

最终必须删除被替代的旧路径，避免双重语义长期共存：

- Model Call 中的外部 catalog/resource `refresh*()`；
- Hook dispatch 的 global current registry lookup；
- Tool/Plugin execute 对普通 current availability 的二次检查；
- `pendingAgentMode`、`pendingAgentPlugins` 等领域私有 pending 字段；
- busy 时拒绝 Execution Mode 更新的旧策略；
- snapshot provider 闭包内的 mutable configuration getter；
- 仅为新旧刷新模型共存而设置的临时 feature flag。

兼容适配器只能存在于明确的迁移阶段，并应在路线图对应阶段结束时删除。
