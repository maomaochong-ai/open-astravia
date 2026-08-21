# Changelog

All notable changes to `@vetta/im-gateway` are documented in this file.

## [Unreleased]

### Breaking Changes

- 独立模式（`im-gateway start`）的 Signal 默认行为改变：`transport.signal.endpoint` 留空不再表示「连接 127.0.0.1:8080 上的 daemon」，而是由网关自行托管 signal-cli。仍想连自己运行的 daemon 时显式写上 `endpoint`（此时 `account` 必填）。新增可选的 `transport.signal.cliPath` / `configDir`。
- IM 侧彻底移除「项目」概念，并与 desktop「对话」物理分家：所有 IM 会话统一落在 im-gateway 自己的 cwd（`~/.vetta/im-gateway/conversation/`），与 desktop 的 `~/.vetta/conversation` 互不可见。删除 `/projects` `/use` 命令；`/new` 改为「在当前对话中开启新 session」。`config.PathsConfig.ConversationCwd` 默认值同步切换。详见 ADR-0004 与 ADR-0005（`docs/adr/`）。
- `hostproto` 破坏性升级：`InitFrame.projects` 与 `ProjectsUpdateFrame` 删除；`InitFrame.conversationCwd`（必填，绝对路径）取而代之。`SessionStateEntry` / `StatePatchEvent` 中的 `projectId` 字段更名为 `chatId`。
- `internal/projects` 包整体移除；`router.New` 签名从 `(tr, cmds, store, projects, pool)` 变为 `(tr, cmds, store, pool, conversationCwd)`。
- `state.RouterState` schema 升至 v2（key 由 `(userID, projectID)` 改为 `(userID, chatID)`）。检测到 v1 文件时直接清空并以 v2 重写——旧 sessionPath 绑定的是用户项目 cwd，与新的对话 cwd 不兼容，无法迁移。旧 `.jsonl` 文件本身保留，desktop 仍可见。
- `config.PathsConfig` 的 `desktopConfig` 字段重命名为 `conversationCwd`；环境变量 `IM_GATEWAY_DESKTOP_CONFIG` 改为 `IM_GATEWAY_CONVERSATION_CWD`。
- Removed multi-source configuration loading (yaml + credentials.yaml + OS keychain + env vars). Configuration is now injected exclusively via the new `host` subcommand's stdin protocol. The `start` subcommand still reads `~/.vetta/im-gateway/config.yaml` but is reserved for developer debugging.
- The `host` mode does not read `~/.vetta/im-gateway/state.json` or any other filesystem source. Routing-table snapshot is sent in the `init` frame; runtime updates flow via outbound `state_patch` events.

- `host` mode never writes log files. Logs are surfaced as NDJSON `log` events on stdout for the parent process to consume.

### Added

- Signal 接入改为「装好 signal-cli 即可扫码」：网关自己找到本机 signal-cli（PATH + Homebrew/apt/scoop 等常见安装位置）、驱动 `signal-cli link` 并把 `sgnl://linkdevice` URI 作为二维码送给上层，随后在随机 loopback 端口上托管 `signal-cli daemon --http` 的整个生命周期，账号号码由 `listAccounts` 自动发现。用户不再需要自己起 daemon、选端口、把 E.164 号码抄进设置里。新增 `internal/transport/signal` 的 `DiscoverCLI` / `ListAccounts` / `Link` / `StartDaemon` 与 `Options.Managed`。
- signal-cli 走代理：signal-cli 是 JVM/GraalVM 程序，既不读 `HTTPS_PROXY` 也不读系统代理设置，在只能经代理访问 Signal 的网络上表现为「link 一直不打印二维码 URI，最后报 Link request timed out」。现在 `link` / `daemon` / `listAccounts` 统一带上 `-Dhttps.proxyHost/Port`（socks 代理则用 `-DsocksProxyHost/Port`），取值顺序为 `CLIOptions.ProxyURL` → 进程的 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` → `-Djava.net.useSystemProxies=true` 兜底，并把 `NO_PROXY` 翻成 `-Dhttp.nonProxyHosts`（始终包含 loopback）。
- `signal-cli link` 全程没有输出关联 URI 时返回新的 `ErrNoLinkURI`，host 层据此告诉用户「无法连接 Signal 服务器，请检查网络或代理」，而不是把 `exit status 1` 原样抛出。
- Host 模式 Signal 扫码链路：新增入站帧 `signal_bind_start` / `signal_logout` 与出站事件 `signal_qr` / `signal_bind_status` / `signal_bound` / `signal_unbound`，未关联设备时沿用 `awaiting_bind` 状态。`hostproto.SignalConfig` 新增 `cliPath` / `configDir` / `ownsConfigDir`，`endpoint`、`account` 变为可选。
- Host 模式的绑定协调器抽象成 `bindCoordinator` 接口（微信扫码 / Signal 设备关联各一个实现），主循环按当前活跃渠道路由绑定帧，避免多渠道绑定流程继续以硬编码分支增长。

- Claw 记忆 + 会话滚动 + 日期工作史接线（ADR-0009）：embedded `host` 模式恒开 memory-mode——`hclocal.Options` 新增 `MemoryMode` / `MemoryFile`，spawn coding-agent 时传 `--memory-mode --memory-file <conversationCwd>/MEMORY.md`（MEMORY.md 落在会话根这一稳定位置，与按日运行 cwd 解耦；SessionDir 仍钉死在根的 `.vetta/sessions`）。`Router.SetDatedCwd(true)` 让每条消息在 `<conversationCwd>/<YYYY-MM-DD>/` 下运行 agent（与 inbox 日期目录同构，产物/媒体/JOURNAL.md 按日归集）。bridge 新增 `SetPathChangeHandler` 捕获 coding-agent 的 `session_path_changed` 事件（rollover 换 jsonl），router 据此把 `(user, chat)` 路由 state 重指向新文件，使下一条消息续接滚动后的会话；新路径经既有 `state_patch` 同步给 desktop。`/new` 在清空路由前先对当前会话发 `flush_memory`（60s 超时、best-effort），把尚未到 rollover 阈值的短会话的持久事实凝结进 MEMORY.md，成功时回复里附「已凝结 N 条记忆」。新增 `hostclient.CommandTypeFlushMemory`。
- Feishu 全形态收发（ADR-0008）：入站新增 image / file / post（富文本）——资源经鉴权 `Im.MessageResource.Get` 下载后落盘到 [[im-gateway inbox]]，post 的文本拍平进 prompt、内嵌图片各成一个附件；出站实现 `SendAttachment`，image 走 `Im.Image.Create`（格式/大小被拒时自动回退成 file 发送），file 走 `Im.File.Create`（`FileType` 按扩展名映射，默认 `stream`），caption 作为跟发文本。新增 `feishu.Options.InboxDir`（host / start 两种模式均传入 conversation cwd）。落盘/命名逻辑抽到新的 `internal/transport/inbox` 共享包，wechat 一并改用。
- New WeChat (iLink) transport in `internal/transport/wechat`. Speaks the iLink bot protocol directly (no OpenClaw dependency), reverse-engineered from `@tencent-weixin/openclaw-weixin@2.1.7`. M1 scope: 1-on-1 text only, scan-to-bind, long-poll receive, send with per-peer 24h/10-message quota tracking. New `im-gateway wechat <login|status|logout>` subcommand drives the QR scan flow and persists credentials to `~/.vetta/im-gateway/wechat.json`. Protocol reference: `docs/ilink-protocol.md`.
- Host mode support for WeChat: `InitFrame.wechat` slot selects the wechat transport, new inbound frames `wechat_bind_start` / `wechat_logout` drive the QR scan flow from the parent process, new outbound events `wechat_qr` / `wechat_bind_status` / `wechat_bound` / `wechat_unbound` stream live progress back. New transport status `awaiting_bind` signals "wechat selected but no credentials yet". The desktop's IM Settings page uses these to render the WeChat binding card.
- `Router.SetTransport` for in-process transport swaps. Used by host mode to replace the placeholder transport with the real wechat transport after a successful bind, without restarting the sidecar.
- New `host` subcommand: embedded sidecar entrypoint for `desktop`. Reads NDJSON control frames from stdin (`init` / `config_update` / `projects_update` / `shutdown`) and writes typed events to stdout (`ready` / `log` / `status` / `state_patch` / `metric`).
- New `internal/hostproto` package defining the wire protocol shared between Go (`host` mode) and TypeScript (`desktop/im-host`).
- New `state.MemoryStore` and `projects.InjectedDirectory` implementations for the `host`-mode runtime — neither touches the filesystem.
- New `Makefile` target `cross-build` producing statically linked binaries for `darwin-{amd64,arm64}`, `linux-{amd64,arm64}`, and `windows-amd64`. Output: `dist/im-gateway-<os>-<arch>[.exe]`. Used by `desktop`'s packaging pipeline to ship the sidecar inside `Vetta.app`.
- Init-frame timeout (10s) — sidecar exits non-zero if the parent fails to send the first frame, preventing accidental orphaned processes.
- stdin EOF triggers graceful shutdown (Windows-friendly path that does not depend on signals).
- New `Transport.EndStream(ctx, chatID, messageID)` interface method. Bridge calls it after the final flush of a streaming response so transports with a dedicated streaming path (Feishu cardkit) can clean up server-side state. Transports without one return nil.
- New `OutboundMessage.Streaming` flag. Set by the bridge when starting a streaming response so transports can pick the right path; one-shot replies (commands, errors) leave it false and continue to use the simple inline-card send path.

### Added

- `InitFrame.codingAgent` (`{ bin, prefixArgs[] }`)：让 parent 显式指定 IM session 用来拉起 coding-agent 子进程的可执行文件与前置参数。`hostclient/local.Options.BinPrefixArgs` 同步新增。未设置时仍走老路径（`vetta` PATH lookup），保证 `im-gateway start` 独立模式不受影响。Desktop-app 生产环境从此可以传 `process.execPath` + `--agent-rpc` 让 Vetta.app 自身充当 coding-agent CLI 入口，避免再要求用户全局安装 `@vetta/coding-agent`。

### Fixed

- 修复 Discord 连接抖动导致桥接反复中断：网关一次失败的拨号（`Open() error connecting to gateway wss://gateway.discord.gg/..., EOF`）此前会让 `Start` 直接返回错误，host 把它当致命错误关掉整个 sidecar，desktop 再按退避重拉进程——一次网络抖动要付一次完整的进程重建，状态在「在线」与「错误」之间反复跳，且 desktop 的重启计数在每次 ready 后归零，因此不会收敛。现在瞬时拨号失败在 transport 内部以指数退避重试（默认 2s 起、最大 60s、最多 6 次，可经 `Options.Connect*` 覆盖），重试期间响应 ctx 取消与 `Stop()`；token 无效、intent 被拒、要求分片等永久性拒绝仍然立即失败，重试耗尽后照常上报错误，不会把真实的网络不可达藏在「在线」徽标后面。
- 修复 Discord 桥接无法建立连接：网关的 identify 此前请求了特权 intent `MESSAGE CONTENT`，Discord 会对**未在开发者后台打开该开关**的 bot 直接以 websocket close 4014（Disallowed intent(s)）拒绝握手，桥接因此完全连不上。该 intent 对本 transport 毫无必要——它只接受私聊以及群里 @ 机器人的消息，这两种情况 Discord 本就免特权下发消息内容——现已从 intent 集合中移除，无需再改动开发者后台配置。新增假 Discord 网关的集成测试重放完整握手（Hello → Identify → Ready → MESSAGE_CREATE），锁死「不得请求特权 intent」与「私聊可端到端到达 handler」两条不变量。
- Discord 握手失败时附带可操作提示：close 4004 指向 bot token 无效，4013/4014 指向 intent 被拒，4011 指向需要分片，不再只给一行裸 websocket 错误。
- 握手超时默认值从 10s 放宽到 30s（`config.DefaultHandshakeTimeout` 与 `hostclient/local` 内置默认值）。
  desktop 宿主用 Vetta.app 自身作为 agent 二进制，应用启动或更新后的**首次** session 要付一次
  Electron + asar 冷启动代价（实测 arm64 Mac ~10s，缓存热了之后 ~1s），10s 预算会正好输掉这场竞速，
  表现为 `handshake timed out after 10s`，且 stderr 停在启动中途（如 `[skills] loaded`）。
- `hostclient/local` 的握手超时错误现在会附带子进程 stderr（`handshake timed out after 10s; subprocess stderr: ...`）。此前只有「subprocess exited during handshake」路径会带 stderr，纯超时（子进程仍存活但不回 get_state，例如 Linux 上子 Electron 卡在 sandbox/GPU 初始化）则把 stderr 整个吞掉，导致无法定位真因。
- Windows desktop host mode now supports `InitFrame.codingAgent.runAsNode`; when set, `hostclient/local` spawns the configured Electron executable with `ELECTRON_RUN_AS_NODE=1`. This lets Windows packaged desktop builds run coding-agent RPC over reliable Node stdio instead of GUI Electron stdio, fixing WeChat/Claw messages failing at `subprocess exited during handshake`.

- 生产环境 IM 发消息报 `exec: "vetta": executable file not found in $PATH`：sidecar 默认从 PATH 找 `vetta`，但打包好的 Vetta.app 没有把 CLI 软链到系统 PATH，所以每条 IM 消息都拉不起 coding-agent。配合 desktop 新增的 `--agent-rpc` CLI mode + 新增的 `InitFrame.codingAgent` 字段，sidecar 会在 IM session 启动时用 desktop 指定的可执行文件，根治。
- WeChat 桥接：服务器返回 `errcode -14`（bot session timeout）时，host 不再把它当成致命 transport 错误退出 sidecar，而是清掉已失效的本地凭据、emit `wechat_unbound` + `awaiting_bind`，让 sidecar 留活；用户下一次点「扫码绑定」可以直接走 `wechat_bind_start` 出新二维码。此前 desktop 会卡在「正在生成二维码…」的转圈，伴随日志 `ilink: bot session timeout, re-login required: session timeout`。
- `host` 模式启动 transport 时存在状态事件竞态：`emitStatus("connecting")` 写在 `t.Start` 的 goroutine 内，而紧接其后的 `emitStatus("online")` 在主 goroutine 同步发出。当 goroutine 被调度晚于主 goroutine 时，最终顺序变成 `online → connecting`，desktop 状态卡在「连接中」即使 transport 已正常工作。改为在主 goroutine 同步 emit `connecting`，再 spawn goroutine 跑 `Start`，保证 `connecting → online` 顺序固定。`rebuildTransport` 路径同样受益。
- Process pool now indexes entries under the session file the agent actually writes to (surfaced via `HostSession.SessionPath()` after handshake) instead of the caller-requested path. The router makes its first forward-to-agent call with an empty `sessionPath` (the agent hasn't run yet, so nothing knows the real `.jsonl`); keying the pool under that empty string caused the second message in a multi-turn conversation to miss the cache, evict the still-live subprocess, and respawn a new one that raced the previous process for the session-file `.lock`. This is what made the WeChat (iLink) bridge reply to the first inbound message and then go silent on every subsequent message — the reopened subprocess either failed with `ErrSessionLocked` or its error reply was swallowed by the transport. The fix also removes an incidental bug where two concurrent callers passing an empty `sessionPath` would share a single pooled entry.
- The IM bridge now forwards `thinking_delta` to users and emits a separate tool-call summary on each `tool_execution_start` without exposing tool results. Feishu receives one interactive card per tool summary, while WeChat receives plain text messages.

### Changed

- Feishu transport now sends one-shot outbound messages (command replies, errors, hints) as interactive cards (card JSON 2.0 with a `markdown` element) instead of plain `text`. LLM markdown output (bold, italic, lists, code blocks, links, etc.) renders properly in the Feishu client. Requires Feishu client ≥ 7.20.
- All slash command replies (`/help`, `/projects`, `/use`, `/new`, `/whoami`, plus error/usage messages and the unknown-command fallback) are now in Chinese and formatted as markdown (headings, bullet lists, inline code, bold) so they render nicely on top of the new card pipeline.
- Feishu transport now streams LLM output via the cardkit OpenAPI (`Cardkit.V1.Card.Create` + `Cardkit.V1.CardElement.Content` + `Cardkit.V1.Card.Settings`). The bridge's edit-in-place path is enabled for Feishu (`Capabilities.SupportsMessageEdit=true`) and translates to: provision a streaming card → send an interactive message that references its `card_id` → push incremental content updates with a monotonic per-card sequence → flip `streaming_mode` off on `EndStream`. Users see a typewriter-style streaming reply in the same bubble instead of one big block at the end.
- 微信「正在处理」提示改用原生「对方正在输入中…」状态：删除手动推送的占位消息「👀收到，vetta正在处理...」，deferred 路径改为在回合运行期间通过原生 typing 指示器表达处理中状态。新增 iLink `getconfig`（取 `typing_ticket`）与 `sendtyping`（status 1=typing/2=cancel）两个接口，`Client.SendTyping` 按 peer 缓存 ticket、发送被拒时自动失效重取；`wechat.Transport.ShowTyping` 不再是 no-op，发送 typing 脉冲且不占用发送配额。bridge 在 deferred 模式下以 5s 心跳(`TypingHeartbeatInterval`)重发 typing（指示器服务端寿命短，需低于其上限重发），回合结束前停心跳再发 digest，避免回复落地后指示器还残留一个心跳周期。移除 `DeferredAckText` / `DeferredAckDelay` 及 ack timer。
- 活动回合消息折叠（ADR-0010）：同一会话连发的多条消息不再各自触发一轮 agent、各回一组消息。router 改为按「本回合是否已答复（agent_end）」聚合，完全不依赖时间间隔：冷启动 acquire 窗口内到达的消息并入首个 prompt；prompt 发出后到 agent_end 之间到达的消息以 `streamingBehavior:"steer"` 折叠进正在运行的 agent（保留已做工作，飞书在同一气泡续写）。结果是连发消息聚合成一轮、只产出一组回复，且 agent 未答复前用户可一直打断补充。slash 命令只在无活动回合时解析。`bridge.Run` 从阻塞队列消费改为独立 goroutine，会话处理循环 `select{ 队列, bridge 完成 }` 驱动状态机。
