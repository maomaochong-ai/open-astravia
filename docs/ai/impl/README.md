# AI 与 Agent 重构实施记录

本目录记录 [`../refa`](../refa/README.md) 方案的实际实施过程。方案文档描述目标架构；本目录只记录已经发生的改动、验证证据、实际偏差和下一步约束，避免用计划冒充完成状态。

## 记录规则

每个阶段至少包含以下信息：

- 阶段目标、范围与明确不做的事项。
- 修改前可复现的失败，以及修改后的行为证据。
- 实现采用的模式、关键取舍和对公共契约的影响。
- 直接测试、包级测试和仓库质量门禁的结果。
- 预期结果与实际结果的差异。
- 已完成、未完成、阻塞项和后续迁移入口。
- 涉及文件，便于代码审查和后续追溯。

测试结果必须区分：

- `通过`：命令成功且结果与断言一致。
- `跳过`：测试由凭据或显式条件跳过，不计作通过。
- `既有失败`：当前改动未引入，但会阻止阶段或全量门禁完成。
- `未运行`：尚未执行，不能推断结果。

## 阶段状态

| 阶段 | 状态 | 实施记录 | 主要结论 |
| --- | --- | --- | --- |
| Phase 0A：流终止与 Loop 异常传播 | 已实现并通过全仓检查 | [00-phase-0a-stream-terminal.md](./00-phase-0a-stream-terminal.md) | 已消除本阶段覆盖的永久悬挂路径；AI 旧测试基础设施仍有模型目录依赖问题 |
| Phase 0B：测试模型基线与有限执行预算 | 已完成 | [01-phase-0b-fixtures-and-limits.md](./01-phase-0b-fixtures-and-limits.md) | AI/Agent deterministic 基线全绿；loop、tool 与 checkpoint 均有有限预算 |
| Phase 0C：测试分类与 canonical characterization | 已完成 | [02-phase-0c-test-suites-and-canonical.md](./02-phase-0c-test-suites-and-canonical.md) | 默认套件 0 skip；live 物理隔离；迁移等价表示已建立 |
| Phase 1：AI 稳定协议 | 已完成 | [03-phase-1-stable-protocol.md](./03-phase-1-stable-protocol.md) | 协议类型已有单一所有权、稳定子路径、结构化错误与穷尽契约测试 |
| Phase 2：Provider Runtime 与测试基础设施 | 已实现，live canary 待凭据 | [04-phase-2-provider-runtime-testing.md](./04-phase-2-provider-runtime-testing.md) | 新旧注册表与失败语义已分离；两个试点 deterministic conformance 全绿 |
| Phase 3：逐 Provider 迁移 | 代码迁移完成，live canary 与兼容退出待完成 | [05-phase-3-provider-migration-status.md](./05-phase-3-provider-migration-status.md)、[10-phase-3a-openai-compatible-native-adapters.md](./10-phase-3a-openai-compatible-native-adapters.md)、[14-phase-3b-responses-native-adapters.md](./14-phase-3b-responses-native-adapters.md)、[15-phase-3c-anthropic-bedrock-native-adapters.md](./15-phase-3c-anthropic-bedrock-native-adapters.md)、[16-phase-3d-google-native-adapters.md](./16-phase-3d-google-native-adapters.md) | 14 个内置 API 已全部使用原生 Adapter；legacy facade/registry 按发布周期保留 |
| Phase 4：无状态 Agent Engine | Engine 核心完成，Runtime 生产已采用 | [06-phase-4-agent-engine.md](./06-phase-4-agent-engine.md)、[11-phase-5a-engine-runtime-parity.md](./11-phase-5a-engine-runtime-parity.md) | steering、continuation、tool progress、checkpoint 双视图已有功能与差分测试；`AgentCoreTurnEngine` 已使用新 Engine，兼容 Agent facade 仍保留 legacy loop |
| Phase 5：Runtime 原生接入与类型归位 | 生产 Engine 切换完成，类型清理继续 | [07-phase-5-runtime-integration.md](./07-phase-5-runtime-integration.md)、[11-phase-5a-engine-runtime-parity.md](./11-phase-5a-engine-runtime-parity.md)、[12-phase-5b-stateless-runtime-adapter.md](./12-phase-5b-stateless-runtime-adapter.md)、[13-phase-5c-production-switch.md](./13-phase-5c-production-switch.md) | Frame/checkpoint/queue/tool/observation/tracer 已接入新 Engine；生产 facade、失败/取消语义和上游测试已切换，Provider bridge 与跨包类型归位仍待后续阶段 |
| Phase 6：上下文组成报告 | 代码已实现，UI 操作验证按用户要求未运行 | [08-phase-6-context-composition.md](./08-phase-6-context-composition.md) | 最终 Provider Context、Host、IPC 状态与 Context Ring 明细已贯通 |
| Phase 7：兼容清理 | 未开始 | 待创建 | - |

## 当前基线

- 实施起点提交：`db38dafd8a2682c12d0ff4a155313a06e52753ed`
- 方案路线：[`../refa/08-delivery-roadmap.md`](../refa/08-delivery-roadmap.md)
- Phase 0 已完成：阻断性终止缺陷、有限执行预算、确定性测试基线、测试物理分层和 canonical characterization 均已有实现与验证证据。
- Phase 1 已完成：旧根类型保持 exact alias，Agent/Runtime 关键差分为零；旧 error event 和数值 Usage 的兼容语义明确留给 Adapter 迁移。
- Phase 2 代码目标已完成：Provider Runtime、受控 transport、测试模型、试点 schema 和 conformance 已建立；live canary 因凭据缺失待验。
- 三轮方案复盘与调整见 [09-iteration-review.md](./09-iteration-review.md)。
- Phase 3A 已完成 OpenAI-compatible 家族的原生 request/parser 所有权、错误归一化、abort 传播和离线家族契约测试；Anthropic 仍只完成 wire pilot，不能计作原生迁移。
- Phase 3B 已完成 OpenAI/Azure/Codex Responses 的原生 Adapter、共享 `output_index` reducer、TypeBox wire 校验、SSE/WebSocket 终止律和单向 legacy 投影；剩余 legacy API 收敛为 Anthropic、Google 三种入口与 Bedrock。
- Phase 3C 已完成 Anthropic/Bedrock 原生 Adapter、独立 wire 状态机、TypeBox 校验、AWS sender 测试注入和严格终止律；只共享 Claude thinking 规则与通用 legacy projector，剩余 legacy API 仅为 Google 三种入口。
- Phase 3D 已完成 Google Generative AI、Vertex 与 Gemini CLI 原生 Adapter；三种 transport 共用 Gemini schema/reducer/usage/终止律，内置 Registry 已不再使用 `adaptApiProvider()` fallback。
- Phase 5A 已补齐新 Engine 的流式输入、工具进度与 checkpoint 双视图，并用 canonical differential 固定新旧结果；这缩小了生产切换差距，但不等于 Runtime 已切换。
- Phase 5B 曾以独立 `StatelessAgentCoreTurnEngine` 并行验证 Runtime 适配；Phase 5C 已完成 telemetry 对齐并把公共生产 facade 切到该实现。
- Phase 5C 已将公开 `AgentCoreTurnEngine` 切换为 stateless 实现 facade；agent/generation/tool telemetry、checkpoint 事件交付屏障、失败/取消契约和 Coding Agent 上游回归均已完成。
- 当前继续推进 Phase 3/5；Phase 7 受两个发布周期和 canary 退出条件约束，不能在单次工作区改动中提前宣称完成。
