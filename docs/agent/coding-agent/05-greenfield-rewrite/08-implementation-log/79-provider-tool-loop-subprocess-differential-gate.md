# 第 79 轮：Provider/Tool Loop 子进程差分门禁

## 1. 本轮目标

在 Desktop 和 IM Gateway 尚未切换默认 Runtime 前，用同一个独立 RPC 可执行产物、同一个确定性
Provider 和同一组宿主观察规则，验证 Legacy 与 Greenfield IM 的核心运行行为等价。

本轮比较的是 IM 宿主实际消费的语义合同，不比较内部类、私有状态或逐字节事件快照。

成功标准：

1. 两个 Runtime 都通过真实 HTTP/SSE Provider wire 完成流式文本。
2. Tool Call、Tool Result 和第二次模型调用保持一致。
3. 主动中止会关闭在途 Provider 请求，并保留已到达的部分响应。
4. `im_send_attachment` 通过真实 RPC Host Bridge 往返。
5. memory rollover 后，路径事件、`get_state` 身份和进程级锁生命周期一致。

## 2. 可复用子进程与 Provider Fixture

CLI App 测试新增两类支持设施：

- RPC sidecar harness：一次构建真实 `agent-rpc-cli.ts` 独立产物，为每个场景创建隔离的 Agent
  目录、workspace、Conversation 目录和模型凭证，并按 JSONL Frame 驱动 stdin/stdout。
- OpenAI Responses fixture：只监听本机随机端口，用 Zod 校验外部请求边界，记录请求并输出确定性
  SSE；同时支持保持连接，以验证 abort 是否真正关闭网络请求。

测试没有注入进程内假 Session，也没有绕过 `@vetta/ai` Provider、Agent Core Tool Loop、RPC Dispatcher
或文件会话存储。

差分观察只归一化以下宿主语义：

- `agent_start`、`turn_start`、`turn_end`、`agent_end`；
- text delta 与最终 AssistantMessage 文本；
- Tool 名称和成功/失败终态；
- `session_path_changed`；
- `get_state.sessionFile` 与持久锁释放。

时间戳、UUID、绝对临时路径和 Provider request id 不进入脆弱快照。

## 3. 差分门禁发现并修复的问题

### 3.1 Provider 流式临时状态泄漏

OpenAI Responses 工具参数解析完成后，`toolcall_end` 事件携带的是最终 ToolCall，但 AssistantMessage
中仍保留内部 `partialJson` 字段。

Legacy 宽松 JSONL 没有暴露该问题；Greenfield 的 TypeBox 会话 schema 拒绝了这个非合同字段。
修复位于 Provider 解析边界：用最终 ToolCall 替换流式临时 block，而不是放宽持久化 schema。

### 3.2 中止时丢失部分 AssistantMessage

Agent Core 在中止后会完成 `turn_end` 并产出 `stopReason=aborted` 的部分 AssistantMessage，但 Turn
Pipeline 先检查已中止 signal，导致这两个终态信息无法持久化。

Pipeline 现在只允许中止清理阶段的两个必要事件通过：

- `turn_end` lifecycle observation；
- `stopReason=aborted` 的 AssistantMessage。

随后仍提交 `turn.cancelled`，不会把取消误记为完成，也不会允许普通事件在中止后继续执行。

### 3.3 Windows 附件绝对路径误判

`im_send_attachment` 原先用 `path.startsWith("/")` 判断绝对路径，只接受 POSIX 形式。Windows 的
`C:\...` 因此在进入 Host Bridge 前就失败。

修复改用 Node `path.isAbsolute()`，不改变文件存在性、普通文件检查或 Host Bridge wire。

### 3.4 `agent_end` 早于 Runtime 可接收下一轮

Greenfield 原先在 Kernel 的 turn Promise 完成前转发 Agent Core 的 `agent_end`。宿主收到
`agent_end` 后立即发送下一条 prompt，会遇到 `Session already has an active turn`。

Greenfield RPC Adapter 现在仅在活动 turn command settle 后交付已到达的 `agent_end`。Kernel 的并发
规则没有放宽；修复的是 RPC 反腐层对 Legacy wire 终态语义的投影。

## 4. 差分场景

新增五个真实子进程场景，并对 Legacy、Greenfield IM 各执行一次：

1. 流式文本：一个 Provider 请求，delta 与 final text 一致。
2. Tool Loop：模型调用 `read`，真实读取临时文件，Tool Result 进入第二个 Provider 请求。
3. 在途中止：Provider 先发送 `partial` 后保持连接；RPC abort 关闭请求，两个 Runtime 都交付部分
   final message 和完整终态。
4. Host Bridge：模型调用 `im_send_attachment`，测试宿主返回 `messageId`，Tool Result 进入第二次
   模型调用。
5. memory rollover：两轮响应跨过既有阈值，执行 memory flush 和 compaction，验证一次路径切换、
   `get_state` 跟随新文件、源/目标文件存在、活动目标锁存在以及 stdin close 后锁消失。

## 5. 类型校验选择

本轮在两个不可信边界继续使用现有适合的 schema 工具：

- Provider HTTP JSON 请求使用 Zod 解析，避免测试 fixture 把未知输入直接当成已知结构。
- 持久化 Session Event 继续由 TypeBox 严格校验；没有为了兼容测试而增加额外字段。

内部已类型化的 RPC Frame 归一化没有再叠加 schema 层，避免重复校验。

## 6. 明确未修改

- 没有改变 Tool 列表、Tool 参数、Skill、Prompt、MCP、Hook、Memory 阈值或模型选择功能。
- 没有把 Greenfield 设为默认 Runtime。
- 没有修改 Desktop 和 IM Gateway 的生产启动参数。
- 没有删除 Legacy 代码或旧会话格式。
- 没有把 Desktop Session Catalog 单独接入 Greenfield 文件。当前 Desktop 打开路径仍只支持
  Legacy；只增加“可见但不可打开”的条目会制造功能回退，必须与宿主 opt-in 和打开路由一起实施。

## 7. 验证

定向验证：

```text
packages/ai:
  bunx vitest --run test/openai-responses-tool-call-stream.test.ts

packages/runtime-core:
  bunx vitest --run test/kernel/turn-pipeline.test.ts

packages/coding-agent:
  bunx vitest --run test/im-send-attachment.test.ts

packages/cli-app:
  bun run typecheck
  bunx vitest --run test/greenfield-im-rpc-adapter.test.ts
  bunx vitest --run test/agent-runtime-selection.test.ts
  bunx vitest --run test/agent-runtime-provider-differential.test.ts

repository root:
  bun run check:quick
  bun run check
```

结果：32 项定向测试、CLI 独立类型检查、`check:quick` 与完整 `check` 全部通过。完整检查包含根
tsgo、Desktop `tsc --noEmit`、Admin `tsc -b`、Biome 和全部质量守卫。

## 8. 下一步

下一阶段应把“宿主 opt-in + 会话可见/可打开”作为一个完整阶段实施：

1. Desktop/IM sidecar Composition Root 显式选择新的 `vetta-agent-rpc` 入口与 Runtime 参数。
2. 默认仍为 Legacy，并保留可观测、可撤回的开关。
3. Desktop Session Catalog、open/resume、rename/delete 一次性识别 Legacy 与 Greenfield 格式，不能只
   增加列表可见性。
4. 用真实宿主启动路径复跑本轮 Provider/Tool Loop 门禁，并增加 crash/restart 与 fallback 验证。
5. 宿主门禁通过后，再讨论默认值切换和 Legacy 删除计划。
