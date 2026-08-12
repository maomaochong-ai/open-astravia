# 工作模式（Work/Coding）为独立正交过滤轴，纯全局实时切换

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
