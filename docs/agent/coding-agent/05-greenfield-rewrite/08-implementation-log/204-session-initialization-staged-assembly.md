# 第 204 阶段：Session Initialization Staged Assembly

## 阶段目标

将 Session Initialization Transaction 中混合的具体 Runtime 创建策略拆成显式、类型化的装配阶段，使 Transaction 只负责阶段编排和统一提交/回滚，同时保持现有功能、公开 API、动态资源语义和补偿顺序不变。

本阶段不是引入通用 Pipeline 框架，而是建立符合当前初始化顺序的固定阶段：

```text
Session Input
    |
    v
Peripheral Assembly
    |
    v
Context Assembly
    |
    v
Resource Lifecycle Assembly
    |
    v
Turn Capability Assembly
    |
    v
Commit / Rollback
```

## 实施前分析

`greenfield-session-initialization-transaction.ts` 在第 203 阶段完成输入 Profile 收窄后仍有 547 行，同时直接创建和配置以下对象：

- Session Configuration、Product Tools 与 Plugin Runtime；
- Plugin MCP Controller 与 Execution Runtime；
- Memory、Todo、AskUserQuestion 和基础 Agent Profile；
- Model、Hook、Context/Compaction 与 Subagent Runtime；
- Resource Lifecycle 与 Turn Capability Assembly；
- 初始化失败补偿与最终提交。

这使 Transaction 同时承担具体能力策略和事务协调。Composition Root 已经只保留合理的显式接线，因此继续包装 Root 中的 Repository、Projector 等对象不会改善主要依赖问题。

## 实施内容

### 1. 新增 Peripheral Assembly

新增 `greenfield-session-peripheral-assembly.ts`，统一负责：

- Session Plugin Runtime 冲突判断和配置状态；
- Product Tool registrations 与 feature；
- Plugin MCP Runtime 的创建、重配置和 Session Controller；
- Execution Runtime；
- Memory Runtime；
- Todo Runtime、初始 Todo 与锁；
- AskUserQuestion、Fork Context、Memory、Todo、MCP 等基础 Agent features。

该 Assembly 返回显式的 `GreenfieldSessionPeripheralAssembly` 对象图，供后续 Context、Lifecycle 和 Capability 阶段使用。

### 2. 新增 Context Assembly

新增 `greenfield-session-context-assembly.ts`，统一负责：

- Model Runtime 与凭据解析；
- Memory Controller；
- Ecosystem Hook Runtime；
- Context、Compaction 与 Extension Context Runtime；
- Subagent Session Assembly。

该阶段依赖 Peripheral Assembly 的 Memory 和 Plugin MCP 结果，不重新读取或复制动态工具、Prompt、Skill、MCP 数据。

### 3. 保留单一回滚所有者

两个新 Assembly 都只接收窄化的 `deferRollback(InitializationRollbackTask)` Port：

- Assembly 可以为自己创建的资源登记补偿动作；
- Assembly 不能执行 `commit()` 或 `rollback()`；
- 外层 Transaction 仍然持有唯一的 `InitializationRollbackScope`；
- 所有补偿任务仍按实际资源创建顺序进入同一个栈，并严格逆序执行。

没有引入嵌套事务，也没有改变正常 Session dispose 的 `RetryableCleanup` 所有权。

### 4. 收窄 Initialization Transaction

Transaction 现在只负责：

1. 获取 Conversation Ownership；
2. 建立 Resource Context 和 Extension Event Bridge；
3. 调用 Peripheral Assembly；
4. 调用 Context Assembly；
5. 调用已有 Resource Lifecycle Assembly；
6. 调用已有 Turn Capability Assembly；
7. 预览初始系统提示词；
8. 绑定资源并统一 commit 或 rollback。

文件从 547 行降到 309 行。剩余行数主要由公开内部合同和四阶段显式接线构成，不再包含外围与上下文 Runtime 的直接构造策略。

### 5. 增加架构守卫

Package boundary guard 现在禁止 Initialization Transaction 重新直接：

- 构造 Execution、Memory、Todo、Model、Context 等 Runtime；
- 创建 Hook、Subagent、Product Tool 等具体能力；
- 恢复内联 Plugin/Fork Context helper。

合法的 Peripheral Assembly 与 Context Assembly 调用不会触发守卫。

## 功能兼容性

本阶段保持：

- Plugin Runtime 冲突错误及 Plugin MCP 重配置顺序；
- MCP Session 隔离、延迟激活和下一模型调用刷新；
- Memory、Todo、AskUserQuestion 和初始 Todo 行为；
- Hook、Compaction 和 Context Transform 行为；
- Subagent 创建、恢复和父子 MCP 投影；
- Prompt Resource/Settings 动态引用；
- Capability 初始系统提示词预览；
- Session create、resume、continue、dispose 与失败后重启；
- 初始化失败时的严格逆序回滚。

没有修改公开 Composition Options，也没有删除 Legacy 能力。

## 测试补充

扩展 Session Initialization Transaction 测试，增加 Peripheral Assembly 部分完成时的失败基线：

- Plugin MCP Runtime 已创建并登记补偿；
- `reconfigure()` 抛出错误；
- 外层 Transaction 必须释放 Plugin MCP Runtime；
- 原始错误继续向调用方传播。

原完整失败测试继续验证：

```text
Todo -> Memory -> Plugin MCP -> Conversation Ownership
```

的逆序回滚，以及相同 Session 随后可以重新创建。

## 验证结果

以下验证均通过：

```text
bunx tsgo --noEmit -p tsconfig.json
  passed

bunx vitest --run test/runtime-core/greenfield-session-initialization-transaction.test.ts test/runtime-core/greenfield-session-initialization-profile.test.ts
  2 files passed, 4 tests passed

bunx vitest --run scripts/quality/quality-gates.test.mjs
  1 file passed, 52 tests passed

bunx vitest --run test/greenfield-runtime-composition.test.ts test/greenfield-plugin-runtime.test.ts test/greenfield-plugin-mcp-session.test.ts test/greenfield-memory-runtime.test.ts test/greenfield-subagent-runtime.test.ts
  5 files passed, 25 tests passed

bun run check:quick
  passed

bun run check
  lint passed
  types passed（root tsgo、cli-app、desktop-app、admin）
  guards passed
```

## TypeBox / Zod 判断

本阶段没有引入 TypeBox 或 Zod。新增合同都是同一进程内的静态 TypeScript 对象图和函数 Port，不包含 JSON、配置文件、网络消息或其他不可信输入。运行期 schema 校验会重复现有类型合同，没有额外收益。

## 阶段结论

Session 初始化现在形成了显式的固定阶段管道，但没有引入可任意插入、重排的通用 middleware：

- 顺序由 Transaction 明确控制；
- 每个 Assembly 只拥有自身对象图构造；
- 回滚由一个 Scope 集中控制；
- 正常运行期资源所有权继续交给 Resource Lifecycle Assembly。

下一阶段应进行 Legacy Execution Retirement Readiness 审计，区分可以移除的旧执行内核与必须继续保留的旧会话读取、格式识别和迁移兼容层。在消费者和行为基线清零前，不直接删除公开 Legacy 入口。
