# 测试、可观测性与上线

## 1. 验证目标

验证重点不是“拿到过一次 snapshot”，而是证明以下端到端性质：

1. 一个 Turn 的所有外部能力与 Prompt 来源使用同一 generation；
2. 普通更新只影响捕获发生在发布之后的新 Turn；
3. 资源在老 Turn release 前不会被普通 reload/dispose；
4. hard revoke 能在明确的安全检查点即时收紧能力；
5. 失败、取消、close 和快速更新不会产生混合代或资源泄漏；
6. 用户和运维能够看到 desired、published、effective 与 failed 的差异。

类型检查无法证明上述时序，必须使用可控并发测试、合同测试和少量跨包集成测试。

## 2. 测试方法

### 2.1 使用显式同步点

竞态测试使用 barrier/deferred promise 控制以下阶段，不使用任意 `sleep`：

```text
before revision capture
after revision capture / before materialization
after snapshot acquire / before first model call
between model calls
after tool schema exposure / before tool execution
after tool execution starts / before side effect
before terminal release
before retired resource dispose
```

测试必须能确认更新精确发生在哪个同步点，并断言 Turn 的 generation id、实际 handler generation 和资源 release 顺序。

### 2.2 使用带代号的假实现

Prompt、Tool、Plugin Hook、MCP 和 Extension 测试 fixture 都返回显式代号，例如 `prompt-r1`、`tool-handler-r1`。断言可观察输出，不只断言某个 mock 被调用。

### 2.3 不使用真实外部系统

Provider、MCP、Plugin 进程和 Sandbox 默认使用内存 fake 或本地受控 child process。测试不得访问真实 Provider、付费 API、用户状态目录或生产 Plugin 数据。

## 3. 核心竞态矩阵

| 编号 | 更新时点 | 当前 Turn 预期 | 下一个 Turn 预期 |
| --- | --- | --- | --- |
| R1 | admission 捕获前完成发布 | 使用新代 | 使用新代 |
| R2 | 捕获后、物化前发布 | 使用已捕获旧代 | 使用新代 |
| R3 | snapshot acquire 后、首个 Model Call 前发布 | 使用旧代 | 使用新代 |
| R4 | 两次 Model Call 之间发布 | 第二次仍使用旧 Prompt/Tool/Skill | 使用新代 |
| R5 | schema 暴露后、Tool execution 前普通 disable | 执行旧 binding | 不再看到旧 Tool |
| R6 | Tool execution 已开始时普通 reload | 完成旧 handler，之后释放 | 使用新 handler |
| R7 | Tool execution 前 hard revoke | 拒绝且无副作用 | 仍不可用 |
| R8 | Tool 副作用开始后 hard revoke | 按可取消点报告真实结果 | 仍不可用 |
| R9 | Plugin Hook 两次 dispatch 之间 reload | 第二次仍用旧 hook | 使用新 hook |
| R10 | MCP tools-changed 在 Turn 内到达 | catalog 与 execution 仍为旧代 | 使用新 catalog |
| R11 | Session close 与 materialization 并发 | 不重新 publish，资源完整释放 | 不允许新 Turn |
| R12 | 候选编译失败 | 使用完整最后成功代并报告失败 | 重试或继续最后成功代 |
| R13 | R2/R3/R4 快速连续发布 | 已捕获者不改绑 | 捕获当时 current revision |
| R14 | retry 发起 | 原 Turn 不变 | retry 作为新 Turn 重新捕获 |
| R15 | same-Turn steer/follow-up | 沿用原 generation | 不适用 |
| R16 | subagent 创建 | 按合同继承父 Turn generation | 独立后续 Turn 再捕获 |

矩阵中的每一行至少由一个能够在错误实现下稳定失败的自动化测试覆盖。

## 4. 分层测试计划

### 4.1 `@vetta/runtime-core`

单元/合同测试：

- acquire context 只创建一次且贯穿 preparer/model/tool loop；
- snapshot 与 model binding 来自同一个 captured revision，二者之间发布更新不会产生混合代；
- success、failure、cancel、preparer throw、observer throw 均 release 一次；
- captured key 不因 acquire 期间的新 publication 改变；
- retired snapshot 等待最后 lease；
- compile failure 保留最后成功代；
- rapid reconfigure newest-wins 不影响已捕获 acquisition；
- Turn event 的 snapshot/generation metadata 顺序正确；
- queue、stop、usage 和 model binding 现有合同不变。

优先扩展现有 snapshot provider、runtime capability composition、turn pipeline 和 model-call frame 测试，不复制一套平行 fixture。

### 4.2 `@vetta/coding-agent`

单元/集成测试：

- process、workspace 与 session 三个 scope 在第一次 await 前原子捕获且不串用，父 revision 关系可追踪；
- composite key 缓存和同 key single-flight；
- Prompt、Resource、Skill、Personalization 在同 Turn 内稳定；
- Agent Mode、Plugin selection 和 Execution Mode 更新只在下个 Turn 生效；
- memory/todo 的 Turn-local 写入可见，但外部写入不可见；
- session-specific materialization failure 的 last-known-good 行为；
- session close/materialization/reload 三方竞态；
- retry、steer、same-Turn continuation 和 subagent 继承语义。

现有明确断言 Model Call 动态 refresh 的测试需要改成 Turn generation 合同测试，不能直接删除断言。

### 4.3 `@vetta/runtime-tools`

合同测试：

- catalog revision 不可变；
- schema 与 implementation binding 同代；
- ordinary retire 后旧 lease 仍可执行；
- 新 acquire 不再得到 retired binding；
- hard revoke 在副作用前拒绝；
- revoke 与完成竞态产生唯一、真实的 terminal result；
- lease 归零后 implementation 只 dispose 一次；
- deferred activation 只在固定 catalog 内变化。

### 4.4 `@vetta/runtime-mcp`

合同/进程边界测试：

- config revision 与 tool catalog 同代；
- tools-changed 发布新 revision，但不修改旧 lease；
- server fingerprint 相同可共享连接且 ref-count 正确；
- fingerprint 变化时新旧 supervisor 可并存；
- transport reconnect 不改变 generation；
- close/reload/cancel 不泄漏进程、socket、listener；
- credential identity 固定、rotation 可见、revoke fail-closed。

### 4.5 Plugin 与 Desktop

跨进程合同/组件测试：

- handler route 包含 plugin generation id；
- activate-new 成功后才 publish，失败保留旧 activation；
- retired handler 在旧 Turn lease 内仍可调用；
- Hook dispatch 使用 Turn binding，不查 current registry；
- Session/Turn hook 边界正确；
- ordinary disable、hard revoke、Renderer crash 的状态和错误不同；
- UI desired/published/effective/pending/failed 展示正确且全部走 i18n；
- IPC schema 的新增字段前后端消费者同时更新。

涉及真实 Electron wiring 时使用仓库 `verify:ui:*` 流程；纯状态选择优先抽成单元测试，不默认挂载完整应用。

## 5. 跨领域一致性测试

单领域测试无法发现混合代。至少增加一个 Coding Agent composition 集成测试，同时注册：

- `prompt-r1`
- `skill-r1`
- `tool-schema-r1` / `tool-handler-r1`
- `hook-r1`
- `mcp-r1`
- `plugin-r1`
- `execution-mode-r1`

在首个 Model Call 后发布全部 `r2`，再触发 Hook、Tool、MCP 和第二个 Model Call。当前 Turn 的所有输出必须仍为 `r1`；新 Turn 的所有输出必须全部为 `r2`。测试禁止接受部分 `r1`、部分 `r2`。

另加 apply failure 变体：使 `r2` 的 Plugin materialization 失败，断言整个 Turn 使用完整 `r1`，而不是其他领域已经切到 `r2`。

## 6. Hard revoke 安全测试

hard revoke 是唯一允许突破 Turn 隔离的控制面，必须单独审计：

- reason、scope、issuedAt、issuer/audit id 为必填；
- revoke epoch 单调，旧消息不能解除新 revoke；
- 重复 revoke 幂等；
- 收紧权限 fail-closed，放宽权限不回写活动 Turn；
- revoke 发生在副作用前时证明副作用为零；
- revoke 发生在不可取消副作用后时不得伪报为未执行；
- 长工具只在声明的安全取消点中止；
- Plugin/MCP/Extension/Provider credential 都遵循相同顶层语义；
- 日志不包含 token、完整工具参数或敏感 Prompt。

建议使用 property-based 或状态机测试覆盖 publish/retire/acquire/release/revoke 的不同排列，并断言：refCount 不为负、dispose 不重复、revoked binding 不产生新副作用。

## 7. 资源与性能测试

### 7.1 资源生命周期

验证：

- 长 Turn 持有旧代时，新代可以服务新 Turn；
- 老 Turn 结束后 Plugin process、MCP connection、Sandbox host、listener 和临时内容被回收；
- Session close 不遗留 retired generations；
- materialization 被取消或失败时，候选已获取资源全部释放；
- unchanged fingerprint 共享资源不会因一个 generation retirement 被提前关闭。

### 7.2 性能预算

采集但不在 revision 中存敏感内容：

- admission capture latency；
- cache hit/miss；
- materialization latency；
- active/retired generation count；
- generation lease age；
- Plugin/MCP/Sandbox 资源数；
- revision publication 到首次 effective 的延迟；
- apply failure 和 last-known-good fallback 次数。

建议先用当前主干建立基线，再为 P2 设定预算。性能优化必须保持 capture 线性化点；不能为了减少 latency 在 materialization 中重新读取 latest state。

## 8. 事件、日志与指标

### 8.1 事件字段

Turn start/terminal 与关键 Tool/Hook/MCP 事件至少关联：

```text
sessionId
turnId
snapshotId
generationId
sourceRevisionIds (redacted identifiers only)
effectiveAgentMode
effectiveExecutionMode
```

更新事件至少关联：

```text
desiredRevisionId
publishedRevisionId
affectedSessionId (if session scoped)
status: preparing | published | apply_failed | retired | disposed
failureStage / errorCode
```

hard revoke 事件另含 scope、reasonCode、auditId 和 outcome；不得记录 secret value。

### 8.2 指标

建议指标：

- `agent_runtime_revision_publish_total{source,result}`
- `agent_turn_snapshot_acquire_total{result,cache}`
- `agent_turn_snapshot_materialize_duration_ms`
- `agent_runtime_generation_active`
- `agent_runtime_generation_retired`
- `agent_runtime_generation_lease_age_ms`
- `agent_runtime_apply_failure_total{stage}`
- `agent_runtime_last_known_good_fallback_total`
- `agent_runtime_hard_revoke_total{scope,outcome}`
- `agent_runtime_generation_mismatch_total{domain}`

`generation_mismatch_total` 是防御性断言：schema 与 handler、Turn event 与 Hook binding、MCP catalog 与 supervisor generation 不一致时递增并 fail-closed。正常情况下必须为零。

### 8.3 日志约束

- 默认只输出 id/hash，不输出完整 Prompt、Skill 内容、用户路径内容、Tool 参数或凭证；
- source revision id 应不可逆地避免携带原文；
- apply failure 可记录来源类型和结构化错误码，敏感详情只进入受控诊断；
- sampled debug 日志也必须遵守同一脱敏规则。

## 9. UI 与运维可见性验收

对每个 Session 至少展示：

| 字段 | 含义 |
| --- | --- |
| Desired | 用户最近选择或文件系统检测到的目标值 |
| Published | 已通过控制面校验的 revision |
| Effective | 当前活动 Turn 实际持有的 generation |
| Next turn | 下一 Turn 将尝试使用的 revision |
| Apply status | idle、preparing、pending、failed |

示例文案语义：

```text
Execution Mode 已更新；当前任务继续使用 Full Access，下一个 Turn 起使用 Sandbox。
```

如果 materialization 失败，必须显示仍在使用的最后有效代和失败原因入口，不能只显示用户选择的新值。

## 10. 灰度上线

### 阶段 A：影子诊断

- 新 publisher/materializer 计算 generation key，但执行仍使用旧路径；
- 对比旧路径每个 Model Call 的实际 source revisions 与 admission 捕获 key；
- 只上报 mismatch，不改变行为；
- 确认日志脱敏和性能开销。

### 阶段 B：新 Session opt-in

- 仅新建 Session 在创建时选择新 runtime；
- 现有 Session 不热迁移；
- 先覆盖内部/开发渠道；
- 观察 apply failure、retired generation、资源数和 mismatch。

### 阶段 C：扩大默认范围

- Desktop、CLI 分渠道逐步提高新 Session 比例；
- hard revoke 路径必须先于普通 retirement 全量可用；
- 保留 Session-create-time 回退开关；
- 不用活动 Turn 热切开关。

### 阶段 D：唯一执行路径

- 达到退出条件后默认全量；
- 删除旧 Model Call refresh 和领域 pending；
- 删除影子双写与回退实现；
- 保留 generation 诊断和 hard revoke 审计。

## 11. 灰度退出与暂停条件

### 扩大灰度前必须满足

- `generation_mismatch_total` 为零；
- 无 snapshot/resource lease 泄漏；
- hard revoke 安全测试与审计事件通过；
- apply failure 都保留完整 last-known-good generation；
- admission/materialization latency 在批准预算内；
- Plugin/MCP/Sandbox 的 retired resource 能按预期回收；
- 关键 Desktop/CLI 状态文案无误。

### 出现以下任一情况应暂停扩大

- 同一 Turn 观测到两个 external generation；
- schema 与 execution handler generation 不一致；
- 普通更新中断活动 Turn；
- hard revoke 后仍启动新的敏感副作用；
- Session close 后 retired resource 持续增长；
- apply failure 被 UI 误报为 effective；
- 需要通过重新引入 live current lookup 才能维持兼容。

## 12. 建议验证命令

每个实现阶段按实际变更范围运行：

```powershell
bun run check:quick
bunx vitest --run <directly-related-test-file>
bun run test:pkg @vetta/runtime-core
bun run test:pkg @vetta/coding-agent
bun run test:pkg @vetta/runtime-tools
bun run test:pkg @vetta/runtime-mcp
bun run test:changed
bun run check
```

不要求每个小阶段机械执行所有包测试，但公共合同改动必须覆盖全部生产者和消费者；跨多个包或影响范围不明确时运行 `test:changed`。Desktop 真实 UI wiring 按 `docs/dev/README.md` 使用适用的 `bun run verify:ui:*`，不默认启动长驻 dev server。

文档阶段至少运行相对链接检查和 `git diff --check`；没有运行的测试与原因必须在交付中说明。

## 13. 最终验收场景

发布前用一个可重复的端到端场景验收：

1. 创建 Session，发布 `R1`；
2. 开始包含两次 Model Call、一次 Plugin Hook、一次 MCP Tool 和一次本地 Tool 的长 Turn；
3. 在第一次 Model Call 后，把 Prompt、Skill、Plugin、MCP、Execution Mode 和 Sandbox policy 更新为 `R2`；
4. 确认 UI 显示 desired/published 为 `R2`，active Turn effective 仍为 `R1`；
5. 当前 Turn 后续所有调用继续完整使用 `R1`；
6. Turn terminal 后旧资源在 lease 归零时 retirement；
7. 下一 Turn 完整使用 `R2`；
8. 重复场景并在工具副作用前发出 hard revoke，确认当前 Turn 被安全阻止且产生审计事件；
9. 注入 `R3` materialization failure，确认新 Turn 使用完整 `R2` 并显示 apply failure；
10. 关闭 Session，确认所有 active/retired generations 和外部资源归零。

只有该场景与分层自动化测试同时通过，才能认为“正在进行的会话不受外部更新影响，结束后使用变更状态”的产品合同真正落地。
