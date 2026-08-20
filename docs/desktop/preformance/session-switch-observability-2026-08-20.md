# 侧边栏会话切换：跨进程性能诊断

> 日期：2026-08-20
>
> 范围：Desktop 侧边栏打开已有交互式会话

## 当前链路与主要假设

侧边栏点击最终进入 `useSessionOpener.openSession()`。已有会话当前仍需要先通过
`session.create` 恢复 Runtime，之后并行请求完整历史与状态，最后建立 Renderer 事件订阅：

```text
点击会话
  -> 清理旧会话 Renderer 状态
  -> 只读 Viewer 历史读取并展示完整消息
  -> IPC session.create
     -> Desktop 配置解析
     -> Runtime create/resume
        -> Coding Agent session initialization
  -> 写 activeSession
  -> 并行 getFullHistory + getState
  -> 历史转换并写入 chatMessages
  -> 状态水合
  -> subscribe
  -> 会话可交互
```

因此“切换慢”至少有三类可能来源，不能只看一次 IPC 总耗时：

1. Main/Runtime 恢复慢：`session.create-start -> session.create-end` 占主要时间。
2. 历史读取或 Renderer 映射慢：`session-hydration-start -> session-history-loaded` 或
   `session-history-loaded -> session-history-mapped` 占主要时间。
3. React/浏览器主线程慢：IPC 阶段不慢，但首个 `frame#N` 晚，或记录到大于 50ms 的 long task。

此外，当前 `activeSession` 在 `session.create` 返回后才更新。即使慢点完全位于 Runtime，侧边栏高亮和
聊天页也会在等待期间缺少即时反馈。这是可观测性确认后最可能需要调整的感知性能边界。

## 开启与关闭

在 Desktop Renderer DevTools Console 执行：

```js
localStorage.setItem("vetta-perf-session-switch", "1");
location.reload();
```

完成复现后关闭，避免持续采集浏览器 long task：

```js
localStorage.removeItem("vetta-perf-session-switch");
location.reload();
```

诊断关闭时仍会为每次已有会话打开生成一个随机 `interactionId` 并传给 Main；不会安装
`PerformanceObserver`、帧回调或 Renderer 诊断计时器。

## 日志位置与关联方法

一次操作会产生三类可关联记录：

| 日志 | 文件 | 关联字段 | 作用 |
| --- | --- | --- | --- |
| `[PERF-session-switch]` | `~/.vetta/desktop-app/logs/render/YYYY-MM-DD.log` | `interactionId` | Renderer 阶段、前 5 帧、long task 与 MessageList React 提交 |
| `session creation trace` | `~/.vetta/desktop-app/logs/main/YYYY-MM-DD.log` | `interactionId`、`sessionId` | Desktop 包装层与 `runtime-create` 总耗时 |
| `session initialization trace` | 同上 | `sessionId` | Coding Agent 初始化的细阶段与 create/resume 类型 |

先用 Renderer 行中的 `interactionId` 查 Main 的 `session creation trace`，再用该行返回的 `sessionId`
查 `session initialization trace`。日志不记录 cwd、会话标题、消息正文或历史内容。

Renderer 使用单行 JSON，既能在 DevTools 搜索，也能由诊断包或脚本稳定解析。快速连续点击时每次打开
各自保留 trace；旧操作若在订阅时发现已被新操作取代，会输出 `status: "cancelled"`。
`reactCommits` 会记录 `MessageList:initial-viewport` / `MessageList:expanded-viewport` 的提交阶段、实际耗时与基线耗时；
最多保留 100 条，超出的数量写入 `droppedReactCommits`，不会记录消息正文或组件 props。

## 阶段解释

| 阶段 | 含义 |
| --- | --- |
| `open-session-enter` | 点击处理进入会话打开逻辑 |
| `renderer-reset-complete` | 旧订阅、流式缓冲与会话 UI 状态已同步清理 |
| `pending-ui-scheduled` | 已有会话的内部 transition、目标高亮和草稿作用域已同步写入；随后立即异步恢复 Runtime，不改变 UI 可用性 |
| `pending-ui-painted` | 新会话首条乐观消息已完成两帧提交 |
| `pending-ui-paint-timeout` | 新会话首发窗口被遮挡导致 rAF 节流；让出 100ms 后继续，避免创建流程挂死 |
| `session-preview-history-start/loaded/mapped/committed` | 只读 Viewer 历史的读取、转换与首屏 atom 提交 |
| `session-preview-history-painted` | Viewer 历史消息已经过两帧 paint barrier；窗口隐藏时记为 `paint-skipped-hidden` |
| `session-create-start/end` | Renderer 观察到的 Main IPC 往返 |
| `active-session-set` | 新 runtimeId/path 已写入 Jotai |
| `navigation-dispatched` | 聊天根路由更新已发起；不是 paint 完成 |
| `session-hydration-start` | 历史与状态 IPC 已并行发起 |
| `session-history-loaded` | 历史 IPC 返回 |
| `session-history-mapped` | 历史已转换为 ChatMessage |
| `session-state-loaded` | 状态 IPC 返回并开始写入会话 atoms |
| `session-subscribe-start/end` | Renderer 实时事件订阅握手 |
| `session-hydration-committed` | 历史、状态与订阅均已完成 |
| `frame#1..5` | 点击后的前五个浏览器帧到达时间 |

`completed` 后延迟 1 秒再汇总，目的是保留完成附近的帧与 long task；`totalDurationMs` 截止于完成标记，
不包含这 1 秒观察窗。15 秒仍未完成会输出 `status: "timeout"`，以便发现卡住的阶段。

## 如何据数据选择修复

- `runtime-create` 明显占主导：继续下钻 `session initialization trace`。优先缓存可按 scope 复用的
  不可变初始化结果，不能绕过 per-session cwd、锁、权限或插件/能力装配。
- Main 很快、`session-history-loaded` 很慢：检查 JSONL 读取与历史体积，评估分页/增量历史合同；这会涉及
  公共行为与流式恢复语义，实施前需要合同测试。
- `session-history-loaded -> session-history-mapped` 慢：对历史转换做 CPU profile，优先减少重复解析，或把
  可缓存的稳定块按 entry id 复用。
- IPC 都快但首帧/long task 慢：用 React Profiler 检查 Root、RouteOutlet、ChatView、MessageList 的提交，
  收窄 atom 订阅并合并同一水合阶段的状态提交。
- 无论 Main 是否慢，若点击后长期没有视觉反馈：使用 `pendingSessionOpen` 立即切换目标身份和草稿作用域，
  再恢复 Runtime；pending 只用于内部 newest-wins 与操作排序，不得伪造 runtimeId，也不得通过加载文案、
  隐藏控件或 disabled 状态把生命周期门禁暴露给用户。

建议性能目标分开衡量：点击反馈/首帧小于 100ms、Renderer 无大于 50ms long task、Runtime 恢复耗时、
历史可见耗时和最终可交互耗时。只有这样才能区分感知性能与真实总耗时。

## 2026-08-20 根因与修复

`.vetta-dev` 历史会话冷切换基线为 `4337.7ms`。其中 `runtime-create` 为 `3434.9ms`，进一步下钻发现
`initial-system-prompt` 为 `2053ms`、`prompt-runtime` 为 `1151ms`。前者是在资源刚完成 `reload()` 后，
初始化预览又通过 Turn binding 重复执行资源 freshness scan。

修复分为两个互补部分：

1. Coding Agent 初始化预览改为读取刚提交的 Session 资源 generation，不触发 Turn binding；真实 Turn
   仍按原合同执行 freshness scan，因此会话创建后修改的 Prompt、Skill 与设置仍会在发送时生效。
2. Renderer 增加 `pendingSessionOpen` 两阶段打开状态。点击后同步提交侧边栏目标高亮、目标草稿作用域并清空旧消息，
   随即通过异步 IPC 调用 `session.create`，浏览器可在 Main 恢复期间独立 paint。pending 不产生用户文案、布局变化或
   disabled 状态；发送会立即捕获草稿并乐观上屏，依赖 Runtime 的消息操作在内部等待订阅就绪。每个操作用 token 与 `interactionId` 做
   newest-wins 提交；失败、取消和订阅异常都会退出加载态，旧操作不会覆盖后来者。RootLayout 的启动恢复骨架会识别
   `pendingSessionOpen`，不再在这段时间卸载 ChatView/MessageList。
3. Viewer 历史到达后直接渲染完整消息 UI；Runtime 只负责实时订阅和发送、编辑、Fork 等交互就绪，不再决定
   Markdown、Shiki、工具调用或插件卡片何时出现。Virtuoso 首次提交把屏幕外 overscan 收为 0，真实可见行的
   内容与高度保持完整；历史出现后再通过 `requestIdleCallback`（300ms 超时兜底）与 React transition 扩大屏幕外
   预渲染范围。切换期间 Virtuoso 直接采用目标 `sessionPath`，不再经历旧路径 → `null` → 新路径的两次身份重置。
   Runtime canonical 历史在一次性的水合边界按 message id 做结构共享：内容不变的消息沿用 Viewer 对象，只有变化行
   进入第二次 React 更新。已有会话打开期间不插入 footer，也不向 ChatPage 传递 pending 展示合同；内部就绪协调器
   将操作绑定到点击时的目标 transition，既优先接受输入，也不会误发到旧 Runtime 或被重定向到后来打开的会话。

复测数据见同任务 `.ai/desktop-session-switch-performance/README.md`；该目录为本地实施记录，不进入发布制品。

同一 `.vetta-dev` 历史会话环境的最终 cold-switch 样本：

| 指标 | 修复前 | 修复后 | 变化 |
| --- | ---: | ---: | ---: |
| Renderer 完成 | 4337.7ms | 2297.7ms | -47.0% |
| Main `session.create` | 3440.9ms | 1429.3ms | -58.5% |
| Runtime 初始化 | 3306.8ms | 1294.3ms | -60.9% |
| `initial-system-prompt` | 2053ms | 2.8ms | -99.9% |
| pending UI 状态调度 | 无 | 4.9ms | 新增即时反馈边界 |

样本来自不同历史文件，历史体积会影响 Renderer 水合，不能把单次数字视为 benchmark 保证。最终样本仍有
`592ms` 的历史/状态列表提交 long task 和 `246ms` 的订阅附近 long task；它们已不再阻塞目标会话反馈或
Runtime 启动。随后对同一开发历史的分段采样进一步确认：Viewer 数据在约 `282ms` 已提交，但首次消息树渲染仍产生
约 `553ms` long task，canonical 水合又产生约 `469ms` long task，因此本轮将富消息子树移出历史首屏关键路径。
这些数字用于定位而非性能承诺；优化后的真实历史复测应结合 `reactCommits` 分别检查 initial 与 expanded viewport
提交。实现过程中曾验证“纯文本轻量投影 → Runtime 就绪后完整消息”的方案，虽然 React 提交很短，但两套内容高度
不同会触发 Virtuoso 重测与肉眼可见的布局切换，因此已移除。当前两阶段只改变屏幕外预渲染预算，不改变可见消息
DOM、功能或高度；后续如仍出现长任务，应针对单条可见消息内部的 Markdown、Shiki 或大型工具结果优化。

移除轻量投影后的 Dev 历史会话样本中，Viewer 历史在 `272.1ms` 写入，完整消息的 initial viewport 更新在
`345.8ms` 完成、`actualDuration=2ms`；Runtime create 到 `374.5ms`、实时订阅到 `783.3ms` 才完成。屏幕外
预渲染范围在浏览器获得空闲预算后于 `921.5ms` 扩大，`actualDuration=1.3ms`。UI 自动化同时确认已有会话打开
期间“正在打开会话”节点数量始终为 0。输入和消息操作保持可用；发送会先乐观展示，再在内部等待目标 Runtime
订阅就绪。该样本的 Runtime 有缓存且历史
较小，只用于验证事件顺序和单一消息 DOM 合同，不与前面的 cold-switch 数字直接比较。
