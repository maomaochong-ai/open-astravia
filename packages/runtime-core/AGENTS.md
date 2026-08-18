# Team: Runtime

> 本包属于 Runtime 能力域，所有修改同时服从根 `AGENTS.md` 与 ADR-0077。

## 职责范围

产品无关的多轮运行机制，定义 Session、Turn admission、Queue、Runtime Snapshot、Conversation
Document、生命周期事务、恢复、资源所有权、Port、Session Extension 和通用事件路由。

本包不拥有 Todo、IM、知识库、Coding Prompt、产品 Profile 等产品规则，也不访问文件系统、进程、
数据库、Electron 或其他具体环境。

## 关键模块

- `src/contracts.ts` — SessionEvent、PromptRequest、SessionFacade 等核心契约
- `src/runtime-host/` — 运行时宿主实现（RuntimeHost、Active Session 事务、事件、历史与生命周期）
- `src/errors.ts` — 错误定义

## 注意事项

- 本包是 `desktop` 和 `cli-host` 的直接依赖，接口变更影响所有应用层
- 公开事件和 Port 是 `coding-agent` 与应用宿主消费的下层合同，变更需同步检查消费者
- Kernel 与 Runtime 合同必须保持产品无关，不得导入 `@vetta/coding-agent`
- 生产代码、测试、配置和包清单均不得反向依赖 `@vetta/coding-agent`
- Runtime 包拥有实际能力，不是 `coding-agent` 的兼容转发层
- “可跨平台”不是进入本包的充分条件；包含产品名词或默认产品选择的逻辑仍由产品包拥有

## 测试要求

- 使用本包 Vitest Node 测试和产品无关的合同 fixture；不得从 `coding-agent` 或具体 Host 导入测试实现。
- Kernel 阶段、Session 状态、事件或 Port 变化必须覆盖合法转换、拒绝转换、错误与取消传播、事件顺序和重复调用语义。
- Runtime Host、资源注册或初始化流程变化必须覆盖成功、初始化失败、部分初始化回滚、中止、正常关闭、重复关闭和释放失败；测试应能证明每项资源只由明确 owner 释放。
- 公开合同变化除实现测试外还要运行受影响消费者的合同测试；仅通过本包类型检查不足以证明宿主兼容。
