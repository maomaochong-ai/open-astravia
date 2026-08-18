---
status: accepted
---

# ask_user_question 以 user question handler 存在与否门控（能力=注册）

[[ask_user_question]] 是 coding-agent 的内置交互工具，由 desktop 设置页「Agent配置 → [[实验性功能]]」开关控制是否启用。问题是：这个「开/关」如何抵达 coding-agent，让工具在 agent 的 active tool set + system prompt 里出现或消失，且要像 MCP / [[个性化]] 那样**新旧会话都在下一个 prompt 懒生效**。

直觉做法是新增一个显式布尔（`enableAskUserQuestion`）：从 DesktopConfig 读出后，经 `createAgentSession` 或某个 `runtime.setToolFlags()` 透传进 coding-agent，coding-agent 存下该布尔、每轮 prompt 比对决定注册。但工具「能阻塞等回答」本身就**依赖一个宿主回调**——没有回调，工具即便注册了也无法工作。于是布尔与回调成了两个必须保持同步的状态，会出现「flag=on 但 handler 未注入」的不一致窗口。

## 决定

不引入独立布尔。**工具的可见性唯一取决于共享 runtime 上 [[user question handler]] 是否存在**：

- **handler**：在 `getSharedRuntime()` 上新增 `setUserQuestionHandler(fn | null)`，与既有 `setUserConfirmationHandler` 同构（但承载 `questions/options` 富结构与结构化答案，而非 bool）。承载结构走新增 IPC channel `question-request / question-response`，与 [[host_request / host_response]] 同属「agent 阻塞等宿主响应」家族。
- **开关 → handler**：[[实验性功能]] 开关开 → desktop 主进程 `setUserQuestionHandler(fn)`；关 → `setUserQuestionHandler(null)`。开关是全局的（DesktopConfig `experimental.askUserQuestion`），handler 也是共享 runtime 全局态，二者天然同范围。
- **注册**：AgentSession 在**每个 `prompt()` 入口**比对「共享 runtime 上 question handler 是否存在」与上次 `_buildRuntime` 时的态，变化即重建——把 `ask_user_question` 加入/移出 active tool set 与 system prompt。机制复用 MCP 的 `_maybeReloadMcpForPrompt` 与 [[个性化懒重建]]，fast-path 近零成本。
- **默认**：开关默认关 → 默认不注入 handler → 工具对存量用户不可见，agent 行为不变。

## 关键取舍

**用「能力=注册」换掉「布尔 + 回调」的双状态同步。** 显式布尔看似更直白，但它与「工具能否真正工作所依赖的回调」是冗余的两份事实，必须人为保持一致，留下不一致窗口。以 handler 存在与否为唯一信号后：注入回调与启用工具是**同一个动作**，不可能错配；不向 coding-agent 透传任何 desktop 概念的布尔；与 `--enable-host-bridge` 时 `im_send_attachment` 才注册的既有先例（[[host_request / host_response]]）同一心智——「宿主给了能力，工具才存在」。代价是 coding-agent 需要一个「查询共享 runtime 是否挂了 question handler」的访问点，并把它纳入 per-prompt 重建的比对信号。

**懒重建复用既有范式而非另起。** 生效路径与 MCP 懒重建、[[个性化懒重建]]、image budget 懒重读共享同一心智模型：写盘/改态不 fan-out，每个 session 在下一个 prompt 入口按需 diff 重建。新读者理解一处即理解四处；老会话无需重启即可在下一轮感知开关变化。

**全局而非 per-session。** handler 设在共享 runtime 上、对所有会话同时生效，与开关是全局设置一致。后台 session 也能提问（[[问答面板]] 携 sessionId 路由到对应会话），这正是「新旧会话都动态启停」的要求。

## 后续若改变主意

- 若将来需要 per-session 而非全局地启停（如某些自动化/批量 session 不允许提问），可在 AgentSession 侧加一个「即便 handler 存在也强制不注册」的局部否决位，不影响本 ADR 的全局默认路径；
- 若实验项增多、需要更细的能力协商，可把「单 handler 存在性」泛化为 runtime 上的能力清单（capability set），注册比对从「handler 是否存在」改为「能力是否在清单内」，per-prompt 重建逻辑不变。
