# Team: AI Core

> 本包属于 AI Core，所有修改同时服从根 `AGENTS.md` 与 ADR-0077。

## 职责范围

单次 Agent 执行的最小内核，提供模型调用与 Tool Loop、消息状态转换、流式事件、错误、取消、
usage 和 stop 传播。

本包不拥有 Session 生命周期、Turn admission、Queue、Runtime Snapshot、产品 Feature、持久化或平台
I/O。它只依赖 `@vetta/ai` 和自身合同，不得依赖 `@vetta/runtime-*`、`@vetta/coding-agent` 或应用宿主。

## 关键模块

- `src/agent.ts` — Agent 核心逻辑
- `src/agent-loop.ts` — Agent 循环引擎（核心调度）
- `src/types.ts` — 类型定义
- `src/proxy.ts` — 代理模块

## 注意事项

- 本包是 `coding-agent` 的直接上游依赖，接口变更会直接影响下游
- `agent-loop.ts` 是最关键的文件，修改需格外谨慎
- 观测、存储和平台实现通过本包定义的窄 Port 注入；Port 的实现包不得反向拥有 Agent 合同

## 测试要求

- 测试位于 `test/`，默认运行 `bun run test:unit` 或定向 Vitest 文件；模型与 Transport 在公开边界使用确定性的 fake event stream。
- 修改 Agent Loop、消息状态或 Tool 执行时，必须覆盖纯文本完成、tool call/result 循环、多个工具、Provider/Tool 错误、取消、usage/stop 传播，以及不会多发或遗漏终止事件。
- 修改并发、排队、重试或事件订阅时，使用显式同步点和可控时钟验证事件顺序与最终状态，不使用任意 sleep。
- `bun run test:live` 只用于用户明确授权的真实 Provider 验证，不能作为默认测试，也不能替代可重复的状态机回归测试。
