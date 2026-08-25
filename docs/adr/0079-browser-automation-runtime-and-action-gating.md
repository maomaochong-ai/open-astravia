---
status: accepted
---

# 系统插件的运行时按需依赖，与浏览器危险动作的门禁归属

## 背景

「浏览器操作」系统插件内聚 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)，让 Agent 驱动真实浏览器。它带来三个此前仓库没有先例的问题。

**其一，外部原生依赖怎么到用户机器上。** agent-browser 是 Rust 原生二进制，npm 包解包后约 90MB（内含全平台预编译产物），另外在本机没有 Chrome 时还需要下载一份 Chrome for Testing。这两样都不可能进 Desktop 安装包。同时 `ctx.command.run/spawn` 的 `file` 必须字面等于 `plugin.json#commands` 里声明的名字，不接受绝对路径，所以二进制必须落在宿主进程 PATH 上。

**其二，能力面以什么形式暴露给模型。** 最初的实现走清单式 MCP（`agent.mcpServers`）。实测 `--tools core` 是 29 个工具、约 54.8KB 的 JSON Schema（≈13.7k token），`--tools all` 则是 64 个工具、约 29.8k token。上游给**每个**工具都完整重复了一遍全局选项（`allowedDomains` / `extraArgs` / `idleTimeout` / `namespace` / `restore`…），平均每个工具约 470 token，其中大半是重复内容。这份开销是静态清单贡献，**每个会话每一轮常驻**，与用户这轮是否碰浏览器无关。更糟的是职责重叠：`agent_browser_read` 的描述是「Fetch a URL as agent-readable text」，与网页搜索/抓取几乎完全同义，模型在两者之间摇摆。

**其三，危险动作的门禁放在哪。** agent-browser 自带三层防护，但其中两层在 Vetta 的运行形态下不可用：

- `--allowed-domains`（域名白名单 + WebRTC 围栏）与 `--profile`、`--cdp`、`--auto-connect` 在上游是**互斥**的——带 profile 或附着已有浏览器启动时，页面可能在围栏建立前就跑起来，上游因此直接拒绝该组合。而这两种浏览器来源正是本插件仅有的两种模式。
- `--confirm-actions` 的人机确认走 TTY，且上游明确规定非 TTY 时一律自动拒绝。插件 spawn 出来的都是无 TTY 子进程，这条路等价于「全部拒绝」。

## 决策

**1. 系统插件可以把外部原生二进制作为「运行时按需获取的依赖」，获取通道是宿主已有的托管 npm。**

插件在 `plugin.json#commands` 声明 `npm` 与目标二进制名，首次使用时用 `ctx.command.spawn` 执行 `npm i -g <pkg>@<锁定版本>`。产物落在 `~/.vetta/runtimes/.npm-global/bin`，该目录已由 `RuntimeManager.applyEnv()` 前置进主进程 PATH，并且 `createPluginCommandEnvironment` 会透传 `npm_config_registry` / `npm_config_cache`，因此自动复用已配置的镜像源与共享缓存。

必须用 `spawn` 而非 `run`：`run` 被宿主 clamp 在 120s，百兆级下载必然超时。`spawn` 句柄没有流式 stdout，安装进度只能轮询 `status().recentOutput`（约 64KB 环形尾部）。

**2. CLI 型运行时的能力面走 Skill + shim，而不是 MCP 工具面。**

插件贡献一个 Skill（`agent.skillPaths`）和一个随包发布的 CLI shim。模型经由 bash 调用 `node "$SKILL_DIR/scripts/browser.mjs" <agent-browser args>`，shim 再去跑真正的二进制。

常驻上下文从 13.7k token 降到 skill 的名称加描述（约 50 token），完整用法只在命中时展开；超出常用范围的部分直接读上游自带的 `agent-browser skills get core`，不必由本仓库复制一份会过时的命令参考。工具名与网页搜索的语义重叠随 MCP 工具面一起消失，改由 Skill 描述显式区分「拿摘要」与「去站点上把事办了」。

这条决策的适用范围是**本身就以 CLI 为主形态、且命令面很宽的运行时**。工具数量少、需要结构化参数校验、或需要宿主渲染专属卡片的能力，仍然应该走 MCP 或 `agent.tools.register`。

**3. 危险动作门禁由插件自己的 shim 拥有，上游 daemon 的静态策略做纵深防御。**

- 静态层（daemon 强制）：`--content-boundaries`（把页面内容标成不可信）、`--max-output`（防上下文淹没）、`--action-policy`（按类别拒绝 eval / upload / download）。shim 每次调用都会带上 `--config`，因此这层与 argv 解析是否准确无关。
- 动态层（shim 强制）：shim 在**自己的 argv** 上判定，命中越界即拒绝并打印可操作的理由（进 bash 工具结果，由模型转述）。它承担三件上游做不到或不该由上游做的事：域名白名单（绕开上游与 profile / CDP 的互斥限制）、拒绝会顶掉插件策略的托管标志（`--config` / `--session` / `--profile` / `--allowed-domains` / `--cdp` …）、拒绝不该由模型执行的子命令（`install` / `upgrade` 归面板，`chat` / `plugin` / `connect` 会跳出本会话的策略边界）。

为什么不继续用 `PreToolUse` Hook：模型调用的是 bash，Hook 只能拿到一整条 shell 字符串，管道、`sh -c`、变量前缀都能把判定绕过去。shim 解析结构化 argv，判定比解析 shell 更可靠。

门禁做**确定性拒绝**，不做逐次弹窗确认：确认通道要么受 handler 超时约束（用户不在电脑前会把整轮对话拖死），要么走 TTY（shim 没有）。被拦时模型把理由转述给用户，用户改完设置重试即可——设置改动立即生效，因为 shim 每次调用都重读策略快照。

**4. session 由 workspace 根派生。**

MCP 形态下「每对话一个钉住的标签页」是免费的：插件 MCP 是 session-local 的，wrapper 进程天然知道自己属于哪个会话。CLI 形态下每次调用都是全新进程，而宿主不能往 bash 的 spawn 环境里注入对话 id（`agent.*` 清单贡献只有 `systemPrompt` / `skillPaths` / `mcpServers` / `toolPolicy`，`env` 只有 MCP server 配置才有）。因此身份取自 workspace 根（向上找 `.git`，找不到用 cwd）的哈希，配合 `--pin-tab`。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 把二进制打进 preset zip | 三平台产物让安装包膨胀上百 MB，且 macOS 需签名公证、Windows 要处理 SmartScreen；Chrome 仍然得运行时下载 |
| 在 `runtimes/manifest.json` 新增第三个 RuntimeType | 把单个插件的专属依赖写进平台层，与 ADR-0054「不为系统插件开专供后门」的取向冲突 |
| 要求用户自行 `brew install` / `npm i -g` | 系统插件默认启用却开箱不可用，且国内网络下成功率低 |
| 让插件自己下载二进制到插件数据目录 | `command.run/spawn` 只接受清单声明的命令名，绝对路径无法声明；绕开则要自建下载、校验、镜像与 PATH 注入，重复宿主已有能力 |
| 保留 MCP 工具面，只换更小的 `--tools` profile | `core` 已是上游最小的实用档；真正的开销来自每个工具重复一遍全局选项的 schema，换档只能线性缩，换不掉常驻 |
| MCP 与 Skill 两条路径并存、由设置切换 | 门禁、文档与测试都要维护两份，而收益只是照顾一个尚不存在的用户群 |
| 保留 `PreToolUse` Hook，改为解析 bash 命令字符串 | 管道、`sh -c`、变量前缀都能绕过；判定不可靠反而制造安全错觉 |
| 扩展宿主，让插件往 bash 的 spawn 环境注入变量（换取每对话一个标签页） | 要改 `runtime-node` / `coding-agent` 的公共合同，范围远超本插件；先接受 workspace 级共享，确有需要再单独立项 |
| 让 Skill 引导模型自己保管 session 名 | 把关键不变量交给模型自觉，漂一次就裂出一个新浏览器 |
| 只用 agent-browser 自带的安全开关 | 域名白名单与本插件的两种浏览器来源互斥；TTY 确认在无 TTY 子进程下等价于全拒 |
| 复用宿主 `HeavyToolConfirmationLedger` | 它是每会话每工具一次的粗粒度闸，管不了「这一次导航到哪个域名」；且其 heavy 判定要求在工具定义处声明 |

## 后果

- 首次使用需要联网，且要为一次性安装等待；安装引导、失败原因与重试是插件面板的必做部分，不是可选项。
- 二进制版本在插件里锁死。升级 agent-browser 是一次显式的插件改动，需要同时复核 shim 的门禁子命令表、配置 schema 与 action-policy 类别。
- 上游 engines 要求 Node ≥ 24，而宿主托管的是 Node 22；JS 入口只是原生二进制的启动器，实测可跑，安装时显式传 `--engine-strict=false` 以免用户 npmrc 开了严格检查就装不上。
- 安装完成或设置改动后**不需要新建会话**：Skill 是按需展开的，shim 每次调用都重读策略快照并重新物化配置。这比 MCP 形态少了一整类「改了没生效」的困惑。
- 同一项目下的多个对话共享一个浏览器标签页，可能互相抢导航。这是换取上下文收益时明确接受的取舍，Skill 里对模型点明，面板文案也对用户点明。
- shim 的 argv 门禁是 **fail-open** 的：认不出来的子命令一律放行，兜底靠 daemon 侧的 action-policy。因此新增上游子命令时要复核 URL 位置表。
- 门禁的前提是模型走 shim。bash 工具本身不受插件约束，模型原则上可以直接调 PATH 上的 `agent-browser`；此时 `--config` 不会被带上，daemon 的 action-policy 也一并落空。这一点在 MCP 形态下同样成立（二进制一直就在 PATH 上，Hook 只订阅 MCP 工具名），不是本次变更引入的，但也不该被这份文档粉饰成已解决。真正的硬边界仍是执行模式（沙盒 / 全访问）本身。刻意不采用的加固手段是往 `~/.agent-browser/config.json` 写用户级默认：那会连带改变用户自己在终端里的 agent-browser 行为。
