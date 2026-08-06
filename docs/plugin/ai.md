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

当前 v1 契约只提供单轮文本完成（`systemPrompt + prompt`），不接受工具、图片或由插件提供的 API Key。需要多轮或多模态时应扩展版本化的底层 capability，而不是让插件绕过宿主直接读取模型配置。
