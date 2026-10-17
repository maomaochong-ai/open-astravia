# REA 逆向分析：Codex 的多轮执行机制，以及 OpenAstravia 该吸收什么

> 流程：路由 → 接入 → 分析 → 提升 → 验证 → 证据。
> 目标类型判定为**原生（native）**：Mach-O arm64，Rust 编译产物。
> 证据分三档：**实测**（本机跑过、可复跑）、**读码**（有源码行号）、**REA**（工具输出）。
> 未验证的东西不写成结论，集中列在第 5.5 节。

---

## 1. 路由：目标类型与身份

| 项 | 结果 |
| --- | --- |
| 目标类型 | 原生（native）——不是 JavaScript / .NET / 固件 / Web / 移动 |
| 已构建产物 | `~/.npm-global/.../@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`，271,134,288 字节，`Mach-O 64-bit executable arm64` |
| 版本 | `codex-cli 0.145.0`（`codex-package.json` 与 CLI 自报一致） |
| 附带产物 | `codex-code-mode-host`（46,375,040 字节）、自带 `zsh 5.9.0.3-test`、自带 `ripgrep 15.2.0` |
| 源码快照 | `codex` 仓库 HEAD `ea72984`（2026-08-10），文件时间集中在 07-29；仓库版本号声明为 `0.0.0`，以已发布 0.145.0 为准 |

**为什么不是 JavaScript 目标**：`~/.npm-global/bin/codex` 只是 100 行 node 启动器，真正的实现全在那颗 Rust 二进制里；也没有 ASAR。
**验证做到哪一层**：要回答的是“每轮为什么快”，答案在调度结构（并发门、流式派发、计时分相），不在机器码，所以对 271 MB 的 Rust 二进制做 Ghidra 伪代码只会得到噪音。本轮把二进制核到符号与字符串层（§2.1）：足够证明机制在发布版里，不足以证明每一行实现细节。

版本身份：`strings` 中 `0.145.0` 命中 16 次，与 `codex-cli 0.145.0` 一致；二进制**没有**嵌入源码 commit 串，所以与本地源码 HEAD 的对应关系只能靠版本号建立。

---

## 2. 接入：REA 检查结果

- 引擎状态：`engine: ready`。本轮曾因主二进制超限报过一次 `resource_constraint`（retryable=false），引擎恢复后重新核过进度。
- `inspect_rust_binary` 对 `codex-code-mode-host`：成功，`sha256 c75e27ea…`，`mach-o/arm64`，**无 `.dep-v0` 段**（evidence `ev_1b825637e374e70daa556470c16e2c2c1cece02a09be00f11efd3565bb31dbe7`）。结论：该产物不是 cargo-auditable 构建，依赖清单不可得；缺席不等于没有依赖。
- 对主二进制：被 REA 的 256 MiB 输入上限拒绝（271 MB > 268,435,456 字节）。这是资源约束，不是"二进制有问题"；本次结论不依赖依赖清单，未绕过该限制。

可观测的产物事实：Codex **自带 shell 和自带 ripgrep**。这两件事直接解释了它为什么敢做 shell 快照和"没有独立 read 工具"——它不依赖用户机器上的 `rg` 版本，也不依赖用户 rc 是否可用。

### 2.1 引擎恢复后补做的发布版核对

`open_binary` 在本客户端无法绑定目标：参数投影把可选项当成必填项，空串被服务端以最小长度拒绝，非空又会被当成分析快照去导入（给个 JSON 报 "entries is missing"，给个 .mjs 报 "not valid JSON"）。这是工具链缺陷，不是目标问题；我没有伪造 REA 证据绕过它。

改用等价手段（Mach-O 符号表，`nm -a`，55,922 条，未被 strip）核对“源码 HEAD（08-10）里读到的机制，是否真在 0.145.0 的发布版里”：

| 源码机制 | 发布版中的符号 |
| --- | --- |
| 快照包裹（`runtimes/mod.rs:231-301`） | `codex_core::tools::runtimes::maybe_wrap_shell_lc_with_snapshot` |
| 流式排空（`turn.rs:2704`） | `codex_core::session::turn::drain_in_flight`（含其 tracing CALLSITE） |
| 计时保护（`parallel.rs:282-287`） | `codex_core::tools::parallel::ToolCallTimingGuard::drop` |
| 会话级快照对象 | `shell_snapshot::ShellSnapshot::new`、`try_create`、`ShellSnapshotFile::drop` |
| 每工具并行位（`tool_executor.rs:64`） | 3 个单态化的 `tool_executor::supports_parallel_tool_calls`（`ExposureOverride`、`MultiAgentV2NamespaceOverride`、`ExtensionToolAdapter`） |
| 连接复用头与体 | 字符串 `x-codex-turn-state` ×9、`previous_response_id` ×10 |

两个反面结论同样有用：整份符号表里**没有任何 `__dep_v0` 段**，字符串里也**0 处 `dep-v0`**——这说明 `inspect_rust_binary` 想读的依赖清单不是“读不到”，而是这个构建根本没嵌进去（与 `code-mode-host` 一致）。所以主二进制超限这件事不再是未知项，它本来就没东西可读。

结论：六条机制在发布版里全部存在，版本漂移不构成风险。

---

## 3. 分析：六条机制，逐条对照

### 3.1 工具并发：默认独占，显式申请并行

`core/src/tools/parallel.rs:143-146`

```rust
let _guard = if supports_parallel {
    Either::Left(lock.read().await)   // 读锁：彼此并发
} else {
    Either::Right(lock.write().await) // 写锁：独占
};
```

默认值在 `tools/src/tool_executor.rs:64` 是 `false`——**不声明就独占**。显式声明 `true` 的有：
`shell_command`、`exec_command`、`view_image`、`tool_search`、MCP 资源读取（`list/read_mcp_resource*`）。
`apply_patch` 没有声明，所以写操作永远独占。

MCP 工具走另一条判定（`handlers/mcp.rs:78-89`）：`server 显式声明 || readOnlyHint == true` 即视为可并行，注释写的是“正确的 MCP server 应该能容忍对只读工具的并发调用”。这是**信任服务端自述**的做法。

这一段设计最值得抄的不是"并行"，而是**默认保守 + 逐工具申请**：新工具不小心加进来时，默认行为是安全的。

OpenAstravia 侧：`packages/agent/src/engine/tool-executor.ts:31` 是纯 `for + await`，`RuntimeToolDefinition`（`packages/agent/src/engine/types.ts:100-112`）只有 `name/description/inputSchema/validateInput/execute`，没有并发语义位。同时 `packages/ai/src/providers/openai-responses/adapter.ts` 还在向模型宣告 `parallelToolCalls: true`——**要求模型并行发，自己串行跑**。

值得注意的是：本仓已在 `packages/coding-agent/src/features/plan-mode/plan-mode-tool-policy.ts:11-14` 明确写过“MCP 的 readOnlyHint 只是服务端自述”，并据此把 MCP 全部排除在只读白名单外。所以这条在 codex 那边能抄、在 astravia 这边要单独决策。

### 3.2 流式派发：不等整条消息

`core/src/session/turn.rs:2211-2212` 在流循环**之前**建 `FuturesOrdered`；`:2357` 每收到一个已完成的 item 就把工具 future 推入队列；`:2704` 流结束后才 `drain_in_flight`。

`core/src/stream_events_utils.rs:297` 的注释写得很直白：

```rust
// The model emitted a tool call; log it, persist the item immediately, and queue the tool execution.
```

关键点：触发单位是 **单个 output item 完成**，不是 delta、也不是整条消息。模型还在生成后续内容时，第一个工具已经在跑。

OpenAstravia：`packages/agent/src/engine/run-agent-turn.ts:160` 要等 `state.lastAssistantMessage` 完整落地后才过滤 `toolCalls`，`:201` 才调执行器。零重叠。

**但前置条件其实已经具备**：provider 层在 `response.output_item.done` 到达时就 push 了 `toolcall_end`（`packages/ai/src/providers/openai-responses/events.ts:158, 226`），而且 `applyCompletedResponse`（`:255-259`）只回写 usage 与 stopReason，**不重写 toolCall 内容**——也就是说早拿到的 `toolCall` 与最终消息里的完全一致，不存在“先执行了又被纠正”的竞态。差距只在 `run-agent-turn` 一侧：它没听这个事件。

### 3.3 计时分相：把"等锁"和"干活"分开

`core/src/turn_timing.rs:59-68` 的 `TurnProfileState` 分相：`Sampling / Compaction / ToolBlocking`，并单独累计
`before_first_sampling`、`between_sampling_overhead`、`sampling_request_count`、`sampling_retry_count`。

更细的一层在 `parallel.rs:314-345`：每个工具调用记 **`dispatch_duration_ms`（排队等锁）** 与 **`handler_duration_ms`（真正执行）**，两者分开。没有这个拆分，你把工具改成并行也说不清收益来自哪里。

`turn.rs:2699` 的 `tool_blocking` 只在 `in_flight` 非空时开表——它精确度量的是"流结束后仍需等工具的时间"，也就是**重叠没吃掉的残余**。

OpenAstravia：`packages/runtime-core/src/kernel/agent-engine-telemetry.ts` 只有 span，没有轮级分相汇总，也没有 dispatch/handler 拆分。

### 3.4 shell：自带的 zsh + 一次性环境快照

`core/src/shell_snapshot.rs:45` 有 `SNAPSHOT_DIR = "shell_snapshots"`，会话级生成一次、写盘、带 validate 与 3 天自动清理。真正的巧处在包裹方式，`core/src/tools/runtimes/mod.rs:231-301`：

```sh
# 只有当原本是 <shell> -lc <script> 时才包裹
<session_shell> -c "if . '<snapshot>' >/dev/null 2>&1; then :; fi
<重放 runtime PATH 等覆盖项>
exec '<原 shell>' -c '<原命令>'"
```

两个细节值得抄：`. snapshot` 包在 `if ...; then :; fi` 里、stderr 丢弃——**快照坏了也不能让命令失败**；source 之后又用 `build_override_exports` 把 runtime PATH 覆盖项**重新贴回去**，因为快照会把 PATH 整个换掉。

OpenAstravia 走的是另一条路：`packages/runtime-node/src/coding/host/node-shell.ts:67` 直接返回
`{ executable: "/bin/bash", args: ["-c"] }`——**非登录、非交互**，不读任何 rc。

这带来一个此前被忽略的**双向结论**：

- 速度上 astravia 其实不亏：`bash -c` 31–35 ms，`bash -lc` 63–161 ms。
- 但环境保真上 astravia 吃亏。实测同一台机器：

```
bash -c  → node = /Users/zhugeyue/.astravia/runtimes/node/22.22.2/bin/node
bash -lc → node = /usr/local/bin/node
```

astravia 是**故意**注入 runtime PATH 的（不读 rc 才不会让 nvm/pyenv 覆盖它）。所以快照不能只生成不重贴：codex 的做法恰好印证了这个坑——它在 source 之后**又把 runtime PATH 贴回去**。astravia 照抄时，顺序必须是"先 source 快照，再注入 runtime PATH"，反了就回到现在这个两个 node 的局面。

### 3.5 上下文增量：WebSocket + `previous_response_id`

`core/src/client.rs:1-18` 的模块文档写得很清楚：`ModelClient` 活一个会话，`ModelClientSession` 活一个轮，**缓存一条懒打开的 WebSocket**，每条轮开始前先发一个 `generate=false` 的预热请求并**等它完成**，好让真正的请求直接复用连接和 `previous_response_id`；另有 `x-codex-turn-state` 做粘性路由。

对比 OpenAstravia：`packages/ai/src/providers/openai-responses/request.ts:60` 是 `store: false` + 每轮全量历史 + 每次新建 HTTP 请求。

这条以前被我当作重要差距，但实测全量上传只要 43 ms@5 Mbps（第 5.3 节），要下调。真正的代价不在带宽，而在预热那一跳——它把连接建立也藏进了首 token 之前。

### 3.6 代码模式：确实存在，但默认关闭

`features/src/lib.rs:892-897`：

```rust
FeatureSpec { id: Feature::CodeMode, key: "code_mode", stage: Stage::UnderDevelopment, default_enabled: false }
FeatureSpec { id: Feature::CodeModeHost, key: "code_mode_host", stage: Stage::Stable, default_enabled: true }
```

即：**宿主二进制随包发布（默认开），但 code_mode 本体默认关**。`parallel.rs:282-287` 是真在跑的生产代码，注释写明"嵌套 code-mode 调用不再单独立计时，因为外层已包含它们"，说明这是真实路径，只是默认不给用户。

所以"一次模型输出里连续调多个工具"这个能力，Codex **默认拿不到**；不能算作它日常更快的理由。这一点纠正了我最初的猜测。

---

## 4. 提升：给 OpenAstravia 的吸收方案

按"每轮收益 ÷ 改动成本"排序。全部改动都在 `packages/agent` 与 `packages/runtime-node`，不动 provider 协议的部分可以独立落地。

### P0（前置，成本最低）轮级分相指标

照 `turn_timing.rs` 的形状实现：`samplingMs`、`compactionMs`、`toolBlockingMs`、`betweenSamplingMs`、`dispatchVsHandlerMs`、`promptCacheHitRatio`。

半天工作量，但必须排在其他优化**之前**：没有它，下面每条的收益都无法归因，也无法证伪第 5 节之外的推断。

### P1（必做）工具批次并发 + 默认独占语义

1. `packages/agent/src/engine/types.ts:100` 增 `readonly concurrency?: "parallel"`，缺省视为独占——直接对齐 codex 的默认 `false`。
2. `tool-executor.ts:31` 的循环改为"切段执行"：连续的 parallel 调用 `Promise.all`，遇到独占先汇合再单独 await；结果按 `index` 回填，事件按原序发。
3. 首批只标记内置纯读：`read`、`grep`、`glob`、`ls`、`dir_tree`、`find`。`bash`、`edit` 与 MCP 一律不动。
4. **MCP 是否按 `readOnlyHint` 放开，单独决策**：codex 放开（`handlers/mcp.rs:78-89`），而本仓 `plan-mode-tool-policy.ts:11-14` 已明确不信任该字段。这是安全假设变更，不是性能改动：先只做内置工具，MCP 留作独立提案，别在性能优化里顺手改信任边界。但它也是收益最大的一块——MCP 单次 0.5–3 s，比内置只读工具高一个量级。
5. **同时修正 steering 语义**：现在 `tool-executor.ts:37` 每个工具后查一次插话、发现即 `skipToolCall` 剩余全部。改为按段检查，一段结束再查；语义从"逐工具中断"变成"逐批中断"，需要在测试里固定下来。

收益：全仓检索型回合 −58～237 ms，窄目录回合 −15～32 ms（两次运行跨冷热缓存，见 5.1）。风险：并发写操作与有状态 MCP server 会争抢资源，靠"默认独占"挡住。

### P2（高）流式派发

前提已核实（见 3.2）：`toolcall_end` 在 `events.ts:226` 逐条发出，且终态不重写 toolCall。所以不需要改 `packages/ai`，改的是 `run-agent-turn` 的执行触发点——成本从“上台阶”降到一次中等改造。

真正要重新定义的是三件事，不是事件：

1. **中断策略**：工具已经跑完而流后续失败时，副作用已发生。必须把已执行结果写进 transcript，否则恢复路径会重跑。
2. **预算与计数**：`maxToolCalls`（`run-agent-turn.ts:191-198`）现在按整条消息统计，提前执行后要在每个工具落地时增量累加。
3. **steering 时机**：与 P1 的逐批检查共用一套语义，不能两处各写一份。

收益：0.1–0.5 s/轮（模型在工具调用之后还有叙述/推理时最大）。必须复用 P1 的按序回填，否则 toolResult 顺序变化会打断前缀缓存。

### P3（中）shell 环境快照

照抄 codex 的包裹方式（`runtimes/mod.rs:288-301`），不改命令语义，只换外层：

```sh
/bin/bash -c "if . '<snapshot>' >/dev/null 2>&1; then :; fi\nexport PATH='<runtime path>':\$PATH\nexec /bin/bash -c '<原命令>'"
```

快照在会话开始生成一次：用用户登录 shell 跑一次 `env`/`export -p`，把结果写成可 source 的文件；生成失败就跳过快照，一切照旧。

收益要说清楚，否则会抄错：**在 astravia 现在这条路上，它是“花钱买保真”，不是省钱**。现在 `bash -c` 31–35 ms 但 PATH 与用户终端不一致；改成 `source 快照 + exec` 实测 33.5–64.5 ms，每条多付 0–30 ms，换来 `node`/`python`/`pnpm` 指向用户实际用的那一份。那 −170～−285 ms 是 codex 相对它自己“每条都跑登录 shell”的基线算的，不适用于 astravia。

所以排序理由只有一条：环境保真对调试类任务的价值，而不是速度。若只想提速，不要做这个。

风险两条：source 失败不能阻断命令（包在 `if` 里并丢弃 stderr）；runtime PATH 必须在 source **之后**重贴，否则被快照覆盖。测试就固定这两件事。

### P4（低）连接复用 / `previous_response_id`

11–43 ms/轮。`store: false` 是当前有意的无状态选择，改成有状态要处理会话漂移与隐私语义，性价比最低。

### 不做

- **code_mode**：默认关闭，抄来等于自己造一个默认关的特性。
- **`apply_patch` 式补丁工具**：astravia 的 `edit` 已支持锚点批量，能力重叠；真正减少轮数的是"一次改多文件"，可另立项评估。
- **压缩链路**：`prefire.ts` 的后台预压缩 + 指纹校验，比 codex 的轮内阻塞压缩更好，别改。

---

## 5. 验证：三项实测（本机，可复跑）

脚本：[turn-cost-bench.mjs](</Users/zhugeyue/Desktop/project/bigdate/source-code/open-astravia/docs/analysis/bench/turn-cost-bench.mjs>)，`node docs/analysis/bench/turn-cost-bench.mjs`，5 轮取中位数。它验证的是上面每条建议的"值不值得做"，也是后续改造前后的对照基线。

### 5.1 本地只读工具并行，省多少？

同一个脚本跑了两次，数字差得不小，所以这里给区间而不是单值：

| 工作量 | 串行 | 并行 | 每轮省 |
| --- | --- | --- | --- |
| 4 次全仓 `rg` | 1050.8 → 534.7 ms | 813.6 → 476.4 ms | **237 → 58 ms** |
| 4 次窄路径 `rg`（`packages/agent/src`） | 49.0 → 28.7 ms | 17.0 → 14.1 ms | 32 → 15 ms |

差这么多的原因我无法直接证明，最可能是页缓存：第一次跑前半冷、第二次全热。但不论原因，结论的形状是稳定的：**全仓检索型回合并行值几十到两百毫秒，窄目录回合只值十几毫秒。** 收益取决于本轮的 IO 宽度，而不取决于工具数量——15 ms 的窄路径收益已经占了 29 ms 串行总量的一半，说明慢的不是工具本身。

### 5.2 shell 每条命令的固定成本

| 方式 | 耗时（两次运行 / 6 次进程采样） |
| --- | --- |
| `bash -c`（astravia 现用） | 31–35 ms（两次都稳） |
| `bash -lc` | 63–161 ms |
| `zsh -c` | 38–49 ms |
| `zsh -lc` | 38–200 ms（两次跑：37.9 / 184.4） |
| 模拟重 rc（+150 ms）登录 shell | 203–349 ms |
| 同环境改为 `source 快照` | 33.5–64.5 ms |

结论：**快照的价值完全取决于用户 rc 多重。** 重 rc 下省 170–285 ms/条，轻 rc 下基本持平。注意这个口径是 codex 内部的（它原本每条都跑登录 shell）；astravia 现在是 `bash -c`，本来就没跑 rc——见 P3。

### 5.3 每轮全量上传的真实成本（10 万 token）

| 指标 | 值 |
| --- | --- |
| JSON 体积 | 459 KB（1076 条消息，两次完全一致） |
| gzip 后 | 26.9 KB |
| 序列化耗时 | 3.4–8.2 ms |
| 上传耗时 @5 Mbps / 20 Mbps / 100 Mbps | 43 / 11 / 2 ms |

结论：**P4 这条最多值 50 ms/轮，且弱网才有感。** 优先级应排在并行与流式派发之后，此前把它列得偏高。

### 5.4 测量本身暴露的问题

上面两组数字的跳变（并行收益 4 倍、登录 shell 5 倍）不是脚本 bug，是**跨进程、跨运行测时间**的固有偏差：页缓存冷暖、dyld 预热、系统负载都会进来。这正好是 P0 埋点必须做在进程内的理由——轮级样本要在同一个进程里连续采，才能把“用户感知的变慢”与“机器在忙”分开。

### 5.5 没验证的

- 流式派发的真实收益：事件可行已核实（3.2），但省钱多少必须真实长回复回合才量得出来；
- 并发写入时的资源竞争（未构造写冲突场景）；
- 端到端任务时长（未跑 Agent 级基准，不声称"整体快 X%"）。

---

## 6. 证据台账

| 结论 | 证据 | 类型 |
| --- | --- | --- |
| 默认独占、按工具申请并行 | `tools/src/tool_executor.rs:64`（默认 false）、`core/src/tools/parallel.rs:143-146`、`handlers/shell/shell_command.rs:152`、`handlers/unified_exec/exec_command.rs:96` | 读码 |
| MCP 按 readOnlyHint 放开并行 | `handlers/mcp.rs:78-89`、测试 `mcp.rs:506, 517` | 读码 |
| 工具在单个 item 完成时即入队 | `core/src/session/turn.rs:2212, 2357, 2704`、`core/src/stream_events_utils.rs:297` | 读码 |
| 计时拆 dispatch / handler 与三相位 | `core/src/turn_timing.rs:59-68`、`core/src/tools/parallel.rs:314-345` | 读码 |
| shell 快照生成一次并包裹每条命令 | `core/src/shell_snapshot.rs:45, 153-166`、`core/src/tools/runtimes/mod.rs:231-301`（`-lc` 改写为 `. snapshot && exec <shell> -c`，且 source 后重贴 runtime PATH） | 读码 |
| code_mode 默认关闭 | `features/src/lib.rs:892-897` | 读码 |
| 产物为 0.145.0 / 自带 zsh + rg / 无 `.dep-v0` | `codex-package.json`、`file`、`zsh --version`、`rg --version`、REA `ev_1b8256…` | 实测 + REA |
| 六条机制都在 0.145.0 发布版里 | `nm -a`（55,922 条符号）：`runtimes::maybe_wrap_shell_lc_with_snapshot`、`session::turn::drain_in_flight`、`parallel::ToolCallTimingGuard::drop`、`shell_snapshot::ShellSnapshot::{new,try_create}`、3 个 `tool_executor::supports_parallel_tool_calls` | 实测 |
| 发布版无依赖清单可读 | 无 `__dep_v0` 段；`strings` 中 `dep-v0` 命中 0 次 | 实测 |
| 连接复用协议头存在 | `strings`：`x-codex-turn-state` ×9、`previous_response_id` ×10 | 实测 |
| 并行省 58～237 ms（全仓）/ 15～32 ms（窄路径） | `turn-cost-bench.mjs` 两次运行、每次 5 轮取中位数 | 实测 |
| `bash -c` 31–35 ms；重 rc 下快照 vs 登录 shell 省 170–285 ms（codex 口径） | 同上 + `node -e` 6 次采样 | 实测 |
| 10 万 token 上传 27 KB gzip、43 ms@5 Mbps | 同上 | 实测 |
| astravia 串行执行、无并发位 | `tool-executor.ts:31`、`types.ts:100-112` | 读码 |

### 已知局限

- 依赖清单确实不可得，但原因已查清：发布版未嵌入 cargo-auditable 元数据（无 `__dep_v0` 段），不是读取失败。
- 源码 HEAD（08-10）与 0.145.0 的漂移已用符号表核对过（见 2.1）：六条机制均在发布版中存在；未逐函数比对实现细节。
- REA 的 `open_binary` 在本客户端不可用（可选参数被投影为必填），因此没有取得反汇编级证据，符号与字符串是本轮的上限。
- 并行收益在本机 SSD 上测过冷热两端（58–237 ms）；换机器需重跑脚本。
- 5.1 数字跳变的原因（页缓存）是推测，未做隔离实验验证。
- 流式派发的收益未实测——事件层可行已核实（`toolcall_end` 逐条发出），但重叠窗口多长取决于模型在工具调用后还说多少话，未采样。
- 未运行任何端到端 Agent 基准，不声称"整体快 X%"。
