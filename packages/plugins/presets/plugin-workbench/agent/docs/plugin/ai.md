# AI 文本能力

`ctx.ai` 让插件调用用户已经在 Vetta 中配置的文本模型。模型发现、默认模型解析、API Key 与登录凭据注入、实际请求都由 Desktop 主进程负责；插件只能看到脱敏后的模型描述与完成结果。

## 权限

- `ai.models.list`：调用 `ctx.ai.listModels()`。
- `ai.complete`：调用 `ctx.ai.complete()`，可能产生模型费用或消耗用户额度。

两项权限独立。只知道固定模型标识的插件可以仅声明 `ai.complete`；需要展示模型选择器时再同时声明 `ai.models.list`。

## 列出模型

```ts
const { defaultModel, models } = await ctx.ai.listModels();

const options = models.map((model) => ({
  value: model.modelKey,
  label: model.name,
  provider: model.provider,
}));
```

列表只包含当前可用且支持文本输入的模型。`modelKey` 使用 `provider/model` 格式；`defaultModel` 只有在用户设置的默认模型当前可用时才返回，否则为 `null`。

## 完成文本

```ts
const result = await ctx.ai.complete({
  modelKey: selectedModelKey,
  systemPrompt: "在不改变含义的前提下优化用户提示词。只返回优化结果。",
  prompt: userPrompt,
  temperature: 0.3,
  maxTokens: 1200,
});

console.log(result.text, result.usage.totalTokens);
```

`modelKey` 可省略，此时宿主使用用户明确设置且当前可用的默认模型；没有可用默认模型时调用会失败。`reasoning` 只会传给声明支持推理的模型，`maxTokens` 不会超过该模型自身的输出上限。

`complete` 是单轮契约（`systemPrompt + prompt`），不接受工具或图片。多轮对话使用下方的 `chat`；插件提供 API Key 仍然不被接受——凭据永远由宿主注入。

## 多轮对话 chat

`ctx.ai.chat()` 是**无状态**的多轮文本完成：宿主不保存任何会话状态，插件自己持有完整消息转写（需要跨重启保留时配合 `ctx.storage` 持久化），每次调用都发送全量 `messages`。权限沿用 `ai.complete`。

```ts
const messages: PluginAiChatMessage[] = [
  { role: "user", content: "轮到你走棋了。当前局面：…" },
];

const result = await ctx.ai.chat({
  modelKey: selectedModelKey, // 可省略，同 complete 的默认模型解析
  systemPrompt: "你是中国象棋棋手。",
  messages,
  tools: [
    {
      name: "make_move",
      description: "落子。走法使用 ICCS 坐标，如 h2e2。",
      parameters: {
        type: "object",
        properties: { move: { type: "string" } },
        required: ["move"],
      },
    },
  ],
});
```

- `messages` 为全量转写，元素是 `user` / `assistant` / `toolResult` 三种角色；`assistant` 消息可携带其历史 `toolCalls`，`toolResult` 通过 `toolCallId` 与之对应。
- `tools` 是**插件内部工具**：只对本次请求可见，模型触发时宿主不执行任何东西，只把 `toolCalls` 原样返回（`stopReason: "toolUse"`）。插件自行执行，把结果作为 `toolResult` 消息追加进 `messages` 后再次调用 `chat`，形成插件内部 loop。这类工具**不会**注册进宿主 Agent，不影响正常会话。
- `temperature` / `maxTokens` / `reasoning` 语义与 `complete` 一致。

典型 loop：

```ts
for (;;) {
  const turn = await ctx.ai.chat({ systemPrompt, messages, tools });
  messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
  if (turn.stopReason !== "toolUse") break;
  for (const call of turn.toolCalls) {
    const outcome = runLocalTool(call); // 插件内部执行，例如校验并落子
    messages.push({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: outcome.text,
      isError: outcome.isError,
    });
  }
}
```
