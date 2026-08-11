# 第 232 阶段：Coding Agent Model Context 包内重写

## 阶段目标

在 `coding-agent` 包内建立独立 `model-context` 领域目录，替代旧 `core/messages.ts` 与 `core/system-prompt.ts`，并把产品身份从旧 `core/subconscious.ts` 收回产品 Prompt 组合。该能力具有明确的 Coding Agent 产品语义，不新建 Runtime 包。本阶段只重构职责、文件边界和依赖方向，不改变模型消息、系统提示词、Tool/MCP/Skill/Plugin 组合或用户可见行为。

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

重写 Coding Agent 不是把它架空成接线包。模型可见的消息语义、Vetta 产品身份、默认 Prompt、工具指导以及 Tool/MCP/Skill/Plugin Contribution 的组合都是 Coding Agent 的产品职责，因此保留在包内；Runtime Core 仍只负责 Turn、Model Call Frame 和状态机。

只有具有独立生命周期、独立持久化或多个产品消费者的能力才拆成 Runtime 包。Model Context 不满足这一条件，新建 `runtime-prompt` 反而会把产品策略错误下沉。本阶段采用包内领域目录，并通过模块职责和回流守卫建立边界。

## 实施内容

- 新增 `src/model-context/message-types.ts`，持有 Bash、Custom、Branch Summary、Compaction Summary 以及附件/资源引用的消息合同和工厂。
- 新增 `message-projector.ts`，独立完成 Coding Agent Message 到 `@vetta/ai` Message 的确定性投影和模型不可见标记过滤。
- 新增 `prompt-document.ts`，持有 Prompt Block、Draft、Operation、不可变操作应用和确定性渲染。
- 新增 `plugin-runtime.ts`，隔离 Plugin Tool、Prompt、Continuation、MCP Contribution 和调用 DTO，不再与产品 Prompt 文案混在一个文件。
- 新增 `skill-prompt.ts`，只消费渲染 Skill 索引所需的最小结构合同，不依赖旧 Skill Loader 具体实现。
- 新增 `product-prompt.ts`，持有 Vetta 产品身份、工具说明、场景指导、Context/MCP/Skill 渲染和每次 Model Call 使用的 Prompt Builder。
- 所有旧 Core、Greenfield Adapter、SDK/RPC、测试和 Desktop 消费者已切换到 `model-context`；Desktop 通过显式 `@vetta/coding-agent/product-prompt` 子路径消费产品指引。
- 删除旧 `core/messages.ts`、`core/system-prompt.ts` 和迁移后成为孤儿的 `core/subconscious.ts`，不保留转发文件或执行兼容层。
- 增加回流守卫，禁止恢复三个旧文件、旧深层导入和对应 Manifest 导出。
- 修正既有 Prompt 测试对默认命令工具的跨平台假设：Windows 验证 `shell`，其他平台验证 `bash`，生产行为未修改。

## 旧实现依赖变化

| 指标 | 第 231 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 175 | 156 | 0 |
| Messages 域旧依赖 | 10 | 0 | 0 |
| System Prompt 域旧依赖 | 9 | 0 | 0 |
| Tool 域旧依赖 | 0 | 0 | 0 |
| Knowledge 域旧依赖 | 0 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 166 | 163 | 0 |
| 旧 SDK 示例 | 0 | 0 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

Messages 和 System Prompt 两个旧域的 19 条生产依赖已经全部删除；三个旧文件同步删除。新 `model-context` 只依赖独立下层合同和 Coding Agent 产品输入，不产生 Runtime 反向依赖或新的旧 Core 依赖。

## 行为兼容性验证

- Coding Agent 8 个定向测试文件、41 项测试通过，覆盖系统提示词、动态 Tool 输入、消息投影、不可见资源标记、摘要、Bash 文本、Plugin Operation、Skill XML、图片阻断和旧会话导入。
- 新 Model Context 边界测试验证每次调用根据当前工具重新构建 Prompt，不持有进程级 Prompt 快照。
- 质量治理 4 个测试文件、72 项测试通过，覆盖旧文件、旧导入、Manifest 回流和重写指标。
- `bun run check:quick` 与完整 `bun run check` 均通过；Biome、根/CLI/Desktop/Admin 类型检查和全部质量守卫无错误。

## 尚未完成的替换

- 仍有 156 条生产代码到旧实现的精确依赖，目标为零；剩余高依赖域为 Extensions 26、Session 17、Session Manager 14、Resource Loader 9、Settings Manager 9、Compaction 8 和 Model Registry 8。
- 旧 AgentSession 内部继续消费新的 Model Context 以保持兼容行为，但 AgentSession、SessionManager 和 Extension Runner 本身仍属于待退役旧执行岛。
- 8 个旧格式边界及其中 3 条旧实现依赖仍需独立审计；旧数据兼容必须与旧执行代码分离。
- 下一阶段应优先处理依赖新消息合同的 Compaction 运行时边界，或先审计 Extensions 与 Resource Loader 的闭环条件；不能把旧 Manager/Runner 原样移动到新目录。

