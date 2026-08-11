# Phase 4：无状态 Agent Engine

## 已实现

新增 `packages/agent/src/engine/`，提供：

- 不可变 `AgentTurnRequest` 与 `runAgentTurn()`。
- 分离的 `AgentRun.events` 和 `AgentRun.result`，共享唯一终态。
- 显式 `maxModelCalls`、`maxToolCalls`、`maxRecoveryAttempts`、checkpoint timeout 与可选 deadline。
- callback checkpoint，不再依赖消费者回填事件才能继续。
- TypeBox 工具参数校验，schema 与 execute input 通过泛型关联。
- 工具授权、未知工具、无效参数、执行失败的结构化模型可见结果。
- observer 隔离：观察者异常形成 diagnostic，不破坏核心执行。
- success、failure、abort、limit、checkpoint、工具循环和差分测试。
- `takeSteeringMessages` 与 `takeContinuationMessages` 是显式、可取消的输入端口；交付时发出带来源的 `input_message`。
- steering 在每个工具结果后检查；命中后中断剩余工具，并为每个跳过调用生成模型可见结果，避免 tool-call/result 不配对。
- 工具执行上下文支持 update 与 phase；事件包含开始时间、耗时和 phase 列表。
- checkpoint 将本次 Provider 调用的 `messages` 与后续运行状态的 `contextMessages` 分开，支持瞬态变换和持久压缩并存。
- `assistant_result` 只在自然停止时触发，不再对 tool-use turn 提前触发。

## 测试证据

- `packages/agent`：16 个测试文件、91 条测试通过。
- 新 Engine 功能测试 20 条。
- 新旧实现的文本、工具、steering 中断与 continuation canonical outcome 差分测试 4 条。
- legacy loop 的失败、预算和生命周期测试继续保留，防止兼容路径回归。

## 未完成的退出条件

- 现有 `Agent` standalone 类仍直接调用 legacy `agentLoop`，尚未改成新 Engine wrapper。
- Runtime 已有并行的 `StatelessAgentCoreTurnEngine`，但生产默认 `AgentCoreTurnEngine` 尚未切换到 `runAgentTurn()`。
- 动态调用 Frame 和 Runtime message envelope 仍需由生产 Adapter 映射。
- salvage、legacy `streamFn`、Runtime observation 已在并行 Adapter 接入；生成级 telemetry 尚未对齐。

因此本阶段结论是“新 Engine 核心已实现并具备行为基线”，不是“旧 Engine 已退役”。在补齐上述产品语义前直接切换，会删除现有能力，不符合迁移原则。

## 后续要求

下一步先实现独立 Runtime Adapter，完成 Frame、message identity、stream、salvage、telemetry 和 observation 映射；通过 Runtime 全量与 canonical 差分后再切换生产组合根。随后迁移 standalone wrapper，最后按兼容周期删除 legacy loop。
