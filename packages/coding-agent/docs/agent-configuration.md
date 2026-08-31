# 会话 Agent 配置

每个会话拥有独立 Agent Instance，配置在该会话中保存和生效。模板只复用配置，不共享执行状态。架构合同见 [ADR-0096](../../../docs/adr/0096-agent-configuration-templates-and-session-overrides.md)。

## 配置字段

| 字段 | 含义 |
| --- | --- |
| `appendSystemPrompt` | 追加系统提示词，不移除宿主原有规则 |
| `skills` | 允许的 Skill 名称 |
| `tools` | 允许的工具名称，与宿主可用工具取交集 |
| `mcpServers` | 允许的 MCP Server 名称，不包含连接配置或凭证 |
| `plugins` | 允许的已启用插件 ID，覆盖贡献与 Hook |
| `modelKey` | `provider/model`，`null` 沿用原有模型状态 |
| `thinkingLevel` | 推理等级，`null` 沿用原有选择 |

资源列表为 `null` 时继承宿主，`[]` 时全部禁用。显式指定但缺失的资源会阻止配置生效，不会静默回退到全量资源。宿主权限和工具 scope 始终是上限。

## 创建、更新与恢复

Composition 的 Session Options 接受 `agentConfiguration: { template, overrides }`。模板是含 `id/revision/name/configuration` 的完整快照，覆盖字段可省略。类型、严格解析器及默认值由 `@vetta/coding-agent/profile` 导出。

`@vetta/coding-agent/session-extensions` 导出 `AGENT_CONFIGURATION_READ`、`AGENT_CONFIGURATION_UPDATE`、`AGENT_CONFIGURATION_CATALOG`。更新携带 `expectedRevision` 和完整 selection，持久化成功后递增 desired revision。资源完成准备且整份 Turn snapshot 捕获成功后才更新 effective revision；状态包含 pending 和安全失败码。保存失败不发布新配置，应用失败拒绝本次执行，修复后可重试。

正在执行的 Turn 保留原版本。模型优先级是本次请求显式选择、会话配置、原有模型状态。模板不能强制覆盖用户本次选择的模型。

配置存入 canonical ConversationDocument 的版本化 custom entry，恢复和文档分支遵循同一事实源。模板后续修改、删除不影响已有会话；旧会话无配置记录时继续使用默认值，未知配置版本明确报错。

配置仅向 Runtime/SDK 与宿主代码开放。Desktop 不提供新会话或会话内的 Agent 配置编辑器，也不暴露专用 preload/IPC；原有模型选择与工作模式控件保持不变。模板由调用方提供完整快照，Desktop 不再读写编辑器使用的 `agent-templates.json`，已有会话的内嵌快照不受影响。配置不是凭证容器，也不安装资源；MCP、插件和模型仍需先在宿主中配置。

宿主已发布 Coding Agent Definition 并创建 `runtime` 后，可通过公开入口为每个会话分别配置：

```ts
import { createCodingAgentRuntimeSessionSelection } from "@vetta/coding-agent/composition";
import { AGENT_CONFIGURATION_READ, AGENT_CONFIGURATION_UPDATE } from "@vetta/coding-agent/session-extensions";

const session = await runtime.createSession({
  cwd,
  agent: createCodingAgentRuntimeSessionSelection({
    agentConfiguration: { template: null, overrides: { tools: ["read"] } },
  }),
});
const status = await runtime.invokeSessionExtension(session.sessionId, AGENT_CONFIGURATION_READ, undefined);
await runtime.invokeSessionExtension(session.sessionId, AGENT_CONFIGURATION_UPDATE, {
  expectedRevision: status.desired.revision,
  selection: { template: null, overrides: { tools: [] } },
});
```

这两个 selection 都受同一套 Schema、资源交集和持久化规则约束。需要复用模板时，将 `template: null` 替换为完整模板快照；不必通过 Desktop 创建模板。
