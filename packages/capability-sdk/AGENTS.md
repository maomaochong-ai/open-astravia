# Team: Capability

本文件适用于 `packages/capability-sdk/` 及其全部子目录。

## 必读文档

修改 Capability Token、Schema、Catalog、Access 合同或内置系统 Adapter 前，必须先阅读：

- [`docs/contracts-and-adapters.md`](docs/contracts-and-adapters.md)
- [`../../docs/capabilities/README.md`](../../docs/capabilities/README.md)

## 职责范围

本包定义宿主无关的 Capability 端口：稳定 Token、输入输出 Schema、Catalog、错误、Grant/Session
合同，以及仅供宿主使用的 Plugin/Theme 系统 Adapter。具体 Provider、Electron/DOM/Router 实现和组合根属于宿主。

## 边界规则

- 不得因为本包不引用 `desktop-app`，就判定 Desktop 行为不能成为 Capability。正确结构是本包定义端口，
  `desktop-app` 导入 Token 并注册 Provider 实现。
- Capability 必须表达稳定的 query/command，输入输出必须可由现有 Schema 机制描述并在运行时校验。
  React 组件、回调、DOM 节点、Router 实例和其他进程内对象不得进入 Capability 输入输出。
- Foundation 只承载与 Vetta 产品领域无关的平台原语；项目、会话等稳定应用服务属于 Domain。
  导航等 Renderer 行为只有形成跨系统稳定合同并完成独立评审后才可提升为 Domain Capability；
  Plugin/Theme/Action 的 contribution、manifest、生命周期和系统权限语义不属于通用 Capability 合同。
- `src/adapters/**` 只负责系统身份、权限到精确 Grant 的映射、Session 生命周期、参数收窄和 facade
  调用包装；不得实现 Desktop Provider，也不得导入具体宿主服务。
- 包根只导出稳定公共合同。内置系统 Adapter 只能通过已声明的 `internal/*` 子路径供宿主装配，
  不得从包根重新导出，也不得由 `plugin-sdk`、`theme-sdk` 透传。
- Capability ID、layer、publisher、错误码和约束必须使用本包常量或 Token，不得在消费方重复手写字符串。
- 新增或修改 Token 时，同步更新所属聚合导出、Catalog 生成事实源、相关 Adapter Grant 和合同测试；
  不得手工编辑生成的 Catalog 文档或 JSON。

## 归属判断

- “宿主能否执行某个稳定操作？”通常可以定义为 Capability，由宿主 Provider 实现。
- “某系统如何声明、注册、挂载或销毁自己的扩展贡献？”属于该系统 SDK/Adapter 和宿主组合层。
- 同一功能可以拆分：例如“打开扩展页”的可序列化引用和命令经稳定合同评审后可进入 Domain Capability，
  React 页面注册、TanStack 路由挂载、主题切换和插件加载状态仍留在 Renderer。

## 测试要求

- Token 或 Schema 变化必须覆盖合法输入输出、未知字段、边界值、错误映射和 Catalog 一致性。
- Grant、Session 或 Adapter 变化必须覆盖授权、拒绝、撤销、重复激活和身份/namespace 隔离。
- 公共合同变化必须运行受影响 Provider 和系统 facade 的合同测试；仅通过本包类型检查不足以证明兼容。
