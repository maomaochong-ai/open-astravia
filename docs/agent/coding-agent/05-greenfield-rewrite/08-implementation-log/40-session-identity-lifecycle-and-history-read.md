# 阶段 40：Session Identity/Lifecycle 与 History Read Port

## 目标

继续缩小 RuntimeHost 对完整旧 `AgentSession` 的依赖，先迁移低风险且职责明确的两类能力：

- 会话身份、文件路径与资源释放；
- 当前活动分支的只读宿主历史投影。

本阶段只改变能力的交付与调用边界，不改变会话创建、历史转换、事件、状态、分支或释放行为。

## 审计结论

阶段 39 的 Assembly 已允许 Backend 显式交付 Core Ports，但 RuntimeHost 仍通过完整旧 Session 直接读取：

```text
sessionId / sessionFile / dispose()
sessionManager.getEntries() + getSessionBranch()
```

这两组调用都适合先形成窄 Port。`bindExtensions()` 没有并入 Lifecycle，因为它是宿主 UI 交互绑定，包含独立的
Extension UI 语义；把它放进生命周期会重新混合资源管理和宿主集成职责。

## 新增合同

```text
RuntimeSessionIdentityLifecycle
  ├─ sessionId
  ├─ sessionPath
  └─ dispose()

RuntimeSessionHistoryReader
  └─ readHistory(): readonly HistoryEntry[]
```

`HistoryReader` 返回现有稳定 `HistoryEntry` 投影，不向 RuntimeHost 暴露旧 SessionManager、JSONL Entry 或分支树
内部结构；它只负责读取，不承载编辑、切换、删除或 fork 等写操作。

## Legacy 适配与 Assembly

新增两个旧实现适配器：

- `LegacyRuntimeSessionIdentityLifecycle` 将旧 Session 的 `sessionId`、`sessionFile` 和 `dispose()` 映射到新合同；
- `LegacyRuntimeSessionHistoryReader` 复用既有 `entriesToHistory()` 和当前分支选择逻辑，保持历史结果不变。

`RuntimeHostSessionAssembly` 现在显式交付 `lifecycle`、`historyReader` 和原有 `corePorts`。统一的
`createLegacyRuntimeHostSessionAssembly()` 负责组装旧 Session 适配器，供默认 Backend 和 create-only Backend
兼容适配器复用，RuntimeHost 不再自行推导这两类能力。

## RuntimeHost 迁移

以下调用已切换到新 Port：

- 会话注册和按路径查找使用 Identity/Lifecycle；
- in-flight buffer 与 running 标记使用 `sessionPath`；
- `getSessionPath()` 使用 Identity/Lifecycle；
- 单会话删除、释放及全量释放使用异步 `dispose()`；
- `getFullHistory()` 使用 History Reader，并复制只读结果后返回既有可变数组 API。

Assembly 合同测试使用与旧 Session 不同的 ID、路径、历史和 dispose spy，验证 RuntimeHost 实际消费 Backend
交付的 Port，而不是回退读取旧 Session。

## TypeBox / Zod 判断

两个 Port 都是进程内函数与只读值合同，不是来自 IPC、文件、网络或用户配置的不可信数据。本阶段不引入
TypeBox/Zod。若未来 History 数据跨持久化或 IPC 边界进入 RuntimeHost，应在该外部边界校验原始数据，而不是
校验已构造的 Port 对象。

## 明确未修改

- 没有修改旧 Session 的历史转换和当前分支判定。
- 没有迁移 `bindExtensions()`；它应属于独立 Host Interaction Adapter。
- 没有迁移 rename、message edit、branch switch/delete、fork 等历史写能力。
- 没有迁移 model、thinking、plugin、todo、background task 或 subagent 能力。
- 没有修改 Greenfield Session Backend，也没有切换生产默认 Backend。
- 没有改变现有 `SessionFacade` 的同步读取接口。

## 下一步分析

RuntimeHost 对旧 Session 的剩余调用已经主要集中为几组外围能力：

1. 历史命令：rename、replace、navigate-for-edit、switch/delete branch、fork；
2. 模型配置：model lookup/switch 与 thinking level；
3. 宿主交互：Extension UI binding；
4. plugin、todo、background task 与 subagent 管理。

下一阶段建议先补齐历史写操作的行为基线，再提取单一 `RuntimeSessionHistoryController`，使它和本阶段的只读
Reader 共同覆盖完整 History 能力。历史写操作包含持久化、分支导航和事件副作用，不能直接按方法搬运；测试需
先固定成功结果、非法目标、当前分支变化及 fork 血缘。Host Interaction 和 Model Configuration 应保持独立，
不并入 History 或 Lifecycle。

## 验证

- RuntimeHost Assembly 定向测试：1 个文件，8/8 通过。
- Runtime Core 完整测试：11 个文件，59/59 通过。
- Runtime Core build typecheck：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
