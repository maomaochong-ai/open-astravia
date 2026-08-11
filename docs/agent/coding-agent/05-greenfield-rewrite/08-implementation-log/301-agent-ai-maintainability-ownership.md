# 第 301 轮：Agent 与 AI 可维护性职责收敛

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

`@vetta/agent-core` 与 `@vetta/ai` 是 Coding Agent 新架构明确保留的下层能力。本轮不重写其功能合同，而是把执行编排、状态投影、消息队列和 Provider 协议转换拆到明确职责所有者，使 Coding Agent 继续依赖稳定、可验证的下层合同，而不是依赖聚合实现细节。

## 实施内容

- 将 Agent loop 的流消费、上下文检查点、遥测和工具执行拆入 `src/loop/`，入口仅保留循环状态机和委托。
- 将 Agent 的消息队列和状态投影拆入 `src/runtime/`，`Agent` 类继续提供原有公开控制面。
- 将 Amazon Bedrock、Anthropic、Google Gemini CLI、OpenAI Codex、OpenAI Completions 与 OpenAI Responses 的请求、消息、事件、客户端和流处理按协议职责拆分。
- 保留六个既有 Provider 文件作为纯导出门面，包内外导入路径及公开导出名称不变。
- 将 `agentLoop` 与 `agentLoopContinue` 测试拆为独立文件，共享测试构造器归入 `test/support/`。
- 新增 `agent-ai-maintainability` 守卫及反例测试，防止 Provider 门面重新承载实现、Agent loop 取消职责委托或源码重新出现内联类型导入。

## 旧实现依赖变化

- `@vetta/agent-core`、`@vetta/ai` 对旧 Coding Agent 生产实现的依赖：保持 `0`。
- Provider 既有入口文件：由协议实现聚合体收敛为 6 个纯导出门面。
- Agent loop 明确职责所有者：由 1 个聚合文件增为 4 个 loop 模块和 2 个 runtime 模块。
- CLI、Desktop、Admin 及其他下游消费路径：保持原有包入口和公开类型，不新增兼容层或深层导入要求。

## 行为兼容性验证

- `packages/agent` 执行 `bun run test`：9 个测试文件通过、1 个跳过，48 个测试通过、43 个外部场景跳过。
- Agent loop 拆分后定向验证：2 个测试文件、13 个测试全部通过。
- AI 受影响 Provider 定向合同：16 个测试文件、44 个测试全部通过。
- 新增结构守卫测试：3 个测试全部通过；实际扫描结果为 6 个纯导出门面、28 个职责所有者、内联类型导入为 0。
- `packages/agent` 与 `packages/ai` 的 `tsconfig.build.json` 类型检查通过。
- 根目录最终执行 `bun run check`：Biome、monorepo/CLI/Desktop/Admin 类型检查及全部质量门禁通过。
- `packages/ai` 完整包测试未全绿：仓库 `HEAD` 中 `models.generated.ts` 已为空对象，既有模型目录测试因此出现 8 个加载失败文件、4 个模型断言失败和 5 个派生超时；该文件本轮无差异，新增及受影响 Provider 合同均已独立通过。

## 尚未完成的替换

本轮计划内的生产职责拆分、测试职责拆分和结构防回退门禁已经完成，没有引入迁移兼容代码。仓库仍需单独决定生成模型目录在源码签出环境中的测试基线；该问题存在于本轮之前，不应通过在可维护性重构中伪造模型数据解决。
