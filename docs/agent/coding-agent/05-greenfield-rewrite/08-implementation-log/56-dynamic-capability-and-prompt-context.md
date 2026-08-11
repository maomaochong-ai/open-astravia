# 第 56 轮：动态能力组合与 Prompt Context

## 目标

在不切换默认 Legacy 入口、不重构既有功能的前提下，解决第 55 轮暴露的两个架构缺口：

1. 运行中的工具、Skill、MCP 或提示词可能变化，不能把 Session 创建时的一份静态快照当成永久事实。
2. Greenfield Prompt 不能只支持文本和图片；旧入口已经支持的结构化 Skill/Scene、附件和逐 Turn
   metadata 必须有可持久化、可恢复、可压缩的通用表达。

本轮建立以下链路：

```text
PromptRequest
  -> CodingAgentGreenfieldPromptAdapter
  -> SessionInput(message + context records)
  -> TurnPipeline
  -> context.appended journal events
  -> Conversation Document branch
  -> model-visible messages / UI-visible messages 两个独立投影
```

同时把 CLI Greenfield 组合从全局静态 Snapshot 改成 Session 级动态能力组合。

## 分析结论

### 1. “动态”应分成两个更新平面

频繁变化且可在模型调用前廉价读取的状态，不应重编译 Snapshot：

- 工具 registry 的 register/activate/deactivate/revoke；
- 调用级 prompt/tool contribution；
- 当前 Turn 输入中的 capability metadata。

这些状态由 `ModelCallContributionProvider` 在每次模型调用前重新解析。实测同一 Session 中移除
`read` 后，下一次模型调用立即不再收到该工具，不发生 Snapshot 重建。

Feature 集合、静态指令、Context Strategy、Tool Policy 等结构性变化仍需重新编译，但必须以
新一代 Snapshot 原子替换。`RuntimeCapabilityComposition` 为每个 Session 串行处理重配：

- newest-wins：尚未生效的旧请求可被新请求取代；
- 编译失败：当前可用代不变；
- Turn lease：已开始的 Turn 继续使用原代，后续 Turn 才绑定新代；
- 资源释放：retired 代等所有 lease 释放后才 dispose。

因此，“Turn 级快照”不是把会话、Skill 文件或工具结果完整复制一份，而是冻结单个 Turn 使用的
结构性能力引用。小变化只更新对应动态事实源。

### 2. Kernel 只需要通用 Context Record，不应该认识 Skill 或 Knowledge

新增 `SessionContextRecord`，只表达五个通用属性：

- `type`：由宿主适配器定义的稳定分类；
- `content`：标准 user content；
- `modelVisible`：是否进入模型上下文；
- `display`：是否应由宿主显示；
- `metadata`：恢复 UI/业务引用所需的结构化详情。

Kernel 不判断 `skill_expansion`、`knowledge_mode_instruction` 或 attachment。coding-agent Adapter
负责把业务字段翻译成这些记录，存储层负责校验和保存，Conversation 投影负责按可见性选择。

### 3. 模型历史与聊天历史必须是两个投影

旧自定义消息有三种语义：

- 对模型可见、对聊天 UI 隐藏，例如 Skill 展开和知识检索指令；
- 对模型不可见、仅保存引用，例如资源已删除后的 `promptRef`；
- 标准用户/助手消息，同时进入模型历史和聊天历史。

把它们继续压成一个 `messages` 数组会丢失边界。本轮明确拆为：

- `selectConversationDocumentModelMessages()`：标准消息 + `modelVisible` context；
- `selectConversationDocumentMessages()`：只返回标准聊天消息。

两者都从同一活动分支计算，因此编辑、分支切换、fork 和 resume 后不会重新拼错顺序。

### 4. Prompt 资源解析是 Adapter Port，不是 Kernel 功能

`CodingAgentPromptResourceResolver` 是 Skill/Scene 解析端口。Adapter 保留旧规则：

- 结构化 `promptRef` 与正文 `/skill:`、`/scene:` 命令不能同时出现；
- 名称 trim 后不能为空；
- 资源不存在或已删除时保留不可见引用，不报错、不复用旧内容；
- 非排队 Turn 把展开内容作为隐藏 context 放在用户消息之前；
- 排队输入无法注入独立自定义消息时，按旧行为把附件、Skill、Scene 内容前置到用户文本。

CLI Composition Root 可注入 resolver；本轮没有让 Runtime Core 读取本地 Skill 文件。

### 5. TypeBox 只放在真实运行时边界

`context.appended` 会写入 JSONL，属于不可信持久化边界，因此扩展既有 TypeBox Schema，对 content、
可见性和 metadata 做运行时校验。进程内的 Profile、Resolver 与 Context Record 组合继续依赖
TypeScript 类型，不额外引入 Zod 或重复校验。

## 已实施

### Runtime Core

- `SessionInput` 支持有序 `SessionContextRecord[]`。
- 新增持久化 `context.appended` 事件，并纳入恢复状态机和 Greenfield 事件投影。
- Turn Pipeline 先持久化 context，再持久化用户消息；只把 `modelVisible` 记录送入当前模型上下文。
- `TurnEngineRequest` 与 `ModelCallContributionContext` 携带原始 Turn input，供调用级能力解析。
- 新增 `RuntimeCapabilityComposition`，封装 Profile 编译、原子代切换、newest-wins 和 lease 释放。
- Conversation Document 将 context 保存为原生分支节点，并提供模型/UI 两个选择器。

### Runtime Storage

- TypeBox `StoredSessionEventSchema` 增加 `context.appended`。
- V2 JSONL 为 context 生成稳定 document entry reference。
- Repository 恢复时从活动分支重建模型可见上下文，同时不把隐藏 context 暴露成聊天消息。

### Coding Agent Adapter

- Prompt Adapter 支持 plugin instructions、knowledge mode、settings assist、attachments 和
  Skill/Scene expansion。
- 未找到资源、空附件等 marker 按旧语义持久化但不进入模型。
- 新增可注入 `CodingAgentPromptResourceResolver`，不让 adapter 依赖具体 ResourceLoader。
- 排队输入沿用旧的扁平化注入顺序。

### CLI 并行 Composition Root

- 每个 Greenfield Session 创建独立 `RuntimeCapabilityComposition`，Session dispose 时释放。
- 组合根 dispose 会先关闭全部能力组合，再关闭 Repository 和工具宿主资源。
- Prompt resource resolver 可由应用层注入。
- 动态工具状态仍由现有 registry 在模型调用前读取，不因单工具变化重编译 Profile。

## 明确未修改

- 未切换 Desktop、CLI、RPC 或 SDK 默认 Legacy Backend。
- 未改变任何 coding tool 的名称、描述、Schema、结果、scope 或 requires 规则。
- 未把 Skill 文件读取、Scene todo 副作用、MCP reload 或 Knowledge 工具注册搬进 Runtime Core。
- 未把 plugin hook、prompt template、图片 resize、个性化和 MCP 完整接入 Greenfield。
- 未删除旧 Input Pipeline 或 SessionManager。
- 未把运行时所有可变对象做全量快照。

## 测试

新增或补充以下验证：

- 多个结构性重配请求 newest-wins，superseded 代被释放。
- Profile 编译失败不破坏当前代。
- 活跃 Turn lease 释放前不 dispose retired 代。
- Turn context 按顺序持久化，仅模型可见记录进入执行上下文。
- TypeBox JSONL 往返恢复 context，模型投影与聊天投影彼此隔离。
- Prompt 基础字段、Skill 展开、资源缺失 marker、附件转义、知识模式、设置协助和排队扁平化。
- 同一 CLI Greenfield Session 动态停用 `read` 后，下一次模型调用工具集合立即更新。

本轮定向测试共 46 项通过。最终包级测试与全仓质量门结果见本轮交付说明。

## 下一步

下一阶段应完成“动态外部能力适配”这一组工作，而不是继续扩充 Kernel 业务类型：

1. 用现有 ResourceLoader/Skill Expansion 实现 `CodingAgentPromptResourceResolver` 的生产适配，并验证
   文件新增、修改、删除在下一 Turn 生效。
2. 将 MCP Manager 暴露为动态 Tool/Instruction Contribution Adapter，保留 lazy reload、deferred
   discovery、认证和失败状态语义。
3. 将 knowledge mode 作为调用级工具 activation 条件接入，保持 `kb-read` 的旧硬隔离规则。
4. 建立 Legacy 与 Greenfield 的 Prompt 输入、system prompt 和实际 model-call tools 差分门禁。

上述能力达到等价前，默认入口仍不应切换。
