# 数据库工作台「连接树」差异分析（对照 dbx 桌面壳）

> 分析范围：Astravia `packages/desktop-app` 数据库工作台左侧连接树 vs 参考桌面壳
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
