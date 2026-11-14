# ADR-0162：能力页、自动化详情、文件树与文件预览对齐 0.5.75–0.5.79

## 状态

已接受并实施。本记录是 ADR-0157 全量登记表中 abilities（16 条）、automation（3 条）、
file-explorer（1 条）、file-preview（1 条）、input-bar（1 条）这 22 条的对齐决策与落地说明。

## 背景

参照实现在 0.5.75–0.5.79 之间对四个界面做了整批重构：能力页从「标题+说明+静态横幅+三列
卡片」改为「收窄居中 + 两列卡片 + 图标星座轮播」；自动化详情的任务正文从固定高度输入框
改为 Markdown 预览加编辑弹窗，并把「打开聊天」从底栏收进「更多」；文件树顶部的两个新建
按钮合成一个下拉；文件预览顶栏新增「在文件树中定位」。

本仓库这几处仍是旧形态，且结构与参照实现不完全相同（能力卡片的回调是显式 `actions`
对象而不是整个 `model`；`SkillPromptArea` 支持多技能；`RendererMarkdownContent` 已是共享
适配层）。因此对齐方式是**取上游改动块的语义，落在本仓现有结构上**，不整文件覆盖。

## 决策

### 1. 能力页布局：搜索左、筛选与添加右、分区切换进页头

- 页头右侧只留三件事：能力来源入口、刷新（纯图标按钮，带可访问名）、公开/个人切换。
  「一键帮我配置」（`SettingsAiAssist`）入口移除——参照实现在同一批里把它从能力页拿掉了。
- 页头标题下的说明文案删除，标题即可说明。
- 内容区宽度 `max-w-5xl → max-w-4xl`，卡片网格 `grid-cols-2 lg:grid-cols-3 →
  grid-cols-1 min-[800px]:grid-cols-2`：窄窗口单列，宽窗口两列放大。
- 工具条改为「左侧搜索、右侧筛选 + 添加」两端对齐（`justify-between`）。

### 2. 能力横幅改为图标星座轮播

- 左侧是 6 个错落位置的图标（`SLOT_LAYOUT`），第 0 格为当前精选项，尺寸最大并带外环；
  右侧是该精选项的「推荐」标签、标题、两行简介与「查看详情」主色按钮。
- 背景按幻灯片换色相（`SLIDE_HUES`），用 CSS 渐变 + 径向高光，不叠实时模糊——
  这是上游 `augx` 那条性能改法：实时 `backdrop-blur` 在轮播里每帧重算，滚轮一动就掉帧。
- 轮播在三种情况下暂停：鼠标悬停、窗口失焦/标签隐藏、横幅滚出视口（`IntersectionObserver`）。
- 横幅整体 `hidden min-[900px]:grid`：窗口过窄时直接不渲染视觉块，而不是压扁。
- 市场未加载时用占位图标集，此时右侧显示统一的标题与说明，不出「推荐」标签。
- 只有「发现」分区渲染横幅；「个人」分区没有市场内容，横幅在那里只是噪声。

### 3. 卡片与详情页的尺寸收敛

- 卡片：`py-2.5 → py-2`、图标 `40 → 36px`、简介 `truncate text-[11px] →
  line-clamp-1 text-[11.5px]`，并补 `dark:hover:bg-accent/35`（深色下悬停不过亮）。
- 详情页「链接」块：容器 `rounded-xl bg-foreground/[0.05] overflow-hidden`，每行
  `border-0 px-4 py-3`，行间仍用 `DETAIL_RULE` 分隔。原先链接行贴边、容器无底色，
  与相邻区块脱节。

### 4. 安装进度不再重算整库、不再重渲染全部卡片

- `useAbilitiesModel` 拆成两段：`baseItems` 只依赖市场/本地数据，目录组装与冲突装饰
  全在这里；`allItems` 只做「叠加操作状态」，用 `overlayCache` 复用未变化条目的引用。
- 卡片继续用既有的 `actions`（`Pick<AbilitiesModel, …>`）+ `memo`。本仓此前已经把
  回调固定成稳定对象，这与上游的「稳定代理 + 只比 item」等价，不改成上游写法。
- 结果：某一条目的安装进度每秒数次刷新时，其余行拿到的是同一个对象引用，`memo` 跳过。

### 5. 自动化详情：正文 Markdown 预览 + 编辑弹窗

- 新增 `AutomationPromptField`：常态渲染 `RendererMarkdownContent`（高度随内容），
  右上角「编辑」打开 `Dialog`，里面是 `SkillPromptArea`（最小高度取 `max(promptMinHeight, 240)`），
  改完点「完成」关窗。空正文时整块是占位文案按钮，点一下直接进编辑态。
- 技能胶囊在预览态也显示：用户要知道这条任务带着哪个技能跑。
- 本仓 `SkillPromptArea` 是多技能 API（`skills` / `onSkillsChange` / `maxSkills`），
  组件对外收 `skills` 数组并在调用点折回 `onPromptChange(body, skills[0] ?? null)`，
  定时任务仍是单技能语义。

### 6. 自动化详情顶栏与字段皮肤

- 顶栏按钮换 Solar：运行 `play-bold`、启停 `pause/play-circle-bold`、更多 `menu-dots-bold`、
  关闭 `close-linear`；删除项改 `trash-bin-trash-bold`。
- 「打开聊天」从底栏移入「更多」菜单（`disabled={!canOpenChat || dirty}`），底栏只留
  保存/放弃。同一动作不再有两个入口。
- 分组卡片与行改成设置页同皮：`h2` 组标题 + `divide-border rounded-xl border border-border bg-card`；
  行标签 13px medium、提示 12px；行尾下拉改用 `MotionSelect`（设置页同一个），
  选中 chip 的未选态用 `bg-muted`、悬停 `bg-accent`。
- 未做：`rowInputClass` 未改用 `INPUT_FILL_CLASS`。该常量与 `Button variant="field"` 都属于
  「ui：输入框聚焦改粗主色描边、设置页统一皮肤」那一条（ADR-0157 ui 表 `rdh0`），
  不在本批范围；等那条落地后这里替换成同一常量即可。

### 7. 文件树新建下拉

- 工具栏顶部两个图标（新建文件 / 新建文件夹）合并为一个下拉：触发器用
  `solar--document-add-outline`，菜单两项各带图标与文案，`align="start"`。
- 文案新增 `chat.json → fileExplorer.newMenu`（新建 / New）。
- 行为不变：两项仍走原来的 `beginCreate("file" | "directory")`，新建态仍落在树上。

### 8. 文件预览「在文件树中定位」

- `FilePreviewViewLabels` 新增可选 `locate`；给了 `onLocate` 且条目有 `path` 时才渲染
  按钮（`solar--gps-linear`），位置在文件名与位置计数之间。
- 「隐藏文件树」图标 `mdi--dock-left → solar--sidebar-minimalistic-linear`，与顶栏其它
  Solar 图标一致。
- `useFileTabContentModel.locate`：目录树展开时直接 `revealPluginFileExplorerPath(path,
  { select: true, focus: true })`；收起时先 `setTreeCollapsed(false)`，等
  `waitForCommittedPaint()`（`FilesPanel` 重新挂载并绑定宿主）后再定位。没有 `path`
  的条目（图片剪贴板之类）不发请求。

### 9. 输入栏非整数缩放下的一像素错线（`jot1`）

核实结论：本仓命令面板与输入卡片的边线都取自同一套 `--radius` 与 1px 边框，且容器宽度
来自同一测量值，没有参照实现那条「两处各自取整」的路径，因此无需改动。状态记为
「已对齐（结构上不存在该偏差）」，并用下面的视觉核对兜底。

## 备选方案

- **整文件覆盖成上游版本**：能力卡片本仓用显式 `actions` 而不是整个 `model`，覆盖会把
  已有的稳定回调、以及 `visiblePages` 分页一并丢掉；横幅、工具条这些纯视图文件可以等价
  移植，但模型与卡片必须按本仓结构落。
- **横幅继续用实时模糊**：视觉上更「厚」，但滚动时每帧重算模糊，能力市场本来就有几百行，
  这条与 `augx` 的意图直接冲突。
- **自动化正文保留输入框、只加高**：长提示词仍然要在小框里滚；预览撑高才是「读」的形态。
- **文件树保留两个按钮、只改图标尺寸**：占位与语义重复的问题没解决。
- **定位时直接展开而不等绘制**：`FilesPanel` 尚未挂载时宿主还没有 explorer 上下文，
  请求会丢；必须先等一次已提交的绘制。

## 后果

- 正面：能力页在窄窗口不再三列挤成一团；横幅在不可见时不出帧；自动化正文可读、可编辑；
  文件树工具栏少一个按钮；预览能一键定位当前文件。
- 代价：`AbilityBannerIcon` 多了必填的 `title` / `description`（占位图标填空串），
  `bannerIcons` 的构造必须跟着改；`FilePreviewViewLabels.locate` 是新增可选字段，
  不传就不渲染按钮，旧调用点无需改动。
- 已知限制：能力页横幅在 900px 以下整体不显示（与参照实现一致），此时「推荐」内容不可见，
  只能从列表进入详情。自动化字段的 `INPUT_FILL_CLASS` 皮肤待 `rdh0` 后再统一（见第 6 节）。

## 验证

- `AbilitiesPageView.layout.test.tsx`：横幅仅在「发现」分区、工具条左右分组、
  卡片网格单列/两列、刷新按钮为纯图标且刷新中禁用并旋转、分区切换在页头。
- `AutomationPromptField.test.tsx`：Markdown 预览、空态点击进编辑、弹窗回写保留技能、完成后关窗。
- `useFilesPanelModel.toolbar.test.tsx`：工具栏只剩一个新建入口；下拉两项分别进入
  文件/文件夹新建态。
- `useFileTabContentModel.test.tsx`：定位在树展开时直接调用、收起时先展开再等绘制、
  无路径不发请求。
- 既有 `useAbilitiesModel.test.tsx`（含 bannerIcons 断言）与
  `useFilesPanelModel.reveal.test.tsx` 覆盖被改动的模型路径。
