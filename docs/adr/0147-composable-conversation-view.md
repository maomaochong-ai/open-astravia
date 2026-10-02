# ADR-0147：消息列表改为「headless 数据源 + 复合组件 + 注册式扩展」

## 状态

已接受，实施中（承接 ADR-0146：数据正确性由 feed reducer 保证，本 ADR 处理视图如何复用与组合）。

## 背景

`MessageList` 被普通会话、Team、只读查看器、工作流面板四处复用，但复用靠的是「同一个大组件 + 场景差异塞进 props 与全局状态」：

- **数据与视图绑定**：feed reducer 只服务全局唯一的当前会话（`conversationFeedAtom`），其他场景各自产出消息数组（查看器 / 工作流面板 `useState + fullHistoryToChat`，工作流面板对运行中的子会话每次快照整份重映射；Team 另有 reducer）。想在第二处展示一个活的会话无法复用 feed。
- **组件内部读全局**：`MessageList` 读 `activeSessionAtom` 推导子 agent 卡片；分叉横幅、工作流脚注、工作段渲染等直接调用 `openSessionFnRef` 或读写全局 atom；`useUserMessageActions` 有二十余处全局读写。同一份消息放进只读查看器，表现取决于「当前活动会话是谁」而不是调用方。
- **功能靠 props 与隐式 context 开关**：`MessageList` 内嵌六层 provider，`SessionMessageList` 再套四层；哪些必须包、漏包会怎样没有约束。`onAbort`、`onTeamMemberOpen`、`pendingLabel` 等 props 把场景功能逐个塞进通用组件。
- **`sessionId` 一词多义**：会话路径、工作流文件、Team feedKey 都传给它，它同时是滚动缓存键、展开状态作用域、卡片作用域与虚拟列表身份；传错不报错，只会串状态。

theme-ui 已有一批 Radix 风格的无数据原语（`MessageFeed.Root / VirtualList / Footer`、`MessageFeedLayout.*`、`Message`、`MessageLayout`、`UserMessage` 等），缺的是其上一层「如何组合」的约定。

## 决策

### 1. 三层

1. **数据层（headless，无 UI）**：`ConversationFeed` 是可实例化的数据源，提供消息、流式状态、作用域键与**能力**（capabilities）。数据源的实现包括运行中的会话、只读快照、Team；全局「当前会话」只是其中一个实例。组合层与扩展只从 feed 取数据与能力，不读全局 atom。
2. **原语层（theme-ui，无数据）**：纯展示部件，`asChild` + context，与现有 `MessageFeed` / `Message` 原语同一风格；不认识会话、运行时或 jotai。
3. **组合层（桌面端 conversation 域）**：复合组件与扩展，把原语和 feed 接起来。

### 2. 组合规则（模板 + 注册式扩展）

- **结构与位置相关的功能用模板**：`<Conversation.Root feed>` 下用 `<Conversation.Viewport>`、`<Conversation.Messages>`、`<Conversation.UserMessage>` / `<Conversation.AgentMessage>` 等声明布局与每条消息的结构。消息模板的子树只写一次，列表按行套上 `MessageProvider` 渲染，部件用 `useMessage()` 取当前消息。放进去就有，拿掉就没有；不提供 render prop，也不提供功能开关 prop。
- **与位置无关的横切功能用注册式扩展**：如批注、选区、展开状态、子 agent 卡片、Team 成员回复卡。扩展是放在 `Conversation.Root` 下任意位置、自身不渲染的组件，通过 context 向行管线注册装饰器、按种类的渲染器或操作项；声明顺序决定叠加顺序。现有的 `MessageRendering` / `AssistantRendering` / `ContentRendering` 并入这套注册机制。
- **能力来自数据源，而不是 props**：需要运行时操作的部件（编辑、切换分支、分叉、打开子会话、中止、批注）用 `useConversationCapability(...)` 取能力；数据源不提供时部件不渲染，开发环境给出警告。只读场景即使误放了编辑按钮也是安全的。
- **状态作用域显式**：滚动位置、展开、选区等状态由各自的 Root 级部件持有，作用域为 `feed.key`；不再以 `sessionId` 兼任多种身份。

### 3. 示例（目标形态）

```tsx
// 普通会话
<Conversation.Root feed={sessionFeed}>
	<Conversation.Viewport>
		<Conversation.Messages>
			<Conversation.UserMessage>
				<UserMessage.Bubble />
				<UserMessage.Actions>
					<CopyAction />
					<EditAction />
					<BranchSwitcher />
				</UserMessage.Actions>
			</Conversation.UserMessage>
			<Conversation.AgentMessage>
				<AgentMessage.Work />
				<AgentMessage.Content />
				<AgentMessage.Actions>
					<CopyAction />
					<TokenUsage />
				</AgentMessage.Actions>
			</Conversation.AgentMessage>
		</Conversation.Messages>
		<Conversation.ScrollToBottom />
	</Conversation.Viewport>
	<Conversation.TimelineRail />
	<Conversation.Footer>
		<Suggestions />
	</Conversation.Footer>
	{/* 横切扩展：放进来即生效 */}
	<AnnotationsExtension />
	<SubagentCardsExtension />
	<ForkOriginExtension />
</Conversation.Root>

// 只读查看器：同一套部件，不放编辑、分叉、建议
<Conversation.Root feed={snapshotFeed}>
	<Conversation.Viewport>
		<Conversation.Messages>
			<Conversation.UserMessage>
				<UserMessage.Bubble />
			</Conversation.UserMessage>
			<Conversation.AgentMessage>
				<AgentMessage.Work />
				<AgentMessage.Content />
			</Conversation.AgentMessage>
		</Conversation.Messages>
	</Conversation.Viewport>
</Conversation.Root>
```

### 4. 约束

- 组合层与扩展目录内的生产代码不得读写会话相关的全局 atom 或 `*FnRef`；需要的东西从 feed 的能力取得。该约束由 `check:guards` 检查。
- 原语层（theme-ui）不得依赖 conversation 域、jotai 或 preload。

## 实施步骤

每步独立提交，旧的 `MessageList` 在迁移完成前作为由新部件组合而成的兼容外壳存在，四个使用方逐个迁移。

1. **数据层**：`ConversationFeed` 与 `useSessionConversationFeed` / `useSnapshotConversationFeed`；`Conversation.Root` 提供 feed 上下文。行为不变。
2. **组合层骨架**：`Conversation.Viewport / Messages / UserMessage / AgentMessage` 与行模板机制、注册式扩展机制；`MessageList` 改由它们组合，测试不变。
3. **抽出功能**：操作栏、分叉横幅、批注、目录、建议、用量、子 agent 卡片、Team 成员回复卡等逐个改为模板部件或注册式扩展，去掉全局读取，改从能力取得。
4. **迁移使用方**：查看器 → 工作流面板 → Team → 普通会话依次改为显式组合，最后删除兼容外壳与相关 props。

## 备选方案

- **继续用 props 开关功能**：实现最快，但每个场景差异都要进通用组件，props 与隐式依赖持续膨胀，正是现状。
- **只用注册式扩展**：增删功能只需一行，但最终结构不直观，位置相关的部件（操作栏在哪、横幅在哪）难以表达。
- **只用模板**：结构清晰，但批注、选区这类横切功能需要在每个模板里重复放置。故两者结合：位置相关用模板，横切用注册。
- **全部放在桌面端**：迁移最简单，但移动端、文档站无法复用原语，与现有 `MessageFeed` 原语的分层不一致。

## 后果

- 新场景（例如侧栏实时预览子 agent）只需构造一个 feed 并选择要放的部件，不改通用组件。
- 功能的有无由组合决定，能力的有无由数据源决定，两者都不再经过 props 或全局状态。
- 迁移期间新旧两种用法并存；兼容外壳在第 4 步结束时删除。
