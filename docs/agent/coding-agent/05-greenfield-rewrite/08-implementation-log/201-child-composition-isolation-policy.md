# 第 201 阶段：Child Composition Isolation Policy

## 阶段目标

第 200 阶段收窄 Runtime Tool Port 后，Greenfield Composition Root 中仍内联了完整的 Child Composition 构造策略：它既要筛除不能继承的父级资源，又要覆盖子会话参数、传递父会话 MCP Tool View，并把完整 Runtime Composition 投影成 Subagent Assembly 所需的窄接口。

本阶段将这些规则提取为独立、可测试的 Child Composition Isolation Policy。只调整组合边界，不修改 Subagent、Tool、MCP、Skill、Prompt 或 Session 的功能行为。

## 实施前分析

Child Composition 不是父 Composition 的无条件复制。现有行为包含四类明确规则：

- 子会话覆盖 `conversationDir`、`cwd`、Model、Thinking Level 与 Tool Activation；
- 子会话不能再次启用 Subagent，避免递归派生；
- 父级 `mcpSource`、`createPluginMcpRuntime` 与 `extensionTools` 不能被子 Composition 重新实例化；
- 子会话使用父 Turn 已解析的 `inheritedMcpView`，保持该次派生所见 MCP 能力一致。

这些是 Composition 隔离策略，不属于 Session 执行内核，也不属于 Subagent 生命周期状态机。目录创建、Session create/resume、失败状态记录以及 dispose 仍应由 `GreenfieldSubagentSessionAssembly` 负责。

## 实施过程

### 1. 提取 Child Composition 工厂

新增：

`packages/coding-agent/src/composition/greenfield-child-composition-policy.ts`

该模块提供 `createGreenfieldChildCompositionFactory()`，集中完成：

- 从父级 Options 中移除 `mcpSource`、`createPluginMcpRuntime` 与 `extensionTools`；
- 使用 Child Request 覆盖会话目录、工作目录、Model、Thinking Level 与 Activation；
- 强制 `enableSubagents: false`；
- 将 `inheritedMcpView` 原样传入 Child Runtime Composition；
- 只向 Subagent Assembly 暴露 create、resume、context delivery 与 dispose 所需的窄接口。

工厂依赖注入一个 Runtime Composition Factory，因此隔离规则可以独立验证，不绑定具体 Composition 实现。

### 2. 收窄 Greenfield Composition Root

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition.ts`

Root 现在只负责用父级 Options 和内部 Runtime Composition Factory 创建 Child Composition Factory，再将其注入 Session Initialization。原先内联的参数筛选、覆盖和接口投影代码已经移除。

Root 仍是递归组合入口，但递归是否允许、哪些资源可以继承，由独立 Policy 决定。

### 3. 验证隔离与委托合同

新增：

`packages/coding-agent/test/runtime-core/greenfield-child-composition-policy.test.ts`

测试覆盖：

- Child Request 正确覆盖子级参数；
- 父级 MCP Source、Plugin MCP Factory 与 Extension Tools 不进入子级 Options；
- Scenario、Knowledge Root、Prompt Tool Names 与普通 Plugin Runtime 等允许继承的 Port 保持不变；
- 父级 Options 不被修改；
- `inheritedMcpView` 保持同一对象身份；
- create、resume、context append/deliver 与 dispose 被准确委托。

### 4. 补齐失败清理语义

修改：

`packages/coding-agent/test/runtime-core/greenfield-subagent-session-assembly.test.ts`

新增 Child Session 创建失败回归：

- 原始创建错误继续向调用方传播；
- 子 Agent 状态被标记为 failed；
- 已创建的 Child Composition 立即释放一次；
- 后续父 Runtime dispose 不会再次释放同一 Child Composition。

该测试明确了 Policy 与 Assembly 的职责分界：Policy 构造和投影 Composition，Assembly 管理创建事务及失败清理。

### 5. 增加架构守卫

修改：

- `scripts/quality/check-package-boundaries.mjs`；
- `scripts/quality/quality-gates.test.mjs`。

守卫禁止 Greenfield Composition Root 重新内联：

- 父级资源移除变量；
- `enableSubagents: false` 隔离规则；
- Child Composition 局部对象和 Options；
- Child backend create/resume 接口投影。

Root 可以依赖 Child Composition Factory，但隔离策略必须留在专用 Policy 模块。

## 功能兼容性核对

- Child Session create 与 resume 路径未改变；
- 子会话目录、Model、Thinking Level、cwd 和 Activation 取值未改变；
- 子 Agent 仍不能递归创建 Subagent；
- 子会话仍继承父会话已经解析的 MCP Tool View；
- 父级 MCP Source、Plugin MCP Runtime Factory 与 Extension Tools 仍不会被子级重复装配；
- Skill、Prompt、Knowledge、普通 Plugin Runtime 与 Tool Registry 行为未改变；
- 子会话上下文 append/deliver 行为未改变；
- 子 Composition 的正常释放和创建失败清理行为未改变；
- 没有新增快照，也没有把运行时可变资源固化到 Session 生命周期。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。Child Composition Options 与 Request 都是进程内、编译期受控的 TypeScript 对象，不涉及 JSON、配置文件、持久化记录、RPC payload 或外部协议输入。运行时 Schema 校验不会增加边界安全性，只会重复已有静态类型合同。

## 验证结果

Child Composition Policy 与 Subagent Assembly：

```text
2 files passed
4 tests passed
```

CLI Plugin MCP 与 Greenfield Runtime Composition 真实组合链路：

```text
2 files passed
17 tests passed
```

质量守卫：

```text
1 file passed
49 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2080 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

完整检查曾发现新测试空数组夹具被推断为隐式 `any[]`；已改为 `NonNullable<GreenfieldRuntimeCompositionOptions["extensionTools"]>`，随后针对性测试、快速检查与完整检查全部重跑通过。

## 阶段结论

Child Composition 的隔离规则已经从 Greenfield Composition Root 中独立出来。Runtime Root 负责装配，Isolation Policy 负责父子能力投影，Subagent Assembly 负责 Session 生命周期与事务清理，三者边界现在可分别理解和验证。

下一阶段应继续检查 Greenfield Composition Root 中剩余的宿主适配与生命周期装配代码，优先提取仍包含多项独立策略、且能在不改变现有功能的前提下建立清晰 Port 的部分。
