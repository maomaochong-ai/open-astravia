# 团队会话创建与首响应优化对比（2026-09-23）

## 结论

在确认真实入口的主要阻塞来自按团队会话目录重复初始化全局 MCP 后，Desktop 已将 MCP 资源拆成应用级和工作区级：内置与不依赖项目根的全局 MCP 在应用启动后预热并跨会话复用；项目 MCP、`${PROJECT_ROOT}` 使用者和显式工作区 MCP 保持隔离。10 秒 MCP 延迟夹具中，优化前模型请求开始为 **10891.5 ms**、首个文本为 **10920.8 ms**；优化后 5 次中位数分别为 **917.4 ms** 和 **931.7 ms**，降幅为 **91.6%** 和 **91.5%**。10.007 秒初始化仍真实发生，但移到了应用启动后的预热阶段。

在 40 个 Skill、840 个资源文件、4 个团队成员、60.7 KB 请求体的**Runtime 受控夹具**中，从创建协调 Runtime 到首个文本增量进入 Runtime 的中位数由 **1386.6 ms** 降到 **756.9 ms**，下降 **45.4%**。优化后的 5 次为 734.1–899.2 ms；本地假 Provider 的完整短响应中位数为 772.7 ms。

更早的原始实现连 `model.request.started` 都需要 4302.7 ms。两轮优化后该边界为 748.0 ms，累计下降 82.6%。第一轮只测到这个边界，没有覆盖请求序列化、HTTP 上传、Provider 首包和首个文本，因此不能代表用户看到响应的时间。

用户随后从“新会话页选择团队并发送”的实际入口观察到“团队正在加载”约 10–11 秒。**此前以这个夹具的低于一秒结果回答该入口的实际耗时是不正确的**：夹具没有经过新会话页路由交接、团队文档/历史列表加载、创建会话 IPC、协调记录持久化、队长准备等待、预加载状态事件转发和 React 绘制。它还替换了外部 Provider。重启 Main 后的真实日志确认：团队会话创建同步等待 MCP source 初始化，单这一段就占 9.174 秒；不能保证真实入口低于一秒。

### 已有 Desktop 日志复核

在用户授权的只读范围内，检查了开发环境 9 月 23 日和 24 日的 Main/Renderer 耗时日志。较早的会话均与“约 10 秒后才开始发送”一致；日志不含截图的会话 ID，不能严格断定其中哪次就是截图。

| 本地时间 | 输入触发 → 协调记录创建 | 输入触发 → 发送 IPC 进入 | 协调 Runtime 内部初始化 |
| --- | ---: | ---: | ---: |
| 21:02 | 11.21 秒 | 11.49 秒 | 0.267 秒 |
| 21:51 | 10.73 秒 | 11.04 秒 | 0.262 秒 |
| 22:23 | 11.71 秒 | 12.03 秒 | 0.293 秒 |
| 09:14（次日，已重启 Main） | 9.77 秒 | 10.07 秒 | 0.229 秒 |

09:14 这次在 09:14:49.377 触发输入，09:14:49.601 开始 MCP source 初始化，09:14:58.775 完成，**耗时 9.174 秒**；两个 MCP 服务均成功就绪，提供 47 个工具和 6 个资源。会话记录在 09:14:59.144 创建，模型请求在 09:15:00.403 才开始；输入触发到模型请求约 11.026 秒，MCP 初始化约占 83%。团队历史列表加载只用 1 ms，Renderer bootstrap 在 39 ms 内完成。重启后的 Main 日志使此前的 MCP 嫌疑成为已证实的主要阻塞点，但当前日志尚未区分两个服务各自的握手、工具与资源发现耗时。

应用启动时确实触发了 MCP 预热，但当前代码只调用 `prewarmMcp({ cwd: DEFAULT_CONVERSATION_CWD })`，并非空闲时预热未来全部工作区。当天启动的默认 scope 预热耗时 21.478 秒。MCP source 缓存按 `cwd + agentDir` 分区，`resolveSessionListCwd()` 只把普通对话子目录归并到默认 scope；团队默认工作区按会话 ID 新建，不在该归并范围。因此这次团队会话在发送时又为自己的工作区初始化了一套 MCP。这是预热没有命中团队路径的直接原因。直接把所有团队会话映射到共同 scope 会改变 MCP 的工作区根和可能的工具访问范围，不能仅为提速如此修改。

这不是 MCP 协议强制的一会话一连接限制，而是当时进程级 `DesktopRuntimeBackendPool` 的缓存键设计。MCP 配置同时来自全局与项目 `.vetta/mcp.json`，还支持 `${PROJECT_ROOT}` 展开；Desktop 向 server 响应的 `roots/list` 也取当前工作目录。因此“整个应用共用一个 MCP 连接”会混合项目配置和工作区根。正确的资源管理边界是：可证明不依赖工作区的 server 由应用级连接池持有，工作区相关 server 继续独立，并在每个会话装配时合并工具视图。实现同时覆盖了工具名冲突、配置刷新、认证 generation 和连接释放。逐 server 的握手、工具与资源发现耗时日志也已加入代码，供重启后的真实入口复核。

22:23 这次复测从输入触发（22:23:54.896）到协调记录创建（22:24:06.606）用时 11.710 秒；到发送 IPC（22:24:06.929）用时 12.033 秒，到 Renderer 收到模型请求事件（22:24:07.853）用时 12.957 秒。团队历史 bootstrap 在 22:23:55.559 就完成，并未阻塞本次发送；队长 Runtime 调用直到 22:24:07.605 才开始。这与前两次一致，证明之前的受控夹具优化没有消除实际入口的固定等待。此时 Renderer 已热更新到分段日志版本，但 Main 日志仍使用旧的 `team session record created` 格式，说明 Main 未加载新增的 MCP 阶段日志；本次无法从日志直接确认 MCP 初始化耗时。

21:51 的会话在 21:51:32.639 收到输入触发，21:51:33.181 进入 Runtime 路由，21:51:43.373 才完成协调记录；队长的 Runtime 调用在 21:51:44.505 才开始。`session initialization trace` 的 0.262 秒只计入内部会话装配，漏掉进入 backend 到该装配开始前的约 10 秒。09:14 的 Main 分段日志已经确认：这一阶段主要在等待 MCP source，同步门闩位于 `DesktopRuntimeBackendPool.createEntry()`；其内部的 `McpServerSupervisor.initialize()` 等待所有服务启动及工具、资源清单发现完成。

### 不调用真实模型的代码复现

在现有团队 Runtime 夹具中，为 MCP source 初始化注入固定 10 秒等待，仍使用本地 HTTP SSE 假 Provider。单次复现从协调 Runtime 创建前计时：会话创建 10218.6 ms、队长就绪 10736.8 ms、模型请求开始 10891.5 ms、首个文本进入 Runtime 10920.8 ms。同样夹具不注入等待时，分别为 185.6、643.0、779.0、809.2 ms。注入的 10 秒几乎原样传递到首个模型请求和首个文本。这证明当前 backend 的同步 MCP 门闩**能够制造**与真实日志相同的形状；仍不证明用户环境中的 MCP 就是唯一实际原因。

`McpServerSupervisor.initialize()` 等待所有启用服务的 `startServer()` 完成，`DesktopRuntimeBackendPool.createEntry()` 又在构造 Runtime 前等待 MCP source。团队默认工作区是按会话 ID 创建的新目录，无法复用普通对话默认目录的 MCP 预热。两个实际 MCP 服务最终均成功就绪，不能将它们视为失败服务而直接降低超时。若其中一个服务确实需要约 9 秒才能就绪，同时要求第一轮模型调用拥有它的工具，那么首次从创建会话到模型请求严格低于一秒在时序上不可能。提前预热可以把等待移到用户发送之前，但用户在选择团队后立即发送时仍可能遇到等待；跳过或延后该服务会改变首轮工具可用性。为区分握手与工具/资源发现，现已增加逐服务阶段耗时诊断；在没有这些耗时之前，不应武断改动启动协议或资源可用时序。

### MCP 资源管理器实现与复测

实现后的所有权如下：

```text
Desktop Runtime Host
  ├─ application MCP source（启动后预热，跨会话复用）
  │    ├─ 内置远程 MCP
  │    └─ 全局且不依赖项目根的 MCP
  ├─ workspace MCP source（按规范化 cwd 隔离）
  │    ├─ 项目 .vetta/mcp.json
  │    ├─ 引用 ${PROJECT_ROOT} 的全局 MCP
  │    └─ resourceScope: "workspace" 的全局 MCP
  └─ session plugin MCP（保持原会话能力选择）
```

应用与工作区 Source 在会话组合时并行刷新；工具同名时工作区覆盖应用层。应用连接不通告 roots，避免把某个会话目录错误地绑定到共享连接；依赖 roots 的全局 server 可声明 `resourceScope: "workspace"`。登录状态变化会创建新的应用 generation，避免未登录时预热的空内置集合在登录后一直沿用。

使用同一套 40 Skill、4 成员、本地假 Provider 夹具，把 MCP 应用初始化固定为 10 秒并在计时前预热。5 次结果为：

| 阶段 | 优化前 | 优化后中位数 | 优化后范围 | 中位数变化 |
| --- | ---: | ---: | ---: | ---: |
| MCP 初始化 | 10000 ms，位于发送链路 | 10007.3 ms，位于启动预热 | 单次预热 | 等待移出发送链路 |
| 协调会话创建 | 10218.6 ms | 201.7 ms | 180.7–304.9 ms | -98.0% |
| 队长 Runtime 就绪 | 10736.8 ms | 761.2 ms | 685.0–951.0 ms | -92.9% |
| `model.request.started` | 10891.5 ms | 917.4 ms | 831.9–1128.2 ms | -91.6% |
| 首个文本增量 | 10920.8 ms | 931.7 ms | 848.1–1146.1 ms | -91.5% |

中位数已低于一秒，但 5 次中有一次为 1.146 秒，因此不能宣称所有运行都严格低于一秒。真实 Desktop 入口还包含 Renderer 路由、IPC 和绘制，必须在 Main 重启并完成应用预热后复测；本轮没有操作用户运行中的实例，也没有调用真实 Provider。

## 真实入口与夹具边界

```text
新会话页提交消息
  → 准备项目目录、暂存 Team handoff、切换路由并绘制页面
  → 并行加载团队文档/历史会话列表
  → create-session-record IPC
  → 创建协调 Runtime、写入绑定与会话记录
  → 后台准备队长 Runtime
  → 更新会话模型设置、发送 send-message IPC
  → 等待队长 Runtime 就绪
  → 装配成员配置与共享上下文
  → Runtime 发出 model.request.started
  → 构造并序列化 Provider 请求、写入 HTTP 连接
  → Provider 收完请求
  → Provider 返回流响应头，Runtime 发出 assistant start
  → 首个 text_delta / toolcall 事件
  → TeamSessionEventHub 转为团队消息流
  → preload IPC 转发
  → Renderer reducer 与 React 绘制
```

此前的夹具只覆盖从“创建协调 Runtime”开始、经 Runtime 到“首个文本增量进入 Runtime”的一部分；它没有测量上述完整入口。新加入的隐私安全分段日志记录 handoff、创建 IPC、协调记录、队长 Runtime、发送 IPC、模型请求及首个公开响应事件，已经在 9 月 24 日的真实运行中对齐。记录只含 ID 和耗时，不含用户消息、凭证或路径。

`model.request.started` 位于 Provider stream 函数调用之前。它能证明凭证、上下文和调用帧已经准备完成，但不能证明请求体已经写完或 Provider 已收到请求。因此界面在这个边界显示“等待模型响应”有事实依据，但这个阶段仍可能包含请求序列化、上传和主进程事件循环竞争。

## 根因

最初实现有三层问题：

1. 协调会话只承担公共账本和标题生成，却按完整 Coding Agent 会话加载 Skill 和插件资源。
2. 队长与所有其他成员几乎同时创建，多个 Runtime 竞争 CPU 和磁盘，使模型请求开始前就花费约 4.3 秒。
3. 第一轮优化把其他成员移到 `model.request.started` 之后加载，但此时请求尚未真正抵达 Provider。在受控夹具中，三个成员的资源扫描继续占用主进程，使请求开始到 Provider 收完请求的中位数达到 535.5 ms；首个文本仍到 1386.6 ms 才进入 Runtime。这证明异步初始化可以与请求竞争事件循环、CPU 和磁盘，但**没有证明**用户所见的 10 秒来自这些成员。

界面原先还根据成员 Runtime 是否存在推断“等待模型响应”，把本地准备误报为模型等待。现在状态由真实 `model.request.started` 事件驱动。

## 实现

- 协调 Runtime 显式关闭 Agent Skill，并使用空的 Plugin 资源集合；标题扩展、持久化和工具合同保持不变。
- 新建团队时只准备队长；明确指定多个目标成员时仍准备这些目标。
- 未使用成员不再从请求开始边界抢占资源。队长完成首个公开响应块（`text_end` 或 `toolcall_end`）后，才在下一次事件循环后台预热其他成员。
- 如果队长在后台预热前立即委派任务，成员执行器会按需准备目标 Runtime，再配置并执行任务，因此不会丢失或延迟到错误的成员。
- Desktop 将真实请求边界投影为团队流事件，Renderer 只在该事件到达后显示“等待模型响应”；首个 assistant 流事件到达后进入正常生成状态。

团队成员调度没有跨会话复用 Skill 或插件对象，也没有关闭成员需要的工具，团队消息、委派、取消、恢复和持久化格式保持不变。只有明确归为应用级的 MCP 连接跨会话复用，其工作区边界与释放规则见上文和 ADR-0133。

## 本轮首响应前后对比

每组运行 5 次，从协调 Runtime 创建前开始计时。Provider 是立即返回 `Ready.` 的本地 HTTP SSE 服务，所以“请求开始 → Provider 收到 → 首个响应”的差值主要反映本地序列化、上传与资源竞争。

| 阶段 | 请求边界后立即加载成员 | 响应块完成后加载成员 | 优化后范围 | 中位数变化 |
| --- | ---: | ---: | ---: | ---: |
| 协调会话创建 | 211.5 ms | 185.3 ms | 176.2–212.6 ms | -12.4% |
| 队长 Runtime 就绪 | 703.7 ms | 628.3 ms | 616.8–740.2 ms | -10.7% |
| `model.request.started` | 848.3 ms | 748.0 ms | 721.3–879.6 ms | -11.8% |
| Provider 收完请求 | 1383.8 ms | 755.1 ms | 730.9–897.9 ms | -45.4% |
| 首个响应事件 | 1385.9 ms | 756.7 ms | 733.5–899.0 ms | -45.4% |
| 首个文本增量 | 1386.6 ms | 756.9 ms | 734.1–899.2 ms | -45.4% |
| 本地短响应完成 | 1415.2 ms | 772.7 ms | 748.9–918.1 ms | -45.4% |
| 全部成员后台就绪 | 1935.3 ms | 1659.2 ms | 1641.4–1874.0 ms | -14.3% |

请求开始到 Provider 收完请求的中位数由 535.5 ms 降到 7.1 ms；请求开始到首个文本增量由 538.3 ms 降到 8.9 ms。这一差值证明**夹具中的**旧等待并不全是模型耗时，后台成员初始化确实干扰了请求与响应链路；不能外推为用户环境中 10 秒的根因。

同一夹具下的普通单成员会话也复测了 5 次：创建中位数 517.3 ms，模型请求开始 643.1 ms，首个响应事件 657.4 ms，首个文本增量 657.8 ms，完整短响应 674.2 ms；没有因团队调度调整发生额外等待。

原始样本见[计时数据](./team-session-startup-optimization-2026-09-23.samples.json)。

## 复现

在仓库根目录运行：

```powershell
$env:VETTA_STARTUP_BENCHMARK_RUNS = '5'
$env:VETTA_TEAM_STARTUP_BENCHMARK = '1'
$env:VETTA_STARTUP_BENCHMARK_MCP_DELAY_MS = '10000' # 可选：模拟慢 MCP 初始化
node scripts/quality/run-vitest.mjs --config apps/desktop/vitest.config.ts --run --maxWorkers=1 apps/desktop/src/main/agent-runtime/session-startup-performance.test.ts
Remove-Item Env:VETTA_STARTUP_BENCHMARK_RUNS
Remove-Item Env:VETTA_TEAM_STARTUP_BENCHMARK
Remove-Item Env:VETTA_STARTUP_BENCHMARK_MCP_DELAY_MS
```

测试使用真实 `RuntimeHost`、Desktop Backend、资源加载、Turn pipeline、请求序列化与本地 HTTP SSE Provider。它记录 Provider 收到请求、首个 assistant 事件、首个文本增量和完整响应；不设置固定毫秒门槛，避免 CI 负载造成偶发失败。

## 验证边界

自动化测试覆盖协调资源排除、队长优先、请求与响应边界、响应完成前不启动无关成员、快速委派按需准备目标成员，以及 Renderer 状态切换。TeamSessionEventHub 对首个响应的投影是同步合同，但受控基准没有启动 Electron 窗口，因此不包含操作系统 IPC 调度、React 绘制和真实 Provider 延迟。未运行 `verify:ui:*`，也未调用真实付费 Provider 或操作用户正在运行的 Desktop。
