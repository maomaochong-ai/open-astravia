# 浏览器操作（Browser Use）

把 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)（Apache-2.0）内聚成 Vetta 系统插件，让 Agent 驱动真实浏览器完成网页任务：导航、读页、填表、点击、登录。

设计取舍见 [ADR-0079](../../../../docs/adr/0079-browser-automation-runtime-and-action-gating.md)。

## 结构

```text
scripts/start-browser-mcp.mjs   MCP 入口：就绪则 exec 真 server，未就绪退回 stub
scripts/lib/paths.mjs           插件数据目录解析（wrapper 独占，见下）
scripts/lib/materialize.mjs     策略快照 → agent-browser 原生配置（纯函数）
scripts/lib/resolve-binary.mjs  定位原生可执行文件（托管前缀优先于 PATH）
scripts/lib/version.mjs         最低版本要求与兼容性判定
scripts/lib/stub-server.mjs     未就绪时的最小 MCP server
src/guard/                      PreToolUse 门禁：决策纯函数 + 注册
src/runtime/                    就绪检测与安装编排
src/components/                 工作区视图：使用说明 + 运行时状态
src/config/                     宿主设置 → 策略快照
```

## 工具面

工具走清单式 MCP（`agent.mcpServers` → `.mcp.json`），运行时名 `plugin-browser-chrome`，模型看到的工具形如 `mcp_plugin-browser-chrome_agent_browser_open`。

宿主的插件 MCP 是 **session-local** 的：每个 Agent 会话各起一个 wrapper 进程，wrapper 为自己生成一个 `vetta-` 前缀的 agent-browser session id 并加 `--pin-tab`。因此多个对话共享同一个 Chrome 与同一份登录态，但各自钉住自己的标签页，互不抢导航。

默认 `--tools core`（导航、a11y 快照、常见交互、截图、基础读取）。工具越多占用的上下文越大，扩大范围请在设置里显式改。

## 配置的两个事实源

| 文件 | 谁写 | 内容 |
| --- | --- | --- |
| `runtime.json` | renderer（`ctx.storage`） | 策略快照，来自宿主设置页，**不含任何绝对路径** |
| `agent-browser.json` / `action-policy.json` | wrapper（每次启动重写） | 上游原生 schema，含 profile 与 policy 的绝对路径 |

为什么这么分：宿主给插件命令的环境变量只透传固定白名单，不含 `VETTA_HOME` / `VETTA_CONFIG_DIR`，renderer 因此算不准插件数据目录；而 MCP wrapper 拿到的是完整 `process.env`。**路径解析归 wrapper，策略归 renderer**，两边不互相猜。

改设置只影响新启动的 MCP server，也就是**新会话**；Hook 门禁则是每次调用现读，改完立刻生效。

## 安装

首次使用时在插件面板点安装，实际执行：

1. `npm i -g agent-browser@<锁定版本> --engine-strict=false` —— 走宿主托管的 npm，产物落在已在 PATH 上的 `~/.vetta/runtimes/.npm-global/bin`。
2. 若本机没有系统 Chrome，再执行 `agent-browser install` 下载 Chrome for Testing。第 1 步的输出里能读出本机有没有 Chrome；读不出来时把这一步交给用户决定，不擅自下载几百 MB。

两步都用 `ctx.command.spawn`：`command.run` 被宿主 clamp 在 120s，必然超时。进度靠轮询 `status().recentOutput`。

装好后需要**新建会话**才能拿到真的工具面（静态清单贡献 + 宿主不处理 `tools/list_changed`）。

### 版本要求与已有的全局安装

插件依赖的不只是「有这个二进制」，还包括 `--config` 的配置键与 `--pin-tab` 等开关；旧版本会以
`Unknown command` 立刻退出，表现为**工具面整个消失且没有任何提示**。所以：

- wrapper 启动时先跑一次 `--version` 比对最低版本，不达标就退回 stub server，给出点名版本号的升级引导。
- 二进制解析把**宿主托管前缀排在 PATH 之前**，机器上已有的旧版全局安装（nvm / brew）不会抢先。
- 面板对应有独立的「运行时版本过旧」状态与「升级」按钮；升级只装到 Vetta 自己的运行时目录，
  不改动用户已有的全局安装。

## 安全边界

- 页面内容默认是不可信数据：始终开 `--content-boundaries`，并默认禁用 `eval`。
- 危险动作两层拦：`--action-policy`（daemon 强制）+ `PreToolUse` Hook（宿主强制，给出可操作理由）。
- 域名白名单由 Hook 自行实现——上游的 `--allowed-domains` 与 `--profile` / `--auto-connect` 互斥，本插件的两种浏览器来源都用不了它。它只覆盖被 Hook 订阅的工具名；切换到更大的工具集时，边缘工具由 action-policy 兜底。
- 凭据走 agent-browser 的 auth vault（本机 AES-256-GCM 加密），密码不进 CLI 输出，也不进模型上下文。插件不读、不复制用户真实 Chrome 的 cookie 目录。
- 「连接我已打开的 Chrome」模式下 Agent 与用户共用浏览器实例，能触达用户已登录的任何站点，面板会常驻提示。

## 工作区视图

这个插件没有可操作的界面——真正的入口是对话框。所以工作区视图只做两件事：

1. **使用说明**：能力概览、可一键复制的示例 prompt、与「网页搜索」的区别、默认的安全边界，以及上游出处。
2. **运行时状态与安装向导**：整页唯一的功能区。

早期版本还做过会话/标签页总览、凭据管理与操作日志，已移除：它们依赖上游 CLI 未稳定的 JSON 输出形状，
而「清除登录状态」受限于插件存储沙箱只能清 Cookie 与本地存储，做不到名副其实。门禁本身不受影响，
被拦截的原因仍会作为工具结果回给模型并由它转述给用户。

## 已知限制

- 面板不展示浏览器实时状态（有哪些标签页、登录了哪些站点）。需要时用 `agent-browser session list` /
  `tab list` 自己看。
- 域名白名单只覆盖被 Hook 订阅的工具名；切换到更大的工具集时，边缘工具由 action-policy 兜底。

## 开发

```bash
cd packages/plugins/presets/browser
bun run test     # 纯逻辑单测 + 面板 DOM 测试，不跑真浏览器
bun run check    # tsc --noEmit
bun run build    # 产出 dist/ 与 release/browser-<version>.zip
```

wrapper 的两条路径可以离线烟测：

```bash
# 未就绪 → stub server
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  | env -i PATH=/nonexistent HOME="$HOME" node scripts/start-browser-mcp.mjs
```
