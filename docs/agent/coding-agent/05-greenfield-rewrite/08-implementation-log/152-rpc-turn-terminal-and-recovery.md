# 152：RPC Turn 终态一致性与失败恢复闭环

## 目标

在第 151 阶段让失败 `TurnResult` 可观察之后，本阶段收紧 RPC Turn 的终态合同，并用真实 Vetta CLI 验证
Provider HTTP 错误、流中断和用户 abort 后的恢复能力。范围只包含终态仲裁和恢复门禁，不增加 RPC 命令、工具、
Extension 能力或会话格式。

## 终态合同

RPC `prompt` 保持既有 fire-and-forget 语义：Dispatcher 先返回 prompt 确认，Turn 随后只能产生一个可观察终态：

- 已进入 Runtime 执行并产生生命周期事件时，以唯一的 `agent_end` 结束；
- 在 Runtime 尚未产生终态事件前失败时，以带原始 prompt ID 的失败响应结束；
- 不允许同一 Turn 同时出现 `agent_end` 和 prompt 失败响应；
- 结束后 `get_state.isStreaming` 必须为 `false`，同进程下一 Turn 和重启恢复都必须可用。

prompt 确认只是命令已接收的 ack，不是 Turn 终态。

## 暴露的问题

真实 Provider 场景中，Legacy 与 Greenfield 对 HTTP 400、SSE 连接中断和 abort 都能回到 idle，并发出一个
`agent_end`。但适配器单元基线暴露了一个更窄的竞态：如果 Runtime 已经发出 `agent_end`，随后又返回失败结果或拒绝
Promise，Greenfield RPC Adapter 会先转发 `agent_end`，再把错误抛给 Dispatcher，因而可能制造第二个 prompt 失败终态。

该问题属于产品 RPC 反腐层的终态仲裁，不应通过修改 Runtime Core、Provider 或公开协议解决。

## 实施内容

### Turn 级终态归属

`GreenfieldImRpcSessionAdapter` 不再使用一个进程级计数器和共享待发送数组，而是为每个活动 Turn Command 建立内部
scope：

- `agent_end` 归属到最早的活动 Turn；
- 终态事件仍延迟到 Turn Command settle 后发送，保持 prompt ack 在前；
- scope 已记录 `agent_end` 时，后续失败结果或 Promise rejection 不再向 Dispatcher 重复抛出；
- scope 没有终态事件时，失败结果和 rejection 仍原样上报。

这是适配器私有实现，没有进入 Runtime Core 或 RPC 公共类型。

### Provider 测试边界

本地 OpenAI Responses 测试服务器增加两个类型化回复：

- `http-error`：返回指定 HTTP 状态和响应正文；
- `disconnect`：可发送部分 SSE 事件后主动断开连接。

它们只服务真实进程测试。这里没有不可信配置解析或公开 JSON 边界，因此没有引入 TypeBox/Zod；使用 TypeScript
判别联合已足够，避免为测试内部控制流增加运行时 Schema。

## 真实 CLI 差分

新增 Legacy/Greenfield 双后端真实 CLI 门禁：

1. Provider HTTP 400 后只有一个 `agent_end`，会话回到 idle，同进程继续成功，重启后再次继续成功；
2. Provider 在输出部分文本后断开 SSE，两端保留相同部分文本、只有一个 `agent_end`，并能执行下一 Turn；
3. 活动流被 abort 后 Provider 连接关闭、只有一个 `agent_end`，同进程和重启后都能继续；
4. 每个场景同时核对实际 Provider 请求次数，避免测试只观察 RPC 表面帧。

## 安装产物

独立安装 CLI 产物新增 Provider HTTP 失败门禁，验证实际编译后的 `vetta agent`：

- 失败 Turn 只有一个终态且状态回到 idle；
- 同一可执行进程可以继续下一 Turn；
- 使用同一会话文件重启后仍可继续；
- 三个 Turn 对应三次真实 Provider 请求。

## 测试

- Greenfield IM RPC Adapter：13 项通过；
- 真实 CLI 终态与恢复 Legacy/Greenfield 差分：3 项通过；
- 独立安装 CLI 产物：7 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

## 明确未修改

- 未新增或修改 RPC/IM/Extension/Runtime Core 公共 API；
- 未改变 prompt fire-and-forget 确认格式；
- 未改变 Provider 重试策略、错误消息或部分流内容保留策略；
- 未改变 Legacy/V2 会话文件格式；
- 未把终态仲裁下沉到通用 Agent 内核；
- 未引入新的生产依赖或运行时 Schema 库。

## 结果

RPC Turn 现在形成“命令确认 → 唯一终态 → idle → 同进程恢复 → 重启恢复”的闭环。失败原因仍可在没有 Runtime
终态事件时通过相关 prompt 响应观察；已经进入 Runtime 生命周期的 Turn 则统一以 `agent_end` 结束，不会因 settle
结果再次制造终态。

## 下一步

下一阶段应盘点剩余 Greenfield IM RPC Profile 命令的会话切换并发语义，重点验证活动 Turn 期间执行
`new_session`、`switch_session` 和 Extension Command 时的失败关闭、所有权锁与终态顺序；仍应优先建立真实 CLI
差分门禁，再决定是否需要修改适配层。
