# 第 89 轮：Subagent 状态日志与确定性恢复

## 1. 本轮目标

第 86 轮已经实现真实 Greenfield 子会话，第 88 轮之后的剩余缺口是父 Session 重启后无法重建
Subagent Coordinator。本轮完成：

1. 在父 Conversation Document 中记录可恢复的 Subagent ownership 和状态变化。
2. 恢复 generation 与结果交付标记，避免已持久化结果重复消费。
3. 对重启前未完成的工作执行确定性状态归一。
4. 只恢复父 Session 明确登记的子会话，不扫描 `.subagents` 目录。
5. 通过既有 Child Factory `reopen()` 延续同一个子 transcript。
6. 对缺失、越界、损坏和不再支持的恢复状态进行能力局部降级。

## 2. 架构结论

恢复职责保持分层：

```text
runtime-subagents
  ├─ Coordinator 恢复合同
  ├─ 状态归一
  └─ delivery tracker 恢复

CLI Greenfield Subagent Participant
  ├─ Zod 持久化边界
  ├─ Conversation Document 增量事件
  └─ 串行提交与恢复折叠

CLI Composition Root
  ├─ File Repository canonical path
  ├─ transcript 文件存在性
  └─ 真实 Child Session reopen

runtime-core
  └─ 通用 Document Participant，不感知 Subagent
```

`runtime-subagents` 仍不依赖文件系统、Conversation Document、CLI 或 Coding Agent。
Runtime Core 也没有增加 Subagent 专用存储合同。

## 3. 增量状态日志

父 Session 使用版本化 custom entry `subagent_state_v1`，事件包括：

- `upsert`：新增或更新一个 Child snapshot。
- `remove`：清除一个终态 Child。
- `delivery_claimed`：某个 `(childId, generation)` 已被 wait 或自动通知消费。

Participant 比较 Coordinator 的前后状态，只记录变化的 Child，不在每次变化时重写整个 registry。
恢复时按父文档中的追加顺序折叠全部 Subagent 状态事件。

Subagent 是既有 Session-local 工作状态，因此恢复读取 Session 文档内的全部 Subagent custom
entry，而不是把它误当成模型活动分支的一部分。未被父文档登记的孤立文件没有 ownership，始终忽略。

历史编辑可能移除位于被替换子树中的 custom entry。Participant 会在外部文档改写后比较当前
Session 状态与持久化折叠结果，只增量重申被移除或过期的状态与 delivery marker。自身追加期间使用
写入深度抑制重入，避免 Participant 形成持久化循环。

## 4. Zod 持久化校验

`subagent_state_v1` 是不受信任的磁盘 JSON 边界，因此使用 CLI 已有 Zod 依赖校验：

- 事件版本和 discriminated union。
- Snapshot 必需字段。
- status 枚举。
- usage、todo progress 与 generation 数值。
- additional property 拒绝。

无效 entry 被单独拒绝并报告，不用于构造 Coordinator，也不阻断父 Session 其他能力。进程内
Coordinator、Child Handle 和 Runtime Port 继续使用 TypeScript 类型，没有重复运行时校验。

## 5. 恢复状态规则

恢复规则为：

| 持久化状态 | 恢复结果 |
| --- | --- |
| `completed`、`failed`、`interrupted` | 保留终态 |
| `running`、`pending` 且 transcript 有效 | `interrupted`，generation 加一 |
| `queued` 或尚未创建 transcript 的 `pending` | `failed`，generation 加一 |
| transcript 缺失、路径不匹配或不再是文件 | `failed`，保留已有摘要 |
| agent type 不再注册 | `failed` |
| parent、task name 或 task path 非法 | 不认领该 entry |

这修正了第 88 轮“queued/running 统一转 interrupted”的粗略描述。queued Child 尚未拥有真实
Session，不能声称可以通过 `followup_task` 延续 transcript。

恢复归一结果重新写入增量日志，因此后续重启不会重复执行同一次归一。

## 6. Transcript 与路径边界

Composition Root 使用 `FileConversationRepository.resolveConversationPath()` 计算子会话规范路径，
不自行拼接文件名或复制 Storage 编码规则。只有同时满足以下条件才允许恢复：

- 路径属于 `<parentDir>/.subagents/<parentSessionId>` 的规范 Child Repository。
- 规范路径对应持久化 Child Session ID。
- 目标存在且是普通文件。

目录内没有父状态事件的文件不会被发现或认领。用户删除已登记 transcript 后，父 Session 仍可打开，
但该 Child 显示为带明确错误的 `failed`。

## 7. Lazy Reopen 与父上下文

恢复 Coordinator 时不立即打开所有终态 Child：

- `list_agents` 与 RuntimeHost 状态读取只使用父 Session 中的索引。
- `followup_task` 需要继续工作时才调用既有 `reopen()`。
- reopen 失败会把 Child 转为新的 failed generation，并持久化。
- reopen 成功后继续使用原 Child Session ID 与 transcript。

Workflow 首次创建时仍继承父分支上下文；恢复已有 Child 时不再重新读取并注入父 Session 的当前
上下文。恢复事实完全来自子 transcript，避免上下文重复或漂移。

## 8. Delivery 语义

`wait_agent` 或自动 `<subagent_notification>` claim 一个 generation 时写入
`delivery_claimed`。重启后已持久化的 generation 不重复返回或自动通知。

本轮保证“已持久化 claim 不重复”。跨两个独立持久化操作的崩溃窗口仍采用 at-least-once，不宣称
严格事务型 exactly-once；后者需要扩大 Storage 事务合同，不属于本轮架构重构范围。

## 9. 测试

本轮测试覆盖：

1. completed、running 和 queued 状态恢复归一。
2. delivery marker 恢复及 wait 去重。
3. recovered Child 的 lazy reopen 和同 transcript follow-up。
4. reopen 失败转为新的 failed generation。
5. 重复 task name 的恢复 registry 在修改前拒绝。
6. Zod 版本、事件和 payload 校验。
7. 增量 upsert、remove 与 delivery 记录，不重写未变化 Child。
8. 外部文档改写移除 entry 后，Session 级状态被增量重申且不会递归写入。
9. 真实父 Session 关闭并恢复后 `list_agents` 重建。
10. 真实 `wait_agent` 不重复消费已交付 generation。
11. 真实 `followup_task` 使用同一 Child Session ID。
12. 删除 transcript 后的失败降级。
13. 孤立 `.subagents` 文件不被目录扫描认领。
14. 既有七个工具、Explorer、Workflow 与异步通知测试继续通过。

## 10. 明确未修改

- 没有改变七个子代理工具的名称、描述、TypeBox Schema 或文本结果。
- 没有扫描 `.subagents` 目录恢复 ownership。
- 没有自动重启进程退出前的 running/queued 工作。
- 没有把文件系统依赖放入 `runtime-subagents` 或 `runtime-core`。
- 没有为严格跨文件 exactly-once 增加分布式事务。
- 没有切换 Desktop 生产默认 Backend。

## 11. 下一步

下一阶段应实施 Desktop 显式 Greenfield opt-in 与宿主差分门禁：

1. 增加明确、默认关闭的 Desktop Runtime selector。
2. 新建 Session 可选择 Greenfield；既有 Session 继续按 Catalog ownership 路由。
3. Greenfield 创建或恢复失败时只按明确策略回退，不静默改写持久化格式。
4. 对 history、model、configuration、host interaction、background work 和关闭行为执行
   Legacy/Greenfield 宿主差分。
5. 验证多窗口/多 Session ownership、应用退出和重启恢复。

在该阶段验收前，Desktop 默认仍保持 Legacy。
