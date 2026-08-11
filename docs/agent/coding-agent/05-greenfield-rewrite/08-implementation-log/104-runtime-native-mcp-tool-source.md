# 第 104 轮：Runtime-native MCP Tool Source 与 Greenfield 宿主切换

## 1. 目标

第 103 轮已将通用 MCP Server 生命周期迁入 `@vetta/runtime-mcp`，但 Greenfield CLI 和 Desktop
仍通过以下绕行获得 Runtime Tool：

```text
Greenfield 宿主 -> Legacy McpManager -> AgentTool -> Legacy Runtime Adapter -> RuntimeTool
```

本轮只重构架构，不重构 MCP 功能。目标路径是：

```text
Greenfield 宿主 -> Coding 产品工厂 -> McpServerSupervisor
               -> Runtime-native MCP Tool Source -> RuntimeTool
```

旧会话仍保留：

```text
Legacy Session -> McpManager -> AgentTool
```

## 2. 改造前行为基线

迁移前先在旧 `AgentTool` 适配器上建立 3 项行为测试，冻结：

- 对象、字符串枚举、整数、数组、`anyOf`、`oneOf` 和未知类型的 TypeBox 投影；
- Tool 名称、label、description、`ecosystemHook` 来源信息；
- 文本、图片、文本资源、二进制资源和错误结果的精确投影。

基线发现旧实现先创建 `Type.Object`，再把非 required 属性替换为 `Type.Optional`。因此 TypeBox 已生成的
`required` 列表仍包含全部属性。这是既有可观察行为；本轮按“架构重构不改变功能”的要求保留，没有顺手
修正 Schema 语义。后续若要修复，必须作为独立功能变更并提供迁移说明。

## 3. Runtime-native Tool 与 Source

`runtime-mcp/src/tools/` 新增三个独立模块：

- `mcp-runtime-tool.ts`：MCP JSON Schema 到 TypeBox 的投影，以及 MCP 调用结果到
  `RuntimeToolResult` 的投影；
- `server-runtime-tool-source.ts`：读取 Supervisor ready bindings，直接发布 Runtime Tool；
- `index.ts`：该职责的公开导出面。

Source 只依赖窄端口：

```ts
interface McpServerRuntimePort {
  reloadIfChanged(): Promise<boolean>;
  getReadyServerBindings(): readonly McpServerBinding[];
}
```

它不知道配置路径、OAuth 产品策略、Coding Agent、Desktop 或 CLI。Source 每次刷新从 ready binding
物化当前 Tool，并继续使用既有 fingerprint：Server 名、状态、启动时间和 Tool 定义共同决定绑定身份。
未变化项由既有 Runtime 同步器保留；单项新增、变化和删除只更新对应绑定，不会整体重建 Server Client。

Tool 描述仍由 MCP Server 返回的 Tool 定义生成，没有改成文本文件或引入新的描述协议。

## 4. TypeBox / Zod 判断

MCP Tool 的 `inputSchema` 是外部协议数据，需要转换成模型可消费的 Runtime Schema，因此继续使用项目
既有 TypeBox。实现共享同一个 Schema 转换函数，旧 `AgentTool` 和新 `RuntimeTool` 不再各自维护一份逻辑。

本轮没有引入 Zod：配置入口已由第 99 轮的 TypeBox Schema 校验，Tool Schema 也需要直接产出 TypeBox
对象；再增加 Zod 只会形成重复模型和转换层。

同时移除了旧 Tool Adapter 中的 `any`，没有通过放宽类型绕过 MCP SDK 与 Runtime 合同差异。

## 5. Coding 产品组合边界

新增共享 `mcp-supervisor-composition.ts`，只组合 Coding 产品特有依赖：

- 全局与项目 MCP 配置路径；
- agentDir；
- 产品 OAuth Provider 和交互入口；
- stdio/HTTP MCP Client Factory；
- Runtime Supervisor。

`McpManager` 与新的 Greenfield MCP 工厂都复用该组合。Manager 的公开 options、方法和返回值保持不变，
不向 Greenfield 暴露 Manager；Greenfield 工厂只返回受管理的 Runtime Tool Source 和释放能力。

`ecosystemHook` 的 `hostName`、`kind`、`source.ecosystem`、Server 名和原 Tool 名仍在 Coding 产品适配层
补充，因为这些是 Coding Agent 的产品命名与 Hook 语义，不属于通用 MCP Runtime。

## 6. Greenfield 生产入口切换

以下两个生产 Composition Root 已改用 `createCodingAgentMcpRuntimeToolSource`：

- CLI 的 `greenfield-im-runtime-host.ts`；
- Desktop 主进程的 `runtime.ts`。

`runtime-composition`、Session Backend Pool 和模型调用级刷新合同未改动。旧
`createLegacyMcpManagerRuntimeToolSource`、旧 Adapter 与 `McpManager` 仍保留导出，供 Legacy 会话和外部兼容
调用使用；本轮没有删除公开 API。

## 7. 保留的功能语义

新旧 Tool 路径保持：

- Tool 名称、label、description 和 input Schema 一致；
- 参数原样传给 MCP Client；
- 文本、图片、资源、二进制资源、错误标记和 details 一致；
- ready 状态且存在 Client 的 Server 才发布 Tool；
- 配置变化按 Server 差量重连，配置未变化不重建 Client；
- OAuth Provider、目录、浏览器交互和 debug 诊断策略不变；
- Runtime Registry 仍在模型调用前刷新，运行期间 Tool 的新增、变化和移除继续可见。

本轮还通过同一 Client/Server 的差分测试，直接比较旧 Adapter 与 Runtime-native Source 的 fingerprint、
Tool 元数据、Schema 和执行结果，防止架构切换悄然改变功能。

## 8. 测试与验证

```text
迁移前旧 Tool 行为基线：1 file, 3 tests passed
迁移后同一旧 Tool 兼容门禁：1 file, 3 tests passed
Runtime-native MCP Source 独立测试：1 file, 3 tests passed
runtime-mcp 完整套件：10 files, 36 tests passed
coding-agent MCP 相关套件：9 files, 44 tests passed
CLI Greenfield Host/Composition：2 files, 16 tests passed
Desktop Greenfield Backend Pool：1 file, 6 tests passed
bun run check:quick: passed
bun run check: passed
installed standalone Vetta CLI artifact: 1 test passed
```

独立 Runtime 测试覆盖直接发布、产品 decorator、调用、未变化刷新、重连、删除和精确错误结果。安装态
测试通过仓库已有 Vetta CLI 启动两个独立可执行进程，验证新增导出进入真实产物依赖闭包。

## 9. 实施过程中的修正

- 行为基线揭示旧 optional Schema 的 `required` 列表语义，按兼容要求调整测试并保留实现；
- Runtime 同步测试最初把 Client 重连等同于 descriptor revision 变化；核对既有同步器后改为只在 descriptor
  变化时增加 revision；
- 第一次完整类型检查发现 Runtime 只读 content 与旧 `AgentTool` 可变 content 的方差差异，以及测试 Client
  的返回类型推断过窄；通过边界复制和显式返回类型修正；
- 第二次完整类型检查发现旧 `AgentTool.details` 为必填而 Runtime details 可选；兼容层显式保留该字段后，
  完整检查通过。

没有修改类型检查配置、降低依赖版本、引入 `any` 或跳过 CLI/Desktop/Admin 子项目门禁。

## 10. 结果与下一步

Greenfield MCP 的生产路径已不再依赖 Legacy Manager 或 AgentTool 投影；通用 Tool Schema、调用和同步属于
Runtime，产品 OAuth 与 Hook 命名属于 Coding 产品组合，旧 API 仅作为兼容边界存在。

当前剩余的行为差距是插件 MCP 动态贡献：Legacy Session 通过
`runtime-manager -> McpManager.setPluginServers()` 实时增加、替换和移除插件 Server；第 104 轮切换前后的
Greenfield MCP Source 都尚未接入该链，因此本轮没有造成回退，但 Greenfield 还未达到 Legacy 插件 MCP
能力等价。

下一阶段应先冻结插件贡献的 runtimeName、覆盖优先级、签名判等和增删改行为，再给受管理的 native Source
增加窄的动态配置控制端口，并由 CLI/Desktop 的 workspace/plugin 组合层注入贡献。完成旧新差分和插件启停
测试后，才能评估将 Legacy Adapter 标记为 deprecated；在外部公开 API 使用情况审计前不删除它。
