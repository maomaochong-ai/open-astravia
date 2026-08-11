# 第 105 轮：Session-local Plugin MCP Runtime 与 Greenfield 动态贡献闭环

## 1. 目标

第 104 轮完成 Greenfield 文件 MCP 的 Runtime-native 切换，但插件贡献仍只在 Legacy Session 中通过
`McpManager.setPluginServers()` 生效。不能直接把该方法接到第 104 轮的 Source：Desktop 的文件 MCP Source
按工作区 Composition 共享，而插件配置属于 Session 级动态状态。直接修改共享 Supervisor 会造成同工作区
会话相互覆盖。

本轮目标是保持以下所有权：

```text
Workspace Composition -> 共享文件 MCP Source / Client
Session A             -> 独立插件 MCP Supervisor / Source / Tool View
Session B             -> 独立插件 MCP Supervisor / Source / Tool View
```

只重构能力归属和组合方式，不修改 MCP Tool 协议、插件配置格式或宿主热更新时机。

## 2. Legacy 行为基线

实施前运行既有 Manager 与插件命名测试，共 14 项通过，冻结：

- 插件集合顺序无关；
- 配置相同时不重启 Client；
- 单项修改只重连对应 Server；
- 删除 Server 会关闭其 Client；
- 完整 reload 后保留插件集合；
- runtimeName 标准化与无下划线约束；
- fingerprint 随真实配置变化而变化。

Legacy 的插件 `agent_mode` 不进入 Server fingerprint；模式变化通过重建调用级工具表生效。本轮保持这一
边界：纯模式变化不重连 MCP Client，但会更新 Session 的模型调用工具选择。

## 3. Runtime 动态控制 Source

`runtime-mcp/src/tools/dynamic-server-runtime-tool-source.ts` 新增窄合同：

```ts
interface McpDynamicRuntimeToolSource extends McpRuntimeToolSource {
  replaceDynamicServers(next: McpDynamicServerSet): Promise<boolean>;
}
```

它只暴露“完整替换动态集合”和“刷新 Tool View”，不暴露 Supervisor 的 initialize、restart、状态 Map 或
其他生命周期实现。Tool 物化继续委托第 104 轮的 `McpServerRuntimeToolSource`，避免形成第二套名称、Schema、
结果和 fingerprint 逻辑。

`runtime-mcp` 不导入 Coding Agent，也不知道 pluginId、agent_mode、Desktop 或 Session。

## 4. Coding 产品 Session-local Runtime

新增 `CodingAgentPluginMcpRuntime`，每个 Greenfield Session 持有一份。它负责：

- 使用空文件配置 Source 创建“仅动态 Server”的 Supervisor；
- 复用 Coding 产品 MCP Client、agentDir、OAuth Provider 和 diagnostic 策略；
- 将 `mcpServerContributions` 转成 `McpDynamicServerSet`；
- 校验 runtimeName，复用既有无序 fingerprint；
- 保存 Server 的 `agent_mode`，但不把模式变化误判为 Client 配置变化；
- 将 Tool 保存在 Session 私有 Map，不写入共享 Coding Tool Registry；
- 添加与文件 MCP 相同的 `ecosystemHook` 来源元数据；
- Session dispose 时只关闭该 Session 的插件 MCP Client。

工具合并顺序调整为：

```text
共享 Registry / 文件 MCP
  -> Session 插件 MCP
  -> Session 普通 Plugin Tool 与 Tool Policy
  -> Plugin Run effects
  -> Ecosystem Hook wrapper
```

因此插件 MCP 能保持 Legacy 中晚于普通插件 Tool 的同名优先级，同时 allow/deny Policy 仍能作用于最终
工具表。

## 5. Greenfield Session 接入

`GreenfieldRuntimeCompositionOptions` 新增 Session 工厂，而不是接收一个共享插件 MCP 实例。Session 创建时：

1. 解析该 Session 当前的 Plugin Runtime Config；
2. 创建独立 `CodingAgentPluginMcpRuntime`；
3. 应用初始插件 Server 完整集合；
4. 将其 snapshot 与共享文件 MCP snapshot 合并；
5. 使用同一个 Session `McpDeferredToolController` 决定可见 Tool 与 `tool_search`；
6. 在模型调用 Composer 中把 Session 私有 Tool 合入当前 Frame。

`reconfigureAgentPlugins()` 现在先等待插件 MCP 重配置，成功后才提交新的 Session 配置事实源。若重配置抛错，
旧插件配置继续生效，RuntimeHost 仍按既有 pending 机制在下一 Turn 重试。Server 自身启动失败仍由
Supervisor 隔离为 error/needs_auth，不阻断其他 Server 或整个 Session。

Conversation continue 时 Session-local MCP 所有权随 Session ID 重绑定；Session dispose、创建失败和整个
Composition dispose 都会释放对应 Runtime。

## 6. CLI 与 Desktop 生产接线

CLI Greenfield IM Host 和 Desktop 主进程均注入产品级 Session MCP 工厂：

- CLI 复用 Bootstrap 的 agentDir 与 MCP debug 设置；
- Desktop 为每个 Session Runtime 复用当前工作区的 agentDir 与 SettingsManager；
- 文件 MCP 仍由原工作区 Source 负责，没有因插件功能复制静态 MCP Client；
- 旧 Legacy Session 继续使用 `McpManager`，公开兼容 Adapter 未删除。

## 7. 渐进披露与动态语义

共享文件 MCP 与 Session 插件 MCP 的 descriptor 在调用前按名称确定性合并；插件同名项覆盖共享项，但
保留已有 Map 位置。合并结果进入现有渐进披露 Controller：

- 总数不超过阈值时插件 MCP Tool 直接进入模型调用；
- 超过阈值时统一只暴露 `tool_search` 和 MCP 轻量索引；
- 插件 Server 删除后，其 Tool 和空集合下的 `tool_search` 在下一模型调用消失；
- Tool Search 的已激活名称仍只属于当前 Session；
- `agent_mode` 未设置时不过滤，设置后只影响当前 Session 的 Tool Frame，不重连 Client。

本轮没有引入 Turn 级全量快照，也没有把插件 MCP 写入共享 Registry。刷新仍是当前能力视图的增量同步。

## 8. TypeBox / Zod 判断

本轮新增的是内部强类型动态控制合同，外部插件清单已经由宿主解析为 `AgentPluginRuntimeConfig`；没有新增
JSON、网络响应或持久化反序列化入口，因此不需要再次引入 TypeBox 或 Zod。

MCP Server 返回的 Tool `inputSchema` 继续通过第 104 轮共享的 TypeBox 转换函数处理，没有复制 Schema
实现，也没有添加 `any` 或内联类型 import。

## 9. 测试与验证

```text
实施前 Legacy Manager/插件命名基线：2 files, 14 tests passed
Runtime 动态 Source 独立测试：1 file, 2 tests passed
runtime-mcp 完整套件：11 files, 38 tests passed
Coding MCP/Composer/Plugin 定向套件：7 files, 29 tests passed
CLI Session/Composition/Host 定向套件：5 files, 24 tests passed
Desktop Backend Pool/Host Capability：2 files, 8 tests passed
bun run check:quick: passed
bun run check: passed
installed standalone Vetta CLI artifact: 1 test passed
```

新增门禁覆盖：

- 两个 Session 使用不同插件 Server，Tool 和 Client 生命周期互不泄漏；
- 重配一个 Session 时另一个 Session 的 Server 不关闭；
- 相同配置零重连、纯 agent_mode 变化零重连、真实配置变化差量重连；
- 插件 MCP 覆盖同名基础 Tool；
- `ecosystemHook`、执行结果和 agent_mode 过滤；
- 16 个插件 MCP Tool 进入渐进披露，集合删除后 `tool_search` 消失；
- MCP 重配置失败时不提交新的 Session 插件配置；
- Session dispose 只关闭自身插件 Client。

## 10. 实施过程中的修正

- 第一次完整类型检查发现测试直接读取 stdio/http 联合类型的 `command`；改为显式判别 `type`，没有放宽
  `McpServerConfig`；
- 第二次完整类型检查发现测试流把包含 error/aborted 的通用 StopReason 直接写入 done 事件；按真实事件
  合同拆分 error 与 done 后通过；
- `check:quick` 初次发现的格式与 import 排序问题只对本轮文件执行 Biome 修复；最终快速检查和完整检查
  均通过。

## 11. 结果与下一步

Greenfield 的插件 MCP 已达到根 Session 动态增加、替换、删除、模式过滤、渐进披露和释放隔离闭环。共享
文件 MCP 与 Session 插件 MCP 的所有权不再混淆，插件热更新不会污染同工作区的其他 Session。

下一步不应立即删除 `McpManager`：Legacy Session 的系统提示词、AgentSession API 和子代理父工具继承仍依赖
它。下一阶段应冻结 Legacy `getParentMcpTools` 行为，设计 Greenfield 子代理的显式能力继承合同，并验证父
Session 的文件 MCP、插件 MCP、显式工具选择和 agent_mode 如何投影到子 Session。完成该差分后，再审计
Legacy Adapter 的外部导出使用情况；在 Legacy Session 入口退出前只标记迁移状态，不删除实现。
