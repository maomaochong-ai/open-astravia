# 第 176 轮：Greenfield Print 候选宿主与 CLI 差分门禁

## 目标

第 175 轮已经把 Print 从具体 `AgentSession` 反转为最小能力合同，但生产组合仍只有 Legacy 适配器。若直接复用 RPC 适配器，JSON Print 会丢失完整 message、turn 和 tool 事件；若继续把输入准备留在 Legacy `main`，Greenfield 又无法等价处理 stdin、`@file` 和多条消息。

本轮目标是建立显式 opt-in 的 Greenfield Print 候选路径，并用标准 `vetta` CLI 与 Legacy 做真实差分；默认 Print 继续使用 Legacy。

## 审计结论

### 1. Print 不能复用窄 RPC 事件投影

`GreenfieldRpcEventAdapter` 只承诺 RPC wire 实际消费的字段，稳定 `SessionEvent` 也不保存完整 partial message、turn message 和 toolResults。Print JSON 是既有可观察协议，因此必须消费 Runtime 的完整 `executionObservationStream`，再复用产品消息身份适配器生成既有 Agent 事件。

### 2. CLI 输入准备属于宿主边界

stdin 探测、`@file` 处理、首条消息与附件合并、隐式交互判断原本埋在 Legacy `main`。这些是 CLI Host 语义，不属于 Legacy Session。只有抽出共享输入准备，两个 Runtime 才能比较相同输入。

### 3. Extension 初始化不应强制 RPC UI

Print 没有 RPC UI、Host Bridge 或 shutdown request channel。Extension Event Host 的初始化因此改为可选的 UI、shutdown 和错误监听能力；RPC 组合显式映射其初始化合同，Print 只注入错误监听。

## 实施内容

### 共享 Print 输入准备

新增 `prepareCodingAgentPrintInvocation()`，统一处理：

- 非 TTY stdin 读取及消息前置。
- `@file` 文本与图片解析。
- 首条消息和附件合并。
- text/JSON 模式与已移除交互模式判断。

Legacy `main` 改为消费该结果，原有消息顺序和图片传递不变；同一入口同时供 Greenfield 候选使用。

### Greenfield Print 适配器

新增 `GreenfieldPrintSessionAdapter`：

- 从 typed Conversation Document identity 投影 Legacy v3 JSON header。
- 从完整执行观察流投影 `agent_*`、`turn_*`、`message_*` 和 `tool_execution_*` 事件。
- 从稳定 Session Event 补充 compaction、todo、background task、subagent、MCP reload 和路径变化事件。
- 直接通过 Active Session Host 执行 Extension 命令和 prompt，不把 Print 输入伪装成 RPC source。
- 复用既有 retry controller，保留自动重试执行及 retry 观察事件。
- 从 Conversation Document 投影最终 `AgentMessage[]`，供 text Print 输出最终 assistant 内容。
- 释放时复用既有可重试 Runtime/Session/Extension/MCP 清理事务。

### 显式候选入口

标准 Vetta CLI 现在支持：

```text
vetta --agent-runtime greenfield --print "prompt"
vetta --agent-runtime greenfield --mode json "prompt"
```

无 `--agent-runtime` 的 Print 仍默认 Legacy；`greenfield-im` 仍只接受 RPC。

### stdout guard 纠偏

真实 CLI 测试发现 stdout guard 之前按“非 Legacy backend”启用，导致 Greenfield Print 的正常文本和 JSON 被重定向到 stderr。guard 现在只按 RPC 意图启用：RPC 的纯 JSONL 保护保留，Print 恢复既有 stdout 输出合同。

## TypeBox / Zod 判断

本轮没有新增外部 JSON 输入或持久化格式。Header 来自已经类型化并在 Storage 边界验证过的 Conversation Document，只做内部到既有 wire shape 的确定性投影；再次引入 TypeBox/Zod 会重复校验，因此未新增 Schema。

## 测试

标准 `vetta` CLI 进程测试覆盖：

- 默认 Legacy text Print。
- 显式 Greenfield text Print。
- 默认 Legacy JSON Print。
- Greenfield/Legacy JSON 核心事件序列差分。
- 默认 Legacy piped stdin。
- 显式 Greenfield piped stdin。
- help control 命令不进入 Runtime 选择。

相关回归覆盖 Extension Session Host、Greenfield Runtime Host 和默认 RPC Runtime 选择。

## 验证结果

- `agent-print-mode.test.ts`：7 项通过。
- `greenfield-im-extension-session-host.test.ts`：1 项通过。
- Greenfield Runtime Host 与 Runtime Selection 回归：27 项通过。
- `bun run check:quick` 通过。
- 根目录 `bun run check` 通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。

## 明确未修改

- Print 默认 backend 没有切换，仍是 Legacy。
- Tool、Prompt、Skill、MCP、Knowledge、Memory 和 Provider 请求语义没有重构。
- RPC wire、Host Bridge 和 IM 默认路径没有修改。
- 没有删除 Legacy Print 适配器或旧会话格式支持。

## 尚未闭合

本轮证明了 text、JSON 核心事件和 stdin 的真实候选闭环，但还不能切默认：图片/`@file`、Provider HTTP 失败与自动重试事件、Extension 错误、会话继续/恢复、工具调用完整 payload 和安装产物仍需做 Legacy/Greenfield 差分。

当前共享 Runtime 组合函数仍同时组装 RPC 与 Print 外围对象；虽然 Print 已不依赖 RPC prompt source，但 Session 资源所有权尚未提取为独立中立 Host。这是下一轮应先处理的结构问题。

## 下一步

下一阶段应提取独立 `GreenfieldAgentSessionHost`，让 Runtime、Active Session、Extension Session 和 MCP 的所有权只组合一次，RPC/Print 分别挂载协议适配器；随后补齐图片、工具调用、Provider 失败/重试、Extension 错误、resume 和安装产物差分。完成这些门禁前，Print 默认 backend 不切换。
