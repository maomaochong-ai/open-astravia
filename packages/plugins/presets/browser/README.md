# 浏览器操作（Browser Use）

把 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)（Apache-2.0）内聚成 Vetta 系统插件，让 Agent 驱动真实浏览器完成网页任务：导航、读页、填表、点击、登录。

设计取舍见 [ADR-0079](../../../../docs/adr/0079-browser-automation-runtime-and-action-gating.md)。

## 结构

```text
agent/skills/browser-use/
  SKILL.md                      模型看到的用法约定（按需展开）
  scripts/browser.mjs           CLI shim：模型唯一的入口
  scripts/lib/guard.mjs         argv 级门禁（纯函数）
  scripts/lib/session.mjs       workspace 级 session 派生（纯函数）
  scripts/lib/materialize.mjs   策略快照 → agent-browser 原生配置（纯函数）
  scripts/lib/paths.mjs         插件数据目录解析（shim 独占，见下）
  scripts/lib/prepare.mjs       读快照、物化配置落盘
  scripts/lib/resolve-binary.mjs 定位原生可执行文件（托管前缀优先于 PATH）
  scripts/lib/version.mjs       最低版本要求与兼容性判定
  scripts/lib/guidance.mjs      未就绪时给模型的引导文案
src/runtime/                    就绪检测与安装编排
src/components/                 工作区视图：使用说明 + 运行时状态
src/config/                     宿主设置 → 策略快照
```

## 能力面：Skill + CLI，不是 MCP

模型不直接调 `agent-browser`，而是走 shim：

```bash
node "$SKILL_DIR/scripts/browser.mjs" open example.com && node "$SKILL_DIR/scripts/browser.mjs" snapshot -i
```

shim 每次调用做四件事，然后 spawn 真二进制并全量继承 stdio：定位二进制并校验版本 → 物化配置 → argv 门禁 → 拼上 `--config` / `--session` / `--pin-tab`。它不做代理，多一层转发既加延迟，也会在上游演进时变成需要维护的第二个实现。

**为什么不是 MCP。** 实测 `--tools core` = 29 个工具 / 54.8KB schema（≈13.7k token），`--tools all` = 64 个工具（≈29.8k token），且每个工具都完整重复一遍全局选项（`allowedDomains` / `extraArgs` / `idleTimeout` …），平均 470 token/工具。这份开销静态常驻、与本轮是否用浏览器无关。此外 `agent_browser_read`（"Fetch a URL as agent-readable text"）与网页搜索语义高度重叠，模型会在两者之间摇摆。改成 Skill 后常驻只剩名称与描述（约 50 token）。

超出常用命令的部分不在 SKILL.md 里重复，直接读上游自带的参考：`skills get core` / `skills get core --full` / `skills list`。上游 CLI 与它的技能文档同版本发布，不会漂。

## session 与标签页

shim 自己决定 session 名：取 workspace 根（向上找 `.git`，找不到用 cwd）的哈希，加 `vetta-` 前缀，并带 `--pin-tab`。

代价是**同一项目下的两个对话共享同一个标签页**，可能互相抢导航。这是刻意接受的取舍：宿主不能往 bash 的 spawn 环境注入对话 id（清单的 `agent.*` 贡献里只有 MCP server 配置能带 `env`），而让模型自己保管 session 名会把关键不变量交给模型自觉。

## 配置的两个事实源

| 文件 | 谁写 | 内容 |
| --- | --- | --- |
| `runtime.json` | renderer（`ctx.storage`） | 策略快照，来自宿主设置页，**不含任何绝对路径** |
| `agent-browser.json` / `action-policy.json` | shim（每次调用重写） | 上游原生 schema，含 profile 与 policy 的绝对路径 |

为什么这么分：宿主给插件命令的环境变量只透传固定白名单，不含 `VETTA_HOME` / `VETTA_CONFIG_DIR`，renderer 因此算不准插件数据目录；而 shim 拿到的是完整 `process.env`。**路径解析归 shim，策略归 renderer**，两边不互相猜。

因为 shim 每次调用都重读快照，**改设置立即生效，不需要新建会话**。

## 安装

首次使用时在插件面板点安装，实际执行：

1. `npm i -g agent-browser@<锁定版本> --engine-strict=false` —— 走宿主托管的 npm，产物落在已在 PATH 上的 `~/.vetta/runtimes/.npm-global/bin`。
2. 若本机没有系统 Chrome，再执行 `agent-browser install` 下载 Chrome for Testing。第 1 步的输出里能读出本机有没有 Chrome；读不出来时把这一步交给用户决定，不擅自下载几百 MB。

两步都用 `ctx.command.spawn`：`command.run` 被宿主 clamp 在 120s，必然超时。进度靠轮询 `status().recentOutput`。

`install` 与 `upgrade` 在 shim 里是被拒绝的子命令——它们归面板，模型不该自己去下几百 MB。

### 版本要求与已有的全局安装

插件依赖的不只是「有这个二进制」，还包括 `--config` 的配置键与 `--pin-tab` 等开关；旧版本会以 `Unknown command` 立刻退出。所以：

- shim 每次启动先跑一次 `--version` 比对最低版本，不达标就打印点名版本号的升级引导并以退出码 2 结束。
- 二进制解析把**宿主托管前缀排在 PATH 之前**，机器上已有的旧版全局安装（nvm / brew）不会抢先。
- 面板对应有独立的「运行时版本过旧」状态与「升级」按钮；升级只装到 Vetta 自己的运行时目录，不改动用户已有的全局安装。

## 安全边界

- 页面内容默认是不可信数据：始终开 `--content-boundaries`，并默认禁用 `eval`。
- 危险动作两层拦：`--action-policy`（daemon 强制，shim 每次都带 `--config`）+ shim 的 argv 判定（给出可操作理由）。
- shim 拒绝会顶掉插件策略的托管标志（`--config` / `--session` / `--profile` / `--allowed-domains` / `--cdp` / `--auto-connect` / `--no-pin-tab` …），以及会跳出本会话策略边界的子命令（`chat` 另起模型循环、`plugin` 运行第三方代码、`connect` 改浏览器来源、`mcp` 已无意义）。
- 域名白名单由 shim 自行实现——上游的 `--allowed-domains` 与 `--profile` / `--auto-connect` 互斥，本插件的两种浏览器来源都用不了它。
- 凭据走 agent-browser 的 auth vault（本机 AES-256-GCM 加密），密码不进 CLI 输出，也不进模型上下文。插件不读、不复制用户真实 Chrome 的 cookie 目录。
- 「连接我已打开的 Chrome」模式下 Agent 与用户共用浏览器实例，能触达用户已登录的任何站点，面板会常驻提示。

退出码：`2` 运行时未就绪，`3` 被门禁拦下，其余透传自 agent-browser。

## 工作区视图

这个插件没有可操作的界面——真正的入口是对话框。所以工作区视图只做两件事：

1. **使用说明**：能力概览、可一键复制的示例 prompt、与「网页搜索」的区别、默认的安全边界，以及上游出处。
2. **运行时状态与安装向导**：整页唯一的功能区。

早期版本还做过会话/标签页总览、凭据管理与操作日志，已移除：它们依赖上游 CLI 未稳定的 JSON 输出形状，而「清除登录状态」受限于插件存储沙箱只能清 Cookie 与本地存储，做不到名副其实。

## 已知限制

- shim 的 argv 门禁是 fail-open 的：认不出来的子命令一律放行，兜底靠 daemon 侧的 action-policy。新增上游子命令时要复核 `guard.mjs` 里的 URL 位置表。
- 门禁的前提是模型走 shim。bash 工具本身不受插件约束，模型原则上能直接调 PATH 上的 `agent-browser`——MCP 形态下同样如此，硬边界是执行模式（沙盒 / 全访问）。
- 面板不展示浏览器实时状态。需要时用 `agent-browser session list` / `tab list` 自己看。

## 开发

```bash
cd packages/plugins/presets/browser
bun run test     # 纯逻辑单测 + 面板 DOM 测试，不跑真浏览器
bun run check    # tsc --noEmit
bun run build    # 产出 dist/ 与 release/browser-<version>.zip
```

shim 的失败路径可以离线烟测（`VETTA_HOME` 指到临时目录，避免写真实插件数据）：

```bash
SHIM=agent/skills/browser-use/scripts/browser.mjs
# 未安装 → 退出码 2 + 安装引导
env -i PATH="$(dirname "$(command -v node)")" HOME="$HOME" VETTA_HOME=/tmp/vh node "$SHIM" open example.com
# 托管标志 → 退出码 3 + 拒绝理由
VETTA_HOME=/tmp/vh node "$SHIM" --session mine open example.com
```
