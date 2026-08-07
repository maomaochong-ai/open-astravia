# 第 290 轮：Extension 需求与宿主兼容性生产合同收口

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

第 289 轮确认 Bootstrap 公开面仍把 Extension 的未解析需求和宿主解析结果混为同一 `CodingAgentExtensionCompatibilityAssessment`：Bootstrap 预先把全部需求标记为缺口，CLI 再覆盖解析；`requiresLegacyRuntime` 实际只导致生产宿主返回结构化启动失败，不再启动 Legacy Runtime。该合同继续保留会误导生产语义，也使资源发现阶段了解了不属于自己的宿主决策。

本轮将 Extension 注册事实、宿主能力和最终兼容结论拆成两个明确阶段。此处的兼容解析器必须保留在 Coding Agent：它理解 Extension 的 Event、Tool、Command、Shortcut、Renderer 与命令式 API 注册语义；它不是通用 Runtime Core 能力，也不需要新增 Adapter。

## 实施内容

### 需求收集与宿主解析分离

- 删除 `host/coding-agent-extension-compatibility.ts` 单文件混合实现；
- 在 `host/extensions/compatibility` 下按 `contracts`、`requirements`、`resolver` 和 `index` 拆分职责；
- `collectCodingAgentExtensionRequirements()` 只收集 Extension 数量、Bootstrap Provider/Flag 贡献、注册摘要和所需运行时能力，不再制造尚未解析的缺口；
- `resolveCodingAgentExtensionCompatibility()` 以明确的 `CodingAgentExtensionHostCapabilities` 解析最终结果，并通过 `compatible` 表达宿主能否承载；
- `CodingAgentHostBootstrap.extensionRequirements` 只暴露需求事实，CLI Runtime Host 在 Composition Root 使用自身能力完成解析。

### 生产合同命名

- `CodingAgentLegacyExtensionRuntimeCapability` 改为 `CodingAgentExtensionRuntimeCapability`；
- `CodingAgentGreenfieldExtensionHostCapabilities` 改为 `CodingAgentExtensionHostCapabilities`；
- `actions` 改为含义明确的 `runtimeActions`；
- `CODING_AGENT_GREENFIELD_EXTENSION_EVENTS` 改为 `CODING_AGENT_EXTENSION_HOST_SUPPORTED_EVENTS`；
- CLI 的 `IM_EXTENSION_EVENT_COMPATIBILITY_PROFILE` 改为 `CLI_EXTENSION_EVENT_COMPATIBILITY_PROFILE`，因为同一配置同时服务 RPC、Print 与 IM；
- 删除 `requiresLegacyRuntime`，生产宿主只判断中性的 `compatible`，不保留迁移别名。

### 行为保留

- Event、Tool、Command、Provider、Flag Extension 继续由同一生产 Runtime 承载；
- Shortcut、Message Renderer 和 `user_bash` 在无对应 UI 表面的 CLI/RPC Host 中继续标记为 `inapplicable`；
- 未知 Extension Event 继续在创建 Session 和发送 Provider 请求前返回 `extension-incompatible`；
- RPC 错误码 `extension_incompatible`、退出码 `2`、诊断字段、Unsupported Event 与 Unmet Capability 列表保持不变；
- 没有恢复 Legacy Runtime 回退，也没有修改 Session、模型、工具、消息或资源生命周期。

### 类型校验判断

本阶段只处理进程内 TypeScript 合同和已经加载完成的 Extension 注册表，不新增外部不可信结构化输入。RPC 对外帧继续由既有 Schema 边界校验，因此无需引入 TypeBox 或 Zod。

### 防回退门禁

- 迁移残留门禁新增旧兼容模块路径、Legacy/Greenfield 类型、函数、常量、Bootstrap 属性和 `requiresLegacyRuntime` 扫描；
- 新增门禁测试，证明旧模块、旧符号、旧 CLI Profile 和旧 Bootstrap 属性会被拒绝；
- 生产源码与测试中的本阶段退役合同必须保持 `0`。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本阶段识别的 7 个核心迁移合同、52 次引用：收敛为 `0`；
- 旧兼容模块文件：`1 -> 0`；
- `requiresLegacyRuntime`：收敛为 `0`；
- 迁移残留门禁：退役文件、退役引用、SDK Session 迁移身份和迁移文件名均为 `0/0`。

## 行为兼容性验证

- Coding Agent 定向测试：2 个文件、9 项通过；
- CLI Runtime Host 与 Extension 失败策略定向测试：2 个文件、19 项通过；
- 迁移残留门禁：20 项通过；
- Coding Agent 全量测试通过；
- CLI 全量与 Coding Agent 全量并行执行时，2 个进程型 CLI 用例超过 5 秒超时；单独复跑该文件 9 项全部通过，确认是并行资源争用；
- `bun run verify:agent-hosts` 通过：独立 Vetta CLI、IM Gateway、Coding Agent、CLI 和 Desktop 全部通过；
- Desktop 功能套件：119 个文件、501 项通过、1 项跳过；
- 根级 `bun run check` 通过：Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫通过；
- 本轮没有发送外部真实模型请求。

## 尚未完成的替换

- `@vetta/runtime-core` 的 `GreenfieldRuntimeSession` 仍是跨包正式合同，不属于本轮 Coding Agent Extension 兼容边界；
- CLI、Desktop 与测试中仍存在作为协议值、历史格式和差异基线的 `greenfield`/`legacy` 文本，必须逐项按所有权审计，不能按字符串批量删除；
- Desktop 自身的 `greenfield-runtime` 目录和生产身份尚未在本阶段处理；它是下一轮最值得审计的宿主迁移边界，但必须先证明当前实现与旧候选/差异测试之间的真实关系。
