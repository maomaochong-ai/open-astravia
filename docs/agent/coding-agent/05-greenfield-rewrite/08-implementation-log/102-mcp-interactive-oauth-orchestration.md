# 第 102 轮：MCP 交互式 OAuth 编排与宿主端口

## 1. 目标

第 101 轮完成 OAuth State Store 与 SDK Provider 解耦，但 Browser Flow 和 Device Flow 仍同时承担：

- OAuth 协议和分支编排；
- 官方 SDK Client/Transport 构造；
- 系统浏览器调用；
- Node localhost HTTP Server 和 HTML；
- GitHub fallback、提示文案和 Vetta 产品身份；
- token 持久化。

本轮把协议与用例编排迁入 `@vetta/runtime-mcp`，把操作系统、页面和产品策略留在
`coding-agent`。Browser Authorization Code 和 RFC 8628 Device Authorization 是两条独立流程，
没有合并成带可选方法的万能 OAuth Service。

## 2. 迁移前行为基线

新增 coding-agent 原路径测试，并先对旧实现运行通过，覆盖：

- Browser Flow 已授权时直接成功；
- Unauthorized 后打开授权 URL、callback 提前到达、`finishAuth` 和二次连接验证；
- 非认证连接错误透传；
- Device protected-resource discovery 和 issuer 末尾斜杠处理；
- 用户码 callback、localhost 页面内容和浏览器打开；
- token/client/placeholder redirect 的原持久化格式；
- discovery 失败后的 GitHub fallback；
- GitHub 422 Device Flow 提示原文。

这些测试迁移后继续只导入 `loginHttpMcpServer`、`loginMcpDeviceFlow` 和旧存储函数，形成兼容门禁。
迁移完成后又在同一原路径门禁补充 callback 授权拒绝和等待超时，验证 Node Callback Adapter 的错误
缓冲与 runtime 编排保持一致。

## 3. Browser OAuth 用例编排

runtime-mcp 新增两个窄合同：

```ts
interface McpOAuthCallbackSession {
  readonly redirectUri: string;
  waitForCode(timeoutMs: number): Promise<string>;
  close(): Promise<void>;
}

interface McpBrowserOAuthSession {
  connect(): Promise<"authorized" | "authorization_required">;
  finishAuthorization(code: string): Promise<void>;
  verify(): Promise<void>;
}
```

`runMcpBrowserOAuthFlow` 只编排：

```text
validate
  -> create callback
  -> create SDK session
  -> connect
  -> authorized: return
  -> authorization_required: open URL -> wait code -> finish -> verify
  -> finally close callback
```

它不导入 Node HTTP、子进程、coding-agent 或产品目录。Callback 可以在授权 URL 打开期间先收到
code，旧 Node Adapter 继续负责缓冲该竞态。

## 4. Browser SDK Session Adapter

`McpBrowserOAuthSdkSession` 隔离官方 SDK：

- 复用原 `StreamableHTTPClientTransport` 和 `Client` 参数；
- 仅把 SDK `UnauthorizedError` 映射为 `authorization_required`；
- 保留已有授权后的 Client close；
- 保留 `finishAuth(code)`；
- 保留授权完成后的新 Transport/Client 二次验证；
- 保留原 request timeout 和空 capabilities。

OAuth diagnostic fetch 同步迁入该 Adapter，继续支持 JSON 与 form-urlencoded error body，并保持
`OAuth authorization failed: ...` 错误语义。

## 5. RFC 8628 Device Flow

`runMcpDeviceAuthorizationFlow` 接受显式依赖：

- `McpOAuthStateStore`；
- `fetchFn`；
- `McpDeviceAuthorizationScheduler`；
- `createPresentation`；
- `openUrl`；
- `fallbackIssuer`。

runtime-mcp 现在负责 discovery、device code 请求、轮询、`authorization_pending`、`slow_down`、超时、
拒绝、token 投影和 Store 保存。Scheduler 的 `now()`/`wait()` 允许测试在零真实等待下验证轮询间隔，
没有引入通用 Clock Framework。

GitHub fallback issuer 仍由 coding-agent 显式传入。HTTP 422 使用结构化
`McpDeviceCodeRequestError` 返回 status/body，coding-agent 兼容层再映射为原 GitHub 提示，因此
runtime-mcp 不包含 GitHub 或 Vetta 文案。

## 6. TypeBox 网络边界

TypeBox 用于三类不可信响应：

- protected resource metadata；
- device code response；
- device token response。

Schema 允许额外字段，并保留历史兼容：`expires_in` 可缺省，继续使用原 900 秒 fallback；无效 discovery
继续走 fallback issuer；无效 device/token payload 保持原错误类型和主要文案。callback query 使用标准
`URL`，JSON/form 混合的 diagnostic error 继续使用专用解析器，没有为了形式统一强套 Schema。

## 7. Coding Agent 宿主适配

原导出保持不变：

- `loginHttpMcpServer` 与 Options/Result；
- `loginMcpDeviceFlow` 与 Options/Result；
- `openUrlInBrowser` 与 `OpenUrlHandler`。

coding-agent 继续拥有：

- `node:child_process` 系统浏览器实现；
- `node:http` Browser Callback Server；
- Browser 成功/失败 HTML；
- Device Code localhost 页面及 HTML escaping；
- Vetta client name/version；
- GitHub fallback、422 指引和页面文案；
- `getAgentDir()` 与 `<agentDir>/mcp-auth` 组合。

`McpManager` 和 Desktop IPC 仍调用原函数，不需要更改导入、参数或认证状态处理。

## 8. 明确未修改

- 未迁移或重写 `McpManager`；
- 未修改 OAuth token 文件路径、JSON 格式或明文存储；
- 未修改 Browser/Device 默认超时和轮询间隔；
- 未修改 callback 地址、页面内容或系统浏览器命令；
- 未新增自动重试、并发登录、取消协议或 token refresh；
- 未修改 Manager 登录后重连、logout 和 `needs_auth` 状态；
- 未修改 Desktop IPC、MCP 配置或 Tool 行为。

## 9. 测试与验证

```text
迁移前 coding-agent interactive OAuth baseline: 1 file, 4 tests passed
迁移后 runtime-mcp full suite: 8 files, 29 tests passed
迁移后 coding-agent MCP compatibility: 6 files, 31 tests passed
bun run check:quick: passed
bun run check: passed
installed standalone Vetta CLI artifact: 1 test passed
```

runtime 独立测试覆盖 Browser 已授权/交互/错误清理、SDK Unauthorized/finish/verify、JSON/form diagnostic
error、Device discovery/fallback、pending/slow_down、TypeBox invalid response、拒绝和 presentation 清理。

第一次完整检查发现新测试有两处严格类型错误：`Array.push()` 的数字返回值不符合 `void` callback，
以及 Vitest Error 泛型断言要求 `message`。修正测试表达后重新执行完整 `bun run check`，根 `tsgo`、CLI、
Desktop、Admin、Biome 和全部 guards 均通过。没有通过降级生产类型绕过门禁。

安装态测试使用实际构建的 Vetta CLI，在两个独立进程间创建并恢复同一会话，验证新 auth 模块进入
产物，而不只是通过 Vitest 源码 alias 工作。

## 10. 结果与下一步

本轮完成交互式 OAuth 协议/用例与宿主副作用的分离。runtime-mcp 可以使用假 Callback、假 SDK
Session、假 Fetch、假 Scheduler 和内存 Store 独立验证；coding-agent 仅保留宿主与产品适配。

下一阶段应冻结并拆分 `McpManager`：先定义独立 Server Lifecycle/State Projection 合同，迁移 server
初始化、差分 reconcile、shutdown 和状态转换；配置 Source、Client Factory、Auth Use Cases 与 Tool
投影均通过现有 Port 注入。Manager 的配置写入、Desktop UI 或新的重连策略不应与该阶段混合。
