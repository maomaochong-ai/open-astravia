# 第 221 阶段：稳定 SDK 消费者迁移与窄能力补齐

## 阶段目标

在第 220 阶段稳定公共类型边界之后，用仓库内真实 SDK 示例验证该边界，并补齐两类已经由消费者证明需要的能力：

1. 不依赖具体 `SessionManager` 的原生会话目录查询；
2. 不依赖具体 `ResourceLoader` 和覆盖回调的资源值贡献。

本阶段只迁移功能等价的示例。认证、设置、任意资源过滤和完整 Extension factory 注入继续保留在宿主服务或包根兼容入口，没有删除旧功能。

## 实施前发现

### 官方消费者仍以旧入口为主

`examples/sdk` 的 12 个示例和 `docs/sdk.md` 仍主要导入包根 `createAgentSession()`，并直接创建
`AuthStorage`、`ModelRegistry`、`SettingsManager`、`SessionManager`、`DefaultResourceLoader`。这会让稳定 SDK
即使已经存在，也无法通过真实消费者验证其公共合同是否够用。

### 会话目录已有中立实现

`RuntimeSessionCatalog` 已经把离线目录查询与活动 Session 生命周期分离，
`FileConversationRuntimeSessionCatalog` 也已经实现原生 conversation 文件的 list、recent 排序、rename 和 delete。
因此公共 SDK 不需要新建存储抽象，只需要把现有 Runtime Port 投影为稳定产品合同。

### 资源缺口集中在值和路径贡献

可稳定表达的真实缺口包括：系统提示词、额外 Extension/Skill/Prompt Template 路径、内联 Prompt Template
和内联 Context File。旧示例中的任意 `skillsOverride` 过滤和 inline Extension factory 会携带更大的执行合同，
本阶段不把这些回调重新包装进公共 SDK。

### Workspace path map 漏掉 SDK 子路径

包的 `exports` 已经存在 `./sdk`，但根 `tsconfig.json` 没有对应源码 path map。示例纳入根 TypeScript include 后，
`@vetta/coding-agent/sdk` 会被通配符错误解析到不存在的 `packages/coding-agent/src/sdk`。

## 架构决策

### 会话创建与目录查询分离

新增 `CodingAgentSessionCatalog`，只提供 `list()` 和 `findRecent()`。公共工厂
`createCodingAgentSessionCatalog()` 接受 `cwd` 与 `conversationDir`，内部使用现有文件目录适配器。

Catalog 不进入 `createCodingAgentSession()` 参数，也不拥有活动 Session、写锁或 Session 切换生命周期。
调用方从摘要取得 `path` 后，再通过 `storage.kind = "file-resume"` 表达恢复意图。

### 资源使用稳定值合同

新增 `CodingAgentResourceContributions`：

- `systemPrompt`
- `extensionPaths`
- `skillPaths`
- `promptTemplatePaths`
- `promptTemplates`
- `contextFiles`

Host Adapter 将其转换给现有 `DefaultResourceLoader`。公共类型不出现 Loader、缓存、override callback 或产品管理器。
插件动态重配 Skill 路径时会重新合并公共 `skillPaths`，避免插件重配意外清除 SDK 显式贡献。

路径资源继续使用现有 reload 生命周期：`session.reload()` 重新读取文件系统。内联 Prompt Template 和 Context File
则作为该 Session composition 的固定值重新合并。

### 不增加不必要的运行时 Schema

这些参数是同进程 TypeScript SDK 值，不是 JSON、RPC 或配置文件的不可信边界，因此没有为其增加 TypeBox/Zod
校验。现有 custom tool 的 TypeBox schema 和调用输入校验保持不变；将来若资源贡献从序列化协议进入，再在对应
Parser/Adapter 边界增加 TypeBox 校验。

## 实施内容

### 公共合同与产品适配

- 新增 `sdk-session-catalog-contract.ts`，定义稳定会话摘要、Catalog 和创建参数；
- 新增 Host 层文件目录适配器，复用 `FileConversationRuntimeSessionCatalog`；
- `public-api/sdk.ts` 导出 `createCodingAgentSessionCatalog()`，没有导出具体实现类；
- `CreateCodingAgentSessionOptions` 新增 `resources` 值输入；
- SDK Host Adapter 将资源贡献接入现有 Loader、Extension lifecycle 和 reload；
- 公共边界守卫更新为允许新的稳定 contract 文件和 Catalog 工厂，同时继续拒绝迁移词及具体管理器。

### 官方示例迁移

以下示例已迁移到 `@vetta/coding-agent/sdk`：

- `01-minimal.ts`
- `03-custom-prompt.ts`
- `05-tools.ts`
- `07-context-files.ts`
- `08-prompt-templates.ts`
- `11-sessions.ts`

其中工具改为通过名字激活，由产品 Composition 按 Session cwd 创建；会话列表和 recent 恢复改用 Catalog；
Context 和 Prompt Template 改用资源值贡献。

以下功能继续明确保留为兼容或 Host Service 示例：

- 自定义 provider 注册、OAuth 和 API key 管理；
- 持久化/内存 Settings 管理；
- 任意 Skill 发现过滤；
- inline Extension factory 和完整 Composition override。

### 文档与 Workspace 接线

- 新增 `docs/stable-sdk.md` 作为稳定 SDK 主文档；
- 原 `docs/sdk.md` 改为包根兼容 API 参考，并在开头指向稳定文档；
- 包 README 的 Programmatic Usage 改用稳定入口；
- 示例 README 增加 stable、host-service、compatibility 分类；
- 根 TypeScript path map 增加 `@vetta/coding-agent/sdk`，保证源码工作区消费者与发布 exports 一致；
- CHANGELOG 的 `[Unreleased]` 记录新增合同与消费者迁移。

## 测试中发现并确认的语义

最初使用删除 Skill 文件后立即读取 `getSystemPrompt()` 的断言验证 reload。Loader 日志显示 Skill 已正确移除，
但 `getSystemPrompt()` 返回的是最近一次模型调用已经编译的提示词；新的 Skill 集合会在下一次模型调用时重新编译。
这是既有缓存语义，不是资源发现失败。

为避免把“最近编译提示词”误当成“当前资源目录”，最终测试改为使用 Prompt Template 路径：删除文件并调用
`session.reload()` 后，`getPromptTemplates()` 的实时资源视图立即移除该模板。这样既验证了路径资源动态变化，也没有
为了测试改变 Prompt 编译时序。

## 验证结果

- 定向测试：
  `bunx vitest --run test/sdk/public-sdk-entry.test.ts test/sdk/public-sdk-boundary.test.ts`
  - 2 个测试文件通过
  - 7 个测试通过
- `bun run check:quick`：通过；
- 首次 `bun run check`：发现并修复 workspace SDK path map 缺口；
- 修复后 `bun run check`：Biome、monorepo/CLI/Desktop/Admin 类型检查和 guards 全部通过；
- `git diff --check`：通过；
- 按仓库规则没有运行 build，也没有提交。

## 阶段结论

稳定 SDK 现在已经由仓库内真实消费者覆盖，会话目录与常用资源注入不再要求具体 Manager/Loader。包根兼容入口
仍保留全部旧功能，因此本阶段是架构迁移而不是功能删除。

下一阶段应处理剩余消费者中真正需要执行合同的能力，优先设计 Extension/Skill 的动态贡献与策略合同；不能把
`extensionFactories`、`skillsOverride` 或整个 Loader 原样搬进稳定 SDK。认证和设置继续作为独立 Host Service，不应
回流 Session 创建合同。
