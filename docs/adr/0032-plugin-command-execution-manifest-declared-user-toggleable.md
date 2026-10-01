---
status: accepted
---

# 插件命令执行能力：通用 command.run + manifest 声明 + 用户逐条开关

插件 renderer 与宿主共享 React 单例、无沙箱，但**没有执行外部命令的出口**：`PluginPermission`
里的 `agent.command.run` 一直是占位符（声明了、无对应 API），`ctx.fs.*` 只能读写文件、读不了
`.git` 的 zlib loose object。Git 系统插件要展示 `git status` / `git diff`，以及未来在 App 内置
python / node 运行时，都需要一条「插件触发宿主主进程执行命令」的通道。

决定：新增通用能力 `ctx.command.run(file, args[], opts)`，execFile 语义——**不走 shell、参数以
数组传递**（杜绝字符串拼接注入）、buffered 返回 `{ stdout, stderr, exitCode }`。主进程经新 IPC
用 `node:child_process` 落地。git 只是首个消费者（`run("git", ["status", "--porcelain=v2", ...])`），
python / node 后续复用同一出口，不为各运行时另开专用 API。

安全模型不复用「声明权限 → 用户整体授权」那一层，而是**按命令逐条门控**：

1. **manifest 声明**：插件在 `plugin.json` 显式列出要执行的可执行文件，**粒度 = 二进制名**（如
   `git`，放开其全部子命令）。未声明的可执行一律硬拒。
2. **用户逐条开关**：宿主插件配置页把声明的命令暴露给用户，可逐条勾选 / 关闭。
3. **运行时拦截**：调用一条**被用户关闭**的已声明命令时，宿主拦截并**通知用户**（区别于未声明命令的静默硬拒）。

系统插件（如 Git preset）权限自动全量授予，但用户仍可在此关闭具体命令——命令开关是独立于
权限授予的第二道闸。

被拒方案：

- **git 专用 `ctx.git.*`**：插件端语义最清晰，但与「python/node/git 共用一条通道」的目标冲突，
  会演化成一堆运行时专用出口。
- **二进制粒度之外的子命令 / 命令行模式白名单**：能把只读 Git 面板精确限制在 `git status|diff|log`，
  但模式匹配复杂易误拦，授权 UI 也难向用户表达；取二进制粒度，以简单换可解释性。
- **复用现有 sandbox / full-access 执行模式**（agent 跑命令那套隔离）：最严谨，但接入复杂，且面板
  这类交互式只读场景与之不匹配。
- **纯插件 isomorphic-git over `ctx.fs`**：不改宿主，但 `ctx.fs` 缺 lstat/symlink，且无扩展名的
  二进制 loose object 会被按 utf8 读坏，极脆弱。

后果与已接受的瑕疵：

- 这是把「任意命令执行」能力交给 renderer 插件——靠 manifest 白名单 + 用户开关而非沙箱兜底，
  契合现有「一方 / 策展、经审核上架」的信任模型，不适用于任意第三方不可信代码。
- 落地需扫齐多处注册点：主进程 IPC handler、preload api-types、`@astravia-org/plugin-sdk` 出口、
  `plugin-protocol.ts` 的 `astravia-host://plugin-sdk` shim、权限 / 命令门控、renderer ctx 构建、
  manifest schema 与插件配置页 UI。漏一处会导致插件加载失败且 `check` 抓不到。
- 二进制粒度意味着声明了 `git` 即放开 `git push` / `git reset`；约束改由「用户可关命令」+「插件
  自身只调只读子命令」承担，而非平台强制。
- IPC 契约与 manifest schema 一经发布即被第三方插件依赖，向后兼容成本高，故先以 ADR 固化形状。

已落地的关键形状（首版）：

- API：`ctx.command.run(file, args?, opts?) → { stdout, stderr, exitCode }`，`opts: { cwd?, env?, timeoutMs? }`。
- IPC：`astravia:plugins:command-run`（带 pluginId），执行在 `main/plugins/command-runner.ts`，execFile
  shell=false、timeout 默认 30s/上限 120s、maxBuffer 10MB、env 合并 `process.env`。
- manifest：顶层 `commands: string[]`（二进制名）；存进 `InstalledPlugin.declaredCommands` /
  `grantedCommandNames`。用户插件存注册表、系统插件存 `system-plugin-prefs.json` 的 `disabledCommands`。
- 双重门控：renderer `createCommandApi` 先查权限/声明/授权，命中「已声明但被关」→ 弹全局 toast
  通知用户 +抛错；主进程 `runPluginCommand` 用 live `listPlugins()` 再校验一次（权威闸，防 renderer 快照过期）。
- 配套基建：新增全局 toast（`shared/store/toast-atoms.ts` + `shared/components/ui/Toaster.tsx`），
  作为「命令拦截通知」的载体，亦供后续复用。
