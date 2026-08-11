# 第 99 轮：MCP 协议合同与配置 Source 边界

## 1. 目标

第 98 轮已经把模型调用侧的 MCP Feature 从旧 `McpManager` 中分离，但协议类型、`mcp.json`
解析和文件发现仍位于 `coding-agent/core/mcp`。这使独立 Runtime Port 仍需通过旧包取得基础合同，也让
配置解析、产品路径、网络传输、OAuth 和生命周期管理继续混在同一目录中。

本轮只处理可独立验证的第一层边界：

- `runtime-mcp` 拥有传输无关的 MCP 协议与配置合同；
- 不可信 `mcp.json` 通过 TypeBox 校验；
- 通用文件配置 Source 不知道 Vetta 的产品目录约定；
- coding-agent 保留旧入口和默认路径行为；
- `McpManager` 只增加配置 Source 与 Client Factory 两个测试接缝；
- 用行为基线证明迁移前后功能没有变化。

## 2. 边界结论

本轮后的依赖关系是：

```text
runtime-mcp
  -> protocol contracts
  -> TypeBox config parser
  -> generic file config source
  -> model-call MCP feature

coding-agent/core/mcp
  -> Vetta global/project path compatibility wrapper
  -> stdio and HTTP clients
  -> OAuth flows and token storage
  -> legacy McpManager

runtime-composition
  -> runtime-mcp model-call feature
```

协议类型属于 Runtime Feature 的稳定边界；文件配置 Source 是基础设施适配器，不是 Runtime Core。
它可以放在 `runtime-mcp/config`，但必须通过显式路径和环境参数工作，不能知道 `~/.vetta`、
项目 `.vetta` 或 Desktop 配置目录。产品路径选择仍由 coding-agent 兼容适配器和宿主负责。

## 3. 实施内容

### 3.1 独立协议合同

新增 `runtime-mcp/src/protocol`，承接原 `coding-agent/core/mcp/types.ts` 中传输无关的合同：

- stdio/HTTP server 配置；
- JSON-RPC、初始化、Tool、Resource、Prompt 与 Content 类型；
- `IMcpClient`、server instance、status 和 manager state 合同；
- stdio/HTTP 配置判别函数。

类型中的开放 JSON 值改用 `unknown` 和显式 JSON Object，不新增 `any`。coding-agent 原类型文件变为
兼容 re-export，因此既有内部和下游导入无需同步改写，运行时也没有新增逻辑。

`@vetta/runtime-mcp` 同时增加根入口、`./protocol` 和 `./config` 导出，独立构建产物包含这些合同。

### 3.2 TypeBox 配置解析

新增 `runtime-mcp/src/config/schemas.ts`：

- 用 TypeBox 描述 stdio、HTTP 和顶层 MCP 配置；
- 用 `Value.Check` 校验磁盘 JSON；
- 保留旧实现已接受的开放字段和宽松数组/映射范围；
- 保留既有字段级错误文案，避免把架构迁移变成配置兼容性变化。

TypeBox 只用于跨越不可信 JSON 边界。manager 内部已经是已校验 TypeScript 对象，不重复做 Schema
校验，也没有把 TypeBox 扩散到连接或工具执行路径。

### 3.3 通用文件配置 Source

新增 `FileMcpConfigSource` 和 `McpConfigSource`：

- 显式接收 global/project 配置路径、project root 和可选环境变量；
- 保留“项目字段浅覆盖全局字段”的合并规则；
- 保留 `${PROJECT_ROOT}` 和环境变量替换，未解析变量保持原值；
- 保留基于 mtime 与内容 SHA-1 的组合签名；
- 保留文件缺失返回 `null`、两处都缺失返回空 server 集合和路径化错误信息。

coding-agent 的 `McpConfigLoader` 现在只是兼容包装器，继续使用 `getAgentDir()`、
`CONFIG_DIR_NAME` 和原有默认路径。`loadMcpConfig()` 的公开行为不变。

### 3.4 Manager 最小测试接缝

`McpManagerOptions` 新增两个可选依赖：

- `configSource`：提供配置加载、签名和路径；
- `clientFactory`：根据 server 配置创建既有 client handle。

生产默认值仍是旧 `McpConfigLoader` 与旧 `createMcpClient`。manager 的初始化、差分重载、插件
reconcile、认证状态、Tool 适配和释放逻辑均未重写。接缝只用于在不启动真实子进程或网络连接时冻结
现有行为，也为后续迁移具体 client 提供明确切点。

## 4. 行为基线

迁移前先新增并运行 8 项配置兼容测试，确认旧实现基线通过；迁移后用同一组测试再次验证。最终差分
审计又补充空 `command` 和空 HTTP `url` 两项旧行为，当前共 10 项。覆盖：

- 配置文件缺失与路径返回；
- global/project 浅合并；
- project root 和环境变量替换；
- 七类既有校验失败；
- 内容变化与稳定签名。

新增 5 项 manager 行为测试，覆盖：

- ready、error、needs-auth 和 disabled server 的并行隔离；
- 未变化 server 保留 client，新增/修改/删除仅影响对应 server；
- 新配置加载失败时保留当前运行集合；
- plugin 顺序变化不触发 reconcile，真实变化才重建；
- 单个 client 关闭失败不阻断其余释放和状态清理。

新增 4 项 runtime-mcp 文件配置测试，覆盖显式基础设施参数、浅合并、TypeBox 入口和内容签名。

差分审计发现普通 `Type.String()` 会接受旧校验拒绝的空 `command`/`url`。Schema 已使用
`minLength: 1` 恢复旧行为，并由新增测试锁定；没有以“更合理”为由改变既有配置语义。

全仓检查首次发现测试辅助代码使用当前 TS target 未提供的 `Array.findLast`。该实现已改为兼容的
反向查找，并重新运行全部门禁；未通过降低 TypeScript target 或跳过类型检查来规避问题。

## 5. 明确未修改

- 未修改 `mcp.json` 字段、默认路径、合并优先级、变量替换或错误语义；
- 未修改 stdio 子进程、HTTP 请求、超时、重连和 MCP SDK 调用；
- 未修改 OAuth browser/device flow、token 格式、存储位置和登录/退出行为；
- 未迁移、删除或重写旧 `McpManager`；
- 未修改 MCP 工具名称、描述、参数 Schema、执行结果或自动批准逻辑；
- 未修改模型调用级刷新、渐进披露、Session 状态或持久化格式；
- 未把 Desktop、CLI 或 IM 的产品路径选择下沉到 `runtime-mcp`。

## 6. 测试与验证

定向测试：

```text
runtime-mcp: 3 files passed, 10 tests passed
coding-agent MCP: 4 files passed, 22 tests passed
CLI Greenfield integration: 3 files passed, 19 tests passed
```

完整质量门禁：

```text
bun run check:quick: 通过
bun run check: 通过
```

完整检查覆盖 Biome、monorepo `tsgo`、CLI 独立类型检查、Desktop 独立 `tsc`、Admin `tsc -b`、
包边界、构建顺序、私钥和冲突标记守卫。

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

真实 Canary 继续使用 Desktop 安装到仓库外的 Vetta CLI 完成会话创建和继续，并覆盖 Desktop
进程重启、会话恢复、Scheduler、Batch、动态 MCP Tool Loop 与最终清理。

## 7. 结论与下一步

本轮把“协议和配置数据是什么”“从哪些文件取得配置”“怎样连接 server”“怎样管理 server
生命周期”拆成了可分别验证的边界。`runtime-mcp` 现在拥有协议与通用配置基础设施，coding-agent
只保留产品路径兼容包装和旧具体实现。

下一阶段不应直接搬迁整个 `McpManager`。应先为 stdio client、HTTP client、HTTP 错误、初始化超时、
资源/Prompt 调用和关闭行为补齐差分基线，再把 client 创建与传输实现迁入独立基础设施目录；OAuth
存储路径和打开浏览器等宿主能力继续通过 Port 注入。只有传输与认证边界稳定后，才迁移 manager
编排并删除 coding-agent 中对应兼容实现。
