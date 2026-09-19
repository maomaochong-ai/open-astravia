# ADR-0122：Plan 模式是与工作模式正交的会话权限轴

## 状态

Accepted

## 背景

用户需要一种「先对齐方案、再动手」的协作方式：Agent 调研并给出计划，用户批准前不产生任何改动。业界 harness 的实现都由四个零件组成——模式状态、写能力闸门、计划产物、退出审批——差别只在闸门放在哪一层。只靠提示词约束（Claude Code 早期做法）不构成保证；让模型自己切状态（四工具状态机）则出现过模型忘记退出、会话卡死在只读态的故障。

本仓库有两个看起来能承载它、实际都不合适的位置：

- **工作模式（ADR-0071）**：已被定死为「任务解释的先验，且只是先验」，不排除任何工具、Skill、MCP、插件或 Hook。Plan 模式的本质恰恰是硬闸，放进模式注册表会推翻 ADR-0071 的核心承诺。
- **插件**：Plugin SDK 能关工具、注入提示词、用 PreToolUse Hook 拦调用，足以做出「看起来像」的体验；但 `setToolEnabled` 是按 Turn 重放的效果，管不到子 Agent，也无法让宿主和其他 Hook 看到真实的权限模式。它做不出「模型物理上改不了东西」这条保证。

此外，生态 Hook 协议里的 `permissionMode` 早已包含 `"plan"` 取值，但宿主从未实现 `getPermissionMode`，该字段恒为 `"default"`。

## 决策

1. **新增会话级权限轴 `permissionMode`（`default` | `plan`）**，与工作模式（软先验）、场景 `scope_use`（fail-closed）正交。状态由 `features/plan-mode` 的 Runtime 唯一持有，以 custom entry 随会话文档持久化，恢复、分叉和树导航都能还原。
2. **双闸门落在所有工具来源的公共收口上**（`CodingAgentModelCallFrameComposer`）：
   - 工具面闸门叠加在 `bindToolSelection` 上，写工具不进入模型的工具 schema；
   - 执行闸门是拦截管线上 order 50 的拦截器（先于生态 Hook），裁决 schema 表达不了的部分：命令工具按命令内容放行，`spawn_agent` 只放行只读的 `explorer` 类型。
3. **判定是 fail-closed 白名单**。只登记内置只读工具；MCP、插件与扩展工具的副作用宿主无从判定（MCP 的 `readOnlyHint` 只是服务端自述），Plan 模式下默认全部不可见。命令判定为引号感知的单遍扫描，拒绝输出重定向、命令替换和带写副作用的参数。
4. **模式由用户手势切换，模型只能经审批放宽。** 模型可见面只有 `exit_plan_mode`：提交完整计划，经宿主的 review function 阻塞等待用户批准、改稿或退回。宿主未提供 review function 时不暴露该工具，提示模型直接给出计划。
5. **Turn 内只观察放宽。** 审批通过是本 Turn 自己产生的状态，后续模型调用立刻拿回完整工具面去执行；外部收紧按 generation 规则从下一 Turn 生效。
6. **计划是会话状态而不是文件。** 计划正文随 Plan 状态持久化，审批面板直接改写后回传；不引入文件系统 Port，也不在用户工程里落额外文件。
7. 批量、自动化、IM、知识库加工等无人审批的场景拒绝进入 Plan 模式。
8. 接通 `getPermissionMode`，生态 Hook 事件里的 `permissionMode` 反映真实模式。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 作为第三个工作模式（`modes/plan.md`） | 需要硬闸，直接违背 ADR-0071「模式零硬闸」；且工作模式与「是否允许改动」本来就是两个独立问题，Coding 与 Work 都需要 Plan |
| 用插件实现 | 闸门是 Turn 级效果而非 schema 级保证，管不到子 Agent，`permissionMode` 对外仍是错的；多个插件争夺工具面时没有仲裁 |
| 保留 write/edit，只允许写计划文件（Gemini CLI / Grok Build 做法） | 需要在产品 Feature 内做路径判定并引入文件 Port；计划作为工具入参由宿主保存，工具面上可以一个写工具都不留，保证更强 |
| 复用 `ask_user_question` 做审批 | 审批结果要携带用户改写后的计划与逐条意见，塞进「问题-答案」结构只能靠字符串约定；独立的 review function 合同更清晰 |
| 按 MCP `readOnlyHint` 放行外部工具 | 该标注来自不可信的服务端自述，按它放行等于让外部输入决定安全边界 |

## 后果

- Plan 模式下联网搜索等 MCP / 插件工具不可用，调研只能依靠本地只读工具与只读子 Agent。后续若要放开，需要一个由用户显式授予、而非服务端自述的只读标记。
- 命令白名单会误拒一些实际无害的命令（如带 `>` 字符的 grep 模式未加引号时）。这是有意的取舍：误拒的代价是模型改用 read/grep，误放的代价是击穿保证。
- 用户在 Turn 进行中开启 Plan 模式，当前 Turn 不受影响，下一 Turn 才收紧；需要立即停下应使用中断。
- 新增内置只读工具时必须显式登记到 `plan-mode-tool-policy.ts`，否则在 Plan 模式下不可见。
- 宿主要支持 Plan 模式的完整体验，需要注册 `CODING_AGENT_PLAN_REVIEW_FUNCTION`；Desktop 已实现，CLI 与 IM 暂未实现（CLI 可进入 Plan 模式，但只能由用户手动退出）。
- ADR-0071 的结论不变：工作模式继续零硬闸，本 ADR 的硬闸不读取也不影响 `agentMode`。
