# 156：RPC 可取消长操作作用域与选择性 Drain

## 目标

第 154、155 阶段分别补齐了行处理器 drain 和后台 prompt 所有权，但 RPC Mode 的关闭顺序仍可能被同步等待型长命令卡住：
`compact`、`flush_memory`、`bash` 都在行处理器中等待完成，而 transport cleanup 又先等待全部行处理器，再 dispose Session。

本阶段建立一个只属于 RPC transport 的长操作取消域，在不改变会话事务语义的前提下消除该互相等待。

## 基线与问题

旧关闭顺序是：dispose Bridge、等待行处理器、必要时 abort 后台 prompt、dispose Session。若一个行处理器正在等待只有
Session 才能取消的 Bash、压缩或 Memory Flush，cleanup 无法进入 Session dispose；操作又不会自行结束，形成生命周期死锁。

自动重试还有一个较小但同类的所有权缺口：退避结束后通过 `setTimeout(0)` 启动 `agent.continue()`，但该 timer 没有被
`RetryController` 保存，`abortRetry()` 无法阻止已经排队、尚未执行的续轮。

## 实施内容

### Transport 长操作取消域

RPC Mode 创建私有 `AbortController`，并通过 Dispatcher 选项把同一个 signal 只传给以下 Capability：

- `RpcContextCapability.compact`；
- `RpcMemoryCapability.flushMemory`；
- `RpcBashCapability.execute`。

关闭事务现在先 dispose Bridge，再 abort transport 长操作，随后 drain 行处理器。普通状态读取仍完整 drain；
`new_session`、`switch_session`、`fork` 等会话事务没有接收该 signal，因此保持第 154 阶段的完成语义。

这不是通用 Middleware 或全局任务调度器。signal 只表达“该 RPC transport 已经不存在，依赖其响应通道的长命令应收敛”。

### Legacy 与 Greenfield 适配

Legacy 适配器把 signal 映射到既有能力：

- 手动压缩由 `CompactionController` 将外部 signal 转发到内部压缩控制器；
- Memory Flush 将 signal 继续传给既有 `flushMemoryBeforeRollover` / 模型调用；
- Bash 在 signal abort 时调用既有 `abortBash()`，并在操作结束后移除监听。

Greenfield IM 适配器只需把 signal 传给已经支持取消的 Runtime Memory Flush 端口。没有引入后端类型判断，也没有改变
Capability Profile。

### Retry timer 所有权

`RetryController` 现在保存退避结束后创建的 continuation timer。`abortRetry()` 会：

1. 中止仍在进行的退避 sleep；
2. 清除尚未执行的 continuation timer；
3. 在 timer 阶段被取消时复位 attempt，并发出既有 `auto_retry_end` 取消事件；
4. 解除 `waitForRetry()` 的等待。

已进入 `agent.continue()` 的调用仍由 Agent/Session 的既有 abort 合同负责，本阶段没有增加第二套 Turn 控制器。

## 真实 CLI 与安装产物合同

测试先完成一轮真实 Provider prompt，建立可供 Memory Flush 使用的 Session 上下文；第二个 Provider 请求保持连接，随后关闭
RPC stdin。Legacy 与 Greenfield IM 都必须满足：

- held Memory Flush Provider 请求被关闭；
- `flush_memory` 产生唯一成功响应并按 best-effort 合同返回零写入；
- 进程以 code 0 退出；
- `.lock` 与 `.owner.lock` 全部释放。

独立安装 CLI 产物复用同一场景，验证 signal、适配器和 cleanup 顺序均进入单文件可执行产物，不依赖源码工作区旁路。

## 测试

- RPC Dispatcher/Mode 与 RetryController 定向测试：15 项通过；
- 真实 CLI Memory Flush 关闭差分：Legacy、Greenfield IM 均通过；
- 独立安装 CLI Memory Flush 关闭场景通过；
- 相关完整 CLI 差分与安装产物测试通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

另外执行了完整 `coding-agent` 包测试作为扩大审计：962 项通过，81 项失败。失败集中在本阶段未修改的 Windows 路径/换行、
本机用户级 Skill/资源发现、模型目录、旧测试 mock 与 shell 命令等既有基线。本阶段新增和定向执行的 RPC、Retry、Greenfield
Adapter、真实 CLI 与安装产物测试均通过，因此没有为消除这些无关失败扩大修改范围。

## 类型校验选择

本阶段只扩展内部 TypeScript Capability 签名并传递原生 `AbortSignal`，没有新增不可信 JSON、配置或持久化解析边界，因此不引入
TypeBox/Zod。RPC 外部输入仍由现有 Frame Validator 校验。

## 明确未修改

- 未改变 RPC 命令集合、Profile、成功/失败帧格式；
- 未改变 prompt 即时 ack 或后台 Turn 合同；
- 未把所有 RPC 命令串行化；
- 未取消会话切换、Fork 或普通读命令；
- 未改变 Bash、压缩、Memory Flush 的业务功能；
- 未改变 Provider、Tool、Skill、MCP、知识、Extension 或会话格式；
- 未建立通用后台任务调度器。

## 结果

RPC transport 现在拥有其同步等待型长操作的取消权。关闭时先让这些操作结束，再 drain 已接收行处理器和 dispose Session，避免
cleanup 与长命令互相等待；会话事务仍保持完整执行。Retry continuation timer 也回到创建它的 Controller 管理。

## 下一步

下一阶段应继续审计 Session dispose 的长生命周期资源，优先处理 `BackgroundTaskManager.killAll()` 只发出终止但不等待子进程
close 的缺口，并核对 MCP Supervisor、Subagent 与 Extension shutdown Promise 是否有明确的 awaitable owner。仍应逐类建立
真实进程资源基线后再修改，不抽象成统一全局任务框架。
