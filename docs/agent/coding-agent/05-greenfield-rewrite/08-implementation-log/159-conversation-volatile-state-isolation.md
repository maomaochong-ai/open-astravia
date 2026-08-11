# 159：Conversation 易失状态隔离

## 目标

第 158 阶段已经让后台 Bash、Subagent 与 Todo 资源随 Session identity 轮换，但 Legacy `AgentSession` 仍会让多个 Conversation
复用同一组长生命周期 Controller 和 Runtime。Controller 内的在途操作、缓存和学习态若不显式归属，会把源会话的 MCP 激活、Plugin
幂等状态、压缩预测或事件缓存带入目标会话。

本阶段把这些状态按所有权分为两类：

- 工作区配置态继续复用，包括 Runtime、MCP 客户端、Extension/Skill/Tool 注册及宿主显式工具配置；
- Conversation 易失态在 `newSession`、`switchSession` 和 `fork` 的 identity 边界静默并重置。

目标是修复跨会话污染，不改变 Tool、MCP、Plugin、压缩或 Todo 的业务功能。

## 基线结论

- deferred MCP 的按需激活集合保存在 `RuntimeManager`，旧会话通过 `tool_search` 激活的工具会继续出现在新会话。
- Plugin system prompt 的 run index、continuation 幂等键、待执行 effect 和 continuation 请求均跨 identity 保留。
- 直接 Bash 不属于后台任务管理器；切换时只中止 Agent，命令可能在目标会话建立后才把结果写入当前 Session。
- Compaction Controller 持有手动/自动压缩、prefire 单飞、prefire 缓存、熔断状态和延迟 continuation timer；原切换流程不会等待或清理它们。
- EventRouter 的最后一条 assistant 缓存与 turn index、InputPipeline 的 Todo nudge signature 都属于当前 Conversation，而非工作区 Runtime。

## 实施内容

### Runtime 配置态与会话激活态分离

`RuntimeManager` 现在分别持有“宿主配置的工具基线”和“当前 Conversation 通过 deferred MCP 临时激活的覆盖层”。有效工具集合由二者合并：

- `setActiveToolsByName()` 表示宿主的显式配置，更新基线并清空旧 deferred 覆盖；
- `tool_search` 只增加当前 Conversation 的 MCP 激活覆盖，不反向污染宿主基线；
- MCP 重载、插件重配和 Runtime 重建均从配置基线恢复，再叠加当前 Conversation 的有效激活；
- identity 激活时清空 MCP 覆盖、Plugin run/effect/continuation 易失状态，并按原配置重新物化工具与基础系统提示词。

MCP Manager、连接、工具注册表和 Extension Runner 不会因为会话切换而重建。

### 在途操作静默点

identity 提交前新增两类可等待静默：

- 直接 Bash：中止当前命令、等待执行 Promise 结束，并在 SessionManager 改变身份前把待写结果落入源会话；
- 压缩：中止并等待手动压缩、自动压缩和 prefire，清除 continuation timer、prefire 缓存、熔断失败计数及日志抑制状态。

压缩 continuation timer 由 Controller 显式持有，切换或关闭时统一取消。手动压缩在中止后仍执行原有 reconnect 清理，因此最终关闭流程会再次断开 Agent，确保释放顺序闭合。

### 轻量 Controller 状态重置

新 identity 激活时额外执行：

- EventRouter 清除最后 assistant 消息和 turn index；
- InputPipeline 清除 Todo continuation nudge signature；
- Compaction Controller 重新开放当前 identity 的压缩入口；
- RuntimeManager 清除 Plugin 和 deferred MCP 的 Conversation 状态。

这些动作只重置已有 Controller 的局部字段，没有增加通用 Snapshot、Resource Registry 或重建整个 AgentSession。

## 所有权结果

| 状态 | 所有权 | identity 切换行为 |
| --- | --- | --- |
| MCP 客户端、Extension/Skill/Tool 注册 | 工作区 Runtime | 保留实例 |
| 宿主显式 active tool 配置 | 工作区/宿主配置 | 保留 |
| deferred MCP 激活集合 | Conversation | 清空 |
| Plugin run index、幂等键、pending effect | Conversation | 清空 |
| 直接 Bash、压缩、prefire、续轮 timer | Conversation 在途操作 | 中止并等待 |
| prefire 缓存、压缩熔断 | Conversation | 清空 |
| EventRouter assistant/turn 缓存 | Conversation | 清空 |
| Todo nudge signature | Conversation | 清空后按目标 Todo 重新判断 |

## 明确未修改

- 未改变任何 Tool 名称、描述、Schema、结果格式或默认激活策略；
- 未改变 MCP 配置、连接、OAuth、搜索打分或工具执行逻辑；
- 未改变 Plugin system prompt、continuation 和 effect 的业务规则，只重置其 Conversation 所有权状态；
- 未改变压缩阈值、摘要算法、prefire 算法、熔断参数或 rollover 行为；
- 未改变 Session JSONL、RPC Frame、Greenfield Runtime 或 Provider 合同；
- 本阶段没有新增不可信配置/协议解析边界，生产代码无需引入 TypeBox/Zod；测试中的假 MCP Tool 使用 TypeBox 构造既有 `AgentTool` Schema。

## 测试

- Identity 集成测试共 7 项：覆盖 Extension 取消、资源轮换、直接 Bash 源会话归属、deferred MCP 清理且宿主工具配置保留、Plugin
  run/effect/continuation 重置、EventRouter 缓存清理，以及 Todo nudge 在 switch/fork 后重新计算。
- Compaction prefire 共 11 项：新增可等待 quiesce 门禁，验证 abort、Promise drain、timer 取消、cache/circuit/log 状态重置。
- Auto-compaction queue：修正已失效的空模型目录夹具，验证压缩后 agent-level 队列仍通过受 Controller 持有的 timer 继续一次。
- Coding Agent 相关回归共 45 项通过：identity、compaction、close、Runtime close、Bash block-until、tool search 和 Plugin MCP。
- CLI 活动会话切换 Legacy/Greenfield 差分 3 项通过；Greenfield deferred MCP Session-local 门禁 1 项通过。
- `bun run check:quick`、根目录 `bun run check` 和 diff 检查结果在本轮最终验证后登记。

## 结果

Legacy `AgentSession` 现在形成三层所有权：进程/工作区 Runtime、Session identity 资源、Conversation 易失状态。会话切换只静默和重置后两层中属于旧 identity 的部分，保留工作区级能力与宿主配置。由此既阻止跨会话泄漏，也避免通过重建 Runtime 造成 MCP、Skill、Extension 或 Tool 功能变化。

## 下一步

下一阶段应把 Session identity 替换提升为显式事务，审计 quiesce、SessionManager 身份提交、目标资源激活和 after hook 任一步骤失败时的状态。重点是定义失败后的可用身份、回滚边界和并发命令准入，避免当前 fail-closed 路径留下已静默但未重新激活的旧 Session；仍不应引入通用事务框架或改变会话业务功能。
