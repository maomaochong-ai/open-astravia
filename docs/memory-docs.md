# Claw 记忆系统：实现路径、运作方式与设计取舍

> 适用范围：im-gateway 驱动的 Claw 会话（`~/.vetta/im-gateway/conversation/`）。
> 决策依据：[ADR-0009](adr/0009-im-gateway-memory-rollover-and-dated-worklog.md)。术语见 [CONTEXT.md](../CONTEXT.md)。
> 门控：coding-agent 的 `--memory-mode`，默认**关**，且**仅在 `--mode rpc` 下生效**。只有 im-gateway 为 Claw 会话传这个 flag（`host.go: MemoryMode=true`，全仓唯一启用点）；desktop / TUI / CLI 既无 plumbing 传它、即便误传在非 rpc 模式也被忽略，行为完全不变。`memory` 工具更是只在「rpc 模式 + memoryMode + memoryFile」三重门控下注册，从不进入任何默认工具集——所以其他项目**压根不会**看到记忆工具或任何记忆行为。

---

## 1. 要解决的问题

IM 用户大量时间在飞书/微信聊天，但 Claw 的会话之间过去**没有任何关联与记忆**：

- 换聊天窗或 `/new` 就从零开始，agent 不记得你是谁、在做什么。
- 单条 session 聊久了无限增长，逼近 coding-agent 的压缩阈值后**每一轮都再次触发压缩**——又慢又持续掉信息。
- 产物（html/py/md）全堆在共享 cwd 根，纯 IM 端无 UI 无从管理。

目标：做出 OpenClaw / Hermes 那种「看上去一直在同一个会话」的连续体验。参考 Hermes 的实现提炼出三根支柱——**记忆文件冻结快照常驻**、**压缩前 flush 抢救**、**深度召回**——并叠加一个 **im-gateway 专属的 session rollover** 来给单文件大小封顶。

---

## 2. 三层记忆架构

| 层 | 形态 | 何时进上下文 | 代码 |
|---|---|---|---|
| **L1 常驻记忆** `MEMORY.md` | 单文件、策展式 Markdown 条目 | 每次 Session Runtime 创建时作为**冻结快照**注入 system prompt | `src/memory/memory-store.ts` |
| **L2 会话本体** conversation jsonl | 当前对话的完整轨迹，rollover 时续接到新文件 | 全程在上下文（受 rollover 控制大小） | `runtime-storage/src/conversation/file-conversation-repository.ts` |
| **L3 日期工作史** `JOURNAL.md` + 日期目录 | 按需——agent 自助翻阅 | 不常驻，agent 用 Read/ls 拉取 | `src/memory/file-memory-journal.ts` |

> L1 解决「跨会话记得」；L2 + rollover 解决「聊爆频繁压缩 + 连续感」；L3 解决「昨天干了什么 / 产物在哪」。

物理布局（`~/.vetta/im-gateway/conversation/` 为会话根，下称 `<root>`）：

```
<root>/
├── MEMORY.md                      # L1 常驻记忆（稳定路径，与运行 cwd 解耦）
├── .vetta/sessions/               # L2 所有会话 jsonl（SessionDir，钉死在根）
│   ├── 2026-05-29T..._<id1>.jsonl     # 旧会话（rollover 后归档）
│   └── 2026-05-29T..._<id2>.jsonl     # 新会话（parentSession 指回 id1）
├── 2026-05-29/                    # L3 今日日期目录（= agent 运行 cwd）
│   ├── JOURNAL.md                     # 当日工作史
│   ├── <msgId>-photo.jpg              # 入站媒体（inbox）
│   └── chart.html                     # agent 产物
└── 2026-05-28/                    # 昨日目录（agent 读 ../2026-05-28/ 回溯）
    └── JOURNAL.md
```

**关键不变量**：MEMORY.md 与 SessionDir 都钉死在 `<root>`（稳定）；agent 的**运行 cwd 是日期子目录**（按天变）。三者解耦——运行 cwd 按天滚动不影响记忆与会话文件的定位。

---

## 3. 端到端运作流程

下面是一条 IM 消息从进来到回复的完整链路，标注每一层在何处介入。

### 3.1 启动一次 agent（每条消息一次，因 `closeOnIdle`）

im-gateway 收到消息 → `router.forwardToAgent`：

1. `agentCwd()` 计算今日日期目录 `<root>/<YYYY-MM-DD>/`，`MkdirAll` 创建（`internal/router/router.go`）。
2. `pool.Acquire(cwd=日期目录, sessionPath=该 chat 上次的 jsonl)`。`closeOnIdle` 下每条消息 spawn 新进程。
3. `local/client.OpenSession` 拼 argv：`--mode rpc --cwd <日期目录> --session <path> --session-dir <root>/.vetta/sessions --enable-host-bridge --memory-mode --memory-file <root>/MEMORY.md`（`internal/hostclient/local/client.go`）。`cmd.Dir = 日期目录`（OS 级 cwd）。

### 3.2 注入 MEMORY.md（L1，冻结快照）

coding-agent 创建 memory-mode Session Runtime 时：

1. `CodingAgentMemoryRolloverOrchestrator` 创建 `FileMemoryStore`，只读取一次 MEMORY.md 并保存冻结快照（`src/memory/memory-rollover-runtime.ts`）。**整个 Session Runtime 生命周期内不再重读该提示词快照**。
2. Prompt Runtime 通过 `renderMemoryForPrompt(path, snapshot, limit)` 把记忆作为独立的 `# Persistent Memory` 段注入模型调用（`src/model-context/memory-prompt.ts`、`src/adapters/runtime-core/greenfield-prompt-runtime.ts`）。
3. Composition Root 只在 memory-mode 下组合 `runtime-tools` 提供的原生 `memory` Tool registration（`src/composition/greenfield-session-peripheral-assembly.ts`、`runtime-tools/src/coding/tools/memory/`）。

> **冻结快照纪律**：agent 这一轮通过 `memory` 工具写入会立刻落盘、并由工具返回值看到更新，但 **system prompt 里的快照不变**。因为 im-gateway `closeOnIdle` 每条消息重启进程，「下次加载」≈ 下一条 IM 消息——记忆跨消息近实时生效，同时不破 Anthropic 前缀缓存（中途改写 system prompt 会令缓存失效，吃掉约 75% token 节省）。

### 3.3 一轮对话 + JOURNAL 行（L3）

Turn 完成后，Memory Runtime 通过独立 `TurnObserver` 取得该 Turn 最后的 assistant message，并调用 `FileMemoryJournal.appendTurn`：向运行 cwd（=今日目录）的 `JOURNAL.md` 追加一行「`- HH:MM <截断的回复> — files: <write/edit 触及的文件>`」。cancelled/failed/aborted/error 轮不落有效日志。

### 3.4 触发 rollover（L2，取代 Layer2 压缩）

`CodingAgentGreenfieldContextRuntime` 在自动压缩决策前调用 Memory Runtime 的压缩策略，把 memory-mode 阈值收紧到约 70%（`minFreePercent→30` 且 `reserveTokens` 提到窗口 30%）。超阈值后进入 Runtime Core 的压缩与 conversation continuation 管道：

1. **Layer1 microcompact** 照常（免费裁旧工具输出）。
2. **flush（L1 抢救）**：`MemoryFlushService` 用 `preparation.messagesToSummarize`（即将被丢弃的上下文），经 `AiMemoryFactExtractor` 做一次 `completeSimple` LLM 调用，抽取「持久事实」逐条 `add` 进 MEMORY.md（带去重 + 字符预算，best-effort，失败不阻塞）。**只写磁盘，不动快照**（`src/memory/{memory-flush-service,ai-memory-fact-extractor}.ts`）。
3. **生成摘要**：复用现有 `compact()` 得到 `summary` + `firstKeptEntryId` + 保留尾巴（`keepRecentTokens` 默认 ~20k）。
4. **appendRollover(cwd, summary)**：把摘要追加进今日 `JOURNAL.md`。
5. **Conversation continuation**（`runtime-core/src/kernel/turn-pipeline.ts` + `runtime-storage/src/conversation/file-conversation-repository.ts`）：
   - 以 compaction record 和保留尾巴创建一个新的 conversation 文件。
   - 新文件的 `parentSessionPath` 指回旧文件；旧文件原样归档，不再追加。
   - Runtime Core 在新 conversation 上继续同一 Turn，模型上下文仍为「摘要 + 保留尾巴」。
6. **发事件**：宿主把 continuation 的路径变化投影为 `session_path_changed`，reason 为 `memory-rollover`。

> **为何 rollover 而非照搬 Hermes 原地压缩**：Hermes 是长驻进程；im-gateway `closeOnIdle` **每条消息全量解析整条 jsonl**，而原地压缩只追加 entry、不截断文件 → jsonl 无限增长 → 每条消息冷启动解析成本随时间上涨。rollover 给单文件大小封顶。这是 im-gateway 专属、Hermes 不付的成本。

### 3.5 路径回传（让下一条消息续接）

`session_path_changed` 是 AgentSession 事件，经 `session.subscribe → output` 自动写到 stdout（`src/modes/rpc/rpc-mode.ts`）。im-gateway 侧：

1. `bridge` 的 `handle` / `handleDeferred` 都有 `case session_path_changed`，调 `handleSessionPathChanged` 解析 `to` → 触发 `pathChange` 回调（`internal/bridge/bridge.go`）。
2. `router.forwardToAgent` 用 `br.SetPathChangeHandler` 注册回调：`r.state.SetSession(user, chat, newPath)`（`internal/router/router.go`）。
3. `MemoryStore.SetSession` 的 patch hook 同时发 `state_patch` 给 desktop，让桌面端的映射也更新。

于是下一条消息 `pool.Acquire(日期目录, newPath)` → `--session newPath` → 续接滚动后的会话，而非归档的旧文件。

### 3.6 渐进披露召回（L3）

用户问「昨天干了什么」→ agent 在今日运行 cwd 下，用 Read/ls 翻 `../<昨天>/JOURNAL.md` 与产物文件。产物即记忆的一部分。这一层**不常驻上下文**，按需拉取，故不膨胀 system prompt。

### 3.7 `/new` 显式凝结（关闭「短会话丢记忆」缺口）

自动 flush 只在 **rollover**（上下文逼近阈值）时触发。但用户在飞书/微信里 `/new` 可能发生在**远未到阈值**时——这样一个短会话若被直接丢弃，它的持久事实就没机会凝结。为此 `/new` 增加了一次显式 flush：

1. im-gateway 的 `newCmd`（`internal/command/router.go`）在清空路由前调 `flushSessionMemory`：查到该 chat 当前 sessionPath → `HostPool.Acquire` 起一个一次性进程 → 发 `flush_memory` RPC（60s 超时，best-effort）→ 释放。
2. coding-agent 的 RPC dispatcher 收到 `flush_memory`（`src/modes/rpc/rpc-command-dispatcher.ts`）→ 调用 Session capability host → `CodingAgentGreenfieldMemoryController.flushMemory()`：对**当前完整上下文**跑一次 flush 抽取，写进 MEMORY.md，返回写入条数。非 memory-mode 返回 0（no-op）。
3. 凝结成功（`written>0`）时，`/new` 回复附「已凝结 N 条记忆到长期记忆」。

> 与 rollover flush 的区别：rollover flush 针对**即将被丢弃的那段**（`messagesToSummarize`），`/new` flush 针对**当前整段上下文**（rollover 已凝结过的更早内容由 flush 内的去重 + 字符预算自然挡掉）。`flush_memory` 是无副作用的可重入操作。

---

## 4. `memory` 工具语义

```
memory(action, content?, match?)
  add     : 追加一条 content
  replace : 找到首条 include(match) 的条目，替换为 content
  remove  : 删除首条 include(match) 的条目
```

- 条目以 `\n\n§\n\n` 分隔（`src/memory/memory-document.ts`），人读友好且不与正文冲突。
- 字符预算默认 ~4000；超限的写入会**报错**，要求 agent 先 `remove`/精简——强制策展，防止无限膨胀。
- 原子写（temp + rename）。
- 工具描述（`runtime-tools/src/coding/tools/memory/description.ts`）明确告诉 agent：何时存（持久事实，非琐碎）、写入下个 session 生效、有预算。

`memory` 工具与 **flush** 互补：工具是 agent 主动随时写；flush 是 rollover 前的**保证写入点**，避免 MEMORY.md 长期为空。

---

## 5. 关键代码索引

| 关注点 | 位置 |
|---|---|
| 记忆文件读/写 | `coding-agent/src/memory/memory-store.ts` |
| 记忆条目代数与字符预算 | `coding-agent/src/memory/memory-document.ts` |
| flush 领域服务 / LLM 持久事实抽取 | `coding-agent/src/memory/memory-flush-service.ts`、`ai-memory-fact-extractor.ts` |
| JOURNAL 行/段 | `coding-agent/src/memory/file-memory-journal.ts` |
| `memory` 工具 | `runtime-tools/src/coding/tools/memory/` |
| 快照、flush+journal 接线与 70% 策略 | `coding-agent/src/memory/memory-rollover-runtime.ts` |
| system prompt 的 `memory` 段 | `coding-agent/src/model-context/memory-prompt.ts` |
| rollover continuation | `runtime-core/src/kernel/turn-pipeline.ts`、`runtime-storage/src/conversation/file-conversation-repository.ts` |
| `--memory-mode` / `--memory-file` 解析 | `coding-agent/src/cli/args.ts`、贯通 `sdk.ts` / `main.ts` |
| `/new` 显式凝结：`flush_memory` RPC + `flushMemory()` | `coding-agent/src/modes/rpc/rpc-command-dispatcher.ts`、`adapters/runtime-core/greenfield-memory-controller.ts`；`im-gateway/internal/command/router.go: flushSessionMemory` |
| `session_path_changed` 事件投影 | `cli-app/src/rpc/greenfield-im-rpc-events.ts` |
| spawn 参数透传 | `im-gateway/internal/hostclient/local/client.go`（`MemoryMode`/`MemoryFile`） |
| host 恒开 + 日期 cwd | `im-gateway/cmd/im-gateway/host.go`（`MemoryMode=true`、`SetDatedCwd(true)`） |
| 日期 cwd / 路径回传 | `im-gateway/internal/router/router.go`（`agentCwd`、`SetPathChangeHandler`） |
| 事件捕获 | `im-gateway/internal/bridge/bridge.go`（`handleSessionPathChanged`）、`internal/hostclient/types.go`（`AgentEventTypeSessionPathChanged`） |

---

## 6. 设计取舍速记

- **冻结快照 > 实时性**：保 prompt 缓存；靠 `closeOnIdle` 把「下个 session」缩短到「下条消息」补偿。
- **门控而非全局默认**：用户范围只针对 Claw，且 rollover 会改 desktop/TUI 现有压缩行为；显式 flag 而非 cwd 探测，不引入「按目录猜行为」的魔法。与 `--enable-host-bridge` 正交。
- **项目级单一记忆**：Claw 是单 owner 客户端，不分 user/project、不考虑多租户，合并掉 Hermes 的 `USER.md`。
- **按日期而非 per-session 隔离产物**：IM 用户心智是「昨天/今天干了什么」，日期是更自然的回溯轴，且与 inbox 日期目录同构。
- **flush 用独立 LLM 调用而非重入 agent loop**：避免与压缩/agent 循环纠缠；代价是 rollover 时多一次（不频繁的）LLM 调用。

---

## 7. 边界与未做项

- **session_search（深度跨 jsonl 回溯）延后二期**：`parentSession` 指针已就位，二期可顺链或建 FTS5 索引检索历史，无需回改一期结构。
- **产物的 IM 端回取/重发**（在飞书里列出/搜出/重发上次文件）**未做**：当前只做到「按日期组织 + JOURNAL/摘要登记路径 + agent 自助翻阅」。
- **flush/JOURNAL/rollover 均 best-effort**：失败只记不抛，绝不阻塞用户当轮对话。
- **尚未端到端实跑**：已通过 `bun run check`（biome+tsgo）、`go build`/`go vet`、相关 Go 单测；rollover/flush 的真实行为建议在 dev 环境用真实长会话压测验证。
