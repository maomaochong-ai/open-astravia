# 第 177 轮：中立 Session Host 与 Turn 编排

## 目标

第 176 轮已经建立 Greenfield Print 候选，但生产组合仍先创建 RPC adapter、RPC retry 和 Bash，再把其中一部分借给 Print。结果是非 RPC 的 Print 路径仍被 RPC 外围结构干扰，同时 prompt、Extension command、continue 和 retry 的 Turn 语义分别复制在 Print 与 RPC adapter 中。

本轮目标是提取中立的 Agent Session 所有权与 Turn 编排，让 Runtime 核心资源只组合一次，Print/RPC 仅负责各自协议投影；本轮只调整架构边界，不修改既有功能与默认选择。

## 审计结论

### 1. Retry 属于 Turn 编排，不属于 RPC

自动重试根据 Turn 失败结果决定是否调用 `continue()`，其输入是重试设置、活动 Session 和 Turn 结果，不需要 RPC wire。RPC 只需要把 retry 事件投影给客户端，因此 retry controller 应位于中立 Runtime adapter 层，旧 RPC 名称只保留兼容导出。

### 2. 完整执行观察必须跟随活动 Session

Print 订阅完整 `executionObservationStream` 时原先直接绑定初始 Session。发生 switch/fork 后，稳定 SessionEvent 会重绑，但完整观察仍停留在旧 Session，可能漏掉新会话事件并接收旧会话的迟到事件。观察订阅应由 Active Session Host 持有，并在 replacement 提交时与稳定事件一起重绑。

### 3. Extension Session Host 不是 IM/RPC 专属对象

Extension Session Host 管理初始化、命令、reload、shutdown 和 runner replacement，其合同不依赖 IM 协议。实现应进入中立 `agent-runtime` 目录；旧 RPC 路径保留窄转发，避免破坏已有内部消费者。

## 实施内容

### 中立 Turn 与 Retry

在 coding-agent Runtime adapter 层新增：

- `CodingAgentGreenfieldTurnExecutor`：统一普通 prompt、Extension command 短路、steer/follow-up 拒绝 Extension command、失败判断、continue 与自动重试。
- `CodingAgentGreenfieldTurnRetryController`：保留原退避、可重试错误判定、取消和 retry 事件语义，不依赖 RPC transport。
- 既有 `GreenfieldRpcRetryController` 及其类型名称改为兼容别名，调用方无需立即迁移。

### 中立 Agent Session Host

新增 `GreenfieldAgentSessionHost`，集中拥有：

- Runtime composition。
- Active Session Host。
- Extension Session Host。
- Managed MCP source。
- Turn executor 与 retry controller。
- retry 事件订阅和可重试最终清理。

Runtime、Session、Extension 和 MCP 的 ownership 不再分别复制到 Print/RPC adapter。RPC adapter 增加显式的外部资源所有权选项；生产组合由 Agent Session Host 负责资源，adapter 只释放自身协议资源。直接构造 adapter 的既有测试与兼容调用仍保持原所有权默认值。

### Print/RPC 外围分离

Runtime composition 现在先创建中立 Agent Session Host，再按 CLI intent 分支：

- Print 分支直接创建 `GreenfieldPrintSessionAdapter` 并返回，不构造 Bash、RPC adapter 或 RPC capabilities。
- 普通 RPC 分支把同一个 Turn executor 注入 RPC adapter，保留 RPC 唯一终态与事件缓冲逻辑。
- Greenfield IM 继续使用既有 Turn 路径，避免在架构重构中额外引入此前没有的 retry 行为。

Print adapter 只依赖最小结构合同，不依赖 RPC 类型或具体 Agent Session Host 实现。

### 动态完整观察流

Active Session Transition Host 新增完整执行观察订阅：

- 订阅当前 Session 的 `executionObservationStream`。
- switch/fork replacement 提交时取消旧订阅并绑定新 Session。
- 旧 Session 的迟到观察不再投递。
- 单个观察 listener 失败不影响其他 listener 和 Session 转换。

Print 的完整 JSON 事件投影改为消费这一动态订阅入口。

### Extension Host 归位

Extension Session Host 实现移动到 `src/agent-runtime/greenfield-extension-session-host.ts`，名称改为 `GreenfieldExtensionSessionHost`。原 `src/rpc/greenfield-im-extension-session-host.ts` 仅保留兼容导出，既有行为不变。

## TypeBox / Zod 判断

本轮没有新增外部输入、持久化数据或 wire schema，只移动内部类型化对象的所有权和调用关系。引入 TypeBox/Zod 不会增加边界安全，反而会重复验证内部合同，因此本轮不新增 Schema。

## 测试

新增或扩展测试覆盖：

- Extension command 短路，不启动模型 Turn。
- retryable Provider 失败通过活动 Session `continue()` 重试。
- steer/follow-up 不被当作 Extension command 执行。
- switch 后完整执行观察切换到新 Session，旧 Session 迟到观察被隔离。
- Extension Session Host 移动后的 reload/rollback 行为。
- Print、Runtime 选择、IM Host、Runtime capabilities 和 ownership cleanup 集成回归。

## 验证结果

- coding-agent 定向测试：3 个文件、20 项通过。
- cli-app 定向测试：6 个文件、39 项通过。
- `bun run check:quick` 通过。
- 根目录 `bun run check` 通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。

## 明确未修改

- Print 默认 backend 仍是 Legacy；Greenfield 仍需显式选择。
- 普通 RPC 默认 Greenfield、IM 默认 Greenfield 和既有自动回退策略未变。
- Tool、Prompt、Skill、MCP、Knowledge、Memory、Provider 请求与会话格式没有功能重构。
- RPC wire、Print JSON wire、Extension event 和重试判定规则没有修改。
- 没有删除 Legacy adapter、旧 RPC 内部导入路径或旧会话兼容能力。

## 尚未闭合

Greenfield Print 仍缺少图片/`@file`、完整 tool payload、真实 Provider HTTP 失败与 retry 事件、Extension 错误、continue/resume 和安装产物差分门禁。完成这些行为门禁前不应切换 Print 默认 backend。

## 下一步

下一阶段应以标准 `vetta` CLI 补齐 Greenfield/Legacy Print 的高风险行为差分：先覆盖图片与 `@file`、工具调用完整 payload、Provider 失败/自动重试和 Extension 错误，再覆盖 continue/resume 与安装产物。只修复差分暴露出的兼容问题，不借机改造功能。
