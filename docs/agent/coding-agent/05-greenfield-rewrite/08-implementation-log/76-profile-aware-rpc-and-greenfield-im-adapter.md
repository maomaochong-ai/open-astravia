# 第 76 轮：Profile-aware RPC 与 Greenfield IM Adapter

## 1. 本轮目标

在不改变默认 Legacy RPC/IM 行为的前提下，为 Greenfield Runtime 建立一个能力边界明确的 IM RPC
垂直切片：

- RPC 命令由显式 Profile 声明，不再要求每个 Session Adapter 伪造全部外围能力。
- Greenfield 只承诺 IM 当前实际使用的命令和 wire event。
- Host Bridge Tool、场景激活、会话身份、Memory flush 和资源释放必须 fail closed。

## 2. Profile-aware RPC 合同

新增两个 Profile：

- `legacy-full`：支持现有全部 RPC 命令，Host Bridge 可选。
- `greenfield-im`：只支持 `prompt`、`abort`、`get_state`、`flush_memory`，Host Bridge 必需。

`RpcSessionCapabilities` 的能力组改为可组合能力；启动时根据 Profile 逐命令校验所需能力组。已通过
TypeBox 识别、但不属于当前 Profile 的命令返回明确的 unsupported 响应，不会进入缺失能力，也不会由
空方法返回成功。

`RpcStateCapability.readState()` 改为异步。Legacy Adapter 直接返回已解析 Promise；Greenfield Adapter
则可以组合 Kernel 异步队列状态和同步宿主投影，不需要缓存可能过期的状态。

## 3. Greenfield IM RPC Adapter

`packages/cli-app/src/rpc/greenfield-im-rpc-session-adapter.ts` 位于产品宿主组合层，不进入 Kernel 或
Runtime Core。它负责：

- 将 RPC prompt、steer/follow-up 语义适配到 Greenfield PromptRequest。
- 将 abort 适配到 Greenfield Session cancel。
- 将当前模型、Thinking、流状态、压缩状态、队列模式、sessionId、sessionPath 和消息计数组合成
  `RpcSessionState`。
- 每次 flush 都读取当前活动 `sessionId`，rollover 后不使用初始 ID。
- 订阅稳定 `SessionEvent`，再由独立 IM wire Adapter 输出旧事件形状。
- 顺序释放 Session 后再释放 Composition，避免 Repository、Capability 和 Session 并发关闭。

未实现 Retry、Bash、Export、Command Discovery、new/switch/fork 等 Greenfield 尚未具备的外围功能。
这些命令被 Profile 拒绝，不存在假兼容。

## 4. IM wire 事件适配

`GreenfieldImRpcEventAdapter` 只映射 IM Gateway 实际消费的字段：

- lifecycle -> `agent_start`、`turn_start`、`turn_end`、`agent_end`。
- `message.delta` / `thinking.delta` -> `message_update.assistantMessageEvent`。
- `message.final` -> `message_end`。
- Tool start/update/phase/end -> 旧 `tool_execution_*`。
- Runtime error -> IM 可提取文本的旧 error envelope。
- `session.path_changed` -> `session_path_changed { from, to, reason }`。

Greenfield 稳定事件不包含 Legacy 流式 partial message、turn toolResults 等细节，因此本适配器明确命名为
IM compatibility，不声明为完整 `AgentEvent` 等价适配。

## 5. Host Bridge Tool 与场景

Adapter 初始化时动态注册现有 `im_send_attachment`，dispose 时注销：

- Tool 实现、参数校验、描述和 `host_request` 行为继续复用旧实现。
- Tool 构造通过可注入 Port 隔离，Adapter 测试不依赖预先重建的 workspace `dist`。
- 注册项保留 `scopeUse: ["im-claw"]` 和 `category: "im"`。
- 缺少 Host Bridge 时初始化失败。

Greenfield Composition 新增显式 `scenario`，默认仍为 `cli`，同时用于：

- 默认 Tool activation scope。
- Plugin Session scenario。
- Prompt Runtime scenario。

IM Adapter 构造时校验 Composition 场景必须为 `im-claw`，避免 Tool 注册成功但因 `cli` scope 永远不可见。

## 6. 会话路径与生命周期

新增 Greenfield conversation path 解析边界：

- 只接受配置 Repository 根目录直属的 `*.conversation.jsonl`。
- 校验文件名中的 base64url sessionId 可规范往返。
- 旧 `*.jsonl`、根目录外路径和嵌套路径不会被误认作 Greenfield Session。

RPC 生命周期新增独立、幂等 `dispose()`：

- stdin 关闭时等待 unsubscribe、UI/Host Bridge 和 Session 资源释放完成，再退出。
- 初始化失败也会释放 Adapter 资源。
- `shutdown()` 继续表示协议/Extension shutdown，不能代替资源销毁。
- Legacy Adapter 的 dispose 委托现有 `AgentSession.dispose()`，保留文件锁释放语义。

## 7. 测试

本轮离线目标测试共 22 项通过：

- Coding Agent RPC：16 项。
  - 全命令 Legacy 分发。
  - Profile 外命令拒绝。
  - prompt 异步失败。
  - JSONL、TypeBox、Extension UI、Host Bridge。
  - 初始化失败和 stdin 关闭后的幂等资源释放。
  - Legacy 状态、Memory、Extension shutdown 和 AgentSession dispose。
- CLI Greenfield IM Adapter：6 项。
  - 异步 state 投影。
  - rollover 后 sessionId/path/flush 跟随。
  - Host Tool 动态注册、scope 和注销。
  - Host Bridge 与错误 scenario fail closed。
  - IM 消费事件 wire 映射。
  - Greenfield/Legacy session path 分流。

最终验证：

- `bun run check:quick`：通过。
- `bun run check`：通过；覆盖 Biome、根 `tsgo`、CLI 独立 `tsgo`、Desktop `tsc`、
  Admin `tsc -b` 和质量守卫。

## 8. 明确未修改

- 没有修改默认 `runRpcMode(session)` 的 Legacy 选择。
- 没有新增含义模糊的通用 `--greenfield` 开关。
- 没有把 Greenfield 接入 Desktop。
- 没有修改 IM Gateway Go 命令或事件合同。
- 没有把旧 `.jsonl` 直接当成 Greenfield conversation 文件。
- 没有删除旧 RPC、旧 AgentSession 或任何既有功能。

## 9. 下一步

下一阶段应建立可执行的 Greenfield IM Composition Root，但仍保持显式 opt-in：

1. 复用现有 CLI 参数、模型/凭据、ResourceLoader、Plugin 和 MCP 配置，创建
   `scenario: "im-claw"` 的 Greenfield Composition。
2. fresh session 生成 sessionId；resume 只接受已验证的 `.conversation.jsonl`，旧 `.jsonl` 自动留在
   Legacy 路径。
3. 将 Adapter 交给现有 `runRpcModeWithCapabilities()`，保持 JSONL transport 和 Host Bridge wire 不变。
4. 增加真实子进程差分门禁：握手、prompt、abort、flush、rollover、附件、stdin close 和文件锁释放。
5. 差分通过后只增加 `greenfield-im` 显式选择，默认仍为 `legacy-full`。
