# Team: Runtime

> 本包属于 **Runtime Team**，同组包：`runtime-core`、`runtime-mcp`、`runtime-storage`、`runtime-telemetry`、`runtime-tools`

## 职责范围

CLI 应用包装器，提供 `vetta-cli-app` 命令行入口。

## 关键模块

- `src/cli.ts` — CLI 入口点（带 shebang）
- `src/index.ts` — 导出 `runCli` 函数

## 注意事项

- 仅 2 个源文件，调用 `@vetta/coding-agent` 的主函数
- 依赖 `@vetta/runtime-core`

## 测试要求

- 使用 Vitest Node 测试命令参数、stdout/stderr、退出码、信号/取消、初始化失败和资源关闭；进程级行为使用可控子进程或已安装制品测试，不调用真实 Provider。
- CLI 参数、默认值、输出格式、RPC 或 Runtime 选择变化时必须更新相应合同测试，并运行 `bun run verify:runtime-contract`。
- 入口、package exports、bin 或构建制品变化时必须运行 `bun run verify:artifact:installed`；无运行时逻辑的薄导出变化可以不新增单测，但不能省略制品/类型验证。
