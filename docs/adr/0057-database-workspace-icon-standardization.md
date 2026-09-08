# 数据库工作台图标标准化：统一 lucide 源 + 语义映射 + 渐进替换

数据库工作台（`renderer/domains/database/*` + 侧栏数据库入口）此前图标体系失控：**同一界面混用 solar 与 mdi 两套视觉语言**（统计 database 域 96 种图标引用，solar 约 40 种、mdi 约 56 种），同义图标多形态并存（`solar--refresh-linear` vs `mdi--refresh`、`solar--copy-linear` vs `mdi--content-copy`、`solar--database-linear` vs `mdi--database-outline`……），风格后缀不统一（`linear` 细线 1.5px 圆角 vs mdi 2px 方形圆角混排）。同屏并列时线宽、圆角、视觉重量互相打架，正是「太丑太低端、比较混杂」的观感根源。

同时 DBX 上游参考实现（Vue 桌面壳）整站统一使用 **lucide** 图标库，并按节点类型赋语义色（库=amber、schema=sky、表=green、视图=purple、列=muted、主键=orange……），视觉一致度高。需要定下标准化决策，使数据库工作台图标对齐 DBX 参考的观感基线。

## Decision

**数据库工作台图标统一使用 lucide 图标集（`@iconify-json/lucide`），全量替换现有 solar/mdi 图标；lucide 内不存在等价语义时，优先选用 lucide 语义最接近者，禁止再引入新图标集。**

具体决策：

1. **单一图标源**：`packages/desktop-app` 安装 `@iconify-json/lucide`（已加入 dependencies）。数据库域新增 UI 一律写 `icon-[lucide--<图标名>]`，禁止在 database 域出现 `icon-[mdi--…]` / `icon-[solar--…]` / `icon-[vscode-icons--…]` 新引用。样式入口 `styles.css` 需补 `@source inline` lucide 放行（若被扫描范围排除）。
2. **语义色分层**（对齐 DBX 树）：树节点按类型赋语义色而非同色图标——库/数据库连接 `text-amber-500`、schema 文件夹 `text-sky-500`、表 `text-green-600`、视图 `text-violet-500`、列 `text-slate-500`（主键列 `text-orange-500`）、分组标头用弱化色。此色表在 DBX `TreeItem.vue getIconInfo()` 有逐条参考实现。
3. **语义→图标映射表**：以「表/视图/列/索引/约束/触发器/分区/健康/搜索/刷新/复制/导出/删除」等域内动词与名词为准，全部落到单一 lucide 图标。映射表见 `docs/desktop/database-icon-map.md`，替换时逐条照抄，不自行另选。
4. **渐进替换、分批落地**：不一次重写全部文件。分四批：
   - B1 树节点类型图标（表/视图/列/索引/约束/触发器/分区/文件夹）+ 语义色；
   - B2 批量操作条与行内 hover 操作（truncate/drop/export/refresh/copy）；
   - B3 连接管理与详情（连接图标、编辑/删除、健康状态点、参数/测试）；
   - B4 查询面板与 AI 入口（运行/停止、历史、SQL 动作、数据库/表引用图标）及侧栏数据库入口。
   每批独立 commit、独立验证构建（renderer 编译 + 截图核对）。
5. **mdi 在新代码中退场**：database 域之外的 mdi 引用（如通用 spinner/check/close 的共享组件）不在本决策强制范围，但**新增代码一律不再使用 mdi**；后续按共享组件目录另立全应用图标标准时再统一治理。

## Considered Options

- **O1 维持现状（solar+mdi 混用）**：驳回。同屏双视觉语言、同义多形是「混杂低端」的直接来源；DBX 参考本身单源，双源无法对齐其观感。
- **O2 全量改用 solar**：驳回。solar 收录以通用 UI 为主，**数据库对象语义严重缺失**——表（table）、列（columns）、行、索引、外键、触发器均无对应图标（实测 `table*` 词根仅 `bedside-table`），无法表达数据库树；强行用 `widget-*`/`structure` 凑数会制造新的「词不达意」。
- **O3 本决策（统一 lucide）**：采纳。lucide 是 DBX 参考实现同款图标库（`@iconify-json/lucide` 1866 图标），数据库树所需语义（`table-2`/`columns-3`/`key-round`/`link-2`/`zap`/`folder-open`/`eye`…）全部齐备，且 DBX `getIconInfo` 提供了逐节点类型的成熟映射与配色可直接照抄，观感与参考实现一致。
- **O4 引入新的自绘图标集**：驳回。成本高、需维护资源管线；lucide 已覆盖语义且与 DBX 一致，无自绘必要。

## Consequences

- 正面：数据库域图标单源、同义单形、语义明确，树节点按类型分色后扫读效率提升；观感与 DBX 参考实现一致。
- 成本：需替换 database 域约 96 处 icon 引用（多为 class 字面量级改动，机械可执行）；替换后需人工核对每处图标语义是否贴切（solar→lucide 命名不同，不能字符串替换了事，须按映射表逐条）。
- 共享组件（mdi spinner/check/close）不在本决策内，跨域仍存在 mdi 残留，待全应用图标标准另立治理。
