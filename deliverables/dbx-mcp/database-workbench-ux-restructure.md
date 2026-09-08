# 数据库工作台体验重构：问题分组 · 决策 · 实现方案

- 日期：2026-09-07
- 范围：活动面板标签栏 / 数据库工作台（图标体系、标签生命周期、查询面板、文件树、性能）
- 关联文档：[db-panels-tab-layout.md](db-panels-tab-layout.md)（三层分工与 V1–V6 落地）、[dbx-main-integration-evaluation.md](dbx-main-integration-evaluation.md)（方案 B 自有化路线）
- 对标代码库：`github-source-code/dbx`（dbx-main，`apps/desktop/src/components/layout/AppTabBar.vue`、`components/sidebar/ConnectionTree.vue` 等）

---

## 一、反馈清单 → 主题映射

| # | 用户反馈（原文要点） | 主题 | 主责代码 |
|---|---|---|---|
| 1 | 活动面板底部标签栏样式与图标不喜欢，尤其全屏显示标签页图标 | **A 活动面板标签栏视觉与全屏图标重构** | `packages/theme-ui/src/shared/TabBar.tsx`；`packages/desktop-app/.../activity-panel/components/activity-panel/ActivityPanelFullscreenToggle.tsx`、`ActivityPanelView.tsx` |
| 2 | 数据库「固定」按钮 pin 图标不好看，需重构 | **B 图标 / 按钮设计体系统一** | `domains/database/components/DatabaseExplorerTree.tsx` 行内工具、`explorer-row-tools.tsx` 等 |
| 3 | 数据库「添加连接」色块 + 图标碍眼，与其它图标格格不入 | **B 图标 / 按钮设计体系统一** | `DatabaseConnectionsWorkspace.tsx` / 设置页连接列表的空态与主操作 |
| 4 | 数据库工作台性能卡顿不流畅 | **F 性能优化** | 树渲染、TabBar 溢出测量、结果网格（见主题 F） |
| 5 | 数据库标签 tab 不能常驻，但可通过标签页菜单添加 | **C 标签常驻与跨会话记忆** | 活动面板 `useActivityPanelModel.ts`、`PluginTabPicker.tsx`、`ActivityPanelView.tsx` |
| 6 | 选中数据库标签后切会话再切回，跳到默认「文件」tab，未记住选中位置 | **C 标签常驻与跨会话记忆** | 活动面板状态生命周期（`useActivityPanelModel.ts` 状态源） |
| 7 | 工作台顶部按钮图标 / 文字 / 图标+文字混用，体系不一致 | **B 图标 / 按钮设计体系统一** | `DatabaseWorkspaceHeader`、查询面板工具栏、连接列表头等 |
| 8 | 查询面板上分标签页的设计与交互，对齐 dbx 参考 | **D 查询标签页对齐 dbx** | 查询 Tab 壳（V5 已落地基础）+ `lib/query-tabs.ts`；对照 dbx `AppTabBar.vue` |
| 9 | 文件树展开后与 dbx 差异大：约束 / 外键等对象可能已实现但未显示 | **E 文件树对象显示对齐 dbx** | 树对象数据面（`TABLE_OBJECT_KINDS` 上游 introspection）+ `DatabaseExplorerTree` 对象区 |

> 决策衔接：本方案是 [db-panels-tab-layout.md](db-panels-tab-layout.md) 中 **V5.1（固定/重命名/复制/脏标记/右键菜单/连接配色，原约 1.5–2.5 人天，待排期）与 V6 收尾**的扩展版，并新增此前未覆盖的 4 条反馈（#1、#3、#4、#7）。原「显隐持久化按会话 cwd」「配色消费语义 token」两条既有决策继续有效，本文在主题 C、A/B 中展开落地。

---

## 二、主题 A：活动面板标签栏视觉与全屏图标重构（反馈 #1）

### 2.1 现状（代码证据）

- 底部标签栏复用 theme-ui `TabBar`（`packages/theme-ui/src/shared/TabBar.tsx`，339 行）：激活页签为**上圆角卡片**（`rounded-t-lg` + `-ml-2` 叠瓦重叠 + 顶部亮边 + `bg-muted` + 投影），页签内**小图标 h-3.5 w-3.5 + 11px 文本**，关闭为 hover 时右上角**减号圆点**（`mdi--minus`）。
- 全屏切换按钮 `ActivityPanelFullscreenToggle.tsx`：位于标签菜单行「+」按钮左侧，**自绘 glyph**（圆角方框 + 四角实心三角），进入全屏/退出全屏仅靠三角朝向变化区分，语义弱、与相邻「+」及整行图标风格割裂。
- `ActivityPanelView.tsx`：全屏按钮（`tabMenuExtra`）仅在面板打开（`model.isOpen`）时渲染。

### 2.2 决策

1. **活动面板底部栏不再使用「编辑器页签」视觉**。底部栏定位是「面板开关/切换」，不是文档页签：改为**图标主导的扁平切换条**，每项 = 图标（16px）+ 可选徽标，激活态 = **左侧 2px 竖条（primary）**（竖排场景）或**底部 2px 横条**（横排场景），去掉卡片叠瓦/阴影。
2. **保留 TabBar 复用、不改其通用能力**：为不破坏编辑器/查询面板中 TabBar 的既有用法（V5 多查询标签同款），重构以「活动面板专用变体」进行——TabBar 新增 `variant: "panel-switcher"`（或活动面板侧独立轻量组件，二选一，见 2.3 取舍），图标颜色 inactive 用 `text-muted-foreground`、active 用 `text-foreground` + primary 指示条。
3. **全屏图标弃用自绘 glyph**：改用语义清晰的方向箭头图标（进入全屏 = `lucide--maximize`，退出 = `lucide--minimize`）；按钮迁入标签栏右端（与「+」/溢出菜单同组的工具区），尺寸统一 `h-6 w-6` 圆角 6、hover `bg-muted`。
4. 视觉与 i18n 既有约束：文案/aria 走既有 `tabFullscreen.*` key，新增 key 入 i18n；新样式只消费语义 token（`muted/foreground/primary/background`）。

### 2.3 实现方案

- **组件取舍**（先定后写）：
  - 方案甲（推荐，改动收敛）：TabBar 增加 `variant`，活动面板传 `variant="panel-switcher"`，内部切「图标 + 指示条 + tooltip(仅折叠)」渲染路径。
  - 方案乙：活动面板新建 `ActivityPanelSwitcher`，不再依赖 TabBar（与编辑器彻底解耦，但显隐/溢出/拖拽逻辑重复实现）。
- **改动清单**：
  1. `TabBar.tsx`：支持 `variant`；面板变体下隐藏 label（或折叠为 title）、active 指示条渲染、关闭按钮仅在「可移除」项 hover 显示。
  2. `ActivityPanelFullscreenToggle.tsx`：glyph 换 `lucide--maximize/minimize`（Iconify class，项目内通用做法）；从「+」左侧移到菜单行工具区末位。
  3. `ActivityPanelView.tsx`：组装新 variant + 新工具区顺序（溢出菜单「+」→ 全屏 → 面板菜单）。
  4. tab 图标供给处（`useActivityPanelModel` 的 `tabItems`）核对：数据库等内置 tab 图标 string(iconify) 统一 `h-4 w-4`。
- **验收**：底栏无卡片叠瓦；激活态为语义指示条；全屏图标为通用 maximize/minimize；hover/键盘可达；`bun run check` 全绿；zh/en 无硬编码。

---

## 三、主题 B：图标 / 按钮设计体系统一（反馈 #2、#3、#7）

### 3.1 现状（代码证据）

- 工作台顶栏/树行内工具中按钮形态混用：**纯图标**、**纯文字**、**图标+文字**并存；尺寸/圆角/描边各写各的（存在 `h-5`/`h-7`、`rounded-md` 混排、裸 iconify class 不包按钮态）。
- pin（固定/置顶）为自绘或旧图标，视觉弱且与行内其它按钮不一致。
- 「添加连接」入口为大色块 + 加号样式，与相邻图标行（刷新/展开收起/更多）风格割裂。

### 3.2 决策

1. **工作台内所有可点击图形元素收敛为两级按钮组件**（新建于 `domains/database/components/ui/` 或 theme-ui，命名随代码规范）：
   - `ToolbarButton`（主/次操作，图标 + 可选文字）：统一高度 28px（`h-7`）、`rounded-md`、内边距规范；primary 变体仅用于**每屏唯一主操作**（如「添加连接」「新建查询」）。
   - `IconButton`（纯图标）：统一 `h-6 w-6`、`rounded-md`、图标 `h-3.5 w-3.5`、inactive `text-muted-foreground`、hover `bg-muted text-foreground`、`transition-colors`；**全部带 title/aria-label（i18n）**。
2. **状态可见即层级**：常态 icon 灰阶（语义 token），唯一强调色留给「主操作按钮」「激活/选中态」「数据状态点（连接健康）」三类信息；数据库类型徽标/色块不再用品牌大色块（见 3.3-2）。
3. **pin 图标重构**：置顶（行内工具）与标签常驻（主题 C）共用**同一套 pin 图标视觉**——inactive 为线性 pin、active 为填充 pin，均经 IconButton 包裹；避免与「收藏/书签」混淆，语义为「钉住不随滚动/溢出消失」。

### 3.3 实现方案

1. **pin（#2）**：定位树行/表行的置顶工具与（未来）标签固定工具 → 统一 IconButton + `lucide--pin` / `pin-off`（active 填充 + primary）。行工具固定顺序：查询/打开表 → 置顶(pin) → 更多(⋯)。
2. **添加连接（#3）**：
   - 空态主操作：保留「添加连接」**文字主按钮**（primary，`h-8`，图标 `lucide--plus` 内嵌），删除大色块 tile。
   - 列表头/工具行：`ToolbarButton` ghost 变体（图标+文字「添加连接」）或 IconButton（`lucide--plus`）+ tooltip，与「刷新」「折叠全部」「更多」同级灰阶。
   - 连接行右侧类型徽标如存在彩色块 → 改灰阶文本（类型名）或 8px 连接色圆点（信息色仅保留健康状态与连接色）。
3. **顶栏统一（#7）**：工作台顶栏（连接级/查询级）按固定槽位模型排布：
   `[主操作(带文字)] │ [IconButton 组：刷新 / 展开收起 / 筛选] │ 弹性空 │ [状态区(连接点+类型)] │ [更多菜单 ⋯]`
   全屏宽度受限时主操作自动折叠为 IconButton。
4. **落地范围**：`DatabaseWorkspace` 顶栏、连接列表头、查询面板工具栏、树内行工具、设置页连接列表工具；替换后 grep 无残留裸 `h-5 w-5 rounded` 行内 button（保留合理例外并注释）。
5. **验收**：同一屏内无第三套按钮尺寸；所有纯图标按钮可 hover/聚焦反馈、有 tooltip；`bun run check` 全绿。

---

## 四、主题 C：标签常驻与跨会话记忆（反馈 #5、#6）

### 4.1 现状（代码证据）

- 数据库 tab 为**内置 tab**（非插件）；当前不可常驻 → 归入 `restorableTabs`，经标签页菜单 `PluginTabPicker`（`onRestore`）恢复上栏（反馈 #5 现状描述）。
- 活动面板激活状态（`activeTab`、可见集合、`fullscreen`）随**会话生命周期**存在；切换对话会话后按新会话默认 profile 重新解析 → 回到默认「文件」tab（反馈 #6 根因方向）。
- 既有风险记录：显隐持久化按会话 cwd；异步判定需丢弃过期结果。

### 4.2 决策

1. **「常驻」= 用户显式钉住**：数据库 tab 提供**钉住（pin）语义**——钉住后该 tab 常驻活动面板栏（不随默认集/溢出消失），与主题 B 的 pin 视觉统一；未钉住时仍可经「+」菜单随时添加/移除。默认不钉（保持启动轻量），钉住状态持久化。
2. **面板状态与「会话」解耦，改为按工作区（项目 cwd）持久化**：持久化对象 `{ open, activeTab, pinnedTabs, fullscreen }` 存盘（join 现有 workspace profile 状态存储，而非会话内存）。任意会话打开面板 → 恢复该工作区的上次面板状态；若某会话显式指定（如 AI 联动自动打开 database tab），以显式动作为准并写回。
3. **切换会话不丢选中**：同一工作区内切会话 → activeTab 保持恢复值；跨工作区切会话 → 按目标工作区各自状态恢复（天然隔离）。
4. 与既有「按会话 cwd 持久化」决策兼容：持久化粒度细化到工作区，覆盖旧逻辑的读路径；异步判定防过期逻辑保留。

### 4.3 实现方案

1. 新增 `useActivityPanelPersistentState`（读盘 + 写回 debounce，键 = workspace id）接 `useActivityPanelModel` 状态源；`restorable`/`pinned` 集合并入同一状态。
2. `PluginTabPicker` 增加分组：`已固定（可取消固定）` / `可用标签页（添加）` / `溢出中`；数据库 tab 归「可用」列表，钉住后归「已固定」。
3. TabBar/面板变体（主题 A）支持 pin 状态小图标（hover 显示 pin，钉住后常显 fill 态）。
4. 回归重点：AI 触发「自动上栏 database tab」链路（B2.9-W3/W4）在持久化后仍能覆盖为显式激活，不冲突。
5. **验收**：钉住 database tab → 重启应用后仍在栏上；选中 database tab → 切换会话再切回 → 仍停留在 database tab（含其内部查询 tab 层级，见主题 D）；同工作区多会话行为一致；`bun run check` 全绿。

---

## 五、主题 D：查询标签页对齐 dbx 设计体系（反馈 #8）

### 5.1 dbx 对标要点（dbx-main `AppTabBar.vue`）

| dbx 交互/设计 | 说明 |
|---|---|
| 固定区（pinned）与普通区 | 标签可分 pinned / regular，pinned 常驻左侧（语义同主题 C 决策 1） |
| 双击改名 | `dblclick` 标签标题 → 行内编辑（commit 校验非空/重名） |
| 脏标记（dirty） | 内容未保存显示 `*`；关闭脏标签弹确认（关闭其他/关闭全部同样校验） |
| 右键菜单 | 新建 / 关闭 / 关闭其他 / 关闭右侧 / 固定与取消固定 / 重命名 / 复制为新标签 |
| 连接配色 | 标签以连接色点/徽标表达归属连接，直观区分多连接查询 |
| 溢出与新建 | 溢出收进 `⋯` 下拉；`+` 新建常驻头部 |

### 5.2 现状（Astravia，V5 已落地）

查询 tab 壳已有：每 tab 独立 `sql/status/result/error/openTableMeta`；theme-ui `TabBar`（激活滑动指示/拖拽排序/溢出收纳/hover 减号关闭）；`+` 新建；溢出下拉；目标 tab 路由（打开表→新 tab、AI 回填→激活覆盖、历史重放→激活回填）；单测 `query-tabs.test.ts` 12 例。
**V5.1（固定/重命名/复制/脏标记+关闭确认/右键菜单/连接配色）原约 1.5–2.5 人天，本次按上表补齐。**

### 5.3 实现方案（V5.1 范围明确化）

1. `lib/query-tabs.ts` 扩展模型：`QueryTab { id, title, sql, connectionId, dirty, pinned, createdAt }` + 纯函数 `renameTab/duplicateTab/togglePin/closeTab/closeOthers`（补单测 ≥ 8 例）。
2. UI：
   - TabBar 标签支持 `dblclick` 改名（行内 input，Esc 取消、Enter 提交）；
   - `title` 前脏标记 `*`；关闭脏标签 → ConfirmDialog（丢弃/取消）；关闭其他/全部跳过校验或逐项确认（跟随 dbx：脏的才确认）；
   - 右键菜单：新建 / 固定 / 重命名 / 复制 / 关闭 / 关闭其他 / 关闭右侧；
   - pinned 标签不参与溢出回收；标签行首或标题左缘显示连接色点（数据来自连接配置的连接色 token）；
3. 与主题 C 一致：查询 tab 集（含 pinned、各 tab 是否 dirty 之外的轻量状态如 title/sql 草稿）**按工作区持久化**（sql 草稿容量限制 ≥ 50 条防膨胀，超限丢最旧 dirty=false 的草稿；密钥/敏感内容不落盘——查询历史既有 localStorage 先例，保持一致并仅在用户确认的「自动保存草稿」语义下启用）。
4. **验收**：与 dbx 上述表格逐项可操作一致；标签固定后跨会话仍在；dirty/close confirm 流程正确；`bun run check` + 数据库域单测全绿。

---

## 六、主题 E：文件树对象显示对齐 dbx（反馈 #9）

### 6.1 根因（代码证据）

- 树的对象区由 `TABLE_OBJECT_KINDS`（`["index","constraint","trigger","partition"]`）驱动，其上游注释明确：「family flat 无 introspection → 数据面返回空，UI 不渲染对象块」。即**约束/外键/索引等对象的取数接口在部分连接族（flat）返回空**，UI 虽具备对象区渲染能力但无数据可显示 → 与 dbx（`ConnectionTree` 展开表后可见 columns / group-constraints / foreign keys / indexes / triggers 等分组）差距明显。
- dbx 树对象**分组**呈现（约束组、外键组…），Astravia 目前为四类平铺且依赖数据非空。

### 6.2 决策

1. **数据面优先补 introspection**，按数据库类型分级：
   - 能力级 S（PostgreSQL / MySQL / SQLite 等有 catalog 或 pragma）：`information_schema` / `pg_catalog` / `PRAGMA` 取 indexes / constraints / foreign keys / triggers / partitions（按各库能力取子集），并入现有 objectsOf 数据面；FK 单列为 `foreign-key` 条目（含引用表.列），UI 可显示「外键 → 引用目标」。
   - 能力级 N（flat / 无 introspection 通道）：树对象区改为**显式「不支持 introspection」占位**（不空白），提示使用“打开表/查询”或连接文档查看对象。
2. **UI 显示对齐 dbx**：表展开后对象按**分组头**显示（列 / 索引 / 约束 / 外键 / 触发器 / 分区），空组隐藏、全空时显示占位；对象行图标区分类型（沿用主题 B 图标体系，索引/约束/外键/触发器各一灰阶图标）；树结构纯函数 + 单测保持（沿用 `lib/database-tree.ts` 组织）。
3. **取数策略不变**：按需 lazy 展开 + 缓存；introspection 属高频轻量调用，仍走既有服务层，不阻塞树初始加载。

### 6.3 实现方案

1. 服务层：`database-service.ts` 增加 `listTableObjects(connection, schema, table)` 按连接类型分发（S 级实现，N 级返回能力标识空）；解析层补 FK 引用字段。
2. `useDatabaseExplorerModel`：`TABLE_OBJECT_KINDS` 数据源改为上述结果；状态加 `objectGroups` 与 `introspectionCapable`。
3. `DatabaseExplorerTree`：对象区按分组头渲染；区分 `foreign-key` 行展示引用目标；N 级占位行。
4. **验收**：PostgreSQL 连接展开表 → 显示列 + 索引/约束/外键（含引用信息）/触发器分组，与 dbx 形态一致；flat 连接不空白、有占位说明；展开 500 节点无卡顿（衔接主题 F）；`bun run check` 全绿。

---

## 七、主题 F：性能优化（反馈 #4）

### 7.1 热点定位（代码证据 + 风险）

| 热点 | 现状 | 风险特征 |
|---|---|---|
| 树节点渲染 | 每行多按钮 + 内联 handler，展开时整段重算 | 大 schema（数百表/节点）展开卡顿 |
| TabBar 溢出测量 | 溢出计算随 items/value 变化重算（theme-ui TabBar） | 多查询 tab 下拖拽/切换抖动 |
| 结果网格 | 全量行渲染 + 长单元格 | 「打开表」loadingMore 到 300+ 行后滚动掉帧 |
| 树数据加载 | 搜索触发全连接自动加载 | 多连接同时加载互相拖慢 |
| 详情/对象渲染 | 对象区全量行内联图标 | 与 6.3 联动 |

### 7.2 决策与方案（按收益/成本排序）

1. **节点行 memo + 稳定回调**（收益最高、改动小）：树行组件 `React.memo`，行内回调收敛为单一 onAction(action, id)，避免每行 props 引用变化导致全量重渲；展开/折叠只更新受影响的 `expandedKeys`。
2. **结果网格虚拟化**：行渲染切虚拟列表（库选型遵循 monorepo 既有约束，如 `@tanstack/react-virtual`，须先确认已依赖或按依赖规范引入），固定行高 + 虚拟化后 10k 行内滚动流畅；长单元格截断策略已存在（详情对话框），保留。
3. **溢出测量节流/缓存**：TabBar overflow 计算在 resize/items 变化时 debounce（~100ms），避免每次 render 全量测量；拖拽中跳过测量。
4. **加载编排**：搜索触发的多连接并行加载限制并发数（如 2），逐连接回填而非等全部；加载中显示行级骨架而非整树 spinner；取消过期请求（AbortController，衔接既有「丢弃过期结果」记录）。
5. **量化验收**（dev 构建、中规模 schema 1000 节点）：展开 500 节点 < 100ms 无感知卡顿；300+ 行结果滚动 ≥ 55fps；切换标签 < 50ms；多连接同时搜索不阻塞 UI。用 React DevTools Profiler 记录重构前后对比。

---

## 八、实施顺序与排期

| 相位 | 内容 | 风险 | 前置 |
|---|---|---|---|
| P1（1–2 人天） | 主题 A：TabBar 面板变体 + 全屏图标换 lucide | 低（样式层） | 无 |
| P1（2–3 人天） | 主题 B：ToolbarButton/IconButton 统一 + pin + 添加连接 + 顶栏槽位 | 中（波及面广，逐屏替换） | 无 |
| P2（1.5–2.5 人天） | 主题 D：查询标签 V5.1（固定/改名/脏标记/右键/连接点） | 中（交互逻辑 + 单测） | P1 图标体系 |
| P2（2 人天） | 主题 C：常驻 pin + 按工作区持久化 + 会话恢复 | 中（状态源迁移，联动 B2.9 回归） | P1 pin 视觉 |
| P3（1 人天） | 主题 F：行 memo + 溢出节流 + 加载编排 | 低–中 | 无 |
| P3（2–3 人天） | 主题 E：introspection 数据面（先 PG/MySQL/SQLite）+ 分组显示 | 高（跨主进程/服务层 + 各库 SQL 差异） | F 行渲染 |
| 收尾 | 双视角代码审查 + `bun run check` + 数据库域全量单测 + 各主题验收项 | — | 全部 |

> 估算为规划参考，实际按任务清单排期；每相位合入前跑 `bun run check`（含 desktop-app `tsc --noEmit`）与数据库域测试。

---

## 九、决策与风险记录

| 项 | 决策 / 说明 |
|---|---|
| 活动面板底部栏定位 | 「面板切换条」而非「文档页签」→ 图标主导 + 指示条（主题 A） |
| TabBar 通用性 | 保留编辑器/查询面板用法，活动面板走 `variant`，不复制组件（方案甲优先） |
| pin 语义二分 | 树行 pin=置顶排序；标签 pin=常驻不溢出；视觉共用一套，避免书签混淆 |
| 「添加连接」 | 不再用大色块 tile；主按钮带文字、工具行灰阶；类型色块转文本+连接色点 |
| 状态持久化 | 面板 open/active/pinned/fullscreen 按工作区（cwd）落盘；会话显式动作为准并回写；异步过期丢弃保留 |
| 草稿落盘 | 查询 sql 草稿按工作区持久化设容量上限，敏感内容不落盘；与查询历史 localStorage 先例一致 |
| introspection 分级 | S 级（PG/MySQL/SQLite…）真实取数 + FK 引用；N 级（flat）显式占位不空白 |
| 性能目标 | 以 Profiler 前后对比量化验收，不用「感觉流畅」定性交差 |
| 配色/i18n | 所有新界面消费语义 token；新增文案入 i18n zh/en，禁止硬编码 |
| 与 dbx 的关系 | 交互/形态对齐 dbx 设计体系；技术路线仍为自有化（方案 B），不引入 dbx UI 依赖 |

---

## 十、验收总清单（跨主题冒烟）

1. 活动面板底栏新视觉 + 新全屏图标，编辑器内 TabBar 不受影响。
2. 数据库工作台任一屏内按钮尺寸/状态/图标体系一致；pin、添加连接焕新。
3. 钉住 database tab → 重启仍在；跨会话切换回到原选中 tab（含查询 tab 层级）。
4. 查询标签：固定/双击改名/脏标记/关闭确认/右键/连接色点与 dbx 一致。
5. PG 连接表展开显示索引/约束/外键（引用信息）/触发器分组；flat 连接有占位。
6. 大 schema 展开、300+ 行结果滚动、多连接搜索均无明显卡顿（Profiler 对比达标）。
7. `bun run check` 全绿；数据库域单测全过；zh/en 无硬编码。
