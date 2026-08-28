# ADR-0091：可信 Renderer 插件与治理型权限

## 状态

Accepted（2026-08-28）

取代 [ADR-0061](./0061-quickjs-worker-runtime-with-host-rendered-ui.md)，并修订
[ADR-0060](./0060-plugin-network-host-declarations-and-official-command-execution.md) 与
[ADR-0088](./0088-browser-automation-as-a-foundation-capability.md) 中按 official 来源限制公开能力的结论。

## 背景

插件系统同时维护宿主 renderer 内的 ESM / Module Federation 路径和 Worker + WASM + RPC + 声明式 UI
路径，造成两套激活、能力转发、UI 和资源生命周期模型。受限路径不能复用 React 生态与完整 SDK，维护成本与插件能力
差异持续扩大，而当前产品没有需要该路径兼容的插件。

现有插件本来就与宿主共享 renderer realm。权限校验能约束插件通过公开宿主 API 发起的调用，却不能阻止同 realm 代码
访问 DOM、浏览器原生 API 或利用运行时漏洞。因此把权限描述为绝对安全边界会给用户和开发者错误预期。

## 决策

1. 插件运行时只保留 `esm` 与 `module-federation`；Module Federation 是需要 React 与宿主共享模块时的推荐路径。
2. 删除 Worker/WASM 运行时、RPC 协议、声明式 UI、SDK 类型、构建分支和直接依赖，不提供旧插件识别或迁移兼容层。
3. 插件按用户明确选择的可信代码处理。安装与权限界面必须说明：插件代码直接在 renderer 中运行，权限不是安全沙箱。
4. `permissions`、`commands`、`network.allowedHosts` 和 `browser.allowedHosts` 继续作为能力声明、用户知情同意、宿主 API
   门控、审核与诊断规范。未声明或未授权的公开宿主 API 调用仍应被拒绝。
5. local/community 插件可在明确声明和授权后使用公开能力，包括命令执行、命令驻留、网络 `*`、浏览器 attach 与浏览器
   runtime manage；不再用 `trustLevel` 静默删除这些声明。
6. official 身份仍只开放宿主私有合同，例如 `ctx.official`、`ctx.gateway`、内部领域 capability 与受限 Action 合同。
   这些能力不是普通插件可声明的权限，不因本次调整开放。

## 后果

- 插件运行、UI 与能力接入只有一套主模型，减少包体、启动资源和跨运行时协议维护。
- 插件可以使用完整 JavaScript、React 与经授权的公开宿主能力，扩展限制显著减少。
- 用户必须自行信任插件来源；权限列表表达插件意图和宿主 API 范围，不构成恶意代码隔离保证。
- host 白名单、权限复核、重定向复核、资源 namespace、取消和生命周期清理仍有治理与误操作防护价值，不应删除。
- 若未来需要运行不可信第三方代码，应重新设计进程级隔离、独立 UI surface 与可审计 IPC，而不是把现有权限门控包装成沙箱。
