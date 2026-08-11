# 阶段 41：Session History Controller

## 目标

在阶段 40 的只读 History Port 之后，提取活动会话的历史写命令，移除 RuntimeHost 对旧
`AgentSession + SessionManager + Agent` 组合操作的直接依赖，同时保持消息编辑、分支、fork 和命名行为不变。

## 行为审计

历史写操作不是简单的 SessionManager CRUD，原实现包含以下不可分割语义：

- 所有编辑、分支和 fork 操作在 LLM streaming 或 Bash 运行时拒绝执行；
- re-edit 必须先验证目标仍存在，再以 `summarize: false` 导航，并将取消结果规范化为空文本；
- delete 由旧 AgentSession 同步持久化结果和 Agent 消息；
- replace-last-user-message 由 RuntimeHost 手工修改 SessionManager 后重建 Agent 上下文；
- switch branch 会更新 leaf 并重建 Agent 消息；
- fork 导出新文件但不切换当前会话；
- 会话命名通过 Session 历史元数据写入，在线会话不能另开 SessionManager 争抢文件锁。

因此本阶段没有把低层 SessionManager 暴露为 Port，也没有让 RuntimeHost 继续负责编排这些副作用。

## 新增合同

```text
RuntimeSessionHistoryController
  ├─ navigateForEdit(entryId)
  ├─ switchBranch(entryId)
  ├─ deleteMessage(entryId)
  ├─ replaceLastUserMessage(entryId)
  ├─ forkSession(entryId)
  └─ setName(name)
```

Reader 和 Controller 保持分离：Reader 发布稳定只读 `HistoryEntry` 投影；Controller 表达带持久化和上下文同步
语义的命令。Controller 实现负责活动 Turn 互斥，RuntimeHost 只做 SessionFacade 路由。

## Legacy 适配

新增 `LegacyRuntimeSessionHistoryController`，集中保留原 RuntimeHost 的行为：

- 原样保留五类忙碌态错误文案；
- stale edit target 在调用 `navigateTree` 前失败；
- navigation cancellation 返回 `{ text: "", cancelled: true }`；
- replace 后使用 `buildSessionContext().messages` 刷新 Agent；
- switch/delete/fork 的返回值和异常不转换；
- `setName` 继续调用旧 Session 的 `setSessionName`。

## Assembly 与 RuntimeHost

`RuntimeHostSessionAssembly` 新增 `historyController`，由 `createLegacyRuntimeHostSessionAssembly()` 和 Backend
兼容适配器统一构造。RuntimeHost 已迁移以下在线会话路径：

- `navigateForEdit`；
- `switchBranch`；
- `deleteMessage`；
- `replaceLastUserMessage`；
- `forkSession`；
- `renameSessionById`、在线路径 rename 和自动标题持久化。

离线 `renameSession(path)` 仍直接短暂打开 SessionManager，这是 RuntimeHost 的文件级会话仓储操作，不属于活动
Session Port；在线路径继续复用已打开句柄，避免第二把文件锁。

## 行为基线测试

新增 Legacy Controller 特征测试，固定：

- 六类成功委托及返回结果；
- replace 后 Agent 消息刷新；
- navigation cancellation；
- stale edit target；
- streaming 和 Bash 两种忙碌态下全部五类历史命令的原错误语义。

Assembly 隔离测试同时使用自定义 Controller，验证 RuntimeHost 的所有在线历史命令和两种 rename 路径都消费
Assembly 交付能力，而不是回读旧 Session。

## TypeBox / Zod 判断

History Controller 是进程内命令 Port，参数和返回值已由 TypeScript 的 `SessionFacade` 合同约束，不跨不可信数据
边界。本阶段不引入 TypeBox/Zod。entryId、name 等外部协议字段若需要格式校验，应在 IPC/RPC 输入边界处理，
不能把 Schema 校验混入 Session 能力适配器。

## 明确未修改

- 没有改变 SessionFacade 的方法签名、同步/异步形态或错误文案。
- 没有改变 SessionManager 的删除、替换、分支与 fork 算法。
- 没有改变历史读取和 JSONL 文件解析。
- 没有迁移离线 Session 文件仓储操作。
- 没有迁移 model、thinking、plugin、todo、background task、subagent 或 Host Interaction。
- 没有修改 Greenfield Backend，也没有切换生产默认 Backend。

## 下一步分析

RuntimeHost 的下一组高密度旧 Session 依赖是 Model Configuration：模型解析、切换、thinking level、全局更新与
远端凭证刷新。下一阶段应先固定“显式 modelKey 优先 available、再 fallback registry.find”“切模后再设置
reasoning”“无匹配模型时保持不变”等行为，再提取 Model Configuration Port。

自动标题和输入预测同时需要当前模型与候选模型，但它们是外围推理任务，不应直接并入模型写配置 Port；可以由
独立只读 Model Selection View 交付，避免再次形成大而全的 Model Service。

## 验证

- History Controller 与 Assembly 定向测试：2 个文件，13/13 通过。
- Runtime Core 完整测试：12 个文件，64/64 通过。
- Runtime Core build typecheck：通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
