# 第 166 轮：Session Replacement 生命周期副作用

## 目标

在第 164、165 轮完成 replacement 资源事务与并发准入后，本轮继续冻结会话替换产生的外围生命周期副作用：

- Extension `before/after`、binding `prepare/commit/rollback/finalize`；
- Ecosystem Hook `SessionEnd` cause 与目标 `SessionStart` source；
- 取消、目标 acquisition 失败、after-transition 失败；
- 未提交 new/fork target 的文件、Hook、listener 与 binding 清理。

目标仍是架构重构中的功能兼容，不修改会话、工具、Extension 或 Hook 的业务语义。

## Legacy 事实基线

`SessionNavigator` 的既有顺序是：

1. Extension `session_before_switch/session_before_fork` 可先取消；取消时不终止 Turn、不结束 Hook Session，也不创建 target。
2. 通过后，source 分别发送 `SessionEnd("new_session" | "switch_session" | "fork_session")`。
3. replacement 成功后，target 首个 Prompt 才发送：
   - new：`SessionStart("clear")`；
   - switch：`SessionStart("resume")`；
   - fork：`SessionStart("clear")`。
4. replacement 失败且 source 仍是权威 identity 时，source 重新挂起 `SessionStart("resume")`。
5. SessionEnd 是 best-effort 生命周期通知，Hook adapter 失败不阻止 identity replacement。

既有真实 CLI 差分已经覆盖 Extension fork 取消、`skipConversationRestore`、成功切换、目标锁冲突和失败后 source 恢复；本轮不复制这些业务场景，而是在 Host/Composition 层补齐 Hook 事务观察。

## 发现的缺口

Greenfield 原实现只在 Session 资源 `dispose()` 时调用 `runSessionEnd("dispose")`。因此：

- new/switch/fork 丢失了真实 SessionEnd cause；
- new/fork target 的首次 SessionStart 错误地沿用 create/resume 默认来源；
- replacement 回滚后 source 没有新的 pending SessionStart；
- 若 target 在 commit 前被 dispose，会产生一个从未启动却收到 `SessionEnd("dispose")` 的虚假生命周期。

这不是 Tool、Prompt 或 Session 功能变化，而是 Greenfield 外围适配遗漏了 Legacy 已有的生命周期合同。

## 架构决定

### 1. Composition 持有 Hook 状态

`GreenfieldRuntimeComposition` 新增窄 `sessionHooks` 能力：

- `end(sessionId, cause)`：结束当前 Hook Session，保证一次；
- `start(sessionId, source)`：设置下次 Prompt 的 SessionStart；若先前已结束，则重新激活 source；
- `discard(sessionId)`：丢弃未提交 target，禁止其释放阶段发送虚假 SessionEnd。

Hook Runtime、pending start 与 dispose 去重仍由产品 Composition 持有；Runtime Core、Session Backend 和 Active Host 不依赖具体 Codex/Claude Hook 实现。

### 2. Active Host 只做事务编排

`CodingAgentGreenfieldActiveSessionHost` 在 Extension before 通过并中止活动 Turn 后结束 source Hook Session，再静默后台 identity 资源；目标创建后按 replacement kind 设置 target start source，再进入既有 binding/identity commit。该切点与 Legacy 的 `abort → SessionEnd → quiesce/replace` 顺序一致。

失败时只在 `activeSession === previous` 的情况下恢复 source Hook Session。若 transition 已提交、仅 finalize 或 previous dispose 清理失败，target 继续是活动 Session，不做伪回滚。

### 3. 未提交 target 先 discard 再 dispose

binding prepare/commit/after 或 fork target 初始化失败时，先 discard target Hook 生命周期，再释放 Session、删除 new/fork 文件。这样资源仍正常回收，但不会对外发布未提交 identity 的 Hook 结束事件。

没有引入通用 Transaction Manager；Extension binding 继续使用原有 `prepare/commit/rollback/finalize`，Hook 生命周期只作为 Composition 的独立外围能力参与同一宿主编排。

## 实施

- `greenfield-runtime-composition.ts`
  - 为每个 Session 登记 Hook lifecycle controller；
  - 支持 end/start/discard、Session id continuation 重绑定与 composition dispose 去重；
  - 对外导出 `GreenfieldRuntimeSessionHookLifecycle`。
- `greenfield-active-session-transition-host.ts`
  - new/switch/fork 分别接入正确 SessionEnd cause 与 SessionStart source；
  - 失败且 source 仍活动时恢复 `SessionStart("resume")`；
  - rollback target 在 dispose 前 discard Hook 生命周期。
- `greenfield-active-session-transition-host.test.ts`
  - 固定成功、取消、锁冲突、prepare/after 失败和 fork 保持上下文时的 end/start/discard 调用。
- `greenfield-ecosystem-hook-runtime.test.ts`
  - 使用真实 Composition、真实文件 Conversation 和真实 Provider Turn 覆盖 new → switch → fork → dispose；
  - 验证 after-transition 失败只恢复 source、删除 target 文件且不发布 target Hook 事件。

## 验证结果

- Active Session Host：12 项通过。
- Greenfield Ecosystem Hook Runtime：3 项通过。
- 真实 Vetta CLI active-turn replacement 差分：4 项通过。
- 真实 Vetta CLI Extension history 差分：2 项通过。
- Legacy/Greenfield 的 ownership、取消、fork context、失败恢复与 Extension 事件合同未发生回归。

## TypeBox / Zod 判断

本轮没有新增 JSON、配置、RPC 或持久化输入边界。`SessionEndCause`、`SessionStartSource` 和 session id 均为进程内已类型化调用；`sessionHooks` 也不是不可信数据解析器，因此不引入 TypeBox/Zod。现有 RPC 外部 frame 仍由既有 TypeBox 边界校验。

## 明确未修改

- 没有改变 Extension 事件名称、payload、取消或 `skipConversationRestore` 语义。
- 没有改变 Tool、Prompt、MCP、Skill、Todo、后台任务或 Conversation 历史功能。
- 没有把 Hook 实现下沉到 Runtime Core。
- 没有把全部 replacement 副作用合并成通用 middleware 或万能事务框架。
- 没有让清理阶段错误回滚已经提交的 target identity。

## 下一步

第 167 轮建议补齐独立可执行产物的 replacement 生命周期门禁：通过 Vetta CLI 的真实 Hook 配置和 TypeScript Extension audit，同时观察 new/switch/fork 的 Extension 与 Hook 顺序、Hook command 失败的 best-effort 语义、进程退出的 `session_shutdown`/`SessionEnd("dispose")` 恰好一次。若安装产物与进程内 Composition 观察一致，则继续审计 post-commit finalize/previous-dispose 错误的 RPC 可观察结果，不为测试注入生产故障开关。
