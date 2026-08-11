# 第 75 轮：RPC 宿主反腐层与 Legacy 协议基线

## 1. 本轮目标

在不切换默认生产后端的前提下，解除 JSONL RPC 模式对旧 `AgentSession` 具体实现的直接绑定，为后续
Greenfield RPC/IM Adapter 建立稳定接入点。

本轮只重构架构，不改变有效 RPC 命令、响应、事件、Memory Tool、Host Bridge 或 Extension UI 功能。

## 2. 实施前问题

旧 `runRpcMode()` 同时负责：

- stdin/stdout JSONL 传输。
- 未受校验的 `JSON.parse()` 类型断言。
- 全部命令分发。
- 直接读取和调用 `AgentSession`。
- Extension UI request/response correlation。
- Host Bridge request/response correlation。
- IM attachment Tool 与 memory Tool 注册。
- Extension shutdown 和进程关闭。

因此即使 Greenfield 已经具备 Turn、State、Context 和主动 Memory Controller，也不能安全接入 RPC：
任何直接接线都会重新依赖旧 `AgentSession` 的字段和外围实现。

## 3. 新的分层

```text
RpcJsonlTransport
  -> RpcInboundFrame Validator
  -> RpcCommandDispatcher
  -> grouped RpcSessionCapabilities
  -> LegacyRpcSessionAdapter
  -> AgentSession
```

辅助协议分别由独立协作者持有：

```text
RpcExtensionUIBridge
  -> extension_ui_request / extension_ui_response

RpcHostBridge
  -> host_request / host_response
```

`runRpcMode(session)` 的公开签名和 `main()` 调用保持不变。它只在边界创建
`LegacyRpcSessionAdapter`，再进入通用 `runRpcModeWithCapabilities()`。

## 4. 能力合同

没有创建另一个覆盖所有业务的大型 Session 接口。RPC Adapter 按职责暴露：

- Turn：prompt、steer、follow-up、abort。
- State：RPC 状态和消息投影。
- Model：选择、循环、候选模型与 Thinking。
- Queue：steering/follow-up 模式。
- Context：手动压缩和自动压缩开关。
- Memory：主动 flush。
- Retry：自动重试和中止。
- Bash：执行和中止。
- Session：new、switch、fork、rename、stats、export。
- Command Discovery：Extension、Prompt Template 和 Skill 命令。
- Lifecycle：初始化、事件订阅和 shutdown。

该合同属于 RPC 产品宿主层，没有加入 Runtime Core，也没有让 Kernel 理解 `flush_memory`、JSONL、
Extension UI 或 IM attachment。

## 5. Legacy Adapter

`LegacyRpcSessionAdapter` 是旧 `AgentSession` 的唯一 RPC 适配点，保留：

- 原有 `RpcSessionState` 字段和读取时机。
- prompt 立即成功响应，异步失败随后按同一 request id 输出错误。
- model 查找、remote 标记、cycle 行为。
- session name trim 与空名称错误。
- `get_last_assistant_text` 未定义时的既有 JSON 行为。
- `flush_memory` 的 `{ written }` 响应。
- memory-mode 和 host-bridge Tool 注册条件。
- Extension command context 与 `session_shutdown`。
- 现有事件原样写入 JSONL。

默认 CLI、RPC 和 IM 仍只使用该 Adapter。

## 6. TypeBox 外部边界

本轮在 `JSON.parse()` 之后增加 TypeBox 校验，覆盖：

- 全部 `RpcCommand`。
- `extension_ui_response`。
- `host_response`。

命令 Schema 使用 `Record<RpcCommand["type"], TSchema>` 作为编译期完整性约束；已知命令识别也从同一
Schema Map 派生，避免新增命令时维护两份列表。

校验只存在于不可信 JSONL 输入边界。内部 Dispatcher、Capabilities 和 Adapter 继续使用 TypeScript
合同，不重复使用 TypeBox/Zod。额外字段继续允许，保持协议向前兼容；缺少必填字段的已知 Frame 返回
既有 `command: "parse"` 错误信封。

## 7. 生命周期改进

- JSONL Transport 只负责逐行读取和单行 JSON 输出。
- stdin/transport 关闭时集中取消订阅并释放 UI/Host Bridge pending request。
- Host Bridge pending request 在 timeout、响应和 dispose 三条路径都只完成一次。
- Extension dialog 在 abort、timeout 和 dispose 时完成默认结果，不遗留等待项。
- Extension 请求和 Host 请求继续使用原有 wire shape 与 correlation id。

## 8. 测试

新增 14 项不依赖 API key、真实模型或 `dist` 的合同测试：

- 全部有效 RPC command 经过分组 Capability 分发。
- prompt 立即确认及随后关联失败。
- session name、Memory、Compaction、Bash 和 Session 数据响应。
- 全命令 TypeBox Schema、额外字段、未知命令和 malformed 已知 Frame。
- Extension UI 成功、取消、timeout、dispose 和 fire-and-forget。
- Host Bridge 成功、结构化失败、重复响应、timeout 和 dispose。
- JSONL 行边界、输出边界和重复启动。
- 通用 RPC Mode 的 Frame、事件透传、未知/非法输入与关闭清理。
- Legacy Adapter 的状态、模型、Memory Tool、订阅和 shutdown 委托。

最终验证：

- 新增 RPC 合同：14 项通过。
- 既有真实 provider `rpc.test.ts`：14 项因当前环境没有 provider 凭据而按原条件跳过，测试文件未删除或
  降级。
- `bun run check:quick`：通过。
- `bun run check`：通过；覆盖 Biome、根 `tsgo`、CLI 独立 typecheck、Desktop `tsc`、
  Admin `tsc -b` 与质量守卫。

## 9. 明确未修改

- 没有新增 Greenfield CLI/RPC 开关。
- 没有把 Greenfield Session 注入生产 RPC/IM。
- 没有修改 IM Gateway 命令或 Go wire contract。
- 没有迁移缺失的 Retry、Bash、Export、Command Discovery 等 Greenfield 外围 Port。
- 没有删除旧 `AgentSession`、旧 RPC Client 或真实 provider 集成测试。
- 没有改变默认后端。

## 10. 下一步

下一阶段应实现 Greenfield RPC Capability Adapter 和 IM 必需 Profile，但仍只允许显式 opt-in：

1. 先为 Greenfield 补齐 IM 实际使用的 prompt、abort、state、rename、Memory、事件和 lifecycle Adapter。
2. 将稳定 `SessionEvent` 映射回现有 RPC wire event，特别是
   `session.path_changed -> session_path_changed`。
3. 把 `im_send_attachment` Host Bridge 作为 Greenfield 动态 Tool 来源接入，不能静默缺失。
4. 对 `/new` flush、恢复、rollover path 更新、关闭竞态和文件副作用运行 Legacy/Greenfield 差分。
5. 缺少必需 Capability 时启动 fail closed；完成差分前不提供通用 `--greenfield` 默认入口。
