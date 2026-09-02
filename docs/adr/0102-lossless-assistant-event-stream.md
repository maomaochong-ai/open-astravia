# ADR-0102：Assistant 模型事件无损穿透 Session 事件流

## 状态

已接受

## 背景

`@vetta/ai` 已经定义了完整的 `AssistantMessageEvent`：文本、思考和工具调用都具有
start/delta/end、`contentIndex`、`partial` 以及明确的 done/error 终态。RuntimeHost 曾把它再次
压平为 `message.delta`、`thinking.delta`、`toolcall.start/args` 和 `message.final`。该映射丢失
内容索引、部分消息、原始终态和 Provider 失败细节；Renderer 又按类型分别缓冲文本和思考，重连时
同样按固定类型顺序回放，因而会改变真实事件顺序。模型协议、Runtime 协议和 UI 草稿各维护一套状态机，
增加 Provider、内容部件或终态时必须同步修改多处。

## 决策

1. Provider Adapter 是唯一的模型语义映射边界：它把 OpenAI、Anthropic 等 Provider 私有网络帧规范化为
   `@vetta/ai` 的 `AssistantMessageEvent`。Provider 私有帧不进入公共 Runtime 合同。
2. Runtime Session 直接在顶层传输规范化后的 Assistant 事件。`type`、`contentIndex`、`partial`、`delta`、
   `message`、`error` 等字段不得改名、拆分、合并或包进 `event` 字段，不再产生第二套同义模型事件。
3. Runtime 只给同一个顶层对象增加传输元数据：`sessionId`、`turnId`、`modelCallIndex`、`eventId`、时间戳与
   RuntimeHost 分配的会话内单调 `sequence`。`channel: "assistant"` 将模型协议面与 Session 生命周期、
   队列、工具执行、usage、扩展和 Runtime 错误面显式分开；消费者必须先按 channel 判别，避免规范化事件的
   `error` 与 Runtime `error` 冲突。Runtime 自有事件使用 `channel: "runtime"`。
4. Kernel 的标准 Agent Core Turn Engine 必须发布每一个规范化 Assistant 事件；持久化
   `message.appended` 只再发布 usage、持久化错误和取消等独立事实，不反向合成 `message.final`。
5. RuntimeHost Event Relay 只有一个底层订阅 owner。实时广播与在途缓冲消费同一个已编号事件，重连按
   原发生顺序回放相同事件和相同 sequence，不按 text/thinking/tool 分类重建。
6. Desktop 的 `ConversationProjection` 是历史与实时消息投影入口。实时批处理保存事件数组并依次归约；
   100ms 批次只减少 React 提交次数，不改变事件顺序。Renderer 不在 IPC handler 中复制 Provider 状态机。
7. IPC 接收边界对 SessionEvent 基础字段和完整 Assistant 事件变体做运行时校验；校验成功后保持字段结构，
   不创建 Desktop 专属的第二套 wire event。
8. 旧的压平 Assistant SessionEvent 只作为迁移期兼容输入保留，不再由标准 Kernel 路径生产。CLI、远程控制、
   Plugin 等确有自身外部协议的边界可以从原始事件做一次显式适配，但不得把适配结果写回 Runtime 主事件流。
9. 简单 SDK 用例通过 scoped `RuntimeHostSession.stream()` 订阅规范化事件；`createConversation()`、字符串 prompt
   和自动订阅消除手工处理 create/sessionId/subscribe/prompt/unsubscribe 竞态的样板代码。

## 后果

- Provider 新增事件语义时，Runtime 与 IPC 不需要再设计同义事件；高级消费者能看到 Provider Adapter 输出的完整规范化判断。
- UI、CLI 和远程协议仍可选择自己的展示投影，但转换点明确位于最终消费边界。
- 断线重放具有稳定 sequence 和真实交错顺序；消费者可用 sequence 幂等处理重复回放。
- 顶层 `channel: "assistant"` + `AssistantMessageEvent.type` 是公共合同变更。只识别旧压平事件或
  `assistant.event.event` 的消费者必须迁移；旧压平类型仍作为迁移输入存在，但标准生产路径不再发出。
- 原始 `partial` 会增加单事件体积；这是换取无损语义的明确成本。若后续需要跨网络压缩，应在 Transport 层协商，
  不能通过修改领域事件含义实现。
