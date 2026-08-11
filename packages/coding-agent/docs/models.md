# 模型与凭证

## 路径

| 文件 | 用途 |
|------|------|
| `~/.vetta/agent/models.json` | 自定义/本地模型与 provider 覆盖 |
| `~/.vetta/agent/auth.json` | API key / OAuth token |

可用环境变量 `VETTA_CODING_AGENT_DIR` 覆盖 agent 目录。

## `models.json` 最小例

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "llama3.1:8b" }]
    }
  }
}
```

常用 `api`：`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 等（以 `@vetta/ai` 为准）。模型可写 `id`、`name`、`reasoning`、`input`、`contextWindow`、`maxTokens`、`cost` 等。

加载逻辑：`src/models/configuration/`。

## 凭证

- 环境变量：如 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`（完整列表见 `@vetta/ai` / CLI help）。
- `auth.json`：登录/OAuth 与手动写入的 key。
- 解析顺序：显式配置 → env → auth 文件（实现见 `src/auth/`）。

## 扩展注册 Provider

`ExtensionAPI.registerProvider` 可覆盖 `baseUrl`、注册新 provider / OAuth / 自定义 stream。示例：`examples/extensions/custom-provider-*/`。

## CLI

```bash
vetta --list-models
vetta --model provider/id:high -p "hello"
```
