# 第 227 阶段：原生 Runtime Sandbox Tool 执行边界

## 阶段目标

删除 Sandbox 生产链路中“旧 `AgentTool` → 旧 `ToolDefinition` → Runtime Tool”的往返适配。三平台文件只拥有 OS 隔离命令操作，工具定义、注册元数据和前台命令执行统一由 `runtime-tools` 提供；工作区与 Shell 写权限直接消费 Runtime Host Interaction Port，不改变已有功能和用户可观察语义。

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

Sandbox 是 Greenfield Session 的真实生产执行路径。旧实现此前仍控制 Tool 工厂和 Extension Tool 调用合同，使 Runtime Composition 名义上使用 Runtime Tool，实际却依赖旧 Core。此次改造删除这一生产依赖，而不是移动或包装旧代码：`runtime-tools` 拥有工具合同和通用执行器，`coding-agent` 只组合宿主路径策略、权限交互和平台隔离操作，符合能力编排边界。

## 实施内容

- `sandbox-tool-utils.ts` 改为泛型 `RuntimeToolDefinition` guard，并直接使用 `RuntimeSessionHostInteractionContext` 完成三态权限询问。
- 使用原生 `createReadToolRegistration`、`createWriteToolRegistration`、`createEditToolRegistration` 与平台对应的 Bash/Shell Registration。
- 命令统一接入 `createForegroundCommandToolExecutor`，保留环境、受保护目录、取消、超时、输出更新、截断和错误处理。
- Linux Bubblewrap、macOS Seatbelt、Windows Sandbox Host 文件只保留各自 `ForegroundCommandOperations` 实现。
- 增加窄 `commandOperations` 注入端口，使三平台合同可在任意 CI 平台验证；生产默认仍选择真实 OS Sandbox 实现。
- 删除 Greenfield Sandbox Adapter 中的旧 Tool 转换和伪造 `ExtensionContext`。

## 旧实现依赖变化

| 指标 | 第 226 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 213 | 204 | 0 |
| Extension 域旧依赖 | 32 | 26 | 0 |
| Tool 域旧依赖 | 27 | 24 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 182 | 182 | 0 |

本阶段删除 9 条生产依赖：三个平台注册文件各自到旧 Tool/Extension 的 6 条边、共享 Sandbox 文件到旧 Extension 的 2 条边，以及 Greenfield Sandbox Adapter 到旧 Extension 的 1 条边。

## 行为兼容性验证

- 新增 6 项 Sandbox Runtime 合同测试：三平台工具面、Runtime Host 权限路由、Session 授权缓存、拒绝错误、Shell 临时授权、timeout/signal/output 透传。
- CLI Session Execution Composition 既有 3 项测试通过，验证 full-access/sandbox 动态切换、工具注册面、动态撤销和后台任务隔离。
- Runtime 原生 `read`/`write`/`edit` 合同共 54 项通过。
- Runtime 原生命令合同 11 项通过，覆盖真实前台命令、更新、取消、超时、错误、路径修正、输出截断和受保护目录检查。

针对性测试：

```text
packages/coding-agent: greenfield-sandbox-runtime-tools.test.ts — 6 passed
packages/cli-app: greenfield-session-execution-runtime.test.ts — 3 passed
packages/runtime-tools: read/write/edit runtime contracts — 54 passed
packages/runtime-tools: command-runtime-contract.test.ts — 11 passed
bun run check:quick — passed
bun run check — passed（Biome、monorepo/CLI/Desktop/Admin 类型检查与全部 guards）
```

## 尚未完成的替换

- 仍有 204 条生产代码到旧实现的精确依赖，目标为零。
- Tool 域剩余 24 条依赖，包含路径策略与其他尚未迁移的产品工具；本阶段没有为降低统计而顺带改变这些能力。
- Extension 域剩余 26 条依赖，需按事件、资源与宿主动作合同继续替换。
- 旧实现文件仍为 182 个；只有对应行为具备独立合同和生产替代后才能删除。
- 唯一旧 SDK 示例以及 3 条旧格式边界到旧实现的依赖仍未归零。
