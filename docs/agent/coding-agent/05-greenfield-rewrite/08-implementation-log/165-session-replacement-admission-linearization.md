# 第 165 轮：Session Replacement 准入线性化

## 目标

在第 164 轮完成 replacement 资源事务后，继续固定并发到达的命令究竟绑定哪个 Conversation identity。
本轮覆盖真实 RPC transport 的并发 handler，而不是只测试内部队列：

- `switch_session` 后紧随的 prompt；
- 失败 `switch_session` 后紧随的 prompt；
- `fork` 后紧随的 prompt；
- 连续两个 `switch_session` 后紧随的 prompt；
- `switch_session` 后紧随的 Extension command。

Legacy 继续作为事实源。只有 Legacy/Greenfield 差分证明缺口时才允许修改生产实现。

## 既有覆盖审计

`agent-runtime-command-admission-differential.test.ts` 已经覆盖：

- idle `new_session -> prompt`；
- active Turn 中 `new_session -> prompt`；
- transition 期间的 `abort`；
- transport close、Memory flush、Host Bridge 和 Extension UI drain。

因此本轮没有复制 `new_session` 或 transport shutdown 场景，而是新增独立的 replacement admission 矩阵。

## 真实行为合同

### 1. 成功 switch 后的 prompt

RPC transport 会并发启动两个 handler，但先收到的 `switch_session` 必须先进入 identity transition 队列。
随后收到的 prompt 在真正开始执行时读取活动 Session，因此：

- prompt 只进入 target Provider 请求；
- prompt 只持久化到 target；
- source ownership 已释放，target ownership 仍持有；
- switch response、prompt response 和 Turn 终态分别恰好一次。

### 2. 失败 switch 后的 prompt

目标 ownership 获取失败时，排在 transition 后面的 prompt 不能丢失，也不能写入未取得 ownership 的 target：

- switch 返回一次失败响应；
- source 继续是权威 identity；
- prompt 只进入 source Provider 请求和 source 文件；
- source/target ownership 分别继续由原进程持有；
- prompt response 和 Turn 终态恰好一次。

### 3. fork 后的 prompt

宿主先经 `get_fork_messages` 读取真实 entry id。`fork` 与紧随其后的 prompt 并发进入 RPC handler 后：

- fork 先提交新的活动 identity；
- prompt 只持久化到 fork target，不回写 source；
- source ownership 释放，target ownership 持有；
- seed 和 queued prompt 各产生一次 Provider 请求；
- fork response、prompt response 和 queued Turn 终态分别恰好一次。

### 4. 连续 replacement

`source -> target A -> target B -> prompt` 必须按收到顺序线性化：

- 两个 switch 各返回一次成功响应；
- 最终活动 identity 是 target B；
- source 和 target A ownership 均释放；
- prompt 只进入 target B，不进入 source 或 target A；
- Provider、prompt response 和 Turn 终态都没有重复。

### 5. Extension command

`switch_session` 后紧随的 `/queued-session-new` 先作为 RPC prompt 进入同一准入边界，再由 Extension command
调用 `ctx.newSession()`：

- 第一次 `session_switch` 是 `resume`，`previousSessionFile` 为 source；
- 第二次 `session_switch` 是 `new`，`previousSessionFile` 必须为 target；
- 最终 identity 既不是 source，也不是 target；
- 外层 switch response 和 Extension command prompt response 各恰好一次。

这证明 Extension command 没有在 RPC 收包时提前捕获 source Session。

## 架构结论

本轮五项 Legacy/Greenfield 观察完全一致，没有发现生产实现缺口，因此没有修改生产代码。

当前两个实现采用不同内部结构，但满足同一外部合同：

- Legacy 通过 identity operation tail 与 Session operation admission，保证后到的工作等待已排队 replacement；
- Greenfield 通过 `CodingAgentGreenfieldActiveSessionHost.transitionTail`、`runExclusive()` 和
  `startActiveSessionOperation()`，在操作真正启动时解析当前活动 Session；
- RPC transport 保持 handler 并发，没有为了 Session 切换把 Host Bridge、UI response 或全部只读命令放入
  全局串行队列。

这里应保留“实现不同、合同相同”的边界，不需要抽出一个同时依赖 Legacy 和 Greenfield 的万能队列。

## 实施

新增 `agent-runtime-session-replacement-admission-differential.test.ts`：

- 使用真实 Vetta RPC CLI 独立可执行产物；
- 每个场景分别运行 Legacy 与 Greenfield；
- 使用真实 Provider HTTP 流、真实 Conversation 文件和 ownership lock；
- 同一 transport 连续写入 RPC frame，真实触发并发 handler；
- 同时断言 Provider、持久化、活动路径、ownership、RPC correlation 和唯一 Turn 终态；
- Extension 场景使用真实 TypeScript Extension 与 `session_switch` audit 文件。

## 验证结果

- `packages/cli-app/test/agent-runtime-session-replacement-admission-differential.test.ts`
  - 5 项测试通过；
  - Legacy 与 Greenfield 五组观察完全一致。
- 本轮未修改生产代码，因此没有为已经正确的实现制造额外抽象。

## TypeBox / Zod 判断

本轮没有新增外部协议、配置或持久化数据。测试通过已有 RPC validator 和 Provider fixture 进入系统；Extension
audit 只属于测试内部观察文件，不是生产输入边界，因此不引入 TypeBox/Zod。

## 明确未修改

- 没有修改 RPC transport 的并发 handler 模型。
- 没有把 `get_state`、Host Bridge 或 Extension UI response 强制加入 replacement FIFO。
- 没有改变 prompt、switch、fork 或 Extension command 的功能语义。
- 没有删除 Legacy 或合并 Legacy/Greenfield 内部队列。
- 没有因为测试全部通过而进行无证据的生产重构。

## 下一步

第 166 轮建议验证 replacement 生命周期副作用事务：真实 CLI 下覆盖 Extension
`session_before_switch/session_switch/session_before_fork/session_fork`、Ecosystem SessionEnd/SessionStart、取消、
目标 acquisition 失败和 after-binding 失败，确认每个生命周期副作用恰好一次、取消不静默资源、失败不发布 target
事件且新建/fork 失败不会遗留会话产物。仍以 Legacy 为事实源，只修复差分证实的问题。
