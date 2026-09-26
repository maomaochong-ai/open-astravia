# 数据库 @mention 整合实现计划

## Repository Research 结论

### 现状
- Astravia 已有 `window.astravia.database` IPC 全链路：`listConnections()` / `listTables(conn)` / `describeTable(conn, table)` / `getSchemaContext(conn)` — **无需新建 IPC**
- 当前 `@` 触发只打开**文件面板**（`useAtPanelModel` 读文件系统），`TriggerMatch` 只有 `slash|at` 两种
- Schema 注入只有**会话级**（scope 面板控制，`resolve-session-config.ts` → `buildDatabaseSchemaPrompt` 拼 system prompt），**没有 per-message 链路**
- `parseInputSegments` 用 `isAttachmentPath()` 过滤——`@connection.table` 不是绝对路径，**自然留作纯文本**，不会被误判为文件 token

### dbx-main 参考
- `aiTableMentions.ts`：纯文本解析 `@schema.table` / `@table` → 去重 → 传 `buildAiContext()`
- 发送时解析 → 拉 schema → 拼进本轮 prompt context（**per-message 注入**）

### 架构决策（Advisor 确认）

| 决策 | 选择 | 理由 |
|---|---|---|
| 触发机制 | 复用 `@` + AtPanel 加 Tab | TriggerMatch 只有 slash/at，引入新前缀（`@db:`）会和普通 `@word` 冲突 |
| Token 表示 | dbx 式纯文本 `@connection.table` | parseInputSegments 天然兼容（不是绝对路径→留作文本），不用造新 Lexical token |
| Schema 注入路径 | **per-message**（本轮注入） | 与 scope 面板的会话级注入**互补**而非替代——scope 管全局背景，@mention 管单次意图 |
| Schema 拉取层 | **desktop-app main 侧**（desktop-conversation-service.runTurn） | 复用 `guardConnectionAiAccess`，不需要跨包（coding-agent ↔ desktop-app）调 database-service |
| connectionAiAccess guard | per-message 路径也必须生效 | 刚修的死写入 bug 不能在新链路复现 |

### 与现有 scope 面板的关系
- **SchemaInjectionScopePanel 保留不动**——它是会话创建时一次性注入 system prompt 的**持久背景知识**
- 新 @mention 是**单次对话意图**——用户在输入框 @某表 = 本轮必须带上这张表的 schema
- 两者独立运行，AI 模型同时看到：系统给的 scope 背景 + 用户本轮 @mention 指定的表

---

## Files and Modules

### Renderer 侧

**AtPanel 数据源扩展（加 Database Tab）**
- `packages/desktop-app/src/renderer/domains/chat/hooks/useAtPanelModel.ts` — 重构：按 tab 切换数据源（Files ↔ Database），新增 `mode: "files" | "database"` 状态 + `listDatabaseEntries()` 异步加载连接→表层级
- `packages/desktop-app/src/renderer/domains/chat/components/at-panel/types.ts` — `AtPanelProps` 加可选 `mode` / `onModeChange`；`SelectedFile` 改成 union type 兼容数据库表选择结果
- `packages/theme-ui/src/chat/AtPanelView.tsx` — header 区加 tab 切换按钮（文件图标 / 数据库图标）

**输入处理**
- `packages/desktop-app/src/renderer/domains/chat/components/input-bar/useInputBarModel.tsx` — `handleAtSelect` 处理新的数据库表选择结果，插入纯文本 `@connection.table`（`insertPlainText`）
- `packages/desktop-app/src/renderer/domains/chat/components/input-bar/editor/inputEditorHandle.ts` — 新增 `insertMentionToken(name, table, opts)` 辅助

**发送链路**
- `packages/desktop-app/src/renderer/domains/chat/hooks/useSessionManager.ts` — `sendMessage` 时从文本解析 `@conn.table` mentions，放入 `options.metadata.databaseMentions: Array<{ connection: string; table: string }>`

**@mention 解析工具**（dbx 逻辑移植）
- 新建 `packages/desktop-app/src/renderer/shared/lib/db-mentions/parse.ts` — 从 dbx 的 `aiTableMentions.ts` 移植：`parseDbTableMentions(text)` → 返回 `Array<{ connection: string; table: string }>`，兼容裸 `@table`（按已连接数据库自动补 connection）

**i18n**
- `packages/desktop-app/src/shared/i18n/locales/zh/chat.json` + `en/chat.json` — AtPanel tab 文案 + 空状态文案

### Main 侧

**desktop-app 主进程**
- `packages/desktop-app/src/main/conversations/desktop-conversation-service.ts` — `runTurn` 在调 `this.runtime.prompt()` 前，解析 `options.metadata.databaseMentions` → 对每个 mention 调 `databaseService.describeTable()`（**先过 guardConnectionAiAccess**）→ 拼成 `<database_table_context>` XML 隐藏上下文 → 合并进 prompt metadata（新字段 `databaseTableContexts: string[]`）或直接追加到 prompt.text 末尾
- `packages/desktop-app/src/main/database/database-service.ts` — `describeTable` 已经有 guard（上一轮刚加的），不需要再改

**coding-agent input-pipeline**
- `packages/coding-agent/src/core/session/input-pipeline.ts` — 如果 desktop-app 拼进了 metadata，这里消费（类似 `buildPromptAttachmentContext` 模式）；如果 desktop-app 直接追加到 prompt.text 末尾，则无需改动

---

## Implementation Steps（依赖序）

### Phase 1 — Renderer: @mention 解析工具 + 纯文本插入

1. 新建 `shared/lib/db-mentions/parse.ts`，移植 dbx 的 `parseAiTableMentions` 逻辑，适配 Astravia 语法（`@connection.table`）
2. 新建纯函数单测 `parse.test.ts`，覆盖：`@conn.users` / 裸 `@users`（需 connection 上下文补全）/ 去重 / 带引号 / 与 `@skill:` / `@/path` 共存不误解析
3. `insertMentionToken` 辅助函数（插入纯文本 `@conn.table` 并 replaceTrigger）

### Phase 2 — Renderer: AtPanel Database Tab

4. `theme-ui/AtPanelView.tsx` — header 加 tab 按钮组（Files / Database），active tab 用 primary color 高亮
5. `at-panel/types.ts` — `AtPanelEntryModel` 扩展支持数据库连接（icon 不同）和表（按连接分组显示）；加 `mode` 状态字段
6. `useAtPanelModel.ts` — 大重构：
   - 新增 `mode` state + mode 切换时 reset entries
   - `mode === "files"`：保留现有文件系统逻辑
   - `mode === "database"`：异步调 `window.astravia.database.listConnections()` → 显示连接列表（折叠）→ 点击连接调 `listTables(conn)` → 按搜索过滤表名
   - 键盘导航兼容两种 mode
7. `useInputBarModel.tsx` — `handleAtSelect` 处理两种 SelectedItem（文件/数据库表），数据库表走 `insertMentionToken("@conn.table", { replaceTrigger: true })`
8. AtPanel 默认 mode：如果数据库有连接且 AI 感知开启 → 默认 Database tab，否则 Files

### Phase 3 — Renderer: 发送链路解析 mention

9. `useSessionManager.sendMessage` 尾部：`const mentions = parseDbTableMentions(rawText)` → 去重 → 放进 `options.metadata.databaseMentions`
10. 注意：**不**从 `InputSegment` 解析——mention 是纯文本，只能从 rawText 解析

### Phase 4 — Main: per-message schema 注入

11. `desktop-conversation-service.ts` — runTurn 里加 `buildMentionedTableContexts(metadata)`：
    ```
    for (const { connection, table } of metadata.databaseMentions ?? []) {
      guardConnectionAiAccess(connection) → 跳过被拒绝的
      if (conn ai access 关闭 && prod 环境) → skip + console.warn
      const cols = await databaseService.describeTable(connection, table)
      const formatted = formatMentionedTableSchema(cols, table, connection)
      contexts.push(formatted)
    }
    拼成 XML → 追加到 prompt.text 末尾（或 metadata.databaseTableContext）
    ```
12. `formatMentionedTableSchema` — 纯函数，列/类型/PK/nullable/索引 → 格式化文本（类似 dbx 的 SchemaTable 格式，简化版）
13. 单测覆盖：guard 拦截 + 空结果 + 部分失败静默跳过

### Phase 5 — 验证

14. `bun run check` → 全绿
15. 单测：db-mentions parse（~10 cases）+ desktop-conversation-service 的 mention 解析链路（~5 cases）
16. 端到端手动测试：
    - 对话框 `@` → 切换到 Database tab → 选连接 → 选表 → 发送
    - main 进程收到 prompt 后 schema 拼进上下文
    - prod 连接 AI 访问关闭时 @mention 被拦截

---

## Dependencies and Considerations

- **connectionAiAccess guard**：必须在 desktop-app 侧（runTurn 里）而非 renderer 侧调——renderer 读 config 能判断 AI access，但 guardConnectionAiAccess 在 main 侧，避免 renderer 和 main 口径漂移
- **AI agent 工具可用性**：@mention 注入的 schema 是纯文本放进 prompt context，不需要 agent 额外用 Read 工具——直接在 system/user message 里看到表结构
- **与 scope 面板的交互**：scope 面板的 schema 注入在会话创建时完成（system prompt），@mention 的注入在每轮 sendMessage 后追加——两者独立，scope 里已有的表不会和 mention 重复（但会出现两次，AI 自己去重）
- **dbxToolEnabled 开关**：当前 per-message schema 注入**不依赖** dbxToolEnabled——即使关闭了 AI agent 的数据库工具，用户 @mention 的表 schema 仍然注入 prompt 背景。这是合理的：@mention 是用户显式意图，"我要这张表的信息"，和是否允许 agent 直接执行查询是两回事

---

## Validation

- `bun run check` 全绿（Biome + tsgo + desktop tsc + guards × 2）
- 新增单测：`packages/desktop-app/src/renderer/shared/lib/db-mentions/parse.test.ts`（~10 cases）
- 新增单测：desktop-conversation-service 的 mention 处理链路（~5 cases，mock databaseService）
- 手动测试：在对话框 @一个已连接数据库的表 → 发送 → 检查 AI 回复是否引用了表结构

---

## Risks

- **AtPanel 重构破坏文件面板功能**：重构 useAtPanelModel 时必须保持文件 mode 行为不变——加 tab 前先跑一轮文件面板手动测试
- **@connection.table 格式与用户手敲冲突**：如果用户在消息里手敲 `@something.something`（非数据库表），会被误解析。缓解：renderer 发送时只解析**在 window.astravia.database.listConnections() 返回的连接中存在的** connection.name 作为前缀——不存在的 connection.table 留作纯文本不误处理
- **describeTable IPC 延迟阻塞发送**：发送时拉 schema 是异步的。如果用户 @ 了一个需要 2s 才能 describe 的大表，sendMessage 会卡 2s。缓解：前端乐观发送，schema 拉取在后台进行，拉完再注入（或加 loading 状态提示）
- **connection 重名问题**：如果两个不同数据库同名表，`@users` 裸写有歧义。缓解：强制 `@connection.table` 格式（不支持裸 `@table`），与 dbx-main 略有不同但更安全
