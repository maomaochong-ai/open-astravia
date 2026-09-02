# ADR-0101：消息列表采用可组合 Feed 与能力投影

## 状态

已接受

## 背景

普通对话的消息列表已经具备虚拟滚动、流式跟随、长对话导航、消息选择、分叉提示、模型边界、附件、操作区和卡片等能力，但这些能力原本集中在 Chat 专用的大组件和读取全局 atom 的 hook 中。Agent Team 不能直接复用它，只能维护一套功能较少的 `TeamMessageFeed`；继续给原组件增加 Team 分支或构造统一的万能 `Message` 类型，会把后续每一种消息场景都绑定到 Chat 的协议与状态。

消息列表存在三个彼此独立的真实变化维度：一是列表级能力可以独立增删和排序，二是消息项的内容能力会因业务协议而不同，三是相同能力可能被放置在不同位置、同一位置也可能承载不同能力。只拆行为能力而把方向、列宽、Header、Footer、导航 Rail 等排列继续固化在 Root 或机制组件中，场景仍会通过 `variant`、`className` 补丁和额外 wrapper 间接修改布局，不是真正的组合。因此需要分别复用稳定机制、布局配方和视觉 Primitive，同时让各场景保留自己的领域数据与产品策略。

## 决策

1. 主题层把消息列表拆成四条正交的组合轴：`MessageFeed` / `Message` 拥有行为状态与语义能力，`MessageFeedLayout` / `MessageLayout` 拥有 DOM 位置和排列配方，`MessageVisual` 拥有气泡等视觉叶子，领域场景负责最终 JSX 装配。不得让行为 Root 同时选择布局或视觉变体。
2. `MessageFeed.Root` 是不生成 DOM 的行为边界；`MessageFeed.VirtualList` 只提供虚拟化机制，`MessageFeed.Footer` 表达滚动内容能力。`MessageFeedLayout.Frame`、`Viewport`、`Virtualizer`、`List`、`LeftRail`、`RailContent` 与 `State` 显式表达布局。内部虚拟列表的列宽与 padding 也必须通过 `MessageFeedLayout.List` 子组件声明，不能藏在 `VirtualList` 的私有实现中。
3. `Message.Root` 是不生成 DOM 的消息状态边界；`Avatar`、`Author`、`Status`、`Meta`、`Attachments`、`Content`、`Actions` 与 `Cards` 只表达语义能力。`MessageLayout.Incoming`、`Outgoing`、`Event` 是显式宿主配方，`Header`、`HeaderLeading`、`BeforeBody`、`Footer`、`AfterBody` 等只表达位置。`MessageVisual.OutgoingBubble` 与 `EventBubble` 显式选择视觉，不再由 `Message.Root variant` 隐式推断。
4. 布局位置使用结构子组件而非能力命名：例如 `Footer` 可以承载操作、审批或卡片，`BeforeBody` 可以承载附件或其他前置内容。不得新增 `AttachmentsRegion`、`CardsArea` 这类把具体功能写回布局合同的组件，也不得以 `showX`、`renderX`、万能 options 或仅传 `ReactNode` prop 的方式扩展父组件。
5. Primitive 的 props 只表达数据、事件和底层机制配置。需要把布局或状态附着到调用方宿主元素时使用 Radix `Slot` 的 `asChild` 语义，合并 `className`、事件、`ref` 与可访问属性，不通过额外包装层模拟组合。
6. Desktop 共享层把列表机制拆成无领域依赖的独立能力：虚拟滚动跟随、目标跳转、当前可见项、导航大纲模型和导航 UI。它们不得读取 Chat atom、Team store，也不得 import 任一领域消息 schema。
7. 每个业务场景拥有显式适配层。Chat 把 `ChatMessage` 投影为导航 turn，并在薄 hook 中接入既有 atom；Team 按 `requestId` 把用户消息、成员回复与委派事件投影为一个导航 turn。适配是纯转换，不建立跨领域的万能 `Message` 联合类型。
8. 领域协议仍是能力上限。UI Primitive 可以组合附件、工具调用、推理、审批或卡片，但只有来源协议真实提供相应数据时场景才能装配该能力；不得为了“统一 UI”伪造或丢失协议语义。
9. 虚拟列表的 key 使用领域稳定身份。Team 的用户消息使用 `requestId`，流式成员回复与最终持久化结果使用同一 `turnId/sourceTurnId` 逻辑 key，避免状态切换时重挂载消息项，也避免同一成员在一个请求中产生多次 turn 时 key 冲突。
10. 删除已被替代的固定 `MessageListView`、`ConversationTimelineView` 和无语义 `MessageItemView` API，不保留新旧两套长期执行路径。专属业务能力继续留在场景组件中，通过公共 Primitive 组合，而不是下沉到通用 Root。

## 后果

- Chat 与 Agent Team 共享相同的列表布局骨架、滚动机制和消息视觉基础，同时保留各自的数据合同、状态来源与消息项组合。
- 新场景可以独立选择行为、布局位置和视觉叶子；新增一种能力通常只需增加一个叶子组件和对应场景装配，同一位置替换内容也不需要修改布局 Root、中央 feature union 或万能 options。
- 通用层不会自动让 Team 获得 Chat 协议尚未提供的工具参数、推理过程等数据；这类能力需要先演进来源协议，再在 Team 适配层显式组合。
- Compound Components 会增加公开 Primitive 数量，因此必须用 Context 边界、`asChild` 语义测试和场景交互测试防止错误组合；不能只依赖类型检查证明 UI 行为。
