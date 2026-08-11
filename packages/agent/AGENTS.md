# Team: AI Core

> 本包属于 **AI Core Team**，同组包：`packages/ai`、`packages/tui`、`packages/web-ui`

## 职责范围

通用 Agent 运行时，提供 agent 循环引擎、状态管理、传输抽象。

## 关键模块

- `src/agent.ts` — Agent 核心逻辑
- `src/agent-loop.ts` — Agent 循环引擎（核心调度）
- `src/types.ts` — 类型定义
- `src/proxy.ts` — 代理模块

## 注意事项

- 本包是 `coding-agent` 的直接上游依赖，接口变更会直接影响下游
- `agent-loop.ts` 是最关键的文件，修改需格外谨慎

## 测试要求

- 测试位于 `test/`，默认运行 `bun run test:unit` 或定向 Vitest 文件；模型与 Transport 在公开边界使用确定性的 fake event stream。
- 修改 Agent Loop、消息状态或 Tool 执行时，必须覆盖纯文本完成、tool call/result 循环、多个工具、Provider/Tool 错误、取消、usage/stop 传播，以及不会多发或遗漏终止事件。
- 修改并发、排队、重试或事件订阅时，使用显式同步点和可控时钟验证事件顺序与最终状态，不使用任意 sleep。
- `bun run test:live` 只用于用户明确授权的真实 Provider 验证，不能作为默认测试，也不能替代可重复的状态机回归测试。
