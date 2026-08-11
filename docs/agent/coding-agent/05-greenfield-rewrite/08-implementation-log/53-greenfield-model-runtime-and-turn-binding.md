# 第 53 轮：Greenfield Model Runtime 与 Turn 模型绑定

## 目标

在不切换默认 Legacy 生产入口的前提下，实现 Greenfield Session 自己的模型事实源，并保证宿主状态、
模型控制和实际 Turn 执行不会使用彼此分离的数据。

本轮验收条件：

1. 模型目录、模型选择和凭证解析通过稳定 Port 注入，不泄漏具体 Registry。
2. `modelController`、`modelView`、`stateReader` 和 Turn 执行共享同一模型事实源。
3. 模型切换只影响后续 Turn；活动 Turn 不因运行时切模而改变模型或 reasoning。
4. 模型局部变化不重建 Capability Runtime Snapshot。
5. 保留旧实现的 model key 解析、available-first/find-fallback、凭证校验和 thinking clamp 行为。

## 分析结论

### 1. 模型状态不属于 Capability Snapshot

Capability Runtime Snapshot 继续只拥有提示词、工具、上下文 Provider、Context Strategy、Tool Policy 和
Observer 拓扑。模型是 Session 作用域的高频运行时状态；把它塞进 Snapshot 会导致每次切模都重新编译
Feature，并混淆能力拓扑与模型选择两个生命周期。

本轮新增独立的 `RuntimeTurnModelBinding`。Turn Pipeline 在 `snapshot_binding` 阶段同时取得：

```text
Capability Snapshot Lease
Session Model Runtime.bind()
        │
        └─> immutable Turn Model Binding
```

Binding 只包含该 Turn 的 model 和 reasoning。它是轻量冻结对象，不是整份 Snapshot 的复制。

### 2. Controller、View、State 与执行必须共享实例

如果 Composition Root 分别构造 Model Controller、Model View 和 State Source，即使类型都正确，也可能出现
宿主显示模型 A、实际执行模型 B。`GreenfieldRuntimeModelRuntime` 因此组合以下稳定能力：

- `RuntimeSessionModelController`
- `RuntimeSessionModelView`
- `RuntimeTurnModelBindingProvider`
- thinking level 只读状态

Greenfield Assembly 依赖该接口而非具体类；默认实现是 `GreenfieldRuntimeModel`。同一个实例被交给 Session
Assembly 和 Turn Pipeline。

### 3. 同步配置接口不能伪造异步持久化

现有 `setThinkingLevel()` 是同步 Port，而 Greenfield JSONL Store 通过异步文件锁写入。直接在同步方法里启动
fire-and-forget 写入无法保证成功、顺序或关闭前落盘。因此本轮只建立进程内模型事实源，没有宣称配置已经
持久化。后续若需要恢复模型配置，应定义显式异步配置合同或独立配置事务，不能把异步失败隐藏起来。

## 已实施

### Kernel

- 新增 `RuntimeTurnModelBinding` 与 `RuntimeTurnModelBindingProvider`。
- `TurnPipeline` 在 Snapshot 获取阶段绑定模型，并把绑定随 `TurnEngineRequest` 传入执行器。
- `AgentCoreTurnEngine` 优先使用 Turn binding；静态 model option 暂时保留为旧测试和过渡组合兼容路径。
- Turn binding 中的 `reasoning: undefined` 会明确覆盖静态 stream reasoning，避免切到 `off` 后沿用旧值。

### Runtime Host

- 新增不绑定 Registry 实现的 `RuntimeModelCatalog` 和 `RuntimeModelCredentialResolver`。
- 新增 `GreenfieldRuntimeModel`，实现模型控制、模型视图、thinking 状态和 Turn binding。
- 保留 available-first、find-fallback、包含 `/` 的 model id、`if-changed`、凭证失败不切模及切模后重新
  clamp thinking 的旧语义。
- canonical thinking level 按模型 reasoning/xhigh 能力收敛；模型自定义 level 原样保留。
- Greenfield State Source 只再提供 context 和 active tools；model/thinking 从 Model Runtime 读取。
- Greenfield Core Assembly 新增真实 `modelController` 与 `modelView`，能力矩阵由 5 项增加到 7 项。

## 测试

- Model Runtime 单元测试覆盖目录优先级、fallback、含斜杠 ID、缺失模型、`if-changed`、凭证拒绝、
  canonical/custom/xhigh thinking、刷新和 binding 不可变性。
- Turn 级集成测试在首个 Turn 阻塞期间切模，确认首个请求继续使用旧 binding，第二个 Turn 使用新模型。
- Agent Core Adapter 测试确认 request binding 覆盖静态 model 和 reasoning。
- Greenfield Backend 测试确认 Controller、View 和 State Reader 共享状态。
- 真实文件 Repository 集成测试继续通过，证明本轮没有改变会话消息和历史投影。

验证结果：

- `packages/runtime-core`：24 个测试文件、111 项测试全部通过。
- `packages/runtime-storage`：4 个测试文件、25 项测试全部通过。
- 根目录 `bun run check:quick` 通过。
- 根目录 `bun run check` 通过：Biome、monorepo `tsgo`、desktop-app `tsc`、admin `tsc -b` 和
  `check:guards` 均无错误。

## 明确未修改

- 未持久化模型或 thinking 配置。
- 未把模型或凭证放入 Capability Runtime Snapshot。
- 未改变 Prompt、Tool、Skill、MCP、上下文压缩和会话历史行为。
- 未切换默认 RuntimeHost 到 Greenfield Backend。
- 未删除 `AgentCoreTurnEngine` 的静态 model 过渡入口。
- 未实现剩余 Host Interaction、Execution、Configuration、Todo 和 Background Work 能力。

## 下一步

下一阶段应建立真实 Greenfield Runtime Composition Root：用宿主 Adapter 实现
`RuntimeModelCatalog`/`RuntimeModelCredentialResolver`，确保同一 Model Runtime 同时注入 Session Assembly
与 Turn Pipeline，并补齐创建、恢复和认证刷新场景。该组合根仍保持并行入口；在其行为合同和剩余能力完成前，
不替换默认 Legacy RuntimeHost。
