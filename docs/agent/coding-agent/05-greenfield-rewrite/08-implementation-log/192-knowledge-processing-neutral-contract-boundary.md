# 第 192 阶段：Knowledge Processing 中性合同边界

## 阶段目标

将 Knowledge Processing 的公共 Session、Factory、Writer 和 Usage 合同从 Legacy 实现文件中移出，使 Greenfield 与 Legacy 成为同一中性产品端口的两个独立实现。

本阶段只调整合同归属和依赖方向，不改变 Knowledge Processing 的执行、写入、模型选择、Todo、usage 或 backend 选择行为。

## 实施前问题

实施前的依赖关系为：

```text
Greenfield Knowledge Processing
              |
              v
Legacy Knowledge Processing
  - 公共合同
  - AgentSession 实现
  - SessionManager 实现
```

`greenfield-knowledge-processing-session.ts` 从 `legacy-knowledge-processing-session.ts` 导入全部公共类型。这使 Legacy 实现文件同时承担抽象合同职责，并让 Greenfield 在类型层依赖旧执行实现。

同时审计确认：

- Desktop 已经是 Knowledge Processing backend 的唯一选择位置；
- Greenfield 和 Legacy 都通过相同的 `KnowledgeProcessingSessionFactory` 被上层消费；
- 现有测试已分别覆盖两种实现的主要合同语义；
- `knowledgeRoot`、KB 工具工厂和 Subagent profile 属于产品能力，不是本次 Legacy 依赖泄漏。

## 目标结构

```text
Knowledge Processing Contract
       /                \
      v                  v
Greenfield Factory    Legacy Factory
      |                  |
Runtime Core         AgentSession

Desktop backend selector
      |
      +-- greenfield
      +-- explicit legacy
```

## 实施内容

### 1. 新增中性合同

新增 `knowledge-processing-contract.ts`，集中定义：

- `KnowledgeProcessingUsage`
- `KnowledgeProcessingPageWriter`
- `KnowledgeProcessingSession`
- `KnowledgeProcessingSessionRequest`
- `KnowledgeProcessingSessionFactory`

合同只依赖通用 ThinkingLevel 和知识页写入请求/结果类型，不依赖任何会话 backend。

### 2. Greenfield 依赖中性合同

Greenfield Knowledge Processing 改为直接依赖中性合同，不再导入 Legacy 实现文件。

Greenfield 既有行为保持不变，包括：

- model registry refresh 和远程模型加载；
- 独占 Runtime composition；
- kb-processing scenario；
- Todo 初始化与 scene lock；
- Knowledge writer 注入；
- usage 事件投影；
- Runtime session 与 composition 清理。

### 3. Legacy 实现独立化

Legacy factory 改为实现中性合同，`AgentSession`、`SessionManager` 和 Legacy tool 构造仍只存在于 Legacy 文件中。

Legacy 文件继续转发原有公共类型，避免已有源码级深层引用立即失效；正式公共 composition 导出改为直接指向中性合同。

### 4. 保持 Desktop 选择边界

Desktop 的 `processing-session-factory.ts` 未发生改动：有效 backend 为 Greenfield 时选择 Greenfield factory，只有显式 rollback backend 才选择 Legacy factory。

### 5. 架构守卫

质量门禁新增以下规则：

- Greenfield Knowledge Processing 不得导入 Legacy Knowledge Processing；
- 中性合同不得导入 `AgentSession`、`SessionManager`、Legacy/Greenfield Runtime composition 或 Runtime Core backend；
- 中性合同不得引用 `createAgentSession` 等执行符号；
- 显式 Legacy factory 允许使用 `SessionManager` 和 `AgentSession`。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。Knowledge Processing 合同由进程内函数和对象组成，不涉及新增 JSON、RPC 或持久化输入。静态 TypeScript 合同与实现行为测试已经覆盖该边界。

## 验证记录

失败优先基线：

- 新增边界用例后，当前实现按预期得到 39 通过、1 失败；
- 失败原因是 Greenfield 对 Legacy 合同的依赖尚未被门禁识别。

实施完成后：

- 质量守卫测试：40/40 通过；
- Greenfield、并发 batch 与 Legacy Knowledge Processing 测试：6/6 通过；
- Desktop Knowledge Processing backend 选择测试：2/2 通过；
- `bun run check:quick` 通过；
- 完整 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

现有真实实现测试覆盖：

- create/run；
- abort；
- usage subscription；
- dispose 与 Greenfield 幂等清理；
- 模型不存在错误；
- Todo lock；
- writer 注入与并发 session 写入基线；
- Desktop 显式 Legacy 与默认 Greenfield 选择。

## 未纳入本阶段

以下依赖经审计不属于本次问题：

- `knowledgeRoot` 和 `wikiDir`：Coding Agent 知识库产品布局；
- KB read/write tool factory：产品能力定义；
- Subagent system prompt：产品 profile；
- `greenfield-runtime-composition.ts` 的整体拆分：需要按 Session capability assembly 单独设计。

## 阶段结论

Knowledge Processing 的抽象合同已经不再归属于 Legacy 实现。Greenfield 和 Legacy 现在是并列 backend，Desktop 继续作为唯一选择者；依赖方向由测试和架构守卫共同固定。
