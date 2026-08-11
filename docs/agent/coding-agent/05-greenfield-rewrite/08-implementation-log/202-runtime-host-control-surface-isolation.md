# 第 202 阶段：Runtime Host Control Surface Isolation

## 阶段目标

第 201 阶段提取 Child Composition Isolation Policy 后，Greenfield Composition Root 仍直接实现了一组运行期宿主控制操作，包括 Session Hook、Extension Runner、上下文投递、后台命令静默、执行上下文迁移与 Memory flush。

这些操作都通过 Session ID 查找 Composition 内部实时资源，但不属于 Runtime 创建和装配。本阶段把它们提取为专用 Host Control Surface，同时保持现有扁平 Runtime API 和全部功能行为不变。

## 实施前分析

Composition Root 前半部分创建 Repository、Tool Surface、Resource Registry、Session Initialization、Backend 与 Shutdown，属于合理的装配职责。原返回对象中的控制方法则同时承担：

- 将宿主调用路由到 Session Resource Index；
- 定义资源缺失时的错误语义；
- 协调 Extension Event Bridge 与 Extension Tool Runtime；
- 读取 Conversation Document 并投影执行上下文；
- 决定可选资源不存在时的空操作和默认返回值。

这些职责可以通过现有抽象索引和函数 Port 独立实现。控制面必须持有实时索引，而不是创建快照，否则后续创建、续接和重绑定的 Session 将不可见。

## 实施过程

### 1. 提取 Runtime Session Controls

新增：

`packages/coding-agent/src/composition/greenfield-runtime-session-controls.ts`

该模块负责：

- Session Hook `start`、`end` 与 `discard`；
- Session Context append 与异步 deliver；
- 后台命令 quiesce；
- fork 执行上下文 preserve 与 clear；
- Memory flush。

模块只依赖以下边界：

- `GreenfieldSessionResourceIndexes` 的窄 `Pick`；
- Conversation Document 读取函数；
- Source Context 与 Target Seed 投影函数；
- Context Overlay preserve/clear 函数。

因此它不依赖 `FileConversationRepository`、具体 Projector 或 Composition Root。

### 2. 提取 Runtime Extension Controls

新增：

`packages/coding-agent/src/composition/greenfield-runtime-extension-controls.ts`

该模块负责：

- 从实时 Event Bridge 索引绑定 Extension Runner；
- 同步绑定可选 Extension Tool Runtime；
- 暴露当前 Extension System Prompt；
- 按原顺序先解绑 Tool Runner，再解绑 Event Bridge；
- 动态刷新 Extension Tool 注册。

新增 `GreenfieldExtensionToolHostPort`，控制面不依赖具体 `CodingAgentGreenfieldExtensionToolRuntime` 类型。

### 3. 组合公共控制合同

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition-contract.ts`

新增：

- `GreenfieldRuntimeSessionControls`；
- `GreenfieldRuntimeExtensionControls`。

`GreenfieldRuntimeComposition` 组合这两个合同。公共 API 继续保持原有扁平路径：

```ts
runtime.flushMemory(sessionId)
runtime.bindExtensionRunner(sessionId, runner)
runtime.sessionHooks.start(sessionId, source)
```

没有引入新的嵌套对象，也不要求 CLI、Desktop 或 RPC 宿主迁移。

### 4. 收窄 Composition Root

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition.ts`

Root 现在只创建 Session Controls 与 Extension Controls，并把它们组合进最终 Runtime。原先直接访问五类 Session Resource Index 的控制实现及辅助函数已经移除。

Root 继续拥有：

- Runtime 实例创建和连接顺序；
- Backend；
- Tool Surface；
- Repository；
- Composition Shutdown。

### 5. 建立消费者侧 Session Transition Port

修改：

`packages/coding-agent/src/composition/greenfield-active-session-transition-host.ts`

新增 `CodingAgentGreenfieldSessionTransitionRuntimePort`。Active Session Host 不再依赖完整 `GreenfieldRuntimeComposition`，只依赖：

- Session Backend；
- Session Hook Lifecycle；
- Background Command quiesce；
- Execution Context preserve。

完整 Runtime Composition 通过结构类型自然满足该 Port，不改变调用代码。

### 6. 增加架构守卫

修改：

- `scripts/quality/check-package-boundaries.mjs`；
- `scripts/quality/quality-gates.test.mjs`。

守卫要求：

- Greenfield Composition Root 不得重新实现 Host Control 方法；
- Root 不得直接读取 Hook、Extension、Context、Execution 或 Memory Session Index；
- Active Session Host 不得重新依赖完整 `GreenfieldRuntimeComposition`；
- Root 可以依赖两个专用 Control Factory。

## 测试补充

新增：

- `packages/coding-agent/test/runtime-core/greenfield-runtime-session-controls.test.ts`；
- `packages/coding-agent/test/runtime-core/greenfield-runtime-extension-controls.test.ts`。

测试覆盖：

- 控制面创建后新增的 Session Resource 仍然可见，确认使用实时索引；
- Hook、Context、Execution 与 Memory 调用准确委托；
- Conversation Source/Target 并行读取及投影参数正确；
- Hook、Context 与 Extension Bridge 缺失时保持原错误信息；
- Execution Runtime、Memory Controller 和 Extension Tool Runtime 缺失时保持原空操作或默认值；
- Extension Tool 与 Event Bridge 的解绑顺序不变。

## 功能兼容性核对

- `GreenfieldRuntimeComposition` 的方法名称和属性路径不变；
- CLI、Desktop、RPC 和 Child Composition 调用方式不变；
- Session create/resume、Hook 和切换事务行为不变；
- Extension Runner 绑定、动态 Tool 刷新和释放顺序不变；
- Session Context append/deliver 行为不变；
- fork 执行上下文 preserve/clear 行为不变；
- Memory Controller 不存在时仍返回 `0`；
- Background Runtime 不存在时仍安全完成；
- 所有控制操作继续读取实时索引，没有新增快照或缓存；
- Composition Shutdown 的所有权和释放顺序不变。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。控制面参数是进程内 TypeScript Port，不解析 JSON、配置、持久化记录、RPC payload 或外部协议输入。运行时 Schema 校验不会增加边界安全性。

## 验证结果

Runtime Host Controls 与 Active Session Transition：

```text
3 files passed
20 tests passed
```

CLI Runtime Composition、Memory 与 RPC 真实链路：

```text
3 files passed
33 tests passed
```

质量守卫：

```text
1 file passed
50 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2084 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

## 阶段结论

Greenfield Composition Root 已不再实现运行期宿主控制细节。Runtime Root 负责装配，Session/Extension Control Surface 负责按 Session ID 路由实时资源，Active Session Host 依赖消费者侧窄 Port；公共功能和宿主 API 均保持不变。

下一阶段应分析 Root 中剩余的 Bootstrap Input 校验、Repository/Projector 创建与 Conversation Ownership 装配，优先提取具有明确失败清理边界的 Bootstrap Assembly，而不是继续按单个条件或单个对象进行过细拆分。
