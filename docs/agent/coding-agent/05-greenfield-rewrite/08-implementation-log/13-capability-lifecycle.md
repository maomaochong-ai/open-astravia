# 实施日志：稳定能力绑定、生命周期与在途执行仲裁

## 2026-07-26

### 目标

- 消除以 JavaScript 工具对象引用判断定义是否变化的不稳定合同。
- 区分普通停用、热卸载和安全撤销，避免所有运行时变化都隐式取消副作用。
- 让 Catalog 原子完成执行前校验与在途执行登记，关闭校验后、执行前的竞态窗口。
- 把能力不可用原因以结构化错误传到 Agent Tool Result。
- 保留 current_time、read、ls 已验证的业务行为。

### 设计结论

模型调用看到的能力版本由以下稳定值标识：

```ts
interface CapabilityBinding {
	readonly sourceId: string;
	readonly capabilityId: string;
	readonly revision: string;
}
```

`revision` 是 Catalog 内单调生成的定义版本，不是 Catalog Snapshot version，也不是对象地址。
每次模型调用可以重建轻量 Entry 和 Frame，而不会因此改变 revision。注销后同名重新注册、
替换定义或 revoke 会让旧绑定永久失效。

生命周期定义为：

| 操作 | 新 Frame 是否暴露 | 旧绑定新执行 | 在途执行 | revision |
| --- | --- | --- | --- | --- |
| activate | 是 | 允许 | 不影响 | 保持 |
| deactivate | 否 | 拒绝，可重试 | 继续 | 保持 |
| revoke | 否 | 拒绝，不可重试 | 协作取消 | 轮换 |
| unregister | 否 | 拒绝，可重试 | 继续 | 删除 |

### 实施

#### `packages/agent`

- 新增 `AgentToolExecutionError`。
- 错误携带：
  - `code`：稳定机器错误码。
  - `retryable`：调用方是否可以在刷新能力后重试。
  - `metadata`：工具名和能力绑定等只读上下文。
- Agent Loop 仍把 Error message 写入文本 Tool Result。
- 只有显式 `AgentToolExecutionError` 写入结构化 details；普通 Error 保持原有空 details。

#### `packages/runtime-core`

- 新增通用 `CapabilityBinding` 合同，不绑定 Coding Tool、MCP 或 Skill 词汇。
- 新增 `RuntimeToolExecutionError`，作为 Runtime Tool 到 Adapter 的稳定错误边界。
- `AgentCoreTurnEngine` 只桥接显式 Runtime Tool Error：

```text
RuntimeToolExecutionError
  -> AgentToolExecutionError
  -> ToolResultMessage.details
```

- Tool Policy 拒绝和普通工具异常的既有文本语义不变。

#### `packages/runtime-tools`

- `CodingToolCatalog.resolve()` 改为返回包含 binding、registration 和 state 的只读 Entry。
- Catalog Snapshot 同时冻结 Entry、binding 和 active registration 视图。
- `CodingToolCatalog.execute(binding, request)` 成为唯一执行仲裁入口。
- `CodingToolRegistry` 新增：
  - `activate(toolName)`
  - `deactivate(toolName)`
  - `revoke(toolName, options)`
  - `unregister(toolName)`
- 新增 `CodingToolExecutionTracker`：
  - 为每个开始执行的 capability 建立独立 revoke controller。
  - 使用 `AbortSignal.any()` 合并 Turn 取消与 revoke 取消。
  - 执行结束后确定性清理 tracker。
  - revoke 后丢弃底层实现晚到的成功结果。
- Availability Guard 不再保存 registration 对象用于引用比较，只保存稳定 binding 并调用
  Catalog 仲裁。
- Availability Error 统一为 Runtime Tool Error，错误码包括：
  - `coding_tool_unavailable`
  - `coding_tool_definition_changed`
  - `coding_tool_deactivated`
  - `coding_tool_revoked`

### 原子性边界

错误实现：

```text
resolve(name)
-> await 其他逻辑
-> execute(tool)
```

在 resolve 成功后、execute 登记前发生 revoke，会让旧调用穿过撤销。

当前实现：

```text
Catalog.execute(binding, request)
-> 同步校验当前 Entry
-> 同步登记 tracker
-> 执行实现
-> finally 清理 tracker
```

JavaScript 单线程同步段保证 revoke 不能插入“校验完成但尚未登记”的间隙。登记完成后发生
revoke 时，tracker 能找到并取消该调用。

### 行为边界

- deactivate 和 unregister 不取消已经开始的工具，避免架构热更新静默改变副作用语义。
- revoke 是调用方明确选择的安全动作，不从 unregister 自动推导。
- AbortSignal 只能协作取消；工具实现如果忽略 Signal，外部副作用仍可能发生。
- Tracker 可以阻止晚到结果进入 Tool Loop，但不声称能够回滚文件、进程或网络副作用。
- Catalog version 表示成员视图变化；binding revision 表示单项能力定义兼容性，二者不混用。
- 每次 Model Call Frame 只重建轻量视图，不重建 Runtime Snapshot 或 Feature 长生命周期资源。

### 测试

- `packages/agent`
  - 结构化 Agent Tool Error 会进入 Tool Result details。
  - 受影响的动态 Call Context 与 Agent Loop 定向测试：2 个文件、10 项通过。
- `packages/runtime-core`
  - Runtime Tool Error 经 Adapter 桥接到 Agent Tool Result。
  - 完整包：5 个文件、23 项通过。
- `packages/runtime-tools`
  - 克隆后的 binding 仍能执行，证明不依赖对象引用。
  - deactivate 隐藏工具、拒绝旧调用，activate 保持 revision 并恢复旧绑定。
  - revoke 轮换 revision、取消在途调用并返回不可重试结构化错误。
  - deactivate/unregister 不终止在途调用。
  - 注销后同名重新注册不会复活旧绑定。
  - 完整包：7 个文件、97 项通过。
- `bun run check:quick` 通过。

### 明确未修改

- 未修改 current_time、read、ls 的描述、Schema、输出、路径、图片、编码或截断行为。
- 未把 revoke 默认应用到普通 unregister。
- 未实现底层副作用回滚或进程级强杀。
- 未迁移具体 Skill、MCP、Knowledge、Subagent 或生产 Profile。
- 未切换 RuntimeHost、Desktop、CLI、RPC 或 IM。

### 下一步

1. 把下一项旧工具按同一 Catalog Registration 合同迁移，不修改 Coding Tools Feature。
2. 为 MCP Tool Catalog 复用 Capability Binding 和生命周期语义，但保留 MCP 连接自己的资源
   生命周期。
3. 在宿主组合根接线前定义谁有权限调用 revoke，以及 revoke reason 的审计事件。
