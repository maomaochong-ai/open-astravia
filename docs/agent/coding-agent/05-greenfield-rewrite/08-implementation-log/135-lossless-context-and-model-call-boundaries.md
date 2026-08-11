# 第 135 轮：无损调用上下文与最终模型消息边界

## 目标

在不改变旧 Coding Agent 功能的前提下，把 Extension `context` 从 Legacy 回退迁移到
Greenfield，并修正模型调用前各能力的执行顺序。Runtime Core 只提供产品无关的消息身份、
调用级变换与最终模型消息合同；完整 `AgentMessage`、Extension、图片预算和图片屏蔽仍由
Coding Agent 拥有。

## Legacy 基线与问题

旧 `sdk.ts` 的每次模型调用顺序是：

```text
Extension context
  -> preCallCompaction / microcompact
  -> image budget
  -> blockImages / duplicate image cleanup
  -> provider
```

其中 `context` 接收完整历史 `AgentMessage[]`，包括标准消息、Custom Message、branch summary
和 compaction summary；多个 handler 按注册顺序链式变换，单个 handler 失败只跳过该
handler，变换结果不写回历史。

第 134 轮的 Runtime Message Envelope 只覆盖本次 Run 的观察身份。Conversation Document
恢复后仍只向模型投影标准 `Message[]`，所以历史 Custom Message 身份会丢失，无法等价触发
`context`。同时 Greenfield 的 turn-start preparation 早于 context transformer，会把自动压缩
提前到 Extension 之前；Pipeline 在压缩后再次调用 transformer，还可能令同一个 context
handler 执行两次。

## 实施内容

### 1. Runtime Core 增加产品无关的身份投影合同

`RuntimeMessageEnvelope` 新增 `opaque` 分支：

- `identity` 保存产品消息对象；
- `modelMessage` 是可选的标准模型投影；
- 没有 `modelMessage` 的身份可参与产品变换和观察，但不会进入 Provider。

新增三个边界：

- `ConversationContextProjector`：把已提交的 Conversation Document 投影为消息身份；
- `ModelCallContextTransformer`：逐模型调用接收标准消息和无损身份信封；
- `ModelCallMessageFinalizer`：在压缩与调用级变换之后，对最终标准消息执行最后处理。

身份协调集中在内部 `runtime-message-context.ts`。压缩提交后按标准模型投影匹配并复用旧身份；
新增或被替换的消息生成新信封。Runtime Core 不引用 `AgentMessage`、Extension 或图片设置。

### 2. Turn Pipeline 只负责持久化与身份重建

Pipeline 在 Turn 开始时组合以下上下文：

```text
Conversation Document active branch
  -> provider transient context
  -> current input / trailing context
  -> AgentRunPreparer context
```

模型调用检查点完成压缩后，Pipeline 从已提交 Document 重建身份信封并返回给 Engine。原先
压缩后的第二次 `ModelCallContextTransformer` 调用已删除，避免产品 handler 重入；Transformer
只在 Agent Core 真正调用模型时执行一次。

### 3. Agent Core 分离 canonical identity 与 Provider message

Agent Core 使用 request-scoped identity map 把标准 Agent Core 消息与 Runtime Envelope 关联：

- `transformContext` 能看到完整产品身份；
- opaque identity 的 `modelMessage` 决定其模型可见投影；
- checkpoint 压缩后恢复新的 canonical context；
- `ModelCallMessageFinalizer` 只处理已经投影出的标准消息；
- Provider 永远只接收标准 `Message[]`。

这使“产品身份参与 Extension 变换”和“模型只接收允许的消息”成为两个独立边界。

### 4. Coding Agent 恢复完整 AgentMessage 历史

`buildSessionContextProjection` 复用现有 `buildSessionContext` 的 active branch、branch summary、
compaction summary 和 custom-message 转换规则，同时保留每条源 `AgentMessage` 身份。

`CodingAgentGreenfieldAgentMessageContextProjector` 把结果转换为 Runtime Envelope：

- 标准 user/assistant/toolResult 消息保持标准身份；
- Custom、branch summary、compaction summary 保持原 AgentMessage identity；
- `modelVisible: false` 的 Custom Message 没有模型投影。

`GreenfieldExtensionEventBridge.transformContext()` 复用现有 Extension Runner 的 handler 链、
异常隔离和结构化克隆语义。Context Runtime 在每次模型调用中按旧顺序先执行 Extension，
再 microcompact；即使 handler 返回了克隆对象，原本模型不可见的 Custom Message 仍会被过滤。

### 5. 图片规则归入最终模型消息边界

新增 `CodingAgentGreenfieldModelCallMessageFinalizer`，按旧顺序执行：

1. 动态重读 `images.maxRecentImages` 并调用既有 `applyImageBudget`；
2. `blockImages` 开启时替换图像；
3. 在禁图替换分支内沿用旧有的连续占位文本去重。

设置源通过窄接口注入；没有复制图片预算算法，也没有把 SettingsManager 下沉到 Runtime Core。

### 6. Composition Root 与兼容门禁

Greenfield Composition Root 为每个 Session 组装：

- AgentMessage Conversation Projector；
- Extension context transformer；
- 动态图片设置 finalizer。

Extension 兼容性评估已把 `context` 标为 Greenfield 支持事件。至此，消息相关 Extension
事件不再因缺少历史身份而回退 Legacy。

## Schema 判断

本轮没有新增 Zod 或 TypeBox Schema，原因不是不需要校验，而是校验已经处于正确边界：

- runtime-storage 使用 TypeBox 校验持久化 Conversation Document 和标准消息；
- Extension context 与 Runtime Envelope 是同进程、静态类型控制的短生命周期对象；
- Coding Agent Adapter 对 Legacy custom content 做窄判别，避免把无效持久化内容伪装成
  `AgentMessage`；
- 再为 Envelope 建立第二套 Schema 会重复持久化真相源，且不能提供额外边界安全。

若未来 Envelope 跨进程、进入 JSONL/RPC 或独立持久化，再应在该外部入口引入 TypeBox。

## 测试

新增或更新测试覆盖：

- Conversation Document 投影保留可见和不可见 Custom Message identity；
- Extension Runner 的真实 `context` handler 链接入 Bridge，且不修改输入；
- Extension 能观察完整 Custom identity，但模型不可见消息不进入 Provider；
- context transformer 每次模型调用只执行一次；
- 自动压缩发生在 context 之后，压缩后身份按 checkpoint 结果恢复；
- finalizer 在压缩后执行，Provider 只收到最终标准消息；
- 图片预算和 `blockImages` 动态设置沿用旧行为；
- `context` 兼容门禁不再触发 Legacy 回退。

验证结果：

- `runtime-core` 两个定向测试文件：30 个测试通过；
- `runtime-core` 完整包测试：31 个文件、159 个测试通过；
- `coding-agent` 五个定向测试文件：23 个测试通过；
- `coding-agent` 完整包测试仍受 Windows 路径、Shell/包管理器命令、鉴权/模型 fixture 和
  并发知识库 fixture 等既有环境基线影响；与本轮直接相关的 memory context 时序断言已修正，
  本轮五个定向文件全部通过；
- 根 `bun run check` 包含 Biome、全仓类型检查和 quality guards，最终结果见本轮交付验证。

## 明确未修改

- 没有修改 Extension `context` 的 handler 顺序、异常隔离或 transient 语义。
- 没有修改 `buildSessionContext` 的 Legacy 模型消息结果。
- 没有把模型不可见 Custom Message 注入 Provider。
- 没有修改压缩、图片预算或图片屏蔽算法，只调整到旧有调用边界。
- 没有修改 Conversation Document 持久化格式。
- 没有引入产品类型到 Runtime Core。

## 结果与下一步

Greenfield 已具备完整 AgentMessage 历史投影，Extension `context` 与消息生命周期事件均可在
不改变旧功能的前提下运行。模型调用边界现在明确分为：产品身份变换、压缩检查点、标准消息
最终处理和 Provider 调用。

下一阶段应以真实 CLI 会话建立 Extension 差分门禁：同一 Extension fixture 分别经过 Legacy
和 Greenfield，比较 `context` 输入、压缩前后顺序、Provider 最终消息及动态图片设置变化；
通过后再收缩该事件相关的 Legacy 执行依赖。
