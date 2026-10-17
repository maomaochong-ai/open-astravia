# Codex 与 OpenAstravia：多轮任务执行的效率与速度对比

> 分析对象：本地 `codex`（Rust 单体工作区 `codex-rs`）与 `open-astravia`（Bun/TS monorepo）。
> 方法：源码走读 + 结构对照，未运行端到端基准。除标注“实测”的两三项外，
> 其余“量级”均为按已读代码结构推导的估算区间，不能替代实测。
>
> **已被取代**：本文的 shell 启动开销与并行收益是估算值，实测后已修正。
> 请看 [codex-vs-open-astravia-rea-analysis.md](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/analysis/codex-vs-open-astravia-rea-analysis.md>)，以那份为准。

---

## 0. 一句话结论

结论分三句：

1. **单轮结构上 Codex 更优。** 它的工具"不等模型输出完、工具之间也不等彼此"，
   OpenAstravia 两者都等（先收完整消息，再严格串行）。这个优势真实存在，但**量级比直觉小**：
   本机 `rg` 全仓检索冷启 ~30 ms、shell 启动 10–30 ms，纯本地只读工具一轮的串行损失
   只有几十毫秒；真正拉开距离的是 MCP/网络工具批次和长命令批次。
2. **上下文压缩上 OpenAstravia 更好。** 它是后台预热 + 指纹校验复用（零等待切换），
   Codex 是轮内阻塞式压缩（`run_auto_compact(...).await`）。长会话里 OpenAstravia 会反过来领先。
3. **总时长的主导项是"轮数"，不是单轮毫秒数。** 这一点上两边各有缺口：
   Codex 有 `code_mode`（默认关闭）能一次输出完成多步操作，OpenAstravia 没有等价的代码执行工具，
   多步 shell 逻辑只能拆成多轮。

---

## 1. 循环结构的差异（根因）

### 1.1 Codex：流式派发 + 并行闸门

`codex-rs/core/src/session/turn.rs`

- 第 2212 行在进入 **流式接收循环之前** 就创建了 `FuturesOrdered` 的 `in_flight`；
- 流式 item 一完成，`stream_events_utils.rs:288 handle_output_item_done` 就把工具调用
  变成一个 future 丢进 `in_flight`（`tokio::spawn`），**不等整条 assistant 消息结束**；
- 第 2119 行的 `drain_in_flight` 在流结束后统一汇合，保证结果顺序与调用顺序一致。

`codex-rs/core/src/tools/parallel.rs`

- 第 48 行 `parallel_execution: Arc<RwLock<()>>`；
- 第 144–146 行：声明支持并行的工具取**读锁**（彼此并发），不支持的取**写锁**（独占）。

于是 Codex 一轮的真实耗时接近：

```
max( 生成时间 , 并行段工具时间 ) + Σ(独占工具时间)
而不是 OpenAstravia 的 生成时间 + Σ(全部工具时间)
```

### 1.2 OpenAstravia：先收完整消息，再严格串行

`packages/agent/src/engine/run-agent-turn.ts:160`

```ts
const toolCalls = state.lastAssistantMessage?.content.filter((b) => b.type === "toolCall") ?? [];
...
await executeRuntimeToolCalls({ calls: toolCalls, ... });   // 第 201 行
```

`packages/agent/src/engine/tool-executor.ts:29`

```ts
for (let index = 0; index < request.calls.length; index += 1) {
  const result = await executeOne(call, request);   // 一次一个，前一个结束才做下一个
  ...
  const steeringMessages = await request.takeSteeringMessages?.({...});  // 每个工具后查一次插话
}
```

一轮的耗时是加法：

```
TTFT + 生成 + Σ(工具耗时)
```

而且注意一个矛盾点：**请求里明确要求模型并行发工具调用**，执行器却是串行的。

- `packages/ai/src/providers/openai-responses/adapter.ts:127`、`anthropic/adapter.ts:41` 等
  统一设置 `parallelToolCalls: true`；
- 结果模型真的在一轮里发 4 个 `read`/`grep`，这 4 个会排队跑完；
- 即使扩展显式要求并行也会被拒：`packages/coding-agent/src/extensions/pi-compat/tool-adapter.ts:17`
  `executionMode === "parallel"` 直接抛不兼容错误。

### 1.3 差距的量级（实测前提 + 分场景）

本机实测：`rg -n` 全仓检索冷启 ~30 ms、热启 <10 ms；`bash -lc true` / `zsh -lc true` 启动 10–30 ms。
也就是说，**纯本地的 `read`/`grep`/`glob` 批次，串行与并行的差额只有几十毫秒**，
不是主要矛盾。差距集中在两类场景：

| 场景 | 单轮差额 | 说明 |
| --- | --- | --- |
| 3 个本地只读工具 | 20–60 ms | 双方都很快，几乎无感 |
| 3 个 MCP / 网络工具（每个 0.5–3 s） | 1–6 s | 串行=相加，并行=取最大；本机已装 dbx（25 个工具）、rea（207 个），这类批次很常见 |
| 1 个长命令（测试/构建 10 s）+ 2 个只读 | 几十 ms–0.3 s | 只读工具本可与长命令并行，但语义上通常需要先读完再改，收益不稳定 |
| 工具与生成重叠 | 0.1–0.5 s | 取决于模型是否在最后一个工具调用之后还继续输出 |

所以更准确的说法是：**本地工具的串行几乎不要钱，真正吃亏的是长耗时、可并行的批次（MCP 调用、
多个独立命令）以及生成尾部的重叠窗口。** 这直接决定了 P1 改造应该先拿哪一类工具开刀。

---

## 2. 上下文传输：WebSocket 增量 vs HTTP 全量

Codex `core/src/client.rs`

- 第 16 行的文件头注释直接写明：连接复用 + `previous_response_id`；
- 第 319/336 行维护 `previous_store` / `current_store`；
- 第 1613 行构造"增量请求"（只发新增 item）。

OpenAstravia `packages/ai/src/providers/openai-responses/request.ts:60`

```ts
store: false,
```

无 `previous_response_id`，每轮把**完整历史**重新 POST 一遍。

代价评估（要诚实）：两边的 provider 侧前缀缓存都做得不错——
OpenAstravia 甚至会显式切出稳定前缀（`anthropic/request.ts` 的 `buildSystemBlocks`，
`systemPromptStableLength` 来自 `packages/coding-agent/src/model-context/prompt-document.ts:163`），
把 `cache_control` 打在稳定段上。所以"没缓存"不是问题，差别只在：

- 上行字节：10 万 token 上下文 ≈ 400 KB JSON，gzip 后 60–80 KB。千兆/家宽 5 Mbps 上行分别
  ≈ 15 ms / 130 ms 每轮；
- 服务端入口解析与排队：与字节量成正比，通常几十毫秒。

**结论：这是 30–250 ms/轮 的差距，不是主要矛盾**，但在弱网（移动热点、跨境直连）下会放大到
肉眼可感，且它是"纯损失"，没有换来任何能力。

---

## 3. 上下文压缩：OpenAstravia 反超的地方

Codex `core/src/compact.rs` + `compact_remote*.rs`：压缩发生在轮内
（`session/turn.rs:1205` 的 `run_auto_compact(...).await`），**阻塞**——先停下，发一次摘要请求，
拿到摘要才能继续。单次代价 = 一次完整模型的 TTFT + 生成，长上下文下 10–40 s；
走 remote 变体（服务端摘要）时这段可以短一些，但仍然是轮内串行等待。

OpenAstravia `packages/coding-agent/src/compaction/prefire.ts`：

- 到阈值前 `lead`（默认 10%，按增速自适应到 25%）就开始**后台**跑摘要并缓存；
- 触发时用"上次压缩边界之后 entry id 链"的 FNV-1a 指纹校验前缀未变，命中即**零等待**切换；
- 另有 `microcompact.ts`：不需要模型的纯函数裁剪，先砍旧 `toolResult`/`bashExecution`（保留最近 8 条）。
  这是 Codex 没有的一层，属于"不花钱的止血"。

再加上 `token-policy.ts::shouldCompact` 以上一次 assistant usage 为锚点，
比 Codex 依赖 tokenizer 估算更贴近真实计数。

**这意味着：会话越长，OpenAstravia 的优势越明显。** 一次阻塞压缩省下的 10–40 s，
足以抵消前面十几轮的串行工具损失。

风险点：prefire 缓存在内存里，会话重载后需重新预热；若一次工具调用的增量直接跨过阈值
（工具密集会话常见），prefire 可能来不及，退化回同步压缩。代码里已用自适应 `lead` 缓解，
但仍建议埋点统计"prefire 命中率"。

---

## 4. 进程与工具实现

| 维度 | Codex | OpenAstravia | 影响 |
| --- | --- | --- | --- |
| Shell | `unified_exec` 常驻进程 + `shell_snapshot.rs` 复用环境快照 | `runtime-node/src/coding/host/bash-executor.ts` 每条命令 `spawn` 新 shell | 本机实测 shell 启动 10–30 ms（M 系列 + 精简 rc）；重 rc 环境可达 100–300 ms。且无 `cd` 连续性，目录穿梭类任务要多花轮次 |
| 文件读取 | 无专用 read 工具，靠 shell（`sed -n`） | 专用 `read`/`grep`/`glob`/`tree`，进程内直接返回 | 相反方向的优势：OpenAstravia 的只读工具更快、结果更结构化 |
| 输出截断 | `utils/output-truncation`：**中间截断**（保头保尾），exec 默认 10k token | `truncateHead`（read/grep）+ `truncateTail`（bash，50 KB） | bash 用尾部截断是对的（错误在末尾）；但 50 KB ≈ 12.5k token 单条，比 Codex 的 10k 上限略大，且尾部截断会丢命令回显 |
| 大动作 | `apply_patch` 一次改多文件；`code_mode`（特性开关）在 V8 里写脚本一次调度多个工具 | `edit` 支持锚点批量（`edits` 数组）；无代码执行工具 | `code_mode` 默认关闭，不构成现实差距；但"一次模型输出完成多步操作"这条路径 OpenAstravia 没有替代品 |

---

## 5. OpenAstravia 独有的每轮开销（Codex 没有对应项）

三处值得测，但都不能凭读码断定是瓶颈：

1. **每轮重新 compose 模型调用帧**
   `packages/coding-agent/src/model-context/model-call-frame-composer.ts:276` 起，
   每次都编译 system prompt、投影工具集、绑定 plugin/MCP。CPU 开销大概率在毫秒级，
   真正的风险是**前缀漂移导致缓存失效**——MCP 工具可见性、plugin 运行时状态若在轮间变化，
   稳定前缀就断了，损失是整段 prefill 的钱和时间。`packages/runtime-core/.../model-call-frame.ts`
   已有 `stableLengthDeclared` 诊断，建议接上命中率指标。
2. **provider 调用前的投递屏障**
   `packages/runtime-core/src/kernel/stateless-agent-core-turn-engine.ts:215`
   `await eventDelivery.waitForCurrentDelivery(signal)`——等所有已发事件被消费完才发请求。
   这是保证 UI 顺序的正确设计，但如果消费者里含落盘/渲染慢路径，它会串行挡在 TTFT 前面。
3. **每个工具之间查一次插话队列**（`tool-executor.ts:37`）——内存操作，成本可忽略，
   但它把"并行执行"在语义上排除掉了，改造时要一并想清楚插话优先级。

---

## 6. 可观测性：先能测，再谈优化

Codex `core/src/turn_timing.rs` 的 `TurnProfileState` 记录：
TTFT、首个工具消息时间、sampling 总时长、compaction 时长、`tool_blocking`、
`between_sampling_overhead`、`sampling_request_count` / `retry_count`——这些指标能直接定位
"这 40 秒花在哪"。

OpenAstravia 的 `packages/runtime-core/src/kernel/agent-engine-telemetry.ts` 目前主要产出
span（`llm.*`、工具 span），**没有轮级汇总画像**，TTFT/工具阻塞占比需要事后从 trace 手工拼。

> 任何优化都应该排在这件事之后，否则无法证明改动有效。

---

## 7. 建议（按性价比排序）

### P0：轮级耗时画像（成本最低、其他优化都依赖它）

在 `AgentEngineTelemetry` 里聚合：`ttftMs`、`generationMs`、`toolMs`、
`toolBlockingRatio`、`betweenCallOverheadMs`、`promptCacheHitRatio`。
现在只有 span，得事后手工拼；Codex 的 `TurnProfileState` 就是现成的分组参考。
没有这组数，“串行到底占多少”“缓存有没有断”都只能猜。

### P1：可并行的工具批次（收益集中在 MCP / 慢工具，不是本地只读）

预期：本地只读批次几乎无感（几十 ms），**真正的收益在 MCP/网络工具与独立长命令上，1–6 s/轮**。

改造点（三处，规模可控）：

1. `packages/agent/src/engine/types.ts:100` 的 `RuntimeToolDefinition` 增加并发语义，
   例如 `readonly concurrency?: "parallel" | "exclusive"`（缺省 `exclusive`，保持现有行为）；
2. `packages/agent/src/engine/tool-executor.ts:29` 的 `for` 循环改为分批：
   相邻的 `parallel` 调用 `Promise.all` 并发，遇到 `exclusive` 先汇合再独占执行，
   结果按原顺序回填（`FuturesOrdered` 的等价物），保持 `tool_execution_*` 事件时序不乱；
3. 第一批只标**无共享状态**的工具：`read`/`grep`/`glob`/`ls` + 只读 MCP 查询。
   写操作、`bash`、账号/MCP 副作用类保持 `exclusive`。

必须先解决的一个语义问题：`takeSteeringMessages` 现在是“每个工具后查一次”。
并行后应改为“一批结束后查一次”，并把未被采纳的后续调用标记为 skip——
否则用户插话的响应会变得不可预测。

风险：`bash` 一旦标错成 `parallel`，两个并发 `spawn` 会争抢同一文件/端口。

### P2：工具与生成重叠（预期 0.1–0.5 s/轮）

在 `run-agent-turn.ts` 的流式消费里，检测到 `toolCall` block 完整（参数收敛）即可提交给执行器，
不必等 `message_end`。前提是 P1 的分批执行器已经存在，否则只是把串行开始时间提前一点点。

Codex 的做法值得抄一半：它用 `FuturesOrdered` 保证结果顺序，
“先启动、后汇合”不会打乱 toolResult 的排列。OpenAstravia 需要同样的顺序保证，
否则下一轮请求里的 toolResult 顺序会变，可能触发前缀缓存不连续。

### P3：OpenAI 侧的连接复用与增量上下文

`openai-responses` 走 WebSocket + `previous_response_id`。是纯工程活，收益 30–250 ms/轮，
但会引入“服务端持有会话状态”的兼容性问题（`store: false` 是当前刻意的无状态选择），
建议放在 P1/P2 之后，且只作为可选路径。

### P4：长驻 shell（收益取决于用户环境）

把 `bash` 从“每条命令一个 `spawn`”改成会话内常驻 + 输出缓冲。本机只能省 10–30 ms/条，
但换来 `cd`/环境变量连续性——目录密集型任务能直接省掉若干轮往返。
代价是进程生命周期、孤儿进程回收、权限审批模型都要重做，属于大改，收益不稳定。

### P5：减少轮数（最治本，但范围最大）

总时长的主导项是轮数。Codex 有 `code_mode`（默认关闭）：一段脚本里连续调多个工具，
一次模型输出完成多步操作。OpenAstravia 目前没有等价的代码执行工具，
多步 shell 逻辑只能拆成多轮（每轮都是一次完整 TTFT）。
这一条建议先出设计文档再动手，不要直接开工。

### 不建议改

- **压缩链路**：`prefire` + `microcompact` 已经比 Codex 的阻塞式压缩更好，别动。
- **专用只读工具**：比 Codex 走 shell 更快，是优势项。
- **`cache_control` 稳定前缀拆分**：方向正确，需要的是挂指标而不是重构。

---

## 8. 未验证项

- 没有跑端到端基准。文中只对两件事做了真实测量（`rg` ~30 ms、shell 启动 10–30 ms），
  其余都是结构推导；本轮估计量级从最初的“每轮快 5%–15%”下调为“本地只读几乎无感，
  MCP/慢工具批次 1–6 s/轮”，就是因为实测后发现本地工具太快。
- 第 5 节三处开销没有实测数据，可能有 1–2 处站不住脚。
- Codex 的 `code_mode` 是特性开关，默认关闭，本次未评估开启后的差距；
  若开启，"一次输出完成多步操作"会进一步压缩轮数，这是 OpenAstravia 目前没有的维度。
- 两边模型/Provider 配置不同（Codex 走 OpenAI Responses，OpenAstravia 支持多家），
  跨 Provider 的 TTFT 差异未纳入比较。
