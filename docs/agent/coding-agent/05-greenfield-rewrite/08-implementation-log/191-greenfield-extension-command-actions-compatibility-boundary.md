# 第 191 阶段：Greenfield Extension Command Actions 兼容边界

## 阶段目标

在不修改 Extension 对外 API 的前提下，将 `ExtensionCommandContextActions` 与 Greenfield 会话事务、分支导航宿主之间的类型耦合收敛到显式适配器。

本阶段延续第 190 阶段的原则：Greenfield 宿主只暴露自身需要的中性端口，Legacy 和 Extension 兼容语义由外层适配器负责。

## 实施前问题

第 190 阶段移除了活跃会话事务宿主对 `SessionManager` 构造和旧格式迁移的直接依赖，但仍存在三处边界泄漏：

1. 活跃会话宿主通过 `ExtensionCommandContextActions["newSession"]` 定义自身参数；
2. 分支导航宿主通过 `ExtensionCommandContextActions["navigateTree"]` 定义自身参数；
3. CLI Composition Root 手工理解并拼装 Extension 的全部 command actions。

这会导致 Extension 公开 API 的变化向 Greenfield 宿主内部扩散，也使 `newSession.setup(SessionManager)` 的 Legacy 兼容职责仍然不够集中。

## 目标结构

```text
ExtensionCommandContextActions
             |
             v
Greenfield Extension Command Actions Adapter
  - Extension newSession -> neutral newSession
  - setup callback -> seed initializer
  - tree options -> neutral navigation options
  - fork result -> Extension result
             |
             v
Greenfield host ports
  - Active Session Host
  - Branch Navigation Host
  - Resource Reload Host
```

只有 Extension command actions adapter 需要同时理解 Extension API 与 Greenfield 中性端口。

## 实施内容

### 1. 中性会话初始化合同

活跃会话宿主新增：

- `CodingAgentGreenfieldSessionSeedTarget`
- `CodingAgentGreenfieldSessionSeedInitializer`
- 中性的 `CodingAgentGreenfieldNewSessionOptions`

`newSession` 现在只识别 `parentSession` 和可选 `seedInitializer`。宿主负责生成目标 ID、调用 initializer、恢复 V2 会话以及失败回滚，不再认识 Extension setup 回调类型。

### 2. Legacy setup importer 转换为 initializer factory

`CodingAgentLegacySessionSetupSeedImporter` 保留原有 `createSeed` 兼容合同，同时新增 `createInitializer(setup)`：

- 对外继续接受真实 `SessionManager` setup 回调；
- 对内返回中性的 `CodingAgentGreenfieldSessionSeedInitializer`；
- 临时会话、快照、严格 V2 迁移和清理行为保持不变。

第 190 阶段已经导出的 seed import 类型继续从兼容适配器导出，避免无必要地破坏该阶段建立的接口。

### 3. Extension command actions 适配器

新增 `createCodingAgentGreenfieldExtensionCommandActions()`，集中映射：

- `waitForIdle`
- `newSession`
- `fork`
- `navigateTree`
- `switchSession`
- `reload`

其中 `newSession.setup` 通过注入的 initializer factory 转换；`fork` 继续只向 Extension 返回 `cancelled`，不会泄漏 Greenfield 内部的 fork 文本结果。

### 4. 分支导航中性参数

新增 `CodingAgentGreenfieldBranchNavigationOptions`，保留 summarize、customInstructions、replaceInstructions 和 label 的现有语义。分支导航宿主不再借用 `ExtensionCommandContextActions` 的参数类型。

### 5. Composition Root 接线

CLI Runtime Composition Root 改为：

- 构造 Legacy session setup importer；
- 将 Greenfield 各宿主方法作为端口传入 command actions adapter；
- 把适配器生成的完整 Extension actions 绑定到 Extension session host。

CLI 不再手工执行 setup、fork 返回值等兼容转换。

### 6. 架构守卫

新增并固化以下规则：

- 活跃会话事务宿主不得导入或引用 `ExtensionCommandContextActions`；
- 活跃会话事务宿主不得导入 `core/extensions`；
- 分支导航宿主不得使用 `ExtensionCommandContextActions` 定义自身参数；
- 显式 Extension command actions adapter 可以依赖 Extension API。

## 行为保持

本阶段没有改变：

- Extension `newSession.setup(SessionManager)` 公开合同；
- setup 消息迁移到 Conversation V2 的结果；
- parent session 语义；
- fork、tree summary、label、switch 和 reload 行为；
- Extension command 的参数解析和错误上报；
- 工具、提示词、Skill、MCP、模型调用和显式 Legacy Runtime。

## 类型校验选择

没有引入 TypeBox 或 Zod。这里是进程内函数端口与静态类型映射，没有新增外部数据或持久化 schema；运行时校验不会增加有效边界保护。

## 验证记录

失败优先基线：

- 新增架构守卫后，当前实现按预期得到 38 通过、1 失败；
- 新增动作适配器合同测试后，在实现文件不存在时按预期加载失败。

实施完成后：

- Extension command actions adapter 与活跃会话宿主测试：17/17 通过；
- 质量守卫测试：39/39 通过；
- CLI Greenfield runtime host 与 ecosystem hook 测试：20/20 通过；
- `bun run check:quick` 通过；
- 完整 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 下一步边界

下一阶段应审计 Greenfield composition 对产品能力实现的直接导入，优先区分：

1. knowledge 路径与 writer 端口；
2. subagent profile prompt；
3. product tool factory 与 todo lock；
4. 纯类型依赖和真实执行依赖。

不应把这些不同业务能力一次性迁移；应先形成依赖分类和允许列表，再选择一个完整能力边界实施。

## 阶段结论

Greenfield 活跃会话和分支导航宿主已经不再借用 Extension command action 类型。Extension 公开 API、Legacy setup 和 Greenfield 中性端口之间的转换集中到了单一、可测试的兼容适配器，CLI Composition Root 只负责注入实际宿主实现。
