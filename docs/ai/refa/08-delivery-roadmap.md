# 分阶段交付路线

## 原则

- 每阶段都可独立合并、回滚和验证。
- 先建立行为基线，再移动所有权。
- 一次只迁移一个边界或一个 Provider 批次。
- 新旧双轨只用于有限迁移窗口，所有 compat 都有删除条件。
- 不以“文件已移动”作为完成标准，以契约和上游调用收敛作为完成标准。

## Phase 0：基线与阻断性缺陷

工作：

- 为 AI EventStream 的失败、无 finish EOF、abort 和 result settlement 写回归测试。
- 为 Agent loop 的同步/异步异常、checkpoint 未完成和无限 tool loop 写回归测试。
- 建立 canonical message/event/result normalizer，供差分测试使用。
- 分类现有测试：deterministic、credential-gated、live canary。

退出条件：

- 已知悬挂路径都有短超时回归测试。
- 默认测试不因缺少凭据误报成功。
- 当前 legacy 行为形成可读的 characterization report。

## Phase 1：AI 稳定协议

工作：

- 建立 `protocol/`、结构化 error code 和 stream terminal law。
- 合并重复 reasoning/usage/finish 类型。
- 旧类型先用 alias 指向新协议。
- 增加 type tests 和 protocol contract tests。

退出条件：

- 所有事件 switch 可穷尽检查。
- iterator/result 在全部终态有限结束。
- runtime-core 与 agent 使用新协议，行为差分为零或有批准的差异说明。

## Phase 2：Provider Runtime 与测试基础设施

工作：

- 建立 Adapter Registry、provider-kit、ScriptedLanguageModel 和 test transport。
- 迁移一个简单 HTTP/SSE Provider 和一个复杂 Provider。
- 建立 Provider Conformance Suite。
- Provider 入站 payload 用 TypeBox 校验。

退出条件：

- 试点 Provider 通过 fixture + conformance + canary。
- 新增 Provider 无需修改中心 switch。
- 无真实网络也能覆盖 text/tool/usage/error/abort/overflow。

## Phase 3：逐 Provider 迁移

按协议族批次迁移，而不是按文件大小：

1. OpenAI-compatible/completions。
2. OpenAI Responses/Azure/Codex。
3. Anthropic/Bedrock。
4. Google/Vertex/Gemini CLI。
5. OAuth/代理和特殊 transport。

每批退出条件：

- 该批全部 conformance 通过。
- 脱敏 wire fixtures 覆盖 Provider 特有语义。
- live test 已拆为 deterministic 主测试 + 最小 canary。
- 旧 Provider 分发入口对该批不再被生产代码调用。

## Phase 4：无状态 Agent Engine

工作：

- 实现 `runAgentTurn()`、AgentRun events/result、明确状态机和 budgets。
- 用 callback checkpoint 替换双向 event RPC。
- Tool schema 泛型贯通 input validation 和 execute。
- 建立 Agent Functional Suite。
- standalone Agent 改为新 engine wrapper。

退出条件：

- 全部 Agent 场景测试通过。
- success/fail/abort/limit/checkpoint 均有限结束。
- 新旧 engine 在 canonical outcome 上差分通过。
- 仓库生产代码不直接使用 standalone Agent。

## Phase 5：Runtime 原生接入与类型归位

工作：

- Runtime 直接组装 ModelCallFrame 并调用新 engine。
- 迁移 ThinkingLevel、AgentMessage、ToolPhase、AgentEvent、AgentTool 等类型。
- Coding Agent 对 agent-core 的 import 收敛到指定 adapter。
- 删除 `AgentCoreTurnEngineOptions` 向产品组合层的泄漏。

退出条件：

- TurnPipeline integration/differential tests 全绿。
- coding-agent 的 memory/compaction/session/RPC/public SDK 不再导入 agent-core。
- legacy engine 生产调用为零。
- 依赖 guard 启用。

## Phase 6：上下文组成报告

工作：

- Prompt diagnostics 升级为 Frame provenance。
- 补齐 skill、tool schema、history、runtime context 和 user input sections。
- 引入 model-aware TokenEstimator 接口与 heuristic fallback。
- Runtime Host Port/observation 暴露 prepared/completed report。
- Desktop Context Ring 增加明细交互和 i18n。

退出条件：

- 最终 Frame 与 report 可对账。
- Provider actual total 与 estimate 同时保留。
- 报告无 prompt 正文和敏感数据。
- Host contract、IPC、状态逻辑和 UI 决策测试全绿。
- 使用 root `verify:ui:*` 完成 Desktop 实机验证。

## Phase 7：兼容清理

工作：

- 收窄根 exports，启用 deprecated/forbidden import guard。
- 删除无调用的 old stream map、legacy engine 和错误所有权 re-export。
- 评估 standalone 子路径的真实消费者。
- 更新 README、CHANGELOG 和迁移指南。

退出条件：

- 每个删除项满足 compat 清单中的退出条件。
- 至少两个锁步发布周期没有新增 legacy 调用。
- canary 未发现新实现特有回归。
- 完整 `bun run check` 与相关 package tests 通过。

## 每个 PR 的最小验证

代码重构 PR：

```bash
bunx vitest --run <直接相关测试>
bun run check:quick
bun run check
```

并按改动边界运行对应 package 的 `bun run test`。`bun run check` 不包含测试，不能替代测试执行。

文档 PR：检查 Markdown 链接、路径和术语一致性；不因文档改动运行无关的全仓测试。

## 不建议的实施方式

- 一个 PR 同时移动全部 AI/Agent 文件并修改所有上游。
- 先拆 workspace 包，再寻找消费者。
- 用大量 `as unknown as` 暂时打通迁移。
- 为保持旧 snapshot 而保留错误事件语义。
- 没有差分测试就替换 Turn Engine。
- 在 Context UI 中先做本地估算，未来再“接后端”。

