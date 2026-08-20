# 4. 测试与验收

> 本文保留首版故障矩阵；命令和新增 V2 合同以当前仓库脚本为准。

## 4.1 测试策略

subagent 的主要风险不是工具 schema，而是并发竞态、权限漂移、重复唤醒、文件锁和宿主关闭。因此测试顺序应是：纯 coordinator → 真实 child session → 权限/Hook → runtime 协议 → desktop 消费。

按仓库规则，新增测试后只运行具体测试文件，例如在对应包根目录：

```bash
bun scripts/quality/run-vitest.mjs --run packages/runtime-subagents/test packages/coding-agent/test/runtime-core/subagent-control-tools.test.ts packages/coding-agent/test/runtime-core/subagent-session-assembly.test.ts
```

完成代码改动后仍需在仓库根运行完整 `bun run check`；它不包含测试。

## 4.2 Coordinator 单元测试

建议新增：

```text
packages/coding-agent/test/subagent-coordinator.test.ts
```

覆盖：

1. `pending -> running -> completed` 正常路径；
2. factory 创建失败进入 failed 并释放 slot/name；
3. 三个 active child 后第四个立即拒绝；
4. 两个并发 spawn 相同 task name 只有一个成功；
5. terminal child 不占 active slot；
6. completed/failed/interrupted 均可 follow-up 再进入 running；
7. running child 的 follow-up 排队，不并发调用第二次 prompt；
8. interrupt 会 abort 并等待 idle；
9. parent dispose 级联 abort，之后禁止 spawn/follow-up；
10. list 按 path 稳定排序；
11. target 可由 ID、task name、完整 path 解析；
12. 非法 task name、未知 target、空 message 返回稳定错误；
13. wait 已有结果立即返回；
14. wait 收到任一 terminal 后返回；
15. wait timeout 不改变状态、不消费未来结果；
16. AbortSignal 能取消 wait 且清理 waiter；
17. 不使用 interval/sleep polling；
18. terminal generation 只能由 wait 或 notification 消费一次；
19. 多 child 同时完成合并成一次父通知；
20. follow-up 后的新 generation 可以再次交付。

fake factory 要能控制：创建延迟、运行延迟、最终文本、错误、abort 和事件顺序，专门制造竞态。

## 4.3 真实会话集成测试

建议新增：

```text
packages/coding-agent/test/subagent-session.test.ts
packages/coding-agent/test/subagent-tools.test.ts
packages/coding-agent/test/subagent-persistence.test.ts
```

### 独立性

- parent/child `sessionId` 不同；
- parent/child message 数组互不污染；
- parent/child JSONL 不同；
- child 的 assistant/tool 轨迹只写 child 文件；
- root 普通 session list 不列 `.subagents` 下文件；
- 同一 child 文件无法被两个 writer 同时打开。

### 工具能力

- explorer 工具集合精确等于批准的只读集合；
- explorer 调用 edit/write/bash 时模型侧看不到对应 schema；
- worker 有 coding tools，但没有 spawn/list/wait/followup/interrupt；
- child 没有 ask_user_question；
- 父禁用某个能力时 child 不能重新获得；
- scope 只在 `conversation/project/cli` 激活。

### 上下文

- child 不含父聊天全文和父工具轨迹；
- child 能读取 cwd 下的项目指令；
- 初始 task envelope 含正确 id/path/type；
- follow-up 保留 child 之前的消息；
- send_message 不启动 idle child turn；
- followup_task 会启动 idle child turn。

### 完成通知

- 父 streaming 时通知作为 follow-up；
- 父 idle 时通知触发新 turn；
- finalText 超限被裁剪，transcript 保留全文；
- 父 dispose 后完成的 child 不触发 turn；
- 两个 child 在同一事件循环完成只产生一个 notification。

## 4.4 持久化与恢复测试

覆盖：

1. child 创建在 `<parentDir>/.subagents/<parentId>/`；
2. header `parentSession` 指向父 JSONL；
3. header `subagent` 含 taskName/path/type/parentSessionId，且在首条 assistant 消息前已经落盘；
4. `subagent.lifecycle` 只写 child 文件，不推进 parent leaf；
5. root 重启扫描到 completed child；
6. 首轮 assistant 前崩溃，仍能从 header 恢复身份并标记 interrupted；
7. 崩溃前为 running、没有 terminal record 的 child 恢复为 interrupted；
8. 恢复不会自动调用模型或执行命令；
9. restored child 能通过 followup_task 懒加载并续接；
10. child 文件锁被其他进程持有时返回明确错误；
11. 内存 parent 不创建磁盘 child；
12. 无效/损坏 child 文件被隔离报告，不阻止 root session 打开。

## 4.5 权限回归测试

这是上线阻断项。

建议在 `runtime-core` 增加专门测试，验证：

| Parent 模式 | Child 类型 | 预期 |
|---|---|---|
| sandbox | explorer | 只读 sandbox 工具 |
| sandbox | worker | 写/执行仍经 sandbox grant，不出现普通裸工具 |
| full-access | explorer | 仍只读 |
| full-access | worker | 允许 full-access coding tools |

还要验证：

- child 工具使用 child session ID，不是 parent ID；
- child permission/Hook 事件 transcript path 指 child；
- parent plugin tool 闭包不会被未声明地共享；
- child 不会通过 MCP/extension 获得 role 白名单外的写/执行能力；
- 工厂创建失败时不降级为权限更宽的普通本地会话。

与 Grok 的“worktree 失败降级共享目录”不同，**权限工厂失败必须 fail-closed**。隔离目录可以降级，安全策略不能降级。

## 4.6 Hook 测试

在 ecosystem-adapter/coding-agent 现有 Hook 测试附近覆盖：

1. SubagentStart 只对真实 child 触发一次；
2. Start stop/deny 时 child 不运行且 reservation 释放；
3. Start additional context 进入 child，不进入父模型上下文；
4. child 的 UserPromptSubmit、PreToolUse、PostToolUse 携带正确 subagent context；
5. SubagentStop 获得 child finalText 和 child transcript path；
6. Stop block 能让 child 继续一轮；
7. continuation 达上限后终止，不能无限循环；
8. interrupted/failed 也触发匹配的 Stop 生命周期，且状态正确；
9. 父 Stop Hook 与 child SubagentStop Hook 的 turn/session 字段不混淆。

## 4.7 runtime-core 与 RPC 测试

建议覆盖：

- `subagents_update` 正确映射为 `subagents.update`；
- snapshot 可 JSON 序列化，不包含 `AgentSession`、Error 实例、AbortController 等内部对象；
- event 的 `sessionId` 是 root session，child 身份在 payload；
- RPC 输出新增事件时不破坏现有 command/response 关联；
- root 重新订阅后能从 state/snapshot 获得当前 child 状态，不依赖已错过的 delta；
- child 事件不触发 root 的普通 `agent_end` 队列出队逻辑。

## 4.8 desktop 验收

desktop UI 上线时至少验证：

- 普通 conversation/project 能看到 subagent；
- batch/automation/kb-processing/im-claw 不出现 subagent 工具；
- 状态、按钮、提示均走 i18n，zh/en 都存在；
- running child 可中断；
- 查看 transcript 不会获取写锁或影响 child；
- 切换 root session 后列表不会串会话；
- app 退出时 child 全部停止，不留后台命令或 MCP 进程；
- root 收到自动完成通知时，聊天区只有一个新的 Agent turn；
- child 的流式 token 不混进 root assistant 气泡。

## 4.9 故障矩阵

| 故障 | 预期状态 | slot | 父通知 |
|---|---|---|---|
| task 参数非法 | 不创建记录 | 不占用 | 工具错误 |
| 并发额度满 | 不创建记录 | 不占用 | 工具错误 |
| child factory 失败 | failed | 释放 | 一次失败结果 |
| API/provider 错误 | failed | 释放 | 一次失败结果 |
| child tool 错误后正常总结 | completed | 释放 | finalText 含总结 |
| parent `interrupt_agent` | interrupted | 释放 | 一次中断结果 |
| parent dispose | interrupted | 释放 | 不唤醒 parent |
| 进程崩溃 | 恢复为 interrupted | 释放 | 恢复时不自动唤醒 |
| child 文件锁冲突 | failed/明确不可恢复 | 释放 | 一次错误 |
| Hook 阻止启动 | failed 或 cancelled 语义固定其一 | 释放 | 工具错误，不运行 child |
| Hook Stop block 超限 | terminal + 明确诊断 | 释放 | 一次结果 |

状态名要在实现前固定。首版不建议增加 `cancelled` 和 `closed` 两个近义终态；统一用 `interrupted` 表示主动中止，用 `failed` 表示异常。

## 4.10 性能与资源验收

- active child 默认最多 3；
- child completion buffer 有界；
- terminal 内存记录最多 50，完整历史留磁盘；
- finalText 回父前裁剪；
- wait 无轮询 timer；
- 多 child 不重复远程 models fetch；
- child MCP/插件如果没有安全共享方案则关闭，不允许每个 spawn 无界拉起服务；
- root dispose 等待 child idle 有总超时，超时后记录诊断并执行已有的安全终止路径。

## 4.11 MVP 验收清单

- [ ] subagent 是独立 `AgentSession` 和 JSONL。
- [ ] coordinator 位于 `coding-agent`，`agent-core` 无多 Agent 产品逻辑。
- [ ] child factory 由宿主注入，sandbox 无权限提升。
- [ ] 首版 depth=1，active child 默认上限 3。
- [ ] explorer/worker 工具集合经过精确测试。
- [ ] 六个工具语义与实现一致。
- [ ] wait/notification 单次消费且能合并完成项。
- [ ] follow-up 能复用 child transcript。
- [ ] parent dispose 无孤儿 child 或自动唤醒。
- [ ] 重启恢复不会把未完成任务误报为 completed。
- [ ] SubagentStart/SubagentStop Hook 真正触发。
- [ ] runtime-core/RPC/desktop 能观察状态但不混流。
- [ ] batch/automation/kb-processing/im-claw 首版 fail-closed。
- [ ] 具体测试文件通过，根 `bun run check` 无错误、警告和 info。
