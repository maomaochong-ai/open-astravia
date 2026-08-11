# 153：活动 Turn 会话切换与所有权转移闭环

## 目标

在第 152 阶段完成 RPC Turn 唯一终态与失败恢复后，本阶段处理活动 Turn 期间执行 `new_session`、
`switch_session` 和 Extension 会话命令的并发语义。目标是保持 Legacy 可观察行为，同时把 Greenfield 的
会话身份、Turn 中断、事件转发和所有权转移收敛到同一个活动会话事务宿主。

本阶段不改变会话文件格式、RPC 命令格式、Provider 行为或 Extension 功能。

## 暴露的问题

真实 Vetta CLI 基线显示，Legacy 在活动 Turn 中切换会话时会先执行 `session_before_switch`，获准后断开旧
Agent 事件并中止旧 Turn。Greenfield 原实现则先等待旧 Turn 自然结束，因此面对不结束的 Provider 流会永久阻塞。

同时，原 `waitForIdle` 采用“先读状态、后订阅事件”的顺序。如果终态恰好发生在两步之间，等待者可能永远收不到
事件。RPC 行处理本身允许并发，因此普通 prompt 和 Extension Command 还需要一个统一的 Turn 准入点，避免在会话
切换事务中途读取到旧绑定。

## 实施内容

### 活动 Session 操作准入

`CodingAgentGreenfieldActiveSessionHost` 增加内部使用的 `startActiveSessionOperation`：

- 操作的启动与会话切换共用同一条事务尾链；
- 操作只在此前已排队的切换完成后读取当前活动 Session；
- 准入边界只保护“选择 Session 并启动操作”，不持有整个 Turn，否则活动 Turn 无法被后续切换中断；
- RPC 的 prompt、steer、follow-up 和 Extension Command 统一通过该入口启动。

该设计没有把整个 Agent 执行改造成粗粒度互斥锁，Turn 的流式执行仍由 Runtime Session 自己拥有。

### 活动 Turn 切换顺序

`newSession` 与 `switchSession` 现在执行以下顺序：

1. 在旧 Session 仍可观察时执行可取消的 `before` 生命周期；
2. 若取消，保留旧 Turn，不发送 abort；
3. 若获准，中止旧 Turn 并等待其回到 idle；
4. 创建或恢复目标 Session，并准备宿主绑定；
5. 目标绑定提交和 `after` 生命周期成功后，释放源 Session 所有权；
6. 失败时回滚目标绑定并恢复源 Session。

中止期间旧 Session 的尾部终态事件不会转发给 RPC 消费者。这与 Legacy 在切换前断开旧 Agent 事件监听的行为一致，
也避免旧 `agent_end` 被误认为目标 Session 的终态。

### 空闲等待竞态

`waitForIdle` 改为先安装终态订阅，再读取 `isStreaming`。订阅安装期间同步发生 `agent_end` 或 `aborted` 时也会正确
解除订阅并完成等待，不再存在“状态读取与事件订阅之间丢失终态”的窗口。

### Fork 边界

活动 Turn 上的 Fork 继续采用 idle gate。Fork 需要稳定的历史节点和上下文快照，不能照搬 Legacy 在活动流上的非事务
修改。该限制没有新增对外功能；只是继续明确 Greenfield 不模拟一个可能产生不完整分支的竞态路径。

## 真实 CLI 差分

新增 Legacy/Greenfield 双后端真实 Vetta CLI 门禁，分别覆盖：

1. 活动 Provider 流期间执行 `new_session`；
2. 活动 Provider 流期间执行 `switch_session`；
3. 活动 Provider 流期间执行调用 `ctx.newSession()` 的 Extension Command。

每个场景都验证旧 Provider 连接关闭、旧 Turn 不泄漏 `agent_end`、源所有权释放、目标所有权持有、会话身份改变、
切换后 idle、同进程继续成功、按目标会话重启后继续成功，以及三次真实 Provider 请求。

## 安装产物

独立安装 CLI 产物增加活动 Turn `new_session` 门禁。测试编译 standalone 可执行文件并安装到仓库外临时目录，验证：

- 活动 Provider 请求被关闭；
- 源 `.owner.lock` 被释放，目标 `.owner.lock` 被获取；
- 旧 Turn 尾部终态不泄漏；
- 同进程和使用目标会话文件重启后均可继续；
- 三个 Turn 对应三次真实 Provider 请求。

## 类型校验选择

本阶段没有新增不可信 JSON、配置文件或协议输入，只增加进程内并发控制和测试观察值，因此不引入 TypeBox/Zod。
TypeScript 接口与现有 RPC Schema 已覆盖边界；为内部控制流增加运行时 Schema 不会提升正确性。

## 测试

- Active Session Transition Host：10 项通过；
- Greenfield IM RPC Adapter：13 项通过；
- 活动 Turn 会话切换 Legacy/Greenfield 真实 CLI 差分：3 项通过；
- 第 152 阶段终态与恢复回归：3 项通过；
- 独立安装 CLI 产物：8 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

## 明确未修改

- 未新增或删除 RPC 命令，也未改变 prompt fire-and-forget 确认格式；
- 未改变 Tool、Skill、MCP、知识或 Extension 的功能集合；
- 未改变 Legacy/V2 会话格式和迁移规则；
- 未改变 Provider 重试、错误或流式内容策略；
- 未把产品会话切换策略下沉到通用 Runtime Core；
- 未引入新的生产依赖或运行时 Schema 库。

## 结果

Greenfield 现在具备与 Legacy 一致的活动 Turn 会话切换可观察行为，同时保留明确的事务所有权：旧 Turn 由源 Session
中止，目标 Session 完成绑定后成为唯一活动者，源所有权随后释放。普通 RPC Turn 和 Extension Command 共用同一准入
边界，空闲等待也不再丢失同步终态事件。

## 下一步

下一阶段应审计剩余会话级 RPC 控制命令在并发输入下的顺序合同，重点建立“切换请求已入队后又收到 prompt/steer/
follow-up”以及进程关闭与切换重叠时的真实 CLI 基线。先确认 Legacy 的现有可观察行为，再决定这些输入应延迟到目标
Session、明确拒绝，还是保持现有队列语义。
