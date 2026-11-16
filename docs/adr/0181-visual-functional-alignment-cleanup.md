# ADR-0181：0.5.96 视觉与功能对齐收尾（跨域消项）

## 状态

已接受，待实施（本次不提交不推送，先启动桌面壳逐项验证）。

## 背景

0.5.96 发布后，用户在多平台（macOS 开发壳、Windows 构建包）实测发现一批视觉与功能
残留问题，集中在六个域。这些问题不是单一模块的 bug，而是上一轮「设计画廊重做 + 侧边栏
常驻 + 应用图标」三处结构变化的连锁反应。本 ADR 用领域模型的方式把它们归类、定根因、
定消项顺序，避免零散修补互相踩脚。

## 领域模型与问题归类

### 域 A：设计画廊（`astravia-ui-design` 插件）

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| A1 | 轮播图应用图标样式与能力页不一致 | `GalleryBanner` 的瓷砖用 `DesignSystemPreview`（风格 token 骨架），而能力页 `AbilitiesBanner` 用应用图标（`AbilityIcon`）。语义是「推荐风格」，本应显示该风格的品牌图标，不是画一条界面骨架 |
| A2 | 「我的设计」看不到入口 | 空态（无项目）下不渲染「我的设计」section（因为没有项目可列），删 Hero 后空态只剩轮播 + 风格库，用户找不到自己的设计入口 |
| A3 | 点击风格卡创建设计报 `Plugin renderer capability session is not active` | `startDesignFromSystem` 在函数顶部 `const ctx = getPluginCtx()` 后，跨 `createDesignProject`、`writeResources` 两个 await 仍用旧引用调 `navigation.open`。开发壳 HMR / 插件重载会在中途 close 旧 session，最后一步用旧 session 即报错（projects.create 用的是 `createDesignProject` 内部重新 `getPluginCtx()` 的新引用，故成功） |

### 域 B：活动面板（侧边栏常驻后的布局残留）

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| B1 | 活动面板按钮点击/切换后图标未居中 | `FullScreenToggleButton` 的图标定位在标签栏里未垂直居中 |
| B2 | tab 两端与顶部边框线有延长线残影、右侧黑边、面板视觉倾斜 | 标签栏与面板边框的衔接处用了不贴合的负 margin / 边框，`data-activity-focus` 铺满态的测量不动点与渲染宽度不一致 |

### 域 C：应用图标（跨平台）

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| C1 | Windows 选择应用图标后是直角 | `appIconImage` 里非 macOS 用 `${id}.png`（全幅方形），只有 macOS 用 `-mac` 超椭圆变体。Windows/Linux 需要同等的圆角资源 |

### 域 D：预设服务商（Magpie）

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| D1 | Windows 构建包 Magpie 仍需密码登录 | 上一轮修了渲染层 `adoptPreset` 的 `?? row.defaultApiKey` 兜底，但需核实主进程「预设启用」写入路径是否在 Windows 也带上了 `defaultApiKey`，还是只修了渲染层 |

### 域 E：添加面板（输入框「添加」）

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| E1 | 展开列表的技能无法点击添加 | 添加面板条目点击事件在某种状态下被吞（可能因并行改动「两栏改造」引入） |
| E2 | 展开列表只有一个技能图标（应为多个，如 pocock 工作流） | 技能按来源聚合时只取了第一条，或展开逻辑只挂了首项 |

### 域 F：外部应用打开（open-in-app 插件）

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| F1 | Windows 会话顶栏「在外部应用打开」列表图标缺失、检测不全 | 宿主枚举外部应用的图标获取在 Windows 上不完整 |

### 域 G：更新对话框

| 编号 | 问题 | 根因方向 |
| --- | --- | --- |
| G1 | 更新「查看更多」md 被强制换行、每行右侧大量空白 | 主进程只 strip 标题、不转 HTML，HTML→Markdown 靠 renderer 的 `normalizeReleaseNote` 兜底，其列表处理把 feed 列表项内的 `<p>`/换行直译成空行分隔的段落；上游在主进程用 `releaseNotesHtmlToMarkdown`（`convertLists` 正确处理列表） |

## 决策

### 1. 消项顺序：先功能阻塞，再视觉

- **P0（阻塞）**：A3（创建设计报错）、D1（Magpie 登录）、E1（技能无法点击）——功能不可用，优先。
- **P1（视觉）**：A1、A2、B1、B2、C1、G1——不影响可用性，但观感明显。
- **P2（平台差异）**：F1——Windows 特有，需在 Windows 包验证。

### 2. 每个域独立验证，不跨域合并

六个域分属不同模块，消项时各自带回归测试，避免「改 A 修好、改 B 又坏」。

### 3. 域 A 的 A3（会话失效）：跨 await 不缓存 ctx，最后一步用最新 session

定位结论：`startDesignFromSystem` 顶部 `const ctx = getPluginCtx()` 缓存了旧 session 引用，跨
`createDesignProject` / `writeResources` 两个 await 后仍用旧引用调 `navigation.open`。开发壳
HMR / 插件重载会在中途 close 旧 session，最后一步即报「session is not active」；`projects.create`
走的是 `createDesignProject` 内部重新 `getPluginCtx()` 的新引用，所以能成功——这正好解释了
「建项目成功、跳转失败」。修复：不缓存 ctx，每个需要上下文的步骤各自 `getPluginCtx()`，并
补回归测试（中途换 ctx 后跳转用新 session）。
`writeResources`（写文件 + 下载资源）。这不像是「会话被主动关闭」，更像是 renderer 侧
`PluginRendererCapabilityHost.sessions` 与主进程 `adapter.sessions` 在某条路径上不同步。
先启动桌面壳复现、抓完整堆栈，再定是「插件重载后 stale 引用」还是「会话生命周期 bug」，
**不以猜测的根因直接改**。

### 4. 域 C（Windows 圆角）复用 -mac 圆角变体，不改运行时逻辑

`appIconImage` 已按平台分 `-mac` / 全幅方形。`-mac` 变体本身就是「超椭圆 + 透明边距」的圆角
资源（1024 画布），与 Windows 任务栏需要的形态完全一致——不需要再复制一套 `-win`。实现
改为「非 Linux 都用 `-mac`」：macOS 与 Windows 共用圆角资源，仅 Linux 桌面环境保留全幅方形
（各发行版对窗口图标的圆角处理不一致）。
（与 `-mac` 同源，超椭圆 + 边距），运行时逻辑保持「按平台选后缀」，不新开分支。

## 备选方案

- **A3 直接给 navigation.open 套 try/catch 吞掉**：报错消失，但用户点风格卡后不跳转、
  拿不到「已创建」反馈，属于掩盖而非修复。
- **C1 在 Windows 运行时用 nativeImage 圆角**：`nativeImage` 不提供圆角裁剪，运行时裁
  也拿不到与原图一致的超椭圆，资源层面补变体才是对的。

## 后果

- 正面：六个域收敛后，画廊与能力页视觉统一、Windows 图标圆角、更新对话框排版对齐上游，
  跨平台一致性补齐。
- 代价：D1/E1 需要真实环境复现（Windows 包），纯代码推测无法闭环；A3 已定位并修复。
  跨平台一致性补齐。
- 代价：A3/D1/E1 需要真实环境复现（开发壳 + Windows 包），纯代码推测无法闭环。
- 兼容性：均为视觉或资源层改动，不涉及持久化格式与公共合同。

## 验证

- 每个域：先启动桌面壳复现（`verify:ui:start:fresh`），修完再截图确认。
- A3 已补回归测试：`start-from-system.test.ts` 新增「中途换 ctx 后跳转用新 session」用例，锁定「跨 await 不缓存旧 ctx」的合同。
- C1 补资源后，Windows 包需重新构建验证图标圆角。
- 本次**不提交不推送**，先跑通全部视觉验证，确认「都比对齐完整」后再进入提交流程。
