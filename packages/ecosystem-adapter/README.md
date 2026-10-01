# @astravia/ecosystem-adapter

外部 Agent 生态兼容层。包内的通用能力与具体生态 profile 分离：

- `@astravia/ecosystem-adapter/hooks`：Hook 领域模型、调度器和命令执行器。
- `@astravia/ecosystem-adapter/codex/hooks`：版本化 Codex Hook 配置与协议语义。
- `@astravia/ecosystem-adapter/claude-code/hooks`：版本化 Claude Code Hook 配置与协议语义。

根导出提供 `createEcosystemHookRuntime()`。运行时只依赖 `EcosystemHookAdapter` 接口，负责统一的 session/turn 状态、多 adapter 聚合和 Stop 安全阀；默认注册 Codex 与 Claude 两个 adapter。通过 `adapterFactories` 可替换默认集合，通过 `additionalAdapterFactories` 可追加其他生态实现，调用方生命周期无需增加新的 `xxHooks` 字段。

Codex profile 只兼容 `C:\github\codex` 提交 `fca51f6dafb106177f23084d16f076ff2f66dd91` 对应的最新版协议，不保留旧版兼容分支。该 profile 覆盖 10 个 Hook 事件、通用 function tool、Bash、MCP、输入改写、结果阻止、压缩生命周期和独立 additional context。PermissionRequest 与 Subagent 生命周期已提供通用运行时边界，是否触发由宿主是否具备真实审批/子代理生命周期决定。

Claude Code profile 固定为 `claude-code-hooks/2.1.211`。它复用通用 dispatcher/executor，但配置 schema、stdin/stdout、matcher 与 exit code 语义独立。首期支持 Astravia 宿主已触发的事件子集与同步 `command` handler；`http` / `prompt` / `agent` 等 handler 产生诊断而不静默执行。

配置发现由宿主通过 `HookConfigLayer` / `buildDefaultHookConfigLayers()` 显式传入。默认构建器（Coding Agent `createAgentSession` 使用）**只在 Astravia 根下镜像官方目录布局**，source 带 `profileId` 防止跨 profile 误读：

**Codex**

1. `~/.astravia/.codex/hooks.json`（`ASTRAVIA_HOME` 可覆盖 astravia 根）
2. `<cwd>/.astravia/.codex/hooks.json`

**Claude Code**

1. `~/.astravia/.claude/settings.json`（`"hooks"` 字段）
2. `<cwd>/.astravia/.claude/settings.json`、`<cwd>/.astravia/.claude/settings.local.json`
3. 插件：显式 `hooks/hooks.json` + `CLAUDE_PLUGIN_ROOT` 或 `profileId: claude-code-hooks/*`

**不读**顶层 `~/.codex` / `~/.claude` 或项目根 `.codex` / `.claude`，避免加载无关官方 hook。文件格式仍与 [Codex Hooks](https://developers.openai.com/codex/hooks)、[Claude Code Hooks](https://code.claude.com/docs/en/hooks) 一致。缺失文件在 discovery 时静默跳过（ENOENT）。配置只在每个 Agent Session 首次触发 Hook 时加载一次。

仍不支持：Codex inline TOML `[hooks]`、自动扫描 Claude marketplace。

调用方也可以通过 `HookConfigLayer.sources` 显式提供 Astravia 已安装插件范围内的 Hook 文件，并为每个 source 注入环境变量。解析器不会自行扫描插件目录；插件 manifest 发现、路径边界校验与信任决策仍属于应用插件加载器职责。

## 测试

Vitest 安装在 monorepo 根 `devDependencies`；本包只保留 `vitest.config.ts` 与 `"test"` script。在包根运行：

```bash
bun run test
# 或指定文件
bunx vitest --run test/default-hook-config-layers.test.ts
```
