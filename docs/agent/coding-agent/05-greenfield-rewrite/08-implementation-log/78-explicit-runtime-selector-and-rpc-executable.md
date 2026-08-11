# 第 78 轮：显式 Runtime Selector 与独立 RPC 可执行入口

## 1. 本轮目标

在不修改 Desktop 和 IM Gateway 默认启动路径的前提下，把第 77 轮的 Greenfield IM Runtime Host
接到一个真实、显式、可执行的选择入口，并固定 sidecar 进程的 JSONL 与会话所有权兼容合同。

成功标准：

1. 未显式选择时仍运行 Legacy。
2. Greenfield fallback 复用同一个 Bootstrap，不重复加载模型、Skill、Prompt、MCP 配置和 Extension。
3. RPC stdout 只能出现 JSONL Frame，启动诊断必须进入 stderr。
4. Greenfield ownership 冲突保持现有宿主可识别的 startup response 形状。
5. fresh、resume、Legacy fallback、冲突和 stdin close 必须由真实子进程验证。

## 2. Legacy 运行体与共享 Bootstrap

`coding-agent/main.ts` 现在拆成三个边界：

- `main(args)`：保留离线模式、包管理命令和 Legacy 默认入口；
- `createLegacyAgentBootstrap(args)`：保留旧 CLI 的诊断样式，创建一次共享 Bootstrap；
- `runLegacyAgentWithBootstrap(bootstrap)`：消费已加载资源并运行完整 Legacy 行为。

Greenfield 选择失败时直接调用 `runLegacyAgentWithBootstrap()`。这不是重新执行 `main()`，因此不会重新
扫描动态资源或重新创建 ModelRegistry。

同时把显式 `--offline` 的环境门禁下沉到共享 Bootstrap。由新 Selector 直接创建 Bootstrap 时，远程模型
加载仍与旧 `main()` 保持相同的离线行为。

## 3. 显式 Runtime Selector

`@vetta/cli-app` 新增宿主级参数：

```text
--agent-runtime legacy
--agent-runtime greenfield-im
```

选择器在进入 Coding Agent 参数解析前移除该参数：

- 默认值为 `legacy`；
- `legacy` 继续调用原 `main()`；
- 只有显式 `greenfield-im` 才准备 Greenfield IM Host；
- Greenfield 仍强制要求 `--mode rpc`、`--enable-host-bridge`、`im-claw` 和 `--session-dir`；
- 旧 JSONL、交互式 session selection 或 Legacy Extension 返回 fallback 时，复用原 Bootstrap 运行 Legacy；
- 未知 selector 值直接失败，不静默猜测。

这使“选择哪一个 Agent 实现”成为宿主 Composition Root 的职责，而不是 Kernel、Tool 或 Session 内部的
条件分支。

## 4. 独立 RPC 可执行入口

新增 `agent-rpc-cli.ts` 和 `vetta-agent-rpc` bin。该入口只负责：

1. 安装 RPC stdout guard；
2. 执行 Runtime Selector；
3. 把入口级异常写入 stderr 并设置失败退出码。

普通 `agent-cli` 也消费同一 Selector，但因为默认 backend 仍为 Legacy，所以未传新参数时行为不变。
Desktop Electron `--agent-rpc`、Windows staged sidecar 和 IM Gateway ProcessPool 本轮均未切换到该入口。

独立 bundle 验证还发现一个明确的分发约束：Coding Agent 初始化会从可执行文件相邻目录读取
`package.json` 获取产品名和版本，因此 sidecar 产物必须继续携带该资产。测试会把真实
`packages/coding-agent/package.json` 放到 bundle 相邻目录，避免源码环境掩盖资产缺失。

## 5. RPC stdout 与 ownership wire

动态 Skill、MCP 和 Hook 加载路径会使用 `console.log/info/debug` 输出诊断。对于普通 CLI 这是合理的，
但在 JSONL sidecar 中会污染协议。

专用 RPC 入口安装进程级 guard：

- `console.log/info/debug` 重定向到 stderr；
- `console.warn/error` 本来就在 stderr；
- RPC Transport 继续直接使用 `process.stdout.write`；
- guard 仅存在于专用 sidecar 进程，不改变 SDK 和普通 CLI 的 console 行为。

Greenfield ownership 冲突被映射为现有 startup response：

```json
{
  "type": "response",
  "command": "startup",
  "success": false,
  "error": "...",
  "lockHolder": {
    "pid": 123,
    "hostname": "host",
    "openedAt": "2026-07-29T00:00:00.000Z"
  }
}
```

Runtime Storage 内部字段 `acquiredAt` 只在反腐层映射为旧 wire 的 `openedAt`，没有反向污染存储合同。
冲突进程退出码保持 `2`。

## 6. 测试

新增 `agent-runtime-selection.test.ts`，先使用 Bun 把真实入口及其 workspace 源码依赖打成独立 bundle，
再从隔离的临时 workspace 启动 sidecar。测试不复用进程内 Runtime 对象。

覆盖：

1. Selector 默认 Legacy、两种参数写法和非法值。
2. fresh Greenfield handshake，所有 stdout 行均可解析为 JSON。
3. 空闲 abort 与非 memory-mode `flush_memory: written=0`。
4. stdin close 后进程正常退出并释放 `*.owner.lock`。
5. 使用真实 `*.conversation.jsonl` resume，sessionId 和 sessionFile 保持一致。
6. 两个真实进程争用同一 Conversation，第二个返回 startup conflict 和旧 `lockHolder` wire。
7. 旧 `*.jsonl` 进入 Legacy fallback，并仍可完成 `get_state`。

验证命令：

```text
packages/cli-app:
  bun run typecheck
  bunx vitest --run test/agent-runtime-selection.test.ts

repository root:
  bun run check:quick
  bun run check
```

结果：本轮 4 项 Selector/真实子进程测试、既有 3 项 Greenfield IM Host 测试和 1 项共享 Bootstrap
测试均通过；CLI 独立 typecheck、`check:quick` 与完整 `check` 通过。

## 7. 明确未修改

- 没有改变 Coding Agent 的模型、Tool、Skill、Prompt、MCP、Hook、Memory 或 Session 业务语义。
- 没有修改 Desktop 的 Agent RPC 命令选择。
- 没有修改 IM Gateway 的 Go ProcessPool、参数或 wire parser。
- 没有把 Greenfield 设为默认 backend。
- 没有让 Greenfield 伪装成支持 `legacy-full` Profile。
- 没有删除 Legacy main、AgentSession、SessionManager 或旧 JSONL。

## 8. 下一步

下一阶段应作为一个完整的“Provider/Tool Loop 子进程差分门禁”阶段：

1. 建立只监听本机临时端口的确定性 Provider fixture，不访问生产网络。
2. 让 Legacy 与 Greenfield 分别执行文本、Tool Call、Tool Result、自然结束、abort-in-flight。
3. 比较宿主实际消费的 response/event 序列，而不是内部类或私有状态。
4. 覆盖 Host Bridge 附件调用以及 memory rollover 后的 session path 变化。
5. 补齐 Greenfield 会话目录对 Desktop Session Catalog 的可见性。
6. 这些门禁通过后，才在 Desktop/IM 增加显式 opt-in；默认值仍保持 Legacy。
