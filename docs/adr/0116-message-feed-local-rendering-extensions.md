# ADR-0116：消息列表基座与局部渲染扩展分离

## 状态

已接受。补充 ADR-0101，并替代其中通过解析 `VirtualList` 子节点声明内部列表布局的决策。

## 背景

已有 Feed Primitive 支持部分组合，但 Desktop 默认列表仍同时装配普通会话命令、分叉提示、选区回填、运行状态和消息内容；Team、查看器必须通过关闭功能开关复用它。用户消息正文直接依赖编辑、删除和分叉 hook，Markdown 的语法和节点呈现也固定在 Chat 的 TextBlock 中。继续添加回调或 feature flags 会扩大这个耦合。

## 决策

1. 保留三层：theme-ui 提供无会话依赖的机制与视觉；Desktop 的 `MessageList` 是 Conversation 数据的默认只读配方；`SessionMessageList` 显式装配普通会话的命令、分叉提示、选区回填、运行 Footer 和建议。任意领域数据仍可直接使用泛型 `MessageFeed.VirtualList`，不扩张 Conversation 联合类型来容纳所有来源。
2. UI 位置使用正常 JSX children。`DefaultChatView` 不再创建消息列表和输入框；调用者排列列表、`ChatError` 和 `ChatComposer`。`UserMessage` 只负责正文、附件与用户气泡；`SessionUserMessage` 在外部复用独立 action hooks 装配命令。新增命令不修改列表基座。
3. 渲染有独立的三个变化点：`MessageRendering` 负责局部消息投影、按 kind 选择组件及消息行；`ContentRendering` 负责按内容块类型替换或装饰默认呈现；`MarkdownDefinition` 负责语法插件、标准元素、自定义 HAST 元素和代码块。投影不写回历史；持久化修改仍调用场景命令。
4. 扩展是普通 TypeScript 定义和 React 组件，不建立中心命令 union 或全局注册表。消息投影依声明顺序组合；同类 renderer 后者替换前者；普通会话默认配方允许调用者覆盖。Markdown 用 `extendMarkdown` 显式继承，插件有序追加，组件按键覆盖。组件类型和 definition 应保持稳定，避免流式更新重挂载。
5. Markdown 移至公开 `@vetta-org/theme-ui/markdown` 入口。Chat 与活动面板预览消费同一扩展定义；各自保留流式/预览样式和链接策略。`CodeBlock.Root/Copy/Frame/Language/Content` 共享真实复制状态及代码数据，可只重组工具栏而保留高亮、复制。原 `chat/TextBlockView` 仅转导出，不保留第二套实现。
6. Feed Root 持有虚拟列表 Footer 的 DOM 挂载目标；`MessageFeed.Footer` 使用 Portal 挂载并保留声明位置的 React context。`VirtualList.children` 仅为逐项渲染函数，不再扫描子元素类型。每个 Root 对应一个 VirtualList，Footer 可在包装组件内组合。内部列表使用现有默认布局，外层布局继续使用 `MessageFeedLayout`。
7. 展开状态与卡片 pending descriptor 缓存在各 Feed scope 内拥有，卸载条目不丢失、切换 scope 重置、并列 Feed 互不污染；卡片 owner 基于该 Feed 的消息而非全局当前会话。宿主 Markdown 环境显式使用列表 cwd；预测与模式由 `AssistantRenderingProvider` 注入，普通会话 adapter 负责读取活动会话 atom。
8. 普通会话历史命令在点击时绑定目标，跨确认/异步完成不得向新会话回写 transcript、草稿或触发跳转。不改变 Runtime、历史格式、IPC 或分支语义。本轮不增加插件安全沙箱，可信组件和语法插件沿用现有宿主执行边界。

## 备选方案

- 在旧列表继续增加 renderer 回调与开关：迁移少，但命令与当前会话状态仍隐式进入所有列表，拒绝。
- 统一万能 Extension Manager，同时管理数据、命令、UI、Markdown：会把真实独立变化点重新耦合，拒绝。
- 一并重写消息数据层为逐 key external store，并新增 Plugin SDK 注册协议：不属于消除当前 UI/渲染耦合的必要条件，留在独立任务，不在本轮引入第二套数据源。

## 迁移与后果

- 普通会话改用 `SessionMessageList`，Team/查看器/工作流使用只读 `MessageList`；旧列表 context flags 删除。自定义命令使用正文组件与 action hooks 组合，而非让基座猜测权限。
- `VirtualList` 的旧 `MessageFeedLayout.List`/Footer 子节点形式是源码不兼容变更：改用逐项 children 函数，并将 Footer 放在同一 Root 下的普通 JSX 中；`theme-ui` 增加 ReactDOM peer。所有仓库内消费者已迁移，外部消费者发布升级时需按指南迁移。
- 不修改 Plugin SDK manifest 或 Module Federation 的插件可见面；这些局部 Provider 不是自动安装到全局会话页的插件注册协议。插件宿主若要自动贡献全局 renderer，需另行定义注册/撤销合同，不能声称本轮已经提供。
- 通过消息命令流程、扩展替换/撤除、流式状态保持、Footer、卡片稳定性与展开状态隔离测试证明合同；未启动用户 Desktop 实例。

使用方法见 [消息列表扩展指南](../../apps/desktop/docs/message-feed-extensions.md)。
