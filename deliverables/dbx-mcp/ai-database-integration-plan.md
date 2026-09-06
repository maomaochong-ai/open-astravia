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

### 阶段 P1:对话注入 API 与「应用 SQL」通道(预估 1 天)
**范围**:
- chat 域提供轻量注入事件:`ask-with-anchor(anchor)` —— 把锚点置顶为系统说明并切换到 database 会话(若 chat 已支持会话切换)。
- database 域在对话消息的 SQL 块上提供「在新查询打开」动作:
  - 提取 SQL → 走既有 `query.actions.addTab(connectionName, sql)` → 用户自行执行;
  - 或「执行」:经 sql-safety clamp,非危险 SQL 直接进当前 tab 执行;危险 SQL 走 danger confirm(`runConfirmed`)。
- IPC/preload 类型最小扩展(如 `runConfirmed` 已存在则仅补 anchor 传输类型)。
**验证**:
- 单测:动作 handler 对 DDL/`DROP` 等被 clamp 拒绝;SELECT 正常入 tab。
- 手动:对话生成 SELECT → 一键打开 → 执行出结果;生成 `DROP TABLE` → 被拦截并提示 danger。

### 阶段 P2:编辑器与历史/结果就近入口(预估 1 天)
**范围**:
- 编辑器工具栏加「问 AI」按钮:锚点=`{connection, sqlText: 编辑器当前 SQL, source:"editor"}`。
- DatabaseQueryHistoryPopover 每条历史加「AI 分析」:锚点=`{connection, sqlText: entry.sql, source:"history"}`,附加条目的执行时间/状态(若已存)。
- 结果页脚(或结果工具栏)加「AI 分析结果」:锚点=`{connection, table?, source:"result"}`——若来自打开表,带表结构;自由 SQL 则带 SQL 文本,不带行数据。
**验证**:
- 就近入口点击后,chat 中出现对应系统说明与锚点;文案 en/zh;`recordSettingsUsage` 有记录。

### 阶段 P3:体验打磨与容量确认(预估 0.5-1 天)
**范围**:
- 会话锚点切换时清理旧说明(防串上下文)。
- 长 SQL 截断 / 超长表结构摘要的 token 预算提示(沿用 chat 域策略)。
- 是否开放「结果行级上下文(用户选中行 → 让 AI 解释)」:默认不做,标记为后续可选。
- 视觉对齐 dbx:编辑器区是否需要一个常驻的「AI 抽屉」开关,或保持按钮式唤起——**实施前与用户确认交互偏好**(见「待确认」)。

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

## 6. 里程碑
| 里程碑 | 内容 | 产出 |
| --- | --- | --- |
| M1(P0+P1) | 锚点 + 应用 SQL 通道 | 端到端「问 AI → 生成 → 执行」 |
| M2(P2) | 就近入口三处 | 与 dbx 交互对齐 |
| M3(P3) | 打磨 + 交互确认项 | 视觉/文案/容量对齐 |
