# 上下文组成与 Token 可观测性

## 1. 可行性结论

可以实现系统提示词、skill、工具 schema、历史消息、运行时上下文和当前输入的 token 数量与占比。当前仓库已经具备部分基础：

- Coding Agent 的 `SystemPromptDraft` 保留 block type、id 和 source。
- `compileSystemPromptDraft()` 已生成逐 block 字符数与 estimated token。
- Runtime 的 `ModelCallFrame` 已统一收集 instructions 与 tools。
- RuntimeMessageEnvelope 已能表达部分消息来源。
- Runtime Host 已有 `RuntimeSessionContextUsageView`，只是当前仅返回总量。

缺失的是最终调用级 provenance、工具 schema/history 的统一估算、Provider usage 校准和正式 Host Port。

## 2. 数据模型

建议新增版本化报告：

```ts
interface ContextCompositionReport {
  readonly version: 1;
  readonly callId: string;
  readonly snapshotId: string;
  readonly phase: "prepared" | "completed";
  readonly model: {
    readonly provider: string;
    readonly modelId: string;
    readonly contextWindow: number;
  };
  readonly estimate: {
    readonly tokens: number | null;
    readonly knownTokens: number;
    readonly coverage: "complete" | "partial" | "none";
  };
  readonly providerReportedInputTokens?: number | null;
  readonly sections: readonly ContextSectionUsage[];
}

interface ContextSectionUsage {
  readonly id: string;
  readonly kind: "instruction" | "tool_schema" | "history" | "runtime_context" | "user_input";
  readonly category?: string;
  readonly source: {
    readonly owner: "core" | "skill" | "plugin" | "mcp" | "extension" | "runtime" | "user";
    readonly id: string;
  };
  readonly estimatedTokens: number | null;
  readonly estimateMethod: "provider_tokenizer" | "model_tokenizer" | "heuristic" | "unknown";
  readonly tokenizerId?: string;
  readonly characters?: number;
  readonly percentOfWindow: number | null;
}
```

`category` 可承载 `base`、`skills`、`memory`、`mode`、`tools` 等产品分类，但 Host Port 不依赖 Coding Agent 的具体 union，避免 Runtime 反向依赖产品包。

## 3. 采集位置

报告必须在“最终将要发送给模型”的调用边界生成：

1. `ModelCallFrameComposer` 输出最终 system prompt、tools 和 prompt provenance。
2. Context Strategy 输出压缩后的模型消息及 RuntimeMessageEnvelope 来源。
3. Message Finalizer 完成 Provider 前的模型消息调整。
4. Context Report Builder 对最终 instructions、tools 和 messages 估算。
5. `@vetta/ai` Adapter 接收同一份最终输入并发起调用。
6. finish 后把 Provider reported input usage 附加到 completed report。

不能在第 1 步就计算总量，因为 compaction、message finalizer、tool activation 和 Provider 转换可能继续改变实际输入。

## 4. System Prompt 与 Skill

现有 `SystemPromptDiagnostics.blocks` 可直接成为 instruction section 的来源，但需调整两个问题：

- `CodingAgentModelCallFrameComposer` 目前把全部 block 压成 `coding-agent.system-prompt`，并通过 `onPromptDiagnostics` 副通道通知。应让 `ModelCallFrame` 携带正式、只读的 `composition` metadata。
- 多个 skill 若被合并到一个 `skills` block，只能得到聚合值。要展示“各 skill”，编译器必须为每个 skill 保留稳定 source id，或在 block 内提供不可变 segment diagnostics。

推荐不改变 Provider 收到的拼接文本，只增加 provenance：

```ts
interface InstructionCompositionSegment {
  readonly instructionId: string;
  readonly segmentId: string;
  readonly category: string;
  readonly sourceOwner: string;
  readonly sourceId: string;
  readonly characters: number;
  readonly estimatedTokens: number | null;
}
```

这样可以继续发送单个 system prompt，同时保留 base、skill、memory、mode、plugin 等分项。

## 5. Tool Schema

每个激活工具形成独立 section：

- 稳定 id 使用工具 canonical name，不使用数组下标。
- 估算内容必须是实际传给 Provider 的 name、description 和 JSON Schema 的稳定序列化结果。
- Provider 若重写 schema，应在 Provider 转换后提供差异 diagnostics；第一阶段可先统计规范化 schema。
- MCP、extension、plugin、core tool 通过 source owner/id 区分。
- 不把 execute 函数、授权策略或隐藏 metadata 计入模型上下文。

## 6. History、Runtime Context 与 User Input

分类依据 RuntimeMessageEnvelope，而不是按 role 猜测：

- 已持久化对话消息：`history`。
- compaction summary、memory、文件上下文、系统注入：`runtime_context`，并保留 provider/source id。
- 本次显式用户输入：`user_input`。
- steering/follow-up 在进入模型调用后按其真实 origin 分类，不能全部伪装成普通 history。

无法确定来源时归入 `runtime_context/unknown`，不能丢弃，确保 sections 总量可对账。

## 7. Token 估算语义

分区 token 通常无法由 Provider 精确返回，必须诚实区分：

- `provider_tokenizer`：Provider 提供且能离线稳定调用的 tokenizer。
- `model_tokenizer`：本地已知模型 tokenizer。
- `heuristic`：字符/内容块启发式。
- `unknown`：无法合理估算。

汇总规则固定为：所有 section 都有估算时，`estimate.tokens` 等于 section 之和且 coverage 为 `complete`；部分未知时 `tokens` 为 `null`、`knownTokens` 只汇总已知项且 coverage 为 `partial`；全部未知时 coverage 为 `none`。不能把部分已知值冒充总量。

Provider finish usage 只作为实际总 input token：

- 不按比例回填 sections。
- 不覆盖 prepared estimate。
- UI 同时显示“估算分项”和“Provider 报告总量”。
- 若差异超过阈值，记录诊断用于改善 estimator，不向用户宣称 Provider 错误。

每个 section 的百分比以 context window 为分母，而不是以当前已用 token 为分母；UI 如需要“组成占比”，应单独计算并明确含义。

## 8. 生命周期与 Host Port

扩展现有 view，而不是让 Desktop 订阅底层 Agent event：

```ts
interface RuntimeSessionContextUsageView {
  readContextUsage(): RuntimeSessionContextUsage | undefined;
  readContextComposition(): ContextCompositionReport | undefined;
}
```

同时发布调用级 observation，供 UI 实时更新。规则：

- `prepared` 表示本次实际待发送内容。
- `completed` 增加 Provider usage。
- 模型切换、Session 切换和新调用开始时报告有明确 freshness，不显示上个 Session 残留。
- 默认报告不包含 prompt 原文，只包含 id、分类、字符数、token 和 hash/版本等非敏感元数据。

## 9. Desktop 展示建议

输入框中的 Context Ring 继续显示总占用；交互展开后显示：

- 总 estimated / context window。
- Provider reported input（若存在）。
- instruction、tool schema、history、runtime context、user input 一级分组。
- instruction 下按 base、skill、memory、mode、plugin 等二级分项。
- 每项 token、占 context window 百分比和 estimate 标识。

UI 不在本地重新 tokenize。缺失值显示未知，不显示 `0`。报告过期时应展示 freshness 状态或隐藏明细，不能把旧调用数据当成当前待发送数据。

## 10. 测试

必须覆盖：

- Prompt block/skill provenance 到 section 的一一映射。
- 最终拼接文本与 segments 字符区间/估算一致。
- Tool 激活、动态替换和隐藏后，section 同步变化。
- compaction 与 finalizer 后以最终消息为准。
- 全部已知时 section 汇总等于 report estimate；部分/全部未知时 tokens、knownTokens、coverage 符合固定规则。
- prepared/completed 只增加 Provider 总量，不篡改分项。
- Session/model 切换不泄漏旧报告。
- Host Port 和 IPC 可序列化。
- 报告不包含 system prompt、skill 正文、tool input 和凭据。
- Desktop 分组、展开、未知值和过期状态的纯逻辑测试。
