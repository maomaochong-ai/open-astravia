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
3. 对话场景随视图模型下发，不再一律取全局 `currentScenarioAtom`。Team 下发 `project`，与 Runtime 对齐——协调与
   成员会话都由 `resolveDesktopSessionConfig` 以 kind `"other"` 创建，场景恒为 `project`。UI 与 Runtime 必须用同一个
   场景判定，否则会出现「工具在 Team 里可用、对应页签却永不上栏」的错位。插件页签在 Team 中按同一套 `scope_use`
   规则参与，不新增场景 slug。
4. 插件的 `openActivityTab` / `setActivityTabVisible` 改为按工作空间寻址：宿主挂载面板时登记工作空间，插件传入的
   会话 cwd 在写入前翻成该工作空间键；未登记时退回 cwd，普通对话两者同值，既有持久化记录原样可用。不传 cwd 时
   优先落到当前挂载的工作空间，而不是全局活动会话——Team 从不写活动会话。

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
- ADR-0026 的「attach 记录以会话 cwd 为 key」在普通对话中仍然成立（工作空间 id 即 cwd），但键的真身已是工作空间 id。
- 工作空间登记表只覆盖挂载中的面板。没有任何面板挂载时（用户在别的页面，Team 成员在后台跑工具），插件写入退回 cwd，
  Team 会落到一个面板不读的键上；重新进入该 Team 页面时，插件自身按 cwd 重新判定可见性的逻辑会补上。彻底解决需要
  把「会话 cwd → 工作空间」做成不依赖挂载的持久映射。
