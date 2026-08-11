# 第 170 轮：初始化失败回滚事务

## 目标

第 169 轮建立了已发布 Runtime 的可重试最终关闭合同，但构造期仍由各宿主手写 `catch` 清理。审计发现这些路径会在部分资源已经获取后出现以下不一致：

- Runtime Factory 创建 Kernel Session 后，外围控制器初始化失败时只释放 Composition 资源，没有关闭 Kernel Session。
- Coding Agent Composition 的顺序 `await` 清理会被首个失败短路，并遗漏 Todo、Context、Memory、Capability 及部分 Session registry。
- IM Host 通过变量分支推断当前所有者，Adapter/Capabilities 建立后的所有权转移不显式。
- Extension reload 的目标 Host 清理失败会阻止旧 binding 和 `session_start` 恢复，且清理错误覆盖真正的资源发现错误。

本轮只修复初始化资源事务，不修改 Tool、Prompt、Skill、MCP、Extension 或 Session 的业务能力。

## 初始化合同

初始化资源图遵循一次性 `acquiring -> committed` 或 `acquiring -> rolling-back -> rolled-back`：

1. 每个资源只在成功获取后登记回滚动作。
2. 新所有者建立后，旧登记项立即 dismiss，再由新所有者登记整体释放动作。
3. 初始化成功后 `commit()` 清空临时回滚计划，资源所有权交给正常 Runtime 生命周期。
4. 初始化失败后严格按获取顺序的逆序逐项回滚；某项失败不阻止更早资源继续释放。
5. 所有回滚成功时原样抛出初始化错误；回滚也失败时使用 `AggregateError`，原初始化错误同时作为 `cause` 和 `errors[0]`，避免清理错误冒充根因。
6. 构造失败的对象不进入活动 Session、Extension、MCP、Execution 或 Hook registry。

初始化回滚与最终关闭保持两个独立原语：

- `InitializationRollbackScope`：局部、一次性、严格逆序，不提供重试；只服务尚未发布的对象图。
- `RetryableCleanup`：已发布对象最终关闭，按 phase 全量尝试，并保留失败任务供后续重试。

## 实施

### Runtime Core

新增通用 `InitializationRollbackScope`：

- `defer({ id, rollback })` 在资源获取后登记回滚，并返回所有权转移所需的 dismiss 函数。
- `commit()` 表示对象图完成发布前准备，Scope 不再持有资源。
- `rollback(cause, message)` 严格逆序执行所有有效任务，并保留初始化错误为主错误。

`ComposedGreenfieldRuntimeFactory` 在资源创建后登记 Runtime Context 与 Composition 资源，在 Kernel Session 创建后追加 Session close。外围控制器创建失败时现在按 `Kernel Session -> Composition resources -> Runtime Context` 回滚，修复 Kernel Session 遗留；失败后同一个 Factory 可重新初始化。

### Coding Agent Composition Root

Session 资源创建现在按实际获取点登记：Conversation ownership、resource/config binding、Plugin MCP、MCP controller、Execution、Memory、Todo、Context、Subagent、Capability、Extension/Hook bindings。成功返回 `GreenfieldRuntimeResources` 前提交事务；任意中间失败时逆序回滚。

原 Capability 创建和系统提示词预览中的局部手写清理已并入同一事务，避免内外两套清理重复或遗漏。对 registry 的回滚使用条件删除，防止清除已被其他权威对象替换的绑定。

### CLI / IM Host

IM Runtime 启动显式记录以下所有权链：

`MCP source -> Runtime -> Session -> Extension/Active Session Host -> RPC Adapter -> Runtime Capabilities`

当 Active Session Host 接管 Session、RPC Adapter 接管 Active Session 与 Runtime、Capabilities 接管 Adapter/MCP/Extension 后，前一层回滚动作被 dismiss。启动失败不再依赖可选变量分支猜测所有者，也不会重复释放同一资源。

### Extension Session Host

- Session prepare 失败时继续执行旧 Runtime Action 重绑定和目标 Event Host 清理，并保留 prepare 错误为主错误。
- reload 失败时按原业务顺序执行目标 Host 清理、旧 Runtime binding 恢复、旧 `session_start` 恢复；任一回滚动作失败不会截断其余动作。
- 成功 reload 的事件顺序、命令绑定和旧 Host finalize 行为不变。

## TypeBox / Zod 判断

本轮合同只描述进程内资源获取、所有权转移和函数回调，不解析 RPC frame、JSON、配置或持久化数据，因此不引入 TypeBox/Zod。既有外部输入校验边界保持不变。

## 测试合同

- 通用 Scope：只回滚已获取资源、严格逆序、清理失败后继续、原始错误保持为 `cause/errors[0]`、无清理错误时原样重抛。
- Runtime Factory：外围初始化失败后先关闭 Kernel Session 再释放 Composition 资源；同一 Factory 随后可再次成功初始化。
- Extension reload：目标资源发现与目标清理同时失败时，仍恢复旧 binding 与生命周期，活动 Runner 不变。
- 既有真实 IM Runtime Host 测试继续验证正常启动、会话切换、Extension、ownership 和最终关闭行为。

## 明确未修改

- 没有新增生产故障注入选项、RPC wire 或持久化 schema。
- 没有改变 MCP 动态刷新、Skill 删除、Tool 动态注册或 Runtime snapshot 语义。
- 没有把一次性初始化回滚做成可重试最终关闭，也没有重建整个 Runtime 掩盖局部失败。
- 没有删除 Legacy 功能或调整 Greenfield/Legacy 选择策略。

## 验证结果

- `InitializationRollbackScope` 与 Runtime Factory：3 项通过。
- Runtime Session Backend 回归：13 项通过。
- Composition 初始化失败后 ownership 释放与同 Session 重启：1 项通过。
- Extension Session Host 初始化回滚：1 项通过。
- 真实 Greenfield IM Runtime Host 回归：16 项通过。
- `bun run check:quick` 通过。
- 根目录完整 `bun run check` 通过。

## 下一步

第 171 轮建议补充真实 CLI 初始化失败门禁：通过现有 Vetta CLI 启动会话，在可控的 Extension/MCP 启动失败下验证进程退出后无 conversation ownership lock、无 MCP/子进程、无重复 Hook/Extension 生命周期事件，并在同一路径立即重启成功。故障注入只放在测试适配器或测试 fixture，不增加生产配置面。
