# 目标一致性合同

## 1. 术语

### Session / Conversation

长生命周期的会话容器和持久化历史。它可以包含多个 Turn，不是本方案的配置冻结边界。

### Turn

从 Kernel admission 分配 `turnId`、绑定 Runtime Snapshot 开始，到产生 `completed`、`failed` 或
`cancelled` 终态为止的一次执行。

同一 Turn 包括：

- 首次模型调用；
- Tool Call / Tool Result 循环；
- 同 Turn 的自动 compaction 和错误恢复检查点；
- Kernel 队列在自然停止点消费的 follow-up；
- Todo、Plugin 或 Stop Hook 产生的同 Turn continuation；
- steering 被当前 Turn 接纳后的后续模型调用。

`retry()`、显式 `continue()`、用户在空闲 Session 中发送下一条消息，以及“立即发送”先取消旧 Turn 后启动
的新执行，均创建新的 Turn，应绑定最新已发布 generation。

### Model Call

Turn 内的一次模型请求。Model Call Frame 可以根据本 Turn 已发生的消息、工具结果和局部激活状态重新物化，
但不能切换外部状态 generation。

### Published Generation

一组已经完成读取、校验和解析的不可变外部状态及资源句柄。只有 publish 成功的 generation 才能被新
Turn 获取。文件刚发生变化、插件正在加载或 MCP 正在重建时只属于 candidate，不属于 current。

### Lease

对 generation 及其资源的活动引用。retired generation 在最后一个 lease 释放前，宿主不得仅因普通更新主动
销毁该 Turn 仍需的 Plugin handler、MCP connection owner、Tool implementation 或内容快照。Lease 不保证这些
物理资源持续健康或调用必然成功。

### Hard Revocation

独立于普通更新的紧急收紧通道，例如组织策略 kill switch、恶意插件吊销、凭证撤销、敏感路径新增 deny、
用户明确“立即停止并禁用”。它可以影响活动 Turn，但只能减少权限或取消执行。

## 2. 核心不变量

### C1：单 Turn 单 generation

一个 Turn 的全部 Model Call、Tool dispatch、Hook dispatch、Prompt、Skill 和 Plugin provider 都必须使用同一个
外部状态 revision set。

### C2：更新不回写活动 Turn

普通 Settings 修改、Mode 切换、Plugin reload、MCP reload、Skill/Prompt 文件变化和 Tool 注册变化只能发布
新 generation，不得修改活动 Turn 持有的对象。

### C3：下一个 Turn 自动取最新已发布代

Session 无需重建或手动 reload。Turn admission 读取当时的 current generation；读取完成后即使 current pointer
再次变化，该 Turn 仍使用已捕获代。

### C4：Frame 可动态，来源 generation 不可动态

同一 Turn 的后续 Model Call 允许变化：

- messages 和 context budget；
- Tool Result 投影；
- MCP deferred search 在本 Turn 激活的工具名；
- Plugin provider 已产生并保存在 Turn state 的 effect；
- Todo、Memory 等由当前执行合法写入的 Session/Turn work state；
- steering/follow-up 输入。

不允许变化：

- Agent Mode、Execution Mode 和沙盒基础策略；
- Settings、persona、AGENTS.md 和基础 Prompt；
- 可发现的 Skill/Prompt 内容集合；
- Tool schema 与 normal availability generation；
- MCP server 配置及 Tool catalog generation；
- Plugin contribution、handler activation 和 Hook 集合；
- Extension/SDK Tool definition generation。

### C5：普通 retirement 与 hard revoke 分离

普通 disable/uninstall/reload 只影响新 Turn；旧 generation 仍可继续被调用，物理故障则按既有错误语义传播。
Hard revocation 通过独立 Registry 在执行入口检查，可以拒绝尚未开始的旧调用、取消在途调用或阻止凭证使用。

### C6：发布线性化

一次 Turn 要么绑定 revision N，要么绑定 revision N+1，不能得到 Settings=N+1、Plugin=N、MCP=N+1
这种没有被发布过的组合。跨域更新由发布事务形成一个 composite generation。

### C7：失败保留最后有效代，但必须可见

candidate 解析、校验或物化失败时不替换 current。UI 和诊断必须显示“更新失败，仍使用 revision N”，不能把
失败吞掉，也不能在不同 Session 静默应用不同的半成品。

## 3. 状态生效矩阵

| 状态 | 普通更新何时可见 | 活动 Turn 行为 | Hard revoke 行为 |
| --- | --- | --- | --- |
| Model/reasoning | 下一个 Turn | 保持 Turn model binding | 凭证撤销可使调用失败 |
| Agent Mode | 下一个 Turn | Prompt/Tool/Skill/Plugin mode 都保持旧值 | 组织策略可立即禁止某 mode 的能力 |
| Execution Mode | 下一个 Turn | 旧 sandbox/full-access policy 保持 | 新 deny/kill switch 可立即收紧 |
| Sandbox base policy | 下一个 Turn | 保持旧 policy；本 Turn 显式授权可写入 grant ledger | 敏感路径 deny 可立即生效 |
| Settings/persona | 下一个 Turn | system prompt 不改变 | 不适用 |
| AGENTS.md/Prompt | 下一个 Turn | 使用内容快照 | 不适用 |
| Skill catalog/body | 下一个 Turn | 已公布 Skill 可按原正文调用 | 恶意 Skill 可 hard revoke |
| Tool definition | 下一个 Turn | 已公布 schema/implementation 可继续调用；物理失败传播 | revoke 拒绝或取消 |
| MCP config/tools | 下一个 Turn | 保持同代配置；同代断线可按同配置 reconnect | server/capability revoke 立即阻止 |
| Plugin contribution | 下一个 Turn | 旧 activation 不因普通 retirement 被回收 | 插件 hard revoke 立即阻止 handler |
| Hook/interceptor | 下一个 Turn | 整个 Turn 使用同一集合和顺序 | handler hard revoke 可跳过并记录 |
| Extension/SDK Tool | 下一个 Turn | 旧 definition/runner 不因普通 retirement 被回收 | 显式 revoke 可拒绝 |
| Credential binding | 下一个 Turn | 使用 admission 捕获的不透明 credential binding | 显式撤销后下一次 resolve 失败 |
| Conversation/Todo/Tool output | 当前 Turn | 正常实时变化 | 由既有取消/权限语义控制 |

## 4. Sandbox 与授权的特殊规则

Snapshot 固定的是 Turn 的基础执行策略，不是冻结所有授权交互。

- `allow_once` 是当前 Tool Call 的局部决策。
- `allow_session` 可以写入 Session grant ledger；当前 Turn 后续调用是否可使用该 grant，由既有授权合同明确决定，
  但不能借 grant 改变 Tool schema 或 Execution Mode。
- 用户把全局模式从 sandbox 切到 full-access，只对新 Turn 生效。
- 用户或组织新增 deny、撤销 grant、禁用敏感能力时，可以走 hard revocation 立即收紧。
- 任何即时路径都不得从 sandbox 扩大为 full-access。

## 5. Credential 规则

Secret 不进入 `PublishedAgentState`、generation descriptor、事件或持久化历史：

- snapshot 只暴露不透明 `RuntimeTurnCredentialBinding`，调用方只能执行 `resolve()`；
- binding 在 admission 捕获 provider、credential identity、endpoint policy、允许的 auth scope 及其 provider-owned lease；
- identity/account/scope/endpoint 切换都发布新 binding，只对后续 Turn 可见；
- provider 若能证明 token rotation 不改变身份、权限语义和 endpoint policy，可封装在同一个不透明 binding 内，
  但 Kernel 不依赖该能力；
- credential revoke 属于 hard revocation，递增撤销 epoch，使活动 Turn 已捕获 binding 的下一次 `resolve()` 失败；
- 实现可以在私有执行闭包中短暂持有 secret，但不得把它复制进可序列化 revision、日志或诊断对象。

## 6. follow-up、steer、retry 与 queue

| 操作 | 是否新 Turn | generation |
| --- | --- | --- |
| streaming 中 `followUp` 被当前 Turn 自然消费 | 否 | 沿用当前 Turn |
| streaming 中 `steer` 被当前 Turn 消费 | 否 | 沿用当前 Turn |
| 队列“立即发送”取消当前 Turn 后启动 | 是 | 获取最新 current |
| failed/cancelled 后手动 resume queue | 是 | 获取最新 current |
| `retry()` | 是 | 获取最新 current |
| 显式 `continue()` | 是 | 获取最新 current |
| 自动 compaction 后同 Turn 继续 | 否 | 沿用当前 Turn |
| Conversation continuation/rollover 但 `turnId` 不变 | 否 | 沿用当前 Turn |

## 7. Subagent 与工作流边界

Subagent 是新建的独立 Session/Turn，不是父 Turn 的续段。采用独立 admission，而不是跨 Session 复制父
revision set：

- 父 Turn 在 generation N 中调用 `spawn_agent` 时，父 Turn 自身仍完整使用 N；
- child 首个 Turn 在自己的 admission 捕获当时已经发布的完整 generation，可能是 N，也可能是 N+1；
- child 有独立 `RuntimeSnapshotLease` 和资源生命周期，父 Turn 结束不会释放 child 正在使用的资源；
- 父消息快照、显式传入的 child profile 与经过过滤的 MCP view 是 child 创建请求的不可变输入，不共享父 Tool 对象；
- 对既有 child 的 follow-up 是 child 的新 Turn，在 child admission 重新捕获最新 published generation；
- 用户独立打开 child Session 后发送消息遵循同一规则。

该规则保证“正在执行的 Turn 不被外部更新回写”，同时避免父子 Composition 共享资源 lease 或引入隐式的
跨 Session 因果配置。若产品未来需要可复现实验式的父子同代执行，应新增显式 `revisionProjection` 协议，
不能通过共享 mutable runtime 对象实现。

## 8. 物理故障不是配置更新

Snapshot 保证逻辑 generation，不保证外部世界永不失败：

- MCP 进程崩溃可以按同一 generation 的原配置重连；不得自动切换到新配置。
- Plugin renderer/worker 崩溃可以使旧 handler 调用失败；错误必须归因于 generation 对应的宿主故障。
- 文件被外部删除不影响已经复制或内容寻址缓存的 Prompt/Skill；尚未物化的裸路径引用不满足本合同。
- 网络、Provider 和凭证服务失败沿既有错误/重试语义传播。

Lease 只阻止宿主因普通 retirement 主动回收旧代，不保证进程、连接或远端服务存活，更不保证 Turn 无损完成。
完整分类和恢复边界见 [Turn Binding 的能力边界](./08-binding-boundaries.md)。

## 9. UI 合同

设置 UI 可以立即显示用户选择，但必须区分：

- `desired`：最新已接受的用户选择；
- `published`：已经成功构建、可供新 Turn 获取的 generation；
- `effectiveForActiveTurn`：活动 Turn 正在使用的值；
- `pendingForActiveTurn`：desired/published 与活动 Turn 不同。

推荐文案语义是“将在下一次运行生效”，而不是禁用开关或报“Agent 正在运行，无法修改”。发布失败时恢复或
标记 desired 状态，并展示可诊断错误。
