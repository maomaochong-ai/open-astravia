# 第 160 轮：Session Identity 切换事务

## 目标

把 Legacy `AgentSession` 的 `newSession`、`switchSession` 与 `fork` 从“按顺序执行若干副作用”收敛为可验证的 Session identity 切换事务，同时保持旧命令、消息、工具、Prompt、Extension 与持久化格式不变。

本轮重点解决四类混合状态：

1. 目标文件锁获取失败后，`SessionManager` 已丢失源会话身份或源锁。
2. 旧资源静默失败后，没有为仍然有效的源身份重新建立可用资源。
3. 会话切换与 Prompt、模型、压缩、Bash 等命令并发时，命令可能绑定到错误身份。
4. RPC 会话命令失败时，错误响应丢失原始 `id`，真实 CLI 调用方只能超时。

## 架构结论

Session identity 切换采用“准备、提交、激活”三段式事务：

```text
关闭旧 identity 易失资源
        ↓
在独立 SessionStore peer 中准备目标文件、历史与目标锁
        ↓
准备成功后一次性 adoptPrepared（提交 identity）
        ↓
为当前已提交 identity 激活新资源并恢复状态
```

关键不变量：

- 目标锁必须在释放源锁之前获得。
- 准备失败时，源 Store、源文件、源 Session id 与源锁保持不变。
- identity 一旦提交，后续 setup、Extension 或模型恢复失败也不回滚文件所有权；当前目标身份必须重新连接并可继续使用。
- 资源静默或激活失败时，必须尝试为当前权威 identity 恢复资源；恢复也失败时用 `AggregateError` 同时保留原错误与恢复错误。
- identity transition 按请求顺序串行；普通异步 Session 工作只在前置 transition 已提交后准入，但无 transition 时仍按旧行为同步启动。
- `close()` 先关闭准入并等待已接收的 identity transition，再执行原有资源关闭事务。

## 实施内容

### 1. SessionStore 候选提交

`SessionStore` 新增内部 peer 与提交原语：

- `createPeer()` 创建同 cwd、sessionDir、persist 配置的候选 Store。
- `adoptPrepared(peer)` 校验候选属于同一存储域，接管候选 entries、索引、叶节点、文件身份和文件锁，最后才释放旧锁。
- 锁句柄从 peer 转移到活动 Store，避免提交后被候选清理误释放。

没有引入新的公开 Session API，也没有修改 JSONL 格式。

### 2. 生命周期与 fork 的 prepare-before-commit

`newSession`、`setSessionFile` 和 `createBranchedSession` 均先在 peer 上完成目标准备：

- 加载、迁移或恢复目标 entries。
- 获取目标文件锁。
- 必要时写入新 header 或分支文件。
- 全部成功后调用 `adoptPrepared`。

显式 fork 目标准备失败时只清理本次新建的目标文件；源会话和源锁不变。`setSessionFile` 指向当前文件时保持当前 identity，不制造自锁冲突。

### 3. AgentSession identity transition 准入

`SessionNavigator` 现在拥有 Session identity transition 的单一 FIFO 队列：

- `newSession`、`switchSession`、`fork` 进入同一队列。
- Prompt、steer、follow-up、自定义消息、用户消息、模型切换、压缩、Memory flush 和直接 Bash 在已有 transition 后等待准入。
- 普通工作不占用整个 transition 队列；Prompt 开始后，后续切换仍可按旧语义中止活动 Turn。
- 队列为空时普通工作立即调用原控制器，保留 `isStreaming`、待处理消息计数和同步副作用的旧可观察时机。
- `closeAdmission()` 同步拒绝新工作，并返回已接收 transition 的 drain Promise。

这不是把整个 Agent 变成全局串行 Pipeline，而是只序列化“Session identity 所有权提交”与依赖该身份的操作准入。

### 4. 资源恢复与连接恢复

`activateSessionIdentityResources()` 改为可等待操作：

- 新建 BackgroundTaskManager 与 SubagentCoordinator。
- 恢复压缩、Runtime、Input、EventRouter 与 Todo 的 identity-local 状态。
- 中途失败时关闭本次部分创建的资源。
- identity 状态观察者单个失败只记录警告，不破坏已经完成的资源提交。

`newSession` 与 `switchSession` 使用 `try/finally` 保证 Agent 重新连接。若身份已经提交而 setup 或后续恢复失败，错误仍返回调用方，但连接、SessionStart 标记和当前身份保持一致。

### 5. RPC 相关错误

RPC dispatcher 将 `new_session`、`switch_session` 与 `fork` 的同步或异步失败转换为带原命令 `id` 与 `type` 的 `rpcError`。Prompt 仍保持原有“立即确认、后台终态”的协议；本轮没有把 Prompt 改成阻塞 RPC。

真实 CLI 锁冲突差分测试覆盖：

- 一个进程持有目标 Session 锁。
- 另一个进程尝试切换并收到同 id 的失败响应。
- 失败进程仍持有源锁并保留源状态。
- 目标进程仍持有目标锁。
- 失败进程随后可在源 Session 正常执行 Prompt。
- Legacy 与 Greenfield RPC 后端结果一致。

## 类型校验选择

本轮没有引入 TypeBox 或 Zod。

原因是新增对象都是进程内私有事务对象，来源受 TypeScript 控制，不是 JSON、配置、RPC Frame、磁盘 Schema 或插件输入边界。为内部 peer 再做运行时 Schema 校验不会提高边界安全性；`adoptPrepared` 的存储域不变量使用显式运行时断言更直接。RPC 外部 Frame 继续复用既有 TypeBox 校验。

## 明确未修改

- 未修改 Tool 名称、参数、描述或动态注册方式。
- 未修改 Prompt、Skill、MCP、Knowledge、Todo 或 Extension 的业务规则。
- 未修改 Session JSONL 格式、迁移算法或公开 `SessionManager` 导入路径。
- 未把 Turn、工具循环或所有 RPC 命令放入全局串行队列。
- 未改变 Prompt RPC 的立即确认协议。
- 未修复与本轮无关的旧测试模型 fixture；`agent-session-concurrent.test.ts` 仍引用当前内置模型清单不存在的 `claude-sonnet-4-5`。

## 验证

通过：

- `packages/coding-agent` SessionManager 文件操作与锁测试：31 个。
- Session identity、关闭、自动压缩队列、prefire、Runtime close、Tool Search、Plugin MCP 与 RPC dispatcher 回归：57 个。
- Session identity 与关闭专项回归：15 个。
- `packages/cli-app` 真实 Legacy/Greenfield Session transition 差分：4 个。
- 根 TypeScript：`bunx tsgo --noEmit -p tsconfig.json`。
- 仓库完整质量门禁：`bun run check`（Biome、根/CLI/Desktop/Admin 类型检查与 guards）。

新增回归覆盖：

- 目标锁冲突不破坏源 identity 与源锁。
- quiesce 失败后恢复源 identity 资源。
- Prompt 等待已排队切换后绑定目标 identity。
- 无切换时普通 Session 工作立即启动。
- 并发 identity transition 按 FIFO 提交。
- setup 失败后已提交目标仍保持连接。
- close 等待已接收 transition，且关闭后拒绝新准入。
- dispatcher 保留失败命令的 RPC correlation id。
- 双进程真实 CLI 锁冲突与失败后恢复。

## 下一步

下一阶段建议合并处理“剩余 Session identity 写入口准入与 rollover 身份提交”：

1. 盘点 `setThinkingLevel`、历史编辑、名称写入、Bash 结果记录等同步 identity-bound 写入口，区分必须进入准入门和可保持同步的纯局部操作。
2. 审计 memory rollover 的文件创建、锁转移、Conversation 切换和失败恢复，使其复用同一 prepare-before-commit 不变量。
3. 建立 close、rollover、new/resume/fork 与普通命令交错的差分矩阵，然后再推进 Legacy Session 实现退役。

该阶段仍应以行为兼容为门禁，不扩大到业务功能重写。
