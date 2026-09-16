# 消息列表与内容扩展

## 选用入口

| 需要 | 入口 |
| --- | --- |
| 任意数据源、完全自定义消息结构 | theme-ui 的 `MessageFeed` + `MessageFeedLayout` |
| Conversation 消息的只读列表、导航与流式跟随 | Desktop 的 `MessageList` |
| 普通会话的编辑、分叉、删除、分支切换及运行 Footer | `SessionMessageList` |
| 自己排列正文和命令 | `UserMessage` + action hooks + `MessageLayout.Footer` |
| 改消息/消息行 | `MessageRenderingProvider` |
| 改 thinking、tool_call、text 等内容块 | `ContentRenderingProvider` |
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

`MessageList` 的 children 进入滚动 Footer，不会挂载普通会话命令。普通会话由 `SessionMessageList` 添加默认能力；`ChatView` 另用 `SessionAssistantRendering` 为列表和导出注入预测/叙事状态。独立列表默认 staged 且不预测，可用 `AssistantRenderingProvider` 显式提供该来源的状态。

编辑、分叉、删除的实现位于 `useUserMessageActions` 和 `SessionUserMessage`，不是 Feed 的内置 command 集合。其他场景可用自己的事件处理器与 `UserMessage` 的 children 组合；不需要为了增加命令修改 `MessageList`。现成普通会话 action hooks 依赖普通会话 adapter，不能拿去修改 Team 历史。

## 消息与内容块

在目标列表外包 `MessageRenderingProvider value={definition}`：

```tsx
const rendering: MessageRendering = {
  project: message => message.kind === "user"
    ? { ...message, text: decorate(message.text) }
    : message,
  renderers: { user: CustomUserMessage },
};
```

投影只改变展示，不修改源消息。自定义 renderer 收到投影后的完整 `MessageItemProps`；不匹配的类型使用默认呈现。嵌套 Provider 保留未覆盖的类型；投影从外向内执行；同类型组件和 row 明确后者覆盖。`SessionMessageList` 的默认配置不会遮住调用者提供的覆盖。需要组合多个配置时也可调用 `extendMessageRendering`。

`ContentRenderingProvider renderers={{ text: CustomText }}` 在真实 segment 渲染入口生效，包括阶段组中的工具和思考。组件收到 `block`、`isStreamingTail`、`exportMode` 和默认呈现 `children`。返回 children 可装饰默认实现，返回其他 JSX 可替换它；不应直接修改 block。需要声明式语法处理时优先使用 Markdown 层，不要把文本重新解析塞进消息列表。

## Markdown 定义

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
  <SessionMessageList messages={messages} sessionId={sessionId} isStreaming={running} />
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
