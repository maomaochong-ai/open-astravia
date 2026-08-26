# Tool Catalog 代际与 Subagent 观测边界

## 状态

Accepted

## 背景

Runtime Snapshot 与 `InMemoryCodingToolRegistry` 已保证 Turn-bound Tool lease 和 hard revoke，但 Coding Session execution
mode 另行实现了 Catalog 切换、旧代保留与 lease 清理。`runtime-subagents` 已拥有调度、并发、恢复和 delivery generation，
且提供失败回调 Port；Coding 组合却未接线该 Port，并用 `console.warn` 处理异步失败。

## 决策

- `runtime-tools` 提供 `GenerationalCodingToolCatalog`，统一发布新 Catalog、保留有 lease 的旧代、释放后退休以及跨代 binding
  执行。发布方必须为仍被租赁的新旧定义提供不同 binding identity；Runtime 在冲突时 fail-fast。
- Coding Agent 继续拥有 execution mode、Sandbox 注册、Tool 排序和激活策略，只调用通用 Catalog 的 `publish()`。
- `runtime-subagents` 保持零 workspace 依赖和现有 `onError` Port，不依赖 Runtime Observation。
- Coding Subagent Adapter 将 coordinator、恢复、通知投递和 Session observation 失败投影为类型化安全 Observation，再由
  Coding 子 Hub 独立观察或向应用 Hub 汇聚。payload 不包含任务、消息、路径或错误正文。

## 后果

- Tool 切换不再由 Coding 维护第二套 generation owner；旧 Turn 和新 Turn 的定义隔离可由协议包合同测试证明。
- Subagent 调度内核仍可独立使用；接入 Coding/应用后获得统一日志、Metrics、Trace 或 UI 数据源。
- Tool/MCP 描述、Sandbox 行为、Subagent Profile 与 child Session 组合均不进入通用 Runtime。
