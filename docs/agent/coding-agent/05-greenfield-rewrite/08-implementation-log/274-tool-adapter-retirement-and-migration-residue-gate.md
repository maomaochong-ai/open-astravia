# 第 274 轮：旧 Tool Adapter 退役与迁移残留门禁

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

本阶段针对 `src/adapters` 和 `src/composition` 的边界审计先处理一个可证明无生产调用的迁移层，
并把剩余债务变成持续统计的质量门禁。目标不是把 `Adapter` 或 `Composition` 目录整体删除：

- Adapter 只应保留 Runtime Port 到产品宿主能力的转换；
- Composition Root 仍然需要存在，但只负责装配和生命周期；
- 领域合同、策略和运行时状态不应为了方便继续堆在 Adapter 桶文件中；
- `greenfield` 名称只有在确实仍表达迁移状态时才保留，最终应随职责收敛逐步消失。

本轮没有直接重命名 `greenfield-runtime-composition.ts`。该文件被多个架构门禁引用，单纯改名只会制造
大范围文本变化，不会改变职责或依赖方向。应先分离其中仍存在的领域编排，再进行有语义的命名收敛。

## 实施内容

### 删除只服务于旧调用协议的 Tool Adapter

删除 `greenfield-tool-adapter.ts` 及其结构性测试。仓库内没有生产代码调用
`adaptCodingAgentToolRegistration()`，也没有生产代码需要 `LegacyCodingAgentTool`。继续保留它只会允许
新的 Runtime Tool 再次退回旧 `AgentTool` 调用协议。

仍被生产代码使用的 `CodingAgentRuntimeToolRegistration` 没有随适配器删除。调用方改为直接依赖
`src/runtime-contracts`，明确它是 Session Tool 编排合同，而不是某个 Adapter 的内部类型。

### 归位 Tool 分类策略

Extension Tool 对外部分类字符串的归一化规则移入 `profiles/tool-category.ts`：受支持的分类保持不变，
缺失或未知值继续回落到 `external`。该逻辑不再依赖已删除的旧 Tool Adapter。

本轮没有新增 TypeBox 或 Zod。输入只是已经进入 Extension 内部合同的单个可选字符串，不是不可信 JSON
对象边界；增加 Schema 校验不会提高合同安全性，只会扩大依赖和实现体积。

### 新增迁移残留门禁

新增 `check-coding-agent-migration-residue.mjs`，并接入 `check:guards` 与 `test:quality`。门禁负责：

- 禁止旧 Tool Adapter 文件、模块名和旧适配符号重新出现；
- 统计并禁止 Adapter 中 `greenfield` 文件数量超过当前基线；
- 统计并禁止 Composition 中 `greenfield` 文件数量超过当前基线；
- 统计并禁止 Adapter 反向引用 Composition 的文件数量超过当前基线。

这些上限允许后续阶段直接减少债务而不必修改门禁；它们不是对现状的架构认可。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- 旧 Tool Adapter 文件：`1 -> 0`；
- 旧 Tool Adapter 生产引用：`0`，并新增永久禁止规则；
- Adapter 中 `greenfield` 文件：`48 -> 47`；
- Composition 中 `greenfield` 文件：保持 `34`；
- Adapter 反向引用 Composition 的文件：保持 `5`。

## 行为兼容性验证

定向测试覆盖 Tool 分类、Extension Tool 动态注册、产品工具元数据和 Session 资源生命周期：

```text
4 files passed
11 tests passed
```

Coding Agent 完整包测试：

```text
136 files passed, 1 skipped
934 tests passed, 17 skipped
```

质量门禁测试：

```text
9 files passed
115 tests passed
```

跨宿主验收：

```text
bun run verify:agent-hosts
ok (coding-agent, CLI, Desktop, IM)
```

该验收包含独立 CLI 可执行产物编译、IM Gateway 测试，以及 Coding Agent、CLI、Desktop 的现有功能
套件与持久会话 Canary。

`bun run check:quick` 通过。工具名称、描述、TypeBox 参数 Schema、执行实现、动态注册、模型顺序、
作用域、requires、Agent Mode 和错误语义均未修改。

## 尚未完成的替换

- Adapter 下仍有 47 个 `greenfield` 文件，需要逐个按“真实 Port Adapter / Host / 领域策略 / 编排”分类；
- 5 个 Adapter 文件仍反向依赖 Composition 合同，应通过合同归位消除，而不是用相对路径包装；
- Composition 下仍有 34 个 `greenfield` 文件，其中部分是必要装配，部分仍包含状态或领域编排；
- `Greenfield` 类型名、类名和测试名尚未系统收敛，必须在职责稳定后按公共 API 兼容性分批处理；
- CLI、Desktop、IM 的完整生产稳定性仍需要继续由跨宿主验证脚本和真实进程 Canary 保证。

下一阶段应优先审计上述 5 个 Adapter -> Composition 反向依赖，判断合同应上移到稳定 Session/Host
合同还是实现应移出 Adapter。该步骤能真实修正依赖方向，比先批量删除 `greenfield` 名称更有价值。
