# Team: Runtime

> 本包属于 Runtime 能力域，定义 Agent Kernel、Turn、事件和宿主 Port。

## 职责范围

核心运行时层，定义会话事件模型、数据契约、运行时宿主接口。

## 关键模块

- `src/contracts.ts` — SessionEvent、PromptRequest、SessionFacade 等核心契约
- `src/runtime-host/` — 运行时宿主实现（`runtime-host.ts` 编排 + session-events / history / peripheral-tasks 等）
- `src/errors.ts` — 错误定义

## 注意事项

- 本包是 `desktop-app` 和 `cli-app` 的直接依赖，接口变更影响所有应用层
- 公开事件和 Port 是 `coding-agent` 与应用宿主消费的下层合同，变更需同步检查消费者
- Kernel 与 Runtime 合同必须保持产品无关，不得导入 `@vetta/coding-agent`
- 生产代码、测试、配置和包清单均不得反向依赖 `@vetta/coding-agent`
- Runtime 包拥有实际能力，不是 `coding-agent` 的兼容转发层
