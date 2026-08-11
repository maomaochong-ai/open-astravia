# Team: AI Core

> 本包属于 **AI Core Team**，同组包：`packages/agent`、`packages/tui`、`packages/web-ui`

## 职责范围

统一多提供商 LLM API，包括流式处理、模型管理、提供商注册。

## 关键模块

- `src/stream.ts` — 核心流式处理入口
- `src/types.ts` — 所有类型定义，修改需同步检查 agent/web-ui 的兼容性
- `src/models.generated.ts` — 自动生成，不要手动编辑；通过 `scripts/generate-models.ts` 生成
- `src/providers/` — 各 LLM 提供商实现
- `src/api-registry.ts` — API 注册表

## 注意事项

- 修改 `types.ts` 中的 `Api`、`StreamOptions`、`KnownProvider` 等类型后，必须检查 `packages/agent` 和 `packages/coding-agent` 是否需要适配
- 添加新提供商请严格遵循 [`README.md#adding-a-new-provider`](README.md#adding-a-new-provider) 中的文件、测试和文档清单

## 测试要求

- 默认使用 `bun run test:unit` 或 `bunx vitest --run <test-file>`，以 fixture/fake transport 覆盖 Provider 请求映射、流式 chunk 聚合、tool call、reasoning、usage、stop、错误和取消语义。
- Provider 协议、流解析或消息转换发生变化时，上述成功、部分流、畸形输入、Provider 错误和中止路径属于必测合同；不能只测试最终文本。
- 需要本地协议服务器或 SDK 集成环境的测试放入 `test:integration`，运行 `bun run test:integration`。必须与默认单测隔离并保持确定性。
- `bun run test:live` 会访问真实 Provider，只能在用户明确授权、凭证已由环境安全提供且任务确实需要时运行；live 结果不能替代可重复的单元/集成回归测试。
