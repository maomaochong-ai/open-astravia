# 第 57 轮：会话级动态能力源与功能等价适配

## 目标

本轮不增加新的业务能力，也不切换默认 Legacy 入口。目标是把第 56 轮留下的动态能力端口接到真实旧实现，同时保持以下边界：

1. `runtime-core` 只持有通用 Session、Prompt、Context 和 Model Call 合同。
2. 有状态资源属于 Session，不由全局 Adapter 共享。
3. 工具、Skill、Scene、Knowledge、MCP 的变化在下一次 Prompt 或模型调用生效，不为局部变化重建完整 Runtime Snapshot。
4. 旧功能实现继续作为唯一事实源；Greenfield 只做协议适配，不复制业务算法。
5. 尚未达到等价的能力必须显式记录并阻止默认入口切换。

## 分析结论

### 1. Prompt Adapter 必须由 Runtime Assembly 按 Session 交付

第 56 轮的 Backend 持有一个全局 Prompt Adapter。无状态 Adapter 可以共享，但真实 Skill/Scene 解析依赖：

- 当前 Session 的 `ResourceLoader`；
- 当前 Session 的 `TodoStore`；
- Session 自己的错误上报和持久化回调；
- Session 对应的 cwd 与资源根。

因此 Prompt Adapter 与 Repository、Model Runtime 一样，改由 `GreenfieldRuntimeAssembly` 交付。CLI 组合根新增
`createPromptResourceResolver(sessionOptions)`，有状态 resolver 每次创建/恢复 Session 时独立生成；原
`resolvePromptResource` 仅保留为无状态兼容入口。

### 2. Skill/Scene 是 Prompt 前的动态资源，不是 Snapshot 内容

新增生产适配器 `createCodingAgentPromptResourceResolver()`：

```text
PromptRequest.promptRef
  -> refreshSkillsIfChanged()
  -> expandSkillReference()
  -> Skill/Scene hidden context
  -> Session 自己的 TodoStore
```

它直接复用旧 `expandSkillReference`：

- Skill 正文继续从当前文件读取并去除 frontmatter；
- Scene 继续注入只读目录规则；
- `tasks.json` 继续重置、批量创建并锁定 Session Todo；
- 文件删除或不可读时继续保留结构化引用，不复用旧正文；
- 旧 `/skill:`、`/scene:` 命令路径未修改。

因此 Skill 文件新增、修改或删除只影响后续 Prompt，不触发 Feature/Snapshot 重编译。

### 3. 动态工具需要两个独立调用级步骤

一次模型调用前的工具解析拆为：

```text
refreshCatalog(context)
  -> resolveActivation(context)
  -> select registrations
  -> filterRegistration(registration, context)
  -> guard current binding
```

- `refreshCatalog` 同步 MCP 等外部动态来源；
- `resolveActivation` 解析场景和宿主 capability；
- `filterRegistration` 实现不能被显式工具名单绕过的本轮硬隔离；
- Catalog binding guard 保证模型看到工具后，执行前仍校验注册、替换和撤销状态。

这三个 Port 都是调用级 Port，不进入不可变 Snapshot。

### 4. Knowledge 同时需要“宿主可用”和“本轮允许”

旧逻辑有两层判断，不能合并：

1. `VETTA_KNOWLEDGE_DISABLED` / 宿主配置决定知识库 capability 是否存在；
2. `metadata.knowledgeMode` 决定当前普通会话是否暴露 `kb-read`；`kb-processing` 场景例外。

本轮接入的仍是旧 `createKbListTagsTool` 和 `createKbFilterByTagsTool`。通用
`adaptCodingAgentToolRegistration()` 只转换执行协议，保留旧 Schema、description、结果、
update/phase、`scope_use`、`requires` 和 `category`。调用级 filter 在 scope 和 explicit 两种激活模式后
再次执行硬隔离，显式名单不能绕过 knowledge mode。

### 5. MCP 是独立动态来源，但尚未达到完整切换条件

`runtime-mcp` 新增 `McpRuntimeToolSynchronizer`：

- 每次模型调用前执行现有 `McpManager.reloadIfChanged()`；
- 继续由旧 Manager 负责配置签名、diff reload、OAuth、认证状态和 server 生命周期；
- 继续复用旧 MCP-to-AgentTool adapter，再转换到 Runtime Tool；
- MCP 工具按旧规则盖章全场景、`external` category；
- 用 server 状态、启动时间和工具定义指纹做增量同步；
- 未变化工具保留原 binding，变化/删除工具只更新对应 Registry 项；
- 并发 refresh 合并为一次执行。

当前尚未迁移旧的“超过 15 个 MCP 工具后使用 `tool_search` 渐进披露”及对应 system prompt 索引。
因此本轮只建立动态 MCP Tool Source 边界，不把 Greenfield 作为 MCP 完整等价入口；正式切换 Gate
仍要求补齐 deferred discovery 差分测试。

## 已实施

### Runtime Core

- `GreenfieldRuntimeAssembly` 必须提供 Session 自己的 `promptAdapter`。
- `ComposedGreenfieldRuntimeFactory` 从 Session resources 组装该 Adapter。
- Backend 不再保存或向所有 Session 复用全局 Prompt Adapter。

### Coding Agent Adapter

- Prompt resource resolver 收到 Session preparation context。
- 新增真实 ResourceLoader/TodoStore resolver，并在每次解析前刷新 Skill 指纹。
- `SkillExpansionDeps` 收窄为实际使用的 `getSkills` Port。
- 新增旧 `AgentTool` 到 `RuntimeToolDefinition` 的协议适配，保留执行更新和阶段回调。
- 未识别的旧 category fail closed 为 `external`。

### Runtime Tools

- `CodingToolsFeature` 新增调用级 activation resolver、Catalog refresher 和 registration filter。
- 工具 Registry 仍在每次模型调用读取；动态注册、停用和删除不重编译 Feature。
- explicit activation 仍保留原“显式选择可绕过 requires”的合同，但不能绕过上层硬隔离 filter。

### Runtime MCP

- 新增独立 MCP Runtime Tool Synchronizer。
- MCP Manager 与 Runtime Registry 通过窄 Source/Registry Port 连接。
- 组合根只引用稳定 synchronizer，不把 MCP 解析放进 Kernel。

### CLI 并行 Composition Root

- 注册旧知识检索工具的 Runtime 适配结果。
- 根据宿主 availability、本轮 knowledge mode 和场景共同决定知识工具暴露。
- 可注入 MCP Source，并在初次组装及每次模型调用前增量同步。
- 支持为每个 Session 创建独立 Prompt resource resolver。
- 默认 Legacy CLI、Desktop、RPC 与 SDK 入口均未切换。

## 功能等价检查

| 能力 | 旧实现事实源 | Greenfield 适配结果 | 当前 Gate |
| --- | --- | --- | --- |
| Skill 展开 | `expandSkillReference` | 直接复用；每次 Prompt 刷新 | 通过 |
| Skill 删除 | ResourceLoader + 文件系统 | 下一 Prompt 保留引用、不复用正文 | 通过 |
| Scene Todo | `TodoStore` + `tasks.json` | Session 独占 Store，创建并锁定 | 通过 |
| Knowledge 工具执行 | 两个旧 KB AgentTool | 仅转换调用协议 | 通过 |
| Knowledge 硬隔离 | availability + turn metadata | scope/explicit 后二次过滤 | 通过 |
| MCP reload/增删 | `McpManager` | 调用前增量同步 Registry | 通过 |
| MCP OAuth/失败状态 | `McpManager` | Manager 继续拥有 | 通过 |
| MCP deferred discovery | RuntimeManager + `tool_search` | 尚未迁移 | 阻塞默认切换 |
| 默认生产入口 | Legacy Backend | 未修改 | 保持 |

## 测试

新增和补充的测试覆盖：

- 同一 Session 连续修改、删除 Skill，后续 Prompt 读取当前磁盘状态；
- Scene 使用 Session TodoStore 创建并锁定 `tasks.json` 列表；
- AgentTool 到 RuntimeTool 的输入、结果、partial update、phase 与激活元数据等价；
- activation resolver 每次模型调用重新执行；
- explicit activation 之后仍执行 knowledge 硬隔离；
- knowledge mode 开关与宿主禁用组合；
- MCP 工具初始注册、运行时删除和重新加入均在下一模型调用生效；
- 两个 Session 分别创建自己的 Prompt resolver；
- Runtime Backend 与 Storage projection 在 Adapter 所有权调整后继续通过恢复测试。

本轮定向测试共 26 项通过。最终包级测试与全仓质量门结果见本轮交付说明。

## 明确未修改

- 未切换任何默认生产入口。
- 未改写 Skill、Scene、Knowledge 或 MCP 的业务算法。
- 未改变既有 Coding Tool 名称、Schema、description、结果格式、scope 或 requires。
- 未把 ResourceLoader、TodoStore、McpManager 或 Knowledge 类型放进 Runtime Core。
- 未把局部资源变化实现为全量 Snapshot 重建。
- 未实现 MCP deferred discovery、plugin prompt/system prompt 完整差分。
- 未删除 Legacy RuntimeManager、InputPipeline 或 SessionManager。

## 下一步

下一阶段应作为一个完整的“模型调用输入等价门禁”阶段：

1. 把 Legacy MCP deferred index、`tool_search` 会话激活集合和 system prompt 指令适配为独立
   Model Call Contribution，覆盖阈值上下和运行时 server 变化。
2. 建立 Legacy/Greenfield system prompt、模型可见 messages、实际 tools 三元差分 fixture。
3. 补齐 plugin instructions、动态 Skill 列表和 MCP 索引的调用级贡献，不让这些内容固化在 Session
   创建时。
4. 差分通过后再评估单一 CLI 场景的显式 opt-in；Desktop/RPC/SDK 默认入口继续保持 Legacy。
