# ADR-0068: Hosted Route 导航的三层职责

## 状态

Accepted

## 背景

Theme Page 与 Plugin Workspace View 都是由扩展方提供整页内容、由 Desktop 管理固定命名空间路由的
Hosted Route。旧实现分别直接调用 TanStack Router，重复维护页面 id、路径和导航入口；早期统一方案又把
Plugin/Theme 判别放进公共 Capability 合同，并让 Theme 通过 Host 特权入口绕过 AccessSession。这两种方案
都模糊了宿主基础设施与能力暴露层的边界。

Capability 架构采用依赖倒置：SDK 定义宿主无关端口，Runtime 执行通用授权机制，Desktop 导入端口并注册
Provider。React 组件贡献不可序列化，仍必须留在各来源系统的 renderer realm。

这条边界同样适用于其他能力：插件 facade 中的 `pluginId`、`plugin-blob` 等系统术语必须在插件集成层
转换为通用 Capability 合同的 `namespace`、`storage-blob`，不能穿透进 SDK 或 Runtime。

## 决策

### 1. Desktop 拥有 Hosted Route 基础设施

Desktop Renderer 的 `HostedRouteService` 负责：

- 注册和释放 namespace Router Adapter。
- 校验 route segment、生成路径并执行实际导航。
- 保持 `/workspace/$pluginId/$viewId` 与 `/theme/$themeId/$pageId` 的现有深链。

TanStack Router、URL 模板、React Registry、加载兜底和 ErrorBoundary 不进入 Capability SDK 或 Runtime。
Desktop 自己的 UI 可以直接调用该服务；跨扩展边界的调用必须经过 Capability Provider。

### 2. Capability 层只定义并保护可序列化命令

`@vetta/capability-sdk` 定义通用引用：

```ts
interface HostedRouteRef {
  readonly namespace: string;
  readonly ownerId: string;
  readonly pageId: string;
}
```

`cap.domain.vetta.navigation.open-hosted-route` 是唯一导航命令。它不枚举 Plugin/Theme，不包含 URL、Router、
组件或回调。Desktop Provider 只负责把已授权命令委托给 `HostedRouteService`；Registry、精确 Grant、撤销、
取消和审计由 Capability Runtime 执行。

### 3. Plugin 与 Theme 在各自上层完成系统集成

- Plugin Renderer Adapter 仅在插件启用、声明并获批 `ui.slot.workspace-view` 时授予精确 Token；facade 固定
  `namespace = plugin-workspace` 与 `ownerId = plugin.id`，只接受 `viewId`。
- Theme Renderer Adapter 为当前激活主题创建精确 Grant；facade 固定 `namespace = theme-page` 与当前
  `themeId`，只接受 `pageId`。
- Plugin 卸载、重载或激活失败，以及 Theme 切换、卸载时，宿主撤销相应 Session。
- 原始 Authorized Client 不暴露给插件或主题，调用方不能指定其他 owner 或 namespace。

系统权限名称、激活状态和身份真实性属于 Adapter 与宿主生命周期，不下沉到通用 Runtime。
这些 Adapter 也不进入 `capability-sdk`：当前实现分别位于 Desktop Renderer 的 Plugin runtime 与 Theme
runtime。SDK 只定义 Token、Schema、Grant 和 Session 合同，不导出任何 Plugin/Theme 内部入口。

### 4. 页面贡献仍由来源系统拥有

`PluginWorkspaceViewContribution.component`、`ThemePageDefinition.component`、动态注册、主题布局、导航展示、
i18n 和页面错误恢复保持原有所有权。Capability 只统一“请求打开哪个 Hosted Route”，不合并两套页面
Registry 或生命周期。

### 5. Runtime 支持 Main 与 Renderer

Capability Runtime 的共享执行路径使用 `globalThis.crypto`、`AbortSignal.any()` 和
`AbortSignal.timeout()` 等标准 API，不直接依赖 `node:crypto`、`node:events`、DOM 或 Router。Main、Renderer
和 CLI 可以各自注册 Provider，而复用相同授权与取消语义。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 只抽取 path helper | 减少字符串重复，但不能统一 namespace 生命周期，也保留扩展绕过授权的调用路径 |
| Capability 公共合同枚举 Plugin/Theme kind | 每新增来源都要修改通用协议，Capability 层承担了系统分类责任 |
| Theme 使用 Host 特权调用入口 | 绕过 Grant、Session 和撤销，使 Theme 与 Plugin 的安全语义不一致 |
| 把 React component 放进 Capability | 组件不可 Schema 化或跨 transport，破坏可序列化合同 |
| 合并 Theme/Plugin 页面 Registry | 两者的权限、加载、布局和错误语义不同，会产生大量系统分支 |
| 改成统一 `/extension/...` URL | 会破坏现有深链和持久化导航 key，且对分层没有帮助 |

## 后果

**正面**

- Desktop 路由基础设施、Capability 授权暴露和来源系统生命周期各有唯一事实源。
- Plugin 与 Theme 走同一 Token、Registry、精确 Grant 和撤销语义，不能伪造 owner。
- 新增 Hosted Route 来源只需在该来源的上层集成中增加 Grant/facade，并向 Desktop 注册 namespace Adapter，
  不修改公共 Token 或 Capability Runtime。
- 既有 URL、组件 Registry 和公开 facade 行为保持兼容。

**代价与风险**

- Renderer 拥有独立 Hub 与 AccessSession；主进程 session id 只用于关联 Plugin 身份，两个 realm 各自撤销。
- namespace 字符串成为跨层稳定约定，必须由上层系统集成定义并由 Desktop 显式注册。
- Runtime 的浏览器兼容性需要由构建和合同测试持续验证。
