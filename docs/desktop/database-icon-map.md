# 数据库工作台图标替换映射表

> 配套 ADR: `docs/adr/0057-database-workspace-icon-standardization.md`
> 原则: database 域全部 icon 引用从 **solar + mdi 双源** 收敛到 **lucide 单源**。
> 替换方式: 按「语义」查表 → 得到唯一 lucide 图标名 → 写成 `icon-[lucide--<图标名>]`。
> ⚠️ **不得按旧图标名机械字符串替换** —— solar/mdi 与 lucide 命名体系不同,必须按语义查表。

## 0. 图标集覆盖核验

实测 `@iconify-json/lucide` 收录 1866 图标,数据库树所需语义全部齐备:
`table-2`(表)、`columns-3`(列)、`key-round`(索引/主键)、`link-2`(外键)、`zap`(触发器)、`folder-open`/`folder`(schema)、`eye`(视图)、`refresh-cw`(刷新)、`copy`(复制)、`trash-2`(删除)…均存在。
旧图标集里个别语义词在 lucide 更名(如 mdi `magnify` → lucide `search`),一律以右列新名为准。

## 1. 树节点类型图标(对齐 DBX TreeItem getIconInfo 语义色)

| 节点类型 | 旧引用(现状) | → lucide | 语义色 |
|---|---|---|---|
| 连接(服务器) | `mdi--server-outline` | `icon-[lucide--server]` | 默认/琥珀 |
| 数据库 | `mdi--database-outline` / `solar--database-linear` | `icon-[lucide--database]` | `text-amber-500` |
| schema 文件夹 | `mdi--folder-outline` / `mdi--folder-open-outline` | `icon-[lucide--folder-open]` | `text-sky-500` |
| 表 | `mdi--table` / `mdi--table-large` / `solar--table-linear`* | `icon-[lucide--table-2]` | `text-green-600` |
| 视图 | `mdi--eye-outline` / `solar--eye-linear`* | `icon-[lucide--eye]` | `text-violet-500` |
| 列(字段) | `mdi--vector-square` / `solar--square-linear`* | `icon-[lucide--columns-3]` | `text-slate-500`(主键列 `text-orange-500`) |
| 索引 | `mdi--key-outline` | `icon-[lucide--key-round]` | `text-amber-600` |
| 约束(外键) | `mdi--link-variant` | `icon-[lucide--link-2]` | `text-sky-600` |
| 触发器 | `mdi--flash-outline` | `icon-[lucide--zap]` | `text-orange-500` |
| 分区/分组 | `mdi--layers-triple-outline` / `mdi--shape-outline` | `icon-[lucide--layers]` | `text-slate-500` |
| 表分区/结构 | `mdi--table-split` | `icon-[lucide--table-rows-split]`* | 同表色 |
| 树/结构展开 | `mdi--file-tree` | `icon-[lucide--list-tree]` | 弱化 |

\* 若为 theme-ui 共享组件引入的引用,一并替换。

## 2. 通用操作/状态图标

| 语义 | 旧引用 | → lucide |
|---|---|---|
| 搜索/过滤 | `mdi--magnify` / `solar--filter-linear` | `icon-[lucide--search]`(过滤场景: `icon-[lucide--list-filter]`) |
| 刷新 | `mdi--refresh` / `solar--refresh-linear` | `icon-[lucide--refresh-cw]` |
| 复制 | `mdi--content-copy` / `solar--copy-linear` | `icon-[lucide--copy]` |
| 删除(危险) | `mdi--delete-outline` / `mdi--trash-can-outline` / `solar--trash-bin-trash-linear`* | `icon-[lucide--trash-2]` |
| 行删除(轻量) | `mdi--table-remove` | 行内删除语义统一 `icon-[lucide--trash-2]`(列表行轻量删除可用 `icon-[lucide--x]`) |
| 关闭 | `mdi--close` / `mdi--close-box-outline` / `solar--close-*`* | `icon-[lucide--x]`(图标按钮) / `icon-[lucide--circle-x]`(整卡关闭) |
| 完成/勾选 | `mdi--check` / `mdi--check-circle-outline` / `solar--check-circle-linear` | `icon-[lucide--check]`(行内) / `icon-[lucide--circle-check]`(状态徽标) |
| 新增 | `mdi--plus` / `solar--document-add-linear` / `mdi--folder-plus-outline` | `icon-[lucide--plus]`(通用) / `icon-[lucide--folder-plus]`(新建文件夹) / `icon-[lucide--database-plus]`(新建连接) |
| 减 | `mdi--minus` | `icon-[lucide--minus]` |
| 编辑 | `mdi--pencil-outline` / `solar--magic-stick-linear`(误用) | `icon-[lucide--pencil]` |
| 更多 | `mdi--dots-horizontal` | `icon-[lucide--ellipsis]` |
| 下拉/展开 | `mdi--chevron-down` / `solar--alt-arrow-down-linear` | `icon-[lucide--chevron-down]` |
| 收起 | `solar--double-alt-arrow-up-linear` / `mdi--chevron-up`* | `icon-[lucide--chevron-up]` |
| 右进 | `mdi--chevron-right` / `solar--alt-arrow-right-linear` / `solar--double-alt-arrow-left-linear` | `icon-[lucide--chevron-right]` |
| 左退 | `mdi--chevron-left` / `solar--double-alt-arrow-left-linear` | `icon-[lucide--chevron-left]` |
| 运行/执行 | `mdi--play` / `mdi--play-box-outline` / `solar--play-linear` | `icon-[lucide--play]`(工具条) / `icon-[lucide--square-play]`(主运行按钮) |
| 排序 | `mdi--sort-variant` / `mdi--sort-alphabetical-ascending/descending` / `mdi--format-list-numbered` | `icon-[lucide--arrow-up-a-z]` / `icon-[lucide--arrow-down-z-a]`(分组排序按上下文) |
| 时间/历史 | `mdi--history` / `mdi--timer-outline` / `mdi--progress-clock` | `icon-[lucide--clock]`(最近) / `icon-[lucide--clock-arrow-up]`(历史记录,新版 lucide 无 `history`) |
| 保存/导出 | `mdi--content-save-outline` / `mdi--export` / `mdi--file-delimited-outline` | `icon-[lucide--save]`(保存) / `icon-[lucide--file-down]`(导出) / CSV 上下文 `icon-[lucide--file-text]` |
| 设置 | `mdi--cog-outline` | `icon-[lucide--settings]` |
| 锁定/安全 | `mdi--shield-lock-outline` / `mdi--shield-alert-outline` / `mdi--shield-check-outline` / `solar--shield-*`* | `icon-[lucide--shield]`(基础) / `icon-[lucide--shield-alert]`(告警) / `icon-[lucide--shield-check]`(安全) / `icon-[lucide--lock]`(锁定) |
| 信息/提示 | `mdi--information-outline` / `solar--circle-linear` | `icon-[lucide--info]` |
| 警告 | `mdi--alert-circle-outline` | `icon-[lucide--circle-alert]` |
| 疑问 | `mdi--chat-question-outline` | `icon-[lucide--circle-question-mark]`(问号提示) / `icon-[lucide--message-circle-question-mark]`(聊天提问) |

## 3. 连接管理与批量操作(表级)

| 语义 | 旧引用 | → lucide |
|---|---|---|
| 连接(插座) | `mdi--connection` / `solar--plug-circle-linear` | `icon-[lucide--plug-zap]`(活跃连接) / `icon-[lucide--cable]`(连接配置) |
| 测试连接 | `mdi--crosshairs-gps` | `icon-[lucide--scan-search]`(探活/测试) |
| 健康心跳 | `mdi--heart-pulse` | `icon-[lucide--activity]` |
| 批量导出 | `mdi--export` | `icon-[lucide--file-down]`(CSV/JSON) |
| 截断(清空) | `mdi--table-refresh`(误用) | `icon-[lucide--rotate-ccw]`(TRUNCATE 语义: 清空重来) |
| 批量删除 | `mdi--table-remove` / `mdi--table-off` | 危险语义 `icon-[lucide--trash-2]`(列表行轻量删除 `icon-[lucide--x]`) |
| 拖拽排序 | `mdi--dots-horizontal`(占位) | `icon-[lucide--grip-vertical]`(拖拽柄) |
| 固定/置顶 | `mdi--pin` / `mdi--pin-outline` | `icon-[lucide--pin]`(激活) / `icon-[lucide--pin-off]`(未激活) |
| 勾选(多选) | `mdi--checkbox-marked-outline` / `mdi--checkbox-blank-outline` / `mdi--square-outline` | `icon-[lucide--square-check-big]`(已选) / `icon-[lucide--square]`(未选) |

## 4. AI / 查询 / 特殊语义

| 语义 | 旧引用 | → lucide |
|---|---|---|
| AI 生成/魔法 | `solar--magic-stick-linear` / `mdi--creation` | `icon-[lucide--wand-sparkles]` |
| 机器人(AI 助手) | `mdi--robot-outline` | `icon-[lucide--bot]` |
| 大脑(分析/推理) | `mdi--brain` | `icon-[lucide--brain]` |
| SQL/代码 | `mdi--code-json` / `mdi--code-braces` | `icon-[lucide--braces]`(JSON/代码块) / `icon-[lucide--code]`(SQL 片段) / `icon-[lucide--file-code]`(代码文件) |
| 表内过滤 | `mdi--table-filter` | `icon-[lucide--list-filter]` |
| 表编辑 | `mdi--table-edit` | `icon-[lucide--square-pen]` |
| 光标(可交互) | `mdi--cursor-default-outline` | `icon-[lucide--mouse-pointer-2]` |
| 旋转/3D | `mdi--rotate-3d-variant` | `icon-[lucide--rotate-3d]` |
| 地球/异地 | `mdi--earth-arrow-right` / `solar--plug-circle-linear`* | `icon-[lucide--globe]` |
| 导出外链 | `mdi--arrow-up` / `mdi--arrow-down` | `icon-[lucide--arrow-up]` / `icon-[lucide--arrow-down]`(行排序箭头保持) |
| 应用/网格 | `mdi--apps` | `icon-[lucide--layout-grid]` |

## 5. 替换执行清单(B1→B4 分批)

| 批 | 范围文件(主要) | 图标数(约) | 验证 |
|---|---|---|---|
| B1 树节点类型 | `DatabaseExplorerTree.tsx` 及树渲染行、`theme-ui` 数据库树共享 | ~15 种 | renderer 编译 + 树截图 |
| B2 批量操作条 | `DatabaseExplorerTree.tsx` 批量条、批量工具组件 | ~10 种 | 多选 2 表 → 操作条截图 |
| B3 连接管理 | `DatabaseConnectionsWorkspace.tsx`、连接详情、健康心跳 | ~20 种 | 连接列表/详情截图 |
| B4 查询与 AI | `DatabaseWorkspace.tsx`、查询面板、AI 入口、侧栏入口 | ~40 种 | 查询/历史/AI 截图 |

每批完成后: `bun run check:quick`(仅改动的文件) → 相关 UI 截图核对语义 → 下批。

## 6. 常见错误对照(替换时防呆)

| 错误做法 | 原因 | 正确 |
|---|---|---|
| `mdi--magnify` → 保留 | 忘了 lucide 改名 | `lucide--search` |
| `solar--refresh-linear` → `lucide--refresh-linear` | lucide 无 linear 后缀 | `lucide--refresh-cw` |
| `mdi--close` → `lucide--close` | lucide 关闭是 `x` | `lucide--x` |
| `mdi--dots-horizontal` → `lucide--dots-horizontal` | 实际叫 ellipsis | `lucide--ellipsis` |
| `mdi--pencil-outline` → `lucide--pencil-outline` | 无 outline 后缀 | `lucide--pencil` |
| `mdi--play-box-outline` → `lucide--play-box-outline` | 实际是 square-play | `lucide--square-play` |
| `solar--table-linear`(不存在) | solar 本就无表图标 | 一律 `lucide--table-2` |
