# Team: Capability

本文件适用于 `packages/capability-sdk/` 及其全部子目录。

## 必读文档

修改 Capability Token、Schema、Catalog 或 Access 合同前，必须先阅读：

- [`docs/contracts-and-host-integration.md`](docs/contracts-and-host-integration.md)
- [`../../docs/capabilities/README.md`](../../docs/capabilities/README.md)

## 职责范围

本包只定义宿主和上层系统无关的 Capability 端口：稳定 Token、输入输出 Schema、Catalog、错误及
Grant/Session 合同。具体 Provider、系统权限映射、Session 生命周期、Electron/DOM/Router 实现和组合根
属于消费方。

## 边界规则

- 不得因为本包不引用 `desktop-app`，就判定 Desktop 行为不能成为 Capability。正确结构是本包定义端口，
  `desktop-app` 导入 Token 并注册 Provider 实现。
- Capability 必须表达稳定的 query/command，输入输出必须可由现有 Schema 机制描述并在运行时校验。
  React 组件、回调、DOM 节点、Router 实例和其他进程内对象不得进入 Capability 输入输出。
- Foundation 只承载与 Vetta 产品领域无关的平台原语；项目、会话等稳定应用服务属于 Domain。
  导航等 Renderer 行为只有形成跨系统稳定合同并完成独立评审后才可提升为 Domain Capability；
  Plugin/Theme/Action 的 contribution、manifest、生命周期和系统权限语义不属于通用 Capability 合同。
- 本包不得新增 Plugin、Theme、Action 或某个宿主专用 Adapter，也不得出现其 manifest、permission、
  trust level、激活状态或生命周期分支。上层系统在自己的集成目录中依赖本包并创建精确 Grant。
- 包根和公开子路径只导出稳定合同，不提供 `internal/*-adapter` 例外入口。
- Capability ID、layer、publisher、错误码和约束必须使用本包常量或 Token，不得在消费方重复手写字符串。
- 新增或修改 Token 时，同步更新所属聚合导出、Catalog 生成事实源和合同测试；不得手工编辑生成的
  Catalog 文档或 JSON。受影响的上层 Grant/Provider 测试由其所有者同步更新。

## 归属判断

- “宿主能否执行某个稳定操作？”通常可以定义为 Capability，由宿主 Provider 实现。
- “某系统如何声明、注册、挂载或销毁自己的扩展贡献？”属于该系统 SDK/Adapter 和宿主组合层。
- 同一功能可以拆分：例如“打开扩展页”的可序列化引用和命令经稳定合同评审后可进入 Domain Capability，
  React 页面注册、TanStack 路由挂载、主题切换和插件加载状态仍留在 Renderer。

## 测试要求

- Token 或 Schema 变化必须覆盖合法输入输出、未知字段、边界值、错误映射和 Catalog 一致性。
- Grant 或 Session 合同变化必须覆盖授权、拒绝、撤销和 namespace 隔离；具体系统 Adapter 测试留在其上层。
- 公共合同变化必须运行受影响 Provider 和系统 facade 的合同测试；仅通过本包类型检查不足以证明兼容。
