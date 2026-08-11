# Vetta Desktop UI 验证

本文说明 Agent 如何通过仓库内的 Playwright CLI 入口验证开发版 Vetta Desktop 的真实 Renderer UI。

仓库入口负责启动隔离的验证实例、发现动态 CDP 端口、维护 Playwright session，并自动选择 `Vetta Desktop` 主窗口。不要在提示词或脚本中写死端口、session 名、tab 下标或 snapshot ref。

Vetta Debug 的会话操作参数见 [Vetta Debug](./vetta-debug.md)。

## 标准流程

所有命令都在仓库根目录执行。

将当前工作树的验证实例作为后台长任务启动：

```powershell
bun run verify:ui:start
```

检查实例和 CDP target：

```powershell
bun run verify:ui:status
```

开始 UI 操作前，状态必须同时满足：

- `running === true`
- `ui.configured === true`
- `ui.reachable === true`
- `ui.targetFound === true`

执行 Playwright CLI 命令：

```powershell
bun run verify:ui:pw -- snapshot
bun run verify:ui:pw -- click "getByRole('button', { name: '按钮名称' })"
bun run verify:ui:pw -- screenshot --filename=vetta-ui.png
bun run verify:ui:pw -- console error
```

`verify:ui:pw` 会在需要时自动附着并选择主窗口。需要单独建立或解除 Playwright 附着时使用：

```powershell
bun run verify:ui:attach
bun run verify:ui:detach
```

完成验证后停止当前工作树的验证实例：

```powershell
bun run verify:ui:detach
bun run verify:ui:stop
```

不要直接调用全局 `playwright-cli`，也不要使用 `close`、`close-all` 或 `kill-all`。

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
