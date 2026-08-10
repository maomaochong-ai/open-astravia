# 分维度评审

## 评分矩阵

| 维度 | Vetta | Pi production | 评审结论 |
| --- | ---: | ---: | --- |
| 外部作者体验与生态一致性 | 3.0 | 4.5 | Pi 的主入口更统一、文档和示例更丰富；Vetta 机制更多但选择成本高 |
| 内部架构与包边界 | 4.5 | 3.0 | Vetta 的 `runtime-*`、port 和 composition 更利于长期演进 |
| 工具与运行时热变更 | 4.0 | 4.5 | Vetta Runtime 很强，但 Coding Extension 未完整暴露；Pi 已补齐 refresh/invalidation |
| Provider/模型扩展 | 3.5 | 4.5 | Pi 支持完整 Provider、动态注册/注销和请求链拦截；Vetta 合同较窄 |
| 资源与包分发 | 3.5 | 4.5 | Pi Package 的来源、更新和项目/全局配置更完整 |
| 多宿主与嵌入 | 4.5 | 3.5 | Vetta SDK/composition/RPC 更宿主无关；Pi remote protocol 仍是实验性 |
| UI 扩展 | 4.5 | 4.5 | Vetta 强在 Desktop，Pi 强在 TUI；两者都不是跨宿主 UI 合同 |
| 安全、权限与信任 | 3.5 | 2.5 | Vetta 有工具 sandbox 和 Plugin capability；Pi 有项目信任但无内建沙箱 |
| 会话、存储与恢复 | 4.0 | 3.5 | Vetta 已有版本化存储和 subagent 恢复；Pi Harness v2 目标更高但未交付 |
| 可观测性与可测试性 | 4.0 | 3.5 | Vetta port/边界利于隔离测试；Pi typed telemetry 更新更完整 |
| 合同治理与兼容 | 4.0 | 3.5 | Vetta 有窄 SDK、exports、Plugin API/capability schema；Pi 根 API 面较大 |

这些分数不能直接相加：例如“UI 扩展 4.5”在 Vetta 表示 Desktop 插件能力，在 Pi 表示终端 TUI 能力，覆盖的宿主不同。

## 1. 外部作者体验与生态一致性

Pi 的公开叙事简单：用 Extension 改行为，用 Skill/Prompt/Theme 提供资源，用 Pi Package 分发。Extension 文档和示例覆盖事件、工具、Provider、TUI、subagent、sandbox 等大量场景，开发者能从一个入口逐步扩展。

Vetta 的外部能力总量更大，但同一个目标可能出现多种路径。例如添加 Agent tool 可以走 Coding Extension、Desktop Plugin 的 `ctx.agent.registerTool`、Agent Plugin contribution、MCP 或 Runtime Feature。当前缺少一个全局 contribution catalog 来说明：

- 哪个宿主能看到该贡献；
- 谁拥有生命周期与 reload；
- 同名冲突如何解决；
- 权限和信任在哪一层判断；
- diagnostics 如何定位到来源。

因此 Vetta 的短板是治理和文档一致性，而不是扩展点数量。

## 2. 内部架构与包边界

Vetta 的包依赖方向和重写 charter 明确禁止下层反向依赖宿主。`coding-agent` 的运行时组合选项把各领域分开，SDK 主要暴露值对象和窄接口。MCP、工具、存储、subagent 都可以独立测试和替换。

Pi 生产 `coding-agent` 的 `core` 集中了较多职责，SDK 允许直接传入 `SessionManager`、`SettingsManager`、`ResourceLoader`。这使单产品定制方便，但把实现类变成了兼容面。Pi 新增的 `AgentSessionRuntime` 改善了 cwd-bound 服务和会话替换问题，仍未达到 Vetta 已经落地的包级分层。

Pi AgentHarness v2 的目标架构在 effect boundary、durable records、lane 和 deterministic drive 上可能超过两边现状，但现有关键方法仍会抛 `HarnessNotImplemented`，不能计入 production 分数。

## 3. 工具、事件与动态生命周期

Vetta 底层工具目录具有良好的版本语义：变更在下一次 model call 生效，执行时按当前 catalog 再解析，并防止旧调用落到同名新实现。MCP 同步和 Plugin contribution 也能动态读取。

Coding Extension 这一层却没有完全继承这些保证：

- `registerTool()` 先写 Extension 自己的 registry，post-bind 调用没有统一的下一轮刷新通知；
- `registerProvider()` 使用 pending registration 路径，缺少对称的 `unregisterProvider()`；
- 旧 `ExtensionContext` 没有 generation/stale guard；
- event bus subscription 与 reload teardown 的所有权不够显式；
- session replace 后缺少类似 Pi `withSession()` 的 fresh context 回调合同。

Pi current 已为这些问题增加 runtime active assertion、generation invalidation、subscription tracking、fresh replacement context、工具刷新和 Provider 动态目录。这里适合迁移语义和测试，不适合复制其 runner 结构。

当前事件面也已经分化：

| 类别 | Vetta current | Pi current | 含义 |
| --- | --- | --- | --- |
| 双方共有 | session start/before switch/before fork/compact/shutdown/tree、agent/turn/message/tool、model、input、resource discover | 同类事件 | 主 Agent loop 血缘仍然清晰 |
| Vetta 额外 | `session_switch`、`session_fork`、`tool_execution_phase` | Pi 用带 `reason` 的新 `session_start` 表达 replacement 结果，无 phase 事件 | Vetta 对宿主进度与工具阶段更友好 |
| Pi 额外 | — | `project_trust`、`session_info_changed`、`agent_settled`、`thinking_level_select`、`before_provider_request`、`before_provider_headers`、`after_provider_response` | Pi 在信任、最终静置、模型设置和 Provider 链上更完整 |
| 同名事件增强 | Vetta 的 start/shutdown/compact 信息较少 | Pi 增加 start/shutdown reason、previous/target session、compaction reason/`willRetry`、system prompt options | Pi 的生命周期原因更适合可靠 Extension |

这不是要求 Vetta 复制全部事件名称。更好的做法是先定义稳定状态机和宿主消费场景，再决定用事件、只读 snapshot 还是专门 port 表达；Provider 请求尤其不应默认暴露给所有 Extension。

## 4. Tool 与 Provider 合同表达力

Vetta Coding Extension 的 ToolDefinition 已覆盖 TypeBox parameters、执行、scope/category/requirements 和基础 call/result renderer。Pi current 还增加了：

- `promptSnippet` / `promptGuidelines`；
- `prepareArguments`；
- constrained sampling；
- per-tool sequential/parallel execution mode；
- shell/renderer 状态与 `defineTool` 辅助函数。

其中 prompt contribution、argument preparation、execution mode 值得进入 Vetta 的宿主无关 tool contract；TUI renderer state 不应进入 `runtime-tools` 核心。

Provider 方面，Pi 可注册完整原生 `Provider`，支持注销、动态 model catalog 更新，以及 request/headers/response 拦截。Vetta Extension 当前以 Provider 配置为主，底层模型注册能力并未形成等价的外部生命周期合同。Vetta 若采纳拦截，应把认证 header、可变 payload 和审计边界设计为独立 port，避免任意 Extension 默认读取敏感信息。

Context 也体现了产品方向差异。Pi current 额外暴露 mode、scoped models、thinking level、abort signal、project trust、system prompt options 和 fresh session replacement；Vetta 则增加 ecosystem permission request 等产品适配。Pi UI context 还扩展 working/indicator、autocomplete 和 editor component 查询。Vetta 不应机械追平字段，而应先把“所有宿主都成立的状态”与“TUI/Desktop 专属能力”拆开。

## 5. 资源、包与来源治理

Vetta 的 `SessionResourceRuntime` 把 settings、command、registry 等依赖分成窄 port，并支持动态 skill/extension source 的 revision 与显式 refresh boundary；这是很好的内部设计。

Pi current 的外部治理更成熟：结构化 `sourceInfo` 附着在 tool/skill/prompt/command 上，package manager 支持更稳健的 install/update/reconcile、固定版本处理、私有临时目录、安全 git path 和项目/全局配置。来源信息跟随对象而不是只放在旁路 map 中，更利于 UI、RPC 和诊断统一展示。

Vetta 应保留现有资源组合，补齐统一来源模型和安装事务。历史兼容可继续读取 Pi 风格 manifest 字段，但长期应提供带版本的 Vetta manifest，不宜让 `pi` key 成为新合同。

## 6. 多宿主、SDK 与远程协议

Vetta 的公开 SDK 支持 memory/file create/resume、动态资源 source、custom tools、MCP、subagent、background task、memory、question service、tracer、plugin 等能力；同时有 multi-session host 和产品组合入口。这些合同总体比 Pi 的终端中心 SDK 更适合 Desktop、CLI、IM 和嵌入式调用。

Vetta RPC 是逐行 JSON、单进程单活动会话，已由 Desktop/IM 等宿主消费。Pi current 新增的 remote protocol 使用严格版本化的 framed CBOR、transport-neutral client、lease/ownership 与 authoritative snapshot，协议边界更明确，但文档将其标为 experimental，尚无稳定兼容保证。

可采纳的是协议原则：显式版本、快照与增量边界、所有权、未知字段策略和恢复模型。没有必要为了这些原则替换 Vetta 已在生产使用的 RPC；更合理的是版本化演进或增加兼容 transport。

## 7. UI 扩展

Vetta Desktop Plugin 在 UI slots、file explorer、conversation card、app action、media、settings、i18n 和权限 SDK 上覆盖面广，适合 GUI 产品。Pi Extension 可以替换 editor、header/footer、渲染器、autocomplete 和状态组件，适合 TUI 产品。

Vetta Coding Extension 继续公开 TUI concrete types 会制造第三套 UI 预期。建议把核心 Extension 的 UI 降为宿主能力探测和结构化 request/response；具体 Desktop UI 走 Plugin SDK，若 CLI 仍需要 TUI 扩展，则通过单独的 TUI subpath 暴露。

## 8. 安全、权限与信任

Vetta 的优势：

- Agent 工具执行有 sandbox/full-access 模式和授权流程；
- Desktop Plugin manifest 声明权限，capability session 采用精确 grant 和审计；
- MCP 有独立进程/网络协议边界和 supervisor。

Vetta 的缺口：Coding Extension 与 package 本质上是当前进程中的受信代码，尚未发现 Pi current 那样在加载项目本地设置、包和 Extension 前统一执行的 project trust gate。Desktop Plugin 同 realm 也不是安全沙箱。

Pi 的优势是 project trust 明确阻止未批准项目目录影响加载；缺点是批准后的 Extension/Package 仍拥有用户进程权限，Pi 也明确依赖 OS/container/microVM 获得真正隔离。因此两边都不能把“权限 UI”或“项目确认”描述为代码沙箱。

## 9. 会话、持久化与恢复

Vetta 已落地版本化 conversation repository、旧格式只读导入、原子 snapshot、session host 和 subagent scheduler recovery，生产可用性更完整。

Pi production 有成熟 session tree 和 replacement runtime；AgentHarness v2 进一步设计 append-only tree、named parallel lanes、global facts、single writer、crash recovery、atomic snapshot + live events，但其 run/drive 主路径尚未实现。Vetta 可以跟踪其 record/effect 测试方法，不能以未来设计为理由引入第二条并行 Agent loop。

## 10. 可观测性、测试与兼容

Vetta 的 port、composition 和 package boundary guard 使差分测试、contract test 和 host fake 更容易组织；Plugin API version、capability schema 与 package exports 也提供了明确治理入口。当前 `runtime-telemetry` 仍偏最小，事件 schema 的跨宿主一致性需要加强。

Pi current 已把 telemetry 拆为 vendor-neutral typed schema，并让 agent 拥有 AI request/harness schema；加上 sourceInfo 和 delta-only RPC 更新，诊断链更完整。另一方面，Pi 较大的 Extension/SDK 根 API 和频繁扩展会扩大兼容负担，experimental protocol 也明确不保证稳定。

## 综合判断

- 若目标是“第三方快速把 Pi 终端改造成另一种工作流”，Pi 当前更强。
- 若目标是“一个 Agent 平台服务 Desktop、CLI、IM、SDK，并允许替换运行时部件”，Vetta 更强。
- Vetta 最优路线是补齐 Pi 已验证的生命周期与治理细节，同时维持自己的分层，而不是把所有扩展能力收回一个全能 Extension API。
