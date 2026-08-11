# 阶段 42：Session Model Controller

## 目标

提取 RuntimeHost 的模型写配置边界，使模型键解析、模型切换、thinking level 与非共享 Registry 的凭证刷新不再
直接依赖旧 AgentSession，同时严格保留 prompt 和 settings 两条路径之间已有的行为差异。

## 行为审计

现有模型配置不是简单的 `setModel(modelKey)`：

- `modelKey` 的第一个 `/` 前是 provider，剩余部分整体作为 model id，model id 可以继续包含 `/`；
- 显式选择先查 `ModelRegistry.getAvailable()`，未命中时必须回退 `registry.find()`，以兼容认证状态误判的本地
  Provider；
- 未找到模型时静默保持当前配置；
- prompt 路径在目标与当前模型相同时跳过 `setModel()`；
- updateSettings 路径只要找到模型就调用 `setModel()`，即使目标与当前模型相同；
- reasoning/thinking level 必须在模型切换后设置，因为 `setModel()` 会重新约束 thinking level；
- 共享 Registry 由 RuntimeHost 刷新一次；没有共享 Registry 时逐 Session 设置 token 后刷新远端模型，单会话失败
  继续保持原有 catch-and-continue 行为。

直接把两条选择路径合并会改变 updateSettings 的行为，因此本阶段将差异显式表达为选择策略。

## 新增合同

```text
RuntimeSessionModelController
  ├─ selectModel(modelKey, "if-changed" | "always")
  ├─ setThinkingLevel(level)
  └─ refreshAuth(token)
```

`RuntimeModelSelectionStrategy` 只表达现存的两种写语义，不暴露旧 ModelRegistry，也不承担模型列表、图片能力判断、
自动标题或输入预测等只读职责。

## Legacy 适配

新增 `LegacyRuntimeSessionModelController`：

- 保留 modelKey 的 provider/model-id 拆分规则；
- 保留 available-first、find-fallback 顺序；
- `if-changed` 比较当前模型 provider/id 后决定是否切换；
- `always` 对已解析模型始终调用旧 Session `setModel()`；
- thinking level 原样委托；
- auth refresh 保证先 `setServerToken()`，再 `loadRemoteModels()`。

## Assembly 与 RuntimeHost

`RuntimeHostSessionAssembly` 新增 `modelController`，由 Legacy Assembly Factory 和 create-only Backend 兼容适配器
统一构造。RuntimeHost 已迁移：

- prompt 的显式模型选择和 per-turn reasoning；
- updateSettings 的 modelKey 和 thinkingLevel；
- updateGlobalThinkingLevel；
- 非共享 Registry 的 reloadServerAuth。

共享 Registry 仍由 RuntimeHost 直接刷新，因为它属于 RuntimeHost 级 Composition Root 资源，而不是某个 Session
实例的能力。

## 行为基线测试

新增 Model Controller 特征测试，固定：

- available model 优先且 model id 可包含 `/`；
- available 未命中时调用 registry.find；
- 无匹配模型时不调用 setModel；
- prompt `if-changed` 与 settings `always` 的同模型差异；
- thinking 委托及 token-before-load 顺序。

Assembly 隔离测试使用自定义 Model Controller，验证 prompt、updateSettings、全局 thinking 和非共享 auth refresh
全部消费 Backend 交付的 Port，并验证 prompt 内 select → thinking → turn-control 的顺序。

## TypeBox / Zod 判断

Model Controller 是进程内对象 Port；`ThinkingLevel` 已由现有类型联合约束，modelKey 继续保持现有宽松字符串语义。
本阶段不引入 TypeBox/Zod，避免把新的运行时拒绝行为加入原有 API。未来若模型配置来自独立配置文件或 IPC，
应在该输入边界校验声明数据，而不是校验已构造的 Controller。

## 明确未修改

- 没有改变 prompt、updateSettings 或 reloadServerAuth 的公开合同。
- 没有合并 `if-changed` 与 `always` 两种已有选择语义。
- 没有改变模型未命中时的静默行为。
- 没有迁移共享 Registry 所有权。
- 没有迁移图片输入能力判断、自动标题或输入预测的模型读取。
- 没有迁移 steering/follow-up、plugin、todo、background task、subagent 或 Host Interaction。
- 没有修改 Greenfield Backend，也没有切换生产默认 Backend。

## 下一步分析

RuntimeHost 还在三处直接读取旧 Session 的 `model/modelRegistry`：图片输入能力判断、自动标题和输入预测。下一阶段
建议提取只读 `RuntimeSessionModelView`：提供当前模型输入能力信息，以及外围推理任务需要的候选选择上下文。

这个 View 不应暴露可写 ModelRegistry，也不应与 Model Controller 合并。需要先确认 `generateAutoTitle()` 和
`generateNextPromptSuggestions()` 的最小输入究竟是完整 Registry，还是可以进一步收窄为候选模型快照/解析器；
优先通过行为测试固定候选顺序、失败轮转和当前模型优先级，再决定合同形状。

## 验证

- Model Controller 与 Assembly 定向测试：2 个文件，13/13 通过。
- Runtime Core 完整测试：13 个文件，69/69 通过。
- Runtime Core build typecheck：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
