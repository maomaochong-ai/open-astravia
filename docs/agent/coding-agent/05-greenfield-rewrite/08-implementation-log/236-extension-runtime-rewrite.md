# 第 236 阶段：Extension Runtime 职责重写与旧实现退役

## 阶段目标

在 `coding-agent` 包内重写 Extension Runtime，把旧 `core/extensions` 中混合的发现、加载、注册、上下文、事件分派和 Tool 拦截职责拆开，并让全部生产调用方和行为测试直接使用新实现。本阶段是架构重构，不改变 Extension 功能、协议或用户可观察行为。

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

Extension 是 Coding Agent 的产品能力编排域，不需要新建 workspace 包，也不应继续寄生在旧 `core` 目录。它围绕 Agent 内核组合 Tool、生命周期事件、资源发现、Provider、命令和宿主交互，因此保留在 `src/extensions`，但内部只依赖稳定合同和结构端口。

本阶段没有把旧 `loader.ts`、`runner.ts` 和 `wrapper.ts` 整体移动到新目录。原有职责被拆分后由薄组合门面连接，旧目录直接删除，不保留转发文件。

## 实施内容

### 发现与加载

- `runtime/discovery/extension-paths.ts` 负责本地、全局和显式路径发现、目录入口解析、去重与优先级。
- `runtime/loading/extension-module-loader.ts` 负责 Jiti、Extension 自有依赖解析和受控虚拟模块。
- `runtime/loading/load-extensions.ts` 只编排顺序加载和错误收集。
- `runtime/registration/extension-registration.ts` 负责把 Extension API 注册调用写入单个 Extension 状态，并保持 Provider 延迟注册及共享 Runtime 动作绑定。

### 运行时状态与查询

- `runtime/runtime-state.ts` 只持有共享 Flag、Provider 和宿主动作状态。
- `runtime/registry/extension-registry.ts` 负责 Tool、Command、Shortcut、Flag 和 Renderer 查询、冲突诊断与 first-wins 规则。
- `runtime/context/extension-context-host.ts` 通过结构化 Session/Model 端口构造 Extension Context，不依赖具体 `SessionManager` 或 `ModelRegistry`。

### 事件与 Tool Pipeline

- `runtime/dispatcher/lifecycle-dispatcher.ts` 处理普通生命周期事件、资源发现和错误隔离。
- `runtime/dispatcher/agent-dispatcher.ts` 处理需要链式变换的 input、context、before-agent、tool-call 和 tool-result 事件。
- `runtime/tool-pipeline.ts` 保留 `tool_call → 实际 execute → tool_result` 顺序、阻断行为、结果变换和失败通知语义。
- `runtime/extension-runner.ts` 缩减为组合门面，不再直接实现注册表、上下文和事件算法。

### 边界切换与退役

- 包根、`public-api/extensions.ts`、旧 Session 宿主和 Greenfield Adapter 全部改从 `src/extensions` 使用新 Runtime。
- 15 个 Extension 行为测试文件改为直接引用稳定入口，测试不再耦合旧目录结构。
- 删除 `core/extensions/index.ts`、`loader.ts`、`runner.ts` 和 `wrapper.ts`，不保留兼容转发层。
- 重写进度基线同步收缩，Extension 域旧依赖和旧实现文件均归零。

## TypeBox / Zod 判断

Tool 参数继续使用既有 TypeBox Schema，这是需要在模型与 Tool 执行边界公开和校验的结构合同。本阶段加载的是可信本地 TypeScript/JavaScript Extension 模块，注册 API 也是函数合同；额外引入 Zod 不会提升该边界的可靠性，反而会形成两套 Schema 体系，因此没有引入。未来若 Extension manifest 成为外部稳定协议，应在 manifest 解析边界单独增加 TypeBox 校验。

## 旧实现依赖变化

| 指标 | 第 235 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 128 | 122 | 0 |
| Extensions 域旧依赖 | 6 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 153 | 149 | 0 |

这 6 条依赖和 4 个文件的下降全部来自真实调用方切换与旧实现删除，没有通过移动文件、重命名或兼容包装降低统计。

## 行为兼容性验证

- Extension Runtime 与公共子路径定向测试 9 个文件、76 项测试通过，覆盖发现顺序、目录和 package 入口、依赖解析、加载失败、注册冲突、事件变换、Tool 拦截顺序/阻断/失败通知、命令宿主、Greenfield 桥接和 `@vetta/coding-agent/extensions` 导出。
- 根级 `bunx tsgo --noEmit` 在调用方切换后通过。
- 重写进度门禁通过：旧实现依赖 122、Runtime 反向依赖 0、旧文件 149、兼容导出 0；Extensions 域不再出现在旧依赖域统计中。
- `bun run check:quick` 与全仓 `bun run check` 均通过，覆盖 Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫。
- 额外执行完整 `resource-loader.test.ts` 时，11 项通过、5 项失败；失败 fixture 仍写入旧 `.pi` 项目目录，而当前 `ResourceLoader` 使用 `CONFIG_DIR_NAME`，本阶段对该文件仅迁移 Extension import。该既有资源目录测试债务未混入本次 Extension Runtime 重写。

## 尚未完成的替换

- 全仓仍有 122 条生产代码到旧 `core` 实现的依赖，主要集中在 Session、Session Manager、Resource Loader、Settings Manager 和 Model Registry。
- 旧 `AgentSession` 的 `RuntimeManager` 仍负责把 Extension Runtime 与旧会话能力组合；它现在是新 Extension Runtime 的宿主消费者，不是 Extension 域的一部分。后续应重写其产品组合职责，而不是把它移入 `src/extensions`。
- 下一阶段应优先处理 `ResourceLoader`：它仍同时拥有 Extension/Skill/Prompt 发现、缓存、动态 Source 和 reload 编排，是 Extension Runtime 与旧 Session 组合之间最大的剩余边界之一。
