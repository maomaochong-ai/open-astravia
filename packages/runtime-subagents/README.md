# Runtime Subagents

`@vetta/runtime-subagents` 是与产品和宿主无关的子代理调度内核。

## 职责

- 管理子代理身份、状态、快照和恢复状态；
- 执行 FIFO 排队和并发限制；
- 通过 Child Factory/Handle 驱动创建、继续、打断和释放；
- 执行子代理生命周期钩子；
- 协调 `wait` 与自动通知之间的恰好一次交付。

## 非职责

- 不创建 Coding Agent `RuntimeSession`；
- 不加载模型、Tool、MCP、Skill、知识库或上下文；
- 不持久化 Conversation；
- 不定义 `explorer`、`workflow` 等产品 Profile；
- 不生成包含具体工具名的模型可见提示文本。

上述能力由产品组合层和对应 Runtime 包实现。`runtime-subagents` 通过
`SubagentChildFactory`、`SubagentLifecycle` 和观察回调接收这些能力。

## 内部结构

- `SubagentCoordinator`：公开命令编排和异步生命周期；
- `SubagentStore`：记录、索引和目标解析；
- `SubagentScheduler`：并发槽位和 FIFO 队列；
- `SubagentDelivery`：generation 交付声明、等待者和通知批次；
- `SubagentTypeRegistry`：运行时可变的子代理类型目录。

子代理执行是长生命周期并发状态机，不是线性管道。无状态的数据投影可以使用管道组合，状态转换则必须由上述单一所有者维护。

## 验证

在本包目录运行 `bun run test`。仓库质量门禁还会检查本包的 workspace
依赖和工具协议残留，防止产品实现反向进入调度内核。
