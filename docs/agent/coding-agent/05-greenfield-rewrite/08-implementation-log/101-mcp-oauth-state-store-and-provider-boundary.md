# 第 101 轮：MCP OAuth State Store 与 SDK Provider 边界

## 1. 目标

第 100 轮已经将 MCP Client、stdio 子进程和 HTTP SDK Transport 迁入
`@vetta/runtime-mcp`，但 OAuth SDK Provider 仍直接依赖 coding-agent 的文件函数和
`getAgentDir()`。这使通用 OAuth 状态机无法独立组合或使用内存 Store 测试。

本轮目标是拆分三类职责：

- runtime-mcp 拥有 OAuth 状态合同、Store Port、显式目录文件适配器和 SDK Provider；
- coding-agent 继续决定 Vetta Agent 数据目录，并保留全部旧导出；
- 浏览器、localhost callback、Device Flow、Manager 和 Desktop IPC 保持不动。

## 2. 迁移前行为基线

在修改生产实现前新增 coding-agent OAuth 兼容测试，并先对旧实现运行通过。基线覆盖：

- server name 清理规则、`mcp-auth` 目录和 JSON 文件名；
- pretty JSON、结尾换行和 `updatedAt`；
- 缺失、损坏或缺少 `serverUrl` 的状态返回 `undefined`；
- access token 和历史 refresh-token-only 文件的认证检测；
- placeholder redirect 保留已注册 redirect、client information 和 tokens；
- server URL 变化时建立新绑定；
- 交互式 redirect 变化时清理 DCR client/discovery，但保留 tokens；
- pre-registered client ID 重新注入；
- refresh token 轮换兼容、PKCE verifier 和 discovery state；
- 五种 credential invalidate scope；
- `FileMcpOAuthProvider` 的兼容类名。

首次运行有一项测试错误地使用了不同的 server URL，触发了既有“新绑定重置”行为。该问题属于
fixture 输入错误，修正为相同 URL 后，旧实现 5 项基线全部通过，生产代码未为测试改变。

## 3. Runtime OAuth 合同

runtime-mcp 新增 `auth/` 目录：

```text
auth/
  oauth-state.ts
  oauth-state-store.ts
  oauth-provider.ts
  index.ts
```

`McpOAuthStateStore` 是同步 Port：

```ts
interface McpOAuthStateStore {
  load(serverName: string): McpOAuthStoredState | undefined;
  save(serverName: string, state: McpOAuthStoredState): void;
  clear(serverName: string): void;
  hasTokens(serverName: string): boolean;
}
```

没有为了推测未来远端存储而改成异步接口。当前官方 SDK 的 `tokens()`、
`clientInformation()` 和 discovery 读取允许同步返回，原文件行为也是同步；保持同步可以避免在旧
HTTP 连接路径引入新的时序和错误语义。

## 4. TypeBox 持久化边界

`McpOAuthStoredStateSchema` 只在文件读取边界校验不可信 JSON：

- `serverUrl` 必须存在且为字符串；
- client information、tokens、PKCE、discovery、redirect 和 timestamp 校验各自结构；
- OAuth 对象允许额外字段，避免阻止 SDK 或服务端扩展；
- token schema 保留 refresh-token-only 文件兼容；
- JSON 损坏或 Schema 不匹配继续返回 `undefined`，不向旧调用方抛出新异常。

Provider 和内存 Store 接收已经类型化的状态，不重复执行 TypeBox 校验。

## 5. 显式目录文件适配器

`FileMcpOAuthStateStore` 只接受显式 `authDirectory`，不导入 coding-agent，也不调用
`getAgentDir()`。它保留原有：

- server name 清理规则；
- 同步 load/save/clear；
- 目录递归创建；
- `updatedAt` 写入；
- pretty JSON 与结尾换行；
- access/refresh token 检测。

产品层仍负责把 `<agentDir>/mcp-auth` 作为目录传入，因此 runtime-mcp 没有获得 Vetta 用户目录策略。

## 6. SDK Provider 迁移

`McpOAuthProvider` 迁入 runtime-mcp，并只依赖注入的 `McpOAuthStateStore`。以下既有状态机行为保持
不变：

- server URL 重新绑定；
- placeholder/interactive redirect 的不同处理；
- DCR 与 pre-registered client ID；
- client information、tokens、PKCE 和 discovery 的保存；
- refresh token 保留；
- credential scope 失效；
- authorization redirect 回调委托。

审计中发现最初迁移版本在 runtime Provider 内保留了默认客户端名 `Vetta`。这会造成产品身份反向
渗入通用包，因此改为要求显式 `clientName`。coding-agent 兼容包装继续默认传入 `Vetta`，旧行为不变。

## 7. Coding Agent 兼容层

coding-agent 保留原文件和导出：

- `McpOAuthStoredState`；
- `getMcpAuthDir` / `getMcpAuthPath`；
- `loadMcpOAuthState` / `saveMcpOAuthState`；
- `clearMcpOAuthState` / `hasMcpOAuthTokens`；
- `FileMcpOAuthProvider` 与原 Options。

自由函数现在创建显式目录 Store 并委托。`FileMcpOAuthProvider` 继续使用同名兼容继承类，负责解析
默认 `getAgentDir()`、注入 `<agentDir>/mcp-auth` 和默认客户端名。HTTP Client、OAuth Flow、Device
Flow、Manager 及 Desktop 调用方不需要修改导入或参数。

runtime-mcp 同时新增 `./auth` package export，根入口也继续导出这些合同。

## 8. 明确未修改

- 未修改 token 文件目录、文件名、JSON 格式或明文存储策略；
- 未新增加密、锁、远端 Store、异步 Store、重试或缓存；
- 未修改浏览器打开、localhost callback、授权完成和诊断请求；
- 未修改 Device Flow endpoint discovery、轮询或用户页面；
- 未修改 Manager 登录、登出、重连和 `needs_auth` 状态；
- 未修改 Desktop IPC、CLI 参数、MCP 配置或 Tool 行为；
- 未迁移 Legacy `McpManager`。

## 9. 测试与验证

迁移前：

```text
coding-agent OAuth compatibility baseline: 1 file passed, 5 tests passed
```

迁移后：

```text
runtime-mcp full suite: 6 files passed, 21 tests passed
coding-agent MCP compatibility: 5 files passed, 26 tests passed
bun run check:quick: passed
bun run check: passed
installed standalone CLI artifact: 1 test passed
```

完整检查覆盖 Biome、monorepo `tsgo`、CLI 独立类型检查、Desktop `tsc`、Admin `tsc -b`、包边界、
构建顺序和 standalone CLI build guard。安装态测试使用仓库已有 Vetta CLI，在两个独立可执行进程间
创建并恢复同一会话，验证新增 runtime-mcp export 已进入实际产物。

## 10. 结果与下一步

本轮完成了 OAuth SDK 状态机与产品路径的分离：runtime-mcp Provider 可以使用内存 Store 独立测试，
文件适配器只知道调用方传入的目录，coding-agent 只保留产品路径和兼容 API。

下一阶段应处理“交互式授权编排与宿主副作用”边界，先冻结 Browser Flow 和 Device Flow 行为，再定义
浏览器打开、本地 callback server、网络请求和轮询等待 Port。工作流可以迁移到独立编排层，但操作系统
浏览器、HTTP server 和产品页面仍应留在宿主适配器。不要在同一阶段迁移 Manager。
