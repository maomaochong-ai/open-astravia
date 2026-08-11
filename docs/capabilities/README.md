# 可扩展能力与系统适配分层架构

## 1. 背景

Desktop 当前为 Plugin、Theme、Action 等系统分别提供宿主能力。随着系统增多，每个系统都需要重复维护能力出口、权限检查、调用包装、生命周期和错误转换，新增能力时也容易出现多套实现与语义漂移。

目标架构统一的是能力契约、能力实现和通用访问控制，不统一 Plugin、Theme、Action 自身的业务模型。三者继续作为独立系统演进，并通过各自适配层使用同一套能力基础设施。

本文中的“领域能力”是项目、调度器、知识库等应用领域服务；“系统业务”是 Plugin、Theme、Action 等扩展系统自身的权限、生命周期、贡献协议和调用包装。两者不是同一个概念。

## 2. 设计目标

- 能力层同时支持与业务无关的基础能力和应用领域能力。
- 基础能力与领域能力使用同一套公开契约，但由两套 Registry 管理。
- 能力可以由新模块扩展，并能按稳定前缀检索、路由和区分来源。
- 能力契约中的 ID、错误码、前缀等字符串必须由常量或强类型 Token 暴露，供宿主与能力扩展实现引用。
- 通用权限层直接基于 Capability ID 授权，不再创建 Permission ID，也不维护能力分组。
- 通用权限层不知道 Plugin、Theme、Action 等具体系统。
- Plugin、Theme、Action 在内置适配层中维护自己的权限、业务逻辑和能力映射，再由各自公开 SDK 提供面向开发者的 facade。
- 新增一种系统时，只需新增适配层，不修改能力层和通用权限层的业务模型。

## 3. 非目标

- 不把 Plugin、Theme、Action 合并成同一个系统。
- 不用一个万能 RPC 接口代替 React hook、插件 `ctx`、Action Catalog 等系统专用 API。
- 不把项目、调度器、知识库等领域服务降级为文件或 KV 操作后交给调用方自行组合。
- 不根据能力 ID 前缀自动推导授权范围。
- 不把系统适配层中的权限名称提升为通用权限模型。

## 4. 总体分层

```text
Plugin / Theme / Action 开发者
                 │
                 ▼
公开系统 SDK（plugin-sdk / theme-sdk / action API）
                 │
                 ▼
宿主桥接（renderer / preload / IPC / RPC）
                 │
                 ▼
上层系统集成（由 Plugin / Theme / Action 所有）
  - 系统权限
  - 生命周期
  - contribution
  - Capability facade 实现
  - 细粒度校验
  - 审批与业务逻辑
                 │
                 ▼
通用能力权限层
  - Subject
  - Capability Grant
  - session / expiry / revoke
  - 通用约束
  - audit
                 │
                 ▼
Capability Hub
  ├─ Foundation Capability Registry
  └─ Domain Capability Registry
                 │
                 ▼
Electron / Node.js / OS / Desktop Domain Services
```

依赖方向必须保持单向：

```text
公开系统 SDK <- 宿主桥接 -> 上层系统集成 -> 通用能力权限层 -> 能力合同
领域能力 -> 基础能力
```

禁止以下反向依赖：

- 基础能力依赖领域能力。
- 能力层依赖 Plugin、Theme、Action SDK。
- Capability SDK 导入或导出 Plugin、Theme、Action 的 Adapter。
- 通用权限层导入 Plugin、Theme、Action 类型。
- 通用权限层根据 `pluginId`、`themeId`、Action effect 或 trust level 分支。

## 5. 能力层

### 5.1 统一能力契约

基础能力和领域能力共享同一个定义协议：

```ts
export type CapabilityLayer = "foundation" | "domain";

export interface CapabilityToken<Input, Output> {
	readonly id: CapabilityId;
	readonly layer: CapabilityLayer;
	readonly version: number;
}

export interface CapabilityExecutionContext {
	readonly signal: AbortSignal;
	readonly traceId: string;
	readonly deadline?: number;
}

export interface CapabilityHandler<Input, Output> {
	execute(input: Input, context: CapabilityExecutionContext): Promise<Output>;
}
```

能力契约负责描述：

- 稳定 ID。
- 所属层级。
- 契约版本。
- 输入和输出类型。
- 输入与输出 Schema。
- 是否支持取消、订阅或流式结果。
- 稳定错误码。

能力契约不声明 Permission ID。Capability ID 本身就是通用权限层的最小授权单位。

### 5.2 基础能力

基础能力提供与 Vetta 具体领域无关的平台原语，例如：

- 文件读写和元数据。
- 命名空间 KV 存储。
- 网络请求。
- 进程执行。
- 系统通知。
- 剪贴板。
- 窗口控制。
- 系统对话框。
- 打开外部链接。
- 通用事件订阅。

示例：

```text
cap.foundation.vetta.fs.read-file
cap.foundation.vetta.fs.write-file
cap.foundation.vetta.storage.get
cap.foundation.vetta.storage.set
cap.foundation.vetta.window.minimize
cap.foundation.vetta.notification.show
```

基础能力实现只处理技术约束，例如输入合法性、路径规范化、序列化、资源上限、取消以及底层 API 错误转换。它不判断调用者属于哪个系统。

### 5.3 领域能力

领域能力提供稳定的应用领域服务，例如：

- 项目管理。
- 会话管理。
- 调度任务。
- 模型配置。
- 知识库。
- 下载任务。
- 应用更新。
- 外观设置。

示例：

```text
cap.domain.vetta.project.list
cap.domain.vetta.project.create
cap.domain.vetta.download.list
cap.domain.vetta.download.cancel
cap.domain.vetta.scheduler.task.create
cap.domain.vetta.scheduler.task.run
cap.domain.vetta.knowledge.entry.delete
cap.domain.vetta.appearance.get
cap.domain.vetta.appearance.set
```

领域能力可以在实现内部组合基础能力。例如 `project.create` 可以使用目录检查、目录创建和 KV 写入，但调用者不需要复制这段业务流程。

领域能力不能包含 Plugin、Theme、Action 的系统业务。`plugin.install`、`theme.register-region`、`action.approve` 应由相应系统适配层拥有，除非未来明确将某项能力定义为稳定的 Desktop 领域服务并完成独立评审。

### 5.4 Capability ID

Capability ID 使用以下格式：

```text
cap.<layer>.<publisher>.<domain>.<operation>
```

- `layer`：`foundation` 或 `domain`。
- `publisher`：能力发布者，例如 `vetta`、`acme`。
- `domain`：能力领域，可以包含多级资源段。
- `operation`：具体操作，使用小写 kebab-case。

示例：

```text
cap.foundation.vetta.fs.read-file
cap.domain.vetta.scheduler.task.run
cap.foundation.acme.serial.open
cap.domain.acme.crm.contact.create
```

保留前缀：

```ts
export const CAPABILITY_PREFIXES = {
	ROOT: "cap.",
	FOUNDATION: "cap.foundation.",
	DOMAIN: "cap.domain.",
	VETTA_FOUNDATION: "cap.foundation.vetta.",
	VETTA_DOMAIN: "cap.domain.vetta.",
} as const;
```

前缀只允许用于：

- Registry 路由。
- Catalog 检索。
- 日志筛选。
- 文档归类。
- 调试和诊断。

前缀禁止用于授权。新增能力不得自动继承同前缀下已有能力的授权。

### 5.5 常量和强类型 Token

宿主、Provider 和系统适配器代码不得直接传递 Capability ID 字符串，必须引用能力契约导出的 Token：

```ts
export const FOUNDATION_CAPABILITIES = {
	FS_READ_FILE: defineCapability<ReadFileInput, ReadFileOutput>({
		id: "cap.foundation.vetta.fs.read-file",
		layer: "foundation",
		version: 1,
	}),
	STORAGE_GET: defineCapability<StorageGetInput, StorageGetOutput>({
		id: "cap.foundation.vetta.storage.get",
		layer: "foundation",
		version: 1,
	}),
} as const;

export const DOMAIN_CAPABILITIES = {
	PROJECT_CREATE: defineCapability<ProjectCreateInput, Project>({
		id: "cap.domain.vetta.project.create",
		layer: "domain",
		version: 1,
	}),
} as const;
```

宿主内部的正确调用：

```ts
await client.invoke(FOUNDATION_CAPABILITIES.FS_READ_FILE, { path });
```

禁止调用：

```ts
await client.invoke("cap.foundation.vetta.fs.read-file", { path });
```

以下稳定字符串也必须由能力契约常量提供：

- Capability ID 和前缀。
- Capability layer。
- 稳定错误码。
- 调用状态和停止原因。
- Registry 事件类型。

JSON manifest 无法引用 TypeScript 常量时，由 SDK 定义生成 JSON Schema，在编辑期提供补全，在安装或构建期进行校验。常量和 Token 定义是唯一事实来源，文档、Schema 和 Catalog 均从其生成。

### 5.6 两套 Registry 和统一 Hub

基础能力与领域能力使用独立 Registry：

```ts
export interface CapabilityHub {
	readonly foundation: CapabilityRegistry;
	readonly domain: CapabilityRegistry;
}
```

独立 Registry 用于保证依赖边界和所有权清晰；统一 Hub 用于向权限层提供一致调用协议。路由优先使用 Token 的 `layer`，跨进程反序列化后再校验 ID 前缀与 layer 是否一致。

### 5.7 能力模块扩展

新增能力通过 Capability Module 注册：

```ts
export interface CapabilityModule {
	readonly id: string;
	readonly publisher: string;
	readonly version: string;
	readonly capabilities: readonly CapabilityToken<unknown, unknown>[];
}

const registration = registry.registerModule(module, bindings, {
	trust: CAPABILITY_MODULE_TRUST_LEVELS.BUILT_IN,
});
```

注册规则：

- `vetta` namespace 只允许宿主内置或经过宿主签名确认的模块注册。
- 外部模块必须使用自己的 publisher namespace。
- 不同 owner 注册相同 Capability ID 时直接拒绝，不使用静默覆盖。
- 同一模块升级使用 `stage -> validate -> commit/abort` 原子替换。
- 新激活失败时继续保留旧 Provider。
- 模块卸载或替换时取消进行中的调用并注销 Provider。
- Capability ID 保持稳定，breaking change 通过契约版本处理。
- 新注册能力默认没有任何 Grant。

`registerModule()` 会在修改 Registry 前一次性校验模块元数据、publisher、layer、声明的 Token
与 Provider binding。`vetta` publisher 只接受宿主明确标记为 `built-in` 的模块。宿主自身按资源聚合的
Provider 可以使用低层 `registerOwner()`；外部 Capability Module 必须使用 `registerModule()`。

普通 Plugin、Theme 不因使用扩展系统而自动获得注册底层 Provider 的资格。是否允许某个系统贡献 Capability Module，由对应系统适配层单独决定。

## 6. 通用能力权限层

### 6.1 能力即授权单位

通用权限层不创建 Permission ID，不维护权限组，也不根据 read、write、domain 或前缀猜测权限关系。

一条 Grant 只授权一个明确的 Capability ID：

```ts
export interface CapabilityGrant {
	readonly capabilityId: CapabilityId;
	readonly constraints?: readonly CapabilityConstraint[];
	readonly expiresAt?: number;
}
```

例如需要读取文件和读取元数据时，保存两条独立 Grant：

```ts
const grants: readonly CapabilityGrant[] = [
	{ capabilityId: FOUNDATION_CAPABILITIES.FS_READ_FILE.id },
	{ capabilityId: FOUNDATION_CAPABILITIES.FS_STAT.id },
];
```

不存在以下中间标识：

```text
perm.foundation.vetta.fs.read
filesystem.read 权限组
cap.foundation.vetta.fs.* 通配授权
```

这样新增、拆分或调整能力时不会因为分组推断而扩大已有授权。

### 6.2 通用 Subject

权限层只接收不透明访问主体：

```ts
export interface AccessSubject {
	readonly id: string;
	readonly sessionId: string;
}

export interface CapabilityAccessSession {
	readonly subject: AccessSubject;
	readonly grants: readonly CapabilityGrant[];
	readonly expiresAt?: number;
}
```

权限层不知道 `subject.id` 背后是 Plugin、Theme、Action 还是未来系统，也不根据 subject 类型实现业务分支。Subject 的生成、身份真实性和系统语义由上层适配器及宿主组合入口负责。

### 6.3 权限层职责

通用权限层只负责：

- AccessSession 是否有效。
- 目标 Capability ID 是否存在精确 Grant。
- Grant 是否过期或撤销。
- 调用是否满足 Grant 上的通用约束。
- 调用取消和 session 失效传播。
- allow/deny 审计。
- 将授权后的调用转发给 Capability Hub。

通用权限层不负责：

- manifest 是否声明了某项系统权限。
- 用户是否给某个 Plugin 授权。
- Theme 是否允许读取某个 model。
- Action 是否需要审批。
- official、community、local 等信任语义。
- contribution 是否允许注册。
- Action effect、approval 和 `assertReady`。

### 6.4 Authorized Client

系统适配层只能获得绑定 AccessSession 的 Client，不能直接访问 Registry：

```ts
export interface AuthorizedCapabilityClient {
	invoke<Input, Output>(
		capability: CapabilityToken<Input, Output>,
		input: Input,
		options?: CapabilityInvokeOptions,
	): Promise<Output>;
}
```

调用链：

```text
校验 AccessSession
-> 使用完整 Capability ID 精确查找 Grant
-> 校验通用 constraints
-> 写入审计记录
-> Capability Hub 路由
-> Registry 调用 Provider
```

Grant 对 Capability ID 使用完整相等匹配，不允许前缀、glob 或隐式继承。

### 6.5 通用约束

Grant 可以附带不包含系统业务的通用约束，例如：

- 允许访问的资源根目录。
- 固定存储 namespace。
- 调用次数或并发上限。
- 最大输入或输出大小。
- 有效时间范围。

约束类型由公开常量标识，并由通用 Constraint Evaluator 执行。权限层不能出现 `plugin-root`、`theme-storage` 等系统专用约束名称；系统适配层应将这些业务概念转换成通用的 `resource-root`、`namespace` 等约束。

## 7. 系统适配层

### 7.1 上层系统集成

各系统集成不共用业务接口，但都依赖 Capability SDK 的通用 Access 合同：

```ts
export interface SystemAdapterContext {
	readonly subject: AccessSubject;
	readonly capabilities: AuthorizedCapabilityClient;
	readonly lifetime: ActivationLifetime;
}
```

`SystemAdapterContext` 不包含 Plugin、Theme、Action 字段。具体权限映射、Subject 生成和 facade 包装放在其
所有者目录；当前 Desktop 集成位于 `packages/desktop-app/src/main/capabilities/integrations/` 及对应 Renderer
Plugin/Theme runtime，`capability-sdk` 不提供系统 Adapter 或内部导出。

适配层是完整的一层，不是散落在 Desktop IPC 目录中的辅助函数。一个系统的权限展开、Subject 生成、namespace 绑定和 Capability 调用包装应聚合在同一个系统模块中；只有当单个系统适配器本身复杂到包含多个独立职责时才继续拆分，避免按每个能力创建一个文件。

系统集成的实例和生命周期由 Capability Host 统一管理。每种集成在宿主进程中只创建一次，IPC、RPC 等协议入口只借用 Host 持有的实例，不自行构造或销毁。这样高频调用可以复用内部 AccessSession 和缓存，Host 关闭时再统一撤销 Session 并释放 Provider。

### 7.2 系统权限到 Capability Grant 的转换

系统适配层可以拥有自己的权限名称和权限组合，但这些信息不进入通用权限层。

例如 Plugin Adapter 可以定义：

```ts
export const PLUGIN_PERMISSIONS = {
	FS_READ: "fs.read",
	UI_SLOT_GLOBAL: "ui.slot.global",
	APP_ACTIONS_REGISTER: "app.actions.register",
} as const;
```

Plugin Adapter 在完成 manifest、用户授权和 trust level 校验后，将 `fs.read` 展开成若干独立 Grant：

```text
fs.read
  -> cap.foundation.vetta.fs.read-file
  -> cap.foundation.vetta.fs.stat
  -> cap.foundation.vetta.fs.list
```

展开结果进入通用权限层时，只剩三条 Capability Grant。通用权限层不保存 `fs.read`，也不知道这些 Grant 来自 Plugin 权限。

`ui.slot.global` 和 `app.actions.register` 属于 Plugin 系统权限，不映射为底层 Capability Grant，由 Plugin Adapter 自己检查和执行。

### 7.3 Plugin Adapter

Plugin Adapter 负责：

- `plugin.json` 权限声明和用户授权。
- trust level。
- `ctx` facade 的宿主实现。
- UI、Agent、Action contribution。
- activation、热更新和卸载。
- 插件 handler 生命周期。
- 插件权限到 Capability Grant 的展开。
- 插件专用输入校验和错误转换。

Plugin 开发者仍然只导入 `plugin-sdk` 并调用 `ctx.fs.readFile()`。宿主桥接把调用交给 Plugin Adapter，后者包装 `FS_READ_FILE` Token，不再直接调用原始 `window.vetta.fs.*`。Plugin Adapter 本身不作为第三方 API 导出。

Plugin Loader 激活插件时向宿主打开一个与 `pluginId` 绑定的 Capability Session，并把不透明的 session ID 封装在 `ctx.fs` 实现中；插件停用、激活失败或重新加载时关闭或替换该 session。每次调用都重新读取插件当前的启用状态、声明权限和用户授权，因此撤销 `fs.read`、`fs.write` 或禁用插件后无需等待旧 session 过期。跨进程接口只暴露 Plugin Adapter 已封装的文件操作，不提供任意 Capability ID 调用入口。

### 7.4 Theme Adapter

Theme Adapter 负责：

- Theme SDK facade 的宿主实现。
- React model hook。
- region、component、page、appearance。
- 主题自己的权限和能力包装。
- 主题加载、切换、回退和卸载。
- 主题存储 namespace 的生成与绑定。

例如主题自己的 storage 权限可以展开成 `storage.get`、`storage.set`、`storage.remove` 等独立 Capability Grant，并附带固定 namespace 约束。通用权限层只看到 Capability ID 和 namespace，不知道 Theme 或 themeId。

Theme 开发者仍然只使用 `@vetta/theme-sdk` 的 hook 和类型。Theme SDK、renderer host、preload/IPC 是公开 facade 到内部 Theme Adapter 的桥接，不向主题代码暴露 Capability Client、Grant 或内部 Adapter。

### 7.5 Action Adapter

Action Adapter 负责：

- Catalog、search 和 describe。
- JSON Schema 和 examples。
- effect、approval 和 `assertReady`。
- 本地 RPC。
- Action provider 注册。
- Action 业务错误。
- Action 实现对基础能力和领域能力的组合。

例如 `project.create` Action 在完成 Action 输入校验和审批后，调用 `DOMAIN_CAPABILITIES.PROJECT_CREATE`。Action effect 和审批结果不会进入通用权限层。

插件提供 Action 时必须保留两个独立上下文：

- Action caller 上下文用于 Action Adapter 的来源判断和审批。
- Plugin provider 上下文用于 handler 执行和底层 Capability Grant。

Plugin handler 不能继承 Action caller 的更高能力授权。

当前业务 Action 由 Plugin provider 提供时，Action Runtime 继续负责 Catalog、Schema、effect、approval 和调用转发，handler 内使用插件激活时绑定的 Plugin Capability Session。Action caller 的 `source`、request id 或授权上下文不会进入 Plugin provider 的 Capability Session。不存在宿主自有 Action provider 时，不为了层级对称创建空的 Action Capability Adapter；未来宿主自有 provider 必须建立独立 Subject 和 Grant。

## 8. 包边界与代码组织

能力合同、上层系统集成、通用权限运行时和开发者 SDK 分开：

```text
packages/capability-sdk/
  src/contracts.ts        # ID、Token、错误码、公共类型
  src/foundation.ts       # 基础能力契约，按层聚合
  src/domain.ts           # 领域能力契约，按层聚合
  src/access.ts           # Grant/Session 边界契约

packages/capability-runtime/
  src/                    # Registry、Hub、权限执行、审计

packages/desktop-app/src/main/capabilities/integrations/
  plugin/                 # Desktop Plugin 权限映射与 facade
  theme-capability-adapter.ts

packages/theme-sdk/       # Theme 开发者公开 API
packages/plugins/plugin-sdk/ # Plugin 开发者公开 API
```

`capability-sdk` 根入口提供稳定能力契约，主要供宿主、Provider 和经过允许的能力扩展实现使用，包含：

- Token、常量和类型。
- 输入输出 Schema。
- ID、前缀和错误码。
- Catalog 描述类型。

普通 Plugin、Theme、Action 开发者只依赖对应的公开系统 SDK。系统 SDK 提供业务友好的 API，宿主桥接和内部适配层负责把这些 API 转换为 Capability 调用。

`capability-runtime` 只由宿主使用，包含：

- Foundation/Domain Registry。
- Capability Hub。
- Provider 注册。
- AccessSession 和 Grant 执行。
- Constraint Evaluator。
- 审计和生命周期。

Desktop Provider 建议放置在：

```text
packages/desktop-app/src/main/capabilities/
  capability-host.ts
  foundation-providers.ts
  domain-providers.ts
```

Desktop 同时拥有原生 Provider、组合根，以及当前只服务 Desktop 的 Plugin/Theme 系统集成。Provider 与系统
集成分目录保存：前者实现能力，后者只负责上层身份、权限和 facade 到 Capability 调用的转换。

`capability-host.ts` 是唯一组合根：创建 Capability Hub、权限控制器、Provider 和各上层系统集成，并负责统一销毁。IPC、RPC、renderer bridge 等入口不得直接构造或销毁系统集成。

如果落地为新的 `packages/*` workspace 包，必须同时完成 workspace、根 TS paths、desktop TS paths 和 `build.sh` 分层接入，遵循 `docs/monorepo-new-package.md`。

## 9. 传输与安全边界

进程内调用使用 Capability Token，跨 IPC/RPC 时序列化为 Capability ID、契约版本和输入。反序列化后必须从 SDK Catalog 解析 Token，不能信任调用方附带的 layer、publisher 或输出类型。

权限执行必须位于可信宿主侧。禁止公开以下接口：

```ts
window.vetta.capabilities.invoke({
	subjectId: "由调用方填写",
	capabilityId: "任意字符串",
	input: {},
});
```

调用身份必须由宿主绑定，不能由调用参数声明。当前 Module Federation Plugin 和 Theme 与宿主共享 renderer JavaScript realm，因此该架构可以统一契约和逻辑权限，但不能单独构成针对恶意扩展的强安全隔离。若未来允许不可信代码，应把执行环境迁移到 Worker、utility process 或独立受限 renderer，并按进程或通道绑定 AccessSession。

## 10. 迁移计划

### 当前落地状态

当前已经实现能力基础设施及多条端到端链路：

- `packages/capability-sdk` 只提供 Capability ID、Token、基础存储/文件/网络能力、Agent 设置/通用设置/IM 桥接/模型配置/MCP 配置/项目/会话/下载/调度/Webhook/知识库/批量任务/应用更新/技能管理/全局快捷键/快捷面板领域能力、Grant 和稳定错误码；Theme、Plugin 集成已由 Desktop 上层所有。
- Capability Token 已统一使用 TypeBox Schema 作为静态类型、运行时 parser 与 JSON Schema 的单一来源，并由 Token 生成不包含执行函数的只读 Catalog。当前已声明的 29 个 Foundation Token 和 103 个 Domain Token 已全部完成迁移；TypeBox 校验错误会转换为稳定 Capability 错误码，`undefined` 输出使用独立的无载荷 Schema，Token 定义在类型层强制提供输入和输出 Schema。
- Foundation、Domain 聚合 Catalog 以及公开文档由 Token 自动生成；完整 Schema 见 [`catalog.json`](catalog.json)，可读目录见 [`catalog.md`](catalog.md)。质量门禁会拒绝过期的生成文件、手写 parser Token 和未发布 Catalog 的能力定义文件。
- `packages/capability-runtime` 提供 Foundation/Domain 双 Registry、Capability Hub、Provider 原子替换、替换或卸载时的在途调用中止、Capability Module/publisher 校验、精确 Grant、AccessSession、namespace constraint 和审计事件。
- `packages/desktop-app/src/main/capabilities` 提供 Desktop Capability Host、基础存储/文件/网络 Provider、Agent 设置/通用设置/IM 桥接/模型配置/MCP 配置/项目/会话/下载/调度/Webhook/知识库/批量任务/应用更新/技能管理/全局快捷键/快捷面板领域 Provider 和原生后端装配；已抽取领域服务的原 IPC 与 Capability Provider 复用同一实现，通用配置桥则与领域服务共享底层 config store。
- Desktop Capability Host 单例持有 Theme Adapter 和 Plugin Adapter；IPC 只复用实例，不重复创建或负责销毁。
- Theme Storage 主进程路径已经迁移为 `Theme SDK facade -> 宿主桥接 -> 内置 Theme Adapter -> AccessSession -> Foundation Storage Capability -> 现有持久化后端`。
- Theme SDK、renderer storage hook、preload API、IPC channel 和磁盘格式保持兼容。
- Plugin `ctx.fs` 的读写与元数据操作已迁移为 `plugin-sdk facade -> Plugin Loader/Preload/IPC 桥接 -> 内置 Plugin Adapter -> AccessSession -> Foundation Filesystem Capability -> 文件服务`；目录监听作为 Plugin 系统订阅 facade 由 `PluginFsApi.watchDirectory()` 统一封装并检查 `fs.read`，普通插件源码不再直接访问 Desktop preload API。
- Plugin Adapter 将 `fs.read` 和 `fs.write` 精确展开为各文件 Capability Grant；每次调用都会核验当前有效插件权限，同一插件重新激活时自动撤销旧 session。
- Plugin `ctx.network` 和 `ctx.storage` 已迁移为 `plugin-sdk facade -> Plugin Loader/Preload/IPC 桥接 -> 内置 Plugin Adapter -> AccessSession -> Foundation Network/Storage Capability -> 网络与私有存储后端`。`network.fetch` 映射为通用网络请求 Grant；`storage.read`、`storage.write` 按 JSON、文件和 Blob 操作展开为独立 Grant，并通过 namespace constraint 固定到当前插件。Capability 契约与 Provider 不接收 Plugin 身份，公开 facade 和既有磁盘格式保持兼容。
- 官方插件的 Agent 实验设置已迁移为 `PluginOfficialApi agent facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Agent Settings Capability -> AgentSettingsService`；读取与局部更新使用两个精确 Grant，局部更新在主进程单次读写中完成并返回完整规范化快照。Desktop UI 的通用 Config IPC 保持兼容并共享同一个 config store；公开 `plugin-sdk` 签名保持兼容，不再直连 `window.vetta.config.*`。
- 官方插件的通用设置已迁移为 `PluginOfficialApi general facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain General Settings Capability -> GeneralSettingsService`；读取设置、设置通知、设置默认执行模式和设置工作区分别使用精确 Grant。工作区路径校验、持久化与文件根授权集中在主进程单例服务中，Desktop UI 的通用 Config IPC 保持兼容并共享同一个 config store；公开 `plugin-sdk` 签名保持兼容，不再直连 `window.vetta.config.*`。
- 官方插件的 IM 桥接管理已迁移为 `PluginOfficialApi im facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain IM Capability -> ImHost`；状态、日志、启停、重启和 Agent 模型设置分别使用精确 Grant，Capability Provider 与原 IM IPC 复用同一个 `ImHost` 单例。状态契约只返回 App ID 等公开摘要，不返回 App Secret、Verification Token、Encrypt Key 等凭据；`assertModelKeyExists` 复用同一 Plugin Capability Session 下的 Models 领域能力。
- 官方插件的模型配置已迁移为 `PluginOfficialApi models facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Model Capability -> ModelSettingsService`；模型列表、脱敏配置与 Provider 查询、连通性探测、模型键校验、默认模型设置和 Provider 增删改分别使用精确 Grant。配置更新在主进程单例服务中串行完成，写入后刷新共享 ModelRegistry；原 Models IPC 保持兼容并复用同一服务，Capability 输出不会返回原始 API Key 或敏感 Header。
- 官方插件的 MCP 配置已迁移为 `PluginOfficialApi mcp facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain MCP Capability -> McpSettingsService`；服务列表、脱敏详情、增改、启停和删除分别使用精确 Grant，`listNames` 继续由服务列表派生。配置更新在主进程单例服务中串行完成，原 MCP Config IPC 保持兼容并复用同一服务；Capability 输出会遮蔽敏感 Header 和环境变量，同时局部更新会保留 OAuth client 等内部配置字段。OAuth 登录和授权状态仍留在原 Desktop MCP API。
- 官方插件的项目管理已迁移为 `PluginOfficialApi projects facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Project/Session Capability -> 项目与会话服务`；七个项目操作和两个会话查询分别使用精确 Grant，公开 facade 保持兼容，不再直连 `window.vetta.session.*`。
- 官方插件的下载查询与取消已迁移为 `PluginOfficialApi downloads facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Download Capability -> 下载服务`；原 Downloads IPC 与 Provider 共用单例服务，公开 facade 和下载持久化格式保持兼容。
- 官方插件的调度任务管理已迁移为 `PluginOfficialApi scheduler facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Scheduler Capability -> SchedulerService`；九个操作使用独立 Grant，`listTaskIds` 由任务列表派生，调度引擎和原 Scheduler IPC 继续复用同一个服务实例。
- 官方插件的 Webhook 管理已迁移为 `PluginOfficialApi webhook facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Webhook Capability -> WebhookManager`；端点与 Provider 查询、端点增删改、启停、测试和发送分别使用精确 Grant，原 Webhook IPC 与 Provider 继续复用同一个服务实例。
- 官方插件的知识库管理已迁移为 `PluginOfficialApi knowledge facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Knowledge Capability -> KnowledgeService`；知识库查询与增删改、文件状态、文件导入/删除、加工状态与设置、立即加工和失败重试共十二个操作分别使用精确 Grant，原 Knowledge IPC 与 Provider 共用同一个领域服务。
- 官方插件的批量任务管理已迁移为 `PluginOfficialApi batchTasks facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Batch Task Capability -> BatchTaskService`；项目查询与增删改、单任务运行/重试/停止/删除/续跑/会话删除，以及项目批量启动、停止、清理和重置共十七个操作分别使用精确 Grant，`listProjectIds` 继续由项目列表派生，原 Batch Tasks IPC 与 Provider 共用同一个服务实例。
- 官方插件的应用更新管理已迁移为 `PluginOfficialApi updater facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Updater Capability -> UpdaterService`；状态与当前版本查询、检查、下载、安装、稍后处理和取消共七个操作分别使用精确 Grant，原 Updater IPC 与 Provider 共用同一个服务实例，Desktop UI 的状态事件仍保留为内部订阅通道。
- 官方插件的技能管理已迁移为 `PluginOfficialApi skills facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Skill Capability -> SkillService`；技能发现、已安装清单、启停和卸载分别使用精确 Grant，原 Skills IPC 与 Provider 共用同一个服务单例，市场安装和自定义导入仍保留在原系统流程中。
- 官方插件的快捷键管理已迁移为 `PluginOfficialApi shortcuts facade -> Preload/IPC 桥接 -> Plugin Adapter -> AccessSession -> Domain Shortcut/Quick Panel Capability -> ShortcutService`；绑定查询、设置、单项重置、全部重置、快捷面板触发键和发送后行为分别使用精确 Grant，原 Config/Quick Panel IPC 与 Provider 共用同一个服务单例。同步的动作目录仍由 Plugin 系统 facade 从宿主共享的静态应用目录派生，不进入能力契约。
- `PluginOfficialApi.plugins` 属于 Plugin 系统自己的安装、启停、卸载和重载业务，不定义为 Domain Capability；当前通过绑定 `capabilitySessionId` 的 Plugin System IPC 调用，宿主侧 Plugin Adapter 在每次操作前重新校验 Session 和 official 状态，再复用 Desktop 插件管理副作用。
- Desktop Renderer 的 `HostedRouteService` 提供 namespace 注册、路径解析和实际导航基础设施；Capability 层以 `cap.domain.vetta.navigation.open-hosted-route` 和可序列化 `HostedRouteRef` 暴露受授权命令。Plugin/Theme Renderer Adapter 分别固定 namespace 与当前 owner，并通过精确 Grant 和可撤销 Session 调用该能力。现有 `/theme/...`、`/workspace/...` URL、React 页面 Registry、加载和 ErrorBoundary 仍由 Desktop 及来源系统拥有；Plugin Loader 继续用主进程返回的 `capabilitySessionId` 关联 Renderer Session，Theme Runtime 则随激活主题创建并撤销 Session。
- `PluginOfficialApi.appearance` 与通用 `PluginOfficialApi.navigation` 仍属于 Renderer Plugin 系统 facade，继续通过 active + official Session 校验；它们没有因为 Hosted Page Token 的落地而被错误提升为通用 Capability。
- `Plugin Workbench` 是随宿主发布的内置插件开发管理工具，需要安装、授权、热重载、开发监听和保存对话框等宿主管理接口，因此是普通第三方插件不得复制的显式例外；质量守卫会阻止其他 preset/external 插件直接访问 `window.vetta`。
- Plugin Action provider 的调用边界已有回归测试：Action caller 的来源、request id 和授权上下文不会转发给 provider；provider 被禁用后调用立即被拒绝。Agent 设置、通用设置、IM 桥接、模型配置、MCP 配置、项目、下载、调度、Webhook、知识库、批量任务、应用更新、技能管理和快捷键管理相关 Action 最终只使用该 Plugin 自己的 Capability Session。

后续工作：

- 后续新引入、且确实需要跨系统复用的基础能力与领域能力。
- 不可信扩展的进程级隔离。

### 阶段一：契约和 Registry

1. 建立 Capability ID、Token、错误码和前缀常量。
2. 实现 Foundation/Domain 两套 Registry 和统一 Hub。
3. 盘点 `window.vetta.*`、`ThemeHost`、Plugin facade、`PluginOfficialApi` 和 App Action 使用的能力。
4. 将盘点结果划分为基础能力、领域能力或系统适配层业务。

### 阶段二：通用能力权限层

1. 实现 AccessSubject、CapabilityGrant、AccessSession 和 Authorized Client。
2. Grant 只保存完整 Capability ID。
3. 实现精确匹配、撤销、时效、约束和审计。
4. 添加守卫，禁止权限层导入 Plugin、Theme、Action 模块。

### 阶段三：Theme 试点

1. 将主题存储迁移为 foundation storage 能力。
2. 在 Desktop Theme 集成层生成固定 namespace 约束和独立 Grant。
3. 保持 `useThemeStorage()` 等公开 API 不变。

### 阶段四：Plugin 迁移

1. `ctx.fs`、`ctx.network` 和 `ctx.storage` 已改为使用 Foundation Capability Token；图像生成业务由插件拥有，不再保留 `ctx.images` 或宿主图像领域能力。
2. Plugin Adapter 已将 `fs.read`、`fs.write`、`network.fetch`、`storage.read` 和 `storage.write` 展开为独立 Capability Grant；Network 与 Storage Grant 都使用 namespace constraint 固定到当前插件。插件 facade 的 `pluginId`、`plugin-blob` 在 Adapter 内转换成通用合同的 `namespace`、`storage-blob`，不会穿透到 Capability SDK 或 Runtime。
3. `ui.slot.*`、`app.actions.register` 等继续留在 Plugin Adapter。
4. `PluginOfficialApi.agent`、`general`、`im`、`models`、`mcp`、`projects`、`downloads`、`scheduler`、`webhook`、`knowledge`、`batchTasks`、`updater`、`skills` 和 `shortcuts` 已迁移为独立 Domain Capability；新增稳定 Desktop 领域服务时继续保留兼容 facade。

### 阶段五：Action 迁移

1. Action Runtime 继续维护 Catalog、effect、approval 和 Schema。
2. Agent 设置、通用设置、IM 桥接、模型配置、MCP 配置、项目、下载、调度、Webhook、知识库、批量任务、应用更新、技能管理与快捷键管理相关 Action provider 已通过 Plugin facade 调用 Domain Capability；Plugin 管理、外观与导航按系统业务边界保留在 Plugin/Renderer facade，当前没有待迁移的 Domain Action provider。
3. 插件 Action handler 已使用 Plugin provider 自己的 Capability Session。
4. 已验证 Action caller 身份和权限不会传递给 provider；后续新增 Action transport 必须保留该回归测试。

## 11. 验收标准

- 宿主、Provider 和内部 Adapter 调用能力时引用 Capability Token，不直接写 Capability ID 字符串。
- 普通 Plugin、Theme、Action 开发者只使用对应系统 SDK，不接触 Desktop preload、内部 Adapter、Grant 或 Authorized Client；随宿主发布的 Plugin Workbench 是显式的宿主管理工具例外。
- 基础能力使用 `cap.foundation.*`，领域能力使用 `cap.domain.*`。
- Foundation 和 Domain 使用两套 Registry，并由统一 Hub 路由。
- 领域能力可以依赖基础能力，基础能力不能依赖领域能力。
- Capability Grant 只包含完整 Capability ID，不存在通用 Permission ID。
- 授权不使用前缀、glob、read/write 分组或隐式继承。
- 通用权限层源码不出现 Plugin、Theme、Action 的类型或业务分支。
- 系统权限到 Capability Grant 的展开只发生在对应系统适配层。
- 系统集成集中位于对应上层所有者目录，`capability-sdk` 不包含 Plugin/Theme/Action Adapter。
- 系统 Adapter 由 Capability Host 单例持有，协议入口不直接创建或销毁 Adapter。
- 新增 Capability 后默认没有 Grant，不会扩大现有授权。
- Provider 热更新失败时保留旧版本，卸载后取消进行中的调用。
- 公开 Catalog、JSON Schema 和文档由 SDK Token 定义生成。

## 12. 最终新增流程

新增一个能力：

```text
定义 Capability Token 和 Schema
-> 选择 Foundation 或 Domain Registry
-> 实现并注册 Provider
-> 默认保持无 Grant
-> 在需要使用它的上层系统集成中完成权限判断
-> Adapter 为该 Capability ID 创建独立 Grant
-> Adapter 包装为本系统 facade
```

新增一个系统：

```text
定义系统自己的 manifest、权限和生命周期
-> 选择需要使用的 Capability Token
-> 将系统授权结果展开为独立 Capability Grant
-> 在该系统自己的宿主集成目录实现 Adapter
-> 通过宿主桥接实现本系统公开 SDK 的 facade
-> 不修改能力层和通用权限层的业务模型
```

该结构保证能力实现可复用、通用授权不猜测业务关系，同时允许 Plugin、Theme、Action 及未来系统保留独立的权限语义和扩展方式。
