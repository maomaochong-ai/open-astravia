# AI × Database 集成实施方案与计划(对齐 dbx)

> 配套 ADR:`adr-ai-database-integration.md`(方案 C:现有 chat + 问数链路加「数据库咬合层」)。
> 本文档只描述实施步骤与计划,**不含代码实现**(按用户要求先出文档)。

## 0. 目标形态(对照 dbx)

| 能力 | dbx 现状 | 我方目标(本方案) | 差距 |
| --- | --- | --- | --- |
| AI 入口 | 编辑器旁 AiAssistant 侧栏 | 全局 chat + 问数按钮(保留) | 需补就近入口 |
| 上下文 | 当前连接/表/编辑器 SQL + 结构 | 表锚点级(打开表注入表结构,P0 已落地) | P1 补编辑器 SQL / 历史锚点 |
| 产出 SQL 落点 | 一键回填/新建查询执行 | 无(只能手抄) | 需补「应用」通道 |
| 结果/历史分析 | QueryHistory 条目 → AI analysis | 无 | 需补分析入口 |
| SQL 安全 | 同执行管线 | sql-safety clamp | 已具备,沿用 |

## 1. 阶段划分(小步快跑,每阶段可独立验证)

### 阶段 P0:锚点数据建模与注入细化(✅ 已完成 2026-09-06)
**范围**:
- 定义 `DatabaseAiAnchor` 类型(`connectionName` / `catalog` / `schema` / `table?` / `sqlText?` / `source: "editor" | "table" | "history" | "result"`)。
- schema 注入函数支持「按锚点生成摘要」:优先输出该表列结构;否则该 schema 下表清单;否则连接级 summary(现状)。
- 注入内容含方言提示 + 连接显示名,不含行数据(默认)。
**验证**:
  - ✅ 单元测试已过:`ai-anchor.test.ts` 4 用例(表结构格式化 + scope 限定 + 空列兜底)。
  - ✅ full tsc(desktop-app tsconfig)0 errors(2026-09-06 复核)。
  - ⏳ 界面验证:`verify:ui` 打开表后点问数,观察注入内容(待 UI 环境确认)。

### 阶段 P1:对话注入 API 与「应用 SQL」通道(✅ 已完成 2026-09-06,commit 7366a50)
**范围**:
- chat 域提供轻量注入事件:`ask-with-anchor(anchor)` —— 把锚点置顶为系统说明并切换到 database 会话(若 chat 已支持会话切换)。
- database 域在对话消息的 SQL 块上提供「在新查询打开」动作:
  - 提取 SQL → 走既有 `query.actions.addTab(connectionName, sql)` → 用户自行执行;
  - 或「执行」:经 sql-safety clamp,非危险 SQL 直接进当前 tab 执行;危险 SQL 走 danger confirm(`runConfirmed`)。
- IPC/preload 类型最小扩展(如 `runConfirmed` 已存在则仅补 anchor 传输类型)。
**验证**:
- 单测:动作 handler 对 DDL/`DROP` 等被 clamp 拒绝;SELECT 正常入 tab。
- 手动:对话生成 SELECT → 一键打开 → 执行出结果;生成 `DROP TABLE` → 被拦截并提示 danger。
**结果**:theme-ui `TextBlockView` 新增 `renderCodeBlockActions` 插槽;`pendingDatabaseSqlActionAtom` 单向通道;chat 侧 SQL 方言块「打开/执行」;database 侧 open=addTab、run=sql-safety+danger confirm;锚点经 `chat-session-anchor` 回溯最近带连接的用户消息。验证:vitest 锚点 4/4、esbuild、biome、双包 tsc 全绿。
### 阶段 P2:编辑器与历史/结果就近入口(✅ 已完成 2026-09-06,commit b6dad39)
**范围**:
- 编辑器工具栏加「问 AI」按钮:锚点=`{connection, sqlText: 编辑器当前 SQL, source:"editor"}`。
- DatabaseQueryHistoryPopover 每条历史加「AI 分析」:锚点=`{connection, sqlText: entry.sql, source:"history"}`,附加条目的执行时间/状态(若已存)。
- 结果页脚(或结果工具栏)加「AI 分析结果」:锚点=`{connection, table?, source:"result"}`——若来自打开表,带表结构;自由 SQL 则带 SQL 文本,不带行数据。
**验证**:
- 就近入口点击后,chat 中出现对应系统说明与锚点;文案 en/zh;`recordSettingsUsage` 有记录。
**结果**:编辑器工具栏「问 AI」+ 历史条目「AI 分析」落地(`useDatabaseAnalyzeSql` 双源:预填可编辑问句 + schema 摘要 display:false 注入)。**决策记录**:① 交互=按钮唤起对话(非常驻抽屉);② 结果「AI 分析」沿用既有解读通道、保留前 20 行样本;③ 历史不扩执行字段。验证:双 JSON 校验、desktop tsc exit 0、quality guards ok。

### 阶段 P3:体验打磨与容量确认(预估 0.5-1 天)
**范围**:
- 会话锚点切换时清理旧说明(防串上下文)。
- 长 SQL 截断 / 超长表结构摘要的 token 预算提示(沿用 chat 域策略)。
- 是否开放「结果行级上下文(用户选中行 → 让 AI 解释)」:默认不做,标记为后续可选。
- 视觉对齐 dbx:编辑器区是否需要一个常驻的「AI 抽屉」开关,或保持按钮式唤起——**实施前与用户确认交互偏好**(见「待确认」)。

### 阶段 P4:database 网关健壮性加固(缺陷修复,预估 1-1.5 天)

> 来源:2026-09-06 只读 bug scan(`bug_scan_main`)对 dbx-mcp-client/database-service/sql-safety/schema-context-injection 的排查结论;引擎侧 3 项协议事实同日由 probe(`engine_protocol_probe`)确认(见下),P4 修复口径据此落定。

**范围(按优先级)** :
- **[高] 握手失败后客户端永久毒化**([dbx-mcp-client.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/desktop-app/src/main/database/dbx-mcp-client.ts)): `ensureInitialized()` 记忆化 spawnAndHandshake promise,但 error 处理器不重置 `initialized`/`child` → 15s 握手超时/initialize 报错/spawn error 后 DB 功能持续 TIMEOUT 直至重启,无重试。修复:失败路径复位 `initialized=null`(或记录失败并允许下次调用重试),补单测覆盖握手失败→重试成功。
- **[高] 跨代 exit 回调竞态**: `dispose()` 置空引用后旧进程 exit 回调无条件清共享 `pending` 并清新一代引用 → 退出瞬间并发查询使新进程成孤儿、在途请求被误拒。修复:exit 回调按代(捕获的 child 引用 === 当前 child)过滤,补竞态单测。
- **[中] 多语句写绕过审计**(database-service): `isWrite` 按整串首关键字判定、拦截按切分片段 → `SELECT 1; UPDATE…` 放行后审计不记录。修复:审计判定改按片段逐个判定。
- **[中] config 读-改-写非原子**(database-service add/remove connection):并发写丢 `connectionEnv` prod 标记 → relaxed 写保护降级。修复:merge 语义或串行化写。
- **[中] ADR 0056 分层违反**: 编排层直连 `readConfigSync`/`app`(无 host 注入点);[schema-context-injection.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/desktop-app/src/main/database/schema-context-injection.ts) 纯 Node 层运行时 import databaseService;[dbx-mcp-path.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/desktop-app/src/main/mcp/dbx-mcp-path.ts) 的 `app.isPackaged` 无 typeof 守卫。修复:收口最小 host 注入接口、加守卫,保证可纯 Node 复跑。
- **[低]**: [sql-safety.ts] READ_LEADERS 含 `PRAGMA`(引擎已确认 PRAGMA 一律 Write、能写连接上真实生效 → 客户端从只读白名单移除 PRAGMA;`EXPLAIN` 无 ANALYZE 系只读可保留);schema 缓存无单飞去重 + 存未截断原文;`child.stdin.write` 无 error 监听;`testConnection` 草稿清理不检查结果。

**引擎侧协议事实(probe 2026-09-06 确认,含证据)** :
- **Q1 错误协议 = isError 文本,非 JSON-RPC error**:全部工具失败返回正常 result + `content[].text="Error [<CODE>]: <msg>"` + `isError:true`(server.rs:876-878);非策略运行错误统一 `DBX_TOOL_ERROR`(agent_tools.rs:363-369 → server.rs:880-899 扫描策略码),策略类才有 SQL_BLOCKED/MCP_READ_ONLY/CONNECTION_READ_ONLY/PRODUCTION_WRITE_BLOCKED/QUERY_ERROR。→ `classifyError` 文本匹配可行且现状成立;口径:语法/连接类错误靠 message 子串分类,将 `DBX_TOOL_ERROR`+关键词映射维护为单一常量并补单测(引擎措辞变更会使其失效),不追求 code 级。
- **Q2 无取消通道**:dbx-mcp 全量无 cancelled/abort 实现(main.rs:17-18 裸 serve);MCP execute_query 传 `cancel_token: None` + 引擎自 30s 硬超时(agent_tools.rs:585-592)。客户端超时(默认 CALL_TIMEOUT_MS=60s > 30s)仅弃响应 → 常规是引擎先 30s 超时返回含 `timed out` 文本、classifyError 可归 TIMEOUT;短超时(<30s)调用方需知「丢弃响应≠取消」,引擎仍跑满 30s。口径:真取消需引擎侧补 cancelled→token 链路(引擎改造,另行立项);客户端兜底=超时杀子进程重建。
- **Q3 PRAGMA/EXPLAIN**:引擎 MCP 边界有分类拦截(sql_risk.rs PRAGMA→Write、EXPLAIN ANALYZE 递归识别内部写、EXPLAIN 无 ANALYZE→ReadOnly;server.rs:942-989 四道闸),策略放行后执行层透传。→ 客户端 READ_LEADERS 移除 PRAGMA;EXPLAIN 可保留。
- dbx-mcp 错误走 isError-text 还是 JSON-RPC error(后者会使 `classifyError` 全落 UNKNOWN)。
- 客户端超时后引擎端是否继续执行、有无取消通道(决定重试/重复副作用策略)。

**验证**: 单测覆盖上述故障注入场景;desktop tsc / biome / vitest 全绿;退出瞬间并发查询无孤儿进程(ui-verification 人工路径可选)。

## 2. 数据流(目标态)

```
[入口] 编辑器「问AI」/结果页脚「分析」/历史「分析」/顶栏「问数」
   │  DatabaseAiAnchor
   ▼
[chat 域] ask-with-anchor(anchor)  →  schema-context-injection(anchor 细化摘要)
   │  (系统说明 + 用户问题)
   ▼
[LLM] 产出 SQL / 解释
   │
   ▼
[消息 SQL 块] 「在新查询打开」 → query.actions.addTab(conn, sql)
                 「执行」 → sql-safety clamp → run / runConfirmed
```

## 3. 涉及文件(预计,实施时以实际为准)
- `renderer/domains/database/lib/ai-anchor.ts`(新:锚点类型 + 摘要生成)
- `renderer/domains/database/components/useDatabaseQueryModel.ts`(应用 SQL 动作,若需)
- `renderer/domains/database/components/DatabaseWorkspaceHeader.tsx` / `DatabaseWorkspace.tsx`(就近入口)
- `renderer/domains/database/components/DatabaseQueryHistoryPopover.tsx`(历史「分析」)
- `renderer/domains/database/components/DatabaseResultGrid.tsx`(结果「分析」)
- `renderer/domains/chat/*`(注入 API / SQL 块动作 UI)
- `shared/i18n/locales/{en,zh}/settings.json`(新文案)
- 主进程 `schema-context-injection.ts`(按锚点细化,若放在 renderer 则跳过)

## 4. 验证计划(每阶段)
- 轻量:biome(改动的 .ts)、esbuild(改动的 .tsx)、single-fork vitest(相关套件)。
- 交互:`verify:ui:start` 后手动走查(用户确认是否启动)。
- 危险 SQL 回归:sql-safety 既有测试保持绿。

## 5. 待确认(实施前需要用户拍板)
1. 交互偏好:编辑器区做**常驻 AI 侧栏抽屉**(更贴 dbx)还是**按钮唤起对话**(贴现状、改动小)?
2. 结果「AI 分析」是否允许把**当前页行样本**(如前 20 行)作为上下文?涉及数据出库(仅本机 LLM 无妨,若走远程 API 需谨慎)——需按用户 AI 配置回答。
3. 历史「AI 分析」是否需要展示历史执行状态/耗时(需在 QueryHistoryEntry 增加字段)?

**决策记录(2026-09-06,用户拍板)**:
1. 交互=**按钮唤起对话**(贴现状、改动小;常驻 AI 抽屉留待后续独立评估)。
2. 结果「AI 分析」=**保留前 20 行样本**(走既有解读通道;数据不出库仅本机 LLM 时成立,走远程 API 需另行评估)。
3. 历史=**仅现有字段**(`{connection, sql, time}`,不扩执行状态/耗时)。

**文件规划基线**:本方案涉及文件已按 `docs/adr/0056` 迁移为 components/hooks/lib 三层;涉及文件清单见下文 §3。

## 6. 里程碑
| 里程碑 | 内容 | 产出 |
| --- | --- | --- |
| M1(P0+P1) | 锚点 + 应用 SQL 通道 | 端到端「问 AI → 生成 → 执行」| ✅ 2026-09-06(commit 8329510/7366a50) |
| M2(P2) | 就近入口三处 | 与 dbx 交互对齐 | ✅ 2026-09-06(commit b6dad39;结果入口沿用既有通道) |
| M3(P3) | 打磨 + 交互确认项 | 视觉/文案/容量对齐 |
| M4(P4) | 网关健壮性加固 | bug scan 高/中优先项修复,单测覆盖 | 待排期(先确认引擎侧 2 项) |
