# Team: Capability

本文件适用于 `packages/capability-runtime/` 及其全部子目录。

## 必读文档

修改 Registry、Hub、Provider binding、Access Controller、Constraint 或审计行为前，必须先阅读：

- [`docs/registry-and-access.md`](docs/registry-and-access.md)
- [`../../docs/capabilities/README.md`](../../docs/capabilities/README.md)

## 职责范围

本包执行 `@vetta/capability-sdk` 定义的合同，拥有 Foundation/Domain Registry、Hub、Provider
注册与替换、AccessSession、精确 Grant、通用 Constraint、取消和审计机制。它不定义产品能力，也不实现
Desktop、Plugin、Theme 或 Action 业务。

## 边界规则

- 本包只能依赖 `@vetta/capability-sdk` 的通用合同，不得导入或根据 `desktop-app`、`plugin-sdk`、
  `theme-sdk`、Action、trust level、manifest 或系统权限名称分支。
- Runtime 可以由 main、renderer、CLI 或测试宿主实例化；部署在 renderer 不等于可以依赖 DOM、React、
  Jotai 或 Router。具体 UI/宿主行为必须由上层 Provider 实现。
- Capability Token 和业务 Schema 属于 `capability-sdk`；Provider 实现和组合根属于宿主；本包只拥有
  注册、路由、授权、约束求值、生命周期和调用执行机制。
- Registry 路由依据 Token 的显式 layer 和完整 ID；前缀只用于校验、检索和诊断，不得用于隐式授权。
- 新 Capability、Module 或 Provider 默认没有 Grant；不得按 publisher、domain、前缀或调用者类型自动扩权。
- Provider 注册、替换和卸载必须保持 owner 明确、原子提交、失败保留旧实现、在途调用取消和确定性释放。
- Constraint Evaluator 只能解释通用约束；Plugin/Theme 权限到 Constraint/Grant 的映射必须留在系统 Adapter。
- Runtime 错误必须转换为 `capability-sdk` 定义的稳定错误语义，不暴露偶然的 Provider 内部异常合同。

## 测试要求

- Registry/Module 变化必须覆盖重复 ID、publisher/layer 不匹配、stage/commit/abort、替换失败、卸载和取消。
- Access/Grant 变化必须覆盖 allow/deny、过期、撤销、未知 Capability、精确 ID 匹配和审计事件。
- Constraint 变化必须覆盖缺失 evaluator、合法/非法值、多个约束组合和 fail-closed 行为。
- 生命周期和并发测试使用显式同步点与 `AbortSignal`，不得依赖任意 sleep。
- 修改公开 Runtime API 时同步运行 `capability-sdk` Adapter 和至少一个真实宿主 Provider 的合同测试。
