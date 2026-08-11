# 第 161 轮：Memory Rollover 事务与写操作准入

## 目标

延续第 160 轮的 Session identity 事务，本轮收敛 Legacy memory rollover 和剩余公开写入口，同时保持 Tool、Prompt、Skill、MCP、Memory、Extension、JSONL 格式及命令行为不变。

本轮解决四类边界问题：

1. rollover 先释放源锁、再写入并锁定目标文件，目标准备失败会留下已切换的内存身份和失锁的源文件。
2. rollover 更新了 `SessionManager`，但 `Agent.sessionId` 和 SubagentCoordinator 捕获的父会话路径仍指向旧文件。
3. 同步历史写操作无法等待异步 identity transition，可能在切换窗口误写源会话。
4. `navigateTree` 没有进入 Session 准入边界，既可能抢在已排队切换前执行，也可能在后续切换提交后继续修改旧树。

## 架构结论

### 1. 区分身份替换与存储续接

`newSession`、`switchSession` 和 `fork` 是 **Session identity replacement**：旧 identity 的后台任务、Subagent、Todo 等易失资源必须静默，再为目标 identity 创建新资源。

memory rollover 是 **storage continuation**：它只把同一段运行期 Conversation 的压缩状态续写到新 JSONL，并更新持久化身份。BackgroundTaskManager、活动 Subagent、Todo、消息队列、Runtime、MCP 和 Extension 都不应被重建或清空。

因此 rollover 的提交顺序是：

```text
源 Store + 源锁保持有效
        ↓
在 peer Store 中构造新 header 与压缩链
        ↓
完整写入目标 JSONL，并先获得目标锁
        ↓
adoptPrepared 一次性提交 Store 身份并释放源锁
        ↓
重绑定 Agent.sessionId 与未来 Subagent 的父 id/path
        ↓
发出 session_path_changed
```

这不是完整 Session 重建，也不是把运行期对象做成整份快照。

### 2. rollover 复用 prepare-before-commit

`rolloverToNewFile` 现在复用第 160 轮的 `SessionStore.createPeer()` / `adoptPrepared()`：

- 新 header、压缩摘要与保留尾巴先写入候选 Store。
- 目标文件写入成功后，由候选 Store 获取目标锁。
- 只有目标文件和目标锁都就绪，活动 Store 才接管候选状态并释放源锁。
- 写入或加锁失败时关闭候选锁并 best-effort 删除本次唯一目标文件；源 id、源 path、entries 与源锁不变。
- 清理失败不覆盖原始准备错误，避免把真正的事务失败原因隐藏成次要清理错误。

JSONL header、`parentSession` 链、压缩链算法和 `session_path_changed` 事件格式均未改变。

### 3. 存储身份窄重绑定

rollover 提交后只更新捕获了旧存储身份的引用：

- `Agent.sessionId` 更新为新 header id。
- `SubagentCoordinator` 更新未来 child create/reopen 使用的父 Session id 和文件路径。
- 已运行或已结束的 child 不被销毁；队列中尚未启动的 child 改绑到新父 id。
- BackgroundTaskManager、SubagentCoordinator 实例本身保持不变。

重绑定发生在 `session_path_changed` 之前，使事件观察者读取到的 Session 状态已经一致。

### 4. 同步写入口使用立即准入

同步 API 不能在不破坏公开签名的前提下等待 Promise。因此 `SessionNavigator` 增加同步立即准入：

- 没有 identity transition 时立即执行，保留原同步行为。
- identity transition 已排队或正在执行时，抛出 `Session identity transition is pending`，不猜测应该写源还是目标。
- Session 已关闭准入时继续使用既有 `AgentSession is closing` 错误。

接入该边界的入口包括：

- `clearQueue`
- `setThinkingLevel` / `cycleThinkingLevel`
- `recordBashResult`
- `setSessionName`
- `switchBranch`
- `deleteMessage`
- `exportForkToNewFile`

取消类 API（abort Bash、Compaction、Retry、Branch Summary）没有被阻断，因为切换和关闭期间仍需要它们停止工作。全局设置和 Runtime 配置也没有被误判为某个 JSONL identity 的写入。

### 5. 树导航是可等待的历史事务

`navigateTree` 现在先等待已经排队的 identity transition，再读取目标树。进行中的树导航会被追踪：

- 后续 identity replacement 在提交前先发出 branch-summary abort，并等待已准入的树导航结束。
- `close()` 关闭准入后同样等待树导航静默。
- 无 identity transition 时，树导航仍立即开始；没有把普通 Turn 或整个 Agent 放入全局串行队列。

这样避免异步 Extension/摘要回调在 Session 已切换后继续修改旧树。

## 类型校验选择

本轮没有引入 TypeBox 或 Zod。

新增数据均为进程内受 TypeScript 控制的 Store peer、Promise 集合和 id/path 重绑定参数，不是 JSON、RPC、配置、磁盘 Schema 或插件未知输入。运行时安全依赖明确的事务断言、文件锁和准入状态；增加 Schema 校验不会改善这些并发与所有权不变量。

## 明确未修改

- 未修改任何 Tool 的名称、参数、描述、执行结果或动态注册机制。
- 未修改 Prompt、Skill、MCP、Knowledge、Memory flush、JOURNAL 或 Extension 业务规则。
- 未修改 Session JSONL 格式、rollover 压缩链和 `parentSession` 语义。
- 未在 rollover 时重建 Runtime、MCP、BackgroundTaskManager 或 SubagentCoordinator。
- 未把所有公开配置操作放进全局锁或全局 Pipeline。

## 测试与故障注入

新增回归覆盖：

1. 目标锁获取失败后，活动 manager 的源 id、path 和 entries 不变，源锁仍阻止第二个 manager 打开，并清理失败目标文件。
2. rollover 成功后，目标锁归活动 manager 所有，源锁已经释放，后续消息只继续写目标。
3. identity transition 期间八类同步写入口统一拒绝，不发生错误身份写入。
4. 已排队切换完成后，`navigateTree` 在目标会话上执行。
5. 后续 identity replacement 等待已准入的树修改结束后再提交。
6. memory rollover 后 Agent id、事件和未来 Subagent 父 id/path 一致，同时 BackgroundTaskManager 与 SubagentCoordinator 实例保持不变。

已通过：

- `packages/coding-agent/test/session-manager/rollover.test.ts`：2 个测试。
- `packages/coding-agent/test/agent-session-identity-transition.test.ts` 本轮专项：4 个测试。
- 根 TypeScript：`bunx tsgo --noEmit -p tsconfig.json`。
- `bun run check:quick`：通过。

完整 `bun run check` 中 Biome、guards、根 TypeScript、CLI TypeScript 与 Desktop TypeScript 均通过；随后 Admin `tsc -b` 因本地 `packages/admin/node_modules/@types` 缺失 `d3-*`、`estree`、`json-schema` 等声明文件而报 TS6053。该依赖安装状态与本轮修改无关，本轮没有通过删除功能、降低类型或改动 Admin 配置规避。

真实 CLI memory-rollover 差分门禁已尝试执行，但当前受控环境中的测试子进程在读取若干 workspace 源文件时收到 `EPERM`，suite 在用例收集前中止；该失败不是行为断言失败，也未据此声称差分门禁通过。

## 下一步

下一阶段建议进行 Legacy Session 可变能力面的最终所有权审计：

1. 收敛 `todoStore` 等可变对象直接暴露造成的准入旁路，改为窄命令 Port，同时保持 Todo 工具行为不变。
2. 区分 Session-local Runtime 重配置与宿主全局设置，补齐 close / transition 交错门禁。
3. 建立 Legacy replacement、Legacy rollover 与 Greenfield continuation 的统一差分矩阵，满足后再开始删除旧实现，而不是继续在双实现间增加隐式兼容层。
