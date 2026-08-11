# 第 130 轮：Greenfield Extension Action Host

## 目标

在不改变 Extension 功能的前提下，为 Greenfield Session 实现第 129 轮冻结的 13 个命令式动作，
并只对已经具备等价能力的 Extension 收缩 Legacy 回退：

- 保留 `sendMessage` 的五种调用时投递语义；
- 用 Runtime-owned Port 承载 Custom Entry、会话名、Label、模型、Thinking 和动态 Tool；
- 继续绑定 Loader 创建的同一个共享 `ExtensionRuntime`；
- Provider/Flag-only Extension 可以进入 Greenfield；
- Event、Tool、Command、Shortcut、Renderer 等尚未迁移的注册能力继续回退 Legacy。

## 实施前行为基线

旧 `sendMessage` 不是单一的“追加上下文”，其行为由调用时的 Session 状态决定：

| 调用状态与参数 | 既有语义 | Greenfield 映射 |
| --- | --- | --- |
| 活动 Turn + `deliverAs: "steer"` | 当前 Tool Loop 下一次模型调用可见 | `steer` 输入队列 |
| 活动 Turn + `deliverAs: "followUp"` | 当前 Turn 结束后续轮 | `followUp` 输入队列 |
| 任意状态 + `deliverAs: "nextTurn"` | 只在下一次显式用户输入后生效 | Session `nextTurn` context |
| 空闲 + `triggerTurn: false` | 只持久化，不调用模型 | `context.recorded` |
| 空闲 + `triggerTurn: true` | 立即以该上下文启动一次续轮 | `continue` Turn |

把五种情况都映射成普通 continuation，会使 `nextTurn` 提前执行、空闲记录触发模型，或使
steering 错过当前 Tool Loop。因此本轮在 Kernel 中保留五种独立状态转换。

## 实施

### 1. Session Context Delivery

Runtime Core 新增 `RuntimeSessionContextDeliveryController`，Greenfield Backend 将它绑定到真实
`AgentSession`：

- `steer` / `followUp` 进入扩展后的 `SessionInputQueue`；
- 队列项可以只包含 Context，不必伪造用户消息；
- Turn Engine 在既有输入消费点提交 queued context，因此可见时序与原队列一致；
- `nextTurn` 在 Session 内暂存，并原子附到下一次 `send()` 的 user message 之后；
- `record` 通过 Pipeline 串行写 `context.recorded`，不创建 Turn；
- `triggerTurn` 使用已有 continuation 路径。

`TurnInputQueue` 的旧消息读取方法继续保留，新增的 Context 输入方法只扩展协议，不改变现有调用方。

### 2. Turn 外 Context 持久化

新增无 `turnId` 的 `context.recorded` 持久事件：

- Conversation Document 按 `context.appended` 的可见性规则投影；
- Recovery 明确只允许它出现在 Turn 外；
- Runtime Storage 使用 TypeBox 校验记录及可选 timestamp；
- 文件重开后恢复相同的模型上下文与 UI marker 顺序。

这里使用 TypeBox 是因为 JSONL 是外部持久化边界；进程内 Action Host 函数合同仍只使用
TypeScript 类型，不额外引入 Zod。

### 3. Runtime-owned Metadata 与 Tool Port

Greenfield Core Assembly 新增：

- `RuntimeSessionMetadataController`：追加 Custom Entry、设置/读取 Session Name、设置 Entry Label；
- `RuntimeSessionToolController`：设置会话级动态激活 Tool 覆盖；
- `RuntimeSessionContextDeliveryController`：执行上述五种 Context 投递。

Custom Entry、Name 和 Label 继续采用 append-only Document Operation。Repository 对这些独立
Session 元数据写允许调用方不先缓存 document revision，由仓储在写锁内读取最新 revision，避免
Extension 的 void API 与并发 Turn 写入发生伪冲突。

动态 Tool 覆盖由会话外围状态持有。Model Call Composer 在每次模型调用前读取覆盖值，并同时过滤
Prompt Tool 列表与可执行 Tool Catalog；因此切换不重建 Session，也不会改变已经冻结的在途调用。

### 4. Greenfield Action Host

新增 `CodingAgentGreenfieldExtensionActionHost`，完整绑定 13 个动作：

1. `sendMessage`、`sendUserMessage`；
2. `appendEntry`、`setSessionName`、`getSessionName`、`setLabel`；
3. `getActiveTools`、`getAllTools`、`setActiveTools`、`getCommands`；
4. `setModel`、`getThinkingLevel`、`setThinkingLevel`。

异步 void 动作继续捕获拒绝并上报对应 `ExtensionError`。Host 的 `dispose()` 会等待已发起的发送和
元数据写入，防止 Runtime 先关闭 Session 后丢失 Extension 动作。

`sendUserMessage` 仍走 Greenfield Prompt Adapter，因此文本、图片及输入规范化复用现有生产路径。
模型切换先检查候选模型的凭证；Command 列表读取现有 Prompt/Skill 资源，不复制命令解析算法。

### 5. 能力驱动切换

新增 Greenfield Extension 兼容性解析：

- 只有 `opaque-runtime-api` 缺口时，由本轮 Action Host 消除该缺口；
- Provider 与 Flag 启动贡献继续在 Session 创建前生效；
- 存在 Event、Tool、Command、Shortcut 或 Renderer 注册时，原 capability 缺口仍在，继续回退
  Legacy；
- CLI Greenfield IM Host 在 Session 创建后绑定共享 Runtime，并把 Action Host 纳入同一生命周期。

这不是按 Extension 名称维护白名单，而是按已实现的能力合同决定执行路径。

## 测试

新增或扩展的回归覆盖：

- 五种 Custom Message 投递模式；
- Context-only steering/follow-up 队列；
- `nextTurn` 与显式用户消息的模型上下文顺序；
- 空闲 record 不启动 Turn，`context.recorded` 可持久化和恢复；
- Custom Entry、Name、Label 的无预读 revision 写入；
- 13 个 Action Host 动作的 Port 映射与错误转发；
- 动态 Tool 覆盖影响后续 Model Call；
- Provider/Flag-only Extension 实际进入 Greenfield 并保留动作绑定；
- 含 Event 注册的 Extension 继续走 Legacy fallback。

针对性测试共 8 个文件、28 项通过。最终质量门以本轮结束时的根目录 `check:quick` 和
`bun run check` 结果为准。

## 明确未修改

- 没有迁移 Extension Event 回调执行；
- 没有迁移 Extension 自注册 Tool、Command、Shortcut 或 Message Renderer；
- 没有删除 Legacy Extension Host；
- 没有改变 Provider/Flag 注册时序；
- 没有把 Extension Runtime、SessionManager 或具体 Tool Registry 下沉到 Runtime Core；
- 没有改变已有用户消息、模型、Thinking、Prompt/Skill Command 或 Tool 的业务算法。

## 结果

`opaque-runtime-api` 不再是所有 Extension 的永久全局回退原因。Greenfield 已具备完整的命令式
Action Host，Provider/Flag-only Extension 可以在保持原动作语义的情况下使用新内核。

同时，切换仍然是保守的：注册型能力没有因为 Action Host 完成而被错误放行。Legacy 现在只承接
尚未拥有 Greenfield 执行合同的 Extension 能力。

## 下一步

第 131 轮应迁移 Extension Event 执行边界，而不是继续扩张 Action Host：

1. 冻结 Input、BeforeAgentStart、Context、Tool 生命周期和 Session 生命周期事件的顺序、可修改字段
   与错误策略；
2. 定义不依赖旧 `AgentSessionEvent` 的 Greenfield Extension Event Host；
3. 将事件结果映射到既有 Prompt、Model Call、Tool Wrapper 与 Session 生命周期检查点；
4. 建立 Legacy/Greenfield 差分测试；
5. 仅在事件合同等价后消除相应 capability 缺口，Tool/Command/Shortcut/Renderer 仍独立迁移。
