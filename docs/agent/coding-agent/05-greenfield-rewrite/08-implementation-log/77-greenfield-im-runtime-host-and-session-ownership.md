# 第 77 轮：Greenfield IM Runtime Host 与会话所有权

## 1. 本轮目标

在不切换 Desktop、IM Gateway 和默认 Legacy RPC 的前提下，建立可实际创建、恢复和运行 RPC Transport
的 Greenfield IM 宿主纵向切片，并补齐生产切换前必须存在的会话生命周期所有权。

成功标准：

1. Legacy 与 Greenfield 不得复制设置、凭据、模型和动态资源的启动逻辑。
2. Greenfield Session 从 create/resume 到 dispose 必须独占 Conversation。
3. Memory rollover 必须先取得目标 Conversation 所有权，再释放来源所有权。
4. 旧 `*.jsonl` 必须继续走 Legacy fallback，不能被误读为 Greenfield。
5. 存在尚未适配的 Legacy Extension 时必须 fallback，不能静默丢功能。

## 2. 共享 Host Bootstrap

新增 `CodingAgentHostBootstrap`，统一创建以下进程级资源：

- 两阶段 CLI 参数解析与 Extension Flag 值绑定；
- SettingsManager；
- AuthStorage；
- ModelRegistry、Server URL/Token 和远程模型；
- ResourceLoader、Skill/Scene/Prompt/Extension；
- Extension Provider 注册；
- 迁移执行。

旧 `main()` 已改为消费该 Bootstrap，原有 Legacy 启动顺序和诊断输出保持不变。Greenfield IM Host
消费同一个合同，不再复制一份容易漂移的初始化代码。

同时新增共享初始模型解析，覆盖 CLI Model、Model Scope、默认模型、默认 Thinking、CLI Thinking
覆盖以及 `reasoning/xhigh` 能力收敛。

## 3. 进程级 Conversation 所有权

原有 `conversation-file-lock` 只保护一次 Repository 写操作，不能表达“某个 Agent 进程正在持有整个
会话”。本轮新增独立的 `*.owner.lock`：

- 所有权文件使用 TypeBox 校验 `token/pid/hostname/acquiredAt`；
- 同机进程通过 PID 存活判断回收崩溃遗留；
- 跨主机或无法识别的所有者通过心跳和 stale 时间回收；
- release 校验 token，旧 Lease 不会删除新所有者；
- 冲突使用独立 `conversation_ownership_conflict` 错误和 holder 信息；
- 生命周期锁与 Repository 单次写锁使用不同文件，二者不会互相死锁。

`ConversationOwnershipBinding` 负责 Runtime 身份变化：

```text
source owner held
  -> acquire target owner
  -> bind runtime to target
  -> release source owner
```

目标 acquire 失败时，来源 Lease 保持不变。Session dispose、初始化失败和 Composition dispose 都会
幂等释放当前 Lease。

## 4. Greenfield IM Runtime Host

新增显式宿主 API：

- `createGreenfieldImRuntimeHost()`：从参数创建 Bootstrap 并准备宿主；
- `prepareGreenfieldImRuntimeHost()`：消费已有 Bootstrap，便于未来后端选择器只加载一次共享资源；
- `runGreenfieldImRuntimeHost()`：把 Greenfield Capability 交给现有 JSONL RPC Transport。

宿主组合内容：

- `scenario: "im-claw"`；
- fresh session 使用新 sessionId，Greenfield 文件使用 `*.conversation.jsonl`；
- resume 只接受 Repository 根目录直属且可规范解码的 Greenfield 路径；
- `FileConversationOwnershipManager`；
- 已加载的 ResourceLoader 与 SettingsManager，Prompt Runtime 不重复扫描资源；
- 真实 MCP Manager 与动态 MCP Synchronizer；
- 可选 Agent Plugin Runtime Source；
- 现有 Coding Tools、Todo、Hook、Context、Compaction、Memory 和 IM RPC Adapter。

Tool 选择继续遵守旧 CLI 参数：`--no-tools` / `--tools` 使用显式集合，否则按 `im-claw` scope 激活。

## 5. Fail-closed 路由

以下情况不进入 Greenfield：

- 旧 `*.jsonl`：返回 `legacy-session` fallback；
- `--continue` / `--resume` 交互式选择语义：返回 `unsupported-session-selection` fallback；
- 已加载 Legacy Extension：返回 `legacy-extension` fallback。

格式看起来像 Greenfield、但不在指定根目录或编码非法的 `*.conversation.jsonl` 会直接报错，不会伪装成
Legacy。Greenfield 还强制要求 RPC mode、Host Bridge 和 `im-claw` scenario。

## 6. 测试

新增目标测试：

- Coding Agent Host Bootstrap：1 项。
  - 独立 agentDir、两阶段参数、模型目录、ResourceLoader 与 Thinking 能力收敛。
- Runtime Storage 所有权：3 项。
  - 活动 Lease 排他；
  - token 防止旧 Lease 删除替代所有者；
  - 同机死亡进程立即回收。
- Ownership Binding：2 项。
  - rollover 先 acquire target、再 release source；
  - target acquire 失败时保留 source。
- Greenfield IM Runtime Host：3 项。
  - Legacy `*.jsonl` fallback；
  - 真实临时目录下 fresh create、并发冲突、dispose 解锁和 resume；
  - 非法 Greenfield 路径拒绝。

验证命令：

```text
packages/runtime-storage:
  bunx vitest --run test/conversation/conversation-ownership-lease.test.ts

packages/coding-agent:
  bunx vitest --run test/host-bootstrap.test.ts

packages/cli-app:
  bunx vitest --run test/conversation-ownership-binding.test.ts test/greenfield-im-runtime-host.test.ts
  bun run typecheck

repository root:
  bun run check:quick
  bun run check
```

结果：9 项新增目标测试通过；CLI 独立 typecheck、`check:quick` 和完整 `check` 均通过。完整门禁覆盖
Biome、根 `tsgo`、CLI 独立 `tsgo`、Desktop `tsc`、Admin `tsc -b` 与质量守卫。

## 7. 明确未修改

- 没有修改 Desktop 的 Agent RPC 命令选择。
- 没有修改 IM Gateway Go ProcessPool 的参数或进程管理。
- 没有让默认 `main()` 或 `agent-cli` 选择 Greenfield。
- 没有删除 Legacy AgentSession、SessionManager、RPC 命令或存储格式。
- 没有把 Legacy Extension 假装成已兼容；当前有 Extension 时明确 fallback。
- 没有承诺 `greenfield-im` 支持 `legacy-full` 的全部 RPC 外围命令。

## 8. 下一步

下一阶段应把“后端选择”做成独立、显式且可差分验证的入口阶段：

1. 建立只加载一次 Bootstrap 的 Legacy/Greenfield Backend Selector。
2. 增加明确的实验性选择参数；默认仍为 Legacy，fallback 必须复用同一 Bootstrap。
3. 用真实子进程跑 JSONL 差分：初始化、prompt、abort、flush、附件、rollover、stdin close、并发锁。
4. 建立 Legacy Extension 兼容清单；完成相应 Adapter 前继续 fail closed。
5. 子进程差分通过后，才允许 Desktop/IM 增加显式 opt-in，不切默认值。
