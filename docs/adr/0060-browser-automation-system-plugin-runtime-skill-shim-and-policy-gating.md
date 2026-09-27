---
status: superseded
superseded_by:
  - open-vetta/docs/adr/0088-browser-automation-as-a-foundation-capability.md
  - open-vetta/docs/adr/0090-session-command-environment-injection.md
superseded_at: 2025-09-27
---

# 浏览器自动化系统插件：运行时按需获取 + Skill/shim 能力面 + 双层门禁 + 会话隔离（已废弃）

**当前实现状态（2025-09-27 更新）**：本文档的核心决策已在架构迭代中演进为 **三跳 Foundation Capability 链路**：

```
IPC handler → Plugin Browser Methods → Capability Access Controller
  → Capability Hub (grants + constraints + AbortSignal + audit)
  → Browser Provider → BrowserAutomationService → agent-browser CLI → Chrome 进程
```

关键变化：
- **类型唯一真源在 capability-sdk（TypeBox schema）** — 不再有重复定义的 preload/api-types/browser.ts
- **浏览器自动化是外部进程模型** — agent-browser Rust CLI spawn + CDP 协议，不是 Electron 内嵌 WebView
- **权限检查在 Capability Access Controller 完成** — 通过 grants.ts 映射 browser.runtime.manage / browser.read / browser.interact
- **Skill + CLI shim 路径已废弃** — IPC 直连三跳链路，插件通过 PluginBrowserApi 调用
- **BrowserPanel（activity-panel iframe 预览）是独立链路** — 与 BrowserAutomationService 平行，不升级不合并

完整实现方案见 [deliverables/browser-automation/01-implementation-plan.md](../../deliverables/browser-automation/01-implementation-plan.md)。

**前置依赖**：ADR-0011（托管运行时 + `RuntimeManager.applyEnv()` 全局注入 `process.env`）、ADR-0024（系统插件 preset 体系）、ADR-0032（插件命令执行 `ctx.command.run/spawn` + manifest 声明 + 用户逐条开关）、ADR-0054（系统插件为长驻进程策展 SDK 能力）。

## 背景

「浏览器自动化」让 Agent 驱动真实 Chrome：去站上将事办了——填表单、点按钮、读登录后页面、跨步骤操作。astravia activity-panel 的 [[BrowserPanel]] 是**独立链路**：用户手动开 iframe 预览、agent 不参与，与本决策完全不同，不升级、不合并。

agent-browser（vercel-labs 开源 Rust 原生浏览器引擎）能让 Agent 驱动真实 Chrome 完成「导航 / 快照 / 交互 / 截图 / 读文本」完整链路。astravia 已有 activity-panel 的 BrowserPanel——但那是**用户手动触发、agent 不参与的 iframe 预览面板**（[browser-tab.tsx](file:///Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/desktop-app/src/renderer/domains/activity-panel/builtins/browser-tab.tsx) + [BrowserPanel.tsx](file:///Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/desktop-app/src/renderer/domains/activity-panel/components/BrowserPanel.tsx)），不具备 Agent 可控性。

要实现 Agent 浏览器自动化，需要解决四个此前仓库无先例的问题：

**其一，外部原生依赖怎么到用户机器上。** agent-browser 是 Rust 二进制，npm 包解包后约 90MB（全平台预编译产物），没 Chrome 时还要下载 Chrome for Testing。都不可能进 Desktop 安装包。同时 astravia 的 `ctx.command.run/spawn` 要求 `file` 字面等于 `plugin.json#commands` 声明的名字，不接受绝对路径，所以二进制必须落在宿主进程 PATH 上。

**其二，能力面以什么形式暴露给模型。** 实测 MCP 形态下 29 个工具的 JSON Schema ≈ 13.7k token 常驻上下文（每个工具完整重复一遍全局选项 schema），且与网页搜索语义重叠。需要找一条更轻的暴露方式。

**其三，危险动作的门禁放在哪。** agent-browser 自带三层防护，但 `--allowed-domains` 与 `--profile`/`--cdp` 是互斥的——而这两种浏览器来源正是本插件仅有的两种模式。`--confirm-actions` 走 TTY，插件 spawn 的无 TTY 子进程等价于「全部拒绝」。

**其四，同一项目的多对话如何共享/隔离浏览器标签页。** CLI 形态下每次调用都是全新进程，宿主 bash spawn 环境里无法注入对话 id（`agent.*` 清单贡献没有 `env` 字段）。

## 决策

### 1. 系统插件把外部原生二进制作为「运行时按需获取的依赖」，获取通道是宿主已有的托管 npm

**版本锁死**：`agent-browser@0.34.0`，写死在 `packages/plugins/presets/browser/src/runtime/constants.ts`，不用 `"latest"`。

**首次安装路径**：插件在 `plugin.json#commands` 声明 `npm` + `agent-browser`。首次使用时面板或 Skill 触发：

```
ctx.command.spawn("npm", [
  "install", "--global",
  "agent-browser@0.34.0",
  "--engine-strict=false"
])
```

产物自动落 `~/.astravia/runtimes/.npm-global/bin`。这是因为 `main/runtimes/manager.ts` 的 `RuntimeManager.applyEnv()` 已经：
- 把 `.npm-global/bin` 前置进 PATH
- 注入了 `npm_config_registry`（走 npmmirror 国内镜像）
- 注入了 `npm_config_cache`（复用宿主已有缓存，省重复下载）
- 注入了 `npm_config_prefix`（强制全局安装路径）

**必须用 `spawn` 而非 `run`**：`run` 被宿主 clamp 在 120s，百兆级下载必然超时。astravia 的插件命令系统（ADR-0032）已提供 `ctx.command.spawn`，可返回 handle 无超时限制。

**Chrome 下载独立第二步**：runtime 装完后检查 `agent-browser doctor --json`。若本机已有 Chrome → 跳过；若无 → 面板按钮手动触发 `ctx.command.spawn("agent-browser", ["install"])` 下载 Chrome for Testing（几百 MB，独立第二步避免自动链超时）。

### 2. 能力面走 Skill + CLI shim，不走 MCP 工具面

插件贡献一个 Skill（`agent.skillPaths`）和一个随包发布的 CLI shim：

```
模型 → Skill 描述（~50 token）→ 命中后展开用法
        → bash 调用 node "$SKILL_DIR/scripts/browser.mjs" <agent-browser args>
          → shim 解析 argv → 门禁判定 → spawn 真正的 agent-browser 二进制
```

**为什么不走 MCP**：
- 常驻 token 从 13.7k 降到 Skill 名称 + 描述
- 与网页搜索工具的语义重叠自然消失（Skill 描述显式区分「拿摘要」与「去站点上把事办了」）
- 超出常用范围的命令直接读 agent-browser 自带的 `agent-browser skills get core`，不复制一份会过时的命令参考

**为什么不搞 Capability SDK**：astravia 当前没有这套注册机制。Skill + shim 路径下，主进程的 `BrowserAutomationService` 通过 IPC 暴露给 renderer，Skill 不需要知道 Service 内部实现。

### 3. 危险动作门禁由插件自己的 CLI shim 拥有，daemon 侧的静态策略做纵深防御

**静态层（daemon 强制）**——shim 每次调用都带上 `--config`，与 argv 解析无关：
- `--content-boundaries`：把页面内容标成不可信，防 agent 被诱导读敏感内容
- `--max-output`：限制单次输出上限，防上下文淹没
- `--action-policy`：按类别拒绝 eval / upload / download

**动态层（shim 强制）**——shim 在自己的 argv 上判定：
- **域名白名单**：绕开 daemon `--allowed-domains` 与 profile/CDP 的互斥限制
- **拒绝托管标志**：`--config` / `--session` / `--profile` / `--allowed-domains` / `--cdp` / `--restore` 等由 shim 接管，禁止模型直接传递
- **拒绝越界子命令**：`install` / `upgrade`（归面板）、`chat` / `plugin` / `connect`（跳出会话策略边界）

**为什么不继续用 PreToolUse Hook**：模型调用的是 bash，Hook 只能拿到一整条 shell 字符串，管道、`sh -c`、变量前缀都能绕过。shim 解析结构化 argv，判定更可靠。

**确定性拒绝**，不做逐次弹窗：确认通道要么受 handler 超时约束（用户不在电脑前会把整轮对话拖死），要么走 TTY（shim 没有）。被拦时模型把理由转述给用户，设置改动立即生效（shim 每次调用都重读策略快照）。

### 4. 会话隔离：workspace 根 hash + `--pin-tab`

CLI 形态下每次调用都是全新进程，bash spawn 环境里无法注入对话 id。因此 session id 取自 workspace 根（向上找 `.git`，找不到用 cwd）的哈希：

```
sessionId = `astravia-${hash(workspaceRoot)}`
```

配合 `--pin-tab`：防止 agent-browser 在 tab 被关掉时静默切到同 session 的其他 tab。

**接受的取舍**：同一项目下的多个对话共享一个浏览器标签页，可能互相抢导航。Skill 里对模型点明，面板文案也对用户点明。确有需要再单独立项往「每对话一个标签页」升级。

### 5. 主进程 BrowserAutomationService 编排层（新建，独立于插件层）

```
main/browser-automation/
  browser-automation-service.ts   ← 编排入口：createSession / navigate / snapshot / act / close
  agent-browser-engine.ts         ← CLI shim 之外的直接 spawn 封装（用于 Service 层调用）
  browser-runtime-manager.ts      ← 就绪检查 + 安装编排（复用 RuntimeManager.applyEnv 环境）
  browser-policy.ts               ← 域名白名单 + action-policy 类别判定
  browser-session-registry.ts    ← 会话注册表 + persistent profile 互斥锁
  browser-profile-registry.ts     ← profile 目录分配 + 回收
  browser-process-runner.ts       ← spawn 封装（timeout / stdout/stderr bounded / abort）
  contracts.ts                    ← BrowserEngine / SessionRecord / RuntimePort 接口
  index.ts                        ← 模块出口
  *.test.ts                       ← 单元测试
```

**位置**：在 `main/browser-automation/` 下独立建目录，不归入 capability 子模块——astravia 当前没有 Capability SDK 注册机制。

**环境变量**：browser-process-runner 直接继承全局 `process.env`（RuntimeManager.applyEnv() 已在 main.ts 启动时注入 PATH/npm_config_*），不需要显式 merge 或白名单透传。

**IPC 暴露**：通过 preload `api-types/browser.ts` 类型 → `main/browser-automation/index.ts` 注册 handler。

### 6. 面板 UI：系统插件 workspace view，不占侧边栏

面板只做三件事：
1. **RuntimeSection 状态机**：`checking → missing/outdated/installing-runtime → ready → browser-missing`，按 phase 渲染 dot 颜色、主按钮、安装输出
2. **能力说明区**：四宫格 icon + 快速开始复制按钮
3. **CLI 工作方式**：纯说明文字

不做假的浏览器预览面板——真正的浏览器在后台跑，用户通过 Skill/对话框交互。

面板入口从设置页「更多选项」进（类似 plugin-workbench），`sidebar: false`。

### 7. BrowserPanel 现状保持不变

activity-panel 的 BrowserPanel 是独立的用户手动预览面板（agent 不参与），与 BrowserAutomationService 是两层完全不同的东西。**不合并、不升级**，两条链路平行存在：

| 层 | 谁触发 | Agent 可控 | 实现 |
|---|---|---|---|
| BrowserPanel | 用户手动开 activity-panel browser tab | ❌ | iframe + Jotai atom 存 URL |
| BrowserAutomationService | Agent 通过 Skill 触发 | ✅ | Rust 原生 agent-browser 进程 |

## Considered Options

- **O1 二进制打进 preset zip**：三平台产物让安装包膨胀上百 MB，且 macOS 需签名公证、Windows 要处理 SmartScreen；Chrome 仍然得运行时下载。驳回。
- **O2 在 `runtimes/manifest.json` 新增第三个 RuntimeType**：把单个插件的专属依赖写进平台层，与系统插件 ADR 的「不为插件开专供后门」取向冲突。驳回。
- **O3 要求用户自行 `brew install` / `npm i -g`**：系统插件默认启用却开箱不可用，国内网络下成功率低。驳回。
- **O4 插件自己下载二进制到插件数据目录**：`command.run/spawn` 只接受清单声明的命令名，绝对路径无法声明；绕开要自建下载/校验/镜像/PATH 注入，重复宿主已有能力。驳回。
- **O5 保留 MCP 工具面**：`core` 已是 agent-browser 最小档，每个工具重复全局选项 schema 的开销去不掉；语义重叠也解决不了。驳回。
- **O6 插件 runtime 自己管理 npm 配置环境**：宿主 RuntimeManager 已经配好镜像源+缓存+prefix，重复造轮子还可能漂移（宿主换镜像源时插件没跟上）。采纳复用宿主。
- **O7 BrowserPanel 升级为 agent 可控的预览 → 自动切换自动化模式**：iframe 预览和 Rust 原生自动化是完全不同的链路，共享面板只会让状态机复杂且容易误判。两条链路平行存在。采纳。
- **O8 往 bash spawn 环境注入对话 id 换取每对话一个标签页**：要改 `coding-agent` 的公共合同，范围远超本插件。先接受 workspace 级共享，确有需要再单独立项。采纳。
- **O9 让 Skill 引导模型自己保管 session 名**：把关键不变量交给模型自觉，漂一次就裂出一个新浏览器。驳回。
- **O10 只用 agent-browser 自带的安全开关**：域名白名单与两种浏览器来源互斥；TTY 确认在无 TTY 子进程下等价于全拒。驳回。

## Consequences

- 首次使用需要联网等待安装；安装引导、失败原因、重试是面板必做部分，不是可选项。
- 二进制版本在插件里锁死。升级 agent-browser 是一次显式的插件改动，需要同时复核 shim 的门禁子命令表、配置 schema 与 action-policy 类别。
- agent-browser engines 要求 Node ≥ 24，宿主托管的是 Node 22；JS 入口只是原生二进制的启动器，实测可跑，安装时显式传 `--engine-strict=false`。
- 安装完成或设置改动后**不需要新建会话**：Skill 按需展开，shim 每次调用都重读策略快照并重新物化配置。比 MCP 形态少了一整类「改了没生效」的困惑。
- 同一项目下的多个对话共享一个浏览器标签页，可能互相抢导航。Skill 和面板文案需明确告知。
- shim 的 argv 门禁是 **fail-open**：认不出来的子命令一律放行，兜底靠 daemon 侧的 action-policy。新增 agent-browser 子命令时要复核 URL 位置表。
- 门禁前提是模型走 shim。bash 工具本身不受插件约束，模型原则上可以直接调 PATH 上的 `agent-browser`——此时 `--config` 不会被带上，daemon 的 action-policy 也一并落空。这一点在 MCP 形态下同样成立（二进制一直在 PATH 上），不是本次变更引入的。

## 影响面

| 区域 | 动作 | 说明 |
|---|---|---|
| `main/browser-automation/` | **新建** | ~10 个文件（Service / Engine / RuntimeManager / Policy / SessionRegistry / ProfileRegistry / ProcessRunner / Contracts / index） |
| `packages/plugins/presets/browser/` | **新建系统插件** | preset zip + Skill + CLI shim + 面板 UI |
| `main/runtimes/manager.ts` | **零改动** | 已现成，browser-process-runner 通过继承全局 env 复用 |
| preload `api-types/browser.ts` | **新建** | BrowserSession / BrowserNavigateInput / BrowserSnapshotInput 等类型 |
| `shared/store/atoms.ts` | **零改动** | BrowserPanel 的 browserUrlBySessionAtom 是独立链路 |
| 权限 manifest | **新增** | `agent.command.run` + `agent.command.spawn`（npm + agent-browser） |

## 与 BrowserPanel 的明确边界

```
BrowserPanel（已有，不变）          BrowserAutomationService（新建）
═════════════════════════          ═══════════════════════════
renderer 侧 iframe 预览面板         main 侧 Rust 原生浏览器引擎
用户手动开 tab → 贴 URL             Agent 通过 Skill 触发
agent 不参与                     agent 全程可控
URL 存 Jotai atom                session id 由 workspace root hash 派生
无安全性问题（用户自己看网页）      域名白名单 + action-policy + shim 门禁
```
