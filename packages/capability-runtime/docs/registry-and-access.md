# Capability Runtime：Registry、Access 与宿主实现边界

## 目的

`@vetta/capability-runtime` 是 Capability 合同的通用执行内核。它把“某个 Token 有什么 Provider”与
“某个 Subject 是否持有精确 Grant”组合成一次受控调用，但不定义具体能力，也不知道调用者属于哪个扩展系统。

Token、Schema 和内置系统 Adapter 的边界见
[`@vetta/capability-sdk` 的契约与 Adapter 文档](../../capability-sdk/docs/contracts-and-adapters.md)。

一句话边界：

> SDK 定义端口，Runtime 执行通用机制，Host 提供实现并完成装配。

## 与 SDK、Host 的关系

```text
@vetta/capability-sdk
  Token / Schema / Error / Grant contract
               |
               v
@vetta/capability-runtime
  Registry / Hub / Access / Constraint / Audit
               ^
               |
Host composition root
  Provider implementation / system adapter / lifecycle wiring
```

编译期依赖是 `capability-runtime -> capability-sdk`。具体宿主同时依赖两者：它导入 SDK Token，使用
Runtime 注册 Provider，并把自己的领域服务绑定到 Token。Runtime 不需要也不得反向导入宿主。

## Runtime 拥有的机制

### Registry

- 按 Foundation/Domain layer 保存 Provider binding。
- 校验完整 Capability ID、Token layer、owner 和 Module 元数据。
- 支持内置 owner 注册及外部 Module 的 stage、validate、commit/abort。
- 替换失败时保留旧 Provider。
- 卸载或成功替换时取消旧 Provider 的在途调用并释放注册。

### Hub

- 按 Token 显式 layer 路由到 Foundation 或 Domain Registry。
- 不通过字符串前缀猜测授权，也不把两个 Registry 合并成无边界 Map。

### Access

- 将不透明 `AccessSubject`、AccessSession 和精确 Grant 绑定。
- 在调用前检查 Session、撤销、过期、Capability ID 和 Constraint。
- 记录 allow/deny 审计，并把已授权调用转发给 Hub。
- Session 失效时中止其在途调用。

### Constraint

- 执行 namespace 等与系统无关的通用约束。
- 未注册 evaluator 或不满足约束时 fail closed。
- 不知道 namespace 来自 Theme storage、Plugin storage 还是其他系统。

## Runtime 不拥有的内容

- Capability Token、输入输出业务 Schema 和 Catalog，它们属于 `capability-sdk`。
- Desktop Provider、Electron/OS 调用、DOM、Router、数据库和具体领域服务。
- Plugin/Theme/Action 的身份真实性、manifest、权限名称和 contribution 生命周期。
- 公开系统 facade，例如插件 `ctx.*` 或主题 Hook。
- 宿主组合根和进程间 transport。

## 为什么 Runtime 可以驱动 Desktop 能力

Runtime 不实现项目、会话、存储或导航，但宿主可以把这些实现绑定进 Registry。例如：

```ts
registry.registerOwner("vetta.domain.project", [
  bindCapability(DOMAIN_PROJECT_CAPABILITIES.LIST, {
    execute: () => projectService.list(),
  }),
]);
```

Runtime 只看到 Token 和 `CapabilityHandler`。`projectService` 来自 Desktop 还是其他 Host，不影响 Registry、
Access 或审计语义。这是依赖倒置，不是 Runtime 对 Desktop 的转发或兼容包装。

## Main 与 Renderer

Runtime 是宿主无关机制，可以在不同执行环境中创建实例：

- Main Registry 可以绑定文件系统、进程、配置和 Desktop 领域服务。
- Renderer Registry 可以绑定导航、外观或其他只能在 UI realm 完成的行为。
- CLI Host 可以为相同 Token 提供 CLI 实现，或明确不注册不支持的 Token。

部署位置不会改变包边界。Renderer Provider 可以调用 TanStack Router，但 Runtime 源码不能导入 Router；
Main Provider 可以调用 Electron，但 Runtime 源码不能导入 Electron。

同理，当前某段代码即使叫 `RendererCapabilityHost`，如果它只是直接执行授权闭包、没有 Token、Schema、
Registry 和精确 Grant，也不等于它已经进入正式 Capability Runtime。迁移时应先定义稳定合同，再由 Renderer
组合根注册 Provider，而不是把 DOM/Router 实现移动到本包。

## 系统 Adapter 与 Runtime 的分工

系统 Adapter 回答：

- 这个 Plugin/Theme 身份是否有效？
- 它的系统权限应该展开成哪些精确 Grant？
- ownerId、namespace、host 或 path 约束值是什么？
- 激活、重载、卸载时何时创建和撤销 Session？

Runtime 回答：

- Session 当前是否有效？
- 是否存在目标完整 Capability ID 的 Grant？
- 通用 Constraint 是否满足？
- Provider 是否已注册？
- 调用、取消和审计如何执行？

不要把第一组问题下沉到 Runtime。否则每新增一种系统都要修改通用权限层，并使同一 Token 的授权行为依赖
调用者类型。

## 扩展页与导航示例

若 `capability-sdk` 定义一个可序列化的 `open-hosted-page` Domain Token，Renderer Host 可以注册 Provider：

```text
HostedPageRef
      |
      v
Access Controller -- exact Grant / owner constraint
      |
      v
Renderer Registry
      |
      v
Desktop navigation Provider -- maps ref to TanStack Router
```

Runtime 可以执行该命令，但不拥有：

- `/theme/...` 或 `/workspace/...` URL 格式。
- React 页面组件和页面 Registry。
- Theme 切换、Plugin Host ready、i18n 或 ErrorBoundary。
- 导航项 pin、排序和持久化。

这些仍由系统 Adapter 与 Desktop Renderer 负责。

## 修改清单

修改 Runtime 时确认：

1. 变化是否对所有系统和宿主都成立，而不是只服务某个 Plugin/Theme 分支。
2. 是否仍按完整 Token ID 和显式 layer 路由。
3. 新注册是否默认无 Grant，并保持 fail closed。
4. Provider 替换、卸载、Session 撤销和取消是否有明确 owner。
5. 是否覆盖成功、拒绝、失败保持、并发和释放路径。
6. 若需要新的业务字段或错误语义，先在 `capability-sdk` 定义合同，不在 Runtime 私自发明平行协议。
