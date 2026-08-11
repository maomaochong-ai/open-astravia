# 第 247 阶段：认证凭据域完整重写

## 阶段目标

在不改变 API Key、OAuth、环境变量、运行时覆盖、配置值解析、文件锁和旧凭据迁移行为的前提下，将认证凭据能力从旧 `src/core/auth-storage.ts` 重写为职责清晰的 `src/auth` 领域，并让宿主组合根只依赖稳定认证 Port。

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

第 246 阶段后，Auth Storage 仍有 4 条生产代码到旧 Core 的依赖，旧实现由一个 464 行文件同时承担合同、文件锁、内存存储、OAuth Provider 查询、凭据刷新和公开实现。认证又是必须保留的用户数据边界，不能只移动文件或用兼容壳延续旧结构。本阶段按职责重新实现认证域，并保留 `AuthStorage` 这个既有公开 API 名称，但宿主内部改为消费窄 Port。

## 实施内容

### 1. 建立认证域合同与组合边界

- 新增 `auth/contracts.ts`，定义凭据值、持久化事务、`AuthStorageBackend` 和宿主消费的 `CodingAgentAuthRuntime`。
- `AuthStorage` 作为公开的默认领域实现保留，文件与内存后端分别进入 `auth/storage`，不再把锁、文件权限和状态解析混在一个文件中。
- 新增 `createCodingAgentAuthRuntime` 作为 Composition Root 工厂；CLI Bootstrap、SDK Host 和公共 Host Services 均依赖 `CodingAgentAuthRuntime`，不暴露具体文件实现要求。

### 2. 隔离动态 OAuth Provider 运行时

- 新增 `OAuthCredentialRuntime`，集中适配 `@vetta/ai` 的登录、刷新、API Key 投影与 Provider 枚举。
- Provider 目录在每次操作时动态读取，没有形成进程级快照；认证存储创建后注册的新 Provider 仍可立即登录和取 Key。
- 保留刷新锁、锁损坏恢复、外部文件编辑合并、运行时覆盖、存储凭据、环境变量和 fallback 的既有优先级。

### 3. 在持久化边界引入 TypeBox

- `auth.json` 进入内存前通过 TypeBox 校验，不再对 `JSON.parse` 结果直接断言类型。
- API Key 与 OAuth 基础字段严格校验，同时允许 Provider 自定义 OAuth 扩展字段，避免破坏现有凭据。
- 无效 JSON 或无效凭据结构都会进入错误缓冲，并阻止后续写入覆盖原文件。
- 文件后端继续创建 `0700` 目录与 `0600` 凭据文件；该权限断言在支持 POSIX mode 的平台执行。

### 4. 删除旧实现并保留公开合同

- 包根与 `host-services` 继续导出 `AuthStorage`、文件/内存后端和凭据类型，现有外部调用不需要迁移到旧目录。
- 新增公开窄接口与工厂，不把宿主绑定到 `AuthStorage` 类。
- 删除 `src/core/auth-storage.ts`；生产代码和测试对该旧路径的引用归零。
- 保留独立 `migrations.ts` 对旧 `oauth.json` 和 `settings.json.apiKeys` 的显式迁移，不把旧格式兼容混入运行时存储实现。

### 5. 修复跨平台测试夹具

- 将认证测试中的 POSIX 专用 `printf`、`tr` 和 `sh -c` 夹具替换为等价 Node 命令。
- 该调整只修复 Windows 测试执行方式，没有修改配置命令的生产解析和缓存行为。

## 行为兼容性验证

- 认证存储、旧凭据迁移和公共子路径共 3 个定向测试文件通过：29 个测试通过，1 个仅限非 Windows 的权限测试跳过。
- 覆盖 API Key 各级来源、命令执行与缓存、动态 OAuth 注册、过期凭据刷新、锁损坏恢复、外部编辑合并、错误缓冲、无效文档防覆盖、Provider 扩展字段和旧凭据迁移。
- `AuthStorage` 在包根与 `host-services` 的导出身份继续一致。

## 旧实现依赖变化

| 指标 | 第 246 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 23 | 19 | 0 |
| Auth Storage 旧依赖边 | 4 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 61 | 60 | 0 |
| Auth Storage 旧实现文件 | 1 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 仍有 19 条旧产品 Core 依赖和 60 个旧实现文件。
- Export HTML 与 Memory 各有 4 条旧依赖；Hooks、Slash Commands 和 Timings 各有 2 条；Background Tasks、Concurrency、Event Bus、Footer Data Provider 与 Image Budget 各有 1 条。
- 下一阶段优先处理 Export HTML：它是相对独立的输出边界，可将模板、渲染器和文件导出从旧 Core 分离，且不与 Memory 用户数据语义混合。
