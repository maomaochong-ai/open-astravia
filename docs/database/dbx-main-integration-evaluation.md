# dbx-main 集成技术评估（P7）

> 阶段：P7 数据库集成（蓝图「下一步计划」首项）
> 日期：2026-08-13
> 状态：方案已定案 —— 方案 B + 自有化演进（最小化 Rust），见 §五

## 一、结论摘要

- **目标**：为 Astravia（定位「内置数据库管理能力的 AI 代理」）集成 dbx-main，形成产品核心差异化，并逐步将数据库能力**自有化**。
- **定案**：**方案 B —— 独立进程 + dbx MCP Server（STDIO）+ 自有化演进**。先利用 Astravia 已有的 MCP 客户端基础设施（`runtime-mcp` / `capability-sdk` / 插件 `McpServerContribution`）接入 dbx-mcp，让 AI 代理直接获得 70+ 数据库的查询能力；同步 fork dbx 仓库存档，B2 切换为自建构建，最终实现「构建、分发、修改权自有」（见 §五）。
- **理由**：与「AI 代理」定位咬合最深、安全模型成熟（连接白名单 + 执行模式分级 + SQL 检查）、Apache-2.0 合规（允许 fork / 修改 / 再分发）。**自有化决策（2026-08-13 用户确认）**：方向 = 自有化；引擎层 = 最小化 Rust；产品层 = 深度定制（TS）；fork 存档先记录计划、B1 启动时执行。图形化数据库 UI 作为二期增强而非前置条件。

## 二、dbx-main 概况

| 维度 | 内容 |
|---|---|
| 项目 | [t8y2/dbx](https://github.com/t8y2/dbx)（main 分支，即本评估所指 dbx-main） |
| 定位 | 20MB 轻量跨平台数据库客户端，**70+ 数据库**，离线可用，无遥测 |
| 技术栈 | Tauri 2（Rust 核心 + WebView2/WebKit）+ Vue 3 + TypeScript |
| 核心模块 | `crates/dbx-core`（原生驱动：sqlx 系 / tiberius / redis-rs / mongodb / duckdb 等） |
| 分发形态 | 桌面端（Tauri 原生）、Web 版（dbx-web HTTP 后端 + Docker）、CLI（`@dbx-app/cli`）、**MCP Server（`@dbx-app/mcp-server`）** |
| 扩展机制 | Agent / JDBC（覆盖长尾数据库，需额外 agent + JRE） |
| 许可 | **Apache-2.0**，可商用集成（需保留许可声明） |
| 活跃度 | 2026-04 创建，迭代快（评估时点约 13.6k stars） |

### 2.1 MCP Server 形态（方案 B 的关键）

`@dbx-app/mcp-server` = 小型 Node launcher → 平台特定 **Rust `dbx-mcp` 原生二进制** → `dbx-core`。原生二进制可脱离 Node 直接运行。

- 平台包：`@dbx-app/mcp-darwin-arm64 / darwin-x64 / linux-arm64-gnu / linux-x64-gnu / win32-arm64 / win32-x64`（与 Astravia 目标平台矩阵对齐）。
- **10 个 MCP 工具**：`dbx_list_connections`、`dbx_add_connection`、`dbx_remove_connection`、`dbx_list_tables`、`dbx_describe_table`、`dbx_get_schema_context`、`dbx_execute_query`、`dbx_execute_redis_command`、`dbx_open_table`、`dbx_execute_and_show`。
- **安全模型**：连接白名单 + 三种执行模式（默认最严）+ SQL/Redis/MongoDB 安全检查（每次请求重载策略）+ `dbx_execute_query` 单次上限 100 行。
- 连接配置读取 dbx 存储（也可经 `dbx_add_connection` 工具管理），**dbx 桌面应用无需打开**即可用原生连接。
- 注意：`dbx_open_table` / `dbx_execute_and_show` 依赖 dbx 桌面端在运行，Astravia 场景下默认不启用或降级为 `dbx_execute_query`。

## 三、Astravia 现状与本任务适配点

| 能力 | 现状 | 对 P7 的意义 |
|---|---|---|
| 桌面框架 | Electron 34 + React 19 + Vite + Tailwind | 非 Tauri —— dbx 桌面前端（Tauri IPC）无法直接嵌入，见方案 A 分析 |
| MCP 客户端 | `packages/runtime-mcp`（stdio / http，`loginHttpMcpServer`、`McpServerStatus`） | 原生支持接入 dbx MCP |
| MCP 配置管理 | `capability-sdk` 的 McpServer 管理（list / upsert / enable / remove，STDIO + HTTP 两类） | 可直接落地 dbx-mcp 的注册与管理 |
| 插件体系 | `runtime-core` 的 `McpServerContribution`（插件可贡献 MCP server） | 可将 dbx-mcp 做成内置贡献，随包分发 |
| AI 代理 | `packages/ai` / `agent` / `coding-agent`（含 `core/mcp` 类型） | 数据库能力直接变为 AI 工具，即产品叙事「AI 代理 + 数据库管理」 |

结论：Astravia 已是完整 MCP 客户端，且支持插件贡献 MCP server —— **接入 dbx-mcp 是顺路工程，不是新基建**。

## 四、候选方案对比

### 方案 A：内嵌 WebView（dbx Web 版 UI 嵌入）

- 做法：随包运行 dbx-web（HTTP 后端本地端口），Astravia 内嵌 iframe/BrowserView 加载其 Vue UI。
- 优点：图形化 UI 开箱即用（连接管理、表浏览、SQL 编辑器）。
- 缺点：
  1. dbx 桌面版前端绑定 Tauri IPC，Electron 内只能嵌 **Web 版**，UI 与桌面版有差异；
  2. 需随包维护一个 HTTP 后端进程（端口、生命周期、安全面）；
  3. UI 为 Vue 3，与 Astravia React 设计语言 / i18n 体系双轨维护；
  4. 与 AI 代理核心定位耦合弱，用户感知是「两个应用拼装」；
  5. 20MB 轻量优势消失（Astravia 本身已捆绑 Chromium，此点影响有限）。
- 工作量：中–高。

### 方案 B：独立进程 + dbx MCP Server（STDIO）★ 推荐

- 做法：将 dbx 官方预编译 `dbx-mcp` 二进制随 Astravia 捆绑，经 `McpServerContribution` 注册为 STDIO MCP server，连接管理复用 dbx 存储或 `dbx_add_connection` 工具。
- 优点：
  1. 与「AI 代理」定位天然咬合 —— 数据库能力变成 AI 的工具，正是差异化叙事；
  2. Astravia 基础设施现成（runtime-mcp / capability-sdk / 插件贡献），改动极小；
  3. 官方发布预编译二进制，免 Rust 工具链、免 fork；
  4. 安全模型成熟（白名单 + 执行模式分级 + SQL 检查 + 100 行上限）；
  5. 无遥测、离线可用、Apache-2.0；
  6. 体积可控（dbx-mcp 二进制数 MB 级）。
- 缺点：
  1. 无图形化 UI（连接管理 / 表浏览走 AI 对话或 CLI）；
  2. `dbx_execute_query` 单次 100 行上限（大数据浏览需分页或二期 Web 版）；
  3. Agent/JDBC 长尾库需额外 agent + JRE；
  4. 依赖 dbx 连接存储格式，存在上游演进兼容成本。
- 工作量：低–中。

### 方案 C：桥接（复用 crates/dbx-core 为 Rust 库）

- 做法：引入 dbx-core 为 Rust 依赖，经 Electron N-API 原生插件暴露能力。
- 优点：集成最深、可完全自定义、无外部进程。
- 缺点：
  1. 需将 Rust 工具链纳入当前纯 JS/TS + bun 的构建链，CI/打包复杂度剧增；
  2. dbx-core 是 Cargo workspace 一部分，抽离成本高；
  3. N-API 桥（FFI 序列化 / 线程模型 / 错误处理）需自研；
  4. 维护 fork 与上游同步；
  5. 收益与方案 B 重叠（同样无 UI），工作量最大。
- 工作量：高。

### 对比表

| 维度 | A 内嵌 WebView | B 独立进程 + MCP ★ | C Rust 桥接 |
|---|---|---|---|
| 与 AI 定位契合 | 弱 | **强** | 中 |
| 图形化 UI | 完整 | 无（二期可补） | 需自研 |
| 改动量 | 中–高 | **低–中** | 高 |
| 构建链影响 | 无 | 无 | **引入 Rust** |
| 安全模型 | 自建 | **成熟（dbx 自带）** | 自建 |
| 合规成本 | 低 | 低（Apache-2.0） | 中（fork 同步） |
| 落地周期 | 中 | **短** | 长 |

## 五、定案：方案 B + 自有化路线（最小化 Rust）

**决策记录（2026-08-13，用户确认）**：方向 = 自有化；引擎层 = 最小化 Rust；产品层 = 深度定制（TS）；fork 存档 = 先记录计划，B1 启动时执行。**需求升级（同日，用户明确）**：除 AI 对话操作数据库外，**经典数据库工具界面（连接树/表浏览/SQL 编辑器/结果网格）是核心需求**，入口在 Astravia 应用内（侧边栏常驻），自建 React 实现（不嵌 dbx Web 版）。**产品方向定案（同日，用户确认）**：**经典工具界面与 AI 对话并存互补**——界面负责熟悉的手感（连接/表树/SQL/结果网格），对话负责自然语言能力（查询/分析/schema 感知），双向联动。

**核心原则**：dbx 能力分两层——引擎层（Rust：驱动生态是核心资产，重写不划算）与产品层（TS/JS：占差异化功能的 80%）。自有化 = 继承开源引擎 + 自有产品层，而非从零重写。

**自有化四档阶梯**：

| 程度 | 做法 | 对官方发布物的依赖 | 工作量 |
|---|---|---|---|
| 1 借用 | 捆绑官方二进制 | 依赖 | 低 |
| 2 存档 | + fork 到自有组织（Apache-2.0 允许） | 仍依赖，但有备份 | 极低 |
| 3 自建 | 自 CI 从 fork 构建二进制，可加小修改 | **不依赖**，只依赖 fork 代码 | 中（一条 Rust CI） |
| 4 深度定制 | fork 上改 dbx-core（品牌化、安全策略、专属协议）；产品层（UI/AI/导出/审计）全部 TS 自研 | 完全自有 | 高，可渐进 |

**定案目标：程度 3 + 产品层深度定制（产品面等效程度 4）**。引擎层保持「构建为主、修改为辅」——CI 化后日常不写 Rust；引擎级需求（安全策略、执行限制、协议微调）按功能投入少量 Rust 修改（每项 1–4 周）。

**渐进路线**：

| 阶段 | 内容 | 验证标准 |
|---|---|---|
| B1 MVP | 捆绑官方 dbx-mcp 二进制（sha256 校验）→ 插件注册 STDIO MCP server → 打通「连接数据库 → 查表 → 执行 SQL」AI 流程；**同步 fork dbx 到自有组织存档**（待办，B1 启动时执行） | 本地起 PostgreSQL / SQLite，AI 对话完成建连 + 查询；fork 完成 |
| B2 自有化 | 设置页新增「数据库」面板（连接管理，走 capability-sdk）；schema 上下文注入（`dbx_get_schema_context` 喂给 coding-agent）；**自建构建流水线（fork → CI → 二进制）替换官方二进制**；**经典数据库工具界面 MVP（自建 React：连接列表 + 表树 + 查询面板 + 结果表格，只读）** | 面板可增删连接；AI 能基于 schema 生成 SQL；二进制由自有 CI 产出；**界面入口可用——侧边栏「数据库」连接管理 + 活动面板「数据库」标签页三栏工具（2026-08-15 职责分离调整后口径）** |
| B3 增强 | 引擎小改按需投入（安全策略、执行限制）；经典界面完善（SQL 编辑器高亮、数据编辑、导出、分页）；AI 原生能力（数据洞察/自然语言转 SQL）；评估是否嵌入 Web 版图形 UI | 产品层功能全部自有实现；引擎修改权在手 |

### 5.1 界面入口与页面结构（经典数据库工具界面）

**需求（用户 2026-08-13 确认）**：除 AI 对话外，应用内需有经典数据库工具界面入口，呈现连接/表树 + SQL 编辑器 + 结果网格。

**入口位置（基于现有侧边栏结构，2026-08-15 调整为职责分离）**：~~在侧边栏主区域新增常驻「数据库」项承载三栏工具界面~~（2026-08-15 用户确认调整）：**侧边栏「数据库」常驻项只做连接配置管理**（连接列表 / 新增/编辑/删除 / 测试 / 启用停用 / AI 数据库感知开关，即 B2.4 连接管理与 B2.5 开关的能力，路径 `/database`，icon 用 solar 图标集，i18n key `sidebar.nav.database`）；**三栏经典工具界面迁入活动面板新内置标签页 `database`**（仿 file-tab 注册进 `BUILTIN_ACTIVITY_TABS`，使用流程同文件浏览与预览——点活动面板标签按钮展开）。目的：分清「常驻数据库侧边栏（配置管理，低频·管理视角）」与「三栏经典数据库工具界面（数据工作台，高频·操作视角）」的职责，与文件浏览与预览架构一致。

**页面布局（活动面板「数据库」标签页承载三栏工具，React 自建，挂数据库抽象层；/database 路由仅承载连接管理）**：

```
┌────────────┬─────────────────────────────┐
│ 连接树/表树  │  SQL 编辑器 / 查询面板        │
│（左栏）     ├─────────────────────────────┤
│            │  结果网格（表格，分页）        │
└────────────┴─────────────────────────────┘
```

- 左栏：连接列表 → 展开数据库 → 表树（schema 经 `dbx_list_tables` / `dbx_describe_table` / `dbx_get_schema_context` 拉取）；
- 中部：查询面板（B2 先简单输入框 + 执行，B3 升级为带高亮的 SQL 编辑器）；
- 结果网格：`dbx_execute_query` 返回的数据渲染为表格（B2 只读，B3 分页/排序/导出）；
- **与 AI 对话双向联动**：界面中「让 AI 分析此表」→ 携带 schema 上下文跳转对话；对话中「在界面打开结果」→ **激活活动面板数据库标签页并选中对应连接/表**（2026-08-15 起不再跳转 `/database`；旧深链 `/database?connection=X&table=Y` 不保留兼容，产品未发布无存量用户）。

**i18n 合规**：所有界面文案走 `@astravia/desktop-app` i18n（`labelKey` 机制，见 AGENTS.md 与 ADR 0031），模块级常量不存中文字符串。

## 六、风险与合规

1. **Apache-2.0 合规**：保留 LICENSE / NOTICE 声明，注明修改点；不得暗示上游背书。
2. **上游演进**（2026-04 创建、迭代快）：**fork 存档（Apache-2.0 允许）+ vendored 二进制 + sha256 校验 + 升级走评审流程**；B2 切换自建构建后上游仅作参考，最坏情形（上游关闭）由 fork 接管维护，能力不断供。
3. **凭据安全**：dbx 连接存储的密码明文风险需评估；引导用户使用环境变量/系统钥匙串；MCP 执行模式默认取最严档。
4. **平台矩阵**：dbx-mcp 平台包需覆盖 Astravia 打包目标（win32-x64/arm64、darwin、linux glibc）。
5. **工具边界**：`dbx_open_table` / `dbx_execute_and_show` 依赖 dbx 桌面端，Astravia 场景默认禁用，避免误导。
6. **数据行上限**：`dbx_execute_query` 100 行上限对大数据量场景需在产品文案中说明，或走 B3 分页。

## 七、实施清单

**B1 MVP（先做）**
1. 下载 `dbx-mcp` 目标平台 zip + `SHA256SUMS`，校验后解压入 `packages/desktop-app` 资源目录（随包分发）。
2. **fork t8y2/dbx 到自有组织存档**（Apache-2.0 再分发合规；待办，B1 启动时执行）。
3. 新增/改造插件贡献：注册 STDIO MCP server（`command` = 资源内 `dbx-mcp` 路径），复用 `runtime-core` 的 `McpServerContribution`。
4. 端到端验证：本地 PostgreSQL / SQLite → AI 对话完成「列出表 → 描述表 → 执行查询」。

**B2 自有化（后做）**
5. 设置页「数据库」面板（连接管理，UI 文案走 `@astravia/desktop-app` 的 i18n 约定，见 ADR 0031）。
6. schema 上下文注入：`dbx_get_schema_context` 喂给 coding-agent。
7. 自建构建流水线：CI（如 GitHub Actions）从 fork 构建 dbx-mcp 各平台二进制 → 产物随包分发，替换官方二进制。

**B3 增强（可选）**
8. 引擎小改按需投入（安全策略、执行限制、协议微调）；产品层深度定制（品牌化 UI、导出/审计、AI 原生能力）。
9. 评估 dbx Web 版嵌入（图形化 UI 增强，非前置）。
10. 文档：包 README、蓝图 P7 状态、CHANGELOG（`## [Unreleased]` → `### Added`）。

## 附：信息来源

- dbx 仓库 README / 文档（MCP Server 架构、平台包、安全模型、工具清单）
- Astravia 源码：`packages/runtime-mcp`、`packages/capability-sdk`（McpServer 管理）、`packages/runtime-core`（McpServerContribution）、`packages/desktop-app/package.json`（Electron 技术栈）
- 蓝图《品牌落地蓝图.md》P7 定义
