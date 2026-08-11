# Capability SDK：契约端口与系统 Adapter

## 目的

`@vetta/capability-sdk` 不是 Desktop 实现包，也不只是供第三方直接调用的传统 SDK。它同时承担：

- 定义宿主无关的 Capability 端口。
- 发布稳定 Token、输入输出 Schema、Catalog、错误码和 Access 合同。
- 提供仅供宿主装配的 Plugin/Theme 系统 Adapter。

相关执行机制见 [`@vetta/capability-runtime` 的 Registry 与 Access 文档](../../capability-runtime/docs/registry-and-access.md)。

最重要的不变量是：**能力合同是具体实现所依赖的抽象；合同不依赖宿主实现，宿主实现反向依赖合同。**

因此，本包不引用 `desktop-app` 并不意味着它不能描述 Desktop 提供的能力。恰恰相反，正确的依赖
倒置要求 Desktop 导入这里的 Token，并在自己的组合根注册 Provider。

## 两种方向不要混淆

编译期依赖方向：

```text
capability-runtime ──> capability-sdk
desktop-app        ──> capability-sdk
desktop-app        ──> capability-runtime
```

一次受授权调用的运行时流向：

```text
Plugin / Theme system facade
              |
              v
host bridge / internal system adapter
              |
              v
CapabilityAccessSession + exact Grant
              |
              v
Capability Runtime Registry / Hub
              |
              v
Desktop Provider
              |
              v
Desktop domain service / Electron / OS
```

调用在运行时最终进入 Desktop，不要求 SDK 在编译期反向导入 Desktop。

## 一条真实链路

项目查询展示了完整结构：

1. `src/domain/project.ts` 定义 `cap.domain.vetta.project.list`、输入输出 Schema 和 Token。
2. `desktop-app/src/main/capabilities/domain-providers.ts` 导入 Token，将 `ProjectService.list()` 绑定为 Provider。
3. `src/adapters/plugin/domain/project.ts` 通过已授权 Client 调用 Token，不知道 Provider 的实现类型。
4. `desktop-app/src/main/capabilities/capability-host.ts` 创建 Hub、Provider、Access Controller 和系统 Adapter，
   并统一负责释放。

这里的 SDK 是端口，Desktop Provider 是适配器，Desktop Capability Host 是组合根。

## 本包拥有什么

### 公共 Capability 合同

- 稳定 Capability ID、layer、publisher 和 version。
- query/command 类型。
- 输入和输出 Schema。
- 稳定错误码与错误类型。
- Catalog 描述和生成事实源。
- Grant、Constraint、AccessSession 与 Authorized Client 合同。

### 内置系统 Adapter

`internal/plugin-adapter` 和 `internal/theme-adapter` 是宿主内部装配 API，不是开发者公共 API。它们负责：

- 将 Plugin/Theme 身份绑定为 Access Subject。
- 将系统权限显式展开为精确 Capability Grant。
- 为 namespace、host、path 等通用约束提供确定值。
- 管理系统激活、重载和卸载对应的 Capability Session。
- 将系统友好的 facade 调用翻译为 Token 调用。

Adapter 不拥有底层 Provider，也不实现 Desktop 领域服务。

## 本包不拥有什么

- Electron、DOM、Jotai 或 TanStack Router 实现，以及具体宿主领域服务。
- Desktop 服务、数据库、配置文件或窗口实例。
- React 组件、Context、Hook 或组件 Registry。
- Plugin/Theme/Action 的 manifest、contribution 和渲染生命周期。
- 某个宿主的组合根和 Provider 装配。

这些对象是否位于本包，不由“功能最终是不是 Desktop 提供”决定，而由它是**稳定能力端口**还是
**具体宿主实现/系统贡献模型**决定。

## Capability 归属判断

一个行为适合定义为 Capability，通常同时满足：

1. 它是稳定的 query、command 或可明确建模的长任务。
2. 输入输出能由本包 Schema 机制描述并进行运行时校验。
3. 调用者身份、Grant、约束、撤销或审计对该行为有意义。
4. Provider 可以由不同宿主或不同实现替换，而调用合同保持稳定。
5. 它表达平台原语或应用领域服务，而不是某扩展系统自己的贡献生命周期。

以下内容通常不应直接成为 Capability 输入输出：

- React `ComponentType`、ReactNode、Hook 或 Context。
- 函数回调、闭包、DOM 节点、Router 实例。
- 只能在当前 JavaScript realm 中存活的对象引用。
- 将 Plugin/Theme 权限名称直接提升成通用授权规则的结构。

## Foundation、Domain 与系统业务

### Foundation Capability

与 Vetta 产品领域无关的平台原语，例如文件、网络、命名空间存储和 Artifact。实现只处理技术约束，
不判断调用者是 Plugin、Theme 还是 Action。

### Domain Capability

稳定的 Vetta 应用服务，例如项目、会话、调度器和知识库。Provider 可以组合 Foundation Capability
或宿主领域服务，但调用方不需要复制业务流程。导航等 Renderer 行为只有形成跨系统稳定合同并完成独立
评审后才属于 Domain Capability；系统专用导航 facade 仍属于对应系统业务。

### 系统业务

Plugin/Theme/Action 自己的 manifest、contribution、安装、激活、UI 挂载和权限名称属于系统业务。
系统 Adapter 可以使用 Capability，但通用 Token 和 Runtime 不应根据具体系统类型分支。

## 扩展页案例

Theme Page 与 Plugin Workspace View 同时包含“宿主管理地址、扩展方提供页面”的结构，但应拆成两个边界。

若需要形成跨系统稳定命令，经合同与授权边界评审后可以进入 Domain Capability 的部分：

```ts
interface HostedPageRef {
  readonly kind: "plugin" | "theme";
  readonly ownerId: string;
  readonly pageId: string;
}

// 示例方向，不代表当前已经存在的 Token。
openHostedPage(input: { readonly page: HostedPageRef }): Promise<void>;
```

这里的引用可校验、可授权、可审计，Desktop Renderer Provider 可以把它映射为自己的 TanStack Route。
其他宿主也可以选择不同的打开方式，而不改变调用合同。

仍应留在系统 SDK 和 Desktop Renderer 的部分：

- `PluginWorkspaceViewContribution.component` 和 `ThemePageDefinition.component`。
- Plugin Host ready、动态注册和卸载。
- Theme 激活、主题切换和 `content/main/app` 布局。
- Plugin i18n、导航 badge、pin/排序和局部 ErrorBoundary。
- `/workspace/...`、`/theme/...` 的具体 URL 以及 TanStack Router 装配。

不能为了把整个功能称为“Capability”，把 React 组件或 Router 对象塞进 Schema。若未来页面贡献改为
可序列化 `moduleRef`，并由隔离宿主加载，才应重新评审“注册扩展页”是否也能成为 Capability。

## 修改清单

新增或修改 Capability 时：

1. 选择 Foundation 或 Domain，定义稳定 Token 和 TypeBox 事实源。
2. 更新对应聚合导出和 Catalog 生成输入。
3. 新 Capability 默认无 Grant。
4. 在需要它的系统 Adapter 中显式映射权限和约束。
5. 在宿主组合根注册 Provider；不要把 Provider 放进本包。
6. 覆盖 Schema、Catalog、Provider、Grant 和受影响 facade 的最低充分测试。
7. 修改公共合同或长期边界时同步更新根架构文档或 ADR。
