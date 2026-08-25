---
status: accepted
---

# 系统插件的运行时按需依赖，与浏览器危险动作的门禁归属

## 背景

「浏览器操作」系统插件内聚 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)，让 Agent 驱动真实浏览器。它带来两个此前仓库没有先例的问题。

**其一，外部原生依赖怎么到用户机器上。** agent-browser 是 Rust 原生二进制，npm 包解包后约 90MB（内含全平台预编译产物），另外在本机没有 Chrome 时还需要下载一份 Chrome for Testing。这两样都不可能进 Desktop 安装包。同时 `ctx.command.run/spawn` 的 `file` 必须字面等于 `plugin.json#commands` 里声明的名字，不接受绝对路径，所以二进制必须落在宿主进程 PATH 上。

**其二，危险动作的门禁放在哪。** agent-browser 自带三层防护，但其中两层在 Vetta 的运行形态下不可用：

- `--allowed-domains`（域名白名单 + WebRTC 围栏）与 `--profile`、`--cdp`、`--auto-connect` 在上游是**互斥**的——带 profile 或附着已有浏览器启动时，页面可能在围栏建立前就跑起来，上游因此直接拒绝该组合。而这两种浏览器来源正是本插件仅有的两种模式。
- `--confirm-actions` 的人机确认走 TTY，且上游明确规定非 TTY 时一律自动拒绝。插件 MCP server 是宿主 spawn 的无 TTY 子进程，这条路等价于「全部拒绝」。

## 决策

**1. 系统插件可以把外部原生二进制作为「运行时按需获取的依赖」，获取通道是宿主已有的托管 npm。**

插件在 `plugin.json#commands` 声明 `npm` 与目标二进制名，首次使用时用 `ctx.command.spawn` 执行 `npm i -g <pkg>@<锁定版本>`。产物落在 `~/.vetta/runtimes/.npm-global/bin`，该目录已由 `RuntimeManager.applyEnv()` 前置进主进程 PATH，并且 `createPluginCommandEnvironment` 会透传 `npm_config_registry` / `npm_config_cache`，因此自动复用已配置的镜像源与共享缓存。

必须用 `spawn` 而非 `run`：`run` 被宿主 clamp 在 120s，百兆级下载必然超时。`spawn` 句柄没有流式 stdout，安装进度只能轮询 `status().recentOutput`（约 64KB 环形尾部）。

未就绪时不阻塞会话：清单里的 `agent.mcpServers` 是静态声明，做不到条件贡献；宿主 `runtime-mcp` 也不处理 `notifications/tools/list_changed`，因此无法先起占位再热切换工具面。插件的 MCP wrapper 在检测不到二进制时改跑一个只暴露单个引导工具的最小 stub server，把「去哪装」变成模型能转述给用户的一句话。

不采用的替代方案见下表。

**2. 浏览器自动化的危险动作门禁由宿主插件 Hook 拥有，上游 CLI 的静态策略只做纵深防御。**

- 静态层（daemon 强制）：`--content-boundaries`（把页面内容标成不可信）、`--max-output`（防上下文淹没）、`--action-policy`（按类别拒绝 eval / upload / download）。
- 动态层（宿主强制）：`ctx.agent.registerHook` 的 `PreToolUse`，用 `toolNames` 精确订阅本插件的 MCP 工具，命中越界即 `block` 并返回可操作的理由。域名白名单在这一层自行实现，绕开上游与 profile / CDP 的互斥限制。

门禁做**确定性拒绝**，不做逐次弹窗确认：hook handler 有超时，用户不在电脑前会把整轮对话拖到超时；而多窗口、后台会话下弹窗归属也难以做对。被拦时模型会把理由转述给用户，用户改完白名单重试即可。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 把二进制打进 preset zip | 三平台产物让安装包膨胀上百 MB，且 macOS 需签名公证、Windows 要处理 SmartScreen；Chrome 仍然得运行时下载 |
| 在 `runtimes/manifest.json` 新增第三个 RuntimeType | 把单个插件的专属依赖写进平台层，与 ADR-0054「不为系统插件开专供后门」的取向冲突 |
| 要求用户自行 `brew install` / `npm i -g` | 系统插件默认启用却开箱不可用，且国内网络下成功率低 |
| 让插件自己下载二进制到插件数据目录 | `command.run/spawn` 只接受清单声明的命令名，绝对路径无法声明；绕开则要自建下载、校验、镜像与 PATH 注入，重复宿主已有能力 |
| 只用 agent-browser 自带的安全开关 | 域名白名单与本插件的两种浏览器来源互斥；TTY 确认在无头 MCP 下等价于全拒 |
| Hook 里 await 插件自建确认弹窗 | handler 超时会 fail-closed 成拒绝，用户离开电脑就等于整轮失败；多窗口下弹窗归属难以做对 |
| 复用宿主 `HeavyToolConfirmationLedger` | 它是每会话每工具一次的粗粒度闸，管不了「这一次导航到哪个域名」；且其 heavy 判定要求在工具定义处声明，MCP 工具没有这个出口 |

## 后果

- 首次使用需要联网，且要为一次性安装等待；安装引导、失败原因与重试是插件面板的必做部分，不是可选项。
- 二进制版本在插件里锁死。升级 agent-browser 是一次显式的插件改动，需要同时复核工具名、配置 schema 与 action-policy 类别。
- 上游 engines 要求 Node ≥ 24，而宿主托管的是 Node 22；JS 入口只是原生二进制的启动器，实测可跑，安装时显式传 `--engine-strict=false` 以免用户 npmrc 开了严格检查就装不上。
- 域名白名单是应用层围栏，不是操作系统级的出口管控；它只覆盖被 Hook 订阅的工具，切换到更大的工具集时边缘工具由 `--action-policy` 兜底。
- 装好之后需要**新建会话**才能拿到真的工具面——这是静态清单贡献 + 无 `tools/list_changed` 支持的直接后果。若日后宿主支持该通知，可以把 stub 升级成能热切换的代理。
