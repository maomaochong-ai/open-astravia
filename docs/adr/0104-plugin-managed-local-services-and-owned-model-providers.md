# ADR-0104：插件受管本地服务与自有模型 Provider

## 状态

已接受

## 背景

部分插件集成的上游产品不是一次性 CLI 或标准 MCP Server，而是需要长期运行、监听回环端口并提供 HTTP API
的本地服务。这类插件同时需要准备跨平台二进制、管理进程生命周期，并将服务暴露的动态模型加入 Vetta
模型目录。

现有 `providers.cli` 只表达可执行命令的探测、安装和调用；managed-binary MCP 只表达 MCP stdio 运行时。
把某个上游服务的路由、OAuth Provider、响应解析和模型映射写入 Desktop，会让插件业务与宿主发布周期绑定，
也会迫使每个新服务继续修改客户端。

## 决策

1. Plugin manifest 新增通用 `providers.services`。服务声明固定运行时版本，按平台列出 SHA-256、归档类型、目标
   目录和可执行文件，以及配置模板、进程参数、健康检查和命名凭证槽。清单不包含下载 URL，宿主不解释上游
   Release、镜像、鉴权或更新规则。
2. 插件通过既有、带域名权限的 `ctx.network` 自己选择下载源、下载归档并校验 SHA-256，再把归档字节交给
   `ctx.services.install()`。Desktop 只实现通用受管服务基础设施：对插件交付的字节二次校验摘要、安全解包、
   版本化原子安装、数据/缓存分离、随机回环端口、模板占位符、进程启动/停止、健康检查、状态订阅和同源 HTTP 请求。
   下载是否发生、从哪里下载、重试和升级时机均由插件控制；宿主不会在插件启用时自动下载或启动服务。
3. 服务请求只接受根相对 path，并始终发往该插件声明服务的 `127.0.0.1` origin。插件可以指定声明过的
   credential id，由主进程注入 Bearer header；不能借该 API 请求其它主机。
4. SDK 新增 `ctx.services`，调用方只能操作自己 manifest 中声明的服务。插件禁用、卸载或 App 退出时，宿主停止
   对应进程。所有 Renderer IPC 调用以 capability session 反查 plugin id，不接受调用方提供的 owner id。运行时
   制品与稳定数据目录分离；模板 `create` 只在数据目录首次写入，`render` 在每次启动前重新生成缓存目录文件。
   动态端口/运行时路径必须用于 `render` 配置，不得把首次替换值固定在持久配置中；升级不覆盖认证数据。
5. SDK 新增权限 `models.manage` 与 `ctx.models`。插件只提交本地 Provider id，宿主将真实 id 规范化为
   `<plugin-id>.<local-id>`（local id 不允许点号，以免不同 plugin id 发生拼接碰撞）；获授权插件只能通过
   `replaceOwnedProviders()` 原子替换该命名空间，不能覆盖或删除其它插件或用户维护的 Provider。同一插件可为不同入站协议建立多个 Provider。
   本次合同不保留插件侧逐个 `upsertProvider/removeProvider` 兼容入口；官方域的模型管理接口仍独立存在。
6. 受管服务的 transport health 与业务语义 readiness 分离。声明 `health.readiness.mode = "plugin"` 的服务在健康检查通过后仍保持
   `starting`，插件完成账号、路由或模型目录加载后调用 `ctx.services.reportReady(serviceId, true)`，宿主才公开 `ready`。
   宿主不暴露 `ready-but-catalog-warming` 等中间公共状态；未声明该模式的服务保持原有健康检查即 ready 的语义。
7. 上游特定的 HTTP path、OAuth 服务商枚举、认证状态机、响应 Schema、账号聚合、模型发现和协议映射全部由
   插件实现并随插件发布。Desktop 和 Plugin SDK 不包含任何上游产品名称、路由表或兼容矩阵。
8. 每个市场插件版本必须在插件自有 lock 中引用固定 Release URL，并在 manifest 与 lock 中保持相同 SHA-256；
   不得在安装时解析 `latest`、执行脚本或下载未声明组件。上游更新通过市场仓库更新插件 lock/manifest 并重新
   发布插件完成，无需修改 Desktop。
9. `providers.services` 与 `ctx.services`/`ctx.models` 进入 Plugin API `1.5.0`；语义 readiness 与原子模型快照进入 `1.6.0`。旧宿主通过
   `pluginApiVersion` 和市场 `minAppVersion` 在安装前拒绝不兼容插件，不执行部分安装。

## 安全边界

- Manifest、模板、插件交付的归档和服务响应均是不可信输入，在首次进入主进程边界时校验。
- 插件网络能力按 `network.allowedHosts` 门控并限制响应大小；插件负责首次摘要校验。宿主对收到的归档再次校验
  manifest 摘要，拒绝绝对路径、路径穿越、链接和解压炸弹；安装只在 staging 完成后原子提交。
- 服务端口由宿主动态分配给回环地址。是否确实只监听回环仍由插件提供的配置模板保证，因此官方市场审核和
  服务 canary 必须验证监听地址。
- 插件代码与宿主 Renderer 共享 realm，并不是安全沙箱。命名凭证和 `models.manage` 是最小能力与所有权约束，
  不是对恶意插件的隔离；用户仍应只启用可信来源插件。
- 服务专用管理 API 的危险程度由对应插件负责评估和收口。宿主不会维护某个上游服务的 allowlist 或 denylist，
  因为该规则一旦进入客户端就会重新产生专用耦合。

## 后果

- 新的本地 HTTP 服务型插件只需发布市场插件和固定资产锁，不需要在 Desktop 新增专用 client/adapter。
- 上游 Provider、OAuth 或模型协议变化可以独立升级插件；通用宿主合同不随上游高频版本变化。
- Desktop 增加插件交付二进制的解包、执行和长期子进程攻击面，需要持续维护归档、摘要、生命周期和响应大小合同测试；
  下载协议、镜像和上游发布策略的变化不再扩大宿主职责。
- 插件自有 Provider 使用稳定 plugin id。当前禁用/卸载会停止服务，但保留已写入的模型设置（不会自动切换用户默认模型）；
  重新启用时由插件同步当前连接地址。不应将此描述为自动删除全部 Provider 配置。
- 本决策不抽取或改变 ADR-0092 的 managed-binary MCP 实现；二者可在后续行为保持型重构中复用安装器，但本次
  不以扩大重构范围为前提。

## 不在本决策范围

- 任一具体本地服务的 OAuth、API Key、管理端点或模型兼容策略。
- 自动合并上游 Release、绕过市场审核或运行时静默更新。
- 远程实例管理、非回环明文 HTTP、证书信任和 SSRF 策略。
- 在宿主中实现第二套上游账号池、重试、冷却或请求翻译逻辑。
