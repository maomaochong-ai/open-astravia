# 第 103 轮：MCP Server Supervisor 与 Manager 兼容适配层

## 1. 目标

第 99 至 102 轮已经把 MCP 协议、配置 Source、Client/Transport、OAuth Store/Provider 和交互式
OAuth 用例迁入 `@vetta/runtime-mcp`，但 `coding-agent` 的 `McpManager` 仍拥有约 700 行通用运行时逻辑：

- Server 初始化、状态转换和 Tool/Resource discovery；
- 静态配置与插件配置的覆盖；
- 签名判等和差量 reconcile；
- restart、enable、disable、shutdown；
- 运行状态、统计和查询；
- 产品 OAuth、插件策略和旧 `AgentTool` 投影。

本轮把前五类通用职责迁入独立 Runtime Server Supervisor。`McpManager` 不删除，也不改变公开方法；
它收缩为 Coding Agent 产品兼容适配层。

## 2. 改造前行为基线

先扩展 `mcp-manager-behavior.test.ts`，并在旧 Manager 实现上运行 9 项测试全部通过。基线覆盖：

- ready、error、`needs_auth` 和 disabled 初始化状态；
- Tool/Resource discovery 单项失败不影响 Server ready；
- 未变化配置保留 Client，新增/修改/删除配置最小协调；
- 配置解析失败保留当前运行状态；
- 插件 Server 动态增加、替换、删除和 reload 后保留；
- `getTools`、状态分组、统计、autoApprove 和只读状态投影；
- Server enable/disable；
- Browser/Device OAuth 参数、登录后重连、logout 清理和状态转换；
- 全局 enabled 开关与 shutdown。

同一测试在迁移后继续只调用旧 `McpManager` API，作为功能未重构的兼容门禁。

## 3. Runtime Server 合同

`runtime-mcp/src/server/` 新增窄合同：

```ts
interface McpServerView {
  readonly name: string;
  readonly config: McpServerConfig;
  readonly status: McpServerStatus;
  readonly tools: readonly McpTool[];
  readonly resources: readonly McpResource[];
  readonly startedAt?: number;
}

interface McpServerBinding {
  readonly view: McpServerView;
  readonly client?: McpClientHandle;
}
```

`View` 是观察投影，`Binding` 只供需要实际调用 Tool 的宿主适配器使用。Runtime 使用 epoch
millisecond 表示 `startedAt`，不把旧 Manager 的 `Date` 对象写入核心合同；兼容层投影旧 API 时再恢复
`Date`。

动态能力源通过完整替换集合接入：

```ts
interface McpDynamicServerSet {
  readonly servers: ReadonlyMap<string, McpServerConfig>;
  readonly signature: string;
}
```

它不是 Turn 快照，也不会因单项变化复制 Client。签名相同且配置等价时零副作用；发生变化时仅停止、
启动或重启差异 Server，未变化 Server 和 Client 保持原实例。

## 4. McpServerSupervisor

`McpServerSupervisor` 现在拥有：

- 通过 `McpConfigSource` 加载全局、项目和合并配置；
- 通过 `RuntimeMcpClientFactory` 创建 stdio/HTTP Client；
- 并行初始化 Server；
- 根据 Server capabilities 发现 Tool/Resource；
- 将认证错误投影为 `needs_auth`，将其他启动错误隔离为 `error`；
- 文件配置与动态配置的覆盖、组合签名和差量 reconcile；
- restart、disconnect、enable、disable、reload、shutdown；
- Server View/Binding、状态和统计查询。

Supervisor 不导入 Coding Agent，不解析产品目录，不打开浏览器，不包含 GitHub/Vetta 策略，也不生成
`AgentTool`。认证错误识别、配置 Source、Client Factory 和 diagnostic sink 均通过显式依赖注入。

## 5. Coding Agent 兼容适配层

`McpManager` 从约 700 行缩减为 284 行，保留原类名、工厂和公开方法。它只负责：

- 选择 `McpConfigLoader`、agentDir 和带产品 OAuth Provider 的 Client Factory；
- 调用原 Browser/Device 登录入口并在成功后请求 Supervisor 重连；
- 清理原 OAuth 文件并决定 logout 后是 `needs_auth` 还是 `stopped`；
- 校验插件 runtimeName、计算插件集合 fingerprint；
- 把 MCP Tool 适配为既有 `AgentTool`；
- 把 Runtime View/Binding 投影为原 `McpServerInstance`、`McpManagerState` 和统计 API。

原 `McpManagerOptions.clientFactory` 仍可接收 `agentDir`，兼容测试和产品 HTTP OAuth Client；Runtime
Supervisor 不知道该产品参数，由 Manager 创建的闭包补入。

## 6. 保留的功能语义

本轮明确保持：

- disabled Server 初始化时不进入活动集合；
- 一个 Server 启动失败不阻断其他 Server；
- Tool 或 Resource 列举失败仍可进入 ready；
- 配置未变化不重建 Client；
- 配置读取失败保留当前状态；
- 插件配置覆盖同名文件配置，reload 不丢失插件集合；
- login 关闭旧 Client 后重连，logout 清空 Client/Tool/Resource/ServerInfo；
- `getTools()` 仍只发布 ready 且具有 Client 的 Tool；
- debug 日志前缀、插件错误日志和 autoApprove 规则保持；
- 旧导出路径、配置文件、OAuth 文件、Tool 名称和 Tool 执行结果不变。

Manager 的状态查询现在由 Runtime 观察投影生成；调用者仍得到新的 Map 和旧协议对象，不获得
Supervisor 的内部可变 Map。

## 7. TypeBox / Zod 判断

本轮没有新增外部不可信数据解析边界。Server Config 已在第 99 轮通过 TypeBox 校验，OAuth 网络响应
已在第 102 轮通过 TypeBox 校验；Supervisor 接收的都是这些边界之后的强类型对象。因此没有为了形式
统一再次引入 TypeBox 或 Zod。若后续引入外部持久化 Server 状态或跨进程 Server 控制 Frame，应在该
入口增加 Schema，而不是在内部生命周期方法重复校验。

## 8. 测试与验证

```text
改造前 McpManager 行为基线：1 file, 9 tests passed
改造后 McpManager 同一兼容门禁：1 file, 9 tests passed
Runtime Supervisor 独立测试：1 file, 4 tests passed
runtime-mcp 完整套件：9 files, 33 tests passed
coding-agent MCP 相关套件：7 files, 40 tests passed
bun run check:quick: passed
bun run check: passed
installed standalone Vetta CLI artifact: 1 test passed
```

Runtime 独立测试覆盖失败隔离、discovery 降级、状态统计、文件差量 reconcile、无效配置保留、动态
集合替换、reload 保留和显式生命周期操作。Coding Agent MCP 套件覆盖 Manager、配置、stdio Client、
OAuth、交互式 OAuth、插件和 Greenfield 适配器。

额外运行了 coding-agent 全包测试以检查旁路影响；结果为 73 个文件通过、14 个文件失败，879 项通过、
80 项失败、45 项跳过。失败集中在当前 Windows 环境的 Shell/路径断言、缺失内置模型数据、资源发现、
会话测试 mock 和既有测试隔离，并未指向本轮 MCP 文件。由于这些不是本轮引入且根级完整 Biome、
monorepo tsgo、CLI、Desktop、Admin 和 guards 全部通过，本轮没有越界修改这些模块；MCP 定向套件保持
40/40 通过。

## 9. 实施过程中的修正

第一次 `check:quick` 只发现 Biome import 排序和格式问题；对本轮明确文件执行 Biome 自动格式化后，
第二次 `check:quick` 通过。完整 `bun run check` 随后一次通过，没有通过放宽类型、`any`、内联类型
import 或跳过子项目检查绕过门禁。

独立安装态测试使用仓库已有 Vetta CLI 构建和两个可执行进程完成同一 Conversation 的创建与恢复，
验证新增 `runtime-mcp/server` 导出进入真实依赖闭包，而不只在 Vitest 源码 alias 下工作。

## 10. 结果与下一步

通用 MCP Server 生命周期已经不再属于 Coding Agent 产品类。当前剩余的 Greenfield 绕行是 CLI 和
Desktop 仍通过 `createLegacyMcpManagerRuntimeToolSource` 获取 Runtime Tool Source。

下一阶段应实现 Runtime-native MCP Tool Source：直接读取 `McpServerSupervisor` 的 ready bindings，
按现有名称、参数、结果和 fingerprint 语义生成 Runtime Tool Binding；再提供 Coding Agent 产品工厂
注入 config path 与 OAuth Client，逐个把 Greenfield CLI/Desktop Composition Root 从 Legacy Manager
Source 切到新 Source。旧 Manager 和旧 Adapter 在 Legacy 会话仍保留，切换前后使用同一 Tool 差分与
安装态门禁验证，不能在该阶段修改 Tool 功能、OAuth UI 或配置格式。
