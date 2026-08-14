# Work 模式的对话渲染改为 agent 自述的阶段组

ADR-0046 引入 Work/Coding 工作模式后，对话页 `MessageList` 的渲染仍然是为开发者设计的：thinking 常驻、每次工具调用一张卡片、连续调用靠「连续就合并」的启发式折叠成一行「已完成 N 个工具调用」。Work 模式面向的是非技术用户，这套渲染既看不懂也没有信息量。

决定在 Work 模式下改用 **agent 自述的阶段组**：新增 display-only 的内置工具 `progress`（`agent_mode: ["work"]`），采用**滑动窗口契约** —— 一次调用中 `summary` 关闭并改写上一阶段、`label` 开启新阶段，最后一个阶段由正文文本隐式关闭。渲染层据此把 block 流切成阶段组，每组折叠成一行 agent 写的中文标题，展开后一行一条（显示工具调用自带的 `description`），再点开才是 coding 的完整工具卡片。Work 模式下 thinking 保留（后修订，原决策是一律不渲染）：与工具行同列收在阶段组内，展开阶段后才可见，标题只报一句「正在思考」、不报行数。消息级折叠（`getAssistantFoldData`）保留：流式期间阶段标题行常驻可见，消息结束后整段过程收起、只留最终总结，折叠条按**阶段数**计数。

## Considered options

- **前置文本认领**：prompt 要求模型在成批调用前先输出一句短 text，渲染层把它提升为组标题。零协议改动，但分组边界仍由前端启发式决定，且标题是流式期间那句原话、完成后改不了，否。
- **在只读工具 schema 里加 `groupLabel` 参数**：无额外 round-trip，但污染所有工具 schema、coding 模式也会看到，且模型漏写就断组；何况每个工具已有的 `description` 参数已经覆盖了「per-call 说明」这一层，否。
- **前端本地小模型总结**：标题质量稳定但有额外延迟与成本，且流式期间给不出标题，否。
- **显式 start/end 配对的 progress**：语义最无歧义，但每组 2 轮 round-trip，5 个阶段就多 10 轮，否。

## Consequences

- **渲染跟随当前全局 `agentModeAtom`，消息不打模式戳**。由此产生两种错配，各有明确规则：coding 模式下看 Work 消息时，`progress` 调用降级为一行轻量小标题分隔符（`progress_divider`），下方照常平铺完整工具卡片；Work 模式下看没有 `progress` 调用的消息（coding 历史，或 agent 当次没调），退回启发式合组并使用通用 i18n 标题。切换模式会让历史消息改变形态，这是接受的代价。
- **组内容量由 agent 决定**，包括写类工具。「产物类调用不要塞进阶段」只在 `modes/work.md` 里做 prompt 引导，渲染层不设工具白名单。
- **硬性例外由渲染层强制**，不依赖模型自觉：插件自定义 UI 工具、`error` 块永远冒泡到组外。**失败的工具调用不在例外之列**（后修订）：Work 模式的受众看不懂工具报错，红色裸卡只带来噪音与不安，失败调用与普通调用一样留在阶段组内折叠，展开阶段仍可查看；真正需要用户知道的「这轮失败了」由 `error` 块承担。一个阶段被这类冒泡打断会拆成多个 segment，但它们共享 `stageId`，后续 `summary` 会同时改写全部分段的标题。`ask_user_question` 不在例外之列——活的问答面板由 `pendingQuestion` 驱动在 input-bar 渲染，消息流里的只是作答记录。
- 流式期间阶段组**始终收起**，只有标题行与计数滚动更新；末尾阶段在流式期间不标记为已关闭（`groupBlocksForWork(blocks, customToolNames, streaming)`）。
- 组视图作为**新组件** `ProgressGroupView` / `ProgressGroupRow` 落在 `packages/theme-ui`，现有 `ToolCallGroupView` 原样保留供 coding 与 `packages/site` 使用，两套渲染各自演进。
- **插件自定义 UI 工具（`registerToolCallSlot`）一律视为产物**，不新增协议字段让插件自己声明——作者主动注册渲染器，本身就说明这是要给用户看的东西。消息级折叠的答案区起点因此改为「第一个产物之前最后一次真实工具调用之后」与「最后一个过程块之后」中更靠前者——退到工具调用而不是产物本身，是为了让产物上方那段引出它的结论文字一并留在答案区，否则产物会变成没有上下文的孤块，`getAssistantFoldData` 是 work / coding 共用的，**两种模式同时生效**。代价是产物之后的过程块会落进答案区不再被折叠：work 下它们仍被阶段组收成一行，coding 下会平铺成完整工具卡片。产物在叙述中的位置由 `modes/work.md` 与 `modes/coding.md` 约束（不得提前渲染、不得批量渲染、产物之后写关键观察），渲染层不做重排。
- **产物的引入句改由宿主注入的 `md_intro` 参数承载**，而不是靠模型在正文的正确位置写一句话——理由与 `progress` 相同：schema 比行文顺序可靠。渲染进程在注册插件 agent 工具时探测同一插件有没有为该 `toolName` 注册 tool-call slot，有则在注册负载上带 `rendersCard`；coding-agent 只给带此标记的工具在 **LLM 可见的 schema 副本**上追加可选的 `md_intro`，插件自己的 schema 对象不变，调用 handler 前也会把该参数剥掉——**插件零改动、零兼容成本**，已装插件立即受益。渲染层在自渲染卡片正上方渲染这段 markdown。工具与槽在同一次激活内的注册顺序不固定，槽后到时会回补 `rendersCard` 并重推注册（主进程按 tool.id 覆盖，幂等），避免参数时有时无。
- Work 模式共三层折叠：消息级（收起全部阶段，只留最终总结）→ 阶段组 → 组内每行的二级详情。第一层只在消息结束后生效，流式期间阶段照常可见，用户能实时跟上进度。折叠条文案与计数单位是「步骤」而非 coding 的原始 block 数。
- **唯一的降级风险**：agent 在 Work 模式下不调 `progress` 完全由 `modes/work.md` 的 prompt 质量决定，没有强制手段。降级路径（启发式合组 + 通用标题）保证 UI 不会退化成满屏工具卡片，但阶段标题的信息量会丢失。
