# 第 92 轮：CLI 驱动的 Desktop Runtime Canary

## 1. 目标

第 91 轮的下一步原计划通过 UI 或 Preload 操作会话。现有 Vetta CLI 已经提供：

- `conversation.create`
- `conversation.continue`
- `conversation.list`
- `conversation.answer`
- `conversation.wait`
- `conversation.abort`

因此本轮改为复用既有 CLI 和 Debug RPC，不再创建第二套会话测试入口。

本轮作为一个阶段完成：

1. 以独立 Vetta CLI 子进程调用 Desktop Debug RPC。
2. 使用本地确定性 OpenAI Responses Provider 执行真实 Greenfield 模型回合。
3. 通过 CLI 创建、继续和列举持久化会话。
4. 用 Zod 校验 CLI JSON 输出边界。
5. 修复 Canary 暴露的 CLI 启动依赖和 Greenfield 会话身份持久化问题。

## 2. Canary 链路

测试链路如下：

```text
独立 bun/vetta CLI 进程
  -> endpoint file discovery
  -> Local HTTP Debug RPC
  -> AppDebugRuntime / Conversation Definitions
  -> DesktopConversationService
  -> RuntimeHost
  -> DesktopGreenfieldRuntimeBackendPool
  -> 本地 OpenAI Responses Provider
  -> v2 Conversation 文件
```

新增：

- `packages/desktop-app/src/main/app-debug/conversation/cli-runtime-canary.test.ts`

Canary 没有直接调用 Debug Definition，也没有直接调用 `RuntimeHost.prompt()`。三个会话动作均由
`packages/cli-app/src/cli.ts` 启动的独立进程完成。

测试断言：

- `conversation.create` 返回首轮确定性文本和持久化 `sessionPath`；
- `conversation.continue` 使用同一 `sessionPath`，消息数从 2 增至 4；
- `conversation.list` 可以从相同 CWD 找到该会话；
- Provider 确实收到第一轮和第二轮输入；
- `disposeAllSessions()` 后 Session 不再可读；
- Backend Pool 释放后 Scope 数量归零；
- Debug RPC 关闭后 endpoint file 被删除。

## 3. CLI 可执行入口依赖收缩

### 3.1 问题

原 `cli.ts` 从 `index.ts` 导入 `runCli`。而 `index.ts` 同时是 CLI 包的库聚合入口，静态导出：

- Greenfield Runtime Composition；
- Subagent Runtime；
- Runtime Tools Composition；
- RPC Host Adapter。

所以执行一个只需要 Action RPC 的 `vetta debug`，也会先加载完整 Agent Runtime 图。Canary 首次执行时，
Debug 命令尚未解析，就被无关 Runtime 模块的工作区链接或陈旧构建表面阻断。

### 3.2 修复

新增：

- `packages/cli-app/src/run-cli.ts`

调整：

- `cli.ts` 直接从 `run-cli.ts` 导入命令路由；
- `index.ts` 继续导出 `runCli` 和原有全部公开 API。

结果：

```text
CLI executable bootstrap
  -> action-command
  -> debug-command
  -> 仅在进入 agent 分支后启动 agent-cli
```

这只是加载边界拆分：

- 没有删除或改名公开导出；
- 没有改变 Action、Debug 或 Agent 命令语义；
- 没有把 Runtime Composition 移入 CLI 命令路由。

## 4. Greenfield CWD 身份持久化

### 4.1 问题

Greenfield `ConversationFileHeader` schema 已允许 `cwd`，后续 continuation 和 fork 也会继承它；但首次
`repository.create()` 没有接收 CWD，导致首个 v2 Header 实际为：

```json
{
  "recordType": "conversation.header",
  "schemaVersion": 2,
  "sessionId": "...",
  "createdAt": 0
}
```

Desktop 可以完成首轮，却无法通过既有 `conversation.continue` 找回工作目录，最终报：

```text
Session file has no valid Vetta session header.
```

### 4.2 修复

沿既有身份链路增加可选 `cwd`：

```text
GreenfieldRuntimeResources.identity.cwd
  -> CreateAgentSessionOptions.cwd
  -> TurnPipeline.createSession(sessionId, cwd)
  -> CreateConversationInput.cwd
  -> FileConversationRepository header.cwd
```

涉及：

- `runtime-core/src/kernel/contracts.ts`
- `runtime-core/src/kernel/agent-session.ts`
- `runtime-core/src/kernel/turn-pipeline.ts`
- `runtime-core/src/runtime-host/greenfield-runtime-factory.ts`
- `runtime-storage/src/conversation/file-conversation-repository.ts`

该字段保持可选：

- 旧 Kernel 测试和非文件仓储实现不需要伪造 CWD；
- 旧 v1/v2 文件继续按原格式读取；
- Desktop 不需要通过路径猜测 CWD；
- continuation、fork 和目录投影继续复用 Header 中的身份事实。

## 5. Schema 边界

CLI stdout 是跨进程、不可信 JSON 边界。Canary 使用 Zod 分别校验：

- completed operation；
- session summary list；
- CLI success envelope。

没有对测试内部已经由 TypeScript 保证的对象重复校验。文件 Conversation Record 仍由既有 TypeBox
schema 负责。

## 6. 回归测试

新增仓储级断言：

- `runtime-storage/test/conversation/file-conversation-repository.test.ts`

验证传入 CWD 后：

- v2 Header 持久化绝对工作目录；
- `ConversationDocument.identity.cwd` 可以从文件恢复。

定向执行：

```text
cd packages/desktop-app
bunx vitest --run src/main/app-debug/conversation/cli-runtime-canary.test.ts

cd packages/runtime-storage
bunx vitest --run test/conversation/file-conversation-repository.test.ts

cd packages/runtime-core
bunx vitest --run \
  test/kernel/turn-pipeline.test.ts \
  test/kernel/agent-session-async-continuation.test.ts \
  test/runtime-host/greenfield-session-backend.test.ts
```

结果：

- Desktop CLI Canary：1 个测试通过；
- Runtime Storage：18 个测试通过；
- Runtime Core：3 个测试文件、28 个测试通过；
- CLI 创建、继续、列举使用同一持久化会话；
- 第二轮完成后消息数为 4；
- 本地 Provider 同时观察到两轮输入。
- `bun run check:quick` 通过；
- 按正式依赖分层刷新声明后，`bun run check:types:build-surfaces` 通过；
- 根目录完整 `bun run check` 通过，包含 Biome、monorepo `tsgo`、CLI 独立类型检查、
  Desktop 独立 `tsc`、Admin project build 和全部 quality guards。

## 7. 明确未修改

- 没有新增 Vetta CLI 子命令。
- 没有新增 Debug Capability。
- 没有新增 UI、Preload 或 IPC 会话入口。
- 没有修改 RuntimeHost 公共会话操作。
- 没有改变默认 Desktop Backend，仍为 Legacy。
- 没有增加自动 fallback。
- 没有改变 Tool、Skill、MCP、Plugin、Scheduler 或 Batch 功能。
- 没有把测试 Provider 注入生产配置。
- 本轮验证的是独立 CLI 进程到 Desktop Runtime 组合的进程边界，不等同于打包 Electron 产物验证。

## 8. 下一步

下一阶段应把相同 CLI 驱动方式接到真实 Desktop 主进程：

1. 通过仓库隔离验证入口启动 Greenfield Desktop。
2. 在启动前注入隔离模型目录和确定性本地 Provider。
3. 使用现有 `verify:ui:debug -- run conversation.*` 创建、继续、提问和中止会话。
4. 验证 Desktop 退出后 endpoint、Session ownership 和后台资源释放。
5. 再验证 Scheduler、Batch 与交互会话在真实主进程共存。
6. 最后验证打包产物中的 CLI、Greenfield 模块和运行时资源闭包。

整个阶段仍应使用 Vetta CLI 控制会话；Playwright 只在确实需要验证 Renderer 展示时使用。
