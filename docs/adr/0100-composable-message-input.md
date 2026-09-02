# ADR-0100：消息输入区使用 Radix 风格的组件组合

## 状态

已接受

## 背景

普通对话与 Agent Team 都需要编辑、附件、命令、语音、队列和运行时交互等输入能力，但它们的发送目标与运行时生命周期不同。原输入栏把全部状态集中在一个 `InputBarModel`，主题层再通过固定 `regions` prop 对象接收路由、附件、编辑器和工具栏。把它替换成字符串 Region 与 `ReactNode` 注册表仍然只是另一种中央配置：能力顺序、位置和存在性依旧由宿主中的大数组决定，Toolbar 也仍需 `left` / `right` prop，不能像 Radix Primitive 一样直接组合。

## 决策

1. 可主题化布局使用 Compound Components 表达 `Root`、`Surface`、`DropZone`、`Content`、`Routing`、`Command`、`Attachments`、`Editor`、`Toolbar`、`ToolbarLeading` 与 `ToolbarTrailing`。`Root` 只持有受控状态并通过 Context 向 Primitive 传递，组件树由宿主 JSX 明确决定。
2. 静态产品能力不进入字符串 Region 或 `ReactNode` 注册表。能力通过独立组件直接成为 Primitive 的子节点；添加、删除和排序能力等价于添加、删除和移动 JSX，不要求扩展中央联合类型、Options 或贡献列表。
3. Primitive 支持 Radix `asChild` 语义，把样式、状态和 ref 合并到消费者选择的元素。`Surface asChild` 与可选的 `DropZone` 组合为同一个 DOM box，不因启用拖放而增加布局包装层。
4. props 用于受控状态、事件、数据和局部变体，例如 `focused`、附件内容与发送回调；能力是否存在、处于什么结构位置不得由 Root 的布尔 prop 或 region prop bag 控制。
5. Toolbar 的左右结构由 `ToolbarLeading` 与 `ToolbarTrailing` 子组件表达，不再通过 `left` / `right` `ReactNode` props 装配。Footer 同样由显式 Item 子组件组合，每个 Item 自己持有退场生命周期。
6. 外部插件仍不允许向输入框任意注入 React 组件。动态扩展使用既有的结构化宿主注册机制，由可信 Renderer 映射为具体能力组件；不能为了动态插件反向要求所有内置静态 UI 经过注册表。
7. 输入数据使用结构化合同传递。Team 附件沿用 `PromptAttachmentRef`，不再编码进用户文本；旧会话中的内联附件标记仅保留读取兼容。

## 后果

- 普通对话和 Team 使用同一组布局 Primitive，同时保留各自的会话、队列和多成员路由语义。
- 组件结构、能力顺序与条件渲染可以从 JSX 直接阅读；不存在并行的 Region 字符串和贡献排序事实源。
- `asChild` 提供 DOM 多态性，但消费者仍必须保留语义、可访问名称、主题和安全边界。
- 静态能力之间的依赖由共同拥有它们的场景组件和类型合同表达，不再依赖运行时字符串校验。
- 尚未拆出的旧 `InputBarModel` 字段应随对应能力 model/hook 迁移删除，不能继续作为长期扩展入口。

