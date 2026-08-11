# 实施日志：Model Call Frame 与实时能力校验

## 2026-07-26

### 目标

- 修正 Turn 级 Runtime Snapshot 固定提示词和工具清单的问题。
- 工具、提示词和未来 Skill 变化不再要求全量重新 prepare Feature。
- 模型已经看到工具后，执行前仍按当前注册状态校验。
- 保留现有工具 Schema、描述、结果、路径、取消和副作用合同。

### 实施

- `agent-core`
  - `AgentLoopConfig` 新增 `resolveCallContext`。
  - 每次 LLM 调用前重新解析 system prompt 和 tools。
  - Tool Loop、消息、steering、follow-up 和 Stream 协议保持原样。
- `runtime-core`
  - 新增 `ModelCallContributionProvider`、`ModelCallContribution` 和 `ModelCallFrame`。
  - Feature Compiler 只把 Provider 纳入 Runtime Snapshot，不在编译时执行动态贡献。
  - `resolveModelCallFrame()` 每次调用合并静态与动态贡献，检查重名并冻结值。
  - `AgentCoreTurnEngine` 在每次模型调用前解析 Frame。
  - Feature 拓扑、Context Strategy、Context Provider、Observer 和资源释放仍保持 Turn 级
    Snapshot Lease。
- `runtime-tools`
  - Coding Tools Feature prepare 只创建动态 Provider。
  - Provider 每次模型调用读取最新 Catalog Snapshot 并执行激活选择。
  - Catalog 新增只读 `resolve(toolName)`，用于执行前实时校验。
  - 工具已删除时返回 `coding_tool_unavailable` 错误。
  - 同名工具已替换时返回 `coding_tool_definition_changed`，不会将旧参数交给新实现。

### 生命周期结果

```text
Feature 拓扑变化
  -> compile Runtime Snapshot
  -> AtomicRuntimeSnapshotProvider.swap()

工具 / 提示词 / Skill 成员变化
  -> 更新对应动态数据源
  -> 下一次模型调用解析新的 Model Call Frame

工具调用真正开始前
  -> 查询当前 Catalog
  -> 不存在或定义变化则拒绝
```

Model Call Frame 会重新创建轻量数组、Map 和冻结后的定义视图，但不会重新创建 MCP 连接、
文件监听器、索引或其他 Feature 资源。一次已发送的模型请求无法撤回其中的提示词、Skill
内容和 Tool Schema；变化从下一次模型调用生效。

### 测试

- `packages/agent`
  - 新增动态 Call Context 测试。
  - 验证同一 Loop 的第二次模型调用看到新提示词和工具集合。
  - 新增测试与既有 Agent Loop 定向测试共 9 项通过。
- `packages/runtime-core`
  - 新增 Model Call Frame 测试。
  - 验证动态提示词变化不重新 prepare 或 contribute Feature。
  - 完整包 5 个文件、22 项测试通过。
- `packages/runtime-tools`
  - 验证 Catalog 修改后不重新编译，下一 Frame 立即变化。
  - 验证模型看到 read 后注销，执行被拒绝，后续模型调用不再暴露 read。
  - 验证同名替换不会执行新实现。
  - 完整包 7 个文件、93 项测试通过。
- `bun run check:quick` 通过。

`packages/agent` 完整既有套件仍有 6 项基线失败，原因是测试构造的 Agent 未配置默认模型并
触发 `No model configured`；本轮没有修改 `Agent` 默认模型逻辑。新增测试和受影响的既有
Agent Loop 测试均通过。

### 明确未修改

- 未修改 current_time、read、ls 的业务行为。
- 未实现具体 Skill、MCP 或 Prompt Registry；本轮只提供它们所需的动态贡献合同。
- 未实现强制终止已经开始执行的工具；该能力需要显式 revoke 与 Abort 策略。
- 未切换生产 RuntimeHost、Desktop、CLI、RPC 或 IM。

### 下一步

1. 迁移 grep 时直接注册到 Catalog，不修改 Coding Tools Feature。
2. Skill/MCP 迁移时区分长生命周期资源和每次模型调用的动态贡献。
3. 增加显式 deactivate/revoke 合同，避免把注销和取消副作用混为一谈。
