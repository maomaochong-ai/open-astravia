# Astravia 数据库工具界面承载方案（三层分工 + 活动面板触发式）

> 状态：方案已定案（用户确认 2026-08-15）；B2.6-R/U/V1 已实施，**B2.6-V V2 连接树升级已实施完成（2026-08-16，sticky 搜索区 + 节点右键菜单 + 分组管理 + i18n/埋点/单测，`bun run check` 全绿，见 §七阶段 4）**；**B2.6-V V3 查询面板升级已实施完成（2026-08-16，CodeMirror SQL 高亮 + Ctrl+Enter 执行 + 查询历史，并修复 V2 搜索「未展开连接的表搜不到」问题，`bun run check` 全绿，见 §七阶段 4）**；**B2.6-V V4 结果网格升级已实施完成（2026-08-16，工具栏导出 CSV/JSON + 复制 + 加载更多 + 列排序 + 长单元格详情，`bun run check` 全绿，见 §七阶段 4）**；**B2.9 双向联动增强已实施完成（2026-08-16，W1 查询同步通道 + W2 开场白重设计 + W3 触发补全，`bun run check` 全绿，见 §七阶段 5）**；**2026-08-15 晚新增用户反馈 4 点（工作台问数入口 / 连接详情卡片化 / 添加连接表单高度遮挡 / 打开工作台跨路由无反应），改进定案见 §七阶段 6（B2.6-W W1–W4 已实施完成）**；**2026-08-16 新增用户反馈 4/5/7（关键信息行卡片化 / AI 感知级别评估与「开关关闭后对话仍可访问」根因 / 设置面板与工作台 AI 感知开关与 AI 协助配置的功能定位与权限转向方案），定案见 §七阶段 7（B2.10-W1 值区圆角容器 + W2 AI 访问开关 + W3 AI 协助功能定位已实施完成，2026-08-16，`bun run check` 全绿；W4 感知级别细化与 B3.1 环境标记待排期）**
> 关联文档：`../research/dbx-main-integration-evaluation.md`、`dbx-main-integration-tasks.md`（B2.9 / B2.6-W）、`rebrand/品牌落地蓝图.md`（§十三/§十四/§十五）、`docs/plugin/ui-slots.md`、ADR-0026 / ADR-0031 / ADR-0049

---

## 一、背景与问题

### 1.1 目标

Astravia 定位为「内置数据库管理能力的 AI 代理」。除 AI 对话操作数据库外，还需提供经典数据库工具界面（连接/表树、SQL 执行与结果网格、「打开表」浏览），与 AI 对话并存互补、双向联动。

### 1.2 已否决的做法

此前原型把完整的数据库工具界面（连接/表树、SQL 编辑器、结果网格）整体放入**设置面板**。该做法存在三个问题：

1. **职责错位**：设置面板（`/settings/*`）应承载「基本或通用的配置功能」——模型、外观、上下文、MCP 等；数据库工具界面是高频工作场景，不是配置项。
2. **空间受限**：三栏工具布局（连接树 280px + 查询区 + 详情 320px）在设置面板的容器内无法充分展开，网格与 SQL 编辑体验被压缩。
3. **入口割裂**：工具界面埋在设置页深处，用户每次使用都要经过「设置 → 数据库」，不符合高频工具的使用习惯。

### 1.3 用户诉求（2026-08-15 确认）

- 设置面板只承载「基本或通用的配置功能」；
- 数据库工具界面 MVP（侧边栏入口、连接/表树、SQL 执行与结果网格、「打开表」浏览）应通过**机制触发**后，在**活动面板（Activity Panel）**中展示；
- 界面配色必须与当前激活的主题响应式变化，如默认主题色。

---

## 二、现状盘点（代码证据）

| 承载位置 | 现状代码 | 结论 |
|---|---|---|
| 侧边栏 | `useSidebarModel.ts` 的 `PRIMARY_NAV_ITEMS` 已含「数据库」常驻项：`{ type: "route", path: "/database", labelKey: "sidebar.nav.database", icon: "icon-[solar--database-linear]" }` | 入口**已存在且位置正确**（主区域常驻，与核心能力同级），符合集成评估文档定案 |
| `/database` 路由 | `DatabasePage.tsx` → `DatabaseConnectionsWorkspace.tsx`（B2.6-R 收窄后）：连接配置管理（列表/新增/编辑/删除/测试/AI 感知开关）+ 工作台入口 | ✅ 已收窄为配置管理，三栏工具界面迁入活动面板 |
| 设置面板 | `DatabaseConnectionsWorkspace.tsx`（B2.6-V V1 后）：全局配置区（AI 感知开关 + 引擎 Notice）+ 连接管理区 + 「打开数据库工作台」入口 | ✅ 已瘦身：不再含三栏工具界面，职责为全局配置 + 连接生命周期管理 |
| 活动面板 | `activity-panel/builtins/database-tab.tsx`（B2.6-R2 已注册：id `database`、order 5、builtin、图标 solar--database-linear）+ `databaseTabTargetAtom` 一次性目标传递 | ✅ **数据库 Tab 已存在**（三栏工具工作台）；显隐按会话 cwd 持久化（ADR-0026）；「+」菜单待 UI 实测 |
| 数据库域 | `domains/database/`：`database-api.ts`、`sql-dialect.ts`、`result-grid.ts`、`DatabaseExplorerTree` / `DatabaseQueryPanel` / `DatabaseResultGrid` / `DatabaseConnectionForm` / `DatabaseConnectionDetails` 及三个 model hook | 组件与领域逻辑**已齐备**，可按承载位置拆分复用 |
---

## 三、承载架构：三层分工

```
┌─────────────────────────────────────────────────────────────────────┐
│ ① 侧边栏（常驻入口）       ② 活动面板（触发式工具界面）  ③ 设置面板（配置）│
│                                                                    │
│  新会话 / 自动化 / 知识库     ┌─ Activity Panel ─────┐    /settings/* │
│  数据库 ★（/database 路由）   │ 文件│待办│数据库★   │    通用/模型/    │
│  能力                        │ ┌─────────────────┐ │    外观/上下文/   │
│                             │ │ 连接树 + 表树     │ │    数据库(配置)  │
│  全功能工作区：               │ │ SQL 快捷执行      │ │  ┌───────────┐ │
│  连接树 │ SQL │ 结果 │ 详情   │ │ 结果网格          │ │  │ 连接列表   │ │
│                             │ │ 「打开表」浏览     │ │  │ 增删改/测试 │ │
│                             │ └─────────────────┘ │  │ 凭据管理    │ │
└─────────────────────────────────────────────────────────────────────┘
```

| 层 | 承载位置 | 内容 | 形态 |
|---|---|---|---|
| **① 主工作区** | 侧边栏「数据库」→ `/database` | 完整 `DatabaseWorkspace`：连接树 + SQL 查询面板 + 结果网格 + 连接详情 | 全屏路由，深度工作 |
| **② 工具面板** | 活动面板「数据库」Tab（新增） | 轻量工具界面：连接/表树 + SQL 快捷执行 + 结果网格 + 「打开表」浏览 | 触发式面板，随用随开 |
| **③ 配置** | 设置面板「数据库」页 | 纯连接管理：连接列表增删改查、测试连接、凭据管理（走 capability-sdk） | 配置页，不做工具 |

**原则**：
- 三层共用同一套 `domains/database/` 领域组件与 API，不重复实现；
- ① 是深度场景，② 是轻量随取场景，③ 是配置场景，三者职责不重叠；
- ② 与 AI 对话双向联动：对话中执行数据库操作后自动上栏并打开；面板中「让 AI 分析此表」携带 schema 跳转对话。

---

## 四、活动面板「数据库」Tab 设计

### 4.1 Tab 注册（内置，非插件）

在 `activity-panel/builtins/` 新增 `database-tab.tsx`，并加入 `BUILTIN_ACTIVITY_TABS`：

```ts
// activity-panel/builtins/database-tab.tsx
export const databaseTabDefinition: ActivityTabDefinition = {
	id: "database",
	order: 60,                       // 排在待办/后台任务附近
	initiallyVisible: false,         // 默认不上栏，由触发机制上栏/打开
	source: "builtin",
	useMeta: () => ({                // 有已配置连接时才进候选（可选收敛）
		label: t("activityTab.database.label"),
		icon: "icon-[solar--database-linear]",
		badge: connectionCount > 0 ? connectionCount : undefined,
	}),
	component: DatabaseToolPanel,    // 见 4.2
};
```

要点：
- `initiallyVisible: false` —— 符合「被机制触发后展示」，避免与文件/待办常驻争抢标签栏；
- 显隐按会话 cwd 持久化（ADR-0026），用户手动隐藏后不会被重复触发覆盖；
- 面板内布局遵守面板类 slot 边界（禁止 viewport 级 fixed / portal，见 `styling-and-pitfalls.md`）。

### 4.2 面板组件：`DatabaseToolPanel`

复用 `domains/database/` 现有组件，按面板宽度（建议默认 560px，`openActivityTab` 首开时 `width: "max"` 亦可）紧凑布局：

```
┌─ DatabaseToolPanel ─────────────────────────────┐
│ 连接 ▾ [本地 PostgreSQL]        ● 已连接   [+ 新建]│
│ ┌─ 表树 ────────────────────────────┐  ┌─ SQL ─┐ │
│ │ public                            │  │ SELECT│ │
│ │  ├─ users (12,340)               │  │ …     │ │
│ │  ├─ orders (45,102)              │  │ [▶ 执行]│ │
│ │  └─ products (1,028)             │  └───────┘ │
│ └───────────────────────────────────┘           │
│ ┌─ 结果网格（最近一次查询 / 打开的表）──────────┐ │
│ │ id │ name      │ email        │ created_at   │ │
│ │ 1  │ 张三      │ …            │ 2026-08-01   │ │
│ │ …  │           │              │              │ │
│ │ [100 行上限 · 分页 ▸]  [让 AI 分析此表 →]    │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

组件拆分建议（不动领域层，只做布局壳）：

| 新组件 | 复用 | 说明 |
|---|---|---|
| `DatabaseToolPanel` | `useDatabaseWorkspaceModel` + `useDatabaseExplorerModel` + `useDatabaseQueryModel` | 面板壳，`useActivityTab()` 取 cwd |
| `ToolConnectionSwitcher` | `DatabaseTypeBadge` / `DatabaseStatusPill` | 顶部连接切换 + 新建入口 |
| `ToolExplorerTree` | `DatabaseExplorerTree` | 表树（连接级折叠，默认展开当前连接） |
| `ToolQueryBox` | `DatabaseQueryPanel`（降级为单行/双行输入） | SQL 快捷执行，`Enter` 执行 |
| `ToolResultGrid` | `DatabaseResultGrid` | 结果网格，只读 + 分页 + 「打开表」 |

### 4.3 触发机制（多入口联动）

| 触发入口 | 位置 | 行为 | 状态 |
|---|---|---|---|
| **A. 页面按钮** | `/database` 与设置页头部「打开数据库工作台」 | 激活活动面板 database tab（`setTabByProject` + `setPanelOpen` + `setPanelWidth("max")`），拉满宽度 | ✅ 已实施（B2.6-V V1 ③，`openWorkbench`） |
| **B. AI 对话联动** | 会话中 dbx 工具（`dbx_execute_query` 等）被调用时 | 上栏 + 打开并回填 SQL/结果（经 `databaseTabTargetAtom` 扩展） | ✅ 已实施（B2.9-W1 查询同步通道，2026-08-16） |
| **C. 设置页快捷** | 设置「数据库」页「打开数据库工作台」 | 同 A，从配置页直达工具 | ✅ 已实施（与 A 同一入口） |
| **D. 手动恢复** | 活动面板「+」菜单 | 用户手动从可添加池上栏（机制兜底） | ✅ 机制就绪（builtin restorable），待 UI 实测 |

> ⚠️ **2026-08-15 晚反馈（A/C 入口「无反应」根因）**：`ActivityPanel` 组件**只挂载于聊天视图**（`DefaultChatView` / `SessionViewerPage`），设置页 `/settings/$tab` 与 `/database` 路由的 `RootLayoutView` 仅渲染 `<Outlet />`，没有活动面板实例。A/C 按钮只写 `activityPanelTabByProjectAtom / activityPanelOpenAtom / setActivityPanelWidthAtom`，在非聊天路由下无组件消费 → 视觉无反应。兜底方案见 §七阶段 6-①（跨路由导航到聊天视图再开面板）。

实现位置：
- A/C：`DatabaseWorkspace` 与 `DatabaseConnectionManager` 头部新增按钮，调用宿主暴露的 `openActivityTab`；
- B：dbx MCP 工具调用结果渲染层（tool-call slot 或 `registerTurnCard`）订阅工具调用事件，命中 dbx 工具时触发联动。内置场景可直接调 activity-atoms；插件场景走 `ctx.ui.setActivityTabVisible` / `openActivityTab`（`plugin-loader.ts` 已实现）。

---

## 五、设置面板瘦身：纯连接管理

改造 `settings/components/DatabaseSettings.tsx`：

```tsx
// 改造前（错误）：整个工作区塞进设置页
export function DatabaseSettings() {
	return <DatabaseWorkspace />;
}

// 改造后：只保留连接管理配置
export function DatabaseSettings() {
	return <DatabaseConnectionManager />;   // 新壳：列表 + 表单 + 测试 + 凭据
}
```

`DatabaseConnectionManager` 复用现有 `DatabaseConnectionForm` / `DatabaseConnectionDetails` / `DatabaseStatusPill` 等组件，仅保留：

- 连接列表（增删改查、启用/停用、测试连接、状态）
- 连接表单（驱动类型、主机、端口、库名、凭据，走 capability-sdk 的 dbx 连接管理）
- 凭据安全提示（引导环境变量 / 系统钥匙串）

**不包含**：表树、SQL 编辑器、结果网格、「打开表」浏览 —— 这些属于工具界面，归属活动面板与 `/database` 路由。

---

## 六、配色与视觉对齐（必须遵守）

新界面一律消费产品语义 token（`renderer/styles.css` 已定义，Tailwind 类直接可用），**禁止另起一套色板**：

### Dark（默认）

| Token | 色值 | Tailwind 用法 |
|---|---|---|
| `--background` | `rgb(20, 22, 30)` | `bg-background` |
| `--card` | `rgb(26, 28, 36)` | `bg-card` |
| `--foreground` | `rgb(220, 224, 234)` | `text-foreground` |
| `--muted-foreground` | `rgb(138, 144, 160)` | `text-muted-foreground` |
| `--primary` | `rgb(99, 102, 241)` | `bg-primary text-primary-foreground` |
| `--muted` | `rgb(30, 30, 32)` | `bg-muted` |
| `--border` | `rgb(42, 45, 56)` | `border-border` |
| `--input` | `rgb(48, 51, 64)` | `border-input` |
| `--ring` | `rgb(129, 132, 248)` | `ring-ring` |
| `--destructive` | `rgb(255, 91, 91)` | `text-destructive` |
| `--radius` | `0.5rem` | `rounded-lg`（≈8px） |

### Light

| Token | 色值 |
|---|---|
| `--background` | `rgb(255, 255, 255)` |
| `--primary` | `rgb(79, 70, 229)` |
| `--muted` | `rgb(242, 242, 242)` |
| `--muted-foreground` | `rgb(82, 82, 82)` |
| `--border` | `rgb(230, 230, 230)` |

### 视觉规范要点

1. **主色只用 indigo**（`#6366F1` Dark / `#4F46E5` Light），高亮、选中、按钮、链接、图表主色全部收敛到它；
2. 表面层次用 `background → card → muted` 三级，禁止近黑 `#0d0d0f` 这类独立色板；
3. 数据网格：表头 `text-muted-foreground` 小号字 + `border-border` 分隔，行 hover 用 `bg-muted/50`；
4. 状态色：成功 `#4CC38A` 系沿用产品 chart 色板（`--chart-1` 等），错误用 `--destructive`；
5. 图标统一 `solar` 集（产品惯例，侧边栏/数据库入口已是 `icon-[solar--database-linear]`）；
6. 圆角统一 8px（`--radius: 0.5rem`），面板内元素可 6px（`--radius-sm`）。

---

## 七、实施步骤

### 阶段 1：设置面板瘦身（先行，风险低）✅ 完成（B2.6-R3 + V1）
1. ✅ `DatabaseConnectionsWorkspace` 壳组件（复用连接相关组件）；
2. ✅ `DatabaseSettings.tsx` / `DatabasePage.tsx` 只渲染连接管理；
3. ✅ 回归：三栏工具界面迁入活动面板，职责分离完成。

### 阶段 2：活动面板数据库 Tab ✅ 完成（B2.6-R2）
1. ✅ `activity-panel/builtins/database-tab.tsx`（definition + 三栏 `DatabaseWorkspace`）；
2. ✅ 加入 `BUILTIN_ACTIVITY_TABS`；
3. ✅ A/C 按钮触发（`/database` 页 + 设置页「打开数据库工作台」）；
4. ✅ B AI 联动（dbx 工具调用 → 上栏/打开 + SQL/结果回填）→ **B2.9-W1（2026-08-16）**；
5. ⏳ 验证：手动触发 ✅ / AI 触发 ✅（B2.9-W1）/ 用户隐藏后不再被覆盖（ADR-0026，待 UI 实测）。

### 阶段 3：视觉与 AI 双向联动 ✅ 完成（B2.7 v1 + B2.9 v2，2026-08-16）
1. ✅ 按第六节规范统一配色（语义 token，U4 线条清理）；
2. ✅ 面板中「让 AI 分析此表」→ 预填可编辑开场白 + schema 待发注入（B2.9-W2，2026-08-16）；
3. ✅ 对话中「在界面打开结果」→ 激活活动面板并选中连接/表（B2.7 v1）；✅ SQL/结果回填（B2.9-W1）；✅ 工作台「问数」入口（B2.6-W4 + B2.9-W3 埋点）。

### 阶段 4：工作台对齐 dbx-main（渐进逼近，V2–V6）✅ V2 连接树升级已完成（2026-08-16）；✅ V3 查询面板升级已完成（2026-08-16）；✅ V4 结果网格升级已完成（2026-08-16）；✅ V5 标签页壳多查询标签已实施（2026-08-16，见下方条目）；V6 待实施
1. ✅ **V2 连接树升级（已完成 2026-08-16，`bun run check` 全绿）**：sticky 搜索区（debounce 300ms + 连接/表名过滤 + 搜索自动展开，`databaseSearchConnections`）+ 节点右键菜单（打开表/刷新/复制名/展开收起/分析表，新增 `DatabaseExplorerContextMenu`，埋点 `explorer-refresh`/`explorer-copy-name`）+ 分组管理（按 `groupPath` 首段分组 + 组头折叠，`lib/database-tree.ts` 纯函数 + 单测）+ i18n zh/en。
2. ✅ **V3 查询面板升级（已完成 2026-08-16，`bun run check` 全绿）**：修复 V2 搜索「未展开连接的表搜不到」问题（搜索时对所有连接自动触发表数据加载 + 忽略组折叠）+ CodeMirror SQL 高亮（theme-ui 新增 `@codemirror/lang-sql`，`TextCodeEditorView` 受控 value/placeholder，`DatabaseQueryPanel` 换用编辑器）+ Ctrl+Enter 执行 + 查询历史（`lib/query-history.ts` localStorage 持久化，50 条去重置顶，浮层回填）+ i18n zh/en + 埋点 + 单测。V5 标签页壳多查询标签已实施（见下方条目 4）；V6 收尾。
3. ✅ **V4 结果网格升级（已完成 2026-08-16，`bun run check` 全绿）**：工具栏（导出 CSV/JSON + 复制结果 + 行数统计）+ 加载更多（仅「打开表」结果，100→200→300…）+ 列排序（表头点击循环 + 排序指示）+ 长单元格详情对话框（截断 + 查看全文/复制）+ i18n zh/en + 埋点 + 单测。V5 标签页壳多查询标签已实施（见下方条目 4）；V6 收尾。
4. ✅ **V5 标签页壳多查询标签（已实施 2026-08-16，`bun run check` 全绿；评估结论见品牌落地蓝图 §二十二，实施记录见 §二十三 / 任务清单 B2.6-V V5）**：`useDatabaseQueryModel` 单实例 → tab 数组（新增 `lib/query-tabs.ts` 纯函数模块 + 每 tab 独立 sql/status/result/error/openTableMeta/loadingMore + 标题；查询历史保持全局共享）；中栏顶部复用 theme-ui `TabBar`（激活滑动指示 / 拖拽排序 / 溢出收纳 / hover 减号关闭，零组件改动向后兼容）+「+」新建按钮 + 溢出下拉（DropdownMenu）；目标 tab 路由：打开表→**新建 tab**、AI 回填→**激活 tab 覆盖**、历史重放→**激活 tab 回填**、执行→**当前 tab**；i18n zh/en（`databaseQueryTab`/`databaseNewQuery`/`databaseMoreTabs`）+ 埋点（`query-tab-new/switch/close/reorder/open-table`）+ 单测（`query-tabs.test.ts` 12 例，数据库域 63 例全过）。V5.1（固定/重命名/复制/脏标记+关闭确认/右键菜单/连接配色 ≈ 1.5–2.5 人天）待排期；**V6 收尾待实施**。
2. 参照 dbx-main `apps/desktop/src/components/` 对应组件，每阶段收尾执行双视角代码审查 + `bun run check`。

### 阶段 5：双向联动增强 v2（B2.9，2–4 人天）✅ 已完成（W1–W3，2026-08-16，`bun run check` 全绿）
1. ✅ **W1 查询同步通道**（核心）：监听 dbx 工具调用 → 激活工作台 → `databaseTabTargetAtom` 扩展传递 `{ connection, sql, result }` → 查询面板回填 SQL + 结果网格显示结果；反向「让 AI 解读此查询」**已实施（2026-08-18，结果网格工具栏按钮 → 打开后台会话 + 预填开场白 + SQL/结果摘要经 pendingAssistSendAtom 注入，`lib/result-summary.ts` 摘要纯函数 + 单测 6 例，`bun run check` 全绿，详见任务清单 B2.9 反向实施记录）**。
2. ✅ **W2 AI 开场白重设计**：预填可编辑开场白（`inputValueAtom` + 聚焦）+ 自然问句文案（i18n zh/en）+ `pendingAssistSendAtom` 待发注入；「直接发送」配置项未实施（保持预填制）。
3. ✅ **W3 触发补全**：dbx 工具调用自动上栏（W1 顺带）；工作台「问数」入口（B2.6-W4）；埋点 4 事件点；「+」菜单 UI 实测待排。

### 阶段 6：反馈 4 点改进定案（2026-08-15 晚新增反馈，1–2 人天）✅ 已完成（B2.6-W W1–W4）

1. **打开工作台跨路由兜底（反馈 1）**：`openWorkbench` 在非聊天路由（设置页 / `/database`）点击时先 `navigate("/")` 到聊天视图，再激活活动面板 database tab（拉满宽度）；保持三层分工，**不**全局挂载 ActivityPanel（与「设置页只承载配置」定位冲突）。
2. **连接详情卡片化（反馈 1/4）**：管理/工作台两视角详情改用 `DatabaseSurface` 卡片分组（连接信息 / 管理 / 测试结果各自成卡），标题区（`ConnectionIdentity`）与信息区视觉分层，解决「无层级、无卡片组织、太链接（平铺文本列表感）」。
3. **添加连接表单紧凑化（反馈 2）**：`DialogContent` 加 `max-h` + 内部滚动 + footer 粘底；测试结果 Notice 保持在可见区（或改独立结果展示），矮屏不再被遮挡。
4. **工作台「问数」入口（反馈 3，细化 B2.9-W3 ②）**：复用知识库 `SettingsAiAssist` 弹层形态（上下文「你正在「数据库工作台」」+ 示例 chips + 可编辑意图 + 提交），携带当前连接/表上下文跳转对话问数。✅ 已实施（B2.6-W4，`DatabaseWorkspace.tsx` 「问数」按钮，i18n zh/en `databaseAskData.*`）。

### 阶段 7：反馈 4 补充 + 反馈 5/7 定案（2026-08-16 新增反馈，规划定案）⏳ 待实施

**背景（2026-08-16 用户反馈）**：在 B2.6-W 已落地基础上，用户提出：连接详情关键信息行仍无圆角容器；AI 感知开关只有数据库级别且**开关关闭后对话仍能访问数据库**；需要站在生产/开发环境、管理员/普通用户角度明确设置面板与工作台 AI 感知开关 + AI 协助配置的功能定位与权限转向方案。

1. **反馈 4 补充 —— 关键信息行圆角容器（视觉优化）**：`InfoItem` 值区（mono 值 + 复制按钮）当前为纯文本平铺在卡片内，外层无圆角容器 → 值改为圆角容器（chip/field 形态，`rounded-md bg-muted/40 px-2 py-1` 或等效软填充），与卡片层级形成「卡片 → 信息项 → 值 chip」三级结构；label 保持 11px muted 行。验证：两视角详情层级分明，值区有明确容器边界。
2. **反馈 5 —— AI 感知级别评估 + 「开关关闭后对话仍可访问」根因（已核查，见下）**：
   - **感知（schema 注入）与访问（dbx MCP 工具）是两级解耦的能力**：`schemaInjection` 开关（`resolve-session-config.ts:61`）只控制会话创建时是否注入连接 schema 摘要（AI 知道表结构）；dbx MCP 工具（`dbx_execute_query` 等）由 `builtin-mcp-presets.ts` 的 dbx 预设独立注册、经 mcp.json 启用，**与感知开关无关**。
   - **根因**：开关关闭 → AI 不再拿到 schema 上下文，但 `dbx_execute_query` 工具仍在对话工具集中，AI 仍可调工具执行 SQL（只读 SELECT）访问数据库 → 「关闭后还能访问」符合当前实现，但不符合用户对「AI 数据库感知开关」语义的预期。
   - **感知级别评估**：当前为**全连接全量注入 + 全局开关**（无按连接/按表选择）；连接级 ✅（按连接组织注入块）、表级 ✅（整库表结构摘要）、列级 ✅ 部分（列名/类型/PK，无索引/外键/约束）。细化（连接级/表级选择注入）列入 B2.10-W4 待排期（V2 系列）。
   - **转向方案（B2.10，权限分离）——已实施（W1/W2/W3，2026-08-16）**：把「AI 数据库感知」拆为两级语义并落 UI：① **感知开关**（schema 注入，现状语义不变，文案澄清为「注入表结构供 AI 参考」，执行需另开访问开关）；② **访问开关**（新增 `database.dbxToolEnabled`，控制 dbx MCP 工具是否注册进对话工具集——经 mcp.json dbx `disabled` 与工具注册点联动，关闭后 AI 无法调 `dbx_execute_query` 访问数据库）。两级开关独立，默认均关；访问开关关闭即彻底阻断 AI 触库，感知开关仅控制 AI 是否看到表结构。落地：`desktop-config-store.ts` / `main/ipc/fs.ts`（`syncDbxToolAccessGate`，CONFIG_SET+MCP_SET 联动）/ `preload/api-types/config.ts` / `useDatabaseWorkspaceModel.ts` / `database-details-shared.tsx` `DbxToolAccessRow` / 设置页全局配置区 / i18n zh+en。
3. **反馈 7 —— 设置面板 vs 工作台 AI 感知开关 + AI 协助配置功能定位与权限转向方案（定案）**：
   - **角色视角**：管理员（连接配置者）vs 普通用户（数据使用者）；**环境视角**：生产 vs 开发。
   - **设置面板（管理员 · 配置视角）**：① 全局 AI 感知开关 + AI 访问开关（B2.10-W2 已实施）；② AI 协助配置 = **连接管理助手**（catalog examples 已为 add/test/remove，负责「帮我加一个连接」类操作，权限 = 连接生命周期管理；W3 已落 triggerLabel=「连接管理助手」）；③ 生产/开发环境标记（连接字段 `env: prod|dev`，排期 B3.1）。
   - **工作台（普通用户 · 操作视角）**：① AI 协助查询 = **问数入口**（B2.6-W4 已实施，`databaseAskData`，负责「帮我查/分析」类操作，权限 = 只读 SELECT，受引擎只读策略约束）；② 不重复挂全局感知/访问开关（收敛到设置面板）；③ 后续按需增加「仅注入当前连接/表 schema」的局部感知（B2.10-V2）。
   - **权限转向**：AI 对话使用数据库的权限 = 访问开关（能否调 dbx 工具）× 引擎只读策略（SQL 类型）× 连接可用性；普通用户使用数据库 = 工作台问数（只读）+ 界面工具（经典三栏，只读 SELECT）。写操作（DDL/DML）默认引擎拦截（B1.4 实测 `SQL_BLOCKED`），B3.1 再定制。

### 阶段 8：工作台验证问题修复（2026-08-16 用户实测反馈 3 点，⏳ 修复待实施）

**背景**：V2/V3/V4 + B2.9 双向联动链路落地后，用户实测发现 3 个问题（双击表查询失败 / 树表显示不全 / 对话执行 SQL 工具不存在且不回填）。根因核查（代码证据）与修复计划：

1. **双击表查询报 `relation "表名 (BASE TABLE) -- 注释" does not exist`（Bug 1）**：`listTables`（`database-service.ts`）解析正则 `/^(.+?)\s*\(([^)]+)\)\s*$/` 要求条目以 `(...)` 结尾，dbx 带注释的表（`- name (BASE TABLE) -- 注释`）不匹配 → else 分支把整条展示串当表名 → `buildOpenTableSql` 把标签串当 relation 生成 SQL。修复：解析前剥离尾部 ` -- 注释` 再匹配 kind，兜底分支同步剥离，补单测。
2. **连接树表显示不全（Bug 2，只显示 3 个表）**：渲染层与 `parseBulletList` 均无截断/过滤，缺口在 dbx `dbx_list_tables` 返回或主进程解析（候选：非默认 schema 未列出 / 输出截断 / Markdown 表格兜底列名不匹配丢行）。修复：运行时诊断对比实际表数 → 按返回格式补齐解析 → 必要时树节点显示 schema 限定名。
3. **对话执行 SQL 报 `Tool dbx_execute_query not found` 且不回填工作台（Bug 3）**：dbx 工具进对话工具集由 `database.dbxToolEnabled`（缺省关）经 `syncDbxToolAccessGate` 联动 mcp.json `dbx.disabled` 控制、会话初始化按此注册，当前会话无工具 → B2.9-W1 回填通道（`useSessionManager` 监听 tool.start/end）收不到事件；感知注入 prompt 指示 AI 调该工具，与工具缺失不一致。修复：开关引导文案 + 注入 prompt 补「无工具时说明并引导开启，不编造」+ 存量会话工具刷新评估。

---

## 八、风险与决策记录

| 项 | 说明 |
|---|---|
| 面板宽度 | 活动面板默认宽度有限，SQL 编辑与结果网格为紧凑模式；深度编辑引导至 `/database` 路由。`openActivityTab` 的 `width` 只在首次 attach 生效，用户拖宽后以用户为准 |
| 100 行上限 | `dbx_execute_query` 单次 100 行，面板与工作区都需在网格尾部提示「仅显示前 100 行 · 分页/导出见 B3」 |
| 显隐持久化 | 触发上栏按会话 cwd 持久化；异步判定注意丢弃过期结果（探测期间切走会话不再写） |
| 插件 vs 内置 | 本方案用**内置 tab**（数据库是产品核心差异化，非可选能力）；不排除未来按 ADR-0049 能力化演进 |
| 配色 | 任何新界面必须消费语义 token；设计稿已按本表对齐，可直接作为实现参考 |

---

## 附：设计稿对应关系

| 设计稿帧（design.vetd） | 对应承载层 | 说明 |
|---|---|---|
| `index` 数据库总览 | ① `/database` 路由首页 | 连接概览 + 快捷入口 |
| `workbench` 数据库工作台 | ① `/database` 全功能工作区 | 连接树 + SQL + 结果网格 + 详情 |
| `activity-panel`（新增） | ② 活动面板「数据库」Tab | 触发式工具面板形态 |
| `table` 表数据 | ② 「打开表」浏览 / ① 表浏览 | 只读网格 + 分页 |
| `connections` 连接管理 | ③ 设置面板「数据库」 | 纯连接配置（瘦身） |
| `connections-new` 新建连接 | ③ 设置面板内新建连接表单 | 表单 + 测试连接 |
