# ADR-0111：Agent Team 活动面板收敛到普通对话表面

## 状态

已接受

## 背景

ADR-0105 决策 7 让 Team 只启用 File 与 Browser 两个页签，并把「为 Team 聚合 Todo、后台任务、Workflow、
Debug 或插件能力」列为不在范围。当时的理由是这些页签以单一 Runtime 为数据源，而 Team 拥有协调与多个成员
Runtime，无法选出一个冒充整体。

代价在产品上比预期大：Team 对话的活动面板实际只剩 File 一个页签——Browser 在没有 URL 时不产出元数据，
插件页签被 `enablePluginTabs: false` 关闭，而 `DefaultChatView` 也从不向面板透传对话场景，Team 又刻意不写
全局 `currentScenarioAtom`，于是插件的 `scope_use` 过滤永远 fail-closed。用户在 Team 里失去了普通对话中已有的
全部插件面板。

真正缺的不是「Team 特判」，而是工作空间没有表达自己聚合哪些 Runtime、以及自己属于哪个对话场景。

## 决策

1. `ActivityWorkspace` 合同增加 `runtimeIds`：宿主显式声明该工作空间聚合哪些 Runtime。普通对话、项目与会话
   查看器传当前活动会话的单个 Runtime；Team 传协调 Runtime 与全部成员 Runtime，进入成员视图时收窄为该成员。
2. Todo、后台任务与 Workflow 页签改为按工作空间的 `runtimeIds` 汇总，并为每一行保留归属 Runtime；停止、中断与
   清理动作按行路由回真正执行它的 Runtime，不再假设面板只有一个 Runtime。据此取消 ADR-0105 决策 7 的页签白名单，
   Team 与普通对话使用同一套内置页签。
3. 对话场景随视图模型下发，不再一律取全局 `currentScenarioAtom`。Team 自行派生：固定到项目的会话取 `project`，
   使用自有工作空间的取 `conversation`，与 `useSessionOpener` 给普通会话下发的口径一致。插件页签在 Team 中按
   同一套 `scope_use` 规则参与，不新增场景 slug。

## 备选方案

- **新增 `agent-team` 场景 slug**：语义最干净，但现有插件都没有声明它，fail-closed 过滤下 Team 仍然一个插件页签
  都不会出现，等于要求全生态逐个适配才能恢复功能。
- **保留白名单，只放开插件页签**：能解决用户可见的主要缺失，但 Todo 与后台任务在 Team 中依旧不可见，而它们恰好是
  多成员协作时最需要的执行视图。

## 后果

- Team 对话的活动面板与普通对话一致：内置页签按自己的数据条件出现，已注册插件页签按场景直接上栏。
- 多 Runtime 聚合视图不区分成员：Team 全景下的 Todo 与后台任务是协调与全部成员的并集，暂不携带成员身份标注。
  需要按成员阅读时进入成员视图，面板会收窄到该成员的 Runtime。
- ADR-0105 决策 7 与其「不在本决策范围」中关于 Team 页签与插件能力的部分由本 ADR 取代；该 ADR 关于会话目录、
  工作空间固化与面板 Primitive 组合的其余决策不变。
- 插件的 `openActivityTab` / `setActivityTabVisible` 仍以会话 cwd 为 attach key（ADR-0026），而面板的上栏记录已按
  `workspace.id` 隔离（ADR-0105 决策 5）。两者在普通对话中同值，在 Team 中不同值：插件页签默认上栏可见，但插件
  主动调用这两个 API 在 Team 中不会命中面板记录，留待后续统一到工作空间键。
