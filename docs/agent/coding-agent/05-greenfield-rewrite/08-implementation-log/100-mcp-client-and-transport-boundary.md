# 第 100 轮：MCP Client 与 Transport 基础设施边界

## 1. 目标

第 99 轮已经把 MCP 协议合同、TypeBox 配置解析和通用文件配置 Source 迁入
`@vetta/runtime-mcp`，但具体连接仍位于 `coding-agent/core/mcp`：

- `McpClient` 同时承担 stdio JSON-RPC 请求关联和具体子进程通信；
- `McpProcess` 直接管理 spawn、NDJSON、环境、stderr 和关闭；
- `HttpMcpClient` 同时依赖官方 SDK、OAuth 文件状态和 Vetta `agentDir`；
- `McpManager` 虽然已有 Client Factory 接缝，默认工厂仍指向 coding-agent 内部实现。

本轮目标是把连接基础设施迁入 runtime-mcp，同时保持 manager、OAuth 和全部外部行为不变。

## 2. 最终边界

```text
runtime-mcp
  client/
    client handle
    auth-required error
    transport-selecting factory
  transports/stdio/
    JSON-RPC client
    Node child-process adapter
  transports/http/
    HTTP MCP client
    official SDK session adapter

coding-agent/core/mcp
  McpClient / McpProcess compatibility classes
  HttpMcpClient product wrapper
  FileMcpOAuthProvider and token storage
  browser/device OAuth flows
  legacy McpManager
```

stdio 与 HTTP 只在高层 `McpClientHandle`/`IMcpClient` 合同上统一。stdio 继续使用自有 NDJSON
JSON-RPC，HTTP 继续使用官方 MCP SDK；没有为了目录整齐而增加万能低层 Transport 或 Pipeline。

## 3. 实施内容

### 3.1 独立 Client 合同与错误

runtime-mcp 新增：

- `McpClientHandle`：在 `IMcpClient` 之上保留 name、pid 和 initialized 状态；
- `McpAuthRequiredError` 与稳定的 `MCP_AUTH_REQUIRED` code；
- `RuntimeMcpClientFactory`：只根据 stdio/HTTP 配置选择实现；
- `RuntimeMcpClientFactoryOptions`：只包含 debug、timeout 和 HTTP Auth Provider Factory。

Runtime Factory 不接受 `agentDir`，也不知道 token 文件、Desktop 或 CLI。

### 3.2 stdio Client 与子进程适配器

原 stdio 行为迁入 `runtime-mcp/transports/stdio`：

- 保留 command、args、cwd、env 合并和 Windows shell 规则；
- 保留换行分帧、半包缓存、stderr 日志和非法 JSON 错误；
- 保留自增请求 ID、每请求 timeout、远端 error code/data；
- 保留 initialized notification、Tool/Resource/Prompt 方法和 cursor 参数；
- 保留进程 error/exit 对全部在途请求的拒绝；
- 保留 SIGTERM 后五秒 SIGKILL 的关闭策略。

迁移源码不再使用 `any`。开放 JSON 参数使用 `unknown`/`McpJsonObject`，远端错误通过
`Object.assign(Error, { code, data })` 保留原可观察结构。

没有在本轮对 stdio frame 增加 TypeBox 强校验。旧实现对 envelope 是宽松分派，贸然增加 Schema
会改变非法服务端输出的错误路径。TypeBox 继续用于不可信配置文件；HTTP 响应继续由官方 SDK
解析和校验。若以后收紧 wire validation，必须作为独立功能变更并提供迁移说明。

### 3.3 HTTP Client 与 SDK Session Adapter

HTTP client 迁入 `runtime-mcp/transports/http`，继续保留：

- URL、headers、client info、capabilities 和 timeout 映射；
- SDK `listTools`、`callTool`、Resource 和 Prompt 调用；
- connect/tool-call Unauthorized 与包含 401 的错误分类；
- 认证失败后的 `McpAuthRequiredError`；
- connect 失败清理、close 错误吞并和 initialized 状态变化。

官方 SDK 构造和调用集中到薄 `McpHttpSdkSession` Adapter。该边界用于隔离第三方 API 和确定性
测试，不对 stdio 暴露，也不重新实现 SDK 的 Streamable HTTP 协议。

runtime-mcp 现在显式声明与 coding-agent 相同版本的 `@modelcontextprotocol/sdk` 依赖，Bun lock
同步更新，不依赖 workspace 偶然 hoist。

### 3.4 OAuth 产品适配与兼容 API

runtime HTTP client 只调用 `McpHttpAuthProviderFactory`。coding-agent 的兼容 `HttpMcpClient` 负责：

1. 解析原有 `agentDir` 默认值；
2. 检查原 token 文件是否有 access/refresh token；
3. 读取原 redirect URI；
4. 创建原 `FileMcpOAuthProvider`；
5. 把 Provider 注入 runtime HTTP client。

因此公共 HTTP MCP 不会被强制 OAuth discovery，有 token 的 server 仍使用原 provider，缺少或失效
认证仍进入 `needs_auth`。Browser Flow、Device Flow、token 文件内容和存储路径均未迁移。

coding-agent 保留原 `McpClient`、`McpProcess`、`HttpMcpClient`、Options 和 `createMcpClient` 导出。
兼容类使用薄继承而不是直接 alias，确保旧 `constructor.name` 仍为 `McpClient`、`McpProcess`。

## 4. 行为基线与实施纠偏

迁移前新增 4 项真实 stdio 子进程测试并对旧实现运行通过；迁移后原测试不改导入路径继续通过，覆盖：

- initialize、Tool、Resource、Prompt 和 cursor；
- JSON-RPC error code/data；
- 方法级 request timeout；
- server exit 对在途请求和 initialized 状态的影响。

新增 5 项 HTTP client 测试和 1 项 SDK Adapter 测试，覆盖工厂分流、参数映射、认证错误、关闭容错
以及官方 SDK 构造和方法参数。

实施中主动纠正了三处非目标变化：

- 直接 re-export 新类会改变旧 `constructor.name`，改为兼容继承类；
- 安全化 primitive frame 分派会改变旧非法帧行为，恢复旧分派语义；
- 100ms timeout 测试在 Windows 多包并发下可能先超时 initialize，测试阈值改为 500ms，生产默认值
  和错误语义没有改变。

## 5. 明确未修改

- 未迁移、重写或删除 `McpManager`；
- 未修改 server 初始化顺序、状态、差分 reload 或 plugin reconcile；
- 未修改 OAuth token JSON、目录、redirect、DCR、PKCE、Browser Flow 或 Device Flow；
- 未新增自动重连、请求重试、连接池或统一 Transport Pipeline；
- 未修改 stdio shell、timeout、请求 ID、错误文案或关闭信号；
- 未修改 HTTP headers、SDK timeout、Unauthorized 判定或 Tool 调用结果；
- 未修改 MCP Tool 名称、自动批准、渐进披露、Prompt 或 Session 持久化。

## 6. 测试与验证

定向测试：

```text
runtime-mcp: 5 files passed, 16 tests passed
coding-agent MCP: 5 files passed, 26 tests passed
CLI Greenfield integration: 3 files passed, 19 tests passed
Desktop Greenfield Backend Pool: 1 file passed, 6 tests passed
```

质量门禁：

```text
bun run check:quick: 通过
bun run check: 通过
```

完整检查覆盖 Biome、monorepo `tsgo`、CLI 独立类型检查、Desktop 独立 `tsc`、Admin `tsc -b`、
包边界、构建顺序和独立 CLI 构建守卫。

安装态与真实宿主：

```text
installed standalone CLI artifact: 1 test passed
Desktop Greenfield Runtime Canary: 通过
desktopRestarted: true
sessionPersisted: true
sessionLocksReleased: true
endpointRemoved: true
providerStopped: true
desktopExitCode: 0
```

真实 Canary 使用 Desktop 安装到仓库外的 Vetta CLI，覆盖首次会话、继续、ask-user、Scheduler、
Batch、Desktop 进程重启、会话恢复、MCP Tool Loop 和最终资源清理。

## 7. 结论与下一步

本轮完成了“manager 编排”与“server 连接基础设施”的分离。coding-agent 现在只通过 Factory 使用
runtime-mcp client，且继续拥有产品 OAuth 适配和旧 manager。

下一阶段应建立 `McpOAuthStateStore` Port，冻结 token 文件、redirect、client information、PKCE、
discovery state 和 invalidate 行为，再把 SDK OAuth Provider 迁入 runtime-mcp。打开浏览器、localhost
callback 页面和 Device Flow 的用户交互仍属于宿主适配器，不应与 credential store 或 HTTP client
重新耦合。完成 OAuth 差分门禁后，才评估迁移 `McpManager`。
