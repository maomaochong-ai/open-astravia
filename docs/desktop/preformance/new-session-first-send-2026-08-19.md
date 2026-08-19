# 新会话首次发送：先反馈、后初始化

> 日期：2026-08-19
>
> 范围：Desktop Renderer 的新会话首次发送链路
>
> 结论：把路由和乐观消息提交到首帧之后，再创建 session、初始化 runtime 和发送 prompt。

## 问题表现

在新会话页提交第一条消息时，界面会停留约 0.8 秒，之后才进入聊天页并显示用户消息。已有会话发送同样内容时，乐观消息约 1 毫秒即可进入状态，因此问题不在通用输入组件，也不在模型首 token 延迟，而在“新建会话”特有的初始化顺序。

旧链路把 session 创建、runtime 初始化和订阅都放在导航之前：

```text
点击发送
  -> 创建 session
  -> 创建或获取 runtime
  -> 组装 capability 与初始 system prompt
  -> 激活 session
  -> 导航到聊天页
  -> 订阅 session
  -> 写入乐观消息
  -> 发送 prompt
```

这些工作是必要的，但不应阻塞用户能看见的第一步反馈。

## 如何复现

### 环境

从仓库根目录启动隔离的 UI 验证实例。`runtime-canary` 使用本地确定性 runtime，不调用真实 Provider，也不会产生模型费用：

```powershell
bun run verify:ui:start -- --runtime-canary
bun run verify:ui:pw -- snapshot
```

用 `snapshot` 返回的当前元素引用填写新会话输入框并点击发送：

```powershell
bun run verify:ui:pw -- fill <input-ref> "performance canary"
bun run verify:ui:pw -- click <send-ref>
bun run verify:ui:pw -- console info
```

页面变化后元素引用会失效；继续操作前应重新执行 `snapshot`。验证结束后关闭实例：

```powershell
bun run verify:ui:stop
```

### 性能打点

Renderer 已有发送链路的可选性能打点。只在验证实例的 DevTools 中启用，完成后关闭：

```js
localStorage.setItem("vetta-perf-send", "1");
location.reload();
```

排查时同时采集四类时间：

1. 业务标记：提交、路由、session 创建、订阅和 prompt dispatch。
2. 浏览器帧：用 `requestAnimationFrame` 区分状态写入与真正可见的 paint。
3. `PerformanceObserver` 的 long task：确认主线程是否仍被 React commit 或同步计算占用。
4. React Profiler：定位 Root、RouteOutlet、ChatView 等宽订阅引起的提交成本。

不要只记录点击到 IPC 返回的总耗时。它无法回答“时间花在哪个进程”“状态已经写入但是否已经绘制”“是否只是 Provider 慢”这三个关键问题。

## 定位过程

### 1. 用已有会话作为对照组

已有会话的第二次发送不需要创建 runtime。实测乐观消息约 `1.4 ms` 写入，第一帧约 `130.7 ms`。这说明输入采集和消息暂存本身很快，新会话额外路径才是主要变量。

### 2. 用失败创建排除 Provider

在没有 Provider 的新鲜状态中创建会话，创建请求约 `36.6 ms` 即失败，但 Renderer 随后仍出现约 `239 ms` 的 long task。即使没有进入模型调用，界面仍会卡顿，说明至少存在独立的 Renderer 渲染成本。

### 3. 用本地 runtime 拆分主进程耗时

优化前的 runtime-canary 基线如下：

| 事件 | 点击后时间 |
| --- | ---: |
| session 创建开始 | 约 `1 ms` |
| 主进程 session 创建完成 | 约 `620 ms` |
| 乐观用户消息写入 | `842.1 ms` |
| prompt dispatch | `842.5 ms` |

主进程记录的创建总耗时约 `619.2 ms`，其中 runtime 创建约 `608.1 ms`。细分阶段包含 peripherals、prompt runtime、turn capabilities 和 initial system prompt 等工作。这些阶段存在嵌套或重叠，不能直接相加得到总时间。

首次创建使用独立工作目录。这个行为来自 [ADR-0007](../../adr/0007-conversation-per-session-cwd.md)，用于避免默认对话之间的文件污染：

- `apps/desktop/src/main/conversations/session-paths.ts` 使用 `randomUUID()` 生成会话目录。
- `packages/runtime-desktop/src/backend-pool.ts` 把精确 cwd 纳入 runtime scope key。
- 新默认会话因此不能直接复用另一会话的 backend。

这不是可以为了快而删除的偶然开销。真正的问题是 Renderer 在等待这些工作完成前没有给用户反馈。

### 4. 核对非根因

- 首次成功复现中 plugin host 已 ready，相关等待约 `0.1 ms`，不是本轮主因。
- prompt 在卡顿之后才 dispatch，真实 Provider 尚未参与，不能把延迟归因于网络或模型。
- session 独立 cwd 是明确的数据隔离约束，不应通过共享 cwd 或整套 runtime 来绕过。

## 方案取舍

评估过四种方向：

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 复用其他会话的 cwd/runtime | 拒绝 | 违反 ADR-0007 的文件和产物隔离约束 |
| 打开新会话页时完整预热 | 暂缓 | 需要草稿 session 的创建、取消、回收和历史列表语义 |
| 缓存 runtime 初始化中的不可变结果 | 后续考虑 | 能降低真实总耗时，但跨越 runtime/capability 边界，风险和验证范围较大 |
| 重排 Renderer 生命周期 | 采用 | 不修改 IPC 合同或隔离语义，能直接改善第一反馈时间 |

本轮优化目标不是减少模型响应总时间，而是把必须完成的慢工作移动到用户已经获得反馈之后。

## 实施设计

新链路拆成“界面阶段”和“runtime 阶段”两个明确阶段：

```text
点击发送
  -> 冻结本次输入快照
  -> 写入一条乐观用户消息
  -> 清空本次输入
  -> 写入 pendingSessionCreation
  -> 导航到聊天页
  -> 等待两次 requestAnimationFrame，确认路由已提交并绘制
  -> 创建 session/runtime
  -> 激活并订阅 session
  -> 用同一快照发送 prompt，不重复追加消息
  -> 后台补齐 session 状态和列表
```

核心实现位于：

- `apps/desktop/src/renderer/domains/chat/services/staged-new-session-send.ts`：冻结、提交和恢复 staged send。
- `apps/desktop/src/renderer/domains/chat/components/new-session/useNewSessionSend.ts`：提交入口和失败恢复。
- `apps/desktop/src/renderer/domains/chat/hooks/useSessionOpener.ts`：先导航、等待 paint，再创建和订阅。
- `apps/desktop/src/renderer/domains/chat/hooks/useSessionMessageSender.ts`：发送已暂存的快照，并避免第二个乐观气泡。
- `apps/desktop/src/renderer/shared/store/chat-atoms.ts`：保存独立的 pending session 状态。
- `apps/desktop/src/renderer/root-layout/useRootLayoutModel.ts`：在 pending 期间避免恢复旧会话覆盖新路由。

这里没有伪造 `activeSession`。只有真正拿到 session/runtime 后才写入 active 状态，依赖 runtimeId 的功能仍遵守原有边界。pending 状态只负责首屏展示和生命周期协调。

### 必须保持的不变量

- 每个默认会话仍使用独立 cwd。
- prompt 只发送一次，乐观用户消息只追加一次。
- 提交时冻结文本、附件和选项；初始化期间用户继续输入的下一条草稿不会被旧请求清空。
- 重复点击仍由现有 guard 拦截。
- 创建失败时返回新会话页，并恢复原始输入快照。
- active session、订阅、取消、usage 和错误语义保持不变。

## 优化前后对比

两组数据来自同一类本地 runtime-canary 流程。桌面负载会造成小幅波动，数字用于判断事件顺序和量级，不是跨机器基准。

| 指标 | 优化前 | 优化后 | 说明 |
| --- | ---: | ---: | --- |
| 乐观消息状态写入 | `842.1 ms` | `1.2 ms` | 用户动作不再等待 runtime |
| 聊天页首帧 | 在约 `840 ms` 后才具备消息 | `204.9 ms` | 当前仍受路由渲染成本影响 |
| runtime 创建开始 | 约 `1 ms` | `238.1 ms` | 有意推迟到已提交的 paint 之后 |
| runtime 创建结束 | 约 `620 ms` | `819.2 ms` | 优化后单次创建约 `581.1 ms` |
| prompt dispatch | `842.5 ms` | `954.7 ms` | 比旧链路稍晚，但用户已先看到反馈 |
| 用户消息气泡 | 1 条 | 1 条 | staged send 没有造成重复 |

优化后的关键 trace：

```text
new-session-submit        0.2 ms
handler-return            0.3 ms
optimistic-append         1.2 ms
session-route-start       1.2 ms
session-route-ready     202.0 ms
frame #1                204.9 ms
frame #2                237.6 ms
session-route-painted   237.8 ms
session-create-start    238.1 ms
session-create-end      819.2 ms
session-subscribe-end   952.7 ms
prompt-dispatched       954.7 ms
```

这次改变的是感知延迟和执行优先级。prompt dispatch 因等待路由 paint 比旧实现晚约 `112 ms`，但用户不再面对约 `842 ms` 的无反馈窗口。这是有意的产品取舍，而不是 runtime 性能已经解决。

## 验证方式与结果

### 自动化测试

定向运行以下 6 个测试文件，共 22 个测试，全部通过：

```powershell
bun scripts/quality/run-vitest.mjs --run `
  apps/desktop/src/renderer/domains/chat/hooks/useSessionManager.session-switch.test.ts `
  apps/desktop/src/renderer/domains/chat/hooks/useSessionManager.queue.test.ts `
  apps/desktop/src/renderer/domains/chat/hooks/useSessionManager.stale-instance-send.test.ts `
  apps/desktop/src/renderer/domains/chat/components/new-session/useNewSessionSend.test.tsx `
  apps/desktop/src/renderer/domains/chat/services/staged-new-session-send.test.ts `
  apps/desktop/src/renderer/domains/chat/hooks/useChatViewModel.header.test.tsx
```

覆盖的关键风险包括：

- create 完成前已经导航并显示 staged message。
- session 创建成功后发送同一输入快照，且不重复追加消息。
- 创建失败恢复输入。
- 空输入和重复提交不进入创建流程。
- 初始化期间的新草稿不被旧请求覆盖。
- 原有 session 切换、排队和 stale instance 行为不回退。

质量门禁结果：

```text
bun run check:quick  通过
bun run check        通过（lint、types、guards）
git diff --check     通过
```

### 真实 Desktop 验证

本地 runtime-canary 中确认：

- 点击后先出现聊天页与唯一一条用户消息，再开始 runtime 创建。
- canary 回复成功返回。
- Console 没有 error。
- 未调用真实 Provider。

## 排查和实施经验

1. 先建立对照组。新会话首发和已有会话续发的差异，比只看一条总耗时更容易暴露生命周期问题。
2. 用确定性本地 runtime 和快速失败路径分别排除网络、Provider 与主进程初始化，把 Renderer 卡顿单独量出来。
3. 一次交互使用同一个 correlation/interaction ID 贯穿 Renderer 和 Main，跨进程日志才能按因果关系对齐。
4. 区分“atom 已写入”“React 已 commit”和“浏览器已 paint”。前两者快并不代表用户已经看到内容。
5. 记录 long task 和 React commit。IPC 结束后的长任务通常意味着渲染或宽订阅，而不是后端仍在执行。
6. 不相加嵌套计时。phase timeline 应结合父子关系解读，否则会得到超过总耗时的错误结论。
7. 优化顺序前先列不变量。本例中 session cwd 隔离、单次发送、失败恢复和草稿并发都比少几十毫秒更重要。
8. 对异步重排专门测试输入快照。用户在初始化期间继续打字，是最容易被“发送后清空输入”破坏的竞态。
9. 用数据承认取舍。本轮 prompt 更晚 dispatch，但无反馈窗口显著缩短；如果只展示最好看的指标，会掩盖真实成本。

## 剩余瓶颈与后续方向

当前路由首帧仍约 `205 ms`，没有达到理想的 `<100 ms`。优化后 trace 中 React 提交仍较宽：Root、RouteOutlet 和 ChatView 在初始化期间多次更新，session 创建后的状态补齐也会产生 long task。

建议按以下顺序继续：

1. 缩小 Root 和 RouteOutlet 对聊天 atoms 的订阅范围，避免无关状态让整棵路由树提交。
2. 合并 session hydrate 阶段的相关 atom 更新，减少连续 commit，同时保持单一事实源。
3. 评估订阅握手是否能拆成“主进程开始缓冲事件”和“Renderer 后台完成订阅”，但必须先证明不会丢事件。
4. 对 runtime 初始化中的不可变 capability、prompt 片段做按 scope 的可失效缓存；这是降低总响应时间的下一层工作。
5. 若产品接受草稿 session 生命周期，再评估空闲预热，并明确取消、回收和历史列表可见性。

后续性能目标应分别跟踪：乐观状态 `<10 ms`、实际可见首帧 `<100 ms`、Renderer 不出现 `>50 ms` long task，以及 prompt dispatch/首 token 总耗时。把这些指标分开，才能避免用更快的动画掩盖更慢的后端，或用更快的后端掩盖无响应的界面。
