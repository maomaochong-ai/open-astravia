# 第 267 阶段：Runtime 独立性与 Composition 公共边界收口

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

本阶段不增加产品能力，而是关闭两个仍可能导致架构回退的边界：第一，Runtime 包的测试和配置不得再依赖 `coding-agent` 的产品实现；第二，`coding-agent` Composition 公共入口只暴露宿主真正消费的稳定组合合同，不继续传播迁移期 `Greenfield` 名称和内部辅助类型。功能实现、协议值、会话数据和宿主选择策略保持不变。

## 分阶段实施

### 阶段一：Runtime 反向依赖归零

- 将 `runtime-tools` 的命令 Host 和路径 Policy 测试 fixture 下沉到该包自己的 `test/support`，不再从 `coding-agent` 测试或源码取实现。
- 删除 `runtime-tools` Vitest 中的 Coding Agent 源码 alias，以及 `runtime-core`、`runtime-storage`、`runtime-tools` manifest 中的 `@vetta/coding-agent` 开发依赖。
- 在 Coding Agent 包内新增真实产品命令 Host 与路径 Policy 的合同测试，确保测试 fixture 独立化没有跳过产品 Adapter 验证。
- 新增常驻独立性守卫，扫描 7 个 Runtime 包的 manifest、源码、测试和配置；任何对 `@vetta/coding-agent` 或其源码路径的依赖都会失败。

### 阶段二：包职责文档校准

- 重写 `coding-agent` README 与 AGENTS，明确它只承担稳定 Session、产品 Composition 和宿主 Adapter。
- 重写 `runtime-tools` README 与 AGENTS，明确 Tool 描述、Schema、执行协议和中立 Host Port 归 Tool 域所有。
- 在 `runtime-core`、`runtime-storage` 和 `runtime-tools` 规则中明确禁止生产、测试、配置和 manifest 反向依赖 Coding Agent。
- 更新包描述和锁文件，使发布元数据与实际依赖方向一致。

### 阶段三：Composition 公共面收口

- 审计 `@vetta/coding-agent/composition` 的全部 34 个导出及工作区消费者。
- 删除 15 个没有外部消费者的辅助类型重导出；内部模块仍可保留其实现类型，不为公共面制造兼容负担。
- 将公共导出基线固定为 19 项，并继续禁止包外深层导入 Composition 内部模块。

### 阶段四：公共命名去 Greenfield 化

- 将剩余 Composition 公共名称改为稳定的 `CodingAgent*` 或职责名称，例如 `createCodingAgentRuntimeComposition`、`CodingAgentActiveSessionHost` 和 `resolveSessionIdFromPath`。
- CLI、Desktop 和测试统一消费新公共名称；需要保留现有内部文件名或协议语义的位置使用本地别名，不把迁移期名称重新暴露为公共 API。
- 不提供旧公共名称别名。别名会延长迁移 API 生命周期，也会让守卫误以为旧边界仍受支持。
- 修正公共面守卫对 alias export 的识别，按消费者实际看到的导出名治理，并增加回归测试。

## 边界判断

- `runtime-tools` 持有具体 Tool；`coding-agent` 只在产品组合层注入宿主能力，不复制 Tool 实现。
- `"greenfield"`、`"greenfield-im"` 等现有协议值仍是 CLI/RPC 的兼容合同，不能仅为了命名整洁而改变。
- 历史 Session 格式 Reader 属于用户数据兼容边界，不属于旧执行架构；它们只能读取和迁移，不能成为新执行路径。
- Composition 内部实现可以暂时保留迁移期文件名，但公共调用方只能依赖稳定名称。后续内部改名必须以不改变协议和行为为前提。

## TypeBox / Zod 判断

本阶段没有引入 TypeBox 或 Zod。新增边界是 TypeScript 模块依赖、进程内组合合同和质量守卫，不接收不可信 JSON，也没有新增跨进程协议。为这些内部对象增加运行时 Schema 只会重复静态类型。现有外部配置、RPC Frame、会话持久化和 Tool 参数继续在各自入口使用既有 TypeBox 校验。

## 旧实现依赖变化

- 7 个 Runtime 包共扫描 402 个 manifest、源码、测试和配置文件，对 Coding Agent 的依赖为 `0`。
- Composition 公共导出由 34 项降至 19 项；包外深层导入为 `0`，包根 Composition 聚合入口保持 1 个。
- 旧执行实现生产边、测试边、旧文件、兼容导出和 Runtime 反向依赖继续为 `0`。
- 仍有 14 个受治理的历史格式边界，仅用于旧会话数据读取、迁移和兼容判断，不进入模型执行、工具执行或 Session 生命周期主路径。

## 行为兼容性验证

- `runtime-tools` 4 组定向测试共 52 个测试通过，覆盖前台/后台命令、写入和编辑合同。
- Coding Agent 产品命令 Host 与路径 Policy 共 10 个测试通过，覆盖真实 Adapter，而不是只验证 Runtime 自有 fixture。
- 架构治理测试共 20 个通过；Runtime 独立性守卫自身 2 个测试通过。
- 公共名称迁移后的定向宿主测试共 64 个通过：CLI 50、Coding Agent 7、Desktop 7。
- `bun run check` 完整通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。
- `bun run verify:agent-hosts` 完整通过：独立 CLI 产物、IM Gateway、Coding Agent、CLI 和 Desktop 均通过，Desktop 为 511 个测试通过、1 个平台不适用测试跳过。
- 本阶段没有改动 Provider、凭据或模型请求路径，因此未重复发送计费的 DeepSeek 请求；第 265 阶段已有真实 Provider 请求证据，本阶段通过完整宿主验收验证该路径未发生结构性回退。

## 本阶段结果

- Runtime 基础包不再通过测试 fixture、配置 alias 或开发依赖反向连接 Coding Agent。
- Coding Agent 的公开 Composition 边界只保留真实宿主消费者需要的稳定合同。
- CLI、Desktop 和 IM 仍走同一套新架构；本阶段没有恢复 Legacy 执行入口，也没有重构用户可观察功能。
- 公共 API 的迁移期命名已移除，因此在 Changelog 中作为 Breaking Change 记录；工作区内消费者已全部迁移。

## 尚未完成的替换

- 没有待迁移的旧生产执行路径；质量指标已将旧实现依赖、旧执行入口和 Runtime 反向依赖固定为零。
- 14 个历史格式边界仍需长期保留，除非未来明确停止支持对应用户数据；它们不是应该为了“清零”而删除的旧功能。
- 内部仍有迁移期 `Greenfield` 文件名和本地类型名。下一阶段如继续处理，应先把协议值、兼容判断与内部实现命名分离，再做机械改名；不能因此改变 CLI/RPC 行为。
- 后续重点应从“替换旧执行架构”转为维护架构守卫、减少内部组合复杂度，并在新增功能时持续验证四宿主功能等价。
