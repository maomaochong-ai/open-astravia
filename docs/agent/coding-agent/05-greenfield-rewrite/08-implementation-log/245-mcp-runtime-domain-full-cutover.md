# 第 245 阶段：MCP 运行时领域完整切换

## 阶段目标

在不改变文件级 MCP、插件内聚 MCP、stdio/HTTP 传输、OAuth、动态重载、渐进披露和工具执行行为的前提下，删除 `coding-agent/src/core/mcp`、旧 `McpManager` 与 Legacy MCP Runtime Adapter；通用能力只由 `runtime-mcp` 持有，Coding Agent 与 Desktop 分别只保留产品组合和交互宿主职责。

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

第 244 阶段后 MCP 仍是剩余旧领域中边界最完整、但生产依赖尚未归零的部分：协议、传输、监督器、配置和 OAuth 通用流程已经在 `runtime-mcp`，Coding Agent 却仍用旧目录包装这些能力，Desktop 也通过深层 `core/mcp` 导入交互式授权函数。本阶段完成真正切换，不新建平行 MCP 包，也不把协议实现搬回 Coding Agent。

## 实施内容

### 1. 建立 Coding Agent MCP 产品组合根

- 新增 `coding-agent-mcp-supervisor.ts`，只负责注入全局/项目配置路径、MCP 客户端身份、凭证目录和诊断回调。
- 文件 MCP 与插件 MCP 均直接组合 `McpServerSupervisor`、Runtime Client Factory、动态 Server Source 和 Runtime Tool Source。
- HTTP 连接继续读取 `~/.vetta/agent/mcp-auth` 的已有凭证；stdio、HTTP、OAuth Provider 与协议实现不在 Coding Agent 重复实现。
- 插件 MCP 指纹留在插件组合职责内，继续保持排序无关和配置变化可检测，不恢复旧 Manager。

### 2. 把交互式 OAuth 明确归属 Desktop 宿主

- 新增 `DesktopMcpOAuthService`，组合 `runtime-mcp` 的浏览器授权码与设备授权流程。
- 本地回调服务和设备码展示页拆入独立 Host UI 模块；打开外部浏览器、GitHub 422 引导和凭证状态查询仍由 Desktop 承担。
- Desktop 主进程用户可见 HTML 与错误引导全部使用 `mainT`，并补齐中英文 catalog。
- 主进程 i18n 改为直接读取配置存储，消除 `i18n -> ipc/fs -> MCP OAuth -> i18n` 的潜在循环依赖。

### 3. 删除旧实现、结构测试与深层导出

- 删除 `src/core/mcp` 14 个旧文件、`legacy-mcp-runtime-source.ts` 和旧 barrel export。
- 删除 `./core/mcp/index.js` 与 `./core/mcp/types.js` package export；有效 CLI 与 Coding Agent 测试改为直接依赖 `runtime-mcp` 合同。
- 删除仅验证旧 Manager、旧包装类、旧新差分和旧深层 API 的结构性测试；配置路径、插件隔离、Runtime Tool、OAuth 通用流程及 Desktop 宿主行为继续由新边界测试覆盖。

### 4. 扩展重写审查门禁

- 重写基线 Schema 升级到 v2，新增 `legacyCoreExports` 精确集合。
- 当前仅保留尚未替换的 `./core/host/executable-resolver.js`；新增或恢复任意 `./core/*` 导出都会使质量门禁失败。
- MCP 旧依赖边、旧文件和深层导出已从精确基线移除，重新出现会被判定为新增旧实现。

## 行为兼容性验证

- `runtime-mcp` 11 个定向测试文件、38 个测试通过，覆盖监督器、配置、stdio/HTTP 适配、OAuth State/Provider、浏览器/设备授权、动态 Server、工具同步和渐进披露合同。
- `coding-agent` 3 个定向测试文件、13 个测试通过，覆盖产品配置路径与变量展开、文件 MCP 组合、工具元数据/执行/释放和插件 MCP 隔离/重配置。
- Desktop OAuth Service 3 个测试通过，覆盖浏览器授权宿主注入、本地回调接收、设备授权凭证共享、状态查询和登出。
- 重写治理 10 个测试通过，包含新增 Legacy Core Export 门禁。
- 根 `bun run check` 通过：Biome、monorepo `tsgo`、CLI 独立 typecheck、Desktop `tsc`、Admin `tsc -b` 和全部质量守卫均通过。
- 两个 CLI MCP 行为套件的单独 Vitest 收集被本地缺失的 `runtime-knowledge` 可解析包入口阻断；没有进入测试用例。CLI 源码已由根级独立 typecheck 验证，这一工作区产物状态不记为行为测试通过，也不通过修改功能绕过。

## 旧实现依赖变化

| 指标 | 第 244 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 33 | 28 | 0 |
| MCP 旧依赖边 | 5 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 78 | 64 | 0 |
| `src/core/mcp` 旧实现文件 | 14 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 3 | 1 | 0 |

## 尚未完成的替换

- 仍有 28 条旧产品 Core 依赖和 64 个旧实现文件；当前较集中的领域是 Bash Executor、Auth Storage、Export HTML、Memory、Hook 与 Slash Command。
- `./core/host/executable-resolver.js` 是唯一剩余深层 Core Export，必须在对应 Host 能力迁移时删除，不能长期作为例外保留。
- CLI MCP 行为套件应在工作区依赖产物恢复后重新执行；本阶段没有把产物缺失解释为功能正确。
