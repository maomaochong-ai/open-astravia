# 侧边栏图标差异化：solar linear 同体系内语义换形

本仓库为上游开源项目的演进分支（fork），长期跟踪上游演进。桌面端整体沿用上游的 UI 基底，侧边栏导航图标此前与上游逐字形相同（`solar--pen-new-square-linear`、`solar--magic-stick-3-linear`、`solar--library-linear`、`solar--widget-5-linear`、`solar--cpu-bolt-linear`、`solar--palette-linear` 等），两侧栏摆在一起雷同度高、品牌区分度低。

同时 [DESIGN.md §6.1](../desktop/DESIGN.md)（`packages/desktop-app/DESIGN.md` §6.1）约定**图标优先使用 solar linear，禁止引入其他 collection**；同屏混用两套图标视觉语言正是此前数据库域的教训（见 [ADR-0057](./0057-database-workspace-icon-standardization.md)）。因此差异化不能靠「换一套图标库」实现，而应在 solar linear 体系内完成。

## Decision

**侧边栏图标在 solar linear 同一体系内逐槽位重选字形：保持「语义不变、字形可辨」，实现与上游的差异化；不新增任何图标 collection。**

具体决策：

1. **不引入新图标集**。曾评估 lucide（ADR-0057 已在数据库域落地）、Phosphor、mingcute、自绘品牌集等方向，均因与 DESIGN.md §6.1「优先 solar linear、禁止引入其他 collection」冲突、或成本过高而驳回。solar 本身收录充足，导航语义全部有对应字形可换。
2. **同语义换形**。每个侧边栏图标槽位在原语义域内挑选同义词字形（如「方形笔」→「圆形笔」、「魔法棒」→「循环箭头」、「书架」→「单册带书签」、「宫格」→「星光」、「板+勾」→「板+列表行」……），标签文案、激活态逻辑、组件结构一律不动。
3. **路径相似度硬淘汰**。选型以程序化比对 SVG body 为准（见 `docs/desktop/sidebar-icon-map.md` 附方法），凡与现状字形路径相似度 ≥ 约 50% 的候选视为「换名不换形」直接淘汰：实测 `moon→moon-stars` 100%（body 完全相同）、`cpu-bolt→cpu` 99%、`folder→folder-2` 91%、`sidebar-minimalistic→sidebar-code` 82% 均被淘汰。
4. **本次落地 13 处字形更换**（仅改图标 class 字符串，4 个文件）：
   - 主导航（`useSidebarModel.ts`）：新会话 `pen-new-square-linear`→`pen-new-round-linear`；自动化 `magic-stick-3-linear`→`repeat-linear`；知识库 `library-linear`→`book-bookmark-linear`；能力 `widget-5-linear`→`star-shine-linear`。
   - 更多导航（同上文件）：批量任务 `clipboard-check-outline`→`clipboard-list-linear`；模型设置 `cpu-bolt-linear`→`server-linear`；Agent 设置 `user-speak-rounded-linear`→`user-id-linear`；外观 `palette-linear`→`palette-round-linear`。
   - 会话列表状态（`SessionStatusIcon.tsx`）：定时 `clock-circle-linear`→`clock-square-linear`。
   - 顶栏更新徽标（`SidebarUpdateIcon.tsx`）：待重启 `restart-linear`→`restart-square-linear`、可下载 `download-linear`→`download-square-linear`、出错 `danger-circle-linear`→`danger-square-linear`（统一为方形线框族）。
   - 主题快捷区标头（`SettingsMenuThemeSection.tsx`）：`palette-linear`→`palette-round-linear`（与「外观」导航同语义同字形）。
5. **保留例外（不做换形）及理由**：见 `docs/desktop/sidebar-icon-map.md`「保留项」表。核心为四类：① 语义在 solar 内唯一（`database-linear` 数据库入口、`import-linear`、`folder-open-linear` 等）；② DESIGN.md §6.1 canonical 表写死的通用符号（`folder`、`add-circle`、`settings`、`chat-round-line`、`refresh`、`alt-arrow-*`、`check-circle` 等）——差异化不应伤及规范与跨端一致性；③ OS/用户惯例符号（主题切换 `sun/moon/laptop`，刻意换形会损害可识别性，且 `moon-stars` 与 `moon` 路径 100% 相同无字可换）；④ 换名不换形被相似度证伪者（`layers-minimalistic`→`layers-linear` 相似 49%）。
6. **对 ADR-0057 的修订**：ADR-0057 第 4 点 B4 原计划将「侧栏数据库入口」一并改为 lucide；本决策基于「侧边栏整体保持 solar 视觉语言」的边界，**该入口（`useSidebarModel.ts` 数据库导航项）维持 `solar--database-linear`，不再按 0057-B4 替换为 lucide**。数据库工作台内部（database 域）仍按 0057 执行 lucide 标准，两者边界互不侵入。
7. **可持续机制**：此后侧边栏任何图标更换/新增，先查 `docs/desktop/sidebar-icon-map.md`；更换既有槽位需按第 3 条跑相似度验证，避免无效替换。若未来要更进一步（品牌自绘集），以本映射表为语义基线，在 DESIGN.md §6.1 修订后另立 ADR。

## Considered Options

- **O1 侧边栏整体换 lucide**：驳回。lucide 虽已随 ADR-0057 装入且与 DBX 上游参考同源，但 (a) 与 DESIGN.md §6.1 冲突（§6.1 需为侧边栏开例外）；(b) lucide 与上游产品（含 DBX 参考实现本身）同源，差异化最弱；(c) 侧栏与内容区（仍 solar）交界处会再现 ADR-0057 治理前「两套视觉语言同屏」的观感问题。
- **O2 引入 Phosphor / mingcute 等其他集合**：驳回。同样违背 §6.1，且需新增 `@iconify-json/*` 依赖；跨集合线宽、圆角、视觉重量差异反而破坏当前体系一致性。
- **O3 自绘品牌定制图标集**：驳回（本轮）。差异化最强，但需自建图标资源管线并逐槽位手绘约 35 个图标，成本最高；作为后续 v2 阶段方向保留，语义基线即本映射表。
- **O4 本决策（solar 内语义换形）**：采纳。零新依赖、零样式改动、纯 class 字符串替换；保持体系结构（用户明确要求「图标的设计体系保持和当前项目体系结构」），同语义不同字形即可感知地降低与上游雷同。

## Consequences

 - 侧边栏仍 100% solar linear，符合 DESIGN.md §6.1；除本次更换的槽位外，其余字形与样式基线不变。
- 与上游逐字形的雷同被打破；导航主视觉（新会话/自动化/知识库/能力）更换字形差异明显（路径相似度 0%–6%）。
- 局限：少数槽位（数据库、文件夹、宫格回退、明暗主题符号等）因语义唯一或规范写死无法在本集内差异化，属可接受剩余项；跨集合的观感差异上限天然低于换库方案。
- 改动为纯数据/字符串，无类型与逻辑影响；编译自查通过，视觉截图验收留待 `verify:ui` 环节（需 Electron 环境）执行。
