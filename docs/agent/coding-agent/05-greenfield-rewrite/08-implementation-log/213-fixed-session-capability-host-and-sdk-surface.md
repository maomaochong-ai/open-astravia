# 第 213 阶段：固定 Session 能力宿主与 SDK 操作面

## 阶段目标

本阶段继续闭合公开 SDK 切换前的能力缺口，但只处理不会改变 Session 身份的操作：

1. 为旧 `AgentSession` 的全部公开成员增加独立、穷尽式接线清单；
2. 建立 SDK 与 CLI RPC 共用的 `CodingAgentGreenfieldSessionCapabilityHost`；
3. 接入模型与 Thinking 循环、`scopedModels`、工具激活、队列、压缩、Retry、Agent Mode、元数据和统计；
4. 保留 Session 新建、切换、Fork、历史导航等身份变更能力在产品宿主中；
5. 不切换公开 `createAgentSession`，不回接 Legacy `AgentSession` 具体实现。

## 实施前问题

第 212 阶段的 Greenfield SDK 门面只包含 Prompt、Abort、基础状态、模型直设和事件订阅。与此同时，CLI RPC
已经自行实现了一组模型、Thinking、压缩、元数据和统计逻辑。继续分别扩展会造成两套语义：

- SDK 固定绑定一个 Runtime Session，RPC 会随活动会话切换；
- 模型循环、Thinking 等级和统计计算在不同宿主重复；
- Runtime 只暴露队列数量，无法无损实现旧 `clearQueue` 与队列内容读取；
- `SDK_SESSION_MEMBER_COMPATIBILITY` 只说明架构归属，不能证明成员已经实际接线；
- `scopedModels` 已经有明确旧行为，但 SDK Host 仍把它作为不兼容 option 拒绝。

## 架构决策

### 1. Capability Host 读取 Session，而不拥有 Session

新增 `CodingAgentGreenfieldSessionCapabilityHost`，其核心依赖是 `readSession()`：

- SDK 传入固定闭包，因此能力始终作用于创建时的同一个 Session；
- CLI RPC 传入活动会话读取函数，因此会话切换后自动作用于新 Session；
- Capability Host 不创建、不关闭、不切换 Session，也不保存 Legacy Session 句柄；
- Factory 仍拥有 Runtime Session、Composition 与产品资源的释放顺序。

这使“固定 Session 操作能力”与“活动 Session 身份编排”保持为两个边界，而不是把 RPC 或 SDK
适配器变成新的总控对象。

### 2. Runtime 队列端口表达真实旧语义

`RuntimeSessionQueueView` 原先只有待处理数量。本阶段新增 `RuntimeSessionQueueController`，提供：

- Steering 与 Follow-up 模式读取；
- Steering 与 Follow-up 文本队列读取；
- 原子清空并返回两个队列；
- 待处理数量读取。

Greenfield Backend 直接委托 Kernel `AgentSession` 的真实队列，没有缓存副本，也没有由 SDK 猜测队列状态。
带图片的 UserMessage 仍按旧公开合同只投影文本部分；队列内部消息本身不被改写。

### 3. 模型范围属于 Session 操作策略

`scopedModels` 现在参与初始模型选择，并保存在 Capability Host 的固定 Session 策略中：

- 有范围时只在具有凭证的 scoped model 间循环，并应用各自 Thinking Level；
- 无范围时读取产品宿主提供的可用模型目录；
- 正向和反向循环保持旧 `ModelController` 的索引规则；
- 候选不足两个时返回 `undefined`；
- 模型与 Thinking 变更继续由 Runtime Controller 执行，默认设置由 Settings 端口持久化。

因此 `scopedModels` 的 SDK create option 从 `not-wired` 改为 `wired`。动态 `tools/customTools` 没有顺带
放开，它们仍需要单独的动态注册适配器。

### 4. Retry 保持 Turn 级编排

Capability Host 使用既有 `CodingAgentGreenfieldTurnRetryController` 包装 SDK Prompt 与 Runtime Retry：

- 重试策略仍来自 `SettingsManager`；
- 只对既有可重试错误分类执行指数退避；
- `retryAttempt`、`isRetrying`、启用开关和取消入口由同一控制器提供；
- Retry start/end 事件进入 SDK 原有 `subscribe` 事件流；
- Session 关闭前先取消正在等待的 Retry。

CLI RPC 继续拥有自己的 Retry Controller 和事件桥，但模型、Thinking、队列、压缩、名称、统计与最后回复
读取均委托同一个 Capability Host；没有把 RPC transport 合同下沉到 Coding Agent 内核。

### 5. 兼容归属与接线状态继续分离

新增 `SDK_SESSION_MEMBER_WIRING`，使用 `satisfies Record<keyof AgentSession, ...>` 穷尽旧公开成员。

- `SDK_SESSION_MEMBER_COMPATIBILITY`：回答能力属于 Core、Runtime、产品适配还是 Legacy 泄漏；
- `SDK_SESSION_MEMBER_WIRING`：回答 Greenfield 固定 Session 门面是否已经实际实现；
- 新增或删除旧成员时，类型检查要求两个清单同时更新；
- `switchSession`、`newSession`、Fork/Branch、Bash、动态工具、Reload、具体 Store/Manager 等继续为
  `not-wired`。

该清单是公开工厂最终切换前的差额门禁，不等同于立即宣布完整兼容。

## 本阶段实施

### runtime-core

- 新增中立 `RuntimeSessionQueueController`；
- Greenfield Core Assembly 同时提供只读 `queueView` 和完整 `queueController`；
- 队列读取和清空直接映射 Kernel 队列及 UserMessage 文本。

### coding-agent

- 新增固定 Session Capability Host，并从 `runtime-host/greenfield` 导出；
- SDK Factory 增加 Capability Host 创建端口，并为无产品配置的内部测试提供默认宿主；
- SDK Host 接入 Settings、可用模型、scoped models 和初始 Agent Mode；
- 保持 `GreenfieldSdkSessionCore` 的最小合同不变，新增独立 `GreenfieldSdkSessionCapabilities`，最终门面只在
  SDK Adapter 中组合两者；
- 固定 Session 能力面增加工具、队列、模型循环、Thinking、压缩、Retry、名称、统计、上下文占用和最后回复；
- Retry 控制器增加只读 attempt/running 状态；
- CLI RPC 的重复能力实现改为委托共享 Capability Host；
- 新增完整 Session 成员接线清单，`scopedModels` create option 改为已接线。

### 明确保留的边界

- 公开 `createAgentSession` 仍未切换；
- 动态 `tools/customTools`、Tracing 与自定义 Subagent Factory 仍 fail closed；
- Session 身份变更、Branch/Fork、Bash、Reload 和 Legacy 具体句柄没有进入固定 Session 门面；
- 本阶段没有新增来自 JSON、网络或用户输入的结构化解析边界，因此不引入 TypeBox/Zod 校验；Tool Schema
  只作为既有 Runtime 定义的只读数据透传。等动态 Tool Registration Adapter 接收外部定义时，再在该入口
  使用 TypeBox 做运行时校验。

## 测试与验证

本阶段新增或更新的测试覆盖：

- SDK 成员接线清单与架构归属清单保持等长、穷尽；
- `scopedModels` 不再被兼容门禁拒绝；
- scoped model 参与初始选择，并按 Thinking Level 循环；
- 活动 Turn 中 Steering/Follow-up 进入真实 Runtime 队列，可读取、计数并原子清空；
- Retry 观察事件进入 SDK `subscribe`；
- 既有 SDK 内存、文件 create/resume、Legacy 迁移、资源回滚和关闭语义不回归；
- CLI RPC 通过类型检查证明共享宿主的返回合同与现有 RPC capability 一致。

验证结果：

- `bunx vitest --run test/sdk/greenfield-sdk-session-adapter.test.ts test/sdk/greenfield-sdk-session-integration.test.ts test/sdk/coding-agent-sdk-host-adapter.test.ts test/sdk/sdk-compatibility-inventory.test.ts`：4 个文件、21 项测试通过；
- `bunx vitest --run test/runtime-host/greenfield-session-capabilities.test.ts`：1 项测试通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查与全部架构门禁。

## 阶段结论与后续边界

第 213 阶段把 SDK/RPC 重复的固定 Session 操作收敛成了一个产品能力宿主，同时没有把身份切换或具体
存储实现塞回 Session Core。下一阶段应处理动态 Tool Registration Adapter：先定义 `tools/customTools`
的注册、替换、移除、每 Turn 可见性和释放合同，再用 TypeBox 校验外部 Tool Schema。Tracing 和自定义
Subagent Factory 应继续独立推进，不能借动态工具阶段一起放开。
