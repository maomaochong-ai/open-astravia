# 看板与工作区视图：方案评估

本文记录这一轮改动的取舍依据、风险与遗留项。实现细节见 [ADR-0065](../adr/0065-plugin-workspace-views-and-customizable-sidebar-nav.md)，用户视角见[功能介绍](./kanban-board.md)。

## 一、问题定义

三件事是连在一起的，不能拆开做：

1. 插件没有承载**跨会话工作台**的地方——所有既有插槽都依附于某个宿主容器（会话页、预览壳、App 根部）。
2. 侧边栏导航硬编码，插件即便有整页 UI 也没有稳定入口；用户也无法按使用频率编排入口。
3. 对话一多就失去全局视角，用户记不住某个需求当初开在哪个会话。

第 3 条是用户痛点，第 1、2 条是它的前置条件。所以本轮同时交付了插槽、导航自定义、以及作为第一个消费者的看板插件。

## 二、关键取舍

### 2.1 为什么新建插槽而不是复用既有的

| 候选 | 评估 |
| --- | --- |
| 活动 Tab | ❌ 按会话 cwd 持久化显隐，语义上绑定当前对话。跨会话总览放进去是错位的；面板宽度也放不下三条泳道 |
| `registerGlobalSlot` 自绘全屏浮层 | ❌ 会覆盖宿主 chrome、拿不到路由与深链、无法参与侧边栏导航，且与「面板类插槽禁止 viewport 级浮层」的既有规范直接冲突 |
| 主题页 `ThemePageDefinition` | ❌ 属于主题体系，插件用不了。但它是**很好的形状参照**：扩展方拥有整页、宿主只提供路由与兜底 |
| **新增工作区视图** | ✅ 与内置页同级；有独立路由可深链；入口进侧边栏可编排 |

术语上选 **Workspace View（工作区视图）** 而非沿用 VS Code 的 "View Container"：VS Code 的 View Container 是**侧边栏内的容器**，而这里是**整页内容区**，直接借用会误导插件作者。Vetta 已有的插槽命名（Global Slot / Activity Tab / Turn Card）都是「位置 + 形态」，Workspace View 与之同构。

### 2.2 为什么看板不复用 batch-tasks 引擎

batch-tasks 已经有队列、并发、每任务一会话，看起来很接近。但它的数据模型是「项目 + 固定 prompt 模板 + 变量表」——所有任务共享一段模板，差异只在变量。看板的每张卡是**一段自由需求**，正文本身就是 prompt。

强行套用会同时扭曲两边：要么把看板的自由文本硬塞进模板变量，要么给 batch-tasks 加一个「无模板」旁路。两者都会让后续维护者搞不清哪个是主路径。因此看板自持一份轻量状态（插件私有存储），只复用宿主的**会话能力**。

### 2.3 `official.sessions` 为什么放在 renderer

看板需要并发派出多个后台任务并观察状态，而 `ctx.conversation.*` 只作用于用户当前正在看的会话。

实现上有两条路：新开主进程 IPC 通道，或封装 renderer 已有的 `window.vetta.session.*`。选后者，因为：

- renderer **已经**持有等价能力，新开通道等于把同一能力实现两遍，还扩大了 preload 暴露面。
- `official.navigation` 已经是同类先例（renderer-only official API），有既成模式可循。
- 能力面没有变大：门控点是 `assertOfficialSession`，只有 `trustLevel === "official"` 的 preset 能调。

关键前提已验证：会话本体跑在主进程（`ipcMain.handle(CHANNELS.PROMPT)` → `runtime.prompt`），所以 `create` + `prompt` 之后，即使宿主停在别的页面、甚至看板 UI 未挂载，agent loop 也会继续跑到自然停止点。

### 2.4 并发闸门放在哪一层

放在**看板自己的规则层**（`dispatch.ts`），不碰宿主任何既有并发设施。这是需求里明确要求的「不要影响在其他地方使用」。

一个容易出错的点：卡片必须**先落到「正在处理」再发 prompt**。否则并发派两条时，两次 `canDispatch` 会看到同一个空名额，双双放行。反过来，派单失败必须把名额吐回来（置为 `failed`），否则一次网络抖动会永久占住一个 WIP 位。这两条都有对应测试。

### 2.5 为什么看板不替 Agent 排期

需求里写的是「agent 可以自行分配决定先做哪个或者并行去做，或者等待哪个需求做完了再去做，这个过程完全是 agent 自己去派遣的」。

所以看板的定位是**闸门而非调度器**：给出准确快照 + 在越界时拒绝，理由是可执行的（`wip-full` / `blocked` / `draft`）。`dispatchableCards` 提供的是**建议顺序**，Agent 可以另选。

一个刻意的设计：WIP 满时 `dispatchableCards` **仍然列出**可派卡片，只由 `canDispatch` 拦截。否则 Agent 会误以为「没活可干」而收工，而不是「等一个交付完再接」。

## 三、覆盖情况

### 已交付

| 需求 | 状态 |
| --- | --- |
| 插件新 slot：侧边栏 more 中的 item 点击跳到插件页面 | ✅ 工作区视图 `ui.slot.workspace-view` + `/workspace/$pluginId/$viewId` |
| 专业术语描述这个插槽 | ✅ **工作区视图 / Workspace View** |
| more 中顺序可自由拖动 | ✅ 「更多」弹层内拖拽排序 |
| 可 pin 到左上方；新会话固定，其余可调换收纳 | ✅ pin/unpin + 跨区拖拽，「新会话」锁定首位 |
| 置顶区含新会话最多 5 个 | ✅ `MAX_PINNED_NAV_ITEMS = 5`，溢出退回收纳区最前而非丢弃 |
| 三条泳道 | ✅ 灵感池 / 正在处理 / 待检查 |
| 灵感池两状态，草稿 agent 不管 | ✅ `draft` / `ready`，`canDispatch` 对草稿返回 `draft` 拒绝 |
| agent 自行认领、并行、决定先后 | ✅ 四个工具 + 闸门；依赖表达先后顺序 |
| 正在处理支持手动添加 | ✅ 拖拽入泳道（走闸门）或直接建卡 |
| 待检查 = 交付区 | ✅ 交付说明随卡片显示 |
| 处理中/待检查 item 点击跳对话页 | ✅ `official.sessions.open` |
| 三条泳道实时状态 | ✅ `onRunningChanged` + `listRunning` 回灌 |
| 右上角设置并发，默认 5 | ✅ 只约束本看板 |
| 不用进会话页就能发任务 | ✅ 顶部快速发布 + 卡片「派发」 |

### 在需求基础上补充的

均围绕「让 Agent 自行派遣」这一核心，没有偏离：

- **依赖关系**：需求里提到「需求可能是会有先后顺序的」，但没给表达方式。加了 `dependsOn` —— 否则 Agent 只能靠猜，或者用户只能靠手动一条条放行。
- **优先级 / 标签 / 目标项目**：多项目场景下卡片必须能指定在哪跑，否则跨项目看板不成立。
- **交付说明**：待检查如果只是「卡片挪过来了」，用户还得进会话翻记录才知道做了什么，验收区就没起到作用。
- **中断**：跑偏了要能停，否则只能进会话页处理，破坏「不用离开看板」。
- **重启降级**：`running` → `waiting`。会话不跨进程存活，显示一个其实没在跑的任务比显示「等待中」更糟。

## 四、测试

| 范围 | 用例数 | 覆盖要点 |
| --- | --- | --- |
| `sidebar-nav-layout.test.ts` | 25 | 首次分区、卸载丢弃、新项补位、用户偏好不被默认值覆盖、溢出退回、pin/unpin、锁位夹取、跨区移动、容量拒绝、脏数据解析、落盘往返 |
| `workspace-view-registry.test.ts` | 9 | id 合法性、导航 key 往返、坏 key 拒绝、URL 编码、查找兜底、稳定排序 |
| `kanban/test/board-store.test.ts` | 23 | 建卡归一、跨泳道移动与重排、悬空依赖清理、并发夹取、运行态回灌（含终态不被覆盖）、脏卡片丢弃、重启降级 |
| `kanban/test/dispatch.test.ts` | 22 | 名额占用规则、各类拒绝理由、依赖先于 WIP 检查、派单顺序、prompt 构造、Agent 快照 |

**合计 79 条新增用例，全部通过。**

全量门禁：`bun run check` 通过（lint 2750 文件、5 个 typecheck 目标、13 项架构守卫）；`packages/desktop-app` 渲染层既有 76 个测试文件 / 332 条用例全部通过，无回归；`bun run build:presets` 正常产出并 staging `kanban@0.1.0`。

## 五、风险与遗留

| 项 | 说明 | 缓解 |
| --- | --- | --- |
| `official.sessions` 是高权能力 | preset 可创建真实会话并发 prompt | 官方来源门控；preset 权限在 manifest 显式声明且不可撤销，审阅 preset 时需重点核这一条 |
| 主题 SDK 合同扩展 | `SidebarNavItem` / `SidebarModel` 新增字段与 action | 全部可选新增；`SidebarNavigation` 未收到 `onNavMove` + `navCustomizeLabels` 时退化为改造前行为，既有主题（xianxia）无需改动 |
| 拖拽用原生 HTML5 DnD | 未引入 dnd 库 | 与仓库既有做法一致（TabBar / FileTree）；键盘可达性靠 pin 按钮补齐（拖拽本身不可键盘操作，属已知限制） |
| 未做真机 UI 验证 | 本轮未跑 `verify:ui:*` 流程 | 交互逻辑已抽为纯函数并单测覆盖；渲染层建议在下一轮做一次人工走查，重点看拖拽落位指示线与置顶区满员时的置灰反馈 |
| 看板状态存插件私有存储 | 不参与项目内版本管理，不跨设备同步 | 当前定位是个人工作台，符合预期；若将来要多端同步需另立方案 |
| 卡片与会话是弱绑定 | 用户在会话页手动删除会话后，卡片仍持有 `sessionPath` | 点击跳转会失败并 notify；未做自动清理，属已知遗留 |

## 六、第二轮迭代（UI 落地化 + 产品闭环）

本轮在首版基础上做了两类升级，测试从 79 条增至 90 条。

### 产品闭环补全

| 新增 | 动机 |
| --- | --- |
| **Composer（与 AI 输入栏同款胶囊）** | 用户明确要求复用 AI 输入栏。宿主输入栏是 Lexical 编辑器且深度绑定会话状态，无法跨 Module Federation 复用；改为按宿主 `input-card` 的同一套 token（`bg-input-bar-bg` / `rounded-[20px]` / focus `border-primary` 光晕 / 底部工具栏 / ⌘↵）复刻形态，语义换成看板：回车入池、⌘↵ 直接开工、Shift+回车写正文，附项目选择与优先级 |
| **验收通过 → 归档** | 首版验收后只能删卡，交付历史蒸发。归档卡离开泳道但保留在数据里（不占 WIP、不进 agent 快照、**作为依赖视为已交付**），右上角面板可回看 / 恢复 / 删除 |
| **打回重做（发往原会话）** | 首版「待检查不满意」没有出路。打回时反馈 prompt 发到**原会话**——上下文都在，agent 只需修正；原会话丢失时自动降级为重新派发（完整需求 + 反馈）。状态部分是纯函数 `sendCardBack`，失败同样吐回名额 |
| **搜索过滤** | 卡片多了之后三条泳道也会失去总览性。按标题/正文/标签过滤，列头保持真实总数 |

### 落地化修复（真 bug）

1. **图标全部缺失**：首版插件 CSS 只引了 `tailwindcss/utilities.css`，没有 theme 层（`h-4`/`rounded-lg` 等 spacing 工具类生成不出来）也没有 `@iconify/tailwind4` 插件（所有 `icon-[solar--*]` 类不存在）。对齐 `image-gen` 的三段式引入后，产物 CSS 从 10.5KB 增至 62KB（含图标数据）。
2. **弹层内部样式丢失**：插件 CSS 被 `@scope` 到 `data-vetta-plugin-root` 根节点，而 Radix Dialog/Popover/DropdownMenu portal 到 `document.body`，逃出了 scope。按 `content-creation` 的既有模式在每个 portaled content 上补挂 `data-vetta-plugin-root="kanban"`。

### 视觉体系

优先级从徽章改为**左侧色条**（扫列即可分轻重，不占行内空间）；运行中卡片用主题色**呼吸光环**（CSS 动画，深浅色都成立）；WIP 步进器带 SVG 名额用量环；相对时间 30s 一跳共用一个 interval；空板给三步引导而不是一片空白；拖拽悬停时整条泳道亮边。
