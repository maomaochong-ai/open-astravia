# 第 93 轮：真实 Desktop 进程 Runtime Canary

## 1. 目标

第 92 轮已证明独立 Vetta CLI 可以驱动测试内的 Desktop Debug RPC。本轮把相同方法接入真实
Electron 主进程，形成可重复执行的 Greenfield Runtime 进程级门禁。

本轮作为一个阶段完成：

1. 使用仓库既有 UI 验证入口启动真实开发版 Desktop 主进程。
2. 为 Canary 注入独立的模型配置、认证目录、工作区和确定性本地 Provider。
3. 继续复用独立 Vetta CLI 驱动会话，不创建第二套会话测试 API。
4. 覆盖会话创建、继续、列举、用户提问和中止。
5. 通过 Debug 合同请求 Desktop 优雅退出。
6. 验证会话持久化、锁释放、RPC endpoint 删除、Provider 停止和进程退出码。
7. 修复真实中止链路暴露的 Agent Loop 未处理拒绝。

## 2. 真实进程链路

执行链路如下：

```text
verify:ui:start -- --runtime-canary greenfield
  -> 隔离 Runtime Canary Provider
  -> 真实 Electron Desktop 主进程
  -> Desktop Greenfield Runtime Composition

verify:ui:debug -- runtime-canary
  -> 独立 bun/Vetta CLI 进程
  -> Local HTTP Debug RPC
  -> conversation.create / continue / list / abort
  -> RuntimeHost / Greenfield Backend
  -> 确定性 OpenAI Responses Provider
  -> v2 Conversation 文件
  -> lifecycle.quit
  -> Electron 正常退出
```

Renderer 与 CDP 仍由既有验证宿主管理，但本轮验证主体是 CLI、Debug RPC、主进程 Runtime 和
进程释放边界，不依赖 Playwright 模拟会话操作。

## 3. 隔离 Fixture 与 Provider

新增 Runtime Canary 目录：

- `packages/desktop-app/src/main/app-debug/runtime-canary/contracts.ts`
- `packages/desktop-app/src/main/app-debug/runtime-canary/provider.ts`
- `packages/desktop-app/src/main/app-debug/runtime-canary/runner.ts`

Provider 为每次执行创建独立目录，并写入：

- `models.json`；
- `auth.json`；
- `desktop-config.json`；
- Provider 请求 NDJSON；
- 独立工作区和 Conversation 目录。

Desktop 仅在本次验证进程中接收：

- `VETTA_HOME`；
- `VETTA_CODING_AGENT_DIR`；
- `VETTA_DESKTOP_AGENT_RUNTIME=greenfield`。

因此 Canary 不读取或覆盖用户真实模型、认证、Skill 和会话数据。Provider 固定响应两轮文本，
并在第三轮发出既有 `ask_user_question` 工具调用，以验证真实的 `input_required` 和中止路径。

所有跨进程文件与 CLI JSON 输出均由 Zod 校验。类型系统内部对象不重复做运行时校验。

## 4. CLI 编排与退出合同

新增两个薄脚本：

- `packages/desktop-app/scripts/runtime-canary-provider.ts`
- `packages/desktop-app/scripts/runtime-canary-runner.ts`

Runner 通过既有 `packages/cli-app/src/cli.ts debug run` 依次执行：

1. `conversation.create`；
2. `conversation.continue`；
3. `conversation.list`；
4. 再次 `conversation.continue`，等待 `input_required`；
5. `conversation.abort`；
6. `lifecycle.quit`。

`conversation.abort` 存在合法终态竞争：用户问题取消可能先让 Operation 收敛为
`completed/toolUse`，也可能由中止请求先收敛为 `aborted`。Canary 接受这两个终态，但仍严格校验
会话身份、Operation 身份和前序 `input_required`，不把任意结果当作成功。

新增开发态 Debug 合同：

- `packages/desktop-app/src/main/app-debug/lifecycle/definitions.ts`

`lifecycle.quit` 先返回 `{ status: "scheduled", delayMs: 75 }`，再异步调用 `app.quit()`，保证 CLI
可以收到完整响应。该合同只注册在现有开发态 App Debug Runtime；打包生产路径没有新增远程退出面。

## 5. 验证宿主接入

`packages/desktop-app/scripts/ui-verification.mjs` 新增：

```powershell
bun run verify:ui:start -- --runtime-canary greenfield
bun run verify:ui:debug -- runtime-canary
```

普通 `verify:ui:start`、`status`、`debug`、`pw`、`detach` 和 `stop` 行为保持不变。

Canary 启动失败时会停止已经创建的 Provider 子进程。Desktop 退出后，验证宿主负责：

- 停止 Provider；
- 写入主进程退出报告；
- 删除验证宿主状态文件。

Runner 在返回成功前验证：

- Conversation 文件存在；
- `.lock` 与 `.owner.lock` 均不存在；
- Debug endpoint 文件已删除；
- Desktop 和 Provider PID 均已退出；
- Desktop 退出码为 `0`；
- Provider 请求日志包含三次固定输入。

## 6. 中止路径缺陷与修复

### 6.1 真实进程暴露的问题

首次真实 Canary 可以完成中止并正常退出，但主进程日志出现：

```text
unhandledRejection AbortError: This operation was aborted
```

原因是等待用户问题的工具收到取消后会正常返回取消结果；Agent Loop 随后仍准备发起下一次模型调用。
下一次调用在 `signal.throwIfAborted()` 抛错，而启动 Loop 的异步任务没有错误事件通道，最终形成未处理
拒绝。

### 6.2 最小修复

`packages/agent/src/agent-loop.ts` 在工具回合结束并发布 `turn_end` 后检查取消信号。若已取消：

1. 发布 `agent_end`；
2. 结束 Agent Event Stream；
3. 不再进入下一次模型调用。

工具结果仍进入消息记录，Runtime 上层仍根据取消信号决定 Operation 终态。该修复没有吞掉正常模型
调用错误，也没有增加新的通用错误通道或改变非取消路径。

## 7. 测试与真实验证

新增或调整测试：

- Lifecycle Debug 合同：正常响应时序和严格空输入。
- Provider：隔离配置、文本响应、工具调用 SSE 和请求日志。
- Runner：完整会话编排、退出确认和中止终态竞争。
- Agent Loop：活动工具处理中止后结束流，且不发生第二次模型调用。

定向执行结果：

```text
packages/agent/test/agent-loop.test.ts
  13 tests passed

packages/desktop-app/src/main/app-debug/lifecycle/definitions.test.ts
packages/desktop-app/src/main/app-debug/runtime-canary/provider.test.ts
packages/desktop-app/src/main/app-debug/runtime-canary/runner.test.ts
  3 files, 6 tests passed
```

真实进程执行：

```powershell
bun run verify:ui:start -- --runtime-canary greenfield
bun run verify:ui:status
bun run verify:ui:debug -- runtime-canary
```

最终结果：

- 会话创建、继续、列举、用户提问和中止全部通过独立 CLI 完成；
- Conversation 文件存在；
- Session 锁全部释放；
- Debug endpoint 已删除；
- Provider 已停止；
- Desktop 退出码为 `0`；
- 主进程日志不再出现 `unhandledRejection`；
- `bun run check:quick` 通过；
- 根目录完整 `bun run check` 通过，包含 Biome、monorepo `tsgo`、CLI 独立类型检查、
  Desktop 独立 `tsc`、Admin project build 和全部 quality guards。

## 8. 明确未修改

- 没有新增 CLI 子命令。
- 没有新增第二套会话操作协议。
- 没有改变默认 Desktop Runtime，普通启动仍使用既有选择规则。
- 没有把测试 Provider 或测试模型写入生产配置。
- 没有修改 Tool、Skill、MCP、Knowledge、Plugin、Scheduler 或 Batch 功能。
- 没有把 Debug Runtime 注册到打包生产环境。
- 没有把合法的中止终态竞争强行改造成单一状态。
- 没有用 UI 自动化替代 Runtime 结果断言。

## 9. 下一步

下一阶段应复用本轮真实进程门禁，验证多个 RuntimeHost 消费者的进程级共存：

1. 在同一 Greenfield Desktop 进程中同时创建交互、Scheduler 和 Batch 会话。
2. 验证它们共享 Host 资源但隔离 Session-local 配置、工具和事件。
3. 验证单个消费者中止或释放不会关闭其他消费者的会话。
4. 验证 Desktop 退出时所有消费者、后台任务和共享资源按所有权顺序释放。
5. 完成后再进入独立打包产物中的 CLI、Greenfield 模块和资源闭包验证。
