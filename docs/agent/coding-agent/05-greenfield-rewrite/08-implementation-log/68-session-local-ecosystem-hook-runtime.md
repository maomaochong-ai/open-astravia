# 第 68 轮：Session-local Ecosystem Hook Runtime 纵向切片

## 目标

第 66 轮的 Stop Hook 仍通过局部 invoker 接入，第 67 轮也明确留下了真实 Hook Runtime 未组合的问题。
如果 Prompt、Tool、Stop 和 Session 生命周期分别创建 bridge 或 Runtime，同一 Session 会出现配置、
continuation 计数和待触发 SessionStart 状态不一致。本轮把它们收敛到一个 Session-local
`EcosystemHookRuntime`：

```text
Hook discovery / config
  -> one Session Hook Runtime
  -> Prompt lifecycle
  -> final Tool surface
  -> Stop continuation
  -> SessionEnd / dispose
```

目标仍是架构迁移，不修改旧 Hook 的业务规则、协议映射或用户可观察文案。

## 既有行为基线

本轮保留以下旧行为：

- SessionStart 在首次 Prompt 前执行，create/resume 分别使用 `startup`/`resume` source。
- UserPromptSubmit 在资源展开后接收实际用户文本；阻断和停止原因继续按旧优先级抛出。
- Prompt Hook 的 additional context 作为隐藏、模型可见上下文注入；排队输入仍按
  Hook、附件、Skill、Scene 的既有顺序拼接。
- PreToolUse 可以阻断或改写输入；PostToolUse 可以追加反馈、替换结果或阻断。
- 真实工具抛错后触发 PostToolUseFailure；Pre/Post Hook 自身阻断不伪装成工具执行失败。
- function tool、命令工具和 MCP 工具继续使用旧 `EcosystemToolDescriptor` 映射。
- Stop Hook 继续通过既有 Runtime 的 continuation 上限和去重规则决定是否续跑。
- Session dispose best-effort 触发一次 SessionEnd；Hook 失败不阻止其他会话资源释放。

## 架构

### 1. 每个 Session 只有一个 Hook Runtime

CLI Composition Root 在 `createResources()` 内创建唯一 `EcosystemHookRuntime`。同一实例同时交给：

- `CodingAgentGreenfieldPromptAdapter`；
- `CodingAgentModelCallFrameComposer`；
- `CodingAgentStopHookContinuationSource`；
- Session disposer。

原 `createStopHookInvoker` 局部桥已移除。可变扩展只暴露
`additionalHookAdapterFactories`、`hookConfigLayers` 和 `maxStopHookContinuations`，不再允许调用点分别
提供不同 Hook 实例。

### 2. Hook 包装发生在最终 Tool Surface

Tool Hook 不在静态 Coding Tool Catalog 注册时包装，而是在 Model Call Composer 完成动态插件、MCP、
Todo 和其他调用级贡献后，对最终 `ReadonlyMap<string, RuntimeToolDefinition>` 统一包装。因此运行时新增
或撤销的工具在下一次 Model Call 自然获得或失去 Hook，不需要重建 Capability Snapshot。

Greenfield wrapper 只做 Runtime Tool 与旧 Agent Tool 合同的结构适配，实际 Pre/Post/Failure 语义继续
复用既有 `wrapToolsWithEcosystemHooks()`。这避免新链路复制一套近似但不同的 Hook 业务实现。

Runtime Tool Adapter 继续透传 `ecosystemHook` 元数据，尤其保留 MCP server name 和 original tool name，
防止 MCP 工具在协议映射时退化成普通 function tool。

### 3. Runtime Core 只提供窄化 Context 追加边界

Hook Runtime 需要记录 Tool Hook 的 additional context，但不能直接持有 Conversation Repository 或自行
推进 revision。Runtime Core 因此新增两个通用合同：

```text
RuntimeSessionContextAppender
  append(records)

RuntimeSessionContextBuffer
  append(records)
  flush(consumer)
  clear()
```

`GreenfieldRuntimeResourceContext` 只向产品组合层暴露 append-only 端口。真正的 Buffer 由
`ComposedGreenfieldRuntimeFactory` 为每个 Session 创建，并交给 `TurnPipeline` 消费。

Pipeline 在以下稳定点串行持久化 `context.appended`：

- 每条持久化 message 之后；
- Turn finalization 之前；
- cancelled/failed 终态之前。

flush 失败时记录不会提前移除；Turn 结束后清空未消费记录，防止失败 Turn 的上下文泄漏到下一 Turn。
这一机制不认识 Hook、Skill 或 Todo，只负责把运行期追加内容纳入 Pipeline 已有的 Repository 版本序列。

Tool Hook additional context 与旧运行语义一致：它不会倒灌进已经执行中的 Agent Core Tool Loop，而是在
持久化后对后续外部 Turn 可见。

### 4. 取消与生命周期仍由 Session 所有

`GreenfieldRuntimeResourceContext.abortCurrentRun()` 通过 Factory 延迟绑定到真实 `AgentSession.cancel()`。
Hook Runtime 不持有 Session 实现，也不直接操作 Turn Pipeline。

Factory 组装完成前调用 abort 是安全 no-op；组装后委托当前 Session。释放路径使用幂等
`endHookSession()`，无论 Session assembly 先释放还是 Composition Root 统一释放，SessionEnd 都只执行一次。

当前只接入 create/resume 的 SessionStart 与 dispose 的 SessionEnd。`new_session`、`switch_session`、
`fork_session` 必须等对应宿主操作真正切换到 Greenfield 后再接入，不能在 create/dispose 上伪造原因。

### 5. 校验边界

本轮没有新增 TypeBox/Zod。Hook 配置和外部协议 payload 已由 `ecosystem-adapter` 的现有边界解析；新增的
Resource Context、Context Buffer 和 Runtime Tool wrapper 都是进程内已类型化合同。重复运行时校验不会增加
安全性，反而会形成第二份 Schema 事实来源。

## 实施内容

### Runtime Core

- 新增 Session-local `BufferedRuntimeSessionContext`。
- `TurnPipeline` 在消息和终态安全点串行持久化运行期 context。
- `GreenfieldRuntimeResourceContext` 同时提供 operation、append-only context 和取消桥。
- Factory 为每个 Session 创建独立 Buffer，并在组装失败或 Turn 结束时清理。

### Coding Agent

- Prompt Adapter 接入 SessionStart 与 UserPromptSubmit。
- Model Call Composer 在最终 Tool Map 上统一包装 Hook。
- Runtime Tool Adapter 保留 Ecosystem Tool descriptor。
- Stop Continuation Source 直接依赖同一 `EcosystemHookRuntime.runStop()`。
- 旧 Tool Hook wrapper 泛型化，避免用 `any` 或类型断言掩盖参数方差。

### CLI Composition Root

- 每个 Greenfield Session 创建唯一 Hook Runtime。
- Hook Host 从同一 Session 读取 cwd、sessionId、transcript 和当前模型。
- Tool Hook context 通过 Runtime Core append-only 端口进入 Repository。
- create/resume source、SessionEnd dispose 和组合层统一释放已接通。
- 默认内置 Codex/Claude Adapter 保持不变，并允许追加 Adapter 和显式配置层。

## 测试

### Runtime Core

```text
bunx vitest --run test/kernel/turn-pipeline.test.ts
```

结果：`1 file / 10 tests passed`。

新增合同验证持久化顺序为：

```text
turn.started
  -> user message
  -> toolResult message
  -> context.appended
  -> assistant message
  -> turn.completed
```

并验证 Hook context 不进入正在运行的同一 Tool Loop，但会出现在下一个外部 Turn 的上下文中。

### Coding Agent

```text
bunx vitest --run \
  test/runtime-core/greenfield-hook-prompt-adapter.test.ts \
  test/runtime-core/greenfield-hook-tool-wrapper.test.ts \
  test/runtime-core/greenfield-continuation-orchestrator.test.ts
```

结果：`3 files / 9 tests passed`。

覆盖 SessionStart/UserPrompt 顺序与阻断、空闲/排队 context 注入顺序，以及旧/新 Tool wrapper 的输入改写、
MCP descriptor、Post feedback、additional context、执行失败和 Pre 阻断差分。

### CLI Greenfield 集成

```text
bunx vitest --run \
  test/greenfield-ecosystem-hook-runtime.test.ts \
  test/greenfield-continuation-orchestrator.test.ts \
  test/greenfield-plugin-tool-runtime.test.ts \
  test/greenfield-runtime-composition.test.ts \
  test/greenfield-todo-runtime.test.ts
```

结果：`5 files / 15 tests passed`。

真实 Composition Root 验证：

- create/resume 分别触发 startup/resume；
- 静态 `current_time` 和动态插件工具都进入 Pre/PostToolUse；
- Stop Hook 使用同一 Runtime 续跑；
- Tool additional context 持久化，并在下一个外部 Prompt 可见；
- dispose 和组合层兜底释放不会重复 SessionEnd。

### 类型门禁

实施中已通过：

```text
bunx tsgo --noEmit
bunx tsc --noEmit -p packages/cli-app/tsconfig.json
```

`bun run check:quick` 与完整 `bun run check` 均通过。完整门禁覆盖 Biome、根 monorepo `tsgo`、CLI 独立
类型检查、Desktop `tsc`、Admin `tsc -b` 和质量 guards，均为 `exit 0`。

## 明确未实施

- 未修改旧 `AgentSession` 默认生产路径。
- 未重写 Ecosystem Adapter 的配置发现、协议映射或进程执行。
- 未迁移 PreCompact/PostCompact；Greenfield Context Strategy 仍是 passthrough。
- 未迁移 PermissionRequest；Greenfield 尚无等价权限交互能力。
- 未迁移 SubagentStart/SubagentStop；Greenfield 尚无等价 Subagent Runtime。
- 未伪造 `new_session`、`switch_session` 或 `fork_session` SessionEnd 原因。
- 未让 Hook Runtime 直接写 Repository 或绕过 Turn Pipeline。

## 下一步

下一阶段应迁移真实 Context Strategy/Compaction 纵向切片：

```text
Context usage
  -> compaction decision
  -> summary/model call
  -> persisted compaction result
  -> PreCompact/PostCompact on the same Session Hook Runtime
```

必须先提取旧 compaction、prefire、microcompact、摘要、失败与取消行为基线，再建立差分合同。不能为了接入
Pre/PostCompact 先伪造压缩事件，也不能把旧 AgentSession 的压缩器整体塞进 Runtime Core。
