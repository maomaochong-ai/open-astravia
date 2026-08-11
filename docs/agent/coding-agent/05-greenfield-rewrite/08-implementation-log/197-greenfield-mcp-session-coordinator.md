# 第 197 阶段：Greenfield MCP Session Coordinator

## 阶段目标

第 196 阶段完成了 Composition 资源所有权与关闭事务边界，但主 `greenfield-runtime-composition.ts` 仍直接实现共享 MCP、Session Plugin MCP、渐进披露控制器、Prompt 刷新观察事件和 Subagent MCP 继承的协调算法。

本阶段只移动 MCP 会话协调职责，不修改 MCP 协议、配置来源、Tool 注册合同、动态增删语义、Plugin 隔离、渐进披露或宿主公开 API。

## 实施前问题

主 Composition Root 同时负责：

- 创建并首次刷新共享 `McpRuntimeToolSynchronizer`；
- 为每个 Session 创建 `McpDeferredToolController`；
- 合并共享 MCP 与 Session Plugin MCP 的 snapshot；
- 在 Prompt 边界刷新 MCP，并发送 `mcp.reload.start/end` 观察事件；
- 用 marker 避免同一次 Prompt 边界与模型调用重复刷新；
- 合并共享与 Plugin MCP view，投影给 Subagent；
- 在初始化失败和 Composition 关闭时释放共享 synchronizer。

这些逻辑分别散落在 Tool runtime 回调、Session 初始化、Lifecycle Assembly 接线、Subagent 装配和 Composition shutdown 接线中。Root 不只是选择实现，还拥有一套完整的 MCP Session 状态机。

## 边界判断

MCP wire protocol、transport、动态 Tool source 与通用 synchronizer 继续属于 `@vetta/runtime-mcp`。

新增 Coordinator 属于 Coding Agent Composition 层，因为它组合的是产品级策略：

- Coding Agent 的 Tool activation；
- Session Plugin MCP runtime；
- Session resource indexes 与 refresh markers；
- Runtime observation 合同；
- Subagent 继承策略。

它依赖 `McpRuntimeToolRegistry`、`McpRuntimeToolSource` 和 Session index 端口，不依赖具体 Coding Tools Registry 实现，也不解析 MCP wire payload。

## 实施过程

### 1. 建立 MCP Session Coordinator

新增：

`packages/coding-agent/src/composition/greenfield-mcp-session-coordinator.ts`

Coordinator 现在统一负责：

- 共享 MCP synchronizer 的创建、首次同步与失败回滚；
- 基于 Session activation 创建渐进披露控制器；
- 共享 snapshot 与 Plugin snapshot 合并，Plugin 同名 Tool 保持覆盖优先；
- Prompt 边界刷新、变化判断、观察事件和一次刷新复用 marker；
- 模型调用前 Catalog refresh；
- 共享与 Plugin MCP view 合并后提供给 Subagent；
- Composition 关闭时释放共享 synchronizer。

snapshot revision 仍按原实现相加，合并顺序、冻结对象和空 view 语义没有改变。

### 2. 收窄主 Composition Root

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition.ts`

主入口现在只：

- 将 MCP source、Tool registry 端口与 Resource Registry indexes 注入 Coordinator；
- 在 Session 初始化时请求一个 Session controller，并登记其生命周期；
- 将 Coordinator 的 refresh 端口接入 Tool runtime 与 Session Lifecycle Assembly；
- 将继承 view 端口接入 Subagent Assembly；
- 将 Coordinator dispose 接入 Composition Shutdown。

主文件删除了 synchronizer/controller 创建细节、Prompt refresh 状态机和 snapshot/view merge helpers，由 1041 行降为 953 行。

### 3. 增加 Coordinator 合同测试

新增：

`packages/coding-agent/test/runtime-core/greenfield-mcp-session-coordinator.test.ts`

覆盖：

- 共享与 Plugin snapshot/view 的合并顺序及同名覆盖；
- Session controller 的初始渐进披露状态；
- Subagent 继承完整 MCP view；
- Prompt 首次刷新观察事件与变化上报；
- Prompt 刷新结果只复用一次，后续模型调用继续动态刷新；
- refresh 失败的观察事件和错误透传；
- 首次同步部分注册失败时撤销已注册 Tool。

### 4. 增加架构守卫

修改：

- `scripts/quality/check-package-boundaries.mjs`
- `scripts/quality/quality-gates.test.mjs`

守卫禁止主 Composition Root 重新直接拥有：

- MCP synchronizer 和 deferred controller 的创建；
- snapshot/view merge helpers；
- MCP refresh 观察事件文案与策略。

Root 仍允许导入并组合 `createGreenfieldMcpSessionCoordinator`。

## 功能兼容性核对

- MCP Tool 仍在每次需要的模型调用前动态同步，运行时增删不需要重建 Session；
- Prompt 边界完成的 refresh 仍只供紧随其后的 Catalog refresh 复用一次；
- Plugin MCP 仍按 Session 隔离，并覆盖共享 MCP 中的同名 Tool；
- explicit activation 仍保持 eager，其他 activation 仍使用原有 deferred 策略；
- Subagent 仍继承父 Session 当前完整 MCP binding，不创建第二个 Plugin runtime；
- 初始化失败仍撤销部分 Tool 注册并关闭 MCP stdio 进程；
- Composition shutdown 的阶段、失败重试和对外错误合同未修改；
- 没有修改 Tool 描述、Tool option、Prompt、Skill、Conversation 或宿主 API。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。Coordinator 接收的都是进程内、已类型化的 runtime 端口和对象；MCP 外部配置与 wire payload 的校验仍由既有边界负责。在这里再次校验只会重复协议层职责。

## 验证结果

Coding Agent 定向合同：

```text
4 files passed
8 tests passed
```

CLI Composition 与 MCP 回归：

```text
3 files passed
19 tests passed
```

真实 Vetta RPC CLI 初始化失败回归：

```text
1 file passed
2 tests passed
```

质量守卫：

```text
1 file passed
45 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2072 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

## 阶段结论

MCP 的通用协议与同步机制仍位于 `runtime-mcp`，Coding Agent 特有的 Session 协调策略现在由独立 Coordinator 管理。主 Composition Root 只保留实现选择、端口适配和生命周期接线，不再实现 MCP Session 状态机。

下一阶段应先审计 Root 剩余的 Session 初始化代码，优先寻找同时具备独立输入输出合同、明确 rollback 资源和现有可执行基线的初始化事务。不要仅按文件行数继续拆分，也不要把所有初始化机械搬进新的大 Assembly。
