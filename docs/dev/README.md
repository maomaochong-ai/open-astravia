# Vetta Desktop UI 验证

本文说明 Agent 如何通过仓库内的 Playwright CLI 入口验证开发版 Vetta Desktop 的真实 Renderer UI。

仓库入口负责启动隔离的验证实例、发现动态 CDP 端口、维护 Playwright session，并自动选择 `Vetta Desktop` 主窗口。不要在提示词或脚本中写死端口、session 名、tab 下标或 snapshot ref。

Vetta Debug 的会话操作参数见 [Vetta Debug](./vetta-debug.md)；真实模型、多轮工具和上下文缓存实验见
[Vetta Debug 真实 Provider 实战](./vetta-debug-real-provider-runbook.md)。

## 验证 Profile

所有命令都在仓库根目录执行。三个 Profile 使用不同的 Vetta home、Electron user data、Action RPC endpoint 和 Playwright session，因此可以与普通开发应用同时运行：

| Profile | 用途 | 数据生命周期 |
| --- | --- | --- |
| Fresh | 初始化、首次启动、空状态流程；也是无后缀命令的默认值 | 每次启动创建新的临时 home，从不复用上一次数据 |
| Debug | 反复调试模型和 Agent 流程 | 使用当前工作树专属的 `~/.vetta-ui-debug/<workspace-id>`，重启后保留 |
| Dev | 调试已经由 Desktop `dev` 命令启动的普通开发应用 | 只附着 `~/.vetta-dev`，验证脚本不会启动、同步或停止它 |

Fresh 标准流程：

```powershell
bun run verify:ui:start:fresh
bun run verify:ui:status
bun run verify:ui:pw -- snapshot
bun run verify:ui:stop
```

`verify:ui:start`、`status`、`pw`、`attach`、`debug`、`stop` 继续作为 Fresh 的兼容别名。`start` 会在后台启动实例，等待主 Renderer 的 CDP target 可用并完成 Playwright 附着后才返回；失败会在 120 秒内退出并给出 `logPath`，不再无限等待。

Debug 首次启动时，从 `~/.vetta-dev` 白名单播种模型配置；之后使用自己的持久数据：

```powershell
bun run verify:ui:start:debug
bun run verify:ui:status:debug
bun run verify:ui:pw:debug -- snapshot
bun run verify:ui:debug:debug -- <Debug CLI 参数>
bun run verify:ui:stop:debug
```

Debug 停止后，可以显式同步开发环境当前的模型配置和相关凭据：

```powershell
bun run verify:ui:sync:debug
```

播种和同步只写入净化后的 `agent/models.json`，并复制其中 `credentialRef` 实际引用的 `models/api-key` 加密记录。模型参数和环境变量取密引用会保留，内联明文 key 与命令型取密配置会删除；凭据保持 Electron `safeStorage` 密文，不解密、不输出。首次播种还会生成一份关闭通知、知识库、Quick Panel 和 Appshot 后台能力的安全桌面配置，并只注册当前仓库。以下内容不会复制：会话、锁、Action RPC endpoint、登录态、项目历史、插件、MCP、Skill、调度器、批处理、IM/Webhook 数据和缓存。后续同步不会覆盖 Debug 中已经修改的桌面配置。

要附着已经运行的普通开发应用，先在另一个终端启动 Desktop，再使用 Dev 命令：

```powershell
bun run --cwd apps/desktop-app dev
bun run verify:ui:status:dev
bun run verify:ui:attach:dev
bun run verify:ui:pw:dev -- snapshot
bun run verify:ui:debug:dev -- <Debug CLI 参数>
```

Dev 是 attach-only Profile，没有对应的 `start` 或 `stop`。如果普通开发应用没有运行，命令会在有界超时后失败，不会挂起。

开始 UI 操作前，状态必须同时满足 `running === true`、`ready === true`、`ui.reachable === true` 和 `ui.targetFound === true`。`verify:ui:pw*` 会在需要时自动附着并选择主窗口。不要直接调用全局 `playwright-cli`，也不要使用 `close`、`close-all` 或 `kill-all`。

## 验证闭环

1. 修改代码后运行 `bun run check`（Biome + 类型 + 架构守卫）。逻辑变更再跑 `bun run test:pkg <包名>` 或 `bun run test:changed`。门禁分层见 [quality-gates.md](./quality-gates.md)。
2. Renderer 改动由 Vite HMR 更新；Main 或 Preload 改动需要执行 `verify:ui:stop` 后重新 `verify:ui:start`。
3. 用 `snapshot` 读取当前页面状态，再执行点击或输入。
4. 等待具体业务状态出现或消失，不使用固定长时间 sleep。
5. 同时验证目标内容、路由或弹层状态，避免只断言“点击成功”。
6. 用 `console error` 检查本次操作引入的错误，并按需保存 screenshot 或 snapshot。
7. 验证失败时根据页面证据继续修改，再重复以上步骤。

需要通过 Vetta Debug 创建或继续真实 Agent 会话时，统一经仓库入口调用：

```powershell
bun run verify:ui:debug -- <Debug CLI 参数>
```

Debug 返回值用于验证业务执行结果，Playwright 用于验证结果是否正确呈现在 UI 中，两者不能互相替代。

## Runtime 进程级 Canary

需要验证真实 Desktop 主进程中的生产 Runtime 时，使用隔离 Canary 模式启动：

```powershell
bun run verify:ui:start -- --runtime-canary
bun run verify:ui:status
bun run verify:ui:debug -- runtime-canary
```

`runtime-canary` 会等待 Desktop 把单文件 Vetta CLI 安装到仓库外，再由该产物完成交互会话创建、
继续和列举。它还会通过真实 Scheduler/Batch Service 启动一个自动化会话、一个活动 Batch 会话
和一个受并发限制的排队任务。保持三个消费者活动后，Canary 请求第一代 Desktop 优雅退出，
再启动第二代 Desktop 恢复同一会话、处理遗留的待回答交互并完成一次宿主 MCP Tool Loop。
命令成功返回前会验证：

- 会话文件已经持久化；
- 两代 Desktop 使用不同 PID 且退出码均为 `0`；
- 第二代 Desktop 保留原 session id、session path 和 cwd；
- 宿主 Skill 与 MCP 在第二代进程中重新装配并实际进入模型调用；
- 交互、Scheduler、Batch Session 锁在每次退出后已经释放；
- Batch 排队任务没有在退出期间启动；
- 每代 Debug RPC endpoint 均已删除；
- 本地确定性 Provider 已停止；
- Scheduler 与 Batch Provider 请求没有因重启重复执行。

Canary 使用独立的 `VETTA_HOME`、Coding Agent 目录、Electron user data、工作区和本地 Provider，
不读取或修改用户的真实模型、认证及会话数据。该命令会主动结束两代验证实例；完成后不需要再执行
`verify:ui:stop`。

## 定位和断言规则

- 优先使用可访问角色、可访问名称和明确的容器范围。
- 元素名称应来自操作前的 snapshot，并与当前界面语言一致。
- 页面存在同名元素时，先限定 `navigation`、`dialog`、`aside` 等容器。
- snapshot 中出现文本不等于元素可见；必要时检查 `isVisible()`、bounding box 或实际布局尺寸。
- 页面异步加载时等待目标业务状态，不以首次 snapshot 作为最终结果。
- 不依赖动态端口、tab 下标、snapshot ref、窗口尺寸或当前业务页面。

App Action 写操作会弹出审批 UI。Agent 应先读取当前页面上的实际按钮，再点击对应按钮；不要用额外脚本猜测审批文案或批量自动确认。

## 覆盖范围

CDP 主要覆盖 Electron Renderer。以下内容需要结合 Vetta Debug 状态、持久化数据、主进程日志或专门的 Electron 集成测试验证：

- 原生文件选择器和系统 Dialog
- 系统托盘菜单
- 全局快捷键
- Electron 主进程内部状态
- 外部进程是否真实收到 Hook
