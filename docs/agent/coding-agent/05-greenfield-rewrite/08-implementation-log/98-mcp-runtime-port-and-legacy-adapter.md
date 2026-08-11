# 第 98 轮：MCP Runtime 独立端口与旧实现适配

## 1. 目标

第 97 轮已经证明 Desktop 可以在真实进程重启后重新装配 MCP，但当时
`@vetta/runtime-mcp` 仍只是 `coding-agent/core/mcp` 的反向导出：

- Runtime MCP 的 Source 类型直接 `Pick<McpManager>`；
- 渐进披露、Prompt 和 `tool_search` 仍反向导入 coding-agent；
- Desktop 与 Greenfield IM Host 直接创建和持有 `McpManager`；
- 包名表达的是独立 Runtime Feature，实际依赖方向却相反。

本轮目标是建立真正独立的 MCP Runtime 边界，并继续复用旧 MCP 实现。范围只包含架构重构，
不得改变 MCP 配置、连接、鉴权、工具名称、参数、执行结果、动态增删和渐进披露行为。

## 2. 最终依赖边界

```text
runtime-mcp -> runtime-core

coding-agent legacy adapter
  -> runtime-mcp port
  -> coding-agent/core/mcp (旧具体实现)

runtime-composition
  -> runtime-mcp synchronizer
  -> runtime-tools registry

Desktop / Greenfield IM Host
  -> coding-agent legacy adapter factory
```

`runtime-mcp/src` 不再导入、继承或 re-export coding-agent。仓库质量守卫会拒绝该方向重新出现。

## 3. 实施内容

### 3.1 独立 Source Port

`McpRuntimeToolSource` 现在只暴露：

```ts
refresh(): Promise<McpRuntimeToolView>
```

视图中的每一项包含原生 `RuntimeToolDefinition` 和 fingerprint。Runtime 不知道 Source 背后是
本地配置、远程发现、具体 SDK，还是旧 `McpManager`。

这里的视图不是会话持久化快照，也不冻结运行时能力。每次模型调用前仍会刷新当前事实；用户删除
本地配置、移除工具或 MCP server 重连都会在下一次刷新生效。

### 3.2 增量同步而非整体重建

同步器先取得本轮完整视图，再按名称与 fingerprint 计算变化：

- 删除的工具从 Registry 注销；
- fingerprint 变化的工具只替换对应 binding；
- 未变化的工具保留原 binding；
- 工具名称或描述未变化时，不增加 descriptor revision；
- Source 刷新失败时，在变更 Registry 前失败，保留上一轮工具集合。

因此，小范围变化不会重建 Runtime、Session 或整个工具集合。会话级渐进披露状态仍由
`McpDeferredToolController` 独立维护。

### 3.3 Runtime 原生渐进披露

以下行为移入 `runtime-mcp`，实现只依赖 Runtime 合同：

- MCP 工具关键词评分和排序；
- 普通/延迟 MCP Prompt 渲染；
- TypeBox `tool_search` 输入 Schema；
- `max_results` 限制、激活结果和模型可见文本；
- session-local 已激活工具集合。

新增旧新差分测试，逐项比较评分、Prompt、Schema 和执行结果。旧 coding-agent 实现继续保留，
用于兼容路径和迁移基线。

### 3.4 coding-agent 旧实现适配器

coding-agent 新增 `LegacyMcpManagerRuntimeToolSource`：

1. 调用既有 `reloadIfChanged()`；
2. 读取既有 server 和 `AgentTool`；
3. 复用原工具执行适配器转换为 `RuntimeToolDefinition`；
4. 使用 server 名、状态、启动时间和工具定义生成与旧逻辑等价的 fingerprint；
5. 通过 managed source factory 统一初始化和释放真实 `McpManager`。

Desktop 与 Greenfield IM Host 不再把 `McpManager` 直接交给 Runtime Composition。它们只持有
`ManagedMcpRuntimeToolSource`，并在各自生命周期终点调用 `dispose()`。

### 3.5 Composition、构建与测试闭包

`runtime-composition` 把原生 MCP Runtime Tool 注册为现有 Coding Tool Registration，继续使用
全部场景 scope 和 `external` category。该映射只位于 Composition Root，Runtime MCP 不依赖
runtime-tools 的注册元数据。

构建顺序调整为：

```text
runtime-core -> runtime-mcp -> coding-agent
  -> runtime-tools/runtime-storage -> runtime-composition -> apps
```

根测试选择器、TypeScript include、Desktop workspace prerequisites、Vitest 源码 alias 和独立产物
闭包同步更新。CLI Composition 测试也显式指向 runtime-composition 源码，避免误测旧 `dist`。

## 4. 明确未修改

- 未修改 `mcp.json` 格式、配置合并、文件监听和 reload 判定；
- 未修改 stdio、HTTP、OAuth、MCP SDK 或服务端连接实现；
- 未修改 MCP 工具命名、参数 Schema、描述、调用结果和错误语义；
- 未修改延迟披露阈值、关键词评分权重、激活范围和 Prompt 文案；
- 未修改 Session 持久化格式、事件、锁和恢复行为；
- 未删除 `coding-agent/core/mcp` 或 Legacy 路径；
- 未把 Desktop/CLI 产品配置解析放进 `runtime-mcp`。

## 5. 测试与验证

独立 Runtime MCP 测试：

```text
2 files passed
6 tests passed
```

覆盖增量新增/删除、未变化 binding 保留、fingerprint 替换、刷新失败保持、并发刷新去重、释放、
评分、Prompt、TypeBox Schema 和 `tool_search` 结果。

coding-agent 旧新差分测试：

```text
1 file passed
2 tests passed
```

CLI Composition、Greenfield IM Host 与 Desktop Backend Pool：

```text
greenfield-runtime-composition: 13 tests passed
greenfield-im-runtime-host: 3 tests passed
desktop-greenfield-runtime-backend-pool: 6 tests passed
```

质量守卫：

```text
quality-gates: 29 tests passed
bun run check:quick: 通过
bun run check: 通过
```

完整检查包含 Biome、monorepo tsgo、CLI 独立 tsgo、Desktop tsc、Admin tsc、构建顺序、包边界和
独立 CLI 构建守卫。

安装态与真实宿主验证：

```text
installed standalone CLI artifact: 1 test passed
Desktop Greenfield Runtime Canary: 通过
provider requests: 10
desktopExitCodes: [0, 0]
restartCount: 1
endpointRemoved: true
sessionLocksReleased: true
providerStopped: true
```

真实 Provider 请求的工具合同持续包含 `mcp_runtime_canary_echo`，并覆盖首次会话、继续、
ask-user、Scheduler、Batch、进程重启、会话恢复和重启后的 MCP Tool Loop。

## 6. 结论与下一步

本轮把“Runtime 使用什么 MCP 能力”与“旧 coding-agent 如何连接 MCP server”分开了。
`runtime-mcp` 已经是独立 Feature，而 `McpManager` 只是暂时位于 coding-agent 的一个具体适配器。

下一阶段应先冻结 `coding-agent/core/mcp` 的配置发现、stdio/HTTP/OAuth、重连、错误和释放行为，
再把具体 MCP client/manager 实现迁到独立基础设施边界。配置解析仍应由配置 Source 或宿主适配器
负责，不应进入 Runtime Core；完成差分门禁前不删除旧实现，也不借迁移修改 MCP 功能。
