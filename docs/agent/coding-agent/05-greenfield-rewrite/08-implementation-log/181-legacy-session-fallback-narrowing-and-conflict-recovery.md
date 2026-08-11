# 第 181 轮：Legacy Session 回退收窄与目标冲突恢复

## 目标

第 180 轮建立了唯一 Legacy 执行 Gateway，但旧会话迁移的 `locked`、`not-representable` 和 `failed`
仍都会触发自动 Legacy 回退。进一步审计发现，这三个状态不是同一种兼容性缺口：

- `locked` 是并发所有权冲突，Legacy Runtime 使用同一把 `<session>.lock`，再次启动只会重复失败。
- `not-representable` 是 Greenfield V2 当前确实无法无损表达旧会话内容，仍需要兼容执行。
- `failed` 是兜底 `catch` 产生的未分类结果，可能包含权限、磁盘和目录错误，不应被误判为需要旧实现。

本轮目标是只保留真实的格式兼容回退，并为已知的确定性目标冲突提供非破坏恢复。

## 审计结论

### 1. `locked` 不是回退条件

Greenfield 迁移适配器和 Legacy `SessionManager` 都使用 Coding Agent Legacy Session Format Adapter
提供的同一把锁。若迁移发现锁被占用，回退到 Legacy 不会增加成功机会，只会再次争抢同一文件。

正确语义是将 Legacy 锁持有者映射为 Runtime Storage 的中性
`ConversationOwnershipConflictError`，由 CLI 继续输出既有 `startup` 失败帧和退出码 `2`。这样不改变
对外锁冲突合同，也不让并发错误变成架构回退。

### 2. 只有 `not-representable` 是真实 Session 兼容缺口

迁移器明确识别以下 Runtime Storage 错误为无法表达：

- `conversation_corrupt`
- `conversation_invalid_event`
- `conversation_invalid_command`

它们继续返回带 `errorCode`、首个 `issueCode` 和 `issueCount` 的 `not-representable` 证据，并允许通过
Legacy Gateway 执行原会话。其他错误直接抛出，不再包装成 `failed` 后静默回退。

公开 RPC `RpcSessionMigrationStatus` 暂时仍保留历史成员，避免本轮架构修复制造 wire/type 破坏；自动回退策略
已经 fail-closed，明确拒绝 `locked`、`failed`、`migrated` 和 `reused`。

### 3. 确定性目标冲突可以在 Greenfield 内恢复

旧会话迁移的主目标 ID 由 canonical source path 和完整源内容的 SHA-256 决定。若主目标已存在但内容不同，
原实现返回 `conversation_already_exists`，随后错误地进入 Legacy。

现在迁移流程：

1. 先尝试原确定性主目标。
2. 仅在 `conversation_already_exists` 时尝试 `${primaryTargetSessionId}-recovery`。
3. recovery 文件仍采用独占发布和完整内容相等复用，不覆盖主目标。
4. 后续启动稳定复用同一 recovery 目标。
5. 若 recovery 自身也发生非相同内容冲突，错误直接向上抛出，不进入 Legacy。

该策略保留冲突现场，避免随机目标不断增生，也不把存储冲突误判为旧功能依赖。

## 实施内容

### 1. 收窄迁移结果

`GreenfieldImLegacySessionMigrationStatus` 和内部 fallback 联合现在只包含：

- 成功：`migrated`、`reused`
- 兼容回退：`not-representable`

`locked` 改为抛出中性 ownership conflict；未分类异常原样抛出。

### 2. 增加稳定 recovery 目标

迁移适配器新增小范围冲突恢复函数，只捕获 Runtime Storage 的 `ALREADY_EXISTS`。迁移、规范化、校验、
原子发布和相同内容复用仍全部复用 `migrateLegacySessionToV2()`，没有复制存储算法。

### 3. 收紧自动 Legacy 回退策略

`assertAllowedAutomaticLegacyRuntimeFallback()` 对 `legacy-session` 只接受带
`status: "not-representable"` 的证据。其他历史状态全部拒绝，防止未来调用方重新引入宽泛回退。

### 4. Extension 缺口审计

当前 Greenfield RPC/IM profile 已覆盖全部已知且适用的 Extension event、tool、command 和 action；快捷键与
renderer 属于非交互宿主不适用能力。`legacy-extension` 目前只承担未知未来 event/capability 的显式前向兼容
边界，本轮未改变该功能。

## 测试

### 迁移与策略单元测试

- 锁被占用时抛出 `ConversationOwnershipConflictError`，并保留 pid、hostname 和时间信息。
- 主目标冲突时不覆盖原文件，创建稳定 recovery 目标，并在下一次迁移复用。
- 目标目录发生未分类文件系统错误时直接拒绝，不返回 Legacy fallback。
- 不可表达的旧内容仍返回完整 `not-representable` 证据。
- 自动回退策略只允许 `not-representable`，拒绝四个非回退状态。

### 真实 CLI 子进程测试

新增独立的 bundle CLI 进程合同：

1. 持有真实 Legacy source lock 后启动 Greenfield IM，收到既有 `startup` ownership conflict、退出码 `2`，
   stderr 不包含 `fallback=legacy-session` 或 `effective=legacy`。
2. 人工制造主目标内容冲突后启动 CLI，Runtime 保持 `greenfield-im` 并报告 `migrated`；第二次启动复用相同
   recovery session 并报告 `reused`；主冲突文件保持原内容。

### 回归验证

- 新增/修改迁移、策略和 CLI 子进程测试：19 项通过。
- 既有 Runtime 选择测试：10 项通过。
- 既有 Print、Provider、Tool、Extension 和旧会话兼容测试：18 项通过。
- `bun run check:quick`：通过。
- 根目录 `bun run check`：通过。

## TypeBox / Zod 判断

本轮只收窄进程内判别联合、映射已有错误类型并调整内部控制流，没有新增外部 JSON、配置或持久化 schema。
Runtime Storage 和 RPC wire 仍使用原有边界合同，因此不需要引入 TypeBox 或 Zod。

## 明确未修改

- 没有改变不可表达旧会话的 Legacy 执行能力。
- 没有覆盖、删除或修改冲突的主目标文件。
- 没有删除公开 RPC 历史状态成员。
- 没有改变 Tool、Prompt、Skill、MCP、Knowledge、Memory、模型调用或 Extension 行为。
- 没有改变显式 `--agent-runtime legacy`。
- 没有更新之前的过程文档，只新增本轮实施记录。

## 结果

旧会话自动 Legacy 回退从“锁、格式和任意异常”收窄为唯一真实兼容缺口
`not-representable`。并发锁冲突现在明确失败，确定性目标冲突在 Greenfield 内非破坏恢复，未知基础设施错误
保持可见，不再被旧 Runtime 掩盖。

## 下一步

下一阶段应处理最后一个自动回退来源 `legacy-extension`：

1. 固化当前已知 Extension event/capability 的 Greenfield 支持矩阵和真实进程门禁。
2. 区分“未知协议版本”与“宿主不适用 UI 注册”，未知版本应明确拒绝或要求显式 Legacy，不再自动执行旧内核。
3. 当自动 Extension 回退关闭后，Legacy Gateway 将只剩用户显式选择和不可表达旧会话两类入口。
4. 最后再制定不可表达会话的只读导出/升级策略；在该策略完成前不删除 Legacy Session 执行。
