# 「未命名会话」与「一直不回复」bug 排查报告

> 现象（用户截图，会话 `d35ae356`）：新建会话发送长文字任务后，① 侧边栏项目下方出现「未命名会话」；② 对话界面停在「Astravia 正在思考 / 正在回复…」始终无回复。
> 排查方式：读码 + 本机会话 JSONL 实证（`~/.astravia/agent/sessions/…/d35ae356….conversation.jsonl`，858 行 / 3.9 MB）。
> 证据分档：**实测**（本机文件、可复跑）/ **读码**（有源码行号）。未验证项在 §5。

## 1. 路由（本次跳过 REA，原因如下）

目标都是本仓 TypeScript 源码 + 本机磁盘会话文件，不存在二进制逆向问题；此前 codex 逆向留下的 REA 工作流针对的是外部二进制目标。本任务按普通源码 + 数据文件排查执行，不占用 REA 六阶段流程。

## 2. 现场证据（实测）

对本机全部会话 JSONL 的扫描（`~/.astravia/agent/sessions/**` 与 `~/.astravia/conversation/**`，共 39 个文件）：

- 当前项目（open-astravia）下所有近期会话**都有名字**（`session.name.set` 已落盘）。首条消息普遍很短（"hi" 2 字符等）。
- 唯一的超长首条消息（2000+ 字符）全部出现在 `.subagents/` 子目录的子代理会话里。
- 当前会话文件尾部：turn `e61ca652` 共 212 个事件，最后一条是 assistant `toolCall`（1792226943498），**无对应 toolResult、无 turn.completed**——这是截屏时正在运行的轮次，符合「正在回复」的真实状态，非死循环。
- `queue.json` 里留存一条 15:49 的 `followUp` 排队消息（主题是「停止按钮无法停止」，用户另报的 bug），paused=false，属于 pause-on-terminal 冻结后的正常残留。

结论：**截图里的两个症状，在本机上不是「长文本」本身触发的数据损坏**，而是两条独立链路的时序缺陷在特定条件（首轮 turn 异常终止 / 无网络回包）下的必然表现。长文本只决定了 turn 更容易长时间运行、更容易暴露这些缺陷。

## 3. 根因分析（读码）

### 3.1 Bug ②「一直不回复」：流层没有空闲看门狗

链路：`session.prompt` → kernel `startRequest`（`agent-session.ts:494`）→ `pipeline.runRequest` → 模型流（`openai-completions/adapter.ts` 的 `produceOpenAICompletions`）。

- `for await (const chunk of response)`（adapter.ts:243 附近）的循环体只在「收到 chunk」时推进。OpenAI SDK 默认超时只覆盖建连与请求期；**流打开后若服务端/代理不再发任何字节（含 keep-alive），该循环可以无限挂起**。
- `maxRetries` 缺省 0（`retry-policy.ts:1`），没有任何组件在「长时间无事件」时主动判死。
- 渲染端「正在回复…」指示器（`agent-message.tsx:392` `AgentMessageStreamingIndicator`）只看 `isCurrentlyStreaming`，而 streaming 态由 turn 生命周期事件驱动——turn 不终结，UI 永远停在「正在回复」。
- 结果：turn 挂死 → `agent_end` 永不到来 → `isStreaming` 永为 true → 输入框停止按钮对该 turn 调 `abort` 理论上有效，但若 socket 层已死（无响应），abort 只能等 `ABORT_UNWIND_TIMEOUT_MS` 兜底（`agent-session.ts:324`）。用户感知就是「永远不回复、且停止很慢」——与用户在本会话 queue 里报告的第二个 bug 完全吻合。

**修复 A（已实施）**：`packages/ai` 增加「流空闲看门狗」。

- `StreamOptions.streamIdleTimeoutMs`（`types.ts`，缺省 300000ms、0 关闭）。
- `openai-completions/adapter.ts`：流打开后逐 chunk 重置定时器；超 `streamIdleTimeoutMs` 无任何 chunk（含 keep-alive）→ `AI_TIMEOUT`（retryable=true，`metadata.reason: stream_idle_timeout`）并 abort 传输。上层重试/错误 UI 即可接管，用户看到的是一条可重试错误而不是无限「正在回复」。
- 看门狗 abort 走独立 `AbortController`，与用户 signal 用 `AbortSignal.any` 合并（`createLinkedAbortSignal` 只单向传播、无用户 signal 时原实现根本无处可打，故必须独立通道）。
- `buildBaseOptions`（`simple-options.ts`）透传该字段到所有 OpenAI 兼容 provider（含 DeepSeek）。

测试：`packages/ai/test/openai-completions-idle-watchdog.test.ts`——挂死流 60ms 判死为 error 且错误消息含 idle 秒数；正常流不受影响；0=禁用。**3/3 通过**；既有 usage/adapter 回归 **13/13 通过**。

### 3.2 Bug ①「未命名会话」：auto-title 只有一条成功路径

侧栏展示名逻辑（`project-atoms.ts:100` `sessionDisplayLabel`）：`name` 空 且 `firstMessage` 空或 `(no messages)` 时才显示「未命名会话」。名字的唯一来源是 auto-title，其触发条件极其单一：

`desktop-conversation-service.ts` `promptWithAutoTitle`（原 431-474）：

1. 仅当首条 prompt、会话无消息、且 session 未在排程表时订阅 `agent_start`；
2. **只有收到 `agent_start`** 才调 `SESSION_TITLE_GENERATE` 生成名字；
3. 生成返回 `null`（无可用模型、API key 缺失、全部候选冷却中——`session-assistance-runtime.ts:177-182` exhausted 直接 null）→ `.then` 里静默返回，**不写任何名字**；
4. 生成抛错 → 仅 log warn，同样不写名字；
5. turn 在 `agent_start` 之前失败/被拒（prompt 校验、hook 阻断、provider 前置错误）→ 订阅在 finally 中拆除，**名字永远无人写**。

配套的窗口：`listSessions` 的 `firstMessage` 取自磁盘 JSONL 首条用户消息（`file-conversation-session-services.ts:190`）。用户消息在 turn 准备期落盘后侧栏能显示文本前缀；**但 turn 若在准备期就死了（消息没落盘），磁盘上就只有 header——name 空 + firstMessage `(no messages)`，即「未命名会话」**。渲染端乐观兜底（`useSessionMessageSender.ts:401` ensureLocalSession）依赖 `session.sessionPath` 存在且 `!streaming`，新建流程里 `ensureLocalSession` 有多个时序缝隙（openSession 兜底又要求「list 未收录」才插入，`useSessionOpener.ts:671`——磁盘已写 header 时不会插）。

即：**3.1 的挂死流（或任何 turn 早期失败）必然命中 ①**——两个症状共享同一根因链。

**修复 B（已实施）**：给 auto-title 补齐兜底路径（同一文件 `promptWithAutoTitle`）：

- 生成返回 null 或抛错 → 用首条用户文本的确定性兜底标题（`fallbackSessionTitle`：压成单行、按 Unicode 码点截 30 字符，语言无关）；
- 新增订阅 `aborted` / `agent_end`：turn 未到 `agent_start` 就终止时，同样写兜底标题，写完清理排程表。

测试：`desktop-conversation-service.test.ts` 新增 2 用例——生成返回 null 走兜底；`aborted` 终态（未到 agent_start）走兜底。**18/18 通过**（含 16 个既有用例，证明未破坏原命名时序）。

### 3.3 顺带记录（未修复，仅说明）

- `queue.json` 里那条 15:49 的 followUp 残留属于 pause-on-terminal（ADR-0060）的设计行为：turn 异常终止时冻结队列，等用户显式继续。UI 有「继续」入口；不修。
- 渲染端 `loadSessions` 合并（`useProjects.ts:117-122`）与 `ensureLocalSession`（`:399`）已有防闪回逻辑，本轮不动。

## 4. 影响面与验证

| 改动 | 文件 | 验证 |
| --- | --- | --- |
| 流空闲看门狗 | `packages/ai/src/types.ts`、`packages/ai/src/providers/openai-completions/adapter.ts`、`packages/ai/src/providers/simple-options.ts` | 新测试 3/3 + 回归 13/13；定向 lint 通过 |
| auto-title 兜底 | `apps/desktop/src/main/conversations/desktop-conversation-service.ts` | 18/18（含新增 2 用例）；定向 lint 通过 |
| 测试 | `packages/ai/test/openai-completions-idle-watchdog.test.ts`（新）、`desktop-conversation-service.test.ts`（增 2 用例） | 见上 |

- 行为变化：Provider 流静默 ≥5 分钟（缺省）时，原本永远挂起的 turn 现在以可重试错误终结；首条消息的会话在任何 turn 终止路径下都会得到一个名字（生成失败/未启动时为文本截断兜底）。
- 兼容性：`streamIdleTimeoutMs` 为新增可选字段，缺省即生效；设 0 恢复旧行为。兜底标题仅在「原本永远无名」的路径上写入，不影响正常 auto-title 与用户手动改名（后者先写先得，兜底路径不覆盖已写名字的场景只覆盖「无名」场景）。
- 风险：真有模型单 chunk 间隔 >5 分钟的场景（未见过；推理模型的 keep-alive/心跳通常以秒计）会被误判——设 0 可关，或调大字段值。看门狗超时后传输若完全无视 abort signal（SDK 实现不允许，socket abort 一定生效），`for-await` 仍会挂——此为极小概率残余，交由上层 cancel 兜底。

## 5. 未验证项

- 未做真实 Provider 的挂流复现（不产生真实费用；以 fake transport 语义等价覆盖：SDK 收到 abort 后销毁连接，fake 用 reject 模拟同一合同）。
- 「未命名会话」截图对应的原始会话未找到（可能已被用户删除，或即当前会话在 auto-title 落盘前的瞬时窗口）——依据是读码推导的完整覆盖面 + 实测的会话文件抽样。
- 5 分钟缺省值未经真实弱网/长推理任务标定；建议后续按 provider 观测数据调整。

## 6. 证据台账

| 结论 | 证据 | 档 |
| --- | --- | --- |
| 全部近期会话均有名字；超长首条消息只出现在子代理会话 | 扫描 `~/.astravia/agent/sessions/**` 39 个 jsonl | 实测 |
| 当前会话截屏时 turn 在跑（212 事件、尾部 toolCall 未闭合） | `d35ae356….conversation.jsonl` 尾部解析 | 实测 |
| 队列残留 followUp 为 pause-on-terminal 设计行为 | `d35ae356….queue.json` + `agent-session.ts:479-487` | 实测+读码 |
| 流循环无空闲超时；maxRetries 缺省 0 | `adapter.ts` for-await、`retry-policy.ts:1` | 读码 |
| auto-title 只有 agent_start 单一触发；null/异常/早夭路径不写名 | 原 `desktop-conversation-service.ts:431-474`、`session-assistance-runtime.ts:129-183` | 读码 |
| 侧栏「未命名」判据 = name 空 且 firstMessage 不可用 | `project-atoms.ts:92-105`、`file-conversation-session-services.ts:190` | 读码 |
| 看门狗与兜底行为正确 | 新增测试 3+2 用例全绿 | 实测 |
