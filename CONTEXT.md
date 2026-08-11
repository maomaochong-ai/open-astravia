# Context

This is a living glossary. Each term is a deliberately-chosen canonical name for a concept in the system. When you find yourself reaching for a vague word ("info", "data", "meta"), check here first.

## Glossary

### 官方网站（site）

Vetta 面向未登录访客的多页公开门户，首期只承载产品介绍、站点演示、客户端下载、套餐展示和登录入口；内容为门户自有展示内容，不对接后台套餐、支付、身份或发布数据。首期不承载账号中心、真实支付购买、真实安装包下载或客户端 SSO 授权完成态。
_Avoid_: 把首期官方网站称为「用户前台系统」或「完整商业门户」——这会误导为已包含账号、支付、订阅管理全链路。

### Google 登录

用户用 Google 账号完成第三方登录的身份入口；首期官方网站只展示入口占位，不完成 OAuth 流程。
_Avoid_: 叫「Gmail 登录」——Gmail 是邮箱服务，不是身份提供方。

### ToolTimingEntry

A `SessionEntry` (parallel to `thinking_level_change` / `model_change`, not a `message`) written to a session's jsonl by `agent-session` at `tool_execution_end`. Carries `toolCallId`, `startedAt` (absolute ms), `durationMs`, and `phases` (relative offsets, see `phase`).

ToolTimingEntry exists in a separate channel from `Message` deliberately so that LLM providers — which only consume `message` entries — never see it. This is a hard architectural boundary, not a filter to be maintained.

### phase

A user-defined interval inside a tool's `execute`. Tools call `ctx.phase(label)` to mark "from this moment on, I'm doing `label`"; the next call (or `tool_execution_end`) implicitly ends the previous interval. Persisted as `phases: [{ label, atMs }]` where `atMs` is the offset from `startedAt` in ms. Duration of each interval is computed at read time by diffing consecutive `atMs` (last interval uses `durationMs`).

### conspicuous duration

The user-facing threshold above which a tool call shows a duration badge on the `ToolCallBlock` header. Default 1000 ms. Below the threshold, the badge is hidden but the meta panel still has the data when expanded.

Threshold is a UI display rule, never a write-time filter. Every `tool_execution_end` produces a `ToolTimingEntry` regardless of duration.

### meta panel (of a tool_call block)

The region revealed when a user expands a `tool_call` block. First row is a labelled meta zone showing `startedAt` (absolute time), full-precision `durationMs`, and `phases` as a centred-dot string ("download 2.1s · ocr 12.3s · write 0.8s"). This row is explicitly out-of-band — never sent to the LLM.

### ctx (in a tool's `execute` signature)

The fourth positional argument introduced for timing support: `execute(toolCallId, input, signal, ctx)`. Currently exposes `ctx.phase(label)`. Older tools that don't accept `ctx` continue to work — their timing data is just `[startedAt, durationMs]` with empty `phases`.

### mentionedFile

A user-attached file or directory reference carried alongside a chat prompt. Shape: `{ path: string; name: string; isDirectory: boolean }`. `path` is always an **absolute filesystem path** and is **not constrained to the session's cwd** — it may originate from an `@`-mention inside cwd, an internal File Explorer drag, or an external OS drag-drop. Rendered in `InputBar` as a `Capsule` with a native `title` tooltip exposing the full path. Consumed in `sendPrompt` by being prepended to the user message as `@${path}` lines (one per entry) — the agent then decides whether to read each path via its own tools.

`mentionedFile` is distinct from `attachedImage`: dropping an `image/*` MIME file still routes to `attachedImage` (DataURL multimodal attachment), not to `mentionedFile`. The two channels coexist in `InputBar` capsules but serialize differently at send time.

### 结论 (assistant turn conclusion)

一轮 assistant 回答「已经有结论」的判定：本轮 streaming 已结束，即 `!(isLastAssistant && isStreaming)`。与 [[AssistantFoldTip]] 的 `state: "complete"` 同源，不引入新状态。

定义刻意**不**要求 `foldData.outputBlocks` 非空 —— 纯工具调用收尾（agent 调完工具就 stop、没有 final text）的轮次同样算「有结论」，仍允许用户对该轮内容触发操作（如复制工具输出摘要）。复制按钮在 streaming 期间隐藏，是为了避免用户复制到半句话；轮次结束后内容已稳定，即便没有 final text 也已稳定。

历史 assistant 消息天然满足该判定，不需要额外的 per-message "done" 标志。

### MessageActions

挂在每条 chat message（user / assistant）底部的一排 icon-only 操作按钮，hover 出 tooltip。当前只有「复制」一个按钮，设计为可扩展（后续可能加 regenerate / 评分 / 分享 等）。

与 `ActionButtonBar`（全局粘性条，受 `visibleActionButtonsAtom` 驱动，主色实心 pill）是**完全不同的概念** —— 不要混用 "ActionBar" 命名。前者是"消息附属工具"（灰、轻量），后者是"召唤主动操作"（主色、显眼）。

显示策略：
- User message：hover 整行才显示，绝对定位浮在 bubble 下方不占布局。复制源 = `displayText`（`parseUserPrefixes` 之后的 body，剥掉 `/skill:` 和 `@file` 行）。
- Assistant message：本轮[[结论]]已出现后常驻显示。复制源 = `foldData.outputBlocks` 拼接出的结论文本。

按钮不存在的情形（整条 bar 不渲染）：`role === "compaction"`、user 仅图片或完全空、assistant 仅含 error block、assistant 纯工具轮（outputBlocks 为空）。这是"按钮无可复制内容"的自然 fall-out，不是 hasConclusion 判定的例外。

### conversation cwd

`~/.vetta/conversation`，desktop-app 中虚拟注入的「对话」项目的**项目根 cwd**（常量 `DEFAULT_CONVERSATION_CWD`，`packages/desktop-app/src/main/ipc/fs.ts`）。session jsonl 文件集中落在 `<conversation cwd>/.vetta/sessions/`。

**项目根 cwd ≠ session 运行 cwd。** ADR-0007 起，「对话」下新建的每个 session 拿到自己的 [[session 产物子目录]] (`<conversation cwd>/<sessionId>/`) 作为运行 cwd，agent 产物落在那里，避免不同 session 在根目录互相窜味。读 session.cwd 而不是项目 cwd 才能拿到 agent 当时的真实工作目录。fs IPC 沙箱边界仍是项目根整体，不按 session 收紧——隔离的是状态不是权限。

**仅指 desktop 侧。** im-gateway 自 ADR-0005 起改用独立 cwd（见 [[im-gateway cwd]]），不再共用本目录。文档/代码里出现「conversation cwd」时默认指 desktop 这一份。

### session 产物子目录

「对话」项目下每个**新建** session 在 main 进程 eager `mkdir` 出来的独立工作目录：`~/.vetta/conversation/<sessionId>/`。session 的运行 cwd 指向这里，agent 工具默认写入 `./` 时落入本目录，自然按 session 隔离。

命名刻意用不可变 `sessionId` 而非 session title slug——session 可重命名而产物内的相对引用不可控，stability 优先。Finder 不可读由 UI"在 Finder 中打开本 session 产物目录"入口补偿。

ADR-0007 之前创建的老 session 不迁移，cwd 保留为 [[conversation cwd]] 根；其根目录残留产物在「对话」项目详情页 Files 面板与新的 `<sessionId>/` 子目录共存展示。删除 session 时一并递归删除其子目录。

**仅作用于「对话」默认项目。** 用户手动创建的项目（cwd 由用户选）不走 per-session 拆分——共享 cwd 是用户创建该项目时的初衷。

### im-gateway cwd

`~/.vetta/im-gateway/conversation/`，im-gateway 所有 IM 渠道（wechat / feishu / ilink ...）共用的工作目录。session 文件落在 `<im-gateway cwd>/.vetta/sessions/`，agent 生成的产物（html/py/md 等）落在 cwd 根。路由 key 仍是 `(im_user, chatID)`（继承自 ADR-0004），单一 cwd 内靠 sessions 文件名区分不同 IM 会话。

与 [[conversation cwd]] 物理分离：桌面「对话」与 IM 入口的 session / 产物互不可见，desktop sidebar 不再展示 IM session（ADR-0005 推翻了 ADR-0004 的混合展示形态）。

### im-gateway inbox

`~/.vetta/im-gateway/conversation/<YYYY-MM-DD>/`，im-gateway 把 IM 入站的图片/文件**原样字节**落盘到此（按本地日期分目录），文件名形如 `<msgId>-<原文件名或 ext>`。落盘后由 router（`router.go`，不是 bridge）在 prompt 文本头部为每个 `Attachment.URL` prepend 一行 `@<abspath>`，agent 通过 Read 工具自行读取（图片走 `resizeImageBuffer` 自动缩放）。落盘 + `Attachment` 填充是**各 transport 自己的职责**；router 的 `@<abspath>` 拼接是平台无关的，任何 transport 只要填好 `Attachment.URL` 就自动接入。

「原样字节」的获取方式按平台而异：wechat 需先 CDN 下载再 AES-128-ECB 解密（见 ADR-0006）；feishu 走鉴权后的 `Im.MessageResource.Get`（image_key/file_key + Type），SDK 直接回放明文流，**无解密步骤**。

**刻意不走 RPC `images[]`**：避免 im-gateway 重复造缩放轮子，复用 Read 既有图像处理，且把"是否要看图"的决策权留给 agent。与 desktop 的 `attachedImage` 多模态直投是不同路径——两者刻意不统一，IM 端走 [[mentionedFile]] 单轨。

### im_send_attachment

coding-agent 内置工具（`packages/coding-agent/src/core/tools/...`），仅在 `--mode rpc --enable-host-bridge` 启动时注册，对 TUI / CLI / desktop 启动的 agent 不可见。签名：`im_send_attachment({path: string, kind: "image"|"file", caption?: string})`。

实现通过 [[host_request / host_response]] 同步等待宿主（im-gateway）真实发送结果（30s 超时）；成功返回 `messageId`，失败返回结构化 error（如 `quota_exhausted` / `peer_unreachable`）。Agent 拿到真实结果再决定收尾文本怎么说，避免"声称已发送实际没发"。

每次成功调用占用 1 次 wechat per-peer quota，与最终 digest 文本独立计数。

### host_request / host_response

agent ↔ host 之间的反向 RPC 通道，扩自 coding-agent 的 RPC 协议（`packages/coding-agent/docs/rpc.md`、`src/modes/rpc/rpc-types.ts`）。形状：

- agent → host（stdout event line）：`{"type":"host_request","id":"hr-N","method":"send_attachment","params":{...}}`
- host → agent（stdin command line）：`{"type":"host_response","id":"hr-N","success":bool,"data":{...},"error":""}`

`method` 字段预留扩展（未来可能有 `send_typing` / `query_peer` 等）。`id` 由 agent 侧生成，host 必须原样回填。无应答时 agent 工具侧 30s 超时。

与 RPC 现有的 `command/response` 是镜像方向：现有是 host→agent（驱动），新增是 agent→host（回调）。共用 stdin/stdout，靠 `type` 字段区分。

### drop overlay (of ChatPage)

A full-`ChatPage` overlay rendered while an OS-level drag carrying `Files` (or an internal drag carrying the `application/vetta-path` MIME) is hovering. Provides the visual affordance "release to reference"; on drop, each dragged item becomes a `mentionedFile` (or an `attachedImage` for image MIME). Triggers regardless of whether a session is currently active — items dropped on `NewSessionPage` stay in `mentionedFilesAtom` and are picked up by the next `sendPrompt`. Internal drags from File Explorer are detected via the `application/vetta-path` MIME and bypass `webUtils.getPathForFile`, reading the path directly from the dataTransfer payload.

### memory-mode

coding-agent 的一个**门控开关**（拟 `--memory-mode` 启动参数，默认关）。开启后激活下面整套「记忆 + 滚动」机制：[[MEMORY.md]] 注入、[[memory 工具]]、[[memory flush]]、[[session rollover]] 接管 [[Layer2 压缩]]、[[日期工作史]]。

刻意做成门控而非全局默认：仅 im-gateway 为 [[im-gateway cwd]]（Claw 这一个固定且唯一的项目）spawn coding-agent 时传入；desktop / TUI 永不传，行为完全不变。靠**显式 flag 而非 cwd 探测**——不引入「按目录猜行为」的魔法。与 [[host_request / host_response]] 所依赖的 `--enable-host-bridge` 是两个正交的门控（记忆不必依赖出站 IM 工具，反之亦然）。

记忆的归属是**项目级单一**：Claw 是单 owner 的客户端，不区分 user/project、不考虑多租户，全部 IM 会话共享同一份 [[MEMORY.md]] 与 [[日期工作史]]。

### MEMORY.md

[[im-gateway cwd]] 根下的**单一项目级记忆文件**（策展式 Markdown），是 Claw 跨会话记忆的常驻层。由 coding-agent 的 `resource-loader` 在 session 启动时**作为冻结快照**注入 system prompt——与现有 `AGENTS.md / CLAUDE.md` 注入走同一通道。

「冻结快照」是硬纪律：当前进程内 system prompt 里的 MEMORY.md 内容**不随写入实时变化**，agent 通过 [[memory 工具]] 的返回值看到自己的写入，新内容**下一次进程加载时**才进 system prompt。目的是保住 Anthropic 前缀缓存（每次改写 system prompt 会令缓存失效，吃掉约 75% token 成本节省）。因 im-gateway `closeOnIdle` 每条消息重启进程，「下一次加载」≈ 下一条 IM 消息，故记忆跨消息近实时生效。

借鉴 Hermes 的 `MEMORY.md`，但**合并掉 `USER.md`**——单 owner 下「关于用户」与「关于项目」无意义区分。

### memory 工具

memory-mode 下注册给 agent 的工具，签名 `add / replace / remove` 操作 [[MEMORY.md]] 条目，原子写盘。agent 主动决定何时记。与 [[memory flush]] 互补：flush 是保证写入点，工具是随时写入。

### memory flush

[[session rollover]] 前的**抢救步骤**：注入一条系统消息邀请 agent 把即将被滚动掉的重要信息写进 [[MEMORY.md]]，再执行滚动。借鉴 Hermes `flush_memories()`。是 MEMORY.md 不会长期为空的保证写入点。

### session rollover

memory-mode 下取代 [[Layer2 压缩]] 的会话滚动：上下文逼近压缩阈值时，不在原 jsonl 原地做 LLM 压缩，而是 ① 先 [[memory flush]]；② 复用 compaction 现成逻辑生成「保留近期尾巴（`keepRecentTokens`，默认 ~20k）+ LLM 摘要」；③ 把尾巴+摘要**写进一条新 jsonl**，`SessionHeader.parentSession` 指回旧文件，旧 jsonl 归档不再追加。

承接进新会话起始上下文的 = 近期尾巴 + 摘要 + （resource-loader 注入的）[[MEMORY.md]]。

存在的**理由是 im-gateway 专属**，不同于 Hermes：im-gateway `closeOnIdle` 每条消息 spawn 新进程并**全量解析整条 jsonl**，而原地压缩只追加 entry、不截断文件 → jsonl 无限增长 → 每条消息冷启动解析成本随时间上涨。rollover 给单文件大小封顶。Hermes 是长驻进程不付此成本，故不做 rollover。

[[Layer1 microcompact]]（免费裁旧工具输出）在 memory-mode 下**照常运行**，只有 [[Layer2 压缩]] 被 rollover 取代。`session_search`（跨 jsonl 全文回溯，借 parentSession 链）**延后到二期**，一期只留好指针。

### Layer1 microcompact

coding-agent 现有压缩的第一层：纯函数、零成本，每次 LLM 调用前裁掉旧的工具结果 / bash 输出、删旧 thinking block（留 signature）。memory-mode 下保留。

### Layer2 压缩

coding-agent 现有压缩的第二层：Layer1 后仍超阈值时触发的 LLM 摘要压缩，结果以 `compaction` entry 写回**同一** jsonl。默认阈值贴近上下文 80%（`minFreePercent:20`），是「逼近阈值后每轮都重压缩」卡顿的根因。memory-mode 下被 [[session rollover]] 取代。

### 日期工作史

memory-mode 下的**按需渐进披露记忆层**，与常驻的 [[MEMORY.md]] 互补。物理形态：agent 的**运行 cwd 设为今日日期目录** `<im-gateway cwd>/<YYYY-MM-DD>/`，故 agent 写 `./` 产物自然落今日目录、读 `../<昨天>/` 回溯。与 [[im-gateway inbox]] 的按日分目录天然同构（入站媒体、出站产物、当日 [[JOURNAL.md]] 同处一个日期目录——刻意**按日期而非按 session 物理隔离**）。

「问 agent 昨天干了什么」即由此成立：agent 自助翻昨天的日期目录（读 [[JOURNAL.md]] + 产物文件）。产物被视为记忆的一部分。

借鉴 ADR-0007 desktop 的 per-cwd 隔离思路，但轴是**日期**而非 sessionId（IM 不做 per-session 产物隔离）。

### JOURNAL.md

[[日期工作史]] 每个日期目录下的当日日报，是「昨天干了什么」的渐进披露索引。填充来源：**每个 turn-end coding-agent append 一行精简摘要**（做了什么 / 生成了什么文件）+ [[session rollover]] 时额外写一段提炼。两路保证轻聊日子也有记录、重度日子有提炼。

### 活动回合（live turn）

im-gateway 一个 IM 会话（路由 key `(userID, chatID)`）从**首条消息**起、到 agent 交付**本轮最终答复**（`agent_end`，最终回复「落定」）止的这段区间。判定刻意**不依赖时间间隔**，只看「本轮是否已答复」这一个状态——因为时间间隔无法区分「用户分多条说同一需求 / 中途想纠偏」与「另起新需求」。

「已答复」在两平台统一以 `agent_end` 为界，故飞书流式打字途中、微信 defer 整轮期间都属于活动回合、都可被 [[消息折叠]]。活动回合不设时长上限：用户持续追加就持续延长，这正是「只要没答复就能一直打断补充」的体现。

### 消息折叠（message folding）

活动回合期间所有入站 IM 消息**并入同一回合、最终只产出一组回复**的策略，取代「一条消息=一轮=一组回复」的旧行为。落点分两段：

- **prompt 未发出**（仍在 acquire host session 的冷启动窗口）：新消息**并入首个 prompt**。冷启动延迟本身充当免费合并窗，不额外加防抖定时器。
- **prompt 已发、agent 运行中**：新消息走 coding-agent RPC 现成的 `steer` 命令注入，agent 在下一个工具边界重新规划并纳入，**保留已做的工作**（不 abort 重跑）。飞书在同一条消息气泡内续写，不另起气泡。

活动回合期间的消息**一律 steer**，不再过 slash 命令解析；命令只在 `IDLE`（无活动回合）时生效。`agent_end` 后到达的消息才另起新回合。无「硬取消」出口——纠偏即发消息。

### 托管运行时（managed runtime）

由 desktop-app 替普通用户托管、落在用户目录下的语言运行时（v1 = Node、Python）。与「系统运行时」（用户机器上原本就有的、由用户自己装的 node/python）对立。bash tool 执行命令时优先让托管运行时可见，目的是让缺少开发环境的普通用户也能跑依赖 node/python 的 agent 能力。

刻意**不含原生编译工具链**（gcc/make/MSVC）——那是另一类问题（见 [[源重定向]] 不解决编译，只解决「源不可达」）。git/ffmpeg 等通用 CLI 可作为同构的可选附加项，但不属 v1「运行时」叙事。

### 运行时来源三层（runtime source tiers）

[[托管运行时]] 的获取按优先级分三层，互补而非互斥：

1. **内置 vendor**：随安装包打入当前构建平台的运行时二进制，首次启动**本地拷贝**进托管目录——零下载、秒级可用，是普通用户首启的主路径。
2. **下载源列表**：一个 `urlTemplate + priority` 的有序回退列表，仅用于「升级/装非内置版本/其他平台」。源是**配置项**——「现在填公共镜像、将来插一个自建 CDN 作 priority-0」对它只是加一行，不是重写。
3. **系统探测**：扫描用户机器已有的 node/python，能复用则不下载。

「下载下来就有环境」这一体验来自第①层；第②层是 Node（npmmirror 稳定）与 Python（python-build-standalone 仅 GitHub 发布、国内无稳定公共镜像）**可靠性不对称**的兜底，也是自建 CDN 的最终归宿。

### 源重定向（source redirection）

在 bash tool spawn 子进程的瞬间注入临时环境变量，把包管理器指向国内可达镜像、并把 [[托管运行时]] 的 bin 前置进 PATH 的机制。复用既有的 `getShellEnv()`（已把 `~/.vetta/agent/bin` 前置）这一注入点扩展。

只解决「官方源不可达」，**不解决「需要现场编译」**。典型注入项：`npm_config_registry`、`npm_config_prefix`（全局包落私有目录、与运行时版本解耦、不污染系统）、`npm_config_cache`，以及 pip 侧的 index/trusted-host。

### 环境管理（Environment Management）

desktop-app 系统设置中新增的面板，普通用户在此查看/获取 [[托管运行时]]。是「专业性太强、依赖开发环境」这一痛点的用户入口。面板暴露的是运行时本身，[[源重定向]] 对用户透明（在 bash 执行时自动发生）。

### image budget

coding-agent 在每次 LLM 调用前（`transformContext` 钩子，`applyImageBudget`）对消息历史里的图片做的保留策略：对**看过的**旧图只保留最新 N 张（`maxRecentImages`，默认 2，desktop-app 设置页可调；`<=0` 禁用即全保留），其余替换为文本占位符以省视觉 token。是**只作用于本次发送 payload 的纯函数变换**，不 mutate 原始历史、不落盘（脏读不可能）。

ADR-0012 起判定依据从「留最新 N 张」改为引入 [[未看过的图]]：N 只约束「看过的」旧图，未看过的图无条件保留。原本附带的 OOM 硬保护（把批量读的图强砍到 N）被**刻意移除**——显存受限的本地模型改由部署方提示词软引导「一张一张读」来兜底，云端模型无显存墙不受影响。文档/代码里出现「图片预算」「视觉 token 封顶」时即指本机制。

### 系统通知（system notification）

desktop-app 经由 OS 原生通知中心（macOS / Windows）向用户推送的、APP 内事件的横向通知能力。设计为**类型化**：每条通知带一个 [[通知类型]] 判别字段，共用同一套「是否展示 → 构造内容 → 点击路由」基础设施。点击通知统一**前台化 APP** 并按该类型的路由意图跳转。首期只落地 [[agent 完成通知]] 一种类型，其余类型（更新提醒、错误告警等）为未来横向扩充预留位。

权限**交给操作系统**：不在代码层主动申请或检测授权，依赖 OS 首次弹窗接管。设置层面只提供一个全局总开关（「通用设置」下），不按类型拆分开关。

### 通知类型（NotificationType）

[[系统通知]] 的判别联合标签。每种类型自带 payload 形状与「点击后做什么」的路由意图。当前成员：[[agent 完成通知]] 与 [[agent 提问待确认通知]]（payload 均携带定位目标 session 所需的标识）。新增类型 = 加一个联合分支 + 在薄 dispatch 里补一段判定/构造/路由，**不触碰**已有类型。

### agent 提问待确认通知

[[通知类型]] 成员：[[交互式 session]] 的 agent 调用 [[ask_user_question]]、有问题待用户确认时触发的 [[系统通知]]。正文固定「有问题待确认，点击查看」，标题取 session 名。抑制规则与 [[agent 完成通知]] 同（聚焦且正停在该 session 聊天页时不弹——[[问答面板]] 已在眼前）。coalesceKey 用 `question:<sessionPath>` 与完成通知区分，二者互不覆盖。点击前台化并路由到该 session。

### agent 完成通知

[[通知类型]] 的首个成员：一个[[交互式 session]]「完成一轮回答」时触发的 [[系统通知]]。**触发**条件是该轮以正常结束（`agent_end`，对应 stopReason `stop`）或**出错**（stopReason `error`）收尾；用户主动中断（`aborted`）**不**触发。标题取 session 名（auto-title，回退首条用户消息截断），正文为固定文案。点击后前台化 APP 并路由到该 session 的聊天界面；若该 session 已被删除/文件不存在，则仅前台化、停留当前界面、不报错。

同一 session 的连续完成**合并为一条**（新通知替换该 session 的旧通知）；不同 session 各占一条。

### 通知抑制规则（前台同 session）

[[agent 完成通知]] 唯一**不**弹出的情形：APP 窗口当前**聚焦**（`isFocused`，窗口可见但失焦不算前台）**且**用户当前正停在**该 session 的聊天界面**上。两个条件缺一即通知——APP 在后台时即便看的就是该 session 也通知；APP 聚焦但停在设置页/自动化页等非聊天界面（即便内部 activeSession 仍指向该 session）也通知。「正在看哪个 session」由渲染进程上报给主进程，与主进程持有的窗口聚焦态合并判定。

### 交互式 session

用户在聊天界面**手动发起**的 session，与自动化/批量任务/定时任务等**非手动发起**的 session 相对。判别依据是创建路径：交互式 session 经渲染进程的 `session:create` 通道创建，批量/定时任务直接调运行时创建——故主进程可在 `session:create` 处天然圈定交互式 session。[[agent 完成通知]] **只针对交互式 session**，避免后台任务刷屏。

### 未看过的图（unseen image）

[[image budget]] 的核心判定：一张图若位于消息历史里**最后一条 assistant 消息之后**，则即将发起的这次 LLM 调用是模型**第一次**看到它 → 判为「未看过」→ 无条件保留，不受预算 N 约束。一旦其后出现了 assistant 消息（模型已处理过这一批），转为「看过」→ 才进入预算被砍候选。

这是消息数组结构的**确定性、无状态**信号，不需要额外标志位。它保证 agent 批量 `read` 多张图时，模型在第一次调用里能完整看到全部图，根治「读了=没读」（模型对本该现在看的图收到占位符的幻读不可能）。代价见 [[image budget]]：未看过的图全保留 ⇒ 算法层不再防 OOM。

### 个性化（personalization）

一个**全局、跨所有项目/session** 的系统提示词追加能力，入口在 desktop-app 设置页「Agent配置」最上方。由两部分组成：一个 [[人设]] 单选 + 一段 [[自定义指令]] 自由文本。配置写入 `~/.vetta/agent/settings.json` 的 `personalization` 块（`{ personaId, customPrompt }`），与 [[image budget]] 的 `maxRecentImages` 同文件不同字段。

生效走 [[个性化懒重建]]：点「应用」只落盘、不触发任何 session 重建；每个 session 在**下一个 user prompt** 时按需检测并重建系统提示词。语义刻意复刻 MCP 的懒重建（mcp.json 写盘不 fan-out，prompt 入口 diff-reload）。

默认态（`personaId = "default"` 且 `customPrompt` 为空）**什么都不追加**，系统提示词与未开启该功能时完全一致。

### 人设（persona）

[[个性化]] 的预设提示词项，**唯一编辑来源**是 coding-agent 的 `src/core/personas/*.md`（一人设一个 md，frontmatter 存 `id / label / description`，正文存提示词）。构建期由 `scripts/generate-personas.mjs` 把 md 内联成 `src/core/personas-data.ts`（`FILE_PERSONAS`），`personas.ts` 引入它合成 `PERSONAS`——**运行时零文件系统依赖**。settings.json 只存 `personaId`，提示词正文在系统提示词构建时由注册表解析。desktop 通过 IPC 拉取注册表渲染选择器，避免前后端清单漂移；日后改预设措辞对存量用户自动生效。

**为何 codegen 而非运行时读盘**：coding-agent 会被 desktop 的 `vite.main.config.ts` 打进 main bundle（不在 external 列表），打包后基于 `__dirname` 的 `readdirSync` 会落到 desktop 的 dist 路径、读不到 md（同 photon-node 的 `__dirname` 失效问题，注释已记载）。曾先用运行时读盘，desktop 里只显示「默认」即此故。内联成字面量后任何打包/二进制场景都稳。

特殊成员 `default`：no-op 占位，不落 md、在 `personas.ts` 里合成并永远置顶。首期除 `default` 外有 `务实`（回答精炼、切入准、不绕弯、专注任务）与 `交互`（主动提问对齐需求、附推荐方向、获授权再执行）。**人设正文用英文写**（label/description 保持中文供 UI 展示）。新增人设 = 往目录加一个 md（按文件名排序决定展示顺序）后重新构建（`bun run build` 会先跑 `generate:personas`），不触碰存储与注入逻辑。

人设正文是**预设、产品维护**的；与 [[自定义指令]] 正交——后者是用户自己写的。

### 自定义指令（custom instructions）

[[个性化]] 中用户在 [[人设]] 之上追加的一段自由文本（设置页 textarea），存于 settings.json `personalization.customPrompt`。与人设**相互独立**：即便选「默认」人设，只要本文本非空就照样追加。

刻意不叫「全局提示词」——「全局」在本系统里已指 [[个性化]] 的作用域，复用会歧义。

### 个性化懒重建（personalization lazy reload）

[[个性化]] 的生效机制，与 MCP 懒重建、`image budget` 懒重读同构：desktop 写 settings.json 后**不** fan-out 重建；coding-agent 在每次 `prompt()` 入口对 `personalization` 块做签名比对（缓存上次签名，相等走 fast-path、无副作用），变化时才重建系统提示词、令本轮 prompt 立即看到新人设/指令。

刻意与 `APPEND_SYSTEM.md` 文件注入分离：那条路径只在 session 初始化/显式 `reload()` 时读盘，无 per-prompt 懒重载；个性化需要「应用后下一轮即生效」故走独立的轻量签名路径。注入位置见 [[个性化]]——拼在系统提示词末尾，顺序为 `APPEND_SYSTEM.md → 人设 → 自定义指令`。

### 预设模板（provider template）

服务端下发的、用于「免配置接入大模型服务商」的**目录条目**:每个模板描述一个服务商的 `baseUrl`、模型列表(含上下文/输入形态/是否思考/价格等能力元数据)、`api` 类型、供应商图标等——但**不含 key**。客户端启动时 fetch 一份(BYOK 直连,见下),用户只需填入**自己的 key** 即可使用该服务商的预设模型。

与 [[远程网关]] 是**两个独立、并存**的来源,术语上刻意不复用 "remote":
- **预设模板 = BYOK 直连**:请求直发服务商原站(`api.anthropic.com` / `api.deepseek.com` …),用**用户自己的 key**,服务端只提供目录、**不碰 key、不转发流量、不扣 credits**。
- **远程网关**:请求经服务端代理(`gatewayUrl`),用登录 JWT 当 key,服务端可计费。

**采纳即持久化(snapshot-on-key)**:用户给某模板填入 key 的那一刻,该模板被落成本地 [[models.json]] 里的一个普通 provider 条目(带 `apiKey`),并打上来源标记 `source:"template"` + `templateId`。由此 `getAvailable()` / `ModelSelector` / 离线 fallback 全部复用既有机制。手搓的自定义服务商无此标记,**任何同步逻辑都不得触碰**。

**在线合并 / 离线回退快照**:每次 fetch 成功,用服务端最新的 url/模型/参数**覆写** `source:"template"` 的本地条目(只保留用户填的 `apiKey`);服务端删除该模板或 fetch 失败时,本地已持久化的快照照常可用——「服务端能修正错误配置」与「离线/下线不影响存量用户」二者兼得。

设置页中作为**独立的「预设服务商」区**呈现,与「服务商」(手搓自定义、models.json 中无 `source` 标记)、[[远程网关]]「远程服务商」三区语义并列、互不重复:`source:"template"` 的条目只在预设区显示、从手搓区隐藏。fetch / 合并 / 写回 [[models.json]] **只发生在 desktop-app main 进程**;coding-agent 不感知模板,仅需其 ProviderConfigSchema 容忍 `source`/`templateId`/`icon` 字段,复用同一份已持久化的 models.json。无内置种子目录:首启离线且 fetch 失败时预设区为空 + 提示重试。填入 key 即持久化启用、**不做 /models 校验**,首次真实请求才暴露无效 key。

### 远程网关（remote gateway）

见 [[预设模板]] 的对比定义。指现有的 `fetchRemote → /providers/models.json` 机制:登录后服务端下发模型,请求经服务端代理转发(`gatewayUrl`),以登录 JWT 为 key,服务端可计费。是与预设模板**并存**的另一条链路。同样携带 [[icon symbol]]。

### icon symbol

供应商图标的下发方式:**客户端内置一套图标资源,每个资源有唯一 symbol 字符串**(可无限扩充)。服务端的 [[预设模板]] 配置与 [[远程网关]] 供应商配置都只填这个 symbol;客户端按 symbol 解析到内置图标渲染。`icon` 字段**可选**,空则不显示图标。symbol 随 [[预设模板]] 快照一并持久化进 [[models.json]],离线照常渲染。刻意不下发图片字节/URL——客户端资源 + 服务端 slug,既离线安全又省带宽,新增图标=客户端加一张资源。是**供应商(provider)级**,非模型级。

### ask_user_question

coding-agent 的一个内置工具，让 agent 在执行途中**主动向用户提一组多选题并阻塞等待回答**。借鉴 Claude Code 的 `AskUserQuestion`，转成本仓 snake_case 命名。input schema 是 Claude Code 的**核心子集**：`questions[1-4]`，每题 `{ question, header(短标签), options[2-4]{ label, description, badges? }, multiSelect }`；自动附「Other」自由输入；**不做** Claude Code 的选项级 preview / notes 批注 / metadata。回传给模型走自然语言拼接（`"Q"="A"` 串联，多选逗号连，取消回传明确措辞），[[option badge]] 不进回传。

工具是否对 agent 可见由 [[user question handler]] 的存在与否门控（能力=注册），按 [[实验性功能]] 开关动态启停。交互界面是 [[问答面板]]，transcript 里另留一个富视图 tool_call block 永久记录问题与所选答案。

### user question handler

设在 `getSharedRuntime()` 上的、承载 ask_user_question「阻塞等回答」能力的回调（拟 `setUserQuestionHandler`），与既有 `setUserConfirmationHandler` 同构——但 confirm 只传 bool，本 handler 承载 `questions/options` 富结构与结构化答案。新增 IPC channel（question-request / question-response）承载该结构，与 [[host_request / host_response]] 同属「agent 阻塞等宿主响应」家族。

**「能力=注册」是门控核心**：[[ask_user_question]] 是否进 agent 的 active tool set + system prompt，唯一取决于共享 runtime 上此 handler 是否存在；[[实验性功能]] 开关开→desktop 注入 handler，关→清除。AgentSession 在**每个 prompt 入口**比对「handler 是否存在」与上次构建态，变化即 `_buildRuntime` 重建——与 MCP 懒重建（`_maybeReloadMcpForPrompt`）、[[个性化懒重建]] 同一机制族，故新旧会话都能在下一轮 prompt 动态生效，不向 coding-agent 额外透传布尔 flag。

### 问答面板

ask_user_question 待答时，desktop-app 聊天页**输入栏被完全接管**转换成的 Q&A 选择 UI。多问题(问题组)以**紧凑可折叠的堆叠列表**呈现、可在问题间自由切换，不占过大篇幅；已答问题折叠成所选答案摘要。逃生出口=**显式取消按钮**（→ 触发 abort 语义，工具回传「用户拒绝回答」）+ 每题 Other 自由输入；接管期间隐藏普通文本输入。

**绑定所属 [[交互式 session]]**：请求携 sessionId，切到别的 session 只是隐藏面板（该 agent 仍阻塞），切回恢复待答；后台 session 提问时在侧边栏该会话上打待答徽标。App 关闭/刷新（webContents 销毁）视为取消。

### option badge

[[ask_user_question]] 每个 option 上的结构化标记列表（`badges?: string[]`）。取代 Claude Code「把 `(Recommended)` 塞进 label 文本」的写死做法：agent 可给某选项 append 任意 badge（「推荐」只是其一），既作 [[问答面板]] 展示的引导 badge、也是模型表达倾向性的结构化通道。仅用于展示与引导，**不进**回传给模型的 tool_result。

### 实验性功能（experimental features）

desktop-app 设置页「Agent配置」下的一个分类，首个成员是 [[ask_user_question]] 的开关。配置存储预留分组结构 `experimental.askUserQuestion`，将来加实验项只是加一个键、UI 同区域追加一行。**默认关、用户手动开**——「实验性」只是标签，不代表工具不可用或有额外使用成本，开关只控制是否把工具加载给 agent（经 [[user question handler]] 的注入/清除生效）。

### 输入预测（prompt prediction）

desktop-app 的一项[[实验性功能]]（`experimental.promptPrediction`，**缺省关**，区别于该分组其他键的缺省开）：agent 一轮回答**正常完成**（`agent_end`，aborted / error / 待答 [[ask_user_question]] 均不触发）后，预测用户下一个可能输入的 prompt。

生成走 auto-title 同款模式：独立的轻量 LLM 调用（`completeSimple`，会话当前模型），取最近 2-3 轮对话文本（截断）为上下文，**不**进主对话历史、不由主回答顺带输出。条数由 LLM 自行决定 **0-3 条**——语境无明显走向时返回 0、即不出任何 UI；失败同样静默降级。

呈现为两处：MessageList 下方垂直排列的[[建议 bubble]]；首条建议同时作为 InputBar placeholder——输入框为空时回车即按该建议发送。placeholder 加可识别前缀（↵ 图标 / 提示词）以区别于默认提示文本「向 Vetta 提问…」，让用户明白回车即发这条。生成期间（1-3 秒）**静默等待**：不显示加载骨架，bubble 就绪后才淡入；未就绪时 placeholder 保持默认提示。

生命周期：**内存态、按会话（runtimeId）隔离**，仿 `pendingQuestionsAtom` 的 Record 形态。该会话发出下一个 prompt 即清空；切会话保留、切回仍显示；用户打字不隐藏 bubble；不持久化，重启即失。**丢弃过期结果**：异步生成回填时校验「触发时所属会话仍未发新 prompt / 未开新轮」，否则丢弃，避免上一轮建议错落到新轮下面（不引入 abort 信号，仅在回填点判定）。

适用范围：仅[[交互式 session]]（普通对话 + 项目编码会话）；批量任务 / 自动化会话不启用。

### 建议 bubble

[[输入预测]]的列表呈现单元：MessageList 下方、InputBar 上方垂直排列的 0-3 个可点击气泡，每个承载一条预测 prompt（0 条即整块不渲染）。**点击即直接发送**该 prompt（与「placeholder 态空输入回车直发」语义一致），不是填入输入框待编辑。

### Vetta Go / Token Plan

新增的订阅式计费方式，仿主流 token plan。用户开通某 [[档位]] 后，在该档位的[[窗口配额]]内使用其[[模型分组 tag]]覆盖的模型，**不走积分钱包扣减**。desktop 中作为独立服务商「Vetta Go」呈现；开通后有特殊标记与卡片。

### 站内信（in-app notification）

服务端持久化、经 SSE 实时推送、在 desktop「消息中心」的「通知」(铃铛) Tab 内呈现的应用内消息。每条带一个 `type` 判别字段（**通用类型化**：首期消费者是[[订阅操作]]，未来系统公告/额度告警等可复用同一张表与同一套列表/未读/标已读接口）、`title`/`body`、可选定位 `payload`、以及 per-user 已读状态（驱动铃铛未读角标）。

与 [[系统通知（system notification）]] 是**两个不同概念，不要混用**：
- **系统通知** = desktop-main 经 **OS 原生通知中心**弹出的横幅，由**本地 session 事件**（agent 完成/提问）触发，不持久化、无应用内收件箱。
- **站内信** = **服务端**产生、持久化进数据库、经 SSE 下发、在**应用内**铃铛 Tab 累积的消息。离线期间产生的站内信，用户上线后仍可在 Tab 内看到。

二者可叠加（一条站内信到达时也可顺带弹一次系统通知），但存储与入口彼此独立。
_Avoid_: 把服务端推送的应用内消息叫「系统通知」。

### 模型分组 tag（model group tag）

模型的分类标签，一个模型可打多个。**独立受管实体**（id + 名称），与现有自由文本 `ProviderModel.tags`（"free,fast,vision" 展示标签）完全分离，模型与分组多对多（中间表）。在「模型设置」页有「模型分组」配置入口预设 n 个分组，模型设置中给模型多选打 tag。

**通用概念，不与 Go 强绑定**：分组本身是独立特性，[[档位]]关联若干分组 tag 决定可用模型只是当前**第一个消费者**；未来可能有其他业务按分组处理。建模时保持解耦——分组实体不依赖订阅，订阅单向引用分组。当前仅约束 Go 可用范围，[[Vetta Zen / 按需付费]] 仍暴露所有启用模型、与分组无关。

### 推理档位（reasoning level）

一个模型可选的**思考强度**选项，是**每模型独立**的能力（不是全局、也不是每 provider——同一 provider 下不同模型支持的档位可以不同，如 gpt-5.2 支持 xhigh 而更早的 GPT-5 不支持）。取代原先「全局 [[思考等级]] + 客户端 `supportsXhigh` 硬编码推断」的做法。

形状：模型配置携带 `reasoningLevels: string[]`（**只存 value 字符串**，非 `{label,value}`）+ `defaultReasoningLevel: string`（用户从未选过时的默认档）。`value` **恒为单一字符串**（如 `minimal/low/medium/high/xhigh` 或任意自定义串）；provider 层按模型 `api` 把它放进对应字段（openai-responses→`reasoning.effort`、openai-completions/qwen→`reasoning_effort`…）。上层（档位配置 / [[ai input]] / coding-agent）永远只见字符串，不感知 provider 协议形状差异。

显示：desktop 对**已知 value**（minimal/low/medium/high/xhigh）映射到 i18n key 随语言切换渲染；未知自定义 value 直接展示原文——故档位项不存展示文本，无死文案。

来源分层：每个 `api` 类型在 `@vetta/ai` 内置一份**预设档位列表**作为「新建模型时的预填 + 空列表 fallback」；但**只是预设、非约束**——模型可自由改写自己的档位列表（服务端模型走 admin，本地离线[[预设模板]]/手搓 provider 走 desktop 本地配置）。列表为空时 fallback 到该 api 预设。

记忆与传输：desktop **每模型记忆**上次所选档位（本地 `modelKey→value` 映射，跨会话/重启保留），随 `PromptRequest` 与 `modelKey` 同行下发、应用于本轮。取代原全局 `setGlobalThinkingLevel`（连同设置页全局 SegmentedControl 一并移除）。`reasoning:bool` 降级为**派生值**（`reasoningLevels` 非空即 true），列表为唯一真相源；无全局 `off` 档，关思考与否由档位列表自决。

范围（本期）：仅覆盖 openai-completions / openai-responses 及衍生 v1 第三方适配器（qwen / nvidia / zai …）。[[anthropic-messages]] 原生 provider 本期**不删、也不专门适配**（其 `cache_control` / thinking signature / adaptive thinking 为原生独有、无 v1 等价物），留到后续阶段再单独接入。

### 技能管理字段（skill management fields）

[[技能市场]]里一个 Skill/Scene 的平台侧可管字段：`type`(skill|scene)、`category`、`tags`、`version`、`author`、`alias`、`description`、`is_enabled`、`download_count`。**真相源是平台数据库，不是 SKILL.md。** SKILL.md 的 `metadata` 块仅在**上传那一刻**作导入兜底（用来预填表单初值），入库后一切以 DB 为准、由 admin 编辑；agent 触发只读包内 SKILL.md 原文。
_Avoid_: 把 SKILL.md 的 `metadata` 当成运行期真相源——第三方 skill 不该为了上传被迫改造 metadata。

### market description

[[技能市场]]列表/详情给人看的展示性描述，admin 上传/编辑时填写，**留空降级到 SKILL.md frontmatter 的 `description`**。**纯展示层**：客户端存在 manifest 的 `marketDescription`，不回写包内 SKILL.md。
_Avoid_: 与 **SKILL.md description** 混为一谈——后者是 agent 判断何时触发该 skill 的功能性描述，二者用途不同、互不覆盖。

### skill version（技能版本口径）

Skill 的版本以**服务端 DB 值为唯一真相**。来源优先级：**上传表单值 > SKILL.md metadata.version > 兜底**（新包 `1.0.0`、重传在当前 DB 版本上 `patch+1`）。单包上传时 metadata.version 预填表单、admin 可改；批量上传无表单，新包取 metadata.version、重传取 metadata.version 否则 patch+1。客户端安装时把服务端下发的 version 经 `meta` 存入 [[skills-manifest]]，**绝不重新解析本地 SKILL.md**；`needsUpdate = manifest.version !== market.version`。
_Avoid_: 客户端装完重解析本地 SKILL.md 取版本——SKILL.md 常缺 version，服务端缺省 `0.0.1` 与本地解析缺省 `0.0.0` 永不相等，导致「一直可更新」。

### skill category（技能分类）

Skill/Scene 的分类，**独立受管实体**（id + 名称 + `scope` 区分 skill / scene），admin 有「分类管理」入口 CRUD，上传/编辑时按当前 type 过滤后**单选一个**。与 [[模型分组 tag]] 同构思路：从 metadata 自由文本解耦，改分类不需重传包。`tags` 仍是自由描述性标签、与 category 分离。

### skills-manifest

客户端 `~/.vetta/skills-manifest.json`，记录每个已装 Skill/Scene 的安装态（`version`/`source`/`enabled`/`type`/`alias`/`marketDescription`）。本地文件扁平铺在 `~/.vetta/{skills,scene}/<name>/`，**同名同时只存一个版本**，路径不含版本号。manifest 里的 `version` 是 [[skill version]] 的更新比对基准。

### skill download_count（下载量）

Skill 的热度计数，**后端 `DownloadArchive` 每成功一次 +1，不按用户去重**（含重装/更新）。admin 表格与 desktop 市场页都展示，市场页可按热度排序。
_Avoid_: 当成「装机量/独立安装数」——它是原始下载次数，不减卸载、不去重。

### 通用 Agent Skill 作用域（generic agent skill scope）

Vetta 之外的、跨 Agent 通用的 Skill 存放约定：全局 `~/.agents/skills/` 与项目级 `<cwd>/.agents/skills/`。与 Vetta **专属作用域**（全局 `~/.vetta/agent/skills/`、项目级 `<cwd>/.vetta/skills/`）并列，是「适配通用 Agent Skill」能力把别的 Agent 写好的 skill 原样纳入 Vetta 发现范围的入口。

发现规则刻意**只认子目录 `SKILL.md`**（不认根目录散装 `.md`），严格对齐业界 Agent Skill 约定——这正是「通用」的含义；根目录散装 `.md` 是 Vetta 专属作用域的特例，不带进通用目录。

来源标记上与专属作用域区分：从此处加载的 skill 打 `source = "agents-user"`（全局）或 `"agents-project"`（项目级），区别于专属的 `"user"`/`"project"`，使 [[skills-manifest]] / desktop 列表能识别其为「通用、无平台托管」从而**只读呈现**（不可在[[技能市场]]卸载/启停/版本管理）。

同名碰撞时 **Vetta 专属优先于通用**：通用 Agent Skill 目录在所有 Vetta 原生来源（`user`/`project`/`scene`）之后加载，先加载者胜，故加载顺序为 `user → project → scene → agents-user → agents-project`——通用 Agent Skill 是补充而非覆盖内置（含 scene）。两处目录均纳入 agent 路径保护（只读、禁止 agent 新增/修改），与 Vetta 自家 skill 目录同等对待。

作用域支持是 coding-agent 核心**默认开**（CLI 也享受），desktop 侧由「Agent配置 → 扩展功能 → 适配通用 Agent Skill」开关控制（默认开、可关），关闭时向会话传入禁用标志。desktop 聊天侧技能选择器（`/` SlashPanel）经 `vetta:skills:list(cwd)` **按当前会话 cwd 列出**：既有全局 `~/.agents/skills`，也有该项目的 `<cwd>/.agents/skills`（不传 cwd 则只列全局来源）。技能**市场页**（技能广场）以独立的「通用 Agent Skill」**只读分区**展示全局 `~/.agents/skills`（按当前 tab 的 skill/scene 类型分流，可预览 SKILL.md，但不可安装/卸载/启停——这些是纯文件、无平台托管）。
_Avoid_: 把 `agents-*` 来源当成可在市场管理的条目——它们无 manifest、无平台托管，纯文件、纯展示。

### 黑胶播放器（vinyl player）

desktop-app 文件预览（`FilePreviewView`）中音频文件的预览形态：旋转黑胶唱片 + 唱臂起落动画 + 常规进度条 + 频谱可视化（Web Audio AnalyserNode 驱动）。覆盖 Chromium 原生可解格式（mp3/wav/ogg/flac/m4a/aac/opus/webm），其余音频格式维持「不支持 + 下载」现状。

唱片中心贴文件内嵌封面（ID3 APIC / FLAC picture，主进程经 music-metadata 解析并连同标题/艺术家经 IPC 返回），无封面降级为纯 CSS 盘面 + 文件名。播放/暂停驱动唱臂搭上/抬起与唱片加速起转/减速停下；打开**不自动播放**。控制集：播放/暂停、进度 seek、音量、循环、倍速。

_Avoid_: 把音频预览的「拖拽」理解为往预览面板拖文件——它专指**进度条 seek**；文件拖入语义属于 [[drop overlay (of ChatPage)]]，不因音频预览改变或新增 drop 区。

### 可信插件（trusted plugin）

Vetta 桌面插件的信任定位：**一方/可信 + 策展分发**——插件由官方或合作方编写、经审核后上架，继续跑在 renderer 进程内、经 Module Federation 共享宿主 React 单例（见 `plugin-host-shim`）。因此插件 SDK 暴露的 API 是「**策展过的能力出口 + 权限门控**」（ergonomic + `PluginPermission` 校验），刻意**不**追求 iframe/worker 沙箱与异步消息桥——那是「不可信第三方」模型才需要的，当前明确不走。新增对话类 API 时按此前提设计：可同步、可直接传 React 组件实例、可读宿主 store。

### 文件预览插槽（file preview slot）

[[可信插件]] 的第二类 UI 扩展点（第一类是 App.tsx 的全局 slot）：插件按**文件扩展名**贡献一个预览组件，挂进 desktop-app 活动面板的 `FilePreviewView`。

**优先级 = 仅补空白**：内置显式支持的扩展名（image/audio/pdf/html/docx/markdown/json，见 `FilePreviewView` 的 `*_EXTENSIONS` 集）一律走内置，插件**无法**抢占；只有内置不认、本会掉进文本兜底（`CodePreview`）的扩展名（如 `.drawio`）才查插件注册表，命中即渲染插件组件，否则维持文本兜底。一个坏插件不会退化任何现有内置预览体验。

**组件契约（slot 组件首次接收 props）**：与全局 slot「零 props 自包含」不同，预览组件收到 `{ path, name, extension, mime, size }` + 一组内容访问器 `readText() / readBytes(): ArrayBuffer / getUrl(): string(可 fetch 的流式 URL)`。宿主**不**替插件预读/猜编码——插件自决按文本还是二进制读，`path` 也直接暴露，便于走原生 fetch。由此天然兼容二进制格式与大文件（宿主不再全量 base64 进内存）。

**声明机制**：`activate` 内命令式注册，`ctx.ui.registerFilePreview({ extensions: ["drawio"], component })`，与 `registerGlobalSlot` 同构、插件启动时注册（沿用现有 eager 激活，不引入 manifest 声明式/懒加载）。同一扩展名多插件抢注时**先注册者胜** + `console` 警告。

**权限**：注册需新权限位 `ui.slot.file-preview`（与 `ui.slot.global` 对称）。但内容访问器（readText/readBytes/getUrl）**不**额外要 `fs.read`——读的是用户主动点开、宿主中介交付的那一个文件，非任意文件系统访问，边界止于此。

### 活动面板插件 tab（plugin activity tab）

[[可信插件]] 的第三类 UI 扩展点（前两类是全局 slot 与[[文件预览插槽]]）：插件经 `ctx.ui.registerActivityTab({ id, label, icon?, component })` 命令式注册（与 `registerGlobalSlot` 同构，一个插件可注册多个），注册仅进入「可添加池」，**不直接渲染**——由用户在活动面板手动 attach 后才出现为一个 tab。权限位 `ui.slot.activity-tab`。

**attach 单位是 contribution 而非插件**：一条 attach 记录指向 `pluginId:tabId`。**作用域 key = 当前会话的 cwd**：普通项目所有 session 共享项目 cwd → attach 天然项目级同步；默认「对话」项目每个 session 有独立子目录 cwd（ADR-0007）→ attach 天然 per-session 隔离，**不靠任何对「对话项目」的特判**（见 ADR-0026）。attach 记录（cwd → contribution 列表）持久化在 renderer localStorage，与 sidebar width 等 UI 偏好同一套路。

**增删同一入口**：hover tab 栏右侧浮现"+"按钮，弹出勾选列表（勾=attach、取消勾=remove），不给 tab 本身加右键/关闭交互。插件 tab 追加在所有内置 tab（含动态 todo/后台任务/调试）之后、按 attach 顺序排列，无拖拽。**渲染 = attach 记录 ∩ 当前已注册 contribution**：插件禁用 tab 即隐、重新启用即回，记录不随插件状态联动删除。组件契约与全局 slot 同构（零 props，会话上下文走 [[对话插件 API]] hooks），icon 传 React 节点而非 iconify class 字符串（后者依赖宿主 CSS 扫描、静默失败）。

IM 会话查看器（SessionViewerPage）**首期不支持**——其 cwd 是单一固定目录，无法满足 per-session 隔离语义。

**面板作用域出口**：插件 tab 组件经 SDK hook `useActivityTab()` → `{ cwd }` 拿到「自己被渲染在哪个 cwd 的面板里」（plugin-sdk 定义 React Context、宿主渲染时 Provider 注入）。不要用 `useActiveConversation().cwd` 代替——项目详情页的 ActivityPanel 是显式项目 cwd，活动会话可能属于别的项目，两者会错位。

_Avoid_: 把它当成第三个"自动渲染"插槽——全局 slot 与文件预览插槽注册即生效，本插槽注册只是入池，attach 才生效。

### 移动UI预览（mobile UI preview）

[[活动面板插件 tab]]形态的外置示例插件（id `mobile-ui-preview`，位于 `packages/plugins/externals/`，需用户自行安装）：在仿真移动设备边框（react-device-mockup，命名机型预设表映射形态+逻辑分辨率，含 iPhone 三形态 / Android / iPad，自绘 iOS/Android 两套仿真状态栏，支持横竖屏）内预览当前作用域的 HTML 页面。html/htm 候选按面板 cwd 递归列出（复用平台递归排除规则），iframe src 走 [[静态文件协议]]故相对资源可用；所选 html 变更自动刷新 + 手动刷新兜底。机型/横竖屏偏好全局记忆，所选 html 按 cwd 记忆。

_Avoid_: 把设备边框当像素级真机渲染——逻辑分辨率 + 整体 scale 适配面板宽度，是 UI 形态仿真不是真机仿真。

### 静态文件协议（vetta-file://）

desktop-app 主进程注册的通用静态文件协议：`vetta-file://local/<绝对路径>`，**pathname 承载路径**（区别于 [[媒体流协议]] 的 query 参数形态），故 HTML 内的相对资源（css/js/图片）能按目录正确解析；mime 按扩展名映射常见 web 资源，路径校验复用预览沙箱（项目根/主目录内可读）。动机：iframe `srcDoc` 无法加载相对资源，凡需「整页带资源地预览项目内 HTML」走本协议。见 ADR-0027。

_Avoid_: 与 [[媒体流协议]] 混用——vetta-media 专责音视频 Range 流，vetta-file 专责静态整文件，不合并。

### 对话插件 API（conversation plugin API）

[[可信插件]] 在 agent 对话场景可用的能力出口，首期三类（斜杠命令明确**不**做、steer 缓）：

**读状态（hook 为主 + 事件补非 React）**：宿主从 `@vetta-org/plugin-sdk` 导出 hook —— `useActiveConversation()`（→ id/cwd/title/model/isStreaming）、`useConversationMessages()`（→ ChatMessage[]）等，hook 内部读宿主默认 store 的 `activeSessionAtom` / `chatMessagesAtom` / `isStreamingAtom`、自动 rerender。落地靠：宿主在 `installPluginHostShim` 时把 jotai store/atoms/actions 注入 plugin-sdk 的内部 bridge，Module Federation 令宿主与插件共享同一份 pluginSdk 实例，故注入对插件 hook 可见（plugin-sdk 不反向依赖 desktop-app）。权限：`agent.session.read`。

**事件（实时、细粒度）**：`ctx.conversation.on(event, cb)`，是 `window.vetta.session.subscribe` 生命周期流策展成的插件友好事件，刻意做到「agent 每次调用都有事件、可实时反应」——成员：`turn-start` / `turn-end`（agent_end，携 stopReason）/ `message-added` / `message-updated`(delta) / `tool-call-start` / `tool-call-end` / `conversation-changed`(活动 session 切换)。权限：`agent.session.read`。

**写/驾驶**：`ctx.conversation.sendPrompt(text)`（复用 session.prompt IPC，往活动会话发一轮）、`insertText(text)`（纯 renderer 改 InputBar atom，填而不发，供「建议 prompt」类插件）、`abort()`（复用 session.abort）。权限：`agent.session.write`。

**「活动会话」是环境量**：API 默认作用于当前活动 session（desktop 同时只看一个），不让插件枚举/持有任意 session 句柄。

### 插件内聚 MCP（plugin-scoped MCP）

[[可信插件]] 通过 `plugin.json` 的 `agent.mcpServers`（相对路径 `.mcp.json` 或内联 map）+ 权限 `agent.mcp.control` 贡献自带 MCP server。作为 **第三配置源** 进入会话 `McpManager`，与用户全局 / 项目 `mcp.json` **并列且不回写**用户文件。运行时名为 `plugin-<pluginId>-<localName>`（kebab、无 `_`）。生命周期绑定插件启停：禁用/卸载 reconcile 拆除进程。见 ADR-0040、`docs/plugin/mcp.md`。

_Avoid_: 把插件 MCP 写入 `~/.vetta/agent/mcp.json`——卸载与版本切换会脏化用户配置。

### 系统插件（system plugin）

随 App 一起发布、**用户不可删除/修改**的[[可信插件]]，与用户自行安装的插件（`source: "archive" | "remote"`）相对，来源标记 `source: "system"`。物理上从**只读位置直服**——打包后在 `process.resourcesPath/system-plugins/<id>/`，dev 下在 `packages/plugins/presets/<id>/`——`vetta-plugin://` 解析按 source 选 base 目录，**不**拷进 `~/.vetta`、**不**写进 `plugins-manifest.json`（该文件只存用户态：用户插件记录 + 用户对系统插件的偏好覆盖）。`listPlugins()` 时由运行时发现并与用户插件合并呈现。因随 App 发布，版本跟随 App，不走用户插件的 `availableVersion / pendingVersion` 更新流。

### 预置插件（preset plugin）

`packages/plugins/presets/<name>/` 下的插件**源码**，在 monorepo 内授权、维护——是[[系统插件]]的「源」面。构建期逐个 build 产出**解压态** `dist/ + plugin.json`（非 zip）：打包时拷进 desktop-app 的 `resources/system-plugins/<id>/` 随包发布，dev 下直接就地读 `packages/plugins/presets/<id>/{plugin.json, dist/}`。运行时零解压、零拷贝。「放进 `packages/plugins/presets/` 即成系统插件」是该目录的约定语义。

### 插件市场（plugin marketplace）

服务端分发 [[可信插件]] zip 包的目录，与 [[技能市场]] 同构：admin 上传 zip，后端解压读取包内 `plugin.json` 自动入库（id / name / version / description / author / permissions），消费接口需登录 token（不限平台，照 [[技能市场]] 鉴权）。**真相源是平台数据库**——`plugin.json` 仅上传那一刻作为元数据来源，入库后 admin 可改展示字段。与技能市场刻意保留三处差异：

- **不设分类受管实体**：技能有 [[skill category]] 独立实体，插件**只保留自由 `tags`**（jsonb，未来做 taglist 筛选，当前不消费），不引入分类 CRUD。
- **下载原样返回上传的 zip**：[[技能市场]] 下载是从 S3 散文件**重打包成 tar.gz**；插件本质是 zip、且要被 desktop 的 `installPluginFromUrl` 直接消费，故插件**整包作单个 S3 对象存、下载原样吐 zip**，不解包不重打包。
- **单表扁平、不留版本历史**：以 manifest `id` 为唯一键，重传同 id **原地覆盖**（更新 version + 覆盖 zip + 保留 download_count 与创建时间），市场侧只暴露「当前版本」。详见 [[插件版本口径]]。

### 插件版本口径（plugin version semantics）

[[插件市场]]里一个插件的 version 以**服务端 DB 当前行为唯一真相**，来源是上传 zip 内 `plugin.json` 的 `version`。单表扁平、**不保留版本历史**：同 id 重传即原地覆盖旧版本，无回滚、无旧版查询。

这与 desktop 端 [[系统插件]]/用户插件自带的 `availableVersion / pendingVersion` 更新流**刻意不对称**——更新流是客户端「装了旧版、市场出了新版」的比对机制，市场侧只需提供「这个 id 当前是哪个版本的 zip」即可驱动它，不需要自己存版本历史。一期采纳与 [[技能市场]] 同构的扁平模型而非 Plugin + PluginVersion 双表，是为最小化首期实现面；代价是市场无法回滚或并存多版本。

### 引导词（guidingWords）

[[可信插件]] 在 `plugin.json` 顶层声明的 `guidingWords?: string[]`：一组该插件想在用户开新会话时主动建议的提示语。是插件**第一个声明式 UI 贡献**——与全局 slot / [[文件预览插槽]] / [[活动面板插件 tab]] 等**命令式** `ctx.ui.register*`（需 `activate` 运行、走权限位）刻意不同：纯静态清单数据，随 [[description]] 同路径从 manifest 流到 `InstalledPlugin`，**无 `PluginPermission`、无运行时注册**。

**唯一消费者是 NewSessionPage**：欢迎页在[[技能管理字段|技能徽章]]下方按插件**分组**展示——每组组标题取插件 `name`，下挂其引导词。入选条件 = 插件 `enabled` 且 `guidingWords` 非空。点击一条引导词＝以其文本为 `overrideText` 走 `openSession → sendMessage(text)` **立即发送**（不填入输入框、不经 atom 异步，规避 stale read）。

**展示用轮播限额**（非数据截断）：同时最多 3 组、每组最多 4 词；组数超 3 则组级 12 秒轮播、某组词超 4 则该组词级 3 秒轮播；未超出则静态。与 [[对话插件 API]] 的运行时 `insertText`(填而不发) / `sendPrompt`(发一轮) 是**两条独立通道**——引导词是会话**开始前**的声明式建议，对话 API 是会话**进行中**的命令式驱动。
_Avoid_: 把引导词与 NewSessionPage 的[[技能管理字段|场景/技能]]混为一谈——后者来自 `skills.list()`（SKILL.md 体系），引导词来自 `plugins.list()`（plugin.json 体系），是两套数据源。

### 媒体流协议（media streaming protocol）

desktop-app 主进程注册的自定义 protocol（`vetta-media://`），把校验过的本地媒体路径映射为支持 Range 的流式 URL，供 `<audio>`（未来含 `<video>`）直接作 `src`。与既有预览的 `readFile` IPC + base64 全量加载**并存**：图片/pdf/docx 等小文件维持旧路径，只有音视频走本协议。见 ADR-0021。

_Avoid_: 把音频也塞进 readFile base64 路径——无损音频可达百 MB，全量 IPC 会阻塞且内存翻倍。

### 图像生成插件（Image Generation Plugin）

桌面端插件，提供两处 UI：AI 输入栏的[[图像模式]]开关、每条消息下的[[图像预览 swiper]]。图像的**实际生成与编辑**都由 coding-agent 的**内置 tool**（`generate_image` / `edit_image`，薄包装）完成，tool 内部转调[[主进程图像服务]]；插件只负责 UI 与交互，二者通过 tool-call / tool-result 事件对接。这是「内置 tool 出能力 + plugin 出界面」的刻意拆分。

> 历史备注：曾有第三处 UI——活动面板「图像编辑」选项卡，编辑在面板内直调 IPC、不经 agent、不写会话历史（见 ADR-0028 原方案）。后废弃：编辑统一收敛到 AI 输入栏，改走 agent `edit_image` tool、成为正式[[生成轮次]]（见 ADR-0029）。

> 历史备注：曾考虑用 coding-agent extension 注册该 tool，但 desktop-app 当前不加载 extension（`ExtensionUIContext` 全 no-op、扫描目录未启用），建整套 extension 加载子系统比内置 tool 的 6+ 注册点更重，故改为内置 tool。

### 图像模式（Image Mode）

权限选择器右侧一个可开关的输入动作（input action）chip。开启后再次点击关闭。是**软隔离意图标记**（非能力闸）：插件经输入插槽的 prompt 装饰器给 `PromptRequest` 注入 `imageMode`，input-pipeline 注入隐形指令，明确「本轮要产出图像」。`generate_image` / `edit_image` **始终按工具 `scope_use` 暴露**——未开开关时，用户自然语言明确要求生图/改图也可调用；开启则加强引导、优先走工具而非纯文字描述。开启且**无**[[图像编辑 attach]] 时，agent 自感知——按 prompt 语义自行决定调 `generate_image`（全新主题）还是 `edit_image`（在最近一张图基础上改）。

### 图像编辑 attach（Image Edit Attach）

[[图像预览 swiper]] 里点某张图右上角「编辑」icon 后进入的状态：该图浓边框高亮，AI 输入栏顶部胶囊区（与文件 / skill 同排）出现一枚「编辑选中图片」缩略图胶囊。语义是**强制把该图作为本轮 `edit_image` 的 source**——发送时注入 `metadata.editImageId`（**只传 id 引用，图像字节不进 LLM 上下文**，承袭 ADR-0028），agent 无生成/编辑选择权。是**一次性**：编辑轮次发出后自动释放（回到[[图像模式]]自感知）。关闭胶囊亦可手动取消。与[[图像模式]] toggle 相互独立、各占一处 UI。

### 图像预览 swiper（Image Preview Swiper）

每条产出图像的消息下方、横向一直向右排列的版本条（超出屏幕可左右箭头翻页）。展示该图所属[[编辑谱系]]的全部版本；**同一谱系只在最新一条消息下渲染**，旧消息的卡自隐，避免多条消息重复堆叠同一 swiper。编辑/生成进行中时，最前面插入一张「正在生成」骨架卡并把 swiper 滚到最前。

### 文生图 / 图改图（Text-to-Image / Image-to-Image）

文生图：仅凭文本 prompt 生成图像，对应 `/v1/images/generations`。图改图（亦称「编辑」）：以一张已有图像 + prompt 生成新图像，对应 `/v1/images/edits`。

### 生成轮次（Generation Turn）

一次「用户 prompt → image tool 调用 → 产出基准图像」的完整轮次。一个生成轮次可能一次产出多张候选图（OpenAI `n` 参数），但它们属于同一轮次。

### 编辑谱系（Edit Lineage）

一张基准图像 + 它后续所有[[图改图]]编辑版本（v1 → v2 → v3 …）构成的链，按 `createdAt` 线性追加、同 `rootId` 归组。编辑是**追加**而非替换：在 v2 上编辑产出 v5（谱系变 v1..v5），v2 保留。谱系在[[图像预览 swiper]] 里平铺呈现，而非整个会话的图库，也不是一次生成的并列候选。

> 「轮」在口语里被同时用于[[生成轮次]]和[[编辑谱系]]。本文档刻意区分二者，后续讨论与代码命名以这两个术语为准。

### 插件设置（Plugin Settings）

类似 VSCode `settings.json` + 设置视图的通用机制：每个插件可声明自己想要的设置项，desktop-app 提供统一的「插件配置」入口渲染它们，值持久化后由插件（renderer）与相关主进程服务共同读取。[[图像生成插件]]用它来配置图像 endpoint / 图像模型 / api key——即[[主进程图像服务]]读取的就是该插件的设置值，而非独立配置文件，也非复用对话模型的 models 配置。

### 主进程图像服务（Image Service）

desktop-app 主进程的图像 IPC 服务：读[[插件设置]]拿 endpoint/模型/key，调用 OpenAI `/v1/images`（生成 / 编辑），把图像字节按 session 落盘，返回引用 id + `vetta-media://` URL。两条入口共用它：生成走 coding-agent 内置 image tool（薄包装转调，tool 通过 host 注入拿到该服务句柄，因 coding-agent 不能依赖 desktop-app）；[[图改图]]面板编辑走插件经 SDK 直调。是「一份实现、两条入口」的单一真相源。

### 卡片描述符（card descriptor）

消息列表下方一张卡片的**声明式、可序列化**身份：`{ type, key?, payload, title?, icon? }`。`type` 选[[卡片渲染器注册表]]里的渲染器（命名空间化、由产卡方拥有）；`payload` 存**稳定引用**（如 image id / rootId）而非内容快照，渲染器据此解析实时状态；`key` 用于[[卡片跨轮去重]]；`title`/`icon` 供[[卡片收纳]]的 tab 标签（描述符为主、注册默认兜底、再回退插件名）。

跨 agent→desktop 边界序列化，故 `title` 是字符串、`icon` 是 [[icon symbol]] 式符号串；只有注册默认值（活在插件 bundle 内）才可为 React 节点。见 ADR-0030。
_Avoid_: 把 payload 当成内容快照——它是引用，实时内容由渲染器解析（image-gen 即拿 id 异步取[[编辑谱系]]）。

### details.cards（卡片产出契机）

工具产物里承载[[卡片描述符]]的字段。工具结果有两条通道：`content`（模型可见的结果文本）与 `details`（模型**永不可见**的 out-of-band 结构化数据，`extractToolImagePreview`/`extractToolUiDetails` 已在用）。卡片描述符作为 `details.cards: CardDescriptor[]` 搭 `details` 这条车，随 tool_call block 持久化进 jsonl、精确锚定到 `toolCallId`。

是本期**唯一**的产卡契机（应用本地命令式 `host.pushCard` 仅预留、不实现）。取代了 [[图像生成插件]] 旧的把 image refs 夹带进 `content` 文本的 `<vetta-images>` 标记 hack。
_Avoid_: 把卡片数据塞回 `content`——那会污染模型可见通道、解析脆弱，正是被本机制取代的旧做法。

### 预备描述符（pending card descriptor）

工具 **start**（仍 pending、无 result）时就挂到 tool_call block 上的 `status: "pending"` 的[[卡片描述符]]，让「生成中骨架」也占一个卡片/ tab。工具完成后 `details.cards` 按 `key` 替换之。存在的理由：描述符常态只随 result 落地，但 in-flight 卡片若不进描述符层，host 就不知道它存在、骨架进不了 tab，破坏「host 权威掌握卡片列表」。

### 卡片渲染器注册表（card renderer registry）

按 `type` 把[[卡片描述符]]映射到渲染组件的运行时注册表。与现有 `pluginMessageSlotsAtom` **同机制**（jotai atom，插件 `activate()` 经 `registerCardRenderer({ type, component, title?, icon? })` 注册、Disposable 卸载），区别只是从「数组、逐个 mount」改成「按 `type` 查」。host 永不枚举或硬编码 `type`；应用内置卡片用同一接口平权注册。

这是相对旧模型的**反转**：旧模型每条消息 mount 全部 slot、各 slot 自己 `null` 自隐，host 对真实可见性不透明；新模型 host 持有每条消息的描述符列表、按 type 查表只渲染真实存在的卡片——[[卡片收纳]]的 tab 可见性与标签由此才算得出来。见 ADR-0030。

### 卡片跨轮去重（card cross-turn dedup）

同 `key` 的[[卡片描述符]]跨轮（跨消息）出现时视为**同一逻辑卡片**，host 只在其**最新锚点**（最后产出该 key 的消息）下渲染，旧锚点不渲染。把 [[图像预览 swiper]] 今天 host 端的 `latestOwnerByRoot` 行为上升为描述符层的通用能力。无 `key` 的卡片退化为逐个独立、不去重。

### 卡片收纳（card stacking / 收纳）

消息下方**多张卡片**的展示策略。≥2 张卡片才在卡片区上方出现操作 area（<2 张时直接裸渲染、同今天）：左侧 tab 切换卡片、右侧两个 icon「列表 / 收纳」切布局。**收纳（tab 切换）是基本形态**，列表（向下平铺）是**不持久化的临时形态**——状态存卡片区组件内，卸载/切会话即回落收纳。tab 顺序按卡片在消息里出现的顺序（工具执行顺序），默认激活第一个。依赖 host 经[[卡片渲染器注册表]]对卡片列表的权威认知才得以成立。

### 快捷面板（Quick Panel）

desktop-app 一个**全局快捷键唤出的独立悬浮窗**（frameless、alwaysOnTop、居中靠上、Spotlight 式），用于不切换上下文地**快速询问 agent**。是与主窗口物理分离的第二个 BrowserWindow（own renderer entry，循 `renderer-ocr` 先例），故**不共享主窗的 jotai store**——它需要的[[最近会话面板]]列表与实时状态全部由 main 进程经 IPC 推送。窗口在启动时创建一次并隐藏，靠 show/hide 切换（非每次重建）；失焦自动隐藏、Esc 隐藏、再次按快捷键 toggle 隐藏。

面板由上到下两块：一个**纯文本输入框**（v1 不支持 [[mentionedFile]] / [[attachedImage]] / `/skill`，复杂带附件任务回主窗做）+ 一个[[最近会话面板]]列表。输入框打字 + Enter 在「对话」scope（[[conversation cwd]]）**新建一个 session 并运行**，复用「对话」默认模型与 `defaultExecutionMode`（面板无模型选择器）。

默认**不启用**：触发选择与发送后行为都在设置页「快捷键设置」里，配置写 main 进程 desktop config（`~/.vetta/config.json`，与 `notificationsEnabled`/`experimental` 同处），**不**走既有 `vetta-shortcuts` localStorage——因触发监听在 main 进程、读不到 renderer localStorage。见 [[快捷面板触发器]]。

### 快捷面板触发器（Quick Panel trigger）

[[快捷面板]]的启动方式：**双击一个功能键**（`config.quickPanel.trigger`，单选 `none` / `mod`=⌘·Ctrl / `alt`=⌥·Alt / `shift`=⇧；缺省 `none`）。`mod` 按平台映射（mac=⌘，其余=Ctrl）；不区分左/右功能键。

双击裸功能键是 Electron `globalShortcut` 能力之外的事，由 `src/main/quickpanel-trigger.ts` 用 **uiohook-napi 原生全局键盘监听**实现：main 进程跟踪目标功能键的「干净点按」（按下→抬起且期间无其它键），两次点按间隔 ≤350ms 即 toggle 面板。仅在 `trigger !== "none"` 时启动监听（默认关=零开销、不申请权限）；配置变更经 `RELOAD_HOTKEY` 热切换。**macOS 首次启动监听需用户在「系统设置 › 输入监控」授权**——设置页对 mac 显示该提示。见 ADR-0035（推翻 ADR-0034 的「普通组合键」缩水方案）。
_Avoid_: 以为触发是 Electron globalShortcut 或可录制任意组合键——现仅「双击功能键」单选。

### 最近会话面板（Quick Panel recent list）

[[快捷面板]]输入框下方的会话列表，**镜像「对话」侧边栏列表**：仅「对话」scope 的 session，按 `modifiedAt` 倒序。每个 item 显示标题、**实时状态**（运行中 spinner / 待答确认 / 空闲 三态）与**最后一句消息的截断摘要**作副标题。状态与摘要由 main 推送：运行态复用 `runningSessionPathsAtom` 同源的 `vetta:session:running-changed` 广播，待答态复用 [[agent 提问待确认通知]] / pendingQuestions 信号。

键盘模型为 **Raycast 式「输入框为第 0 行」**：输入框始终聚焦，初始高亮输入行；Down 进入列表 item1/2/3、Up 回到输入行；Enter 作用于当前高亮行——高亮输入行且有文字=新建会话，高亮 item=**打开主窗并定位**到该 session（鼠标点击 item 同义）。「打开主窗定位」复用[[系统通知]]点击既有的前台化 + `vetta:notification:navigate` 路由通道。

**发送后行为可配置**（设置项，默认「打开主窗并定位」）：① 打开主窗并定位到新会话 / ② 后台运行、面板只关闭、靠[[agent 完成通知]]提醒。

### 取消（cancel）与退款（refund）

两个必须分开的动作，中文口语里常被混作「退订」：

- **取消**：停止下一次扣款，已付的当前周期照常用到期末。**不涉及任何钱的流出**，是用户自助的，且必须与订阅同等便捷——找不到取消入口的用户会直接向银行发起拒付，那对 MoR 商户账号的伤害远大于一次自然流失。
- **退款**：把已收到的钱退回去，真实减少收入。**只能由管理员发起**，用户经邮件申请。自助退款等于给任意用户一个单方面撤销交易的按钮。

退款时是否同时收回权益是**独立选择**：全额退（不满意）该收回，部分退（安抚性补偿）不该收回——把退款做成无条件断服，等于惩罚刚被安抚过的用户。
_Avoid_: 用「退订」同时指代这两件事。

### 工作流（workflow）

主会话 Agent 为并行处理复杂任务而[[派遣]]出的一种 **subagent 类型**：一个独立子会话，出生时携带主会话的[[上下文快照 fork]]，以一份预填的 todo 列表起手执行。工作流之间互不共享上下文；**完全单层**——工作流内部不能再派遣任何代理。首版与主会话共享 cwd（不做 worktree 隔离），靠派遣时把任务拆分为互不重叠的范围来避免文件冲突。

与 `explorer`（只读查资料的 subagent 类型）并列，同属既有 subagent 协调机制，不是独立的第二套并行体系。

_Avoid_: 把工作流称作「后台任务」（那是 background-tasks 标签卡管的后台 bash / explorer）；与 pi-dynamic-workflows 式「编排脚本」混淆——本系统的工作流是声明式派遣，没有脚本引擎。

### 派遣（dispatch）

主会话 Agent 一次性批量创建 N 个[[工作流]]的动作：为每个工作流给定 snake_case id（`task_name`）、一句话人类可读标题（`title`，UI 展示用、用户语言）并分配一组 todo。新一批派遣自动清除**已完成/失败**的旧工作流（id 可复用，UI 只保留当前批次与仍在运行的）；**被中断的保留**——那是断点续跑候选：续跑走 `followup_task`（同一子会话，上下文与 todo 进度完整），不重派。**批量接单 + 内部排队**：单批全部受理（有批量上限），同时运行数受并发上限约束，超出的排队待位、有空位自动补上。派遣后主会话不阻塞——正常结束回合，用户可继续与主会话对话；**每有一个工作流终态就唤醒主会话一次**（沿用 subagent 通知语义），主会话可随时纠偏、补派或要求断开某个工作流。

### 上下文快照 fork

[[派遣]]时把主会话**当前分支的完整消息历史**一次性复制给工作流作为初始上下文的机制。是出生时的快照：此后主会话与各工作流各自独立演进，互不同步、互不可见。取代早期「subagent 不继承父上下文」的决策（该决策对 explorer 仍成立——explorer 只拿任务描述）。

### 工作流进度

单个[[工作流]]的 `已完成 todo / 总 todo` 计数（如 3/4）。todo 派遣时预填但**不锁定**：工作流可自行追加/拆分 todo，故分母可变。进度**只用于展示**，不是完成判定——工作流的「完成」以其回合自然结束（agent_end）为准；结束时仍有未完成 todo 的，进度原样标注，由主会话决定是否续派。

### 工作流 items

会话页 MessageList footer（虚拟列表尾部，与 compaction / streaming 指示器同区）中的工作流摘要块：深蓝色波光标题「有 N 个工作流正在处理」（spin 图标，结束转对勾）+ 树形分支列表，每行：工作流标题（title，回退 task_name）+ [[工作流进度]] + 状态（排队/运行/完成/失败/中断）。点击某 item 打开[[工作流标签卡]]并定位到该工作流。item 上唯一的直接操作是**停止**按钮；其余控制（补派、纠偏、问进展）走与主会话的对话。

### 工作流标签卡

活动面板新增的标签卡（有工作流时才出现，带运行中计数 badge）：顶部是工作流切换条，下方是选中工作流的 **1:1 只读 MessageList**（与主会话消息渲染同构，实时流式，不可输入）。与 background-tasks 标签卡职责互斥：后者继续只管后台 bash 与 explorer，工作流不在其中重复出现。

### Ability（能力）

平台侧**可分发扩展单元的统一概念**：Skill / Scene / MCP Server / Plugin / Bundle 在服务端收敛为**一张 `abilities` 表**、靠 `type` 判别，在 desktop 收敛为**一个「能力」列表 + 一套详情页**。

**统一只发生在「数据存放」与「概念呈现」两层，刻意不统一物理分发与安装**：skill 装 `~/.vetta/skills/`、scene 装 `~/.vetta/scene/`、plugin 装 `~/.vetta/plugins/`、MCP 写进 `~/.vetta/agent/mcp.json` 的一个 key ——三条安装轨道原样保留，因为它们本来就是三种不同的运行时机制。scene 是这一模式的既有先例：服务端与 skill 同表同归档，仅客户端目录不同。

标识为 `(type, slug)` 联合唯一，引用形式 `"skill:figma-ui"`。不来自市场的内置能力（`skill-presets`、系统插件）采用不会与市场冲突的 slug 命名空间，因此无需去重或优先级判定。

**与 [[Capability（授权契约）]] 是完全不同的东西**，不要因中文都能读作「能力」而混用。

### Capability（授权契约）

`@vetta/capability-sdk` / `@vetta/capability-runtime` 里的权限契约层：Capability ID、Grant、access session、constraint、audit（见 `docs/capabilities/README.md`）。回答的是「某个 subject 能否调用某个宿主能力出口」。

中文正式叫法为**「授权契约」**，把「能力」这个中文词让给 [[Ability（能力）]]，避免 desktop 市场条目与授权层同名不可分辨。

### bundle（能力套装）

`type = bundle` 的 [[Ability（能力）]]：一组**各自独立可用**的能力的松散组合。自身**永远无产物**（`artifact_key` 恒空），安装 = 逐成员走各自既有安装轨道，不引入任何新的打包/解包机制。

成员以 `(type, slug)` 引用已上架的能力行为主；只有 **mcp** 允许「私有内联」（内联一段 config），因为 mcp 本就无产物。skill / scene / plugin 成员必须是引用——一旦允许内联带产物的成员，bundle 就要长出自己的打包格式与校验解包逻辑。

**bundle 不可嵌套 bundle**。可被组合的 type 只有 `skill / scene / plugin / mcp`，成员集合恒为一层，不存在递归展开。

**与 [[插件内聚]] 的判据**：bundle 是**松散**组合，成员对用户可见、可单独安装/卸载/启停；plugin 内聚（ADR-0040 的 `agent.mcpServers`、`agent.skillPaths`）是**紧耦合**，成员对用户不可见、随插件生死。要发「不单独上架的 skill/MCP」，答案是打进 plugin，不是塞进 bundle。

### 能力安装台账

`~/.vetta/abilities.json`，desktop 侧记录「装了哪些 [[Ability（能力）]]、什么版本」的**单一索引**，键为 `<type>:<slug>`。

它**只是索引，不是安装位置**：skill / scene / plugin 的产物与 mcp 的配置仍分别落在各自既有位置，台账不复制内容。存在的理由是统一「已安装 / 版本 / 是否可更新」的判定——在它之前这三件事分别来自 skill 目录下的 manifest、`plugins-manifest.json`、以及「`mcp.json` 里有没有这个 key」，其中 mcp 连版本都没有，导致 admin 改了市场 MCP 的 config 后存量用户永远收不到更新。

[[bundle（能力套装）]] **不进台账**：它的安装态、启用态、可更新态全部由成员派生，因此不存在台账与实际状态漂移的可能。

### .vetd（Vetta Design 文件）

「Vetta UI Design」系统插件的设计文档格式，同一扩展名下有**两种形态**，靠文件头嗅探区分：

- **工作态**：`x.vetd` 是 JSON 清单（画布视口、frame 布局、theme 引用），frame 源码与 theme.css 是同级 [[旁挂目录（.vetd.d）]] 里的真实文件。本地编辑的唯一形态——agent 直接用文件工具改源码，热更新靠 [[共享引擎（design engine）]] 的 vite HMR。
- **打包态**：zip 自包含单文件（清单 + 源码 + 构建产物 dist 快照），**只读快照**，仅用于导出分享与预览；要编辑必须先「导入」解包成工作态。

_Avoid_: 把打包态当第二个工作格式（在 zip 上直接编辑）；把工作态清单里内嵌源码。

### 旁挂目录（.vetd.d）

工作态 [[.vetd（Vetta Design 文件）]] 旁与之命名约定绑定的目录（`x.vetd` ↔ `x.vetd.d/`），存放设计的**纯源码**：各 [[Frame（设计画框）]] 的 TSX 文件与共享 `theme.css`（Tailwind v4 `@theme` 令牌，即统一色彩系统）。**不含 node_modules、不含构建配置**——依赖与工具链属于 [[共享引擎（design engine）]]。它是 agent 编辑的落点；与清单脱钩（单独移动其一）是已知代价，靠命名约定与导出命令缓解。

### Frame（设计画框）

画布上一个可自由摆放、拖拽改尺寸的设计视口，源码形态是 [[旁挂目录（.vetd.d）]] 里的一个 TSX 文件（React 组件），由 [[共享引擎（design engine）]] 编译后以 iframe 呈现。选中 frame 或其内部 DOM 可 attach 给 agent 定向修改；agent 正在改某 frame 时该 frame 呈「修改中」态。

**所有权分界（frame meta）**：tsx 具名导出 `export const frame = { width, height, title }` 由 agent/设计者拥有，**meta 是声明，清单是现状**——meta 宽高在 frame 首次被发现时作为初始值进清单；用户拖拽改尺寸只写清单、不回写 tsx；agent 后续改 meta 则清单跟随（最后写者胜）；attach 载荷始终给清单当前尺寸。画布位置只存清单，由插件独占写入（watch 到新 frame 文件即读 meta、自动摆位补清单）。agent 不写清单、不设专用写入 tool（frame 增删改全走原生文件工具），专用 tool 只有骨架创建（vetd_create）、视觉反馈（vetd_screenshot）与构建状态查询（vetd_status）。
_Avoid_: 叫「页面」「artboard」；把 frame 理解为静态 HTML 文件（早期设想，已被工程路线取代）；让 agent 直改 x.vetd 清单。

### 共享引擎（design engine）

「Vetta UI Design」插件托管的**单一** vite + React + Tailwind v4 模板工程：锁死版本、预装 node_modules（随插件预置或首启一次性下载），内含 @iconify/tailwind4 与 JSX 源码插桩（dev 注入 `data-source` 文件:行号，生产构建不注入）。每个打开的 .vetd 由引擎挂载其 [[旁挂目录（.vetd.d)]] 源码起一个 vite dev server（依赖宿主长驻进程 SDK 与托管 Node 运行时），画布 iframe 指向 localhost 获得 HMR。设计文档自身永不携带依赖与工具链。
_Avoid_: 每个 .vetd 各自一套 node_modules / 各自 npm install。
