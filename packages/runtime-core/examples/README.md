# Runtime Core Examples

这里的示例只使用 `@vetta/runtime-core` 的公开入口，演示产品无关的多主 Agent 基座。示例中的 Agent
彼此平级；应用负责选择 `agentId` 或显式编排协作关系，Registry 不隐式建立主从关系。

## Multi-Agent

[`multi-agent/`](multi-agent/) 包含两个不访问网络、无需真实模型凭证的可运行示例：

| 文件 | 行为 |
| --- | --- |
| [`01-peer-agents.ts`](multi-agent/01-peer-agents.ts) | 在同一个 `RuntimeHost` 注册 Writer 与 Reviewer，验证各自的 Definition、Instance、Session 和 Prompt 隔离 |
| [`02-revision-rollout.ts`](multi-agent/02-revision-rollout.ts) | 发布同一 Agent 的新 revision，展示旧 Instance 固定旧代、新 Instance 使用新代，以及显式 rollout 只从下一 Turn 生效 |

从仓库根目录运行全部示例：

```bash
bun packages/runtime-core/examples/multi-agent/run.ts
```

示例使用低层 Agent Session 的 preview snapshot，因此不会调用 Provider。需要 Conversation 持久化、真实模型调用和
完整 `host.createSession()` 时，请继续阅读[《自定义 Agent 指南》](../docs/custom-agents.md#接入完整-runtimehost-会话)，
并由平台组合根提供 `RuntimeAgentSessionAssemblyBackend` 所需资源。
