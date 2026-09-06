# AI × Database 集成合订:方案、决策与连接树差异分析(对齐 dbx)

> **文档地图**:本文件由三份文档合并而来(2026-09-06),是 AI × Database 集成主题下的**唯一入口文档**,后续状态与遗留统一在此维护。
>
> | 部分 | 内容 | 状态 |
> | --- | --- | --- |
> | 第 1 部分 | AI × Database 集成实施方案与计划(阶段 P0–P4、数据流、文件清单、里程碑、完成度汇总与遗留) | ✅ P0–P4 全部落地(2026-09-06) |
> | 第 2 部分 | 架构决策记录 ADR(方案 C:现有 chat + 问数链路加「数据库咬合层」) | ✅ 决策已采纳并实现 |
> | 第 3 部分 | 数据库工作台「连接树」差异分析(对照 dbx 桌面壳) | ◐ 分析完成;P0–P2(8/9) 已在树 V2–V6 迭代落地,剩余见 §八 |

---

# 第 1 部分 · AI × Database 集成实施方案与计划(对齐 dbx)

> 本部分前身为 `ai-database-integration-plan.md`。
> 配套 ADR:见本文件**第 2 部分**(方案 C:现有 chat + 问数链路加「数据库咬合层」)。
> 本部分只描述实施步骤与计划,**不含代码实现**(按用户要求先出文档)。

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

### 阶段 P3:体验打磨与容量确认(✅ 已完成 2026-09-06,commit 2f5ba60)
**范围**:
- 会话锚点切换时清理旧说明(防串上下文)。
- 长 SQL 截断 / 超长表结构摘要的 token 预算提示(沿用 chat 域策略)。
- 是否开放「结果行级上下文(用户选中行 → 让 AI 解释)」:默认不做,标记为后续可选。
- 视觉对齐 dbx:编辑器区是否需要一个常驻的「AI 抽屉」开关,或保持按钮式唤起——**实施前与用户确认交互偏好**(见「待确认」)。
**结果**:会话锚点切换清理旧说明(`PendingAssistSend` 绑定 runtimeId,场景转移消费即弃);token 预算守卫落地(analyze-context 常量 `ANALYZE_SQL_CHAR_LIMIT=8_000` / `ANALYZE_CONTEXT_CHAR_LIMIT=6_000` + `clipToLimit` 截断 + i18n 截断通知);行级上下文按决策默认不做;编辑器交互拍板=按钮唤起对话(常驻抽屉留待后续独立评估)。验证:esbuild/biome/desktop tsc/vitest 全绿。

### 阶段 P4:database 网关健壮性加固(缺陷修复,✅ 已完成 2026-09-06,commit 371c9bc)

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
**结果**:六项全部落地——[高] 握手失败复位重试(`ensureInitialized` `.catch()` 复位 `initialized=null` + `reapCurrentChild()` 回收后 rethrow);[高] 跨代 exit 竞态(`spawnAndHandshake` 内 `isCurrent` 代过滤,dispose 先拒在途 pending 再 kill);[中] 多语句写审计改按 `splitStatements` 片段逐个判定;config 读-改-写串行化(`mutateDesktopConfig` promise 链);[中] ADR 0056 收口(`app.isPackaged` 加 typeof 守卫);[低] READ_LEADERS 移除 PRAGMA + EXPLAIN ANALYZE 内部写递归识别。验证:新增 `packages/desktop-app/src/main/database/dbx-mcp-client.test.ts` 5 项,main/database 全量 107/107;biome/desktop tsc 全绿。

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

**文件规划基线**:本方案涉及文件已按 `docs/adr/0056` 迁移为 components/hooks/lib 三层并确立 main 侧 data-gateway 提取边界(企业版衔接见 `deliverables/enterprise-blueprint.md` §8.3);涉及文件清单见下文 §3。

## 6. 里程碑
| 里程碑 | 内容 | 产出 |
| --- | --- | --- |
| M1(P0+P1) | 锚点 + 应用 SQL 通道 | 端到端「问 AI → 生成 → 执行」| ✅ 2026-09-06(commit 8329510/7366a50) |
| M2(P2) | 就近入口三处 | 与 dbx 交互对齐 | ✅ 2026-09-06(commit b6dad39;结果入口沿用既有通道) |
| M3(P3) | 打磨 + 交互确认项 | 视觉/文案/容量对齐 | ✅ 2026-09-06(commit 2f5ba60) |
| M4(P4) | 网关健壮性加固 | bug scan 高/中优先项修复,单测覆盖 | ✅ 2026-09-06(commit 371c9bc) |

## 7. 完成情况汇总与遗留(2026-09-06,由 ADR §9.3 并入统一跟踪)

**总体完成度:P0–P4 全部落地并验证**。决策 1–5 均已实现:锚点级注入(1/2,P0 commit 8329510)、SQL 回填通道(3,P1 commit 7366a50)、三处就近入口 + 无第二套聊天 UI(4/5,P2 commit b6dad39);P3(commit 2f5ba60)防串上下文 + token 预算守卫;P4(commit 371c9bc)网关六项健壮性加固(握手失败复位、跨代竞态隔离、多语句写审计、config 原子化、分层守卫、只读白名单),新增 `packages/desktop-app/src/main/database/dbx-mcp-client.test.ts` 5 项,main/database 107/107、biome、desktop tsc 全绿。全部提交已推送双远端(origin + gitee)。

**遗留(可选,非阻塞)**:
1. 界面级人工验收:`verify:ui` 走查「对话生成 SQL→一键执行、就近入口→预填问句→schema 注入」待 UI 环境确认(引擎侧能力已用真实 dbx 二进制探测固化);
2. 真取消通道:需引擎侧 `cancelled→token` 链路改造(另行立项),客户端兜底=超时杀子进程重建;
3. 编辑器常驻 AI 抽屉 / 结果行级上下文:按决策留待后续独立评估;
4. 连接树对齐(见本文件**第 3 部分 §八**):P0 全部 / P1 全部 / P2 数据通路(8/9)已在树 V2–V6 迭代落地;剩余差异(pin、可见性/服务端搜索、引擎持续健康、破坏性动作、更深对象子节点)见 §八 8.2,是否排期另行确认;
5. 工作区未纳入资源:`appearance-mascot.webp` / `default.webp`、`ui-verification.mjs`、`dev-env-401-fix.md`(有意保留在工作区)。

---

# 第 2 部分 · 架构决策记录 ADR:AI 与数据库工作台的集成方式(对齐 dbx 水准)

> 本部分前身为 `adr-ai-database-integration.md`。
> 状态:✅ **已采纳并实现**(P0–P4 全部落地,2026-09-06;本部分 §9 保留实施核对快照)
> 日期:2026-09-06
> 领域:desktop-app · Database Explorer · AI 对话
> 决策者:用户 / Astravia Database Explorer 主程
> 关联决策:V7(per-tab 执行连接)、sql-safety clamp、schema-context injection、dbx-mcp(Rust)

## 1. 背景与问题

Astravia 已具备两块独立的 AI 能力:

1. **全局 AI 对话界面**(`renderer/domains/chat`):通用聊天,与普通对话一致。
2. **顶部「问数」悬浮按钮**(`SettingsAiAssistButton` 及 DatabaseWorkspace 顶栏入口):点击后把当前 Database 会话的 **schema summary**(通过 `database-details-shared` 维护的开关注入)作为 instruction/上下文交给 AI 对话,引导模型产 SQL。

用户希望这两块与「数据库 Explorer / 查询执行」**按 dbx 的方式集成**——dbx 的 AI 不是独立聊天窗,而是**内嵌在 SQL 编辑器旁的 AI Assistant**(`AiAssistant.vue`),能做到:

- 针对「当前打开的查询/表/连接」给出可执行的上下文;
- 生成/改写/解释 SQL,并可直接回填编辑器或作为「新查询」执行;
- 结果区/历史条可一键「让 AI 分析这份查询/结果」;
- 上下文来自真实 catalog(表结构、schema、方言、连接),而非手打。

**问题**:我们现在已有通用对话 + 问数按钮,但缺少 dbx 那种「AI 与单条查询/单张表/历史记录深度咬合」的交互闭环;上下文注入是单向静态的,产出的 SQL 也没有「一键落回编辑器并执行」的通道。

## 2. 决策考量

候选方案:

- **A. 维持现状**:保留全局对话 + 问数按钮,只增强 prompt。
  - 优点:改动最小。
  - 缺点:交互断层——AI 结果与编辑器/结果网格没有连接点;达不到 dbx 水准;用户明确要求对齐。
- **B. 移植 dbx 的 AiAssistant**:在 SQL 编辑器区嵌入独立 AI 侧栏,完整复刻 dbx 交互。
  - 优点:与 dbx 观感一致。
  - 缺点:与 Astravia 现有全局 chat 域重复;维护两套对话 UI;工程量大;与产品既有 AI 域割裂。
- **C.(推荐)在现有 chat/问数链路上加「数据库咬合层」**:保留全局 chat 与问数按钮作为统一入口,但新增三类**上下文+动作**能力:
  1. **会话锚点(anchor)**:对话可携带/切换一个 `DatabaseAiAnchor`(连接 + 库/模式 + 打开表或编辑器 SQL 或历史记录),锚点决定 schema 注入范围与目标方言;
  2. **可执行动作**:模型产出(或被用户指定)的 SQL 通过「应用」按钮走既有 sql-safety guard → 新查询 tab 或当前 tab 执行;
  3. **就近入口**:在查询编辑器工具栏、结果页脚、历史条目上提供「问 AI」入口,把对应锚点交给对话。
  - 优点:复用 chat 域与 dbx-mcp 上下文,不重复造对话 UI;补齐 dbx 的咬合交互;可增量落地;与 sql-safety/schema-context 既有管线完全一致。
  - 缺点:需要定义锚点数据流与 IPC 通道(小);部分 UI 布局需微调(中)。

## 3. 决策

**采用方案 C:在现有 AI 对话(chat)+ 问数按钮链路上实现「Database AI 锚点 + 可执行 SQL 回填」咬合层**,对齐 dbx `AiAssistant.vue` 的能力子集:

1. **新增领域概念 `DatabaseAiAnchor`**(连接名、库/模式、可选表、可选 SQL 文本、来源类型 table|editor|history|selection),作为对话与数据库之间的「当前上下文」。
2. **schema 注入升级**:问数按钮/就近入口调用时,注入范围从「整连接 summary」细化为「锚点表结构 + 方言 + 连接显示名 + 已有 SQL」,并在对话中置顶一条系统说明(仅当该锚点生效)。
3. **SQL 回填通道**:对话消息中可提取到的 SQL(模型建议或用户点「用 AI 生成」)显示「在新查询中打开/执行」操作,走现有 IPC 查询执行管线(sql-safety 前置),复用 rebind/历史记录逻辑,不在 chat 域重复造执行器。
4. **就近入口(按里程碑逐步加)**:
   - 编辑器工具栏:把当前编辑器 SQL 作为锚点「问 AI」(对齐 dbx 编辑器 Ask AI 按钮);
   - 结果页脚/历史条目:对「这份结果/这条历史」发起 AI 分析(对齐 dbx QueryHistory 的 analysis / AiAssistant 结果上下文)。
5. **不新建第二套聊天 UI**;chat 域保持唯一对话宿主,新增的是「把数据库上下文塞进对话」的入口与「把对话结论放回数据库」的出口。

### 明确不做(超出本决策范围)
- 不做服务端 SQL 结果训练/数据上传——schema 只传结构摘要,不传行数据明文(除用户显式选中的分析目标)。
- 不做 dbx 的全量 prompt 复刻;prompt 策略由 chat 域自己的 instruction 体系决定,本决策只定义上下文边界与动作通道。
- 不做 LLM 供应商/模型管理——沿用项目既有 AI 配置。

## 4. 领域建模要点(对齐 domain-modeling)

统一术语(建议写入 CONTEXT):
- `AiAnchor`:上述上下文锚点。
- `AiAsk(connection/table/sql/scope)` → 事件:把锚点发给当前对话并切换到 database 会话。
- `ApplySql(sql, mode)` → sql-safety 校验 → `runConfirmed`/新 tab 执行。
- `AiAnalysis(target)`:对结果集/历史条发起解释性分析(只读 + 摘要)。

约束/不变式:
- 任何由 AI 文本落到数据库的 SQL 必须过 `sql-safety`(与手写 SQL 同权,不豁免)。
- schema 注入只读 catalog,不触碰数据行(默认)。
- 锚点切换需清理旧的系统级说明,防止串上下文。
- 事件全部走既有 IPC/preload types,renderer 不直接访问数据库。

## 5. 备选方案驳回理由

- A 驳回:交互断层,达不到用户要求的 dbx 水准。
- B 驳回:重复 UI、双对话宿主、违背 Astravia 单一 AI 入口取向;且 dbx AiAssistant 的维护成本高于其收益。

## 6. 影响与风险

| 影响面 | 说明 | 缓解 |
| --- | --- | --- |
| chat 域 | 需支持「外部注入锚点/系统说明/从消息提取 SQL」协议 | 由 chat 域提供轻量注入 API(事件),不改内部消息环 |
| database 域 | 新增 anchor 建模 + 就近入口按钮 | 复用 DatabaseQueryHistoryPopover / 编辑器工具栏槽位 |
| IPC/preload | 新增 1-2 个通道(apply-sql 复用现有 query 通道,可能仅需扩展类型) | 最小扩展 |
| i18n | 新增文案双份 | 沿用 settings.json 纪律 |

## 7. 验收标准(DoD)

- [ ] 编辑器工具栏存在「问 AI」入口,点击后对话自动带上当前 SQL + 连接锚点;
- [ ] 对话内产出的 SQL 可一键「在新查询打开/执行」,且 DDL/危险 SQL 被 sql-safety 拦截(danger 需确认);
- [ ] 结果页脚与历史条目可发起「AI 分析」,注入内容为对应锚点摘要;
- [ ] 无第二套聊天 UI;AI 配置仍走既有体系;
- [ ] 新文案 en/zh 同步;操作记录 `recordSettingsUsage`。

## 8. 相关链接
- 本决策配套实施方案:见本文件**第 1 部分**。
- 文件规划基线(数据库域分层与 data-gateway 提取边界):见 `docs/adr/0056`。
- dbx 参考:`components/editor/AiAssistant.vue`、`components/editor/QueryHistory.vue`(analysis 动作)、`lib/ai/*`。
- 现有管线:`schema-context-injection.ts`、`sql-safety.ts`、`database-details-shared` 的 db 工具/上下文开关。

## 9. 实施完成度核对(2026-09-06)

> 依据当日代码盘点:`schema-context-injection.ts`、`DatabaseWorkspace.tsx`、`DatabaseQueryHistoryPopover.tsx`、`DatabaseResultGrid.tsx` 及 chat/问数接线。本节点仅追踪实施进度,不改动上文决策。

### 9.1 决策项落实

| # | 决策项 | 状态 | 证据 / 差距 |
| --- | --- | --- | --- |
| 1 | 领域概念 `DatabaseAiAnchor`(连接/库/表/SQL/来源) | ✅ P0 已落地 | 渲染层新增 `ai-anchor.ts`:`DatabaseAiAnchor` 判别联合(table 来源已用 / editor·history·result 来源留待 P1+),`formatAnchorTableSchema(anchor, columns)`(列 name/type + PK/NOT NULL/DEFAULT/comment 风格与主进程 formatTableSchema 一致)+ 4 单测 |
| 2 | schema 注入升级为「锚点级」 | ◐→✅ P0 完成 | DatabaseWorkspace `askExtraInstruction`(341 行)已接入:打开表 tab 时先 describeTable(锚点连接,表,scope) → 注入 `formatAnchorTableSchema` 表结构文本;失败/无打开表回退连接级 `getSchemaContext`(不退化)。锚点连接取 openTableMeta.connectionName 保证与 describeTable 同库 |
| 3 | SQL 回填通道(消息内 SQL → 一键打开/执行,过 sql-safety) | ✅ P1 完成 | theme-ui `TextBlockView` 新增 `renderCodeBlockActions` 插槽(代码块底栏动作条,主题中性色);chat 侧 `useTextBlockModel` 对 SQL 方言块注入「打开/执行」;单向通道 `pendingDatabaseSqlActionAtom`(open/run 两态,与 DatabaseTabTarget 通道解耦);database 侧 workspace 消费:open=addTab 不执行、run=addTab+sql-safety clamp+danger confirm(`runConfirmed`);锚点连接经 `chat-session-anchor` 从会话最近带 databaseTable 的用户消息回溯;zh/en chat.json 文案。见 commit 7366a50 |
| 4 | 就近入口(编辑器工具栏 / 结果页脚 / 历史条目) | ✅ P2 完成 | 编辑器工具栏「问 AI」+ 历史条目「AI 分析」落地(`useDatabaseAnalyzeSql` 双源通道:预填可编辑问句 + schema 摘要 display:false 注入);结果「AI 分析」按用户决策**沿用既有「让 AI 解读此查询」通道**(保留前 20 行样本,B3.3 现成),未新建重复入口;历史条目按决策不扩执行字段。见 commit b6dad39 |
| 5 | 不新建第二套聊天 UI(约束条款) | ✅ 满足 | chat 域仍为唯一对话宿主,问数为弹层 → `assistJobQueue` → `openSession`+`sendMessage` 注入,无重复对话 UI |

### 9.2 验收标准(DoD)对照

| 验收项 | 状态 |
| --- | --- |
| 编辑器工具栏「问 AI」入口(带当前 SQL + 连接锚点) | ✅ P2 已实现(`useDatabaseAnalyzeSql` editor 源) |
| 对话产出 SQL 一键「在新查询打开/执行」且 DDL/危险 SQL 被 sql-safety 拦截 | ✅ P1 已实现(TextBlockView 动作条 + pendingDatabaseSqlActionAtom) |
| 结果页脚与历史条目可发起「AI 分析」 | ✅ 历史条目已实现;结果页脚沿用既有解读通道(用户决策保留行样本) |
| 无第二套聊天 UI;AI 配置走既有体系 | ✅ |
| 新文案 en/zh 同步;操作记录 `recordSettingsUsage` | ✅ P1/P2 新增项均已同步(chat.json / settings.json 双语 + 埋点) |

### 9.3 小结

**完成度与遗留统一由本文件第 1 部分 §7 跟踪**。本部分 §9.1/§9.2 保留 P0–P2 决策落实与 DoD 快照;P3(commit 2f5ba60)/P4(commit 371c9bc)的进度与验证见第 1 部分 §7。

---

# 第 3 部分 · 数据库工作台「连接树」差异分析(对照 dbx 桌面壳)

> 本部分前身为 `connection-tree-gap-analysis.md`。

> 分析范围:Astravia `packages/desktop-app` 数据库工作台左侧连接树 vs 参考桌面壳
> [dbx](https://github.com/…/dbx) `apps/desktop/src` 的 Sidebar 连接树。
> 证据均标注 `file:line`。参考端路径以 `<dbx>` 代指
> `/Users/zhugeyue/Desktop/project/bigdate/github-source-code/dbx/apps/desktop/src`，
> 当前端路径以 `<cur>` 代指
> `packages/desktop-app/src/renderer/domains/database`。

---

## 一、结论摘要

当前连接树与参考壳的连接树不是「细节差距」，而是**信息架构层级**的差距：
参考壳是一棵**多级元数据树**（连接 → 库 → schema → 对象类型分区 → 对象 → 列/索引/约束，
节点类型 80+ 种），Astravia 当前是一棵**两级懒加载树**（分组 → 连接 → 扁平表 → 列）。
同时参考壳树顶是一整条**能力工具条**（搜索模式切换 / 排序 / 类型过滤 / 只看活跃连接 /
定位当前表），当前只有一个搜索框；参考壳每类节点有**完整右键动作集 + hover 操作 +
固定(pin) + 状态持久化 + 虚拟滚动 + sticky 数据库头**，当前这些规则能力基本缺失。

差异的根因不在 UI 层，而在**数据通路**：

- 参考端（dbx 壳）自带数据库引擎与全量元数据加载协调器，能按需枚举库 / schema / 对象并分页；
- Astravia 工作台消费的是 **dbx MCP 工具协议**，主进程目前只用 `dbx_list_tables { connection_name }`
  拉取**默认库的扁平表清单**（`<cur> src/main/database/database-service.ts:314`、`354`），
  未透出 catalog / schema / 表注释，也没有 DDL、对象分类、可见库等接口面。

因此对齐需要分层进行：**UI/交互层可直接对齐**（改动集中在树组件）；
**层级加深需先扩展数据通路**（决定能对齐到哪一层）。

---

## 二、参考壳（dbx 桌面壳）连接树事实

### 2.1 节点层级与类型模型

树节点类型集中在 `<dbx>/types/database.ts:724` 的 `TreeNodeType` 联合类型，规模说明一切：

- 连接级：`connection`、`connection-group`；
- 库级：`database`、`doris-catalog`、`schema`、SQL Server 系 `linked-server-*`、
  Redis `redis-db`、Mongo `mongo-db/gridfs/buckets/collection`、向量库、ES、Nacos 命名空间等；
- 对象级：`table / view / materialized_view / procedure / function / type / sequence /
  synonym / package / trigger / index / fkey / constraint / partition / extension`；
- **对象分区组**：`group-tables / group-views / group-materialized-views /
  group-procedures / group-functions / group-types / group-sequences / group-synonyms /
  group-packages / group-columns / group-indexes / group-fkeys / group-triggers /
  group-constraints / group-partitions / group-extensions` —— 库下按对象类型再分区展示；
- 特殊节点：`object-browser / user-admin / dameng-job-admin / saved-sql-root(文件夹/文件) /
  table-search-control（库内表搜索行）/ load-more（分页加载行）`。

即参考树的典型深度为：
**connection-group（可选）→ connection → database → schema（多 schema 引擎）→
对象分区（Tables/Views/…）→ 对象 → column/index/trigger/fkey/partition**，
且带 `table-search-control`、`load-more` 这类**树内交互节点**。

分组是**真实树节点**而非列表头：`ConnectionGroup { id, name, collapsed }` 与
`SidebarLayout { groups, order }`（`types/database.ts:784-791`），`order` 支持嵌套分组与
连接排序条目。

### 2.2 树顶工具条（sticky）

`<dbx>/components/sidebar/ConnectionTree.vue`：

- 模板 `:1679` 起为 `connection-tree-search sticky top-0 z-10 bg-background px-2 py-1`，
  内含：
  - 搜索框 + 「全局 / 本地搜索」`Switch`（`:1698`，配置项
    `editorSettings.sidebarGlobalSearchLocal`，`:165` 逻辑分支：本地=只过滤已加载节点，
    全局=走服务端全量搜）；
  - 「定位当前激活标签」十字准星按钮（`:1700`，`locateActiveTabInSidebar` `:945`，
    清空搜索/恢复树并滚动到当前连接）；
  - 排序下拉（`:1706`）：manual / asc / desc（`:281-283`，`sidebar.sortConnections*`）；
  - 类型过滤下拉 `ListFilter`（`:1728`，`sidebarFilterGuards` `:225`）；
  - 「只看已连接」`CircleDot` 按钮（`:1748`，`showConnectedConnectionsOnly` `:59`、`:402`）。
- 列表用 `RecycleScroller`（vue-virtual-scroller）虚拟滚动（`:1756`，import `:31`），
  且实现了 **sticky 数据库头**（滚动经过库节点时吸顶显示当前库，`:1786-1787`，
  `stickyNode` 计算 `:629`）。
- 图标集从 lucide 引入 `Server / Database / FolderTree / Table2 / Eye / …`（`:4`），
  按 `treeNodeIcon` 体系区分连接类型与对象类型。

### 2.3 行结构与交互（TreeItem.vue）

- 节点行组件 `TreeItem.vue`（1389 行），承担 图标+缩进+名称+右侧徽标/操作+行内编辑+拖拽；
- 菜单动作由 `SidebarTreeRuntimeHost.vue` 内一组 `buildXxxSidebarMenu` 工厂按节点类型生成；
  动作词表（i18n `contextMenu.*`，`<dbx>/i18n/locales/en.ts`）覆盖：
  连接：`open/close/delete/duplicate/edit/rename/copy name/expand all/refresh/
  新查询/实例信息`；库/schema：`新建数据库/可见库/可见 schema/设为默认库/表名过滤器/
  DDL/导出/刷新/打开新标签`；对象：`查看数据/编辑结构/编辑列/新建表/建视图/建过程/建函数/
  建触发器/克隆为新表/删除/清空/截断/复制 DDL/复制结构/复制名/重命名/pin-unpin…`；
- 连接健康状态、连接类型图标、分组徽标均有专门呈现组件。

---

## 三、当前端（Astravia 工作台）连接树事实

### 3.1 布局宿主

`DatabaseWorkspace.tsx` 是三栏工作台，左栏为连接树：

- 顶部 `DatabaseListHeader label={t("databaseConnections")} count`（`:468`），
  滚动体 `overflow-y-auto`（`:469`）；
- 树空态：无连接时「图标+文案+新建连接按钮」（`:352-356`）；
- 左栏宽度可拖、窗口过窄时树可切为浮层（`:629-644`）；
- 中栏是查询页签+SQL+结果网格；右栏连接详情 320px（`:620`）。

### 3.2 树结构（DatabaseExplorerTree.tsx）

层级为「分组头 → 连接 → 表 → 列」四层渲染：

- **分组头**（`:353-364`）：按 `groupPath` 首段分组（`groupConnections`），
  文本小号大写+计数，可折叠，**无右键菜单、无新建分组**；
- **连接行**（`:372-394`）：`DatabaseStatusDot(statusOf)` 状态点 + `DatabaseTypeBadge` +
  名称；单击=选中连接（切查询目标），chevron=懒加载表；行右键菜单仅
  「展开/收起 / 刷新 / 复制连接名」（`:252-274`）；
- **表行**（`:120-175`）：图标统一 `solar--table-linear`（**不区分表/视图**），
  双击打开、hover 显示「分析(magic) + 打开(play)」两个按钮；菜单「打开/分析/展开/刷新/复制名」
  （`:282-313`）；列在表行下内联展开渲染（`ColumnRows` `:42-71`）；
- **列行**：主键 `mdi--key-outline`、普通列 `mdi--code-braces`，行尾列类型小字，
  无右键菜单；
- 状态点来源是**测试快照**（`statusOf`，手动「测试」的结果 untested/success/fail），
  非持续健康轮询；
- 展开/折叠均为**内存态**（`useDatabaseExplorerModel.ts:41-43` 的 useState 记录），
  重启不保留。

### 3.3 搜索

- sticky 搜索框（`:320-343`，debounce 300ms）；
- 只过滤**连接名 + 已加载表名**；搜索时对所有连接**自动拉表**再过滤
  （`useAutoExpandOnSearch` `:191-206`），无结果时显示「无搜索结果」；
- 无全局/本地模式、无排序、无类型过滤、无「只看活跃连接」、无定位当前表。

### 3.4 数据通路（main 侧）

`src/main/database/database-service.ts`：

- `listConnections`：解析 `dbx_list_connections` 返回的 markdown 表 → `DbConnection`
  （id/name/groupPath/type/host/port/database/env，`:242-246`）；
- `listTables`：调 `dbx_list_tables { connection_name }`（`:314`、`:354`），
  返回**当前默认库的扁平表清单** `DbTableInfo { name, kind }`（`:147`），
  kind 为 `BASE TABLE / VIEW / …` 文本但树渲染未使用；
- 解析器兼容 bullet 与 markdown 表格两种格式（`:134-161`），**目前只 pick
  Name/Table + Type/Kind 两列**（`:157-158`），catalog/schema/注释列即使返回也会被丢弃；
- 无 DDL、无按库/schema 枚举、无对象分类/分页接口；`describeTable`/`getSchemaContext`
  供详情面板与 AI 用。

---

## 四、逐项差异矩阵

| # | 维度 | dbx 参考壳 | Astravia 当前 | 差距性质 | 对齐成本 |
|---|------|-----------|---------------|---------|---------|
| 1 | 树的层级 | 连接→库→schema→对象分区→对象→列/索引 | 分组→连接→表→列 | 结构性 | 中（数据层受限） |
| 2 | 连接分组 | 真实树节点（可右键、可嵌套、可持久化折叠） | 列表头文本（仅折叠/计数） | 结构性 | 低 |
| 3 | 对象类型分区 | Tables/Views/Procedures/… 分区节点 | 无分区，视图混在表里、图标相同 | UI+模型 | 低 |
| 4 | 连接行内容 | 类型图标+健康点+名称+环境/默认库徽标+hover 操作 | 状态点(测试快照)+TypeBadge+名称，无 hover 操作 | UI | 低 |
| 5 | 连接健康状态 | 引擎持续健康，多点轮询 | 仅手动「测试」快照三色 | 数据 | 中 |
| 6 | 树顶工具条 | 搜索+全局/本地+排序+类型过滤+只看活跃+定位当前表 | 仅搜索框 | UI | 中 |
| 7 | 右键菜单 | 每类节点完整动作集（新建/删除/编辑/重命名/DDL/导出…） | 连接3项、表5项；无破坏性/管理动作 | UI+操作链路 | 中 |
| 8 | hover 快捷操作 | 连接/库/对象行各自 hover 按钮 + 拖拽手柄 | 仅表行 hover(分析/打开) | UI | 低 |
| 9 | 固定(pin) | 支持置顶固定并可拖拽重排 | 无 | 规则 | 中 |
| 10 | 状态持久化 | 展开/选择/滚动/排序恢复策略 | 全内存，重启丢失 | 规则 | 低 |
| 11 | 可见性筛选 | 可见库/可见 schema/表名 include+exclude 过滤器 | 无（单库扁平，无此概念） | 数据+UI | 高 |
| 12 | 搜索范围 | 全局=服务端全量搜 + 本地=已加载过滤 | 本地过滤（自动拉全量表后过滤） | 数据 | 中 |
| 13 | 性能 | RecycleScroller 虚拟滚动 + sticky 库头 | 普通 map 全量渲染 | UI | 中 |
| 14 | 表名展示 | 可配置 schema 限定与否 | 恒为裸表名（跨 schema 可能重名） | 数据 | 中 |
| 15 | 空态/引导 | 无连接欢迎页 + 新建引导 | 树内空态 + 中栏欢迎面板 | UI | 低（已有） |
| 16 | 多选/批量 | 连接多选、批量删除/复制/导出 | 单选 | 规则 | 高 |

**差异成因总结**：参考壳是「自带引擎的元数据浏览器」，Astravia 工作台是「MCP 工具的
轻量消费端」——协议只给了连接级与单库表级两档粒度，中间（库/schema/对象分区）与
外围（DDL/健康/可见性）能力没有数据面支撑，多数 UI 差异由此而来，而非单纯的视觉未对齐。

---

## 五、对齐路线图（建议优先级）

### P0 —— 纯前端即可对齐（不动数据通路，先消除「看起来差很多」）

1. **表行按 kind 分区**：把现有扁平表列表按 `kind`（BASE TABLE / VIEW / …）分成
   「表 / 视图」小节（图标 `solar--table` vs `solar--eye`/view 图标、分区小标题
   仿组头样式）。直接消除「视图混在表里且同图标」的最大视觉差异。
   落点：`DatabaseExplorerTree.tsx` TableRows + `database-tree.ts` 新分组函数。
2. **连接行增强**：hover 出现操作（刷新/复制名/测试），host:port 与 env 徽标弱化展示，
   状态点 hover 显示最近测试时间/详情。
3. **右键菜单扩充（安全项先行）**：连接行加「测试连接」；表行加「复制限定名」；
   列行加「复制列名」；菜单分隔线按动作类别分组。破坏性动作（删除连接/表）先不加，
   或加确认弹窗后复用现有 `openAdd(edit模式)`/删除通道。
4. **持久化展开态**：连接展开/分组折叠写入 localStorage（key 按连接 id），重启恢复。

### P1 —— UI 交互对齐（改动集中在树组件，需要少量新状态）

5. **树顶工具条升级**：搜索框旁加「只看活跃连接」开关、排序(manual/asc/desc)、
   类型过滤(全部/仅表/仅视图)、「定位当前表」（当前已打开表的连接自动展开并滚动，
   参照 `locateActiveTabInSidebar`）。注意文案一律走 i18n（settings 命名空间）。
6. **分组行右键菜单**：新建分组/折叠全部/展开全部（新建分组写入连接 groupPath 的
   存储字段——需确认 main 侧 desktop-config 是否支持写回，不支持则先做折叠全部/展开全部）。
7. **sticky 数据库/连接头**：连接行较多时滚动吸顶展示当前连接名（轻量版 sticky 头，
   不需要虚拟滚动）。

### P2 —— 需要先扩数据通路（结构性对齐，决定树能到多深）

8. **解析层扩展**：`parseTableList` 增加 pick `Schema/Catalog/表注释` 候选列；
   先与 DBX 实测确认 `dbx_list_tables` 是否返回 schema/catalog 列（当前实现兼容
   markdown 表与 bullet 两种返回，多数引擎工具会带 schema）。若带 → 连接下插
   **schema 分区行**；不带 → 至少保证 kind 分区正确。
9. **按库/按 schema 枚举**：为需要「连接→库→schema→对象」深度的连接类型，
   在主进程增加逐库/schema 调 `dbx_list_tables` 并聚合成树节点（复用现有
   `listConnections` 返回的 database 字段作根）。成本中等，受 dbx 工具返回格式约束。
10. **可见库/可见 schema / 表名过滤器 / 固定(pin) / 虚拟滚动**：数据面就绪后再做，
    属于「完整对齐」阶段。

### 建议顺序

先做 **P0(1)(2)(4)** —— 一次提交内完成树结构分区 + 行内容 + 展开持久化，
视觉与信息层次立刻接近参考壳；再评估 P1(5) 工具条；P2 需先验证数据面，
建议单独立项。

---

## 六、落地改动文件清单（预估）

- `<cur>/components/DatabaseExplorerTree.tsx`：分区渲染、行 hover、sticky 头、工具条入口；
- `<cur>/lib/database-tree.ts`：kind 分区、schema 分组纯函数（保持可单测）；
- `<cur>/components/useDatabaseExplorerModel.ts`：展开态持久化读写；
- `<cur>/components/DatabaseExplorerContextMenu.tsx`：菜单项与分隔线扩展；
- `src/main/database/database-service.ts`：parseTableList schema/catalog 透出（P2）；
- `packages/desktop-app/src/preload/api-types/database.ts`：DbTableInfo 扩展字段（P2）；
- 两个 i18n 语言文件（zh/en）settings 命名空间：新增文案 key，不硬编码。

---

## 七、待确认问题（落地前需回答）

1. `dbx_list_tables` 实际返回是否含 Schema/Catalog/表注释列？（决定树深度对齐方案）
2. 连接行右键是否要加「编辑连接 / 删除连接 / 测试连接」（涉及主进程
   `desktop-config` 写回与 dbx 连接管理权限）？
3. 「对齐」目标深度：先对齐到**对象分区（表/视图）**，还是希望推进到
   **连接→库→schema→对象**全深度？
4. 是否允许在树中引入破坏性操作（删除表/清空表）并接确认弹窗？

---

## 八、实施进度核对（2026-09-06 代码复核）

> 原分析成文于树 V1 时点;此后连接树经历 V2/V6 迭代,本节对照**当前代码事实**逐项核对路线图完成度。第 1 部分 §7 遗留清单第 4 条以本节为准。

### 8.1 已落地(路线图逐项)

| 路线图项 | 状态 | 代码证据(2026-09-06 复核) |
| --- | --- | --- |
| P0-1 表行按 kind 分区 | ✅ | `lib/database-tree.ts` `TableKind`/`tableKindOf`/`splitTableKindSections`/`filterKindSections`(表/视图两分区)+ DatabaseExplorerTree 分区头渲染;`database-tree.test.ts` 分区/过滤单测 |
| P0-2 连接行增强 | ◐ 改设计 | prod 徽标(DatabaseEnvBadge)+ 状态点 hover 最近测试时间/详情(statusTitle/testedAt);hover 快捷操作**改为多选 checkbox**(对齐 dbx 行尾唯一 hover 控件,刷新/测试移入右键菜单) |
| P0-3 右键菜单安全项 | ✅ | DatabaseExplorerContextMenu:连接=展开/收起/刷新/测试/复制名,表=打开/分析/展开/刷新/复制名,列=复制列名,分组=展开全部/折叠全部/复制组名/删除用户组;破坏性动作按原建议未加 |
| P0-4 展开态持久化 | ✅ | `hooks/useDatabaseExplorerModel.ts` localStorage `astravia.db.explorer.v1`:expandedConnections/expandedScopes/expandedTables/collapsedGroups 四集合 |
| P1-5 树顶工具条 | ✅ | 搜索框 + 只看活跃连接(healthyOnly)+ 类型过滤(kindFilter)+ 排序(sortOrder default/asc/desc)+ 定位当前表(locate);文案 i18n |
| P1-6 分组菜单 + 新建分组 | ✅ 改实现 | 分组行右键展开/折叠全部等;新建分组走 DatabaseWorkspace「+」对话框存 localStorage(**不写回** main config,避免动 dbx-mcp groupPath);dbx-mcp 原生分组只读保留 |
| P1-7 sticky 连接头 | ✅ | V2-① 连接吸顶条(height:0 sticky,轻量,按原建议不做虚拟滚动) |
| P2-8/9 schema/database 枚举 | ✅ 改道更完整 | 未依赖 list_tables 带 schema 列;改为主进程 `listCatalogScopes`(catalogIntrospectionSql 按族枚举)+ `catalog-family.ts` 分 flat/schemas/databases 三族 + ScopeRows 渲染「连接→schema/database→表→列」 |

### 8.2 未落地(剩余差异)

| 差异 # | 未完成项 | 原因/性质 |
| --- | --- | --- |
| 9 | 固定(pin)置顶 + 拖拽重排 | ✅ `5ad889a`(批次2)：连接分组/scope/表分区按容器独立 pin 置顶 + 同段拖拽重排,本地持久化 |
| 11 | 可见库/可见 schema / 表名 include+exclude 过滤器 | ✅ `5ad889a`(批次2)：右键「隐藏该库/schema/表」写 exclude + 连接菜单「显示全部对象」还原(glob 过滤,仅影响显示) |
| 12 | 全局=服务端全量搜索 Switch | 部分:全局/本地搜索开关 + 状态持久化 ✅ `5ad889a`(批次2);服务端全量搜仍无(引擎未提供,维持本地增强:自动拉表+作用域命中+忽略组折叠) |
| 5 | 连接健康=引擎持续轮询 | ✅ `a939f27`：已测连接每 60s 只读心跳刷新状态点(批次1) |
| 1 | 树深至索引/约束/触发器/分区子节点 | ✅ `b2b7ec5`+`c699d9d`：introspection SQL 枚举四类子对象,表行下分区渲染(批次1) |
| 7 | 破坏性/管理动作(删除连接/表、清空、重命名、DDL、导出) | 原建议「先不加/待确认」,仍待用户拍板(见 §七.2/4) |
| 10 | 工具条状态持久化(排序/过滤/只看活跃/搜索词) | ✅ `5ad889a`(批次2)：explorer-toolbar-state 本地持久化(搜索词/仅健康/全局搜索/排序/类型过滤) |
| 16 | 批量删除/导出 | 多选+批量复制名/批量测试已有;批量删除/导出随破坏性动作一并待定 |
| — | 虚拟滚动 | **有意不做**(P1-7 轻量 sticky 决策,非缺口) |

**结论**:P0 全部、P1 全部、P2 数据通路(8/9)已落地;剩余差异已在 **2026-09-06 用户拍板全部实施**(虚拟滚动维持有意不做),按批次计划推进(见 §九)。


---

## 九、P5 批次实施计划(2026-09-06 用户拍板)

> 范围 = §8.2 剩余差异全部落地(除虚拟滚动)。分 3 批,每批独立 commit + 双端推送,文档随批更新。引擎数据面约束全部在 astravia 仓库内解决(不改 dbx 引擎仓库):introspection SQL 枚举子对象(复用 listCatalogScopes 先例)、SELECT 心跳探活、confirmed-binding 单发进程放行危险写。

### 批次 1 —— 引擎数据面补齐(#4 健康轮询 + #5 树深子对象)✅ 已落地

- **#5 树深枚举** ✅：主进程按 `DbCatalogFamily` 生成 introspection SQL 枚举表级子对象 → 索引/约束/触发器/分区四类,经 `dbx_execute_query`(只读 SELECT)取回解析(`tableObjectIntrospectionSql`/`extractTableObjectNames`,SQLite flat 不枚举);IPC + preload + api-types 透传(`DbTableObjectKind`/`listTableObjectNames`);explorer model 增 `objectsOf`/`ensureObjectsForTable`/`reloadObjects`,随表展开懒加载;树内表行下渲染子对象分区(空整块隐藏)。单测 +9。commits: `b2b7ec5`(数据面)、`c699d9d`(UI 层)。
- **#4 健康轮询** ✅：已测连接每 60s 只读心跳(`SELECT 1`,复用 sql-safety 读通道/executeQuery 通道),写回 `testSnapshots` 刷新状态点 ok/failed;`document.hidden` 暂停、手动测试(testing)去重、in-flight 去重、失败静默降级且持续重试自动恢复。commit: `a939f27`。

### 批次 2 —— 纯前端增强(#1 pin/拖拽 + #2 可见性过滤 + #3 全局搜索 + #7 工具条持久化) ✅ 已落地(commit `5ad889a`)

- **#1** ✅：连接分组/scope/表分区按容器独立 pin 置顶 + 同段拖拽重排(`explorer-order` 纯函数 + 单测 27);`ExplorerOrderableRow`/`RowPinButton` 行外壳;顺序持久化 localStorage(`astravia.db.explorer.v1.order`)。
- **#2** ✅：右键「隐藏该库/schema/表」写 exclude + 连接菜单「显示全部对象」一键还原(`explorer-visibility` glob 过滤,仅影响显示);配置持久化(`astravia.db.explorer.v1.visibility`);全部作用域/表被排除时整段收起。单测 +9。
- **#3/#7** ✅：搜索词/仅健康/全局搜索 Switch/排序/类型过滤持久化(`explorer-toolbar-state` localStorage);全局搜索开关仍为本地增强语义(引擎无服务端全量搜)。单测 +9。

### 批次 3 —— 破坏性/管理动作(#6 全链路 + #16 批量) ✅ #6 已落地(commit `a5c0866`);#16 已落地(commit 待回填)

- **危险写放行通道**:UI 危险确认后,以带 `DBX_MCP_CONFIRMED_WRITE_SQL` env binding 的**单发子进程**执行该条 SQL(引擎精确匹配放行,普通 UPDATE/DELETE 仍走现有 confirmedWrite);spawn 复用 dbx-mcp-client 按代隔离基建。审计日志记录动作+SQL+env。
- **表级套件**(树表右键):清空(TRUNCATE)/删除(DROP)/重命名(ALTER RENAME)/导出数据(CSV+JSON,经只读 SELECT 取数后前端生成);确认弹窗须输入表名(防误删)。
- **连接级**:删除连接已有 removeConnection,接入确认弹窗统一文案;重命名/连接参数编辑随现有表单扩展。
- **批量(#16)** ✅：树内表行行尾 hover 勾选进入批量态(跨连接勾选自动切单连接,对齐 dbx 对象浏览器);顶部批量动作条提供导出 CSV/JSON(逐表导出、逐次保存对话框,含视图)/批量清空/批量删除(仅表)。清空/删除先汇总确认(SQL 预览)→ 逐表走 confirmed-binding 单发写通道执行(逐条审计)→ 失败继续、汇总 成功 M/失败 N;失败表保留勾选可重试;truncate 刷新该表数据页、drop 关闭已删表数据页并移除树节点;结果横幅置树顶。i18n zh/en + 全量 check 通过。
- 查询面板 DDL:已是引擎通道,补强危险确认文案与审计即可。
