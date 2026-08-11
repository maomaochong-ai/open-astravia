# 第 106 轮：Greenfield 子代理 MCP 能力投影与所有权收敛

## 1. 目标

第 105 轮完成了根 Session 的文件 MCP 与 Session-local 插件 MCP 组合，但 Greenfield 子代理仍通过递归展开父
Composition Options 获得 MCP：文件 Source 会在子 Composition 中再次建立 Synchronizer，插件 MCP 工厂也会
再次创建 Runtime。该行为与 Legacy 子代理不同，并导致 Explorer 的显式 Tool Profile 实际看不到 MCP、
Workflow 只能看到文件 MCP 而不能看到父 Session 插件 MCP。

本轮目标是冻结 Legacy 行为并保持以下所有权：

```text
父 Session     -> MCP Source / Supervisor / Client / dispose
子 Session     -> 创建或重开时捕获的只读 Tool Binding 集合
子 Composition -> 自己的 Tool Registry，不创建 MCP Source 或插件 MCP Runtime
```

只修正能力投影和生命周期边界，不改变 MCP 配置、协议、工具名称、执行结果或插件贡献格式。

## 2. Legacy 行为基线

Legacy `AgentSession` 在创建和重开子代理时调用 `McpManager.getTools()`，由 `SubagentCoordinator` 将当时的
`AgentTool` 数组交给 Child Factory。Factory 在 `inheritParentMcp` 为 true 时追加这些实例，并显式设置
`enableMcp: false`。

新增基线测试冻结：

- Explorer 与 Workflow 都追加父级同一个 Tool Binding 实例；
- 每次创建子代理时重新读取父级工具集合；
- 已创建子代理的成员集合不是运行期实时订阅；
- 子代理不继承父级显式激活集合；
- `McpManager.getTools()` 返回未按父 `agent_mode` 裁剪的原始 Ready Tool，因此本轮 Greenfield 也不额外裁剪。

父 Session 后续替换 MCP 配置时让已运行子代理实时更新，属于功能变化，不在本轮引入。

## 3. Runtime-native 只读 Binding View

`McpRuntimeToolSynchronizer` 新增 `view()`，保存最近一次成功同步的 `McpRuntimeToolView`：

- View 包含 `RuntimeToolDefinition` 与 fingerprint；
- Source 刷新失败时继续保留上一次成功 View；
- `dispose()` 后 View 变为空集合；
- 调用方只能读取 Binding，不获得 Source、Supervisor、Client 或 dispose 权限；
- 它是当前能力视图，不是持久化快照或 Turn 级全量状态。

`CodingAgentPluginMcpRuntime` 只向 Composition Root 暴露同样的只读 `view()`。动态 Server 替换、模式表和
Supervisor 仍保持私有。

## 4. 父 Session MCP 投影

创建或重开 Greenfield 子代理前，Composition Root 执行：

1. 刷新父 Composition 的文件 MCP Synchronizer；
2. 刷新父 Session 的插件 MCP Runtime；
3. 按“文件 MCP 在前、插件 MCP 同名覆盖”的既有优先级合并 Binding View；
4. 根据子代理 Profile 的 `inheritParentMcp` 决定是否投影；
5. 将捕获的 Tool 作为 `external` Registration 放入子 Composition 的私有 Registry。

Greenfield 子代理 Profile 新增显式 `inheritParentMcp`，Explorer 与 Workflow 均设为 true，不再依赖描述文字
表达继承策略。

## 5. 子 Composition 所有权纠正

递归创建子 Composition 时不再直接传播以下父级能力：

- `mcpSource`；
- `createPluginMcpRuntime`。

因此子代理不会：

- 再次监听或刷新工作区 MCP 配置；
- 创建空插件 MCP Supervisor；
- 重启或关闭父 MCP Client；
- 获得自己的 MCP 渐进披露 Controller 与 `tool_search`。

子代理释放顺序仍早于父 Session 插件 MCP Runtime，捕获的 Tool Binding 在子代理生命周期内由父 Session
连接支撑。子代理 dispose 只释放自己的 Session、Registry 和 Composition 资源。

## 6. 激活兼容

Workflow 使用 scope Profile，投影的 MCP Registration 按全 Coding Scope 正常激活。

Explorer 使用显式只读 Tool 名单。为保持 Legacy“内置只读工具 + 全部父 MCP 工具”的行为，创建子
Composition 时把捕获的 MCP 名称追加到 Explorer 的显式名单。即使父 Session 因超过阈值只向模型暴露
`tool_search`，Explorer 仍直接获得创建时的全部父 MCP Tool，不继承父级渐进披露状态。

插件 MCP 的 `agent_mode` 仍只控制父 Session 的模型调用视图。子代理继承的是 Legacy 等价的原始 Ready
Binding，因此父模式不可见的插件 MCP 仍可被子代理使用。本轮通过测试明确冻结该兼容事实，没有把策略调整
伪装成架构重构。

## 7. TypeBox / Zod 判断

本轮新增的是内部强类型只读 View 和 Composition 内部投影，没有新增 JSON、网络响应、配置文件或持久化
反序列化入口，因此不引入 TypeBox 或 Zod。MCP Tool 的输入 Schema 仍复用既有 Runtime-native MCP 转换。

## 8. 测试与验证

新增和更新的测试覆盖：

- Synchronizer 成功刷新、失败保留和 dispose 后的 Binding View；
- Legacy Explorer/Workflow 复用父 Tool 实例及逐次创建捕获；
- 16 个文件 MCP Tool 在父 Session 进入渐进披露时，Explorer 仍获得全部 Tool 且没有 `tool_search`；
- 父 `agent_mode` 隐藏的插件 MCP Tool 仍投影给 Workflow；
- Workflow 实际调用继承的插件 MCP Tool；
- 子代理不再次调用插件 MCP Runtime 工厂；
- 全程只创建一个插件 Client，父 Session dispose 时只关闭一次。

验证命令：

```text
runtime-mcp synchronizer: 1 file, 3 tests passed
coding-agent Legacy inheritance: 1 file, 2 tests passed
CLI Greenfield composition: 1 file, 14 tests passed
CLI plugin MCP session: 1 file, 3 tests passed
bun run check:quick: passed
bun run check: passed
```

首次完整类型检查发现新增 Legacy Fixture 的 `AgentToolResult` 缺少必需的 `details` 字段；测试 Fixture 按真实
合同补齐后重新通过，没有放宽生产类型。

## 9. 结果与下一步

Greenfield 子代理现在继承父 Session 的文件 MCP 与插件 MCP Tool Binding，而不继承连接管理权。Explorer、
Workflow、渐进披露、`agent_mode` 和释放时序均与已冻结的 Legacy 行为对齐。

下一阶段应审计 `McpManager` 剩余生产消费者，按“模型调用 Tool Source、MCP 状态/认证控制、Legacy Session
兼容 API”分类。先为状态查询、登录/登出、重启等宿主控制能力建立窄 Port，再判断哪些 Legacy Adapter 可以
停止从公开入口导出；Legacy Session 入口未退出前仍不删除 Manager。
