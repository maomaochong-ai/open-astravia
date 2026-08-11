# 阶段 43：Session Model View

## 目标

移除 RuntimeHost 对旧 Session `model/modelRegistry` 的最后三处直接读取，同时保持图片输入过滤、自动标题、输入预测
的候选优先级、凭证解析、冷却和失败轮转行为不变。

## 行为审计

三个只读消费者的需求不同：

- prompt 图片过滤只需要当前模型的 id 与 input capabilities；
- 自动标题和输入预测需要当前模型、可用模型顺序，以及按模型异步解析 API key；
- 周边任务在每次候选解析前调用 Registry refresh；
- 候选策略要求当前模型优先，再按可用模型顺序补足，按 `provider/id` 去重，跳过冷却中或无凭证的模型，最多
  保留三个；
- 冷却、失败轮转和最轻 reasoning 档属于外围任务策略，不属于 Session 模型适配器。

因此本阶段没有让 View 直接返回“最终候选”，也没有把冷却 Map 和 failover 搬进 Legacy Adapter。

## 新增合同

```text
RuntimeSessionModelView
  ├─ readCurrentModel()
  ├─ refreshAvailableModels()
  ├─ readAvailableModels()
  └─ resolveApiKey(model)
```

这个合同不暴露 `ModelRegistry` 对象及其写方法。`readAvailableModels()` 返回独立数组快照，Model View 和阶段 42 的
Model Controller 保持读写分离。

## Legacy 适配

新增 `LegacyRuntimeSessionModelView`：

- 当前模型映射旧 Session `model`；
- refresh、available model 与 API key lookup 映射旧 ModelRegistry 的对应只读/解析能力；
- available 列表复制后交给消费者，避免消费者修改 Registry 返回数组。

`RuntimeHostSessionAssembly` 现在显式交付 `modelView`，默认 Backend 和 create-only Backend 继续通过统一 Legacy
Assembly Factory 获得兼容实现。

## RuntimeHost 与外围任务迁移

- prompt 图片过滤改为读取 Model View 的当前模型；
- `generateAutoTitle()` 直接接收 Model View；
- `generateNextPromptSuggestions()` 直接接收 Model View；
- `resolvePeripheralCandidates()` 通过 View 刷新、读取当前/可用模型并解析凭证；
- RuntimeHost 已不存在 `handle.session.model` 或 `handle.session.modelRegistry` 直接读取。

候选排序、最多三次、去重、冷却、最轻 reasoning 和失败轮转仍保留在 `peripheral-tasks.ts`，功能没有重写。

## 行为基线测试

新增 Model View 特征测试，固定：

- Legacy 当前模型、refresh、available snapshot 和 API key lookup 映射；
- 当前模型优先；
- provider/id 去重；
- 可用模型顺序；
- 三候选上限；
- 无凭证候选跳过后继续选择后续模型。

Assembly 隔离测试让旧 Session 模型支持图片，而自定义 Model View 模型只支持文本；RuntimeHost 最终按 View 结果
移除图片，证明图片判断没有回读旧 Session。

## TypeBox / Zod 判断

Model View 是进程内只读 Port，模型对象来自已经构造完成的 ModelRegistry，不是新的外部数据输入边界。本阶段不
引入 TypeBox/Zod。未来如果 Greenfield Backend 从文件、IPC 或远端响应构造 Model 数据，应在对应 Adapter 的输入
侧校验原始数据，再发布满足本合同的 Model View。

## 明确未修改

- 没有改变图片不支持时的过滤、替代文本或日志行为。
- 没有改变当前模型优先、候选上限、去重、凭证过滤、reasoning 档或冷却时间。
- 没有改变自动标题和输入预测的 prompt、解析或失败轮转。
- 没有把可写 ModelRegistry 暴露给 RuntimeHost。
- 没有合并 Model View 与 Model Controller。
- 没有迁移 plugin、todo、background task、subagent、execution mode 或 Host Interaction。
- 没有修改 Greenfield Backend，也没有切换生产默认 Backend。

## 下一步分析

模型读写依赖清理后，最小且低风险的剩余旧 Session 边界是 Host Interaction：新建和按路径复用会话时调用
`bindExtensions({ uiContext })`。下一阶段建议提取 `RuntimeSessionHostInteraction`，由 Assembly 交付 UI Context
绑定能力，并固定首次绑定、重复打开重绑定及异步失败传播行为。

这个 Port 只负责宿主交互上下文绑定，不能并入 Lifecycle。之后再分别处理 execution/workspace、todo/input modes、
plugin 和 background/subagent 能力，避免形成新的外围巨型接口。

## 验证

- Model View 与 Assembly 定向测试：2 个文件，11/11 通过。
- Runtime Core 完整测试：14 个文件，72/72 通过。
- Runtime Core build typecheck：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
