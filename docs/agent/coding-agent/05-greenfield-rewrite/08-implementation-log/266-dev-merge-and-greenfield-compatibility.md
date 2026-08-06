# 第 266 阶段：合并 dev 并保持 Greenfield 功能兼容

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

本阶段把 `origin/dev` 的产品增量合并到 Greenfield 重写分支。冲突处理原则是保留 `dev` 新增的用户可观察行为，同时把实现放入既定 Runtime、MCP、Storage 和 Coding Agent Composition 边界；不恢复已删除的旧 `packages/coding-agent/src/core`，也不以兼容包装延续旧执行架构。

## 合并前分析

- `dev` 与重写分支共同修改 Agent 循环、Runtime Host、MCP、会话锁、Desktop 组合根和质量守卫，直接接受任一侧会导致功能或架构回退。
- `dev` 新增的动态工具/提示词、文本工具调用修复、失败重试、活动工具事件、内置 MCP 动态凭据和 PID 复用检测属于需要保留的功能语义。
- `dev` 中仍指向旧 `coding-agent/src/core` 的实现和测试不能直接合入；相同行为需要由新包合同和 Greenfield Composition 提供。
- 合并后的成功标准是：冲突清零、旧实现指标继续为零、定向行为测试通过，并重新通过根检查与 CLI/Desktop/IM 宿主验收。

## 实施内容

- Agent Profile 与 Runtime Snapshot 增加 `salvageTextToolCalls` 合同，由 Feature Compiler 传入 Agent Core；Coding Agent 产品组合启用 `progress`、`todo`，保留模型以文本 JSON 发出工具调用时的旧功能表现。
- Runtime Session 观察合同增加 `retry.start`、`retry.end` 和 `active_tools_update`；事件适配保持纯映射，产品重试策略不进入 Runtime Core。
- Coding Agent Composition 新增 Greenfield Runtime Host 重试装饰器：仅重试瞬态模型失败，在重试结束前延迟最终错误事件，并保持取消和资源释放语义。
- Runtime Host 在活动插件变化后以空闲防抖重新应用动态工具，等待正在进行的更新后再开始 Prompt，并向宿主发出可回放的活动工具更新事件。
- Runtime MCP 承担 HTTP Session、动态 Header、内置 MCP 和凭据解析；Coding Agent 只注入产品版本与产品级服务器配置，未恢复旧 MCP Manager。
- 内置 MCP 凭据读取绑定到当前 Runtime 的显式 `agentDir`；Session-local Plugin MCP 不重复注入产品内置服务器，测试 Runtime 也不会读取用户真实登录态或发出意外网络请求。
- Runtime Storage 增加跨平台进程身份读取，以进程启动时间识别 PID 复用；Coding Agent 旧会话格式租约复用该通用能力，不复制锁实现。
- Desktop 模型凭据同步会删除失效覆盖项，主进程保留 shutdown、batch、OAuth 与 debug 组合语义；具体凭据存储仍由 Desktop Host Adapter 提供。
- Tool Search 保留已激活工具直接调用提示，工具实现继续归属 `runtime-tools`，没有迁回 `coding-agent`。
- 删除冲突中出现的旧 `coding-agent/src/core/mcp`、model registry、SDK、session lock、input pipeline、retry controller、runtime manager 和旧 Tool 描述实现。

## 架构归属

| 行为 | 最终归属 | 原因 |
| --- | --- | --- |
| Agent 最小工具调用闭环 | `agent` / `runtime-core` 合同 | 与产品宿主无关 |
| Tool 实现与描述 | `runtime-tools` | Tool 域独立于 Coding Agent 组合根 |
| MCP 传输、认证与监督 | `runtime-mcp` | 避免 Coding Agent 重新成为基础设施集合 |
| 会话锁与进程身份 | `runtime-storage` | 属于通用持久化并发语义 |
| 产品重试与内置 MCP 装配 | `coding-agent/composition` | 属于产品策略和能力编排 |
| 凭据持久化与进程生命周期 | Desktop Host Adapter | 属于宿主环境能力 |

## 旧实现依赖变化

- 旧 `coding-agent/src/core` 文件保持删除，没有因解决冲突而恢复。
- `runtime-core`、`runtime-mcp`、`runtime-storage` 和 `runtime-tools` 不依赖 Coding Agent 具体实现。
- `dev` 中依赖旧 MCP、重试和会话锁实现的测试已改为验证对应 Runtime 公共合同。
- 质量守卫继续报告旧实现生产边、测试边、Runtime 反向依赖、兼容导出和旧文件均为 `0/0`。

## TypeBox / Zod 判断

本阶段没有新增 TypeBox 或 Zod。动态 Header、Runtime 观察事件和重试配置均为进程内可信类型合同；MCP 外部配置继续使用既有解析边界。为这些内部对象增加运行时 Schema 会重复现有职责，不能改善本次合并的边界安全。后续若新增不可信 JSON 配置或跨进程协议字段，应在其入口使用项目既有 Schema 方案校验。

## 行为兼容性验证

- Runtime Core 定向测试通过：Session 事件映射和 Agent Core Turn Engine 共 17 个测试。
- CLI Greenfield Runtime Host Backend 集成测试通过：3 个测试，覆盖首次模型请求返回 503 后重试成功、标准重试事件和最终错误抑制。
- Coding Agent MCP、动态 Header、凭据和 Tool Search 定向测试通过：32 个测试。
- Runtime Storage ownership lease 测试通过：5 个测试，覆盖 PID 复用。
- `bun run check:quick` 已通过；架构守卫报告旧实现生产边、旧测试边、Runtime 反向依赖和旧文件均为 `0/0`。
- 首次根检查发现 `dev` 合入后的 Plugin SDK 子路径映射和 Admin 路由树生成问题；已补充源码 path mapping，并通过标准路由生成器更新 `routeTree.gen.ts`。根类型检查和 Admin 检查随后分别通过。
- Desktop 全量验收发现 Plugin SDK manifest 测试解析到陈旧 `dist`、快捷键目录缺少 `save-file` 预期、Windows 执行 Unix 符号链接测试及 Greenfield 事件基线缺少 `active_tools_update`；均按当前产品合同修正，没有改变功能实现。
- 最终 `bun run verify:agent-hosts` 完整通过：独立 CLI 编译与 IM 真实子进程通过；Coding Agent 131 个文件通过、1 个跳过，916 个测试通过、17 个跳过；CLI 34 个文件、186 个测试通过；Desktop 121 个文件通过，511 个测试通过、1 个平台不适用测试跳过。
- 最终根 `bun run check` 通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 合并收尾结果

- 最终根检查和跨宿主验收均通过，冲突已全部解决。
- 架构守卫保持旧实现生产边、测试边、Runtime 反向依赖、兼容导出和旧文件为 `0/0`。
- 合并提交只纳入本次已分析和验证的 `dev` 合并结果；不推送远端，除非用户另行要求。

## 尚未完成的替换

- 没有待恢复或待迁移的旧执行实现；本阶段没有遗留的功能替换工作。
- 后续 `dev` 功能增量仍需遵循相同规则：保留外部行为，把实现放入对应独立域，禁止重新引入旧 `coding-agent/src/core`。
