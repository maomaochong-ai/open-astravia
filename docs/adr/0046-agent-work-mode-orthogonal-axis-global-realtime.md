# 工作模式（Work/Coding）为独立正交过滤轴，纯全局实时切换

> **决策修订（2026-08，见文末《修订：agent_mode 降级为软引导偏好轴》）**：本 ADR 正文记录的是
> 2026-06 的原始决策，其中「`agent_mode` 是 fail-closed 过滤轴」与「纯全局实时切换」两条已被推翻。
> `agent_mode` 现在只是提示词偏好与排序权重，系统中不再存在任何形式的模式硬闸；mode 在会话创建时
> 固化，会话内不可变。正文保留原样以记录当时的取舍，实现事实以文末修订段为准。

> **再修订（ADR-0071）**：文末修订段中「`agent_mode` 降级为排序权重与提示词详情偏好」及正文
> 「模式注册表为中心硬编码」两条已被 [ADR-0071](0071-agent-mode-is-a-task-interpretation-prior.md)
> 取代：资源侧 `agent_mode` 声明整体废弃（解析保留、语义为零），模式重心由 mode prompt、工作区事实
> 与工具自描述在任务解释层承担，模式注册表改由 `profiles/modes/*.md` 派生。

> **机制修订（ADR-0069）**：本 ADR 的产品语义继续有效；“下一个 Turn 生效”现由统一的
> Session configuration overlay 与 Turn-bound runtime generation 实现。活动 Turn 不重新读取全局 mode，
> mode、Plugin 与 Execution Mode 的目标值由同一个 overlay 接受并在后续 Turn 发布，不再把 mode
> 视为可在 Model Call 之间变化的实时执行状态。

Vetta 要把 Agent 分成 Work（偏文档处理）与 Coding（偏严谨编程）两种工作模式，用来隔离工具、系统提示词、可见插件、MCP 与内置/插件 skills；而 coding-agent 已有一套 `scope_use`（会话场景）∩ `requires`（能力槽）的 fail-closed 过滤机制。

决定把 `agent_mode` 做成**独立的第三条正交过滤轴**，在 `resolveActiveToolNames` 中追加一层 `!agent_mode?.length || agent_mode.includes(currentMode)` 的 AND 过滤（未填即通用），不复用 `scope_use`/`requires`。mode 采用**纯全局状态**（不绑定对话），切换**立即**更新全局态与 UI，但受影响 session 的 runtime / 系统提示词重建**推迟到其下一个 turn 边界**（懒重建）。合法 mode 是中心硬编码的 `AgentMode = "work" | "coding"` 注册表，插件只能引用不能自创；`agent_mode` 字段挂在 `AgentTool` 宿主元数据层（不进 LLM schema），并镜像到 `PluginAgentToolRegistration` / `AgentPluginToolContribution`。

## Considered options

- **复用 `requires` 能力槽（`requires: ["mode:coding"]`）**：无需新字段，但 mode 是用户显式选择的全局态而非环境能力，语义扭曲，且插件 manifest 级 mode 门无法自然表达，否。
- **复用 `scope_use` 场景枚举**：场景是从对话内容推断的 fail-closed 激活上下文，与用户显式全局设置的生命周期/来源都不同，硬合会让场景系统语义崩坏，否。
- **mode 绑定到每个对话 / streaming 中途实时换**：绑定对话与「全局 toggle」定位冲突；中途换工具集会破坏 tool_use/tool_result 配对，故取纯全局 + turn 边界生效，否。

## Consequences

- 插件级 `agent_mode` 是**外层硬闸**：白名单外的插件彻底不加载、全隐藏（agent 资源 + UI 面板/命令/入口 + bundle 均无，懒加载）；子资源（tool/MCP/skill）的 mode 只能在插件集内取**交集**收窄，越界者永不激活。
- skill 的 mode 真源统一在 `SKILL.md` frontmatter（预置/插件/用户一套机制）；插件 MCP 的 per-server mode 仅内联 map 支持，`.mcp.json` 路径形式只继承插件级。
- 模式系统提示词仿 persona 基建（`src/core/modes/*.md` → 构建期 inline），作为独立 `mode` block 加在通用 base 之后，与 persona 正交共存。
- 提供鉴别函数：控制面可同步读取 desired mode；Agent Prompt、Tool、Skill、MCP、Plugin 与 Hook
  只读取 Turn admission 捕获的 effective mode。插件 UI 可订阅 desired mode，Tool handler ctx 携带
  该 Turn 的 mode 快照。
- session mode 为可选参数，**未传 = 不过滤**，coding-agent CLI/headless 行为零改动；desktop-app 默认 **Work**，持久化于 `~/.vetta/desktop-config.json` 并 broadcast。
- 首期仅文档处理 5 工具（`doc_to_pdf` / `html_to_pdf` / `extract_text_from_pdf` / `extract_text_from_img` / `render_pdf_page`）标 `["work"]`，其余内置工具全通用，coding 无专用工具。

---

# 修订：agent_mode 降级为软引导偏好轴，会话创建时固化（2026-08）

本节取代上文关于「过滤轴」「插件级硬闸」「纯全局态实时切换」的结论，其余内容（模式注册表为中心硬编码、
`AgentMode = "work" | "coding"`、模式提示词仿 persona 基建、字段挂在宿主元数据层不进 LLM schema）继续有效。

## 背景

原决策上线后，硬隔离在真实使用中稳定产生同一类故障：用户停在 Work 模式提出一个需要编程能力的需求时，
相关工具、Skill、插件整组从会话中消失，模型既看不到也无法解释为什么做不到，只能干说。用户必须先理解
「模式」这个内部概念、找到 toggle、切换、再重开会话，才能继续。模式本应降低认知负担，硬闸反而把一个
实现细节推给了用户。

同时，隔离清单里没有一条是安全边界：首期只有 5 个文档工具标了 `["work"]`，coding 侧零专用工具，插件级
白名单也只是「不想在这个模式里看到它」。真正的权限与安全约束由 `requires` 能力槽、Capability 权限模型和
插件权限声明承担，`agent_mode` 从未参与其中。

误调（在 Work 模式下让模型去改代码、或在 Coding 模式下触发重量级文档/渲染工具）是真实存在的风险，
但它是「模型选错工具」问题，不是「用户越权」问题，用能力隔离去解会连带砍掉合法用法。

## 决策

`agent_mode` 不再是过滤轴，降级为提示词偏好与排序权重。系统中不存在任何形式的模式硬闸：

- **工具 / Skill / MCP**：非本模式主推的条目**仍然激活、仍然可调用**，只被稳定地排到清单末尾。
  `matchesAgentMode` 保留但语义改为「是否为本模式主推」；新增 `agentModePreferenceRank` 与
  `sortByAgentModePreference`（`packages/coding-agent/src/profiles/tool-activation.ts`）。排序是显式两桶
  partition、桶内保序，全部主推时输出与输入完全一致，以免打断 system prompt 前缀缓存。
  内置工具的注册选择（`packages/runtime-tools/src/coding/tool-registration.ts` 的
  `selectCodingToolRegistrations`）同样删除了 agent_mode 过滤分支：`agentModes: ["work"]` 的 5 个文档工具与
  `progress` 现在在两种模式下都激活。该函数只保留 `scopeUse` ∩ `requires` 两轴，模式偏好由宿主消费。
- **插件**：插件级 `agent_mode` 硬闸删除。插件的 UI 面板、侧边栏入口、命令与 MF bundle 一律常驻加载，
  不再按模式排除（`packages/desktop-app/src/main/plugins/plugin-agent-mode-policy.ts` 整文件删除，
  `PluginLifecycleService.listVisible()` 改名 `list()` 且不再过滤）。
- **Hook**：插件 hook 的模式闸一并取消，任何模式下都触发，只由 `scope_use`、`eventName` 与 `toolNames`
  matcher 决定。Hook 没有「排序」这种中间态，软化即等于不过滤。
- **不变的硬闸**：`scope_use`（会话场景）∩ `requires`（能力槽）仍是 fail-closed 两轴；插件 MCP 工具的
  可见性开关（`isToolVisible`）仍是硬闸。判断准则是：只要写出「因为模式不匹配所以排除 / 隐藏 / 不加载 /
  不触发」，就是错的，除非它只是排序权重。

mode 的生命周期同步收紧：**会话创建时固化，会话内不可变**。唯一来源是 `desktop-config.json` 的
`defaultAgentMode`（新会话默认值），调整入口只保留新会话页一处（侧边栏 badge 与设置 popover 入口移除）。
Runtime Host 不再有任何模式推送通道。

误调防护改由四层软约束承担，全部落在提示词与确认交互上，不动能力集合：

1. **工具描述反向触发**：重量级工具（`vetta-ui-design` / `image-gen` / `content-creation` /
   `remotion-renderer`）在 description 里显式写出「什么情况下不要用我」。
2. **工作区事实注入**：`packages/coding-agent/src/model-context/workspace-facts.ts` 在会话创建时探测 `cwd`
   的工程性质，把「当前工作区是一个已有的 X 仓库、沿用既有技术栈、不要另起工程」写进 `core.context`。
   事实比规则更强，且不必等模型先 `ls`。
3. **mode 路径声明**：`packages/coding-agent/src/profiles/modes/work.md` 与 `coding.md`（事实源，经
   `bun run generate:modes` 生成 `modes-data.ts`）直接写明本模式下的推荐工作路径。
4. **heavy 工具首调确认闸**：`packages/coding-agent/src/tool-policy/tool-side-effect.ts` 与
   `heavy-tool-confirmation.ts` 把工具分 `light` / `heavy`，heavy 工具在会话内首次调用前经
   `ask_user_question` 向用户确认。这一层拦的是「不可撤销 / 有计费 / 造目录树」的动作，与模式正交，
   即使用户模式选错也仍然生效。

## Considered options

- **保留硬闸、只把清单做得更准**：继续调 `agent_mode` 白名单。但故障根因是「能力凭模式消失」这一机制本身，
  清单调得再准也只是把边界挪个位置，越界用例照样撞墙，否。
- **保留硬闸、增加会话内改口入口**（用户发现工具缺失时提示切模式）：需要一条 per-session 的模式改写通道，
  会重新引入「Turn 中途换工具集」的配对风险，且把内部概念继续暴露给用户，否。
- **引入独立的 `ui_mode` 轴**（agent 能力软化、但 UI 入口仍按模式隐藏）：改造方案 v2 曾提出。它保留了
  「模式能让东西消失」这个心智负担，只是换了个轴承载，同一类困惑会原样复现，否。
- **保留 hook 的模式闸**（工具/Skill 软化、hook 仍硬过滤）：hook 无排序中间态，保留即保留了一条硬闸，
  与「零硬闸」的判断准则冲突，且会让「模式是否影响行为」这个问题重新变得要看情况，否。

## 为什么原否决理由失效

原 ADR 在 Considered options 中否决了「mode 绑定到每个对话」，理由是「绑定对话与『全局 toggle』定位冲突」。
该理由成立的前提是 mode 为硬隔离：硬隔离下 mode 决定能力集合，能力集合必须能被用户随时收回，因此 mode
必须是可实时切换的全局开关。软化之后这个前提消失——mode 只影响提示词与顺序，不再决定能不能做，
「随时全局收回」失去意义，而「同一个会话前后引导不一致」反倒变成纯粹的坏处。因此绑定到会话不再与
任何定位冲突，它是软化的自然结论。

同理，原决策「切换立即更新全局态、受影响 session 在下一个 turn 边界懒重建」也随之取消：默认值变化只影响
之后新建的会话，不再引起任何活跃会话的重建。

## 与 ADR-0069 的关系

`docs/agent/turn/08-binding-boundaries.md` 第 1.1 节已把 Agent Mode 列入「必须绑定：逻辑合同与资源身份」，
即 Turn 内不可变，由 ADR-0069 的 Turn-bound runtime generation 实现，已落地。本次修订沿同一方向进一步收紧
到**会话内不可变**——比 Turn 绑定更强的约束，是既有合同的子集，不破坏它。ADR-0069 中「mode 目标值由
session overlay 接受并在后续 Turn 发布」的 pending 分支因为不再有推送来源而自然失效，overlay 只剩
`executionMode` 与 `agentPlugins` 两条通道。

## Consequences

- **已知行为变化：hook 不再按模式过滤。** 工作模式下会触发编程类插件声明的 hook，反之亦然。这是权衡后
  明确接受的代价：hook 的正确边界本来就该由 `scope_use` 与事件/工具 matcher 表达，用模式兜底属于借位；
  代价是声明了 `agent_mode` 却依赖它做过滤的既有 hook 会在更多场景被触发，需要作者改用真正的 matcher。
  这一点在代码注释与 `packages/desktop-app/CHANGELOG.md`、`packages/plugins/plugin-sdk/CHANGELOG.md`
  中同样写明。
- **manifest 与注册字段全部保留**：`plugin.agent_mode`、tool / hook 注册的 `agent_mode`、MCP server 配置的
  `agent_mode` 仍被解析、存储并透传，下游只可用于排序与提示词详略。既有插件无需改 manifest，语义从
  「限定」变为「主推」。
- **迁移影响（配置）**：`desktop-config.json` 的 `agentMode` 改名 `defaultAgentMode`，读取时按
  `parsed.defaultAgentMode ?? parsed.agentMode` 回落，老配置继续可读，下次写盘自然迁移。
- **迁移影响（UI）**：侧边栏 mode badge 与设置 popover 入口移除，只保留新会话页一处 toggle。
- **迁移影响（runtime-core）**：`setGlobalAgentMode()` / `applyPendingAgentMode()` 及 `SessionHandle` 的
  mode pending 通道删除，属 Breaking Change，已记入 `packages/runtime-core/CHANGELOG.md`。
- **历史会话**：desktop 侧以会话文件同目录的 `agent-modes.json` 轻量索引记录 sessionId → mode
  （`packages/desktop-app/src/main/conversations/session-agent-mode-store.ts`），已有记录不覆盖。缺记录的
  历史会话回落到常量 `"work"`，**不回落当前默认值**——否则改默认值会改写老会话的表现。
- **CLI / headless 不变**：不传 mode 即无偏好，行为与原决策一致。
- **ADR-0041 不受影响**：见该 ADR 的补充说明，`contributionMode.hardIsolation` 是另一条独立机制。
