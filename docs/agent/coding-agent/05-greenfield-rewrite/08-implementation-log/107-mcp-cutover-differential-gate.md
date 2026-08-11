# 第 107 轮：MCP 新旧运行时切换差分门禁与迁移边界收口

## 1. 目标

第 106 轮完成 Greenfield 子代理 MCP Tool Binding 投影后，需要判断下一步是继续拆旧 `McpManager`，还是
验证 Runtime-native 路径已经具备替代条件。

本轮目标是：

1. 审计 `McpManager` 的真实生产消费者；
2. 建立 Legacy 与 Runtime-native MCP 的端到端差分门禁；
3. 只修复差分暴露的真实行为问题；
4. 明确模型数据面、宿主控制面和 Legacy 兼容面的迁移边界。

## 2. 消费者审计结论

审计确认：

- Greenfield CLI、Desktop 和 IM 已使用 Runtime-native 文件 MCP Source；
- Session-local 插件 MCP 使用独立 Runtime，不经过 `McpManager`；
- Greenfield 子代理继承父 Session Binding，不创建第二个 MCP Runtime；
- `LegacyMcpManagerRuntimeToolSource` 的仓库内消费者只剩兼容测试；
- `McpManager` 的生产依赖集中在待淘汰的旧 `AgentSession/RuntimeManager`；
- Desktop 配置和 OAuth 操作由宿主服务负责，不要求 Greenfield Session 暴露 Manager。

因此本轮没有继续重构旧 Manager，也没有为不存在的消费者新增控制 Port。旧 Manager 和 Legacy Adapter 仍是
公开兼容入口，在整体生产切换前保留。

## 3. 差分门禁

新增 `mcp-runtime-cutover-differential.test.ts`，使用两套独立但输入完全相同的 Config Source 与 Client Factory，
同时运行：

```text
Legacy
  McpManager
    -> AgentTool Adapter
    -> Legacy Runtime Tool Adapter

Runtime-native
  McpServerSupervisor
    -> McpServerRuntimeToolSource
    -> Coding Agent Runtime Tool Decorator
```

差分比较以下模型和宿主可观察行为：

- Ready、Error、Needs Auth、Disabled 状态；
- Tool discovery 失败时 Server 仍保持 Ready；
- Tool 名称、label、描述、完整 TypeBox Schema；
- Ecosystem Hook 的 serverName、originalName 和 kind；
- 文本、图片、Resource 成功内容及 details；
- MCP Tool 调用失败时的错误 content 与 details；
- 文件配置稳定项复用、新增、变更、删除；
- 配置加载失败时保留现有 Tool Surface 与 Client；
- Shutdown 的 Client 关闭集合。

`startedAt` 和 fingerprint 没有跨两套独立进程对象做值相等比较：它们是同步缓存身份，不是模型可观察合同。
既有 Adapter 测试继续验证同一个 Server Binding 下旧新 fingerprint 相等。

## 4. 差分结果

新增差分门禁首次运行即通过，没有发现需要修改生产实现的 MCP 功能差异。这与当前结构一致：Legacy Manager
和 Runtime-native Tool Source 已共享同一个 `McpServerSupervisor`、Schema 转换与 Tool 执行函数，差异只位于
产品协议适配方向。

插件动态替换、`agent_mode`、渐进披露、Prompt Tool Index、子代理投影和父 Session 生命周期所有权继续由
第 105、106 轮的 Composition 集成测试覆盖，没有在本轮复制第二套大型组合 Fixture。

## 5. 测试稳定性纠正

扩大运行 CLI MCP 测试时发现，Workflow 子会话在 Todo continuation 下可能发生两次以上模型调用。旧断言
`childMcpTools.length === 2` 把内部模型调用次数误当成了 MCP 行为合同，并会因轮询时序产生失败。

断言改为等待：

- 子会话至少完成 Tool Call 前后的模型调用；
- 继承的插件 MCP Tool 实际只调用一次。

仍保留以下关键断言：父模式不可见、子代理可见、插件 Runtime 工厂只调用一次、全程只有一个 Client、父
Session dispose 时 Client 只关闭一次。该修改没有改变生产行为，只移除了测试对非合同执行次数的依赖。

## 6. 迁移边界

本轮固定以下分类：

```text
模型数据面
  McpRuntimeToolSource / Synchronizer / Deferred Controller

宿主控制面
  Config / OAuth / Supervisor / Client / Transport

Legacy 兼容面
  McpManager / LegacyMcpManagerRuntimeToolSource / 旧 AgentSession API
```

Greenfield 生产代码不需要反向依赖 `McpManager`。旧公开入口只有在默认 Runtime、下游调用者和旧存储迁移全部
完成后才能删除。

## 7. TypeBox / Zod 判断

本轮没有新增外部 JSON、网络响应、配置或持久化反序列化入口，不新增 TypeBox/Zod Schema。差分测试直接
比较既有 TypeBox Tool Schema；配置和 OAuth 状态继续使用已有校验边界。

## 8. 验证

定向验证：

```text
coding-agent MCP/Legacy/Subagent: 5 files, 16 tests passed
runtime-mcp Supervisor/Synchronizer: 2 files, 7 tests passed
CLI Greenfield MCP Composition: 2 files, 17 tests passed
bun run check:quick: passed
bun run check: passed
```

完整检查包含 Biome、根 Monorepo `tsgo --noEmit`、CLI 显式 TypeScript 检查、Desktop `tsc --noEmit`、
Admin `tsc -b` 和全部质量守卫。新增测试进入根类型检查，没有只依赖 Vitest 转译。

## 9. 下一步

MCP 可以进入“Greenfield 迁移验证完成、Legacy 兼容入口待整体切换删除”状态。下一阶段应建立完整生产 Profile
与默认 Runtime 切换准备度门禁，比较 CLI、Desktop、RPC、IM 的最终 Model Call Frame、SessionEvent、
持久化、恢复和关闭行为，而不是继续整理旧 `McpManager` 内部结构。
