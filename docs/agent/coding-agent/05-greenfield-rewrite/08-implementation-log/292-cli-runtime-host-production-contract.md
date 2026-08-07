# 第 292 轮：CLI Runtime Host 生产合同收口

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

第 291 轮将 Desktop Runtime 收口为生产身份后，CLI 生产入口已经只运行新 Runtime Host，但测试脚手仍用 `legacy | greenfield | greenfield-im` 三值类型表达“多后端”。实际上所有合同测试都只遍历 `greenfield-im`，`backend` 参数不选择任何实现，只间接决定 Host Bridge 参数。

本轮不改变 Runtime 功能，而是删除这个已经失真的迁移测试抽象，将差分测试转为唯一生产 Runtime 的行为合同。

## 实施内容

### CLI 生产身份

- CLI Runtime Host、RPC Session Adapter 和 Session Event Adapter 的错误与注释改用 `Agent Runtime`、`Runtime`、`IM Runtime` 语义；
- 清理仅在局部变量、清理错误和调试目录中存在的 Greenfield 迁移描述；
- 保留 `GreenfieldRuntimeSession` 上游公开类型，本轮不越界修改 Runtime Core 合同；
- 保留 `RpcRuntimeHostReady.kind === "greenfield"` 和 `PrintRuntimeHostReady.kind === "greenfield-print"`，它们是已导出的公开判别值，不作破坏性协议修改。

### 单生产 Runtime 测试脚手架

- 删除 `TestAgentRuntimeBackend` 及 `StartAgentRpcOptions.backend`；
- `startAgentRpc()` 默认直接启用当前生产 IM Host，普通 RPC 合同通过显式 `enableHostBridge: false` 运行；
- 8 个 `*-differential.test.ts` 更名为 `*-contract.test.ts`，删除单元素 `BACKENDS` 循环和按后端索引的观测结果；
- `legacy-session-resource-close.test.ts` 更名为 `session-resource-close.test.ts`，因为其验证的是当前生产 Session 资源释放，不是 Legacy Runtime；
- 历史行为 fixture 和 `legacyRuntimeContract` 仍作为冻结兼容 Oracle，没有被生产代码引用；
- Session 切换、所有权、中止、Provider 恢复、Extension 历史、关闭排空和资源释放断言保持不变。

### 验证入口

- 根包和 CLI 包的 `verify:runtime-cutover` 改为 `verify:runtime-contract`；
- CI 步骤同步改为 `Verify runtime contract`；
- 修复原脚本引用不存在的 `greenfield-im-runtime-host.test.ts` 问题，改为真实存在的 `runtime-host.test.ts`。

### 类型校验判断

本轮没有新增外部不可信结构化输入，RPC wire 数据继续使用既有校验边界。删除的是测试运行参数而非数据协议，因此无需引入 TypeBox 或 Zod。

## 防回退门禁

迁移残留审查脚本新增 CLI Runtime 测试约束：

- `*-differential.test.ts` 和 `legacy-session-resource-close.test.ts` 必须为 `0`；
- `TestAgentRuntimeBackend` 和 `BACKENDS` 多后端迁移身份必须为 `0`；
- 根包、CLI 包和 CI 中的 `verify:runtime-cutover` 引用必须为 `0`；
- 审查脚本单测新增负例，验证三类回流都会失败。

## 旧实现依赖变化

- CLI 测试可选后端类型：`3 个候选值 -> 0`；
- 单元素后端遍历：`8 个合同文件 -> 0`；
- CLI Runtime 差分测试文件：`8 -> 0`；
- 迁移命名的 Session 资源关闭测试：`1 -> 0`；
- `verify:runtime-cutover` 生产脚本引用：`3 -> 0`；
- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`。

## 行为兼容性验证

- CLI Runtime 合同入口：4 个文件、39 项通过；
- 迁移残留门禁测试：22 项通过；
- RPC Session Adapter 定向测试：15 项通过；
- CLI 包全量测试：34 个文件、183 项通过；
- 全量测试包含独立可执行产物、本地 OpenAI Responses Provider fixture、RPC/IM Host Bridge、Session 所有权与恢复、历史数据导入、Extension、Plugin、MCP、Skill、Tool、Todo 和 Subagent；
- `verify:agent-hosts` 通过，覆盖 coding-agent、CLI、Desktop 和 IM Gateway，其中 Desktop 组合验证 118 个文件、499 项通过、1 项跳过；
- `bun run check:quick` 通过，CLI Runtime 测试迁移文件、身份和 cutover 脚本引用均为 `0/0`；
- 根级 `bun run check` 通过：Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫通过；
- 本轮未向外部真实模型发送请求，Provider 兼容性由本地 Responses 测试服务器验证。

## 尚未完成的替换

- CLI 生产源码不再使用本地 Greenfield 迁移身份，但 CLI 中仍有一组较早的 `greenfield-*.test.ts` 功能测试文件名和用例描述；它们本轮的行为已全量通过，下一阶段应在不改变场景的前提下收口为生产测试命名；
- `GreenfieldRuntimeSession` 与已导出的 Runtime Host `kind` 仍是正式跨包/公开合同，后续若要改名必须单独设计兼容方案；
- 历史会话中的 Legacy 字段、fixture 和行为 Oracle 是数据兼容边界，不是旧 Runtime 执行路径。
