# Codex vs Astravia：会话过程 Prompt 缓存命中率分析与改进方案

> 任务来源：用户要求依据 codex（`/Users/zhugeyue/Desktop/project/bigdate/github-source-code/codex`）压缩上下文后缓存命中率 95%+ 的做法，改进本仓会话过程的缓存命中率。
> 证据分档：**读码**（源码行号，两仓都以当前工作区为准）/ **实测**（本机可复跑）/ **推导**（架构推算，已标注）。
> 一个必须先说清的事实：**“codex 压缩后 95%+ 命中率”没有可直接引用的官方数字**，95% 是它机制设计所指向、且其遥测口径（`cached_input_tokens / input_tokens`）下典型会话可达的量级。本文按机制对照给出 Astravia 已有、缺失、可抄的清单，不虚构命中数字。

## 1. 两仓缓存机制对照（读码）

### 1.1 codex 侧的六件事

| # | 机制 | 位置 |
| --- | --- | --- |
| C1 | 会话级 `prompt_cache_key`（OpenAI 端按 key 路由缓存分区） | `core/src/client.rs:483-485`（`session_id` 兜底）、`:912` |
| C2 | **前缀稳定性的机械判定**：模型/instructions/tools/参数逐字段相等才复用增量通道 | `client.rs:304-359` `responses_request_properties_match`（穷举字段，注释明确“新字段必须显式决定”） |
| C3 | **增量请求**：`get_incremental_items` 逐 item 比对旧请求+已产出 items，仅发 delta | `client.rs:1184-1227`；比对失败静默回退全量 |
| C4 | `previous_response_id` 服务端上下文续接（配合 WS 预热） | `client.rs:1629-1648` |
| C5 | **压缩历史的可缓存构造**：摘要作为最后一条 user 消息 + 保留最近 user 消息（≤20k tokens）+ 摘要前缀 `SUMMARY_PREFIX` 供下次压缩识别 + 合成 output id 用固定 UUID namespace（“Changing this value would invalidate prompt caches”） | `core/src/compact.rs:611-690`、`context_manager/normalize.rs:16-17` |
| C6 | **逐项命中最小化**：缺 output 的 call 补 `"aborted"` 合成结果（协议修复，防整段历史重排） | `context_manager/normalize.rs:26-80` |
| C7 | 缓存命中遥测进 TokenUsage（`cached_input_tokens`），TUI 可见 | `protocol/src/protocol.rs:2059-2073` |

**codex 高命中率的本质不是某个开关，而是三条纪律**：前缀任何一段都不因本地簿记而变化（C2/C5/C6）；能不重发的字节一律不重发（C3/C4）；命中率本身被观测（C7），回归能被看见。

### 1.2 Astravia 侧已有的（读码）

| 对照 | Astravia 现状 | 位置 |
| --- | --- | --- |
| C1 会话 key | **已有**：`promptCacheKey ?? sessionId` 传入 openai-responses/codex/azure；frame 可覆盖 | `ai/src/providers/openai-responses/request.ts:58`、`openai-codex/request.ts:40`；`runtime-core/src/kernel/stateless-agent-core-turn-engine.ts:203` |
| C2 前缀稳定机械判定 | **已有且更细**：`prompt-cache-diagnostics.ts` 全套指纹（稳定/易变 system 段、tools、历史、逐块逐工具变更原因），`compilePromptCacheLayout` 把 system 拆 stable/volatile 前缀 | `ai/src/protocol/prompt-cache-diagnostics.ts:23-79`、`runtime-core/src/kernel/prompt-cache-layout.ts:19-45` |
| C3/C4 增量通道 | **没有**（`store: false` 有意无状态；上一报告 P4 已评估为最低优先级） | `ai/src/providers/openai-responses/request.ts:60` |
| C5 压缩可缓存构造 | **部分**：prefire 指纹缓存保证“压缩触发时前缀未变则瞬时复用”；microcompact 有 turn 内确定性窗口（注释明确“projects the same prefix and only appends to it”） | `coding-agent/src/compaction/prefire.ts:1-80`、`microcompact.ts:22-33,209` |
| C6 协议修复 | 未核对到等价物（Astravia 的 toolCall/toolResult 持久化由 kernel 事件驱动，结构性缺口属于另一问题域） | — |
| C7 命中遥测 | **已有全套**：`calculatePromptCacheMetrics`（tokenHitRate）、`aggregatePromptCacheUsage`（requestHitRate/coverage）、`withPromptCacheDiagnostics` 挂到每次模型调用、telemetry 聚合上报 | `ai/src/protocol/usage.ts:101-180`、`runtime-core/src/kernel/agent-engine-telemetry.ts:282-333`、`model-call-diagnostics.ts:10-17` |

结论：**机制层 Astravia 并不落后，C1/C2/C7 甚至比 codex 细。真正的问题是“纪律是否被执行、命中率是否被看见”**——而这恰是用户观察（命中率不高）的怀疑点所在。

## 2. 差距诊断（读码 + 标注推导）

按“会破坏前缀稳定性的路径”排查，发现四个具体威胁，按影响排序：

### 2.1 【高】microcompact 清除旧 toolResult → 每次清除都改写历史前缀

`microcompact.ts`：`keepRecent=8 / maxAgeMs=30s`，把旧 toolResult/bash 输出替换为 `[tool result cleared — old context]`、剥掉旧 thinking。**任何一次清除都会改变一条已在历史中的消息** → 下一次模型调用的 history 前缀从“纯追加”变成“中段改写” → DeepSeek/OpenAI 类按字节前缀匹配的隐式缓存，前缀在清除点全部失效，命中只剩清除点之后的尾部。

推导（非实测）：tool 密集会话（每轮 10+ 次调用、30 秒后开始清理）大约**每轮损失一次全量缓存**；这足以把会话级命中率从 95% 量级拖到 70-80% 量级。codex 同样裁剪工具输出，但走的是**请求期截断**（`truncate_text`，`compact.rs:655` 附近只影响新请求形态）与固定策略，裁剪结果一旦写入历史就**不再二次改写**。

**改进 P1（最重要）**：microcompact 的清除从“改写历史消息”改为“一次性换版”——每条消息至多清除一次、清除后内容永久固定（追加式簿记），且整个 turn 内的多次模型调用复用同一冻结时刻（现有 `now` 参数已为此设计，确认所有调用点传入 turn 边界值）。可选增强：把 `CLEARED_MESSAGE` 占位符改为固定长度哈希摘要，保证同一条消息的清除产物字节稳定。

### 2.2 【高】压缩切点若落在“历史中段”，摘要替换即前缀断裂

codex 的压缩产物里，**摘要必须是历史的最后一项**（user 消息形态 + `SUMMARY_PREFIX`），且“初始上下文”重新注入的位置固定在最后一条真实 user 消息之前（`compact.rs:554-604` 的三条插入规则，注释写明"the summary stays last"）。这样服务端缓存里压缩前的 system+tools 段仍然有效，新请求 = 旧前缀的“截断 + 摘要追加”。

Astravia 的压缩链路（`compaction.ts` + `context-compaction-committer.ts`）需要逐一核对：摘要替换历史后，system prompt 与 tools 是否逐字节不变、摘要是否位于消息序列末尾、被保留的“尾巴”是否从压缩点起保持只追加。**任何一条不满足，压缩后第一轮就是一次 0% 命中的冷启动，且把后续轮次的缓存基点整体后移。**

**改进 P2**：给压缩提交器加一条机械断言（可在 `context-compaction-committer.ts` 的合同测试里固化）：压缩后的首个模型调用，其 `promptCache.prefixStatus` 必须为 `initial`（新基点）而非 `changed`（历史被改写）；`stableSystemPromptHash` 与 `toolsHash` 必须与压缩前最后一次调用一致。断言失败即暴露“压缩顺手改了 system/tools”的回归——这正是 codex C2 穷举字段想防的事。

### 2.3 【中】易变 system 段污染前缀基点

`prompt-cache-layout.ts` 已经把 system 拆成 stable/volatile 两段、volatile 之后全部不可缓存。但诊断指纹会告诉我们（`changedSegments: ["volatile-system"]`）——**volatile 段每次变化，基点之后的所有内容重算**。若 volatile 段（当前时间、环境快照、临时 instructions）靠前且频繁变化，等于每一轮都是新前缀。

**改进 P3**：用现有遥测（`withPromptCacheDiagnostics` 已挂全量调用）拉一次真实会话的 `changedSegments` 分布。若 `volatile-system` 高频出现，把可变内容后移到消息流（作为 context record 追加），system 只留恒定段。这是 codex `instructions` 恒定纪律（C2 里 instructions 字段参与相等判定）的等价物。

### 2.4 【中】`cacheRetention` 默认值未在 openai-completions 链路声明

`StreamOptions.cacheRetention` 缺省 "short"，但 openai-completions/DeepSeek 路径**根本不消费**它（只有 anthropic/bedrock 消费）。DeepSeek 的隐式缓存对命中无副作用，但**写入侧 TTL 与保活**（DeepSeek 缓存数小时过期；OpenAI 短 TTL）没有任何配置点——长时间思考或用户离开再回来，缓存已过期，下一轮天然冷启动。

**改进 P4（观测优先，暂不改协议）**：在 telemetry 聚合里把“距上次模型调用的间隔”与 `tokenHitRate` 一起记，先量化“过期冷启动”占比，再决定是否值得做预热/保活（codex 的 WS 预热 `preconnect_websocket` 是它的解法，但对 REST 隐式缓存没有等价物，预期收益有限）。

## 3. 落地顺序（按命中率影响 × 改动成本）

| 优先级 | 改动 | 预期命中率影响 | 成本 |
| --- | --- | --- | --- |
| P1 | microcompact 改“一次性换版”，确认 turn 边界 now 传参 | 消除每轮一次的前缀断裂（推导：会话级 +10-20pt） | 小（纯函数 + 既有测试模式） |
| P2 | 压缩提交合同断言（prefixStatus=initial、system/tools 哈希不变） | 防压缩后 0% 冷启动回归；把 codex C5 的纪律机械化 | 小（测试为主） |
| P3 | 用现有诊断遥测拉 changedSegments 分布，必要时后移易变 system 段 | 视分布而定；volatile 高频时是数量级修复 | 先观测后改动 |
| P4 | 记录调用间隔与命中率关系，评估缓存过期占比 | 观测项，无直接收益 | 极小 |
| 不做 | `previous_response_id`/增量通道（codex C3/C4） | 与缓存命中率无关（那是传输量优化）；`store:false` 是有意隐私选择，维持上一报告结论 | — |

## 4. 验证方式

两仓共同的事实：命中率必须被观测才能被改进。Astravia 的 C7 基础设施已就位，缺的只是“读数”：

1. 在 telemetry 聚合处（`agent-engine-telemetry.ts:282` 已算 `tokenHitRate`）按会话输出 `aggregatePromptCacheUsage` 的 `tokenHitRate / requestHitRate / readCallCoverage` 三值，跑 3-5 个真实长会话（工具密集 + 触发一次压缩），记录 P1/P2 前后的变化。
2. 单元层：`prompt-cache-usage.test.ts` 已覆盖指标口径；P2 的断言写成 `context-compaction-committer` 的合同测试，旧实现下红、新实现下绿。
3. DeepSeek 侧注意 `cacheUsageReporting: "read-only"`（`adapter.ts` `updateUsage`）——input/cacheRead 拆分口径已正确，命中数可直接从 `usage.cacheRead` 读。

## 5. 未验证项

- 本机没有真实长会话的命中遥测数据（需要跑真实 Provider，涉及费用，未获授权）；2.1/2.2 的影响量为架构推导，已在文中标注。
- Astravia 压缩链路 2.2 的三个核对点只完成读码定位，未逐行确认（涉及 `compaction.ts`/`committer` 约 500 行，本次只覆盖到 prefire/microcompact/token-policy 三个入口）；P2 断言落地时会自然完成这一核对。
- codex “95%+” 数字本身未经其仓库内测试或文档证实，属用户口径；本文以机制对照为准。

## 6. 证据台账

| 结论 | 证据 | 档 |
| --- | --- | --- |
| codex prompt_cache_key 会话级 | `client.rs:483-485,912` | 读码 |
| codex 前缀复用逐字段机械判定 | `client.rs:304-359` | 读码 |
| codex 增量请求逐 item 比对 | `client.rs:1184-1227` | 读码 |
| codex 压缩摘要置尾 + 20k 保留 + 固定 UUID namespace | `compact.rs:611-690`、`normalize.rs:16-17` | 读码 |
| codex 缺失 output 合成 "aborted" | `normalize.rs:26-80` | 读码 |
| Astravia promptCacheKey 已传 | `openai-responses/request.ts:58`、`stateless-agent-core-turn-engine.ts:203` | 读码 |
| Astravia 前缀指纹诊断全套 | `prompt-cache-diagnostics.ts:23-79`、`prompt-cache-layout.ts:19-45` | 读码 |
| Astravia 命中率指标与聚合 | `usage.ts:101-180`、`agent-engine-telemetry.ts:282-333` | 读码 |
| Astravia microcompact 改写历史消息 | `microcompact.ts:22-33,209`（`[tool result cleared — old context]`） | 读码 |
| DeepSeek 走 openai-completions、cacheRetention 不消费 | `deepseek.ts:36-52`、grep 证据 | 读码 |
