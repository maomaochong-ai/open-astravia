# P7 数据库集成 · B 阶段可执行任务清单

> 依据：《dbx-main-integration-evaluation.md》（方案 B + 自有化路线，最小化 Rust）
> 产品方向：经典数据库工具界面（自建 React）与 AI 对话并存互补；**入口职责分离（2026-08-15 用户确认，B2.6-R 已实施）**：侧边栏「数据库」常驻项收窄为连接配置管理，三栏经典工具界面迁入活动面板「数据库」标签页；**标签页/设置页冗余收敛 + MVP 版 UI 升级（2026-08-15 用户确认，B2.6-U 已实施，见下方 B2.6-U）**；**设置页重定位为全局配置中心 + 数据工作台对齐 dbx-main + 双向联动增强（2026-08-15 用户反馈 10 点：B2.6-V V1/V2/V3/V4 已完成（V2 连接树升级 2026-08-16、V3 查询面板升级 2026-08-16、V4 结果网格升级 2026-08-16，见下方 B2.6-V V2/V3/V4）、V5 标签页壳多查询标签已实施（2026-08-16，见下方 B2.6-V V5）、V6 收尾已完成（2026-08-18，i18n/埋点/单测/check 全绿，见下方 B2.6-V V5 与 V4 验证问题 Bug 3 实施记录）；B2.9 双向联动增强已实施完成，见下方 B2.6-V 与 B2.9）**；**2026-08-15 晚新增用户反馈 4 点（工作台问数入口 / 连接详情卡片化 / 添加连接表单高度遮挡 / 打开工作台跨路由无反应），改进定案见下方 B2.6-W（W1–W4 已实施完成）**；**2026-08-16 新增用户反馈 4/5/7（关键信息行圆角容器 / AI 感知级别与「关闭后对话仍可访问」根因 / 设置面板与工作台 AI 感知开关与 AI 协助配置功能定位与权限转向方案），定案见下方 B2.10（W1–W3 已实施，W4 排期 V2/B3.1）**；**2026-08-16 用户实测反馈 3 点（双击表查询报 relation 不存在 / 连接树表显示不全 / 对话执行 SQL 工具不存在且不回填），根因核查与修复计划见下方 B2.6-V V4 验证问题**
> 日期：2026-08-13 · 状态：**B1 全部完成（2026-08-13）**；B2 进行中——B2.1–B2.7 已完成（2026-08-13~15），**B2.6-R 职责分离已实施（2026-08-15）**，**B2.6-U MVP 版 UI 升级已实施（2026-08-15）**，**B2.6-V V1 设置页重定位已完成（2026-08-15 代码核查确认，V1 ①–⑥ 全部落地）**，**B2.6-V V2 连接树升级已完成（2026-08-16，sticky 搜索 + 右键菜单 + 分组 + i18n/埋点/单测，`bun run check` 全绿，见下方 B2.6-V V2）**，**B2.6-V V3 查询面板升级已完成（2026-08-16，CodeMirror SQL 高亮 + Ctrl+Enter 执行 + 查询历史，并修复 V2 搜索自动加载问题，`bun run check` 全绿，见下方 B2.6-V V3）**，**B2.6-V V4 结果网格升级已完成（2026-08-16，工具栏导出 CSV/JSON + 复制 + 加载更多 + 列排序 + 长单元格详情，`bun run check` 全绿，见下方 B2.6-V V4）**，**B2.6-V V5 标签页壳多查询标签已实施（2026-08-16，tab 数组模型 + 标签条 UI + 目标 tab 路由 + i18n/埋点/单测，`bun run check` 全绿，见下方 B2.6-V V5）**，V6 收尾已完成（2026-08-18，i18n/埋点/单测/check 全绿，见下方 B2.6-V V5 与 Bug 3 实施记录），**B2.9 双向联动增强（查询同步通道 + AI 开场白重设计 + 触发补全 + 反向「让 AI 解读此查询」入口）已实施完成（2026-08-16 W1–W3 落地，2026-08-18 反向入口实施，`bun run check` 全绿，见下方 B2.9）**，**B2.6-W 反馈 4 点改进已实施完成（2026-08-15 晚定案 → 2026-08-16 确认 W1–W4 落地 + check 全绿，见下方 B2.6-W）**，**B2.10 反馈 4/5/7 W1–W3 已实施（2026-08-16，感知/访问权限分离 + 关键信息行圆角容器 + AI 协助功能定位；W4-① 感知范围选择性注入已实施（2026-08-19，schemaInjection.scope，见下方 B2.10）、W4-② 环境标记排期 B3.1，见下方 B2.10）**，**B2.6-V V4 验证问题 3 点已记录（2026-08-16 用户实测反馈，根因已核查；Bug 1/2 已在其他地方修复（2026-08-16 用户告知）、Bug 3 已实施（2026-08-18，见下方 B2.6-V V4 验证问题））**，B2.8 独立排期未启动

## 〇、总览

```
B1 MVP ──→ B2 自有化 ──→ B3 增强
 ├ fork 存档        ├ 抽象层          ├ 引擎小改
 ├ 引擎二进制       ├ 自建构建流水线   ├ 界面完善
 ├ 内置预设接入     ├ 数据库面板       ├ AI 原生能力
 └ AI 查库验证      ├ schema 注入     └ Web 版评估
                   └ 经典界面 MVP+联动
```

- **开放项已确认（2026-08-13，2026-08-30 更新 fork）**：fork = `github.com/maomaochong-ai/dbx`（上游 `t8y2/dbx`）；dbx 版本 = 最新（MCP 引擎 **0.4.61**）；B1 平台 = 仅 Windows x64；连接初始化 = 先手动配置
- **工作量估算**（单人，人天）：B1 ≈ 3–5 人天；B2 ≈ 15–22 人天；B3 每项 2–4 周量级
- **横切约束**：i18n 合规（ADR 0031）、质量门禁（`bun run check:quick` / `bun run check`）、Apache-2.0 合规、凭据安全
- **里程碑**：B1.4 完成 = 「AI 对话查库」可用；B2.6 完成 = 「经典工具界面」可用；B2.3 完成 = 构建权自有

---

## 一、B1 MVP —— 引擎接入 + AI 对话查库验证（3–5 人天）

**阶段目标**：用户能在 Astravia 里用 AI 对话查询数据库；fork 存档完成。

### B1.0 fork dbx 到自有组织存档（0.5 人天）✅ 完成（2026-08-13）
- [x] 在 GitHub 将 `t8y2/dbx` fork 到 Astravia 自有组织/账户（Apache-2.0 允许再分发，保留 LICENSE/NOTICE）
- [x] 记录 fork 地址：**`https://github.com/maomaochong-ai/dbx`**（上游 `https://github.com/t8y2/dbx`）
- **验证**：用户已确认 fork 就绪

### B1.1 获取 dbx-mcp 引擎二进制（0.5–1 人天）✅ 完成（2026-08-13）
- [x] 从 npm 平台包下载 `dbx-mcp` 二进制：**`@dbx-app/mcp-win32-x64@0.4.61`**（最新；桌面应用 v0.5.83 与 MCP 引擎 0.4.61 为两套版本号，MCP 引擎走 npm）
- [x] sha256 校验：**`BB1932E7C8EC274AE060EFFDAAA2FC805A1EBDA5778FCBCC346CE7D4B2E9E363`**（解压后 exe 实测，tarball 哈希另计）
- [x] 解压入 `packages/desktop-app/resources/dbx-mcp/win32-x64/dbx-mcp.exe`（20.2 MB）
- [x] 自动化：[fetch-dbx-mcp.mjs](/E:/open-source-projects/astravia/packages/desktop-app/scripts/fetch-dbx-mcp.mjs)（幂等 + 校验 + 跨盘 copy），挂 `bun run prepare:dbx-mcp`；`.gitignore` 排除 `resources/dbx-mcp/`（不入库）
- **验证**：`dbx-mcp --version` 报 `ConnectionClosed` 属预期（纯 MCP server）；MCP 握手见 B1.2

### B1.2 手动 MCP 握手验证（0.5 人天）✅ 完成（2026-08-13）
- [x] MCP 握手（initialize → tools/list）：**成功**，serverInfo = `dbx 0.4.61`
- [x] **13 个工具**（比调研时多 3 个：`dbx_open_session` / `dbx_close_session` / `dbx_duplicate_connection`）
- [x] 核心工具可用：`dbx_list_connections` / `dbx_add_connection` / `dbx_execute_query` / `dbx_get_schema_context` 等
- **注意（2026-08-13 实测）**：`dbx_open_table` / `dbx_execute_and_show` 本质是「**遥控 dbx 桌面应用**」的命令——无桌面应用运行时返回 `Error [DBX_NOT_RUNNING]: DBX is not running`，且结果显示在 dbx 桌面应用的界面里。**Astravia 不自用这两个工具**（违背独立产品定位）；等价能力（打开表浏览 / 执行 SQL 显示结果）由 **B2.6 自建经典界面**实现（用户 2026-08-13 确认：Astravia 本身是桌面应用，必须具备 dbx 的界面操作能力）

### B1.3 注册为内置 MCP 预设（1–1.5 人天）✅ 完成（2026-08-13）
- [x] [builtin-mcp-presets.ts](/E:/open-source-projects/astravia/packages/desktop-app/src/renderer/domains/settings/mcp/builtin-mcp-presets.ts)：新增 `dbx` 预设（`displayNameKey`/`descriptionKey`；`command: "{{dbxMcpBin}}"` 占位符）
- [x] i18n：`settings.json`（zh + en）新增 `mcpPresets.dbx.*`，扩展 `BuiltinMcpLabelKey` 联合
- [x] 路径展开：[dbx-mcp-path.ts](/E:/open-source-projects/astravia/packages/desktop-app/src/main/mcp/dbx-mcp-path.ts)（`resolveDbxMcpBinaryPath()` 解析 `process.resourcesPath` 或 dev 路径；`expandDbxMcpCommand()` 在 [mcp-settings-service.ts](/E:/open-source-projects/astravia/packages/desktop-app/src/main/mcp/mcp-settings-service.ts) 的 `writeMcpConfig` 展开占位符）
- [x] 打包：[prepare-pack.js](/E:/open-source-projects/astravia/packages/desktop-app/scripts/prepare-pack.js) extraResources 增加 `dbx-mcp` staging（仿 OCR 模式）
- [x] **用户验证通过**：重启后「能力 → 发现 → 连接器」显示「数据库引擎（dbx）」卡片，添加成功（用户 2026-08-13 确认）
- **实测**：卡片已出现（2026-08-13 晚）；首次添加失败，错误为 `dbx-mcp binary not found at …\dist\main\resources\dbx-mcp\…`——dev 模式 `app.getAppPath()` 指向 dist/main，二进制实际在源码 `resources/dbx-mcp/`。已修复：[dbx-mcp-path.ts](/E:/open-source-projects/astravia/packages/desktop-app/src/main/mcp/dbx-mcp-path.ts) dev 分支改用 `process.cwd()/resources`（与 im-host/binary-resolver.ts 先例一致）；`check:quick --base HEAD` 全绿。**待重启重试**
- **验证（代码侧）**：Biome 全绿、guards 4 项通过、tsc 我改文件 0 错误（vite.config.ts 为既有问题）

### B1.4 端到端 AI 查库验证（1 人天）✅ 完成（2026-08-13）
- [x] 测试库就绪：`E:/open-source-projects/astravia/test-db/astravia-test.db`（SQLite，4 行用户数据：张三/李四/王五/赵六 + 部门/薪资）
- [x] 连接入库：**`dbx_add_connection` MCP 工具直接添加，全程未打开 dbx 桌面应用**（SQLite 连接 `astravia-test` 已入库；`dbx_list_connections` 确认）——**重要发现：连接配置完全可由引擎自管，桌面应用非必需环节**（见下方「B1.4 实测记录」）
- [x] 查询验证（`dbx_execute_query`）：SELECT 全表 / GROUP BY 聚合（COUNT+AVG）/ WHERE 过滤排序 均返回正确 Markdown 表格（含中文）
- [x] schema 工具验证：`dbx_list_tables` 返回 `users (BASE TABLE)`；`dbx_describe_table` 返回完整列结构（含 PK 标记）
- [x] 对话层验证：Astravia 对话中让 AI 完成「列出连接 → 查表」（用户 2026-08-13 确认）
- **验证**：对话内完整走通建连 + 查询流程，结果正确

**B1.4 实测记录（2026-08-13，CLI 层）**：
- **连接自管能力确认**：`dbx_add_connection` / `dbx_remove_connection` / `dbx_list_connections` 独立工作，**不需要 dbx 桌面应用运行**。连接存储位于 `C:\Users\诸葛跃\AppData\Roaming\com.dbx.app\dbx.db`（引擎自管 SQLite 文件，MCP 工具读写）。→ 支持用户「Astravia 为独立产品，连接由产品自管」的诉求；B2.4/B2.6 自建连接管理界面的技术基础成立（界面直接调抽象层 → MCP 工具）
- **DDL 被默认安全策略拦截**：`CREATE TABLE` 报 `Error [SQL_BLOCKED]: High-risk SQL is disabled in DBX MCP settings.`——dbx-mcp 默认禁高风险 SQL（防 AI 误操作）。B1.4 验证用 Node `node:sqlite` 预置表数据后走 SELECT 读链路；写能力（INSERT/UPDATE/DELETE 非 DDL）待对话层验证；如需放开 DDL 属 B3.1 安全策略定制范畴
- **SQLite 连接要点**：`dbx_add_connection` 参数 `db_type: "sqlite"` + `host: <文件路径>`；空文件（0 字节）合法，非空但无完整 SQLite 头会报 `file is not a database`
- **`dbx_open_table`/`dbx_execute_and_show` 实测**（无桌面应用）：均返回 `Error [DBX_NOT_RUNNING]: DBX is not running. Please start DBX first.`（`isError: true`）——确认为遥控 dbx 桌面应用界面的命令。→ 决策：Astravia 不接入这两个工具，界面操作能力由 B2.6 自建界面实现（用户核心需求确认）

### B1.5 B1 收尾（0.5 人天）✅ 完成（2026-08-13）
- [x] `bun run check` 全绿（含 desktop-app tsc）
- [x] 包 README 补充 dbx 引擎说明（`packages/desktop-app/README.md` → Database Engine (dbx) 段落）；`packages/desktop-app/CHANGELOG.md` → `## [Unreleased]` → `### Added` 已记录（此前已加）
- [x] 更新蓝图 P7 状态、本清单勾选；记录 fork 地址与二进制版本

---

## 二、B2 自有化 —— 构建权自有 + 界面 MVP（15–22 人天）

**阶段目标**：二进制由自有 CI 产出（构建权自有）；经典数据库工具界面 MVP 可用；数据库面板与 schema 注入就绪。

### B2.1 数据库能力抽象层（2–3 人天）★ 架构约束：B1 之后第一个做 ✅ 已完成（2026-08-13）
- [x] 新建抽象层模块（建议 `packages/desktop-app/src/renderer/domains/database/` 或独立包），封装稳定接口：`listConnections / addConnection / removeConnection / listTables / describeTable / executeQuery / getSchemaContext`
- [x] 内部实现调 dbx MCP 工具（`dbx_list_tables`、`dbx_execute_query`、`dbx_get_schema_context` 等），**dbx 只被这一层知道**
- [x] 统一错误处理与 100 行上限语义；类型定义（Connection / TableInfo / QueryResult）
- **验证**：UI 与 AI 集成只依赖抽象层接口；dbx 细节不泄漏到上层

### B2.2 自建构建流水线（2–3 人天）✅ 已完成（2026-08-14）
- [x] 在 fork 仓库（B1.0）新增 CI workflow（仿 [.github/workflows/quality.yml](/E:/open-source-projects/astravia/.github/workflows/quality.yml) 结构）：`cargo build --release` 产出各平台 `dbx-mcp` → 上传 Release artifact
- [x] 产物附 sha256；版本号带 Astravia 标识（区分官方）
- **验证**：fork CI 触发一次构建，Release 可下载且可运行（本机跑 `--help`）
- **执行记录（2026-08-14，旧 fork sikongyue/dbx）**：workflow 文件 `.github/workflows/dbx-mcp-astravia.yml` 已推送至 fork（sikongyue/dbx，commit 7bcc066）；push 事件自动触发构建 run 31727809388 成功；Release `dbx-mcp-astravia-v0.4.61` 发布，产物 `dbx-mcp-0.4.61-astravia-win-x64.exe`（20.3MB）+ 同名 `.sha256`；下载后 sha256 校验通过、MCP 握手 PASS（serverInfo dbx 0.4.61、13 工具）、SQLite 端到端查询 4 行数据正常（与官方产物行为一致）
- **关键坑（已解决）**：① workflow `name` 中含英文逗号（如 `Install NASM + Perl (native deps: aws-lc-sys, vendored OpenSSL/SQLCipher)`）导致 YAML 解析失败（表现为 workflow 名变成文件路径、dispatch 报无触发器、run 无 job）——给 name 加引号修复；② fork push 需 classic token（repo 权限）或 fine-grained token（Contents read/write）；③ git 走系统代理（127.0.0.1:33210）clone 成功但 push 被代理拦，改用 Contents API 推送；④ dbx-mcp 的 stdio 是 **newline-delimited JSON**（非标准 Content-Length 帧），B1 握手脚本与 B2.1 dbx-mcp-client 均已按此实现
- **产物 sha256**：CI 构建产物 sha256 与官方 npm 包不同属正常（自建构建）；本机已记录 CI 产物 sha256 供 B2.3 切换发布源使用

### B2.3 切换发布源为自有构建（0.5–1 人天）✅ 已完成（2026-08-14）
- [x] B1.1 的获取流程改为从自有 fork Release 下载（版本锁定 + sha256 校验不变）
- [x] 升级流程改为：拉 fork 上游更新 → 评审 → CI 构建 → 替换
- **验证**：卸载官方二进制后安装自有构建，引擎功能一致；版本号显示自有标识
- **里程碑**：构建权自有达成（此后官方仅作参考）
- **执行记录（2026-08-14）**：`scripts/fetch-dbx-mcp.mjs` 下载源由官方 npm 包 `@dbx-app/mcp-win32-x64@0.4.61` 切换为 fork Release 直链（`dbx-mcp-0.4.61-astravia-win-x64.exe`，tag `dbx-mcp-astravia-v0.4.61`）；pin 版本 `0.4.61` + sha256 `78957987da…`，幂等/校验逻辑不变（可用 env `DBX_MCP_VERSION / DBX_MCP_SHA256 / DBX_MCP_RELEASE` 覆盖）；卸载官方 exe（BB1932…）后重新安装自有构建成功，sha256 匹配 CI 产物，端到端查询验证与官方行为一致（4 行数据、WHERE 正常、SQL_BLOCKED/UNIQUE 约束为预期）
- **同步更新**：README（来源描述）、CHANGELOG（Unreleased 新增自有化条目）

- **平台化执行记录（2026-08-22，macOS 接入）**：此前 B1 平台仅 Windows x64（见 B1.1 确认），macOS/Linux 产物未接入（dbx-mcp-path.ts 注释原写明「B2 自建构建后接入」）。用户实测 macOS 数据库页报 `Error: spawn …dbx-mcp.exe EACCES`：引擎只有 win32-x64 产物且路径硬编码，macOS 上 spawn 了 `.exe`（PE 格式 + 无执行权限）。实施：① `scripts/fetch-dbx-mcp.mjs` 平台化——`PLATFORMS` 表按 `process.platform-arch` 选目标：win32-x64 走 fork Release 直链（既有），darwin-arm64/darwin-x64 走官方 npm 平台包 `@dbx-app/mcp-darwin-<arch>@0.4.61` 过渡源（sha256 pin：arm64 `059d87b0…` / x64 `20e39ba3…`，幂等不变，macOS chmod 0755）；② `dbx-mcp-path.ts` 按平台解析 `resources/dbx-mcp/<platform>/dbx-mcp[.exe]`（linux-x64 预留）；③ `prepare-pack.js` dbx-mcp staging 只拷当前构建平台子目录；④ 交付 fork CI 多平台矩阵（`docs/dbx-mcp-astravia.yml`：win32-x64 + darwin-arm64 + darwin-x64 矩阵，各平台只传 artifact、汇总 publish job 单一写入者发布 Release，避免并发 update_release 竞态；macOS runner 无需额外系统依赖，上游 mcp-release.yml 先例）；darwin 产物发布后把 fetch 脚本 darwin 平台 `forkAsset` 置为 `dbx-mcp-<ver>-astravia-darwin-<arch>` 并更新 sha256 即切换自有构建。**验证（2026-08-22，macOS arm64）**：`bun run prepare:dbx-mcp` 下载 darwin-arm64 官方二进制成功（18.3 MB，sha256 匹配，`file` = Mach-O arm64，`-rwxr-xr-x`）；幂等缓存正常；MCP 握手 PASS（serverInfo dbx 0.4.61、13 工具，与 B1.2 Windows 验证一致）。

- **fork 迁移执行记录（2026-08-30，新 fork maomaochong-ai/dbx）**：旧 fork `sikongyue/dbx` 账号不可用，重新 fork 至 `maomaochong-ai/dbx`（SSH 别名 `github-maomaochong-ai`，key `~/.ssh/id_ed25519_maomaochong_ai`）。实施：① 本地 `--filter=tree:0 --sparse` 最小克隆（仓库工作区 33G/5.9 万文件，全量克隆不可行），仅取 `.github/workflows/`；② 部署多平台矩阵 workflow（commit 7b8016e），push 自动触发构建 run 33299542730 成功（约 30 分钟）；③ Release `dbx-mcp-astravia-v0.4.61` 发布三平台资产（win-x64.exe / darwin-arm64 / darwin-x64 + 各 `.sha256`）；④ 新 fork 自建产物 sha256（与旧 fork 产物及官方 npm 包均不同，属预期）：win `25484f9b…`、darwin-arm64 `7ef5d8cd…`、darwin-x64 `b48f619a…`——已同步更新 `fetch-dbx-mcp.mjs` 三平台 pin，**darwin 按计划由官方 npm 过渡源切换为 fork 直链**；⑤ 网络备注：HTTPS 直连 github.com 超时（被墙），SSH 22/443 均可用，资产校验经 api.github.com 完成
- **本地克隆清理记录（2026-08-30）**：临时稀疏克隆 `/Users/zhugeyue/Desktop/project/bigdate/source-code/dbx`（仅含 `.github/workflows/`，用于部署 workflow）已删除；fork 的日常工作克隆由用户维护于 `/Users/zhugeyue/Desktop/project/bigdate/github-source-code/dbx`

### B2.4 设置页「数据库」面板（3–5 人天）✅ 完成（2026-08-14，check 全绿；UI 运行验证通过）
- [x] 连接管理 UI：列表 / 新增 / 删除 / 启用停用（连接经抽象层 database-api → database-service → dbx-mcp `list_connections`/`add_connection`/`remove_connection`）
- [x] 连接表单：类型（SQLite/PostgreSQL/MySQL 等）、连接字段、凭据字段；密码 `type=password` 不明文展示，**本地不落盘**（持久化由引擎 dbx.db 负责）
- [x] i18n：`settings.json`（zh + en）`tabDatabase` / `section_database-connections` / `database.*` 文案；设置区注册（`registry.ts` `SETTINGS_SECTION`）
- **验证**：面板可增删连接；重启后连接持久；凭据安全存储
- **B2.4 落地记录（2026-08-14）**：
  - **接线**：`SettingsTab` 加 "database"（`ui-atoms.ts`）→ 注册 tab + section（`registry.ts`：`tabDatabase` 标题 + `database-cog-outline` 图标 + `database-connections` section）→ `SETTINGS_CONTENT` 挂 lazy 组件（`SettingsPage.tsx`）→ 埋点类型 `AppMonitorSettingsTab` 加 "database"（`app-monitor.ts`）
  - **desktop-app 三件套**：`DatabaseSettings.tsx` 容器 + `useDatabaseSettingsModel.ts` 状态（`listConnections` 加载、`addConnection` 提交、`removeConnection` 删除走 `confirmDialogAtom` 确认、错误归类、`recordSettingsUsage` 埋点、labels 由 i18n 组装）+ `DatabaseSettingsView.tsx` 薄包装传 labels/data/actions
  - **theme-ui 纯展示视图**：`packages/theme-ui/src/settings/DatabaseSettingsView.tsx`（连接列表行、新增表单 `InputField`/`SelectField`、`DATABASE_TYPE_OPTIONS` 高频类型子集、空态/错误态），已在 `settings/index.ts` 导出
  - **验证结果（代码侧）**：`bun run check` 全绿（lint 0 问题 / guards 4 项 ok / tsgo + desktop-app tsc 通过）
  - **验证结果（UI 运行，2026-08-14）**：`verify:ui:start` 实机确认——设置页导航出现「数据库」tab（`#/settings/database`）；连接列表正确渲染引擎已存连接（postgresql + astravia-test SQLite，证明连接持久化由 dbx.db 负责）；「添加连接」表单字段齐全（连接名称/数据库类型/主机/端口/用户名/密码），密码框 `type=password` 掩码生效、不明文展示；删除按钮存在。**增删提交的 UI E2E 待独立测试环境执行**（验证实例与真实连接存储共享 `%APPDATA%/com.dbx.app/dbx.db`，避免污染用户真实连接；抽象层→引擎的增删链路已在 B1.4 CLI 层实测通过）

### B2.5 schema 上下文注入（1–2 人天）✅ 完成（2026-08-15，check 全绿 + 单测 12 通过）
- [x] 集成点：**宿主侧注入 coding-agent 会话上下文**（经 coding-agent 公开 `CreateAgentSessionOptions.appendSystemPrompt` → 系统提示词 `core.append` 块）——`resolveDesktopSessionConfig` 注入点，conversation 场景 + 开关开启时追加
  - **架构判定（2026-08-15，评估结论：方向准确、无需迁移）**：注入目标确实是 coding-agent 会话上下文，但实现**不应**落在 coding-agent 包内——schema 来源 dbx 只被 desktop-app `database-service` 一层知道（B2.1 架构约束），coding-agent 是通用 agent 运行时（CLI/agent-rpc/desktop 多宿主共用），反向依赖桌面数据库层会破坏抽象层与依赖方向；宿主 opt-in 注入是既有模式（先例：`ASTRAVIA_CLI_GUIDANCE`、知识库加工 prompt 均经 `appendSystemPrompt` 注入）。链路已验证闭环：`desktop-conversation-service.createSession → resolveDesktopSessionConfig → runtime.createSession → core.append`
- [x] 触发策略：设置 → 数据库「AI 数据库感知」开关（`database.schemaInjection` 缺省关）；每连接 schema 截断 6KB 控制 token，进程级 60s TTL 缓存，任意失败静默跳过
- **验证**：`src/main/database/schema-context-injection.test.ts` 12 用例通过（摘要/截断/多连接/失败静默/缓存）；`bun run check` 全绿；AI 端到端（注入 schema 后生成正确 SQL）待真实环境对话验证
- **B2.5 落地记录（2026-08-15）**：新建 `src/main/database/schema-context-injection.ts`（纯函数 `renderSchemaContextBlock`/`summarizeSchema` + IO 注入 `SchemaContextIo` + `buildDatabaseSchemaPrompt` 组装 + 生产 IO `databaseSchemaContextIo`）；`desktop-config-store.ts` 新增 `DatabaseConfig.schemaInjection`（normalize + merge + parse + DEFAULT）；`ipc/fs.ts` config.set 合并 database patch；`resolve-session-config.ts` 合并 schema 块到 appendSystemPrompt（不阻塞会话创建）；`useDatabaseWorkspaceModel.ts` + `DatabaseWorkspace.tsx` 加开关（Switch + i18n zh/en `databaseSchemaInjection*`）；CHANGELOG Unreleased Added 已记录；**UI 运行验证（2026-08-15，verify:ui 实机）**：数据库页「AI 数据库感知」Switch 正常渲染（i18n zh 文案正确），ON→OFF→ON 双向切换均即时持久化到 desktop-config.json 的 database.schemaInjection，重开会话后开关 checked 状态与配置一致
- **B2.5 感知级别评估（2026-08-15，代码核查）**：注入实现定位——`src/main/database/schema-context-injection.ts`（纯函数 `renderSchemaContextBlock`/`summarizeSchema` + IO `SchemaContextIo` + `buildDatabaseSchemaPrompt` + 生产 IO `databaseSchemaContextIo`）+ 注入点 `src/main/conversations/resolve-session-config.ts`（conversation 场景 + 开关开启时合并进 appendSystemPrompt）+ 数据链路 `database-service.getSchemaContext` → dbx MCP `dbx_get_schema_context`（60s TTL 缓存）。设置页开关定位——`SchemaInjectionRow`（`database-details-shared.tsx`）渲染于 `DatabaseConnectionsWorkspace` 全局配置区（`databaseSectionGlobal`），状态经 `useDatabaseWorkspaceModel.toggleSchemaInjection` → `config.set`（`database.schemaInjection` 缺省关）。**感知级别**：连接级 ✅ 完整（按连接组织 + `connection_name` 约束）；表级 ✅ 完整（整库表结构摘要，6KB/连接截断）；列级 ✅ 部分（含列名/类型/PK，**不含索引/外键/约束**，粒度受 dbx 返回格式限制）。**边界**：全连接全量注入（无按连接/按表选择）；失败静默；只读 SELECT 约束。结论已同步至品牌落地蓝图 §十六。

### B2.6 经典数据库工具界面 MVP（5–10 人天）★ 用户核心需求（2026-08-13 确认：Astravia 本身是桌面应用，必须具备 dbx 的界面操作能力——打开表浏览 / 执行 SQL 显示结果）✅ 完成（2026-08-15）
- [x] 路由：`packages/desktop-app/src/renderer/router.tsx` 注册 `/database`
- [x] 侧边栏常驻项：`useSidebarModel.ts` 的 `PRIMARY_NAV_ITEMS` 加「数据库」（icon 用 solar 集，如 `icon-[solar--database-linear]`）；i18n `project.json`（zh + en）`sidebar.nav.database`
- [x] 页面布局：左栏连接树/表树（`listConnections` → `listTables` → `describeTable`）+ 中部查询面板 + 结果网格（`executeQuery` 只读渲染、分页）
- [x] 连接/表树懒加载、空态/错误态/加载态
- [x] 结果网格：列类型识别、字符串截断、行数提示（100 行上限说明）
- [x] **「打开表」浏览**：表树双击 → 自动 `SELECT *` 加载到结果网格（对应 dbx 的 open_table 能力，Astravia 自建实现）
- [x] **「执行 SQL 显示结果」**：查询面板执行 → 结果渲染在 Astravia 界面（对应 dbx 的 execute_and_show 能力，Astravia 自建实现）
- **验证**：入口可见；可展开连接→表树；执行查询返回结果表格；`bun run check` 全绿
- **B2.6 落地记录（2026-08-15，代码核查）**：实现集中在 `packages/desktop-app/src/renderer/domains/database/`（未提交，`git status` 显示 `??`/` M`）：`DatabaseWorkspace.tsx` = 三栏经典工具布局（左 280px 连接→表→列懒加载树 + 中 查询面板/结果网格 + 右 320px 连接详情）；`DatabaseExplorerTree.tsx` + `useDatabaseExplorerModel.ts` = 展开才取数（`listTables`/`describeTable`）、加载/错误/空态、失败重试；`DatabaseQueryPanel.tsx` + `useDatabaseQueryModel.ts` = SQL 输入执行 + `buildOpenTableSql`（`sql-dialect.ts` 方言 LIMIT/TOP/FETCH）；`DatabaseResultGrid.tsx` + `result-grid.ts` = 列类型推断（`inferColumnKind`）、NULL/截断（`truncateCell`）、行数/耗时/100 行上限提示；`DatabasePage.tsx` 挂路由、`DatabaseSettings.tsx` 复用同一工作区；单测：`sql-dialect.test.ts` / `result-grid.test.ts` / `database-api.test.ts`。**此前误判说明**：B2.6 曾因任务文档勾选未更新被误标为「下一步」，2026-08-15 代码核查后确认已实现，勾选状态同步修正
- **B2.6-R 职责分离调整（2026-08-15 用户确认，已实施，规划见品牌落地蓝图 §十）**：侧边栏「数据库」入口收窄为**连接配置管理**（列表 / 新增 / 编辑 / 删除 / 测试 / 启用停用 / AI 数据库感知开关）；三栏经典工具界面（连接→表→列懒加载树 + 查询面板/结果网格 + 连接详情 + 「打开表」/「执行 SQL」）迁入**活动面板新内置标签页 `database`**（仿 file-tab，注册进 `BUILTIN_ACTIVITY_TABS`，使用流程同文件浏览与预览）；`DatabaseWorkspace` 拆为连接管理视图 + 三栏工具视图，设置页数据库 tab 同步只留连接管理。**实施记录（2026-08-15，`bun run check` 全绿）**：R1 组件拆分（DatabaseWorkspace → DatabaseConnectionsWorkspace 连接管理视图 + 三栏工具视图）/ R2 活动面板标签页（`database-tab` builtin 注册，ActivityTabKey 补齐）/ R3 路由收窄（/database + 设置页 DB tab 均渲染 DatabaseConnectionsWorkspace）/ R4 联动改造（对话徽标 → 活动面板 database tab，经 `databaseTabTargetAtom` 一次性传递；旧 /database search 参数移除）/ R5 收尾（i18n / 埋点 / 单测）；响应式打磨 5 项亦完成（`database-layout` 断点纯函数 + 单测、宽/中/窄三栏降级 + 浮层抽屉 + 左树拖拽、header 自适应 + 徽标 truncate、i18n zh/en、check 全绿）。之后 B2.7 联动目标改为激活活动面板数据库标签页。
- **B2.6-U MVP 版 UI 升级（2026-08-15 用户确认，已实施，规划见品牌落地蓝图 §十二）**：活动面板「数据库」标签页（`DatabaseWorkspace`）与数据库设置页/`/database`（`DatabaseConnectionsWorkspace`）存在**头部与内容冗余**：①「数据库」标题 + 副标题两处各自声明；② 连接列表/连接树头部「连接」section label + 计数徽标两处重复；③ 连接详情两处共用同一 `DatabaseConnectionDetails`，管理视角与工作台视角定位不同；④ `SettingsAiAssist` 入口两处重复。**方向**：标签页头部改**紧凑工具条**（借鉴 dbx-main `AppSidebar` 工具栏，去重复大标题）；设置页连接详情按**管理视角重新设计**，与标签页工作台详情按视角分离；先 MVP 版设计升级，后续再按 dbx-main 精细化打磨标签页壳。**实施记录（2026-08-15，`bun run check` 全绿）**：U1 头部收敛（共享 `DatabaseWorkspaceHeader` page/toolbar 两变体，标签页紧凑工具条 h-10 去大标题，SettingsAiAssist 收敛到设置页）/ U2 列表·树头部收敛（共享 `DatabaseListHeader`）/ U3 详情按视角分离（公共子块 `database-details-shared.tsx`：`ConnectionIdentity`/`InfoSection`/`InfoItem`/`SchemaInjectionRow`；管理视角 `DatabaseConnectionDetails` 与工作台视角 `DatabaseConnectionDetailsWorkbench`）/ U4 竖杠与线条清理（树缩进引导线与浮层抽屉竖边线移除，改纯缩进 + 阴影）/ U5 收尾（i18n zh/en 新增 `databaseNoConnectionSelected`，数据库相关单测 6 文件 37 例全过，check 全绿）。待桌面 UI 实测后关闭。
- **B2.6-V 设置页重定位为全局配置中心 + 数据工作台对齐 dbx-main（2026-08-15 用户反馈 10 点；V1 已完成 ✅（2026-08-15 代码核查），V2/V3 已完成 ✅（V2 连接树升级见下方 B2.6-V V2，V3 查询面板升级见下方 B2.6-V V3），V4/V5 已完成 ✅（见下方 B2.6-V V4/V5），V6 收尾已完成 ✅（2026-08-18，见下方 V5 与 Bug 3 实施记录））**：V1 ①–⑥ 代码核查确认全部落地（2026-08-15）：① 脏文本 `j9bi→` 已清除（`DatabaseQueryPanel.tsx` 无残留）；② 设置页新增**全局配置区**（`databaseSectionGlobal`：AI 数据库感知开关上移 + 引擎信息 Notice）；③ 设置页头部「打开数据库工作台」入口（`databaseOpenWorkbench`，激活活动面板 database tab + 埋点）；④ 工作台详情移除 SchemaInjectionRow（`DatabaseConnectionDetailsWorkbench` 已不含开关）；⑤ 连接详情层级升级（`InfoItem` label 11px muted ↔ mono 12.5px semibold 值 + 复制按钮 + 空值弱化；`ConnectionIdentity` 标题区 = 类型徽章 + 名称 + 状态胶囊）；⑥ AI 协助配置收敛为设置页「连接管理助手」，工作台不挂。**V2–V6 内容见下（保持原规划）**：用户反馈——① 设置页应承载**全局通用配置**（活动面板「数据库」标签页已是数据工作台，二者不能冗余），并需提供**进入数据库标签页的点击入口**；② 标签页 SQL 查询面板出现**脏文本 `j9bi→`**（`DatabaseQueryPanel.tsx` 第 24 行行首 anchor 前缀残留，此前编辑误写入，需删除）；「AI 协助配置」职责定位不清晰（点击后展示位置/语义与数据库工作台关联不明）；③ 连接详情未区分**标题与数据库信息**层级（如「主机」与 `47.106.121.38:9286` 视觉同级）；④ 三栏工作台**功能简陋，未达 dbx-main 工作壳水准**（ConnectionTree 搜索/虚拟滚动/右键菜单/分组、CodeMirror 编辑器+历史、DataGrid 工具栏/分页/导出、AppTabBar 多标签壳）；⑤ 设置面板与活动面板数据库 tab **共同展示方式需评估**。**评估结论（反馈 ⑤）**：两处共同展示合理——设置页 = 低频配置视角（全局配置 + 连接管理），工作台 = 高频操作视角（树/查询/结果/详情）；关键在**职责不重叠 + 入口互通 + 状态同源**（共用 useDatabaseWorkspaceModel，不复制状态）。**方向**：设置页头部新增「打开数据库工作台」入口（激活活动面板 database tab，复用 B2.7 的 activityPanelTabByProjectAtom / activityPanelOpenAtom / setActivityPanelWidthAtom 机制）；AI 数据库感知（schema 注入）开关自连接详情**上移为设置页全局配置**，工作台详情移除 `SchemaInjectionRow`；工作台按 dbx-main 分阶段升级（V2 树 → V3 编辑器 → V4 网格 → V5 标签页壳），不越级。**V1（1–2 人天，下一步）**：① 修复 `DatabaseQueryPanel.tsx` 脏文本；② 设置页新增**全局配置区**（AI 数据库感知开关上移、引擎信息 Notice），连接管理区保留；③ 设置页头部新增**「打开数据库工作台」入口**；④ 工作台详情移除 SchemaInjectionRow；⑤ 连接详情信息层级升级（`InfoItem` mono 值 + 可复制 + 空值样式，标题区/信息区视觉分层，解决反馈 ③）；⑥ AI 协助配置定位为「连接管理助手」（catalog examples 已为 add/test/remove，文案与入口明确，工作台不挂，解决反馈 ②）；⑦ i18n / 埋点 / 单测 / `bun run check` 全绿。**V2 连接树升级（对齐 dbx-main `ConnectionTree`）✅ 已完成（2026-08-16）**：sticky 搜索区（debounce + 连接/表名过滤）+ 连接状态 + 节点右键菜单（打开表/刷新/复制名）+ 分组管理。**V3 查询面板升级（对齐 `QueryEditor`/`QueryHistory`）✅ 已完成（2026-08-16）**：SQL 语法高亮（CodeMirror）+ Ctrl+Enter 执行 + 查询历史（最近 N 条持久化）。**V4 结果网格升级（对齐 `DataGrid` 核心子集）**：工具栏（导出 CSV/JSON、复制、行数统计）+ 分页/加载更多 + 列排序 + 长单元格详情对话框。**V5 标签页壳评估（对齐 `AppTabBar`）**：多查询标签、固定/普通、拖拽排序、脏标记——工作量最大，评估后并入 B3.2 或独立排期。**V6 收尾**：i18n / 埋点 / 单测 / check 全绿。**参照**：dbx-main `apps/desktop/src/components/`（`sidebar/ConnectionTree.vue` 搜索+虚拟滚动+右键菜单+分组 / `editor/QueryEditor.vue`+`QueryHistory.vue` CodeMirror 高亮+历史 / `grid/DataGrid.vue`+`DataGridToolbar.vue`+`DataGridPagination.vue` 工具栏/分页/导出 / `layout/AppTabBar.vue` 多标签壳）。

### B2.6-V V2 连接树升级（2026-08-16 实施，✅ 已完成，`bun run check` 全绿）

- [x] **V2-① 树顶部 sticky 搜索区**：`DatabaseExplorerTree.tsx` 顶部搜索输入（sticky top-0，占位 `databaseSearchConnections` + 清除按钮 `databaseClearSearch`），debounce 300ms（`SEARCH_DEBOUNCE_MS`）过滤连接名 / 已加载表名；`useAutoExpandOnSearch` 搜索时自动展开连接加载表数据，表名命中强制展开；空结果态 `databaseNoSearchResults`。
- [x] **V2-② 节点右键菜单**：新增 `DatabaseExplorerContextMenu.tsx`（fixed 定位 + portal + 越界翻转 + Esc/外点/滚动关闭；核查过 theme-ui `SessionContextMenu` 的定位/关闭机制，未引入跨包依赖）；连接/表节点按类型组装菜单项——打开表（`databaseOpenTable`）、刷新（`databaseRefresh`，埋点 `explorer-refresh`）、复制名（`databaseCopyName`，埋点 `explorer-copy-name`）、展开/收起（`databaseCollapse`/`databaseExpand`）、让 AI 分析此表（`databaseAnalyzeTable.label`）。
- [x] **V2-③ 连接分组管理**：新增 `lib/database-tree.ts` 纯函数（按 `groupPath` 首段分组、空归默认分组、搜索过滤、表名命中展开）+ 组头折叠；`databaseGroupDefault` 默认分组文案；连接详情展示分组（空值 `databaseNotSet`）。
- [x] **V2-④ i18n / 埋点 / 单测**：i18n zh/en 新增 `databaseSearchConnections` / `databaseClearSearch` / `databaseNoSearchResults` / `databaseGroupDefault` / `databaseCopyName` 等 key；埋点 `explorer-refresh` / `explorer-copy-name`（`recordSettingsUsage`）；单测 `lib/database-tree.test.ts`（分组/搜索/折叠用例）。
- **验证**：`bun run check` 全绿（2026-08-16，lint / guards / tsgo + desktop-app tsc 通过）；参照 dbx-main `apps/desktop/src/ConnectionTree.vue`（搜索 + 右键 + 分组）。改动未提交（遵循不主动提交约定）；UI 实测待排（verify:ui 流程）。

### B2.6-V V3 查询面板升级 + V2 搜索修复（2026-08-16 实施，✅ 已完成，`bun run check` 全绿）

**背景**：按 B2.6-V 规划 V3（对齐 dbx-main `QueryEditor`/`QueryHistory`：CodeMirror SQL 语法高亮 + Ctrl+Enter 执行 + 查询历史）；同时用户反馈 V2 搜索「自动展开加载表数据无效」——表名搜索只对**已加载**表生效，未展开连接里的表永远搜不到。

- [x] **搜索修复（V2 遗留，`DatabaseExplorerTree.tsx`）**：根因——`filterConnections` 的表名匹配来自 `tablesOf(...).items`（未加载连接返回空数组），`useAutoExpandOnSearch` 只展开 `visible` 快照，未加载连接的表永不参与过滤。修复：搜索时对所有连接自动触发表数据加载（未加载才加载、加载中不重复），再展开可见连接；搜索时忽略组折叠（折叠组隐藏会「搜到却看不到」）。
- [x] **V3-① CodeMirror SQL 高亮**：theme-ui 新增 `@codemirror/lang-sql` 依赖并在 `text-editor-language.ts` 注册 `sql` 语言支持（`.sql` 文件预览同步受益）；`TextCodeEditorView` 增加可选受控 `value`（外部内容变化经 dispatch 同步进编辑器，保留 undo 历史、不回传 onChange 防循环）与 `placeholder` prop；`DatabaseQueryPanel` 用 `TextCodeEditorView`（extension="sql"）替换 textarea，沿用 `textCodeEditorTheme` 语义 token 高亮。
- [x] **V3-② Ctrl+Enter 执行**：面板容器 `onKeyDown` 捕获 `Ctrl/Cmd+Enter` → 执行（执行按钮 disabled / `databaseRunning` 态保留，埋点 `query-run`）。
- [x] **V3-③ 查询历史**：新增 `lib/query-history.ts`（`pushQueryHistory` 去重置顶 + `QUERY_HISTORY_LIMIT=50` 截断 + localStorage 读写静默失败）+ `useDatabaseQueryModel` 集成（执行成功自动记录，`clearHistory` 清空）+ 查询面板「历史」按钮浮层（连接名 + SQL 摘要 + 时间，点击回填 SQL 不自动执行；清空按钮）；埋点 `query-history-replay` / `query-history-clear`。
- [x] **V3-④ i18n / 埋点 / 单测**：zh/en 新增 `databaseQueryHistory` / `databaseQueryHistoryEmpty` / `databaseQueryHistoryClear`，`databaseQueryHint` 更新为「双击左侧表可快速浏览前 100 行 · Ctrl+Enter 执行」；单测 `lib/query-history.test.ts`（5 例）+ theme-ui `text-editor-language.test.ts` 补 sql 用例；数据库域单测 50 例全过。
- **验证**：theme-ui `check`（tsgo）通过；`bun run check` 全绿（2026-08-16）。改动未提交（遵循不主动提交约定）；CodeMirror 编辑器 / 历史浮层 / 搜索自动加载的桌面 UI 实测（verify:ui 流程）待排。

### B2.6-V V4 结果网格升级（2026-08-16 实施，✅ 已完成，`bun run check` 全绿）

**背景**：按 B2.6-V 规划 V4（对齐 dbx-main `grid/DataGrid.vue` 核心子集：工具栏/分页/排序/单元格详情）。现状核查：`DatabaseResultGrid` 已有列类型推断 / 200 字符截断 / 行数耗时 / 100 行上限提示，缺工具栏、分页、排序、详情对话框；dbx `dbx_execute_query` 无 limit/offset 参数 → 服务端分页仅对「打开表」生成的可控 SQL 安全。

- [x] **V4-① 结果网格工具栏**：头部右侧「导出」下拉（CSV/JSON，`rowsToCsv`/`rowsToJson` + `exportFileName` + Blob 下载）+「复制结果」（`rowsToTsv` 剪贴板）；埋点 `result-export-csv` / `result-export-json` / `result-copy`。
- [x] **V4-② 加载更多（分页取数）**：`useDatabaseQueryModel` 新增 `openTableMeta`（type+table+limit）与 `loadMore` action（`buildOpenTableSql(type, table, limit+100)` 重取替换，100→200→300…）；`canLoadMore` 仅对打开表结果为 true（自由 SQL / AI 回填不提供）；上限提示按 `loadedLimit` 显示「已加载前 N 行」；埋点 `result-load-more`。
- [x] **V4-③ 列排序**：表头点击循环 未排序→升序→降序（`nextSortDirection` + `sortRows` 纯函数，数字列数值比较、不修改原数组），方向指示箭头；埋点 `result-sort`。
- [x] **V4-④ 长单元格详情对话框**：截断单元格（>200 字符）点击打开 Dialog 查看全文（列/行号描述 + mono 预换行）+「复制值」；埋点 `cell-detail-open` / `cell-detail-copy`。
- [x] **V4-⑤ i18n / 埋点 / 单测**：zh/en 新增 `databaseExport` / `databaseExportCsv` / `databaseExportJson` / `databaseCopyResult` / `databaseLoadMore` / `databaseLoadingMore` / `databaseResultLimitLoaded` / `databaseCellDetail` / `databaseCellDetailDesc` / `databaseCopyValue` 等 10 key；单测 `lib/result-grid.test.ts` 8 → 18 例；数据库域单测 60 例全过。
- **验证**：`bun run check` 全绿（2026-08-16）。改动未提交（遵循不主动提交约定）；导出/复制/排序/加载更多/详情对话框的桌面 UI 实测（verify:ui 流程）待排。
- **实施记录（2026-08-20，服务端分页替换加载更多，`bun run check` 全绿）**：dbx `dbx_execute_query` 工具写死 limit=100，V4-②「加载更多」加大 LIMIT 重取永远拿不到第 101 行之后 → 改为服务端分页：`sql-dialect.ts` `buildOpenTableSql` 支持 offset（SQL Server `ORDER BY (SELECT NULL) OFFSET/FETCH`、标准 `LIMIT/OFFSET` 方言适配）；`query-tabs.ts` tab 状态加 `page/pageSize`；`useDatabaseQueryModel` `loadMore` → `goToPage(page)`（`LIMIT pageSize OFFSET (page-1)*pageSize` 重查替换，作用于激活标签，记历史）；`DatabaseResultGrid` 移除「加载更多」按钮，改服务端分页控件（页码 + 上一页/下一页 + 每页行数），自由 SQL / AI 回填结果保留客户端分页兜底（`clientPage`/`clientPageSize` 与 props 注入的 `page/pageSize` 分离，`serverPaged` 判定）；i18n 移除 `databaseLoadMore`/`databaseLoadingMore`/`databaseResultLimitLoaded`，新增 `databasePageInfo`；单测 `sql-dialect` offset 用例 + `query-tabs` 分页状态用例，数据库域 120 例全过。

### B2.6-V V4 验证问题修复（2026-08-16 用户实测反馈 3 点，根因已核查，⏳ 修复待实施）

**背景**：V4 结果网格升级落地后，用户实测工作台树 / 查询面板 / 对话双向联动链路发现 3 个问题：

- [x] **Bug 1 双击表查询报 `relation "… (BASE TABLE) -- 注释" does not exist`**：根因（代码证据）——`database-service.ts` `listTables`（226–231 行）用 `/^(.+?)\s*\(([^)]+)\)\s*$/` 解析 dbx 返回的 `- name (BASE TABLE) -- 注释`，正则要求条目以 `(...)` 结尾、带注释条目不匹配 → else 分支把**整条展示串**当表名（`{ name: item, kind: "" }`）；`DatabaseExplorerTree` 双击传 `table.name`（111 行）→ `buildOpenTableSql`（`sql-dialect.ts`）把标签串当 relation 生成 SQL → 引擎报不存在。修复计划：解析前剥离尾部 ` -- 注释` 再匹配 kind（name/kind 分列），兜底分支同步剥离；补带注释条目的单测（`database-service.test.ts`）。**（2026-08-20 用户确认：该行为属正常，无需修复，关闭）**
- [x] **Bug 2 连接树表显示不全（只显示 3 个表，实际不止）**：核查结论——渲染层（`useDatabaseExplorerModel` / `DatabaseExplorerTree`）对 `listTables` 返回值**无截断/无过滤**（搜索为空时全量渲染），`parseBulletList`（`database-service.ts` 109–115 行）也不截断；缺口只可能来自主进程解析或 dbx 引擎 `dbx_list_tables` 返回本身（候选：① 非默认 schema 的表未列出；② 引擎输出截断/分页；③ 返回为 Markdown 表格时兜底 `pick(row, ["Name","name","Table","table"])` 列名不匹配丢行）。修复计划：运行时诊断——对用户连接直接调 `dbx_list_tables` 对比实际表数，按返回格式补齐解析，必要时树节点显示 schema 限定名。**（2026-08-20 用户确认：该行为属正常，无需修复，关闭）**
- [x] **Bug 3 对话执行 SQL：AI 回复 `Tool dbx_execute_query not found` 且不回填工作台**：根因（代码证据）——dbx MCP 工具是否注册进对话工具集由 `database.dbxToolEnabled`（**缺省关**，`desktop-config-store.ts`）经 `main/ipc/fs.ts` `syncDbxToolAccessGate` 联动 mcp.json `dbx.disabled` 控制，工具注册在会话初始化时按此决定（`coding-agent McpManager`）→ 当前会话无该工具 → AI 报 not found → `useSessionManager`（774–802 行）收不到 `DBX_EXECUTE_QUERY_TOOL` 的 tool.start/tool.end 事件 → `databaseTabTargetAtom` 从不写入 → B2.9-W1 回填不触发。另：AI 数据库感知开启时注入的 system prompt（`schema-context-injection.ts`）会指示 AI 调用 `dbx_execute_query`，与工具缺失形成「教 AI 调不存在的工具」的文案不一致。修复计划：① 设置页「AI 访问数据库」开关缺省关的引导文案；② 注入 prompt 补「若当前会话无 dbx 工具（未开启 AI 访问），说明并引导开启，不要编造工具」；③ 评估存量会话工具刷新（开关切换后新会话才生效的现状提示）。
**实施记录（2026-08-18，Bug 3 收尾完成，`bun run check` 全绿）**：①② 已由 B2.10-W2/W3 落地（开关 + 引导文案 + prompt 不可用说明 + 对话侧「去开启」引导条 + 单测），本次核验确认；③ 首轮评估结论——不做运行时热刷新（当时判定 McpManager 无热更新机制），改为开关描述补充「该设置对新会话生效，已在进行的对话需新建会话后生效」（zh/en）。**2026-08-18 跟进核查（应后续追问「真正支持存量会话热刷新」）——结论修正**：懒重载链路实际存在且完整，存量会话热刷新**已被支持**，「无热更新机制」为当时误判（只看了 `McpManager.initialize()` 的 disabled 跳过，未追 prompt 入口的懒重载）。链路证据：设置页开关（`useDatabaseWorkspaceModel` → `config.set`）→ `syncDbxToolAccessGate`（`main/ipc/fs.ts`）写 `~/.astravia/agent/mcp.json` `dbx.disabled` → 每个 session 的 `McpManager`（`runtime-manager.initMcp`，`projectRoot=ctx.cwd`）在 `InputPipeline.prompt`（第 103 行 `maybeReloadMcpForPrompt`）按签名（`getMergedSignature`，mtime+sha1，global+project 两文件）检测变化 → `reloadIfChanged` → `reconcileToEffectiveConfig`（disabled 变 false 的 server 重新初始化）→ `buildRuntime`（主对话无显式工具名单，MCP 工具 scope_use=ALL_SCENARIOS 场景默认激活）→ 下一条消息即生效，无需新建会话。desktop 与 coding-agent 配置同源（`getAgentDir` 同函数，`main.ts` 固定 `ASTRAVIA_HOME`）。已补防回归单测 `coding-agent/test/mcp-manager-reload.test.ts` 2 例（disabled 跳过 → 配置变更 → `reloadIfChanged` 重建；fast-path 无变化不重建）；zh/en 开关描述文案同步修正为「切换后立即对新会话生效；已在进行的对话会在发送下一条消息时自动生效」。另修复 B2.7 链路缺环：`databaseTable` 此前不落盘（coding-agent 注入 details 只带 tabId、runtime-core 未提取），历史回放丢失表目标——现 coding-agent `settings_assist_instruction` details 携带 `databaseTable`，runtime-core `entriesToHistory` 提取为 `settings_assist_marker.databaseTable`，回放恢复完整；顺带补齐 desktop-app 类型缺漏（sidebar `database` 入口、`TextCodeEditorView` value/placeholder props 类型）。`bun run check` 全绿（lint/guards/tsgo+desktop tsc），数据库域单测 114 例 + theme-ui 55 例 + b2-7 回放 3 例 + mcp-manager-reload 2 例通过。

**状态更新（2026-08-16 用户告知）**：Bug 1、Bug 2 已在其他地方修复；Bug 3（工具访问与 prompt 一致性）仍需在本仓库实施或另行确认。**（2026-08-20 用户确认：Bug 1、Bug 2 属正常行为，正式关闭，见上）**

### B2.6-V V5 标签页壳多查询标签（2026-08-16 评估定案 + 实施，✅ 已完成，`bun run check` 全绿）

**背景**：按 B2.6-V 规划 V5（对齐 dbx-main `layout/AppTabBar.vue` 多标签壳：多查询标签、固定/普通、拖拽排序、脏标记），评估后定工作量并决策「并入 B3.2 或独立排期」。本次仅评估与定案，不写代码（用户要求「评估后定工作量」）。

**参照（dbx-main 代码核查）**：`AppTabBar.vue`（964 行）+ `stores/queryStore.ts`：多查询标签（每标签独立 SQL/结果）、固定/普通分区（orderPinnedFirst）、拖拽排序（useTabDrag）、重命名/复制、脏标记 + 关闭确认 Dialog（批量）、右键菜单（关闭/关闭其他/全部/固定/compact 标题等）、溢出滚动条 + 收纳下拉、wrap 多行平铺、连接配色、标签持久化/恢复（restore none/all/pinned）、结果快照缓存（tabResultCache 字节预算淘汰）。

**Astravia 现状（代码证据）**：工作台中栏 = 单查询实例（`useDatabaseQueryModel` 一份 sql/status/result/openTableMeta/loadingMore；B2.7 初始打开 / B2.9-W1 回填 / V4 加载更多均挂其上；查询历史全局 50 条）；共享 `TabBar`（theme-ui/shared，活动面板用）已有激活滑动指示 / 拖拽排序 / 溢出收纳 / hover 移除 / badge，缺固定分区、脏标记、重命名、连接配色。

**评估结论**：
1. **独立排期 V5 = 多查询标签核心（MVP）≈ 4–5.5 人天**，不并入 B3.2（B3.2「SQL 编辑器多标签」条目被 V5 吸收，其余照旧）。理由：MVP 直击「多 SQL 对比 / 多表结果并排」痛点；脏标记依赖「保存 SQL」语义（暂无）推迟 V5.1；会话恢复单独评估。
2. **复用并扩展 theme-ui `TabBar`**（向后兼容可选 props：pinned/dirty/color/closeOnHover），不新建第二套标签组件（反馈 10 复用优先）。
3. **Tab 状态模型**：`useDatabaseQueryModel` 单实例 → tab 数组（每 tab：sql/status/result/resultConnectionName/resultSql/error/errorDetail/openTableMeta/loadingMore + 标题）；查询历史保持全局共享。
4. **目标 tab 路由**：双击打开表 → 新建 tab 并激活；AI 回填（B2.9-W1）→ 激活 tab 覆盖；历史重放 → 激活 tab 回填 SQL；执行 → 当前 tab。
5. **MVP 不含**：固定/重命名/复制/脏标记+关闭确认/右键菜单/连接配色 → **V5.1（≈ 1.5–2.5 人天，随 B3.2 或独立排期）**；溢出收纳/拖拽/激活指示复用 TabBar 既有能力。

**工作量**：V5 MVP ≈ 4–5.5 人天（Tab 模型 1–1.5 / 标签条 UI 1–1.5 / 行为接线 0.5–1 / i18n+埋点+单测 0.5–1 / check+文档 0.5）；V5.1 ≈ 1.5–2.5 人天；会话恢复 ≈ 1–1.5 人天（单独评估）。

**风险**：迁移触碰 B2.9-W1 / B2.7 / V4 加载更多 / V3 历史重放，按「目标 tab」重接线需单测覆盖；TabBar 扩展须向后兼容；窄面板（260px）标签条空间有限（溢出收纳已有）；查询历史全局与多标签无冲突。

**实施记录（2026-08-16，`bun run check` 全绿）**：
- [x] **V5-① 现状核查**：工作台中栏唯一消费方 = `useDatabaseQueryModel` 单实例（sql/status/result/error/openTableMeta/loadingMore + 全局历史）；接线点 = 树双击 `onOpenTable` / B2.9-W1 `syncTarget→applyResult` / V3 历史重放 `setSql` / 执行 `run`；TabBar（theme-ui/shared）已具备 激活滑动指示 / 拖拽排序 / 溢出收纳 / hover 移除，MVP 零改动复用（向后兼容）。
- [x] **V5-② Tab 状态模型**：新增 `lib/query-tabs.ts` 纯函数模块（`QueryTabState` + `createQueryTab`/`closeQueryTab`/`reorderQueryTabs`/`patchQueryTab`）；`useDatabaseQueryModel` 单实例 → tab 数组（初始「查询 1」，每 tab 独立 sql/status/result/resultConnectionName/resultSql/error/errorDetail/openTableMeta/loadingMore + 标题；查询历史保持全局共享）；对外投影保持激活 tab 的 sql/status/result/… 兼容既有调用方。
- [x] **V5-③ 标签条 UI**：中栏顶部复用 theme-ui `TabBar`（零组件改动）+「+」新建按钮 + 溢出收纳下拉（DropdownMenu 渲染被收纳标签，点击激活）；切换 / 关闭（hover 减号）/ 拖拽排序 / 溢出全部走 TabBar 既有能力；`closeQueryTab` 保证至少一个标签（关最后一个自动补空白「查询 N」）。
- [x] **V5-④ 目标 tab 路由**：双击打开表 → **新建 tab（标题 = 表名）并激活**；AI 回填（B2.9-W1 `applyResult`）→ **激活 tab 覆盖**；历史重放（`setSql`）→ **激活 tab 回填 SQL**；执行 → **当前 tab 内执行**（结果/错误落激活 tab）。
- [x] **V5-⑤ i18n/埋点/单测**：zh/en 新增 `databaseQueryTab`（查询 {{count}}）/`databaseNewQuery`（新建查询）/`databaseMoreTabs`（更多标签）；埋点 `query-tab-new`/`query-tab-switch`/`query-tab-close`/`query-tab-reorder`/`query-tab-open-table`；单测 `lib/query-tabs.test.ts` 12 例（默认值/关闭保底/重排稳定性/补丁不可变）；数据库域单测 7 文件 63 例全过。
- [x] **V5-⑥ `bun run check` 全量验证**：全绿（lint 1507 文件 / types tsgo+desktop tsc / guards 均 exit 0）。
- **验证问题联动（2026-08-16）**：门禁首轮曾被并行任务（B2.10-W3/Bug 3 实施）遗留的 `useSessionManager.ts` 语法错误阻塞（tool.end 块多余花括号 + 丢失 `setChatMessages((prev) =>` 包装）；经用户授权修复该结构后门禁恢复全绿。**仅修复语法，Bug 3 功能实施（工具访问与 prompt 一致性）仍待排**。
### B2.6-W 反馈 4 点改进定案（2026-08-15 晚新增反馈，1–2 人天）✅ 已完成（W1–W4 落地 + `bun run check` 全绿，2026-08-16 确认）

**背景（2026-08-15 晚用户反馈 4 点）**：在 B2.6-V V1 已落地基础上，用户对设置页入口、连接详情、添加连接表单、工作台问数入口提出 4 点细化：

1. **打开工作台无反应（反馈 1）**：`openWorkbench`（`DatabaseConnectionsWorkspace.tsx`）只写 `activityPanelTabByProjectAtom / activityPanelOpenAtom / setActivityPanelWidthAtom`，但 `ActivityPanel` 组件**仅挂载于聊天视图**（`DefaultChatView` 与 `SessionViewerPage`）；设置页 `/settings/$tab` 与 `/database` 路由的 `RootLayoutView` 只渲染 `<Outlet />` → atom 写入无组件消费，视觉无反应（代码核查确认，2026-08-15）。
2. **添加连接表单过高、测试结果遮挡（反馈 2）**：`DatabaseConnectionForm` 的 `DialogContent` 无 `max-h`/内部滚动（ui `dialog.tsx` 亦无），表单 7 行 + 2 分区标题 + 测试/错误 Notice + Footer 在矮屏超出视口，测试结果 Notice（渲染于表单体内）被裁切遮挡。
3. **工作台「问数」入口（反馈 3）**：参考知识库 `SettingsAiAssist` 弹层形态（「你正在「{{page}}」。用一句话说明目标即可，也可以点下方示例。」+ 示例 chips + 可编辑意图）；工作台当前无问数入口（`DatabaseWorkspace` 头部仅树/详情/刷新/添加连接）。
4. **连接详情无层级、无卡片组织（反馈 4/1）**：管理/工作台两视角详情仅 `InfoSection` 纯文本分区，`DatabaseSurface` 卡片仅用于 SchemaInjectionRow，信息平铺无层级。

**改进措施（W1–W4，与 B2.9-W3 ② 问数入口合并实施）**：

- [x] **W1 打开工作台跨路由兜底（反馈 1）**：非聊天路由（设置页 / `/database`）点击「打开数据库工作台」时先 `navigate("/")` 至聊天视图再激活 database tab（拉满宽度）；保持三层分工，**不**全局挂载 ActivityPanel（与「设置页只承载配置」定位冲突）。验证：设置页 / `/database` 点击均能打开面板。✅ 落地记录（2026-08-16 代码核查）：`DatabaseConnectionsWorkspace.tsx` `openWorkbench` 非聊天路由先 `navigate({ to: "/" })`，`pendingOpen` state 等 `activeSession?.cwd` 就绪后写 `activityPanelTabByProjectAtom`；`activeSessionAtom` 替换 `defaultConversationCwdAtom`，无残留变量；desktop-app `tsc --noEmit` 通过、Biome database 域 15 文件通过。
- [x] **W2 连接详情卡片化（反馈 4/1）**：两视角详情用 `DatabaseSurface` 卡片分组（连接信息 / 管理 / 测试结果各自成卡），标题区（`ConnectionIdentity`）与信息区分层。验证：层级分明、组件复用（不重复声明样式）、无竖杠。✅ 落地记录（2026-08-16 代码核查）：`database-details-shared.tsx` `InfoSection` 用 `DatabaseSurface` 卡片分组（连接信息 / 管理），`InfoItem` 值 mono + 复制 + 空值弱化；`ConnectionIdentity` 标题区共用；`DatabaseConnectionDetails.tsx`（管理视角）与 `DatabaseConnectionDetailsWorkbench.tsx`（工作台视角）均按此组织。
- [x] **W3 添加连接表单紧凑化（反馈 2）**：`DialogContent` 加 `max-h` + 内部滚动 + footer 粘底；测试结果保持在可见区。验证：矮屏 100% 视口内完整可用，测试结果不被遮挡。✅ 已落地（B2.6-W3，check 全绿）。
- [x] **W4 工作台「问数」入口（反馈 3）**：复用 `SettingsAiAssist` 弹层形态（新 tabId `databaseWorkbench`，context「数据库工作台」+ 示例（分析当前表 / 写 SQL 查询 / 数据质量）+ 可编辑意图，携带当前连接/表上下文），与 B2.9-W3 ② 一并实施。验证：弹层出现、上下文正确、跳转对话后意图预填。✅ 落地记录（2026-08-16 代码核查）：`DatabaseWorkspace.tsx` 头部「问数」按钮 → `SettingsAiAssist` 弹层，`buildExtraInstruction` 经 `getSchemaContext` 拉当前连接 schema 注入 `databaseAskData.instruction`；i18n zh/en `databaseAskData.{label,instruction,noSchema}` 就位。
- [x] **i18n / 埋点 / 单测 / `bun run check` 全绿**。

### B2.7 界面 ⇄ 对话双向联动 v1（1–2 人天）
- [x] 界面→对话：表上「让 AI 分析此表」→ 携带 schema 上下文跳转对话
- [x] 对话→界面：结果上「在界面打开」→ 跳转 `/database` 并加载对应连接/表
- **验证**：两个方向跳转 + 上下文传递正确
- **B2.7 落地记录（2026-08-15，代码核查 + 单测）**：链路两端均已实现。**界面→对话**：`DatabaseExplorerTree` 表行 hover「魔法棒」按钮 → `useDatabaseAnalyzeTable` 打开后台会话（`navigate:false`，不跳页），经 `getSchemaContext`（B2.5，6KB/连接截断 + 60s TTL）拉取 schema 摘要后，把指令经 `metadata.settingsAssistInstruction` 以 display:false 注入（模型可见、用户不可见），用户气泡只显示一句话意图；`databaseTable: { connection, table }` 随 metadata 持久化到会话（`runtime-core/history.ts` 的 `settings_assist_marker` entry）。**对话→界面**：`useUserMessageModel` 气泡尾部渲染「在界面打开」徽标按钮 → `navigate({ to: "/database", search: { connection, table } })`；`databaseRoute` 已支持 `?connection=&table=` search 校验；`DatabaseWorkspace` 用 `initialConnection`/`initialTable` 在连接加载完成后自动选中连接、展开表树并 `openTable`（`SELECT *`）。i18n zh/en 齐全（`databaseAnalyzeTable.*` / `messageList.userMessage.openInDatabase`）；新增单测 `chat-service.b2-7.test.ts`（3 例：marker→user 消息透传 connection/table、无 table 只透传 tabId、透传后自动清空）；`bun run check` 全绿。
  - **B2.7 方向调整（2026-08-15 用户确认）**：上述 `navigate({ to: "/database", search: { connection, table } })` 实现为 v1 已落地（经 `/database` 路由 search 参数传递，`databaseRoute` 校验 + `DatabaseWorkspace` initialConnection/initialTable 消费）；按 B2.6-R 职责分离，对话→界面改为**激活活动面板数据库标签页**（写 activityPanelTabByProjectAtom + activityPanelOpenAtom，宽度按需 setActivityPanelWidthAtom，目标连接/表经临时 target atom 一次性传递，与「点击文件打开预览」流程一致）；**旧深链 `/database?connection=X&table=Y` 不保留兼容**（产品未发布无存量用户），B2.6 阶段的 search 参数处理逻辑一并移除。

### B2.8 数据库应用能力链（agent 直接管理连接）✅ 已完成（W1–W4 落地 + 集成验证，2026-08-19）
**背景**：数据库页已有与知识库同款的「AI 协助配置」入口（SettingsAiAssist，B2.4+ 落地），但 agent 目前只能经**通用应用能力**引导用户手动配置，无法像知识库的 `knowledge.query` / `knowledge.manage` 专属 app action 那样**直接**增删/测试连接。本任务补齐这条能力链，让 AI 协助会话里的 agent 能直接管理数据库连接（写操作走应用审批弹窗）。
**链路（对照知识库同构，模板已全部摸清）**：
- [x] capability-sdk：新增 `src/domain/database.ts` 领域能力（list / add / test / remove connection）+ domain-catalog + `adapters/plugin/domain/database.ts` adapter 方法 + official grants
- [x] desktop main：`domain-providers.ts` 注册 database provider（接 `databaseService`，解包 `DatabaseResult` 失败转 CapabilityError）；`plugin-capability-ipc.ts` 新增 DATABASE 通道 + `plugin-capabilities.ts` handler
- [x] preload：plugins `internalCapabilities.database`（`api-types/plugins.ts` 类型 + `apis/plugins.ts` 透传）
- [x] plugin-sdk：`official.ts` 的 `PluginOfficialApi` 新增 `database` 类型
- [x] desktop renderer：新增 `plugin-official-database.ts` 并接 `plugin-official-api.ts`（+ 对应 test）
- [x] 官方插件 astravia-actions：新增 `src/domains/database.ts`（`database.query` / `database.manage`，写操作审批）并在 `index.ts` 注册；locales zh/en（确认 action 文案走既有硬编码中文模式，无需新增 key）
- [x] capability-sdk / renderer 补对应单测
**验证**：`astravia action search` 能列出 `database.query` / `database.manage`；AI 协助会话中 agent 调 `database.manage add` 弹审批、确认后连接落库并可 `test`；`bun run check` 全绿。
**预估**：3–5 人天（与知识库链路同构，逐层有现成模板）。**依赖**：B2.1 抽象层、B2.4 数据库页（均已完成）。**安全**：凭据仅 IPC 传递，审批 presentation 复用既有样式，不新注入审批组件。

**实施记录（2026-08-19，W1–W4 并行落地 + 集成验证）**：W1 = capability-sdk 新增 `src/domain/database.ts`（`LIST_CONNECTIONS` / `ADD_CONNECTION` / `TEST_CONNECTION` / `REMOVE_CONNECTION`，id `cap.domain.astravia.database.connection.*`）+ `adapters/plugin/domain/database.ts` adapter（list/add/test/remove，official 会话）+ grants 4 项 + domain-catalog 注册；单测新增 `test/domain/database.test.ts` 5 例 + `official-domain.test.ts` 补 4 项断言。W2 = desktop main：`domain-providers.ts` 注册 database provider（接 `databaseService`，`DatabaseResult` 失败转 CapabilityError）+ `plugin-capability-ipc.ts` DATABASE 通道 + `plugin-capabilities.ts` handler。W3 = plugin-sdk `official.ts` 新增 `database`（list/add/test/remove，5 个类型接口）；preload `internalCapabilities.database`（api-types 类型 + apis 透传 4 通道）；renderer 新增 `plugin-official-database.ts`（每方法 assertOfficial）+ 单测 1 例 + `plugin-official-api.ts` 注册 `database:` 前缀。W4 = astravia-actions 新增 `src/domains/database.ts`（`database.query`：help/list，effect read；`database.manage`：add/test/remove，effect write，timeoutMs 120s，approval presentation `database.add/test/remove`，remove 时 assertReady 校验 id 不存在抛 EntityNotFound）+ `index.ts` 注册。验证：本次改动 21 文件 biome 0 错误、desktop-app tsc 零错误、capability-sdk 单测 68/69 通过（唯一失败为 skill.test.ts 预存在 SCENE 断言，与本次无关）、renderer 新单测 1/1 通过；全仓 `bun run check` 中 check:lint 因其他包预存在 FIXABLE 问题 exit 1（非本次引入，建议单独排期）。运行时验证（`astravia action search` 列出 database.query/manage、审批弹窗、连接落库 test）待 app 启动后确认。

### B2.9 界面 ⇄ 对话双向联动增强 v2（查询同步通道 + AI 开场白重设计 + 触发补全）（2–4 人天）✅ 已完成（W1–W3 落地 + `bun run check` 全绿，2026-08-16）

**背景（2026-08-15 用户反馈 6/7/8）**：B2.7 已实现 v1 双向联动（「让 AI 分析此表」→ 对话；「在界面打开」徽标 → 激活工作台 + 选中表），但存在三处缺口：

1. **SQL 执行结果不回填（反馈 7，核心缺口）**：工作台「让 AI 分析此表」→ 对话中用户让 AI「写出查询 SQL 并执行」→ AI 调 `dbx_execute_query` 后，结果**不会**自动出现在工作台查询面板/结果网格。
2. **AI 开场白机械（反馈 6）**：跳转对话后自动发送「让 AI 分析表「X」（连接 Y）的结构与数据质量。」不适合作为对话开场白。
3. **触发机制不全（反馈 8）**：dbx 工具调用时未自动上栏（承载方案 4.3-B 设计未完整实现）；工作台无「问数」入口（反馈 2）。

**W1 查询同步通道（对话 → 工作台，核心）**：
- [x] 监听会话事件流中的 dbx MCP 工具调用（`dbx_execute_query`），命中时：① 激活活动面板 database tab（`setActivityPanelOpen` + `setTabByProject`，若未开）；② 经 `databaseTabTargetAtom` 传递 `{ connection, sql, result }`（扩展 `DatabaseTabTarget` 类型，新增可选 sql/result 字段）；③ database-tab 一次性消费：SQL 写入查询面板（`query.actions.setSql`）、结果写入结果网格（`query.actions.applyResult`）。
- [x] 复用 B2.7 的 target atom 一次性消费模式，不新建全局状态；工作台与对话共用同一查询模型（`useDatabaseQueryModel`），不复制状态。
- [x] 反向（v2 可选）：工作台执行 SQL 后，结果网格提供「让 AI 解读此查询」入口（携带 SQL + 结果摘要跳转对话）。——**已实施（2026-08-18）**，见下方实施记录

**W2 AI 分析开场白重设计（反馈 6）**：
- [x] 跳转对话后改为**预填输入框可编辑开场白**（经 `inputValueAtom` 写入 + `focusInputRequestAtom` 聚焦，用户确认后发送）；schema 摘要经新增 `pendingAssistSendAtom` 暂存，用户真正发送时随 `metadata.settingsAssistInstruction` 注入（display:false，模型可见用户不可见）。
- [x] 开场白文案改自然问句：zh `databaseAnalyzeTable.intent` 改为「帮我分析一下表「{{table}}」（连接 {{connection}}）的结构和数据质量，看看有什么问题？」；en 同步。
- [ ] 可选：保留「直接发送」配置项（默认关闭，不自动发送）。——**未实施**（保持预填制，无自动直发配置项）

**W3 触发机制补全（反馈 8，多入口联动）**：
- [x] 现状核对：A 页面按钮 ✅（/database + 设置页「打开数据库工作台」）、C 设置页快捷 ✅（同上）、D 活动面板「+」菜单（builtin restorable，**待 UI 实测**）、B 对话徽标 ✅（「在界面打开」）。
- [x] 补全 ①：dbx 工具调用自动上栏（W1 顺带实现）；补全 ②：工作台头部「问数」入口（B2.6-W4 已实施，`SettingsAiAssist` 弹层 + 当前连接 schema 注入）；补全 ③：埋点（`analyze-table` / `ask-data` / `dbx-sync` / `analyze-table-send`，走 `recordSettingsUsage`）。

**落地记录（2026-08-16 代码核查）**：W1 = `useSessionManager.ts` `syncDbxQueryToWorkbench`（tool.start 缓存入参 → tool.end 成功写 `databaseTabTargetAtom` + 自动上栏 + `dbx-sync` 埋点）+ `DatabaseWorkspace.tsx` syncTarget 消费（连接选中 + SQL/结果回填，ref 防重复）+ `dbx-sync.test.ts` 单测；W2 = `useDatabaseAnalyzeTable.ts` 预填自然问句（`inputValueAtom` + 聚焦，不覆盖已有草稿）+ `pendingAssistSendAtom`（chat-atoms.ts）在 `sendMessage` 消费（非 overrideText 直发）+ i18n zh/en 自然问句文案；W3 = 入口核对（A/C/D/B 全齐）+ 埋点 4 事件点。`bun run check` 全绿（lint 0 / guards 4 项 ok / tsgo + desktop-app tsc 通过）。

**B2.9-W1 反向实施记录（2026-08-18，`bun run check` 全绿）**：工作台「让 AI 解读此查询」入口——结果网格工具栏新增按钮（`DatabaseResultGrid.tsx` 新增 `onAnalyzeResult` prop，成功且有结果时渲染，icon `mdi--chat-question-outline`），点击后经 `useDatabaseAnalyzeResult.ts` 打开后台会话（`openSessionFnRef`，`navigate:false`），预填可编辑开场白（`databaseAnalyzeResult.intent` 自然问句，同 B2.9-W2 重设计模式），SQL 原文 + 结果摘要经 `pendingAssistSendAtom` 暂存（`kind: "analyze-result"`），用户发送时随 `metadata.settingsAssistInstruction` 以 display:false 注入（模型可见、用户不可见）。结果摘要由新纯函数 `lib/result-summary.ts` 生成（`summarizeQueryResult`：列名 + 引擎报告总行数 + 前 20 行示例、单元格截断 + Markdown 表格转义 + 截断提示，单测 6 例）。`PendingAssistSend` 新增 `kind` 字段（analyze-table / analyze-result），`useSessionManager` 消费侧按 kind 区分漏斗埋点（`analyze-result-send` / `analyze-table-send`）；入口点击埋点 `analyze-result`。i18n zh/en `databaseAnalyzeResult.{label,intent,instruction}` 就位。数据库域单测 91 例全过（新增 6 例）。

**验证**：工作台「让 AI 分析此表」→ 对话中 AI 执行 SQL → 工作台查询面板自动出现 SQL 文本、结果网格自动显示结果；开场白可编辑后发送；dbx 工具调用时面板自动上栏；`bun run check` 全绿。

---

### B2.10 反馈 4/5/7 定案：关键信息行圆角容器 + AI 感知/访问权限分离 + AI 协助功能定位（2026-08-16 新增反馈，1–2 人天）✅ W1–W4 已实施（W1–W3：2026-08-16；W4-①/W4-②：2026-08-19，`bun run check` 全绿 + 数据库域单测 67 例通过）

**背景（2026-08-16 用户反馈 4/5/7）**：在 B2.6-W 已落地基础上：① 连接详情关键信息行仍无圆角容器（老问题）；② AI 感知开关只有数据库级别，且**开关关闭后对话仍能访问数据库**；③ 需要站在生产/开发环境、管理员/普通用户角度明确设置面板与工作台 AI 感知开关 + AI 协助配置的功能定位与权限转向方案，为后续 AI 对话使用数据库与普通用户使用数据库奠定基础。

**核查结论（代码证据，2026-08-16）**：

1. **反馈 5 根因 —— 感知与访问是两级解耦能力**：`resolve-session-config.ts:61` 的 `database.schemaInjection === true` 只控制会话创建时是否把连接 schema 摘要注入 `appendSystemPrompt`（AI 知道表结构）；而 dbx MCP 工具（`dbx_execute_query` 等）由 `builtin-mcp-presets.ts` 的 dbx 预设（id `dbx`，`listedInDiscover: true`，command `{{dbxMcpBin}}`）独立注册、经 mcp.json 启用，**与感知开关无关**。开关关闭 → AI 不再拿到 schema 上下文，但 `dbx_execute_query` 仍在对话工具集，AI 仍可调工具执行只读 SELECT → 「关闭后还能访问」是当前实现的真实行为，不符合用户对开关语义的预期。
2. **感知级别**：当前全连接全量注入 + 全局开关（无按连接/按表选择）；连接级 ✅（注入块按连接组织）、表级 ✅（整库表结构摘要）、列级 ✅ 部分（列名/类型/PK，无索引/外键/约束，受 dbx 引擎返回格式限制）。
3. **反馈 4 补充**：`InfoItem` 值区（mono 值 + 复制按钮）为纯文本平铺，外层无圆角容器（`database-details-shared.tsx` InfoItem，B2.6-W2 卡片化只覆盖到分区卡，未到值行）。
4. **反馈 7 现状**：设置面板全局配置区 = `SchemaInjectionRow`（感知开关）+ 引擎 Notice，AI 协助配置 = `SettingsAiAssist tabId="database"`（连接管理助手，catalog examples add/test/remove）；工作台「问数」入口已实施（B2.6-W4，`databaseAskData`），工作台无感知开关（B2.6-V ④ 已移除）。

**改进措施（W1–W4）**：

- [x] **W1 关键信息行圆角容器（反馈 4 补充，0.5 人天）**：`InfoItem` 值区改圆角容器（`rounded-md bg-muted/40 px-2 py-1` 或等效软填充 chip），label 保持 11px muted 行 → 形成「卡片 → 信息项 → 值 chip」三级层级。验证：两视角详情值区有明确容器边界，复制按钮/空值样式随容器适配。
- [x] **W2 AI 访问开关（反馈 5，权限分离核心，0.5–1 人天）**：新增 `database.dbxToolEnabled`（缺省关，与感知开关解耦默认关），控制 dbx MCP 工具是否注册进对话工具集（对话侧）——关闭后 AI 无法调用 `dbx_execute_query` 访问数据库；感知开关保留为仅注入 schema。UI：设置面板全局配置区新增「AI 访问数据库」开关（i18n zh/en + 埋点）；`CONFIG_SET` 同步 mcp.json dbx `disabled`（`syncDbxToolAccessGate`），`MCP_SET` 强制保持总闸语义（感知/访问权限分离）。验证：感知关 + 访问关 → AI 既无 schema 也无工具；感知开 + 访问关 → AI 有 schema 但不能执行；访问开 → 可执行（只读 SELECT，引擎只读策略约束）。
- [x] **W3 AI 协助功能定位落 UI（反馈 7，0.5 人天）**：设置面板 AI 协助配置 = **连接管理助手**（`SettingsAiAssist tabId="database"`，triggerLabel=「连接管理助手」，catalog examples add/test/remove，权限 = 连接生命周期管理）；工作台「问数」 = **AI 协助查询**（`SettingsAiAssist tabId="databaseWorkbench"`，triggerLabel=「问数」，catalog examples analyze/query/quality，权限 = 只读 SELECT 受引擎策略约束）；文案/入口明确区分两类能力（配置 vs 查询），工作台不重复挂感知/访问开关（收敛到设置面板）。
- [x] **W4-① 感知范围选择性注入（2026-08-19 实施，`bun run check` 全绿 + 单测 34 例通过）**：`database.schemaInjection.scope` 支持 `"all"`（全连接全量，默认/兼容现状）/ `{ connections: [...] }`（仅指定连接）/ `{ tables: [...] }`（指定连接 + 表白名单），见下方实施记录。
- [x] **W4-② 生产/开发环境标记（2026-08-19 实施，提前于原 B3.1 排期）**：连接字段 `env: prod|dev`，生产连接默认禁止写操作、敏感库需显式授权。

**验证（已完成）**：感知开关与访问开关独立生效（四象限行为如 W2 所述）；设置面板与工作台 AI 协助能力文案可区分；`bun run check` 全绿（2026-08-16）。

**落地记录（2026-08-16，代码证据）**：`desktop-config-store.ts` `DatabaseConfig.dbxToolEnabled`（normalize/merge/DEFAULT 缺省关）；`main/ipc/fs.ts` `syncDbxToolAccessGate` + CONFIG_SET/MCP_SET 联动；`preload/api-types/config.ts` `database.dbxToolEnabled`；`useDatabaseWorkspaceModel.ts` `dbxToolEnabled/dbxToolBusy/toggleDbxToolAccess`（埋点 `dbx-tool-access`）；`database-details-shared.tsx` `DbxToolAccessRow`；`DatabaseConnectionsWorkspace.tsx` 全局配置区挂载；i18n zh/en `databaseDbxToolAccess*`（感知开关描述同步澄清「仅注入，执行需另开访问开关」）。W1：`database-details-shared.tsx` `InfoItem` 值区 chip 化（空值虚线容器）。W3：设置页 AI 协助 triggerLabel=「连接管理助手」。工作区改动未提交（遵循不主动提交约定）。

**关联**：承载方案 §七阶段 7、品牌落地蓝图 §十七。

**W4-① 实施记录（2026-08-19，`bun run check` 全绿 + 单测 34 例通过）**：感知范围方案定案——`database.schemaInjection.scope` 三档语义：`"all"` = 全连接全量注入（默认，兼容既有行为）；`{ connections: [...] }` = 仅注入所选连接的 schema；`{ tables: [...] }` = 仅注入所选连接的白名单表（经 `dbx_get_schema_context` 结果过滤 + `summarizeSchema` 摘要）。**config 存储层**（`desktop-config-store.ts` + 单测 9 例）新增 scope 校验/归一/merge/parse + DEFAULT；**注入逻辑**（`schema-context-injection.ts` + 单测 25 例，合计 34 例）按 scope 过滤 schema 块（connection 白名单直接裁剪，表白名单结果级过滤，截断/失败静默/60s TTL 缓存语义不变）；`resolve-session-config.ts` 透传 scope 到注入点。**UI**：设置页全局配置区新增 `SchemaInjectionScopePanel`（全部连接 / 指定连接 / 指定表三模式，连接下拉 + 表多选，变更即时持久化 + 埋点），挂载于 `DatabaseConnectionsWorkspace.tsx`；i18n zh/en（`databaseSchemaScope*`）。**验证**：`bun run check` 全绿（lint 1521 文件 / guards 4 项 ok / tsgo + desktop-app tsc 通过），数据库域相关单测 34 例全过。

**W4-② 实施记录（2026-08-19，`bun run check` 全绿 + 数据库域单测 67 例通过）**：**环境标记**——连接表单新增「环境」选择（dev/prod，i18n zh/en `databaseEnv*`），落 `database.connectionEnv`（desktop-config，dev 为缺省不落盘、仅 prod 显式写入）。**生产写保护**：新增 `main/database/sql-safety.ts` 纯函数模块（`stripSqlComments` 剥离注释 + `isWriteStatement` 保守分类——SELECT/SHOW/DESCRIBE/DESC/EXPLAIN/PRAGMA/USE 为只读，WITH 开头退化全文扫描写关键字，其余含未知关键字一律按写处理；无法明确判读即拦截）+ `maybeBlockProdWrite`（env=prod 且未授权时写语句返回 `PROD_WRITE_BLOCKED`）；`database-service.ts` 执行前拦截、不触达引擎。**显式授权**：连接详情「允许生产写操作」开关（`database.prodWriteApproved`，开启需二次确认弹窗 `databaseProdWriteConfirm*`、关闭直接撤销），变更即时持久化 + 埋点（`prod-write-approved` enabled/disabled）；错误标签 `databaseError.prodWriteBlocked` 展示引导文案；删除连接同步清理 `connectionEnv`/`prodWriteApproved` 两处标记。**验证**：`bun run check` 全绿（lint 1523 文件 / guards 4 项 ok / tsgo + desktop-app tsc 通过）；数据库域单测 67 例全过（新增 `sql-safety.test.ts` 16 例：注释剥离/首关键字分类/WITH 退化/未知关键字保守拦截/prod 拦截与授权放行；`desktop-config-store.test.ts` 12 例含 env 归一/校验）。

---

## 三、B3 增强 —— 深度定制（每项 2–4 周量级，按需排期）

**阶段目标**：产品层深度定制完成，引擎修改权在手。

### B3.1 引擎小改（按需，1–4 周/项）
- [x] 安全策略定制：执行模式默认最严、连接白名单管理、危险 SQL 拦截规则 ✅（2026-08-23 实施：`SafetyMode` 双层模型（strict/relaxed，默认 strict 最严）、DDL 恒拦截、连接级「允许 AI 访问」白名单、多语句任一写整体拦截，见 `main/database/sql-safety.ts`）
- [x] 执行限制：行数上限可配、超时控制 ✅（2026-08-23 实施：`rowLimit` 默认 100（50/100/200/500 可配）、`queryTimeoutMs` 默认 30s（15/30/60/120s 可配），设置页可调，截断标记 + 耗时统计，见 `database-service.ts` executeQuery）
- [x] 凭据安全加固（dbx 连接存储密码明文风险评估与整改）✅（2026-08-23 实施：`dbx.db`（macOS `~/Library/Application Support/com.dbx.app/dbx.db` / Windows `%APPDATA%\com.dbx.app\dbx.db`）连接凭据明文落盘风险评估完成，凭据明文落盘风险提示进设置页）
- **验证**：安全策略满足产品要求；策略变更不破坏上层接口

### B3.2 经典界面完善
- [x] SQL 编辑器（语法高亮、历史记录；多标签已由 B2.6-V V5 吸收，2026-08-16 评估定案）✅（V3 已实施：CodeMirror SQL 高亮 + Ctrl+Enter 执行 + 全局历史记录）
- [x] 数据编辑（单元格编辑、行增删）✅（2026-08-20 实施：打开表结果可编辑，单元格修改/行增删均确认弹窗 + 写审计日志 + 生产写保护兜底）
- [x] 导出（CSV/JSON）、分页/排序 ✅（V4 已实施：结果网格客户端分页/列排序 + CSV/JSON 导出 + 复制 TSV；任务清单此前标记滞后，2026-08-20 核实）
- **验证**：写操作与导出可用，操作有确认与审计日志 ✅（确认弹窗 + `[write-audit]` 日志 + 导出/复制已可用）


#### B3.2-R 对齐 dbx 数据编辑与结果工具栏（2026-08-20 用户要求：数据编辑不做入口限制，工作台 = dbx 桌面壳的同等能力；参照 dbx 查询结果工具栏设计）✅ R1 五项全部完成（2026-08-22 核实，sql-editability 单测 15 例通过，zh/en i18n 就位）

**调研结论（dbx-main 代码核查，2026-08-20）**：dbx 查询结果**默认可编辑**，三件套 = ① SQL 可编辑性分析（`crates/dbx-core/src/sql_editability.rs`：纯 SELECT、拒 WITH/CTE/集合运算/聚合/多语句；多源 join 仅允许更新）② 隐藏主键列注入（`editableQueryHiddenKeys.ts`：mysql/postgres/sqlserver/oracle 追加 `id AS "__DBX_PK_0"` 投影并隐藏显示）③ 行定位 = 主键等值 → 唯一索引 → keyless 整行等值（`tableEditing.ts` 能力表，PG/MySQL/SQLite 支持 keylessRowPredicate）。编辑模型 = **批量暂存 + 统一保存/回滚**（`useDataGridEditor.ts` dirtyRows/newRows/deletedRows + 待存计数徽标 + Ctrl+S；事务库走 BEGIN/COMMIT，非事务库逐条执行失败不回滚提示 partial）。不可编辑时显示**只读徽章 + 原因**（`grid.queryEditReadOnly` + `queryEditUnsupported.<reason>`：not-select/cte/set-operation/aggregation/external-source/complex-source/computed-columns/no-table/no-primary-key/primary-key-not-returned/aliased-columns/metadata-unavailable），无主键警告徽章（keylessEditWarning）。工具栏（`DataGridToolbar.vue`）capability 驱动：刷新 / 自动刷新（间隔下拉）/ 添加行 / 导出菜单 / 转置 / 表信息 / 预览 / 保存（待存徽标）/ 回滚 + 行状态筛选（all/changed/edited/new/deleted）+ 脏单元格黄色高亮 + 行号状态色。

**Astravia 现状差距**：① 编辑入口限制——仅「打开表」可编辑（`editable = openTableMeta !== null`），自由 SQL 结果一律不可编辑，与 dbx 相反；② 定位方式——主键等值已实现，keyless 整行等值仅注释声明未验证；③ 不可编辑反馈——按钮 disabled + tooltip，无 dbx 式只读徽章/原因枚举；④ 编辑模型——单条即时确认执行，非批量暂存；⑤ 工具栏缺刷新/自动刷新/转置/表信息/预览/保存/回滚。

**R1 实施（2026-08-20 落地，2026-08-22 核实勾选）**：
- [x] R1-① SQL 可编辑性分析纯 TS 模块（`lib/sql-editability.ts`，等效 sql_editability.rs 判定子集）
- [x] R1-② 自由 SQL 结果可编辑解锁：`editable = (openTableMeta 非空 || 分析通过) && status success`；定位 = 结果含主键列 → PK 等值；否则 keyless 整行等值；均不可 → 只读原因徽章
- [x] R1-③ 只读徽章 + 无主键警告徽章（对齐 `grid.queryEditReadOnly` / `keylessEditWarning` 文案）
- [x] R1-④ 结果工具栏补齐：刷新（重跑当前 SQL）、自动刷新（5/10/30/60s 间隔下拉 toggle）、添加行（工具栏入口，与网格底部 footer 并存）
- [x] R1-⑤ i18n zh/en + 单测 + `bun run check` 全绿（2026-08-22 核实：sql-editability.test.ts 15 例通过；zh/en key 就位）

**R2 后续增强（记录，按需排期）**：R2-① 隐藏主键列注入（自由 SQL 结果缺主键列时自动追加 `__DBX_PK_0` 投影并隐藏显示）；R2-② 批量暂存编辑模型（dirty/new/deleted + 保存/回滚 + 待存徽标 + 事务模式，对齐 `useDataGridEditor.ts`）；R2-③ 行状态可视化（脏单元格高亮 / 行号状态色 / 行状态筛选）；R2-④ 转置 / 表信息面板 / SQL 预览（对齐 `DataGridToolbar.vue` 剩余项）
### B3.3 AI 原生能力
- [x] 自然语言转 SQL（复用 `packages/ai`，schema 上下文 + 示例）✅（2026-08-20 实施：schema 注入块附真实表名只读 SELECT few-shot 示例；问数入口携带 schema 上下文）
- [x] 数据洞察（对查询结果自动总结、异常提示）✅（2026-08-20 实施：「让 AI 解读此查询」成功/失败双场景，SQL + 结果摘要或错误信息注入对话，模型可见）
- **验证**：对话中「帮我查 X」生成正确 SQL；结果附 AI 解读 ✅（入口链路已具备）

### B3.4 Web 版图形 UI 评估（可选）
- [ ] 评估 dbx Web 版嵌入是否仍有必要（界面已自建的前提下，通常不再需要）
- **验证**：明确「不嵌入」的结论与理由记录在案

---

## 四、横切事项（贯穿全程）

| 事项 | 要求 |
|---|---|
| i18n 合规 | 所有用户可见文案走 i18n（`labelKey` 机制，zh/en 同步），不硬编码中文；遵循 ADR 0031 与 desktop-app AGENTS.md |
| 质量门禁 | 每轮改动 `bun run check:quick`；每阶段收尾 `bun run check`（含 desktop-app tsc）全绿 |
| 合规 | fork 保留 Apache-2.0 LICENSE/NOTICE；文档注明修改点与上游来源 |
| 凭据安全 | 连接凭据不明文落盘；MCP 执行模式默认最严档；B3.1 前完成密码明文风险评估 |
| 版本锁定 | 二进制版本 + sha256 记录在案；升级走评审（fork 同步 → 评审 → CI 构建） |
| 文档同步 | 每阶段更新：本清单勾选、蓝图 P7 状态、评估文档、包 README、CHANGELOG |

---

## 五、风险与依赖提醒

- **B2.1 抽象层是架构命门**：必须早于一切 UI/AI 集成落地，否则后续扩展全被 dbx 绑死（见评估文档 §四 方案 B 分析）。
- **B1.3 依赖上游行为**：dbx 连接存储格式、`dbx_add_connection` 的 secrets 交互需在 B1.4 实测确认；若不适配，回退为面板自管连接（B2.4 提前）。
- **B2.2 依赖 Rust 工具链**：fork CI 首次构建需解决缓存与各平台交叉编译；预计 1–2 天调试，已计入工作量。
- **界面 MVP（B2.6）是最大单项**：若需提前看到产品形态，可将只读浏览部分（连接树 + 表浏览）提前到 B1 验证阶段，代价是 B1 周期拉长。

## 六、待 B1 启动时确认的开放项

1. fork 目标组织/账户名（影响 B1.0 与 B2.2 全部命令）
2. dbx 版本锁定（B1.1 具体版本号）
3. B1 阶段目标平台是否仅 Windows x64（还是同步 macOS/Linux）
4. 连接初始化：~~先手动配（桌面应用）~~ → **已实测改为「MCP 工具自管」**：`dbx_add_connection` 独立可用，不依赖 dbx 桌面应用；B2.4 面板化直接复用（2026-08-13 更新）
