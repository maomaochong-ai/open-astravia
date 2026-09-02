# Agent Team 聊天基础设施重构

## UX Brief

- 主要用户：频繁使用 Desktop Coding Agent 的开发者与专业用户。
- 页面唯一任务：在一个团队上下文中描述目标、按需指定成员，并持续理解当前由谁处理以及已经产出什么。
- 关键决策：交给 Leader 协调，或通过成员头像 / `@handle` 指定一名或多名成员。
- 主要行动：输入并发送消息；运行中可以取消，失败后可以保留草稿并重试。
- 成功反馈：用户消息立即进入时间线，成员身份和增量回复持续可见，最终回复稳定落入会话历史。
- 不在范围内：不把 Team 消息伪装成 Chat 专属 `ChatMessage`，不展示成员的私有推理或工具参数，不重设计普通聊天的全部功能。Team 用户/成员公开内容改用 ADR-0103 的普通 Conversation User/Agent 消息合同。

## 状态矩阵

| 状态 | 用户看到什么 | 可执行操作 | 恢复方式 |
| --- | --- | --- | --- |
| 加载 | 会话加载提示 | 等待 | 加载失败后重试页面 |
| 空 | 团队成员头像与使用说明 | 输入目标、选择成员 | 不需要恢复 |
| 就绪 | 历史消息、成员头像、可用输入框 | 选择成员、发送 | 不需要恢复 |
| 发送 | 用户消息立即进入时间线，成员显示准备状态 | 取消 | 取消后保留可重新编辑的文本 |
| 流式 | 成员头像、名称、已有增量文本和运行标记 | 取消、阅读增量 | 断开后由 snapshot 恢复当前 turn |
| 完成 | 最终结果进入稳定历史 | 继续发送 | 不需要恢复 |
| 失败 | 明确的失败信息，原输入得到保留 | 修改并重试 | 再次发送 |
| 取消 | 当前成员停止，已收到的增量保持可见直到稳定状态同步 | 修改并重试 | 再次发送 |
| 窄窗口 | 时间线和输入框保持主操作，成员区域横向滚动 | 键盘、点击操作 | 不隐藏发送与取消 |

## Visual Spec

- 注意力顺序：最新消息与流式状态 → 输入内容 → 成员路由。
- 产品气质：延续普通对话的高密度桌面工具界面，不新增装饰性卡片、渐变或持续动画。
- 输入框：普通聊天和团队聊天共用同一个 props-driven composer frame、语义 token、圆角和发送按钮；业务编辑器和工具栏由各自 adapter 提供。
- 时间线：共用同一个 Virtuoso viewport primitive；普通聊天和团队聊天分别提供 item view model 与 renderer。
- 身份：顶部成员和成员回复共用 `AgentAvatarView`，优先头像，其次名称首字母，再以 blueprint 图标兜底。
- 状态：有 partial text 时始终显示正文，同时显示运行标记；只有尚未收到正文时才显示 skeleton。
- 可访问性：成员选择使用 `aria-pressed`；输入框有可见/程序化标签；异步错误使用 `role="alert"`；流式状态使用 `aria-live="polite"`。

## 架构不变量

- `*View` 不访问 Jotai、router、IPC 或 domain service。
- 普通聊天与团队聊天共享 User/Agent Conversation 消息合同和 UI contract；各自的会话状态、命令、权限与草稿 atom 仍然独立。
- 流式 turn 由 `requestId + turnId + memberId + seq` 唯一标识和排序。
- Renderer 只接收成员公开文本、状态和错误，不接收私有推理或工具参数。
- Recipe 直接组合现有 `Message`、`MessageLayout`、`MessageVisual` 与复制等真实行为叶子；禁止用 `createMessageSlot` 批量生成只有 Context 存在性检查和 `div`/`Slot` 转发的同名空壳。具体规则与正确例子见 [组件组合规范 §2.2](../../apps/desktop/docs/composable-ui-components.md#22-禁止-createmessageslot-式空壳复用真实能力)。
