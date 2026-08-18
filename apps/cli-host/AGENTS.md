# Team: Runtime

> 本包属于 **Runtime Team**，同组包：`runtime-core`、`runtime-mcp`、`runtime-storage`、`runtime-telemetry`、`runtime-tools`

## 职责范围

**终端宿主，不是 Agent 本身。** 本包只负责命令分发、进程生命周期与 binary 打包；
交互式 TUI 在 `packages/coding-agent/src/modes/interactive/`，Agent Loop 在 `packages/agent`。
在这里找「对话界面怎么渲染」「工具怎么执行」会找错地方。

承载三类入口：

- **命令分发** — `vetta` 顶层命令下的 `action` / `debug` / `agent` 子命令
- **Agent 运行时包装** — 把参数与宿主能力交给 `@vetta/coding-agent`，含 print 模式与 Runtime 选择
- **RPC sidecar** — `vetta-agent-rpc`，由 `apps/desktop` 与 `apps/im-gateway` spawn 的 headless 进程

## 关键模块

- `src/cli.ts` / `src/run-cli.ts` — 顶层命令入口与子命令分发
- `src/agent-cli.ts` / `src/run-agent-cli.ts` — Agent 入口，按 intent 决定是否进入 RPC 模式
- `src/agent-rpc-cli.ts` 与 `src/rpc/` — RPC sidecar 入口与 runtime host 装配
- `src/action-command.ts` / `src/debug-command.ts` — GUI Action 与 Debug 能力的终端入口
- `scripts/compile-standalone.mjs` — 独立可执行文件的**唯一**编译入口（见 `check-standalone-cli-build` 守卫）

## 注意事项

- bin 名 `vetta` / `vetta-agent` / `vetta-cli-app` / `vetta-agent-rpc` 与包名解耦，改包名不要跟着改 bin
- 打包后 sidecar 落在 `<Resources>/cli-app/`，该目录名是打包布局约定，与本包目录名无关
- 依赖 `@vetta/coding-agent`、`@vetta/runtime-*`；不得反向依赖 `@vetta/desktop`

## 测试要求

- 使用 Vitest Node 测试命令参数、stdout/stderr、退出码、信号/取消、初始化失败和资源关闭；进程级行为使用可控子进程或已安装制品测试，不调用真实 Provider。
- CLI 参数、默认值、输出格式、RPC 或 Runtime 选择变化时必须更新相应合同测试，并运行 `bun run verify:runtime-contract`。
- 入口、package exports、bin 或构建制品变化时必须运行 `bun run verify:artifact:installed`；无运行时逻辑的薄导出变化可以不新增单测，但不能省略制品/类型验证。
