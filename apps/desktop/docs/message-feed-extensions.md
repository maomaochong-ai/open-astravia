# 消息列表与内容扩展

## 选用入口

| 需要 | 入口 |
| --- | --- |
| 任意数据源、完全自定义消息结构 | theme-ui 的 `MessageFeed` + `MessageFeedLayout` |
| Conversation 消息的只读列表、导航与流式跟随 | Desktop 的 `MessageList` |
| 普通会话的编辑、分叉、删除、分支切换及运行 Footer | `SessionConversation`（由 `Conversation.*` 部件组合，见 ADR-0147） |
| 自己排列正文和命令 | `UserMessage` + action hooks + `MessageLayout.Footer` |
| 改某类消息的结构 | `Conversation.UserMessage` / `AgentMessage` / `EventMessage` 模板 |
| 改 thinking、tool_call、text 等内容块 | 注册 `renderBlock` 的会话扩展 |
| 改 Markdown 语法、节点、代码块 | `@vetta-org/theme-ui/markdown` |

这些是局部 React 组合 API。没有新增 Plugin SDK manifest 项或全局 renderer 注册服务；Desktop 组件也不是插件可深度导入的公共包入口。

Desktop 内部可以从 `@domains/conversation/components/message-list` 的统一入口导入上述组件和类型，具体实现仍按职责拆分。

## 结构组合

`DefaultChatView` 的 children 是真实布局，不再通过 feature flags 创建列表和输入框：

```tsx
<DefaultChatView messages={messages}>
  <MessageList messages={messages} sessionId={feedId} cwd={cwd} isStreaming={running}>
    <MyFooter />
  </MessageList>
  <ChatError>{error}</ChatError>
  <ChatComposer><MyComposer /></ChatComposer>
</DefaultChatView>
```

`MessageList` 的 children 进入滚动 Footer，不会挂载普通会话命令。普通会话由 `SessionConversation` 显式组合 `Conversation.*` 部件与会话扩展；回复由 `AgentMessage.*` 部件组成（标题、折叠条、内容、操作栏、用量、预测状态、卡片），模板里不放的部件就不显示；「预测下一条输入」状态来自数据源的 `predicting`，独立列表默认不预测。

编辑、分叉、删除由数据源的 `userMessageCommands` 能力提供（普通会话的实现在 `session-conversation/session-user-message-commands.ts`），`SessionUserMessage` 用 `UserMessage.*` 部件排列它们；数据源不提供该能力时这些部件不渲染。其他场景可用自己的事件处理器与 `UserMessage` 的 children 组合；不需要为了增加命令修改 `MessageList`。现成普通会话 action hooks 依赖普通会话 adapter，不能拿去修改 Team 历史。

## 消息与内容块

某类消息要换结构，就在 `Conversation.Messages` 里声明该类的模板并放入需要的部件；没有声明模板的类型按只读默认模板渲染（正文加复制）。模板只改变展示，不修改源消息。

内容块用扩展替换：在 `Conversation.Root` 下放一个调用 `useConversationExtension({ id, renderBlock: { text: CustomText } })` 的组件。它在真实 segment 渲染入口生效，包括阶段组中的工具和思考；组件收到 `block`、`isStreamingTail`、`exportMode` 和默认呈现 `children`，返回 children 可装饰默认实现，返回其他 JSX 可替换它；同一类型以后注册的扩展为准。不应直接修改 block。需要声明式语法处理时优先使用 Markdown 层，不要把文本重新解析塞进消息列表。

## Markdown 定义

默认渲染现已包含公式、SVG 与隔离 HTML 预览，语法、运行限制和性能预算见 [Markdown 富内容](markdown-rich-content.md)。自定义 `codeBlock` 仍优先于默认富代码块；需要保留内置预览时，应自行明确组合，不能假设覆盖后仍会自动运行默认代码块。

```tsx
import { CodeBlock, defaultMarkdown, extendMarkdown, MarkdownProvider } from "@vetta-org/theme-ui/markdown";
import type { MarkdownCodeBlockProps } from "@vetta-org/theme-ui/markdown";

function MyCode(props: MarkdownCodeBlockProps) {
  return (
    <CodeBlock.Root {...props}>
      <CodeBlock.Copy>
        <CodeBlock.Frame>
          <CodeBlock.Language />
          <CodeBlock.Content />
        </CodeBlock.Frame>
      </CodeBlock.Copy>
    </CodeBlock.Root>
  );
}

const markdown = extendMarkdown(defaultMarkdown, {
  components: { table: MyTable, a: MyLink },
  codeBlock: MyCode,
  remarkPlugins: [myRemarkPlugin],
  rehypePlugins: [myRehypePlugin],
  elements: { "my-citation": MyCitation },
});

<MarkdownProvider definition={markdown}>
  <SessionConversation sessionId={sessionId} workspace={workspace} />
</MarkdownProvider>
```

`components` 使用 react-markdown 的类型；`elements` 接收语法插件生成的自定义 HAST 标签。基础 GFM、内联 Token、源位置修正和流式显示继续由默认实现提供；语法插件按声明顺序追加。自行覆盖链接组件意味着接管其点击语义，默认文件打开策略不会自动附加到自定义链接。

`extendMarkdown` 显式合并定义：插件追加、同名组件替换。Provider 本身不隐式追加父定义，避免语法插件重复执行。把组件声明在模块作用域，定义放模块作用域或 `useMemo`；不要在每个 token 到来时创建新的组件类型。流式消息和活动面板 Markdown 预览共享定义但保留各自布局。

Markdown 接收的 text 是源内容。默认代码复制使用原代码，语法转换不会回写源消息；消息复制/导出继续使用各自领域投影。覆盖 `pre` 等底层节点可以接管整个代码块，通常只替换 `codeBlock` 更容易保留复制和高亮。

## 作用域与生命周期

- 给列表传稳定的 `sessionId`（Team 可传 feed key）；改变它会重建该列表的展开/卡片缓存。
- 展开状态在 Feed 内跨虚拟条目卸载保存；两个 Feed 即使消息 ID 相同也不共享状态。离开整个 Feed 后不持久化这些 UI 状态。
- 卡片归属只查该列表消息；在途 descriptor 沿用第一次成功的结果，renderer 替换后重新求值。
- 明确传 cwd 以解析文件链接；只读列表不隐式使用活动会话工作区。
- 历史命令确认后仍操作点击时的目标；目标已离开前台时不把异步结果写进新会话。

## `MessageFeed.VirtualList` 迁移

不再把 `<MessageFeedLayout.List>` 或 `<MessageFeed.Footer>` 放进 VirtualList 的 children 中供其扫描。改用：

```tsx
<MessageFeed.Root>
  <MessageFeedLayout.Frame>
    <MessageFeedLayout.Viewport>
      <MessageFeedLayout.Virtualizer>
        <MessageFeed.VirtualList items={items} getKey={item => item.id}>
          {item => <MyMessage item={item} />}
        </MessageFeed.VirtualList>
      </MessageFeedLayout.Virtualizer>
    </MessageFeedLayout.Viewport>
  </MessageFeedLayout.Frame>
  <MyFooterExtension />
</MessageFeed.Root>
```

`MyFooterExtension` 内可返回 `<MessageFeed.Footer>...</MessageFeed.Footer>`。Footer 保留声明位置的 Context，并 Portal 到虚拟滚动内容末尾；支持 `asChild`、事件和 ref。一个 Root 对应一个 VirtualList。内部 List 使用默认列宽/间距；外层排列仍由 `MessageFeedLayout` 组合。没有 VirtualList 挂载目标时 Footer 不渲染。

旧 `chat/TextBlockView` 保留转导出兼容，新代码应使用 `markdown/MarkdownContent`。本轮未改变历史文件或 IPC，无数据迁移。
