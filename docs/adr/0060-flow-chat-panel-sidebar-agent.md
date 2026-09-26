# 侧边栏流动式智能体面板（Flow Chat Panel）

## Status

Draft — 待评审

## Context

open-vetta 桌面应用的侧边栏内置了一个**流动式聊天面板**（ChatPanelView），把"小型 AI 智能体"直接嵌在主界面侧边栏里。核心价值：
- 不离开当前工作区（如 Database Workbench）就能调 AI 查问题
- 面板壳三段式：**membersBar + messageList + composer**，任意 slot 可被替换
- composer 自带 skill capsule + slash panel，让用户把工具"贴"进 prompt
- 消息气泡对 thinking/toolcall 有折叠展开，流式消息有逐字动画

Astravia 现状**并不缺 AI 能力**——`useSessionManager` 已完整支持流式（message.delta/toolcall.start/tool.start/tool.phase/tool.end）、`ChatMessage.blocks` 已覆盖 Text/Thinking/ToolCall/ToolResult/Error 五种块、`@db:` / `@file` / skill token 解析已跑通、thinking/reasoning 级别切换已有。

缺的是**把这些能力装配到侧边栏/activity panel 的 UI 壳**。当前侧边栏主导航 `PRIMARY_NAV_ITEMS` 的 `new-session` 入口打开的是主 chat 页面，不是嵌在侧边栏/activity panel 里的小面板。Activity Panel（`useActivityPanelModel`）目前的内置 tab 是文件/数据库/设计/插件，没有"智能体对话"。

## Decision

**不复用 open-vetta 组件代码**（跨 monorepo 包边界 + UI 库不同），**但严格借鉴其"三段式可插槽"架构**。

在 Activity Panel 里新增内置 tab `agent-flow-chat`，其内容区组件 `AgentFlowChatPanel` 自己实现：

```
AgentFlowChatPanel
├── membersBar        ← 当前 session 名称 + 正在运行的 skill/MCP 列表（简化版，先不做多人）
├── messageList       ← 滚动区 + loading/empty/loadingMore 状态（复用 open-vetta 骨架）
│   ├── AssistantMessage  ← thinking/toolcall 折叠展开 + 流式
│   └── UserMessage       ← @mention / skill / 文件 token
└── composer          ← textarea + @mention 触发 + slash skill capsule + send
    ├── SkillCapsuleRow   ← 已选 skill 胶囊（对齐 open-vetta SkillPromptAreaView）
    └── SlashPanel        ← 输入 / 时弹出 skill/command 列表
```

### 数据流

```
用户输入 → AgentFlowChatPanel.composer.onSubmit
  → useSessionManager.sendMessage（复用现有）
    → desktop-conversation-service（复用现有）
      → astravia/agent 流式响应
        → event: message.delta → appendTextDelta
        → event: toolcall.start → handleToolStart
        → event: message.final → finalizeMessage
          → 更新 ChatMessage.blocks（TextBlock / ThinkingBlock / ToolCallBlock / ToolResultBlock）
            → 渲染层按 block 类型渲染（thinking 可折叠、toolcall 可展开详情）
```

**关键**：完全复用现有消息处理链，不引入第二条 AI 调用路径。侧边栏面板和主 chat 页面**读的是同一份 session data**（chat-atoms 的 activeSessionAtom + chatMessagesAtom），UI 壳不同而已。

### 与主 Chat 页面的关系

- **同 session 双视图**：session `abc` 可以同时在主 chat 页面和侧边栏面板打开，两边看到相同消息列表、共享 streaming 状态
- **Activity Panel tab 默认挂当前项目 session**（`sessionByCwd` 已在 useSidebarModel 里实现）
- 侧边栏面板关闭 = 只是 activity tab 切走，session 本身不销毁

### 范围（In Scope / Out of Scope）

| 能力 | In Scope | Out of Scope |
|------|---------|-------------|
| AgentFlowChatPanel 三段式壳（members + list + composer） | ✅ | |
| 流式消息渲染 + thinking/toolcall 折叠展开 | ✅ | |
| Skill capsule row + @mention 触发 | ✅ | |
| slash panel（输入 `/` 弹 skill/command） | ✅ | |
| 空状态 + loading 状态 + loadingMore | ✅ | |
| 侧边栏会话列表（ChatMessageListView 那种） | 二期 | |
| 多人 members bar（跨 session 共享参与者） | ❌ |
| 拖拽/重排会话 | ❌ |
| 录音/图片附件 | 二期 | |

## Considered options

- **方案 1：新建独立 agent 运行时 + 独立 UI**：不。astravia 已有完整消息/流式/toolcall 链路，造第二条是重复。
- **方案 2：直接 import open-vetta ChatPanelView**：不。跨 monorepo 包边界 + `@vetta-org/ui` vs `@astravia/ui` 组件库不兼容 + chat-atoms 数据结构不同。
- **方案 3：把主 Chat 页面嵌入 activity tab（iframe 方式）**：不。无法共享 Jotai atoms（iframe 独立 context）、无法同步 streaming 状态、性能双份开销。
- **方案 4（选定）：新建 AgentFlowChatPanel 组件，复用 useSessionManager + chat-atoms + 所有 block 渲染器，只换三段式壳**。

## Consequences

### 代码结构

```
packages/desktop-app/src/renderer/domains/activity-panel/
├── components/
│   └── agent-flow-chat/
│       ├── AgentFlowChatPanel.tsx          ← 三段式壳（membersBar + messageList + composer）
│       ├── AgentFlowChatComposer.tsx        ← textarea + skill capsules + slash panel + @mention
│       ├── AgentFlowChatMessageList.tsx     ← 滚动列表 + empty/loading/loadingMore
│       ├── AgentFlowChatMembersBar.tsx      ← session 名称 + 当前活跃 skill（简化）
│       └── AgentFlowChatMessage.tsx         ← 单条消息气泡（Assistant/User 分支 + blocks 渲染）
└── registry/
    └── useActivityTabDefinitions.tsx        ← 新增 BUILTIN_ACTIVITY_TABS 里的 agent-flow-chat

packages/theme-ui/src/
└── agent-flow-chat/                         ← 若组件复杂，拆到 theme-ui 复用
```

### 影响域

- `BUILTIN_ACTIVITY_TABS`：新增一个 tab definition（id="agent-flow-chat", icon="solar--chat-bold"）
- `useSessionManager`：无改动（完全复用 sendMessage / stream event handlers）
- `chat-atoms`：无改动（Message / Block 结构已满足）
- plugin system：无改动（skill/MCP/tool 注册机制不变）

### 风险

- **Activity Panel 性能**：同时渲染主 chat 页面 + activity panel 会双倍内存。用 React `mount`/`unmount` 控制：切到非 chat tab 时卸载消息列表。
- **Streaming 同步**：两个 UI 读同一份 atoms，Jotai 保证一致性——天然同步，无额外工作。
- **@mention AtPanel 定位**：composer 在 activity panel 里，AtPanel 需要正确定位到 textarea 坐标（window.getComputedStyle 已通用）。

### 分期

| Phase | 交付物 |
|-------|--------|
| **P0（当前）** | AgentFlowChatPanel 三段式壳 + textarea composer + 复用现有 blocks 渲染 + Activity Tab 注册 |
| **P1** | Skill capsule row + slash panel（输入 `/` 弹列表）+ @mention AtPanel 对齐 |
| **P2** | 侧边栏会话列表（ChatMessageListView 风格）+ 历史会话切换 |
| **P3** | 图片附件 + 语音输入 + 多智能体 members bar |
