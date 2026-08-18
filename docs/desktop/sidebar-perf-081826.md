# Desktop 性能手术记录：侧边栏切换 / 发送卡顿 / 设计与能力入口首开（2026-08-18）

> 本文沉淀 2026-08-18 这轮针对低配机型的性能手术：问题定位证据、每处改动的原因与
> 方式、验证手段与已知残留项。所有改动按小粒度提交，可独立回滚。

## 背景：三个用户可感知的卡顿

1. **侧边栏切换会话 / 切换项目 / 进入项目详情页卡顿**，动画掉帧；会话多的低配机上尤其明显。
2. **会话页 AI 输入栏发送消息时有数秒卡顿**，低配机更久。
3. **侧栏左上角「设计」「能力」两个入口首次进入慢**，低配机明显。

排查方式：四路并行代码审计（侧栏渲染路径 / 发送链路 / 两个入口加载路径 /
theme-ui 视图与动画实现），逐条给出 file:line 证据后再动刀。

## 根因图谱

### 优化点 1：侧边栏切换卡顿

| # | 根因 | 证据 |
| --- | --- | --- |
| 1.1 | 导航高亮条用 motion spring 逐帧写 `left/top/width/height` 四个布局属性，每帧触发整条侧栏 layout；macOS 侧栏叠原生 vibrancy，每帧还要重合成模糊 | `theme-ui/src/sidebar/SidebarNavigation.tsx` |
| 1.2 | 每个项目组的展开/折叠是 motion 的 `height: 0↔auto` 动画（每帧 JS 测量 + 回写像素高度），且每组常驻一个 `AnimatePresence`；项目多时线性放大 | `theme-ui/src/project/ProjectSessionsView.tsx` |
| 1.3 | `ScrollFade` / `QuickScrollOverlay` 各挂 `MutationObserver({subtree:true})` + 每子节点 `ResizeObserver`，回调同步读 `scrollHeight`（强制 layout）；侧栏共 4 实例，与 1.2 的高度动画构成「DOM 变动→回调→强制布局→再触发观察者」自激循环 | `theme-ui/src/shared/ScrollFade.tsx`、`theme-ui/src/project/QuickScrollOverlay.tsx` |
| 1.4 | 每次 `openSession` 结尾必发一次全量 `listSessions`，`sessionsMapAtom` 换 Map 引用 → 依赖它的 `openSessionByTarget` 换身份 → **所有** memo 的 `ProjectGroup` 整排失效重渲染 | `useProjectsPanelModel.ts` |

### 优化点 2：发送消息卡顿

| # | 根因 | 证据 |
| --- | --- | --- |
| 2.1 | **最大单点**：`sendMessage` 在 prompt IPC 前 `await waitForPluginHostReady()`（超时 5s）。任何插件集合变化（冷启动、安装、热重载）都把该 Promise 重置为 pending——低配机插件宿主加载慢，发送在此静默挂起数秒。症状特征：乐观气泡立即上屏，但几秒内无任何流式反应 | `useSessionMessageSender.ts:477`、`plugin-events.ts` |
| 2.2 | 一次点击 3~4 轮级联 React commit：`useChatViewModel` 订阅 `activeSession` 整对象且每次渲染重建 `actions` / `model.header` 字面量；ChatView 把 header memo 成 slot 元素写进全局 `pageHeader` atom，引用一变 RootLayout header 就多提交一轮 | `useChatViewModel.ts`、`ChatView.tsx` |
| 2.3 | 视窗内每条用户气泡的 `useUserMessageModel` 订阅 `activeSession` 整对象：流式期间 token 计数等任意字段变动把所有可见用户气泡（含前缀/段落解析）整排重跑 | `useUserMessageModel.tsx` |
| 2.4 | 带图/Appshot 发送的瞬间，输入栏附件区经 `AnimatePresence` 的 `height:auto` 动画收起，逐帧 JS 测量与同帧的消息上屏、列表滚动叠加 | `input-bar/InputBarView.tsx` |
| 2.5 | （与 3.2 同源）冷启动时设计插件 853KB 整包求值拖慢插件宿主就绪，直接放大 2.1 的等待窗口 | 见优化点 3 |

### 优化点 3：设计 / 能力入口首开慢

| # | 根因 | 证据 |
| --- | --- | --- |
| 3.1 | 能力页详情抽屉子树被无条件静态 import，把 react-markdown + **shiki 全量高亮器**（几百 KB 解析/求值）拖进能力页首开 chunk——即使从未打开过详情 | `AbilitiesPage.tsx` → `AbilityDetailSheet` → … → `SyntaxHighlightedCode.tsx` |
| 3.2 | 设计插件产物是 **853KB 单块** JS + 68KB CSS，App 启动即整包求值：其中 history runner 源码（`?raw`，400KB 字符串）与画布/画廊/导出/预览全部静态打进入口 | `vetta-ui-design/src/index.tsx`、`history/runner-host.ts` |
| 3.3 | 画廊每次进入 `force: true` 绕开 5 分钟 TTL 强拉 300+KB 设计体系清单，且同一挂载内重复调用（activate 时已拉过一次） | `gallery/GalleryView.tsx` |
| 3.4 | 能力卡首屏最多 60 个远程 `<img>` 无 lazy/async，集中抢主线程与网络 | `AbilityIcon.tsx` |
| 3.5 | 能力页 chunk 本身首次点击才下载求值，低配机上这段时间完全暴露 | `router.tsx`（React.lazy） |

## 改动清单（按提交粒度）

### 动画：JS 驱动 → 纯 CSS（允许的视觉简配：spring 手感换成 200ms ease-out 过渡，视觉差异极小）

1. **`perf(theme-ui): 侧栏导航指示条改为 CSS transform 过渡`**
   位置走 `transform: translate3d`（合成器承担），宽高只重排 absolute 指示条自身；
   `motion-reduce:transition-none` 降级。→ 修 1.1
2. **`perf(theme-ui): 项目组展开/折叠改为纯 CSS grid 过渡`**
   `grid-template-rows: 0fr↔1fr` 过渡替代 motion `height:auto`；新增
   `useDelayedUnmount`（折叠动画播完再卸载子树，动画期间零 JS 帧工作）。→ 修 1.2
3. **`perf(desktop): 输入栏附件胶囊区折叠改为纯 CSS grid 过渡`**
   同款原语（`useDelayedUnmount` 自 theme-ui/shared 公开导出）。→ 修 2.4

### 观察者与订阅面

4. **`perf(theme-ui): 滚动辅助观察者合帧并停用全子树监听`**
   回调 rAF 合帧（每帧至多一次布局读取）；MutationObserver 只监听直接子节点
   （深层尺寸变化由子节点 ResizeObserver 覆盖）；卸载取消悬挂 rAF。→ 修 1.3
5. **`perf(desktop): 会话点击回调不再随 sessionsMap 换引用而失稳`**
   `openSessionByTarget` 走 ref 读取最新 Map，回调身份稳定，`ProjectGroup` memo
   在 listSessions 回填后继续命中。→ 修 1.4
6. **`perf(desktop): ChatView 模型收窄订阅并稳定 header/actions 引用`** → 修 2.2
7. **`perf(desktop): 用户气泡模型只订阅会话 runtimeId/cwd`** → 修 2.3

### 发送链路

8. **`perf(desktop): 发送消息只等插件宿主首次激活，不再被热重载挡住`**
   拆出 `waitForPluginHostFirstReady`：冷启动首轮发送仍等插件工具 schema 注册齐
   （保持 af739f7a1 的修复语义）；首次就绪后发送零等待（热重载走 last-known-good
   注册）。工作区路由继续用逐周期的 `waitForPluginHostReady`。→ 修 2.1

### 首开路径

9. **`perf(desktop): 能力页首开剥离详情抽屉子树，图标懒加载`**
   详情抽屉 `React.lazy`（带 `?detail=` 才拉取，请求过后保持挂载）；图标
   `loading=lazy decoding=async`。→ 修 3.1、3.4
10. **`perf(vetta-ui-design): 入口 chunk 836KB→216KB`**
    画布/画廊/导出/预览/截图卡五个 UI 面插件内 React.lazy；runner 400KB `?raw`
    源码改为首次执行历史命令时动态 import。异步 chunk 经 `vetta-plugin://` 的
    可行性已核实（协议按 standard scheme 服务插件目录任意文件；MF runtime 本就
    用动态 `import()` 拉 exposed chunk）。→ 修 3.2、2.5
11. **`perf(vetta-ui-design): 进入画廊不再强制拉风格库清单`**
    挂载自动刷新走 TTL + ETag；仅手动「刷新」才 force。→ 修 3.3
12. **`perf(desktop): 空闲期预取能力页路由 chunk`**
    RootLayout 挂载后 `requestIdleCallback`（8s 兜底）预取，点击零等待。→ 修 3.5

### 构建产物对比（vetta-ui-design）

| chunk | 改前 | 改后 |
| --- | --- | --- |
| 入口 index | 836KB（gzip ~236KB） | **216KB（gzip 71KB）** |
| runner（历史命令首次执行才加载） | —（内嵌入口） | 402KB 按需 |
| CanvasTab（打开画布才加载） | —（内嵌入口） | 110KB 按需 |
| ExportMockupDialog / GalleryView / VetdPreview / ScreenshotCard | —（内嵌入口） | 50 / 29 / 10 / 4 KB 按需 |

## 测试矩阵

新增测试（全部通过）：

| 测试文件 | 覆盖的合同 |
| --- | --- |
| `apps/desktop/.../sidebar/SidebarNavigationIndicator.test.tsx` | 指示条位置由 transform + 具体属性 CSS 过渡承担；不回退 left/top JS 动画；reduce-motion 降级 |
| `apps/desktop/.../sidebar/ProjectSessionsViewCollapse.test.tsx` | grid-rows 折叠动画、aria-hidden、延迟卸载/取消卸载、初始折叠不渲染 |
| `apps/desktop/.../sidebar/ScrollObserverCoalescing.test.tsx` | 观察者/滚动 rAF 合帧、MutationObserver 无 subtree、卸载取消悬挂 rAF |
| `apps/desktop/.../panel/useProjectsPanelModel.selectSession.test.tsx` | selectSession 身份稳定 + 点击读最新 sessionsMap（viewer/交互分流不回退） |
| `apps/desktop/.../plugins/runtime/plugin-events.test.ts` | 首轮发送门冷启动仍等待、首次就绪后热重载不再阻塞、逐周期门语义不变、超时兜底 |
| `apps/desktop/.../hooks/useChatViewModel.header.test.tsx` | header/actions 引用稳定；无关字段变动不重算；导出可用性翻转仍生效 |
| `apps/desktop/.../input-bar/useDelayedUnmount.test.tsx` | 延迟卸载原语：立即挂载 / 延迟卸载 / 中途取消 |
| `apps/desktop/.../abilities/AbilitiesPage.lazy-detail.test.tsx` | 无 detail 不求值详情模块、有 detail 懒加载、请求过后保持挂载 |
| `apps/desktop/.../root-layout/useIdleRoutePrefetch.test.tsx` | 挂载同步段不求值、空闲触发才拉取、卸载取消 |
| `vetta-ui-design/test/entry-lazy-surfaces.test.ts` | 入口静态 import 闭包不含大件 UI 面与 `?raw` runner（防回归的结构合同） |
| `vetta-ui-design/test/gallery-catalog-refresh.test.tsx` | 挂载刷新不带 force、手动刷新带 force |

同时更新：`useSessionManager.*.test.ts` 三个文件的 plugin-events mock 补齐新导出。

## 考虑过但未做的（及原因）

- **分栏 `max-height` 350ms 过渡改 grid fr 过渡**：现语义是「项目区按内容自然高、
  max-height 只做上限」，fr 会在内容短时留白，行为不等价；其自激反馈已由观察者
  合帧消除，保留原动画。
- **`useSessionManager` 在 RootLayout 与 ChatPage 双挂载**（双份 atom 订阅、ref
  互覆）：属架构问题，改动面大且与本轮三个症状非直接相关，仅记录。
- **能力页首屏 60 卡分页/虚拟化**、**主进程开放市场首次全量 sync 阻塞首屏**：
  后者在主进程（首次无缓存下载 GitHub 归档，二次进入命中内存快照——这是「首次
  慢、二次快」的另一半），需要单独设计预热/骨架策略。
- **设计页首屏 6–9 个 `srcDoc` iframe**（1280px 布局再缩放）：已有
  IntersectionObserver 兜底，进一步优化需要封面位图化，改动面大。
- **`LazyMotion` 全局分包**（113 个文件 import motion 全量）：收益在主 bundle 体
  积，与本轮交互卡顿正交，留作后续。

## 已知残留 / 风险

- `vetta-ui-design/test/design-session.test.ts` 两条用例在本轮改动**之前**即失败
  （fakeCtx 缺 `ctx.command` 导致历史初始化路径抛错），与本轮无关，未扩大范围修复。
- 指示条与展开/折叠动画由 spring 手感换成 200ms ease-out：视觉上略「直」一点，
  属任务允许的简配；`prefers-reduced-motion` 全部尊重。
- 插件异步 chunk 依赖 `vetta-plugin://` 协议服务任意 dist 文件——该机制被 MF
  runtime 每次插件加载验证，但若未来协议收紧白名单，需同步放行 `assets/*.js`。
- 首次冷启动的首轮发送仍会等插件宿主（语义保留）；插件入口瘦身后该窗口显著缩短。

## 验证记录

- `bun run check`（Biome + tsgo + desktop tsc + guards）：绿。
- `apps/desktop` 全量 Vitest：1129 通过 / 2 失败——两条失败均为**主进程既有的
  本机环境问题**（`plugin-dev-watch` 的 macOS `/private` 符号链接路径断言、
  `im-host/coding-agent-spec` 的 Windows 可执行前缀断言在本机 node 下的期望差），
  本轮 diff 未触碰 `src/main`，与改动无关。
- `vetta-ui-design`：`bunx tsc --noEmit` 绿；`bun run build` 产物如上表；除上述两条
  既有失败外测试全绿（500+ 通过）。
- 未运行：真实 Electron E2E / `verify:ui:*`（本轮改动均有组件级合同测试覆盖，
  低层测试可证明；建议下次发版前照常跑一轮启动连通性检查）。
