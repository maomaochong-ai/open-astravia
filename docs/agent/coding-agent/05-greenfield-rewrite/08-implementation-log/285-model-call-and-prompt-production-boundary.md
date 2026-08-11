# 第 285 轮：模型调用与 Prompt 生产边界收口

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

第 284 轮将 Composition 的迁移期文件身份归零，但 Adapter 中仍有 29 个 `greenfield-*` 文件。本轮按完整的模型调用与 Prompt
职责簇审计其中 8 个文件。审计结论是：只有模型调用和 Prompt 请求的 Runtime 合同转换属于真正 Adapter；模型调用帧构造、消息终结、
Prompt 运行策略、资源解析及 Conversation 投影属于 Coding Agent 产品域，不应伪装为 Adapter。

本轮不是将旧文件机械改名，而是重新确定所有权、删除具体 Adapter 反向依赖，并让 `runtime-core` 的 Prompt 合同取得稳定生产身份。
没有保留旧路径转发、旧类型别名或迁移兼容包装。

## 实施内容

### 稳定 Runtime Prompt 合同

`runtime-core` 的 Prompt 合同统一使用以下生产身份：

- `RuntimePromptPreparationContext`；
- `RuntimePreparedPrompt`；
- `RuntimePromptInterceptionResult`；
- `RuntimeHandledPromptResult`；
- `RuntimePromptResult`；
- `RuntimePromptAdapter`。

Runtime Factory、Session Backend、公开导出及测试均直接使用稳定合同。旧 `GreenfieldPrompt*` 标识被删除，没有兼容别名。

### 只保留真实 Adapter

`adapters/runtime-core/` 中保留两个必要的合同转换：

- `model-runtime-adapter.ts`：把 Coding Agent 的模型运行能力转换为 Runtime Model Port；
- `prompt-request-adapter.ts`：把 Runtime Prompt 请求转换为 Coding Agent 的输入拦截与资源处理流程。

Prompt Adapter 只依赖窄的输入拦截合同，不再依赖具体 Extension Adapter 类。

### 产品职责回归所属子域

- `model-context/model-call-frame-composer.ts` 负责模型调用帧、工具表面与产品上下文组合；
- `model-context/model-call-message-finalizer.ts` 负责消息终结和图片预算处理；
- `model-context/prompt-runtime.ts` 负责单次 Prompt 的产品处理流程；
- `resources/prompt-resource-resolver.ts` 负责 Prompt、Skill 和资源引用解析；
- `sessions/projection/conversation-context-projector.ts` 负责模型消息投影；
- `sessions/projection/conversation-context-overlay.ts` 负责 Conversation 上下文覆盖。

这些产品域通过局部窄 Port 接收 Extension、Plugin 和 Tool 能力，不再导入具体 Adapter。Composition 的
`turn/prompt-runtime-factory.ts` 单独承担默认 Settings 与 Resource Runtime 的实例化，使产品运行逻辑与装配策略分离。

### 行为兼容与结构化校验

模型消息顺序、系统 Prompt、动态 Prompt/Skill 资源、Hook 拦截、工具包装、图片预算、Conversation Context Overlay、SDK/RPC
消息投影和 Session 生命周期均保持原行为。

本轮没有新增 TypeBox 或 Zod。新增边界是进程内、由 TypeScript 合同约束的组合关系；Conversation 持久化输入仍在既有上游合同中校验。
在此处重复引入运行时 Schema 不会增加新的信任边界，反而可能改变旧输入的兼容行为。

### 防回退门禁

- 迁移残留门禁永久禁止 8 个旧 Adapter 文件及其旧路径、类型、类和函数重新出现；
- Adapter 中 `greenfield-*` 文件基线由 `29` 收紧为 `21`；
- Package Boundary 门禁禁止 `model-context`、`resources` 和 `sessions` 产品域导入具体 Adapter；
- Package Boundary 门禁禁止 `runtime-core/src` 重新声明或使用旧 `GreenfieldPrompt*` 合同身份；
- 新增 fixture 证明旧模型调用、Prompt 路径和旧 Runtime Prompt 合同都会被拒绝。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 本轮 8 个迁移期 Adapter 文件：删除；
- Adapter 中 `greenfield-*` 文件：`29 -> 21`；
- Composition 中 `greenfield-*` 文件：保持 `0`；
- 模型、资源和 Session 产品域到具体 Adapter 的导入：保持 `0`；
- Adapter -> Composition、Composition -> public API、Extension Host -> Composition：均保持 `0`；
- Composition 公开导出仍为 `18`，没有新增兼容入口。

迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=21/21
Composition greenfield files=0/0
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

## 行为兼容性验证

- 架构与迁移门禁：2 个文件、81 项测试通过；
- `runtime-core` 全量：29 个文件、139 项测试通过；
- `coding-agent` 全量：137 个文件通过、1 个文件跳过，935 项通过、17 项跳过；
- 根级 `bun run check:quick` 通过；
- 根级 `bun run check` 通过，覆盖根、CLI、Desktop、Admin 类型检查、Biome 和全部质量门禁；
- `bun run verify:agent-hosts` 通过：独立 `vetta.exe` 编译成功，IM Gateway、Coding Agent、CLI、Desktop 全部通过；
- Desktop 功能套件为 119 个文件、501 项测试通过，另 1 项跳过。

第一次完整类型检查发现两个移动文件仍使用旧目录层级的相对导入，随后改为稳定的 `runtime-contracts` 路径并重新完成全部验证。
本轮没有发送外部真实模型请求，模型行为由确定性模型、差异测试和三个宿主的真实会话入口覆盖。

## 尚未完成的替换

- Coding Agent Adapter 仍有 21 个 `greenfield-*` 文件，主要集中在 Extension、Plugin、Continuation 和 Runtime 能力连接；
- `runtime-core` 仍有其他 Greenfield 生产身份，需要按独立合同簇审计，不能因为 Prompt 合同已稳定而批量改名；
- CLI 与 Desktop 宿主仍存在迁移期命名，但本轮已证明它们继续通过同一生产 Runtime 工作；
- 历史 Session 格式读取边界仍需保留，不能与旧执行架构混为一谈。

下一阶段应按一个完整阶段收口 Extension、Plugin 与 Continuation Adapter 职责簇：稳定真正的 Runtime 合同转换，将产品策略移回对应子域，
删除只为迁移调用关系存在的包装，并继续用动态 Extension/Plugin/Skill、工具顺序、继续执行语义和三宿主门禁证明功能未改变。
