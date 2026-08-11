# 第 214 阶段：Session Tool Overlay 与 SDK 动态工具

## 阶段目标

本阶段闭合旧 SDK 的 `tools`、`customTools` 和 `reconfigureCustomTools`，只重构架构，不改变既有功能语义：

1. `tools` 继续表示内置工具的显式激活名单，而不是把调用方传入的具体 Tool 实例注册到 Runtime；
2. `customTools` 继续使用旧 `ToolDefinition` 和 Extension 执行上下文；
3. 动态替换只影响下一次 Model Call，已经开始的 Turn 保持原 Tool Frame；
4. 自定义工具只属于创建它的 Session，不进入进程级 Coding Tool Registry；
5. 在 SDK 产品边界使用 TypeBox 校验 schema 和实际调用参数；
6. 不处理 Tracing、自定义 Subagent Factory 或公开工厂切换。

## 实施前基线

旧 Runtime Manager 的实际语义是：

- `CreateAgentSessionOptions.tools` 只读取工具名称，并过滤为内置工具激活集；
- 未传 `tools` 时按 Scenario、Capability 和 Agent Mode 解析激活工具；
- 显式传入空数组时没有内置工具被激活；
- SDK custom tool 与 Extension tool 进入同一个执行包装层，同名 SDK custom tool 覆盖 Extension tool；
- 未声明 `scope_use` 的本地可信 custom/extension tool 默认适用于所有场景；
- `reconfigureCustomTools` 整组替换定义并重建后续调用使用的工具面；
- 已经开始的调用持有旧 Tool 对象，不被运行中的替换修改。

Greenfield 已经具备调用级 `ModelCallFrame`，但 Extension Tool Runtime 只有进程级注册，没有 Session 私有
Overlay。因此不能把 SDK custom tool 直接放进全局 `CodingToolRegistry`，否则多个 Session 会互相看到工具，
也会把产品层 `ToolDefinition` 错误下沉到通用 Runtime。

## 架构决策

### 1. 两层工具目录

`CodingAgentGreenfieldExtensionToolRuntime` 现在维护两个互不混淆的层次：

- 进程层：Resource Loader 提供的 Extension tool，刷新时保持既有 first-wins 规则；
- Session 层：SDK 或其他产品宿主提供的 Session tool，按 `sessionId` 保存，整组原子替换。

读取某个 Session 的目录时，Session 层同名定义覆盖进程层定义。Overlay 不进入 Runtime Core，也不进入
共享 Coding Tool Registry。Session 继续或身份重绑定时，Runner 与 Tool Overlay 一起迁移；Session 释放和
初始化回滚时，Overlay 被清除。

### 2. Model Call Frame 是 Turn 一致性边界

动态替换不修改已经创建的 Runtime Tool 对象，也不追踪或撤销正在执行的 Tool Call：

- 当前 Model Call 在组合时捕获具体工具定义；
- `replaceSessionTools` 创建新的不可变注册数组并替换目录引用；
- 当前 Frame 继续执行旧定义；
- 下一次 Model Call 重新读取目录并捕获新定义。

这比全局可变快照更符合运行时动态变化语义：变化有明确生效边界，同时不会让一个 Turn 的模型看到的
schema 与实际执行定义不一致。

### 3. 初始工具在 Prompt 预览前注册

SDK Host 先把初始 `customTools` 适配为 Session 注册记录，再作为 Session 初始化参数交给 Composition。
初始化事务在创建 Prompt/Capability Assembly 前安装 Overlay，因此初始系统提示词预览、可用工具目录和
第一次真实 Model Call 看到同一组工具。

安装动作进入 `InitializationRollbackScope`，正常释放则由 Session Resource Lifecycle 清理，不依赖 SDK
宿主额外猜测 Runtime 内部状态。

### 4. 动态执行继续使用 Extension Runner

SDK Session 始终创建并绑定 Extension Event Host。即使初始没有 Extension 或 custom tool，后续同步调用
`reconfigureCustomTools` 也已有可用 Runner，因此旧的同步方法不需要改成异步。custom tool 执行仍获得原
`ExtensionContext`，并继续经过既有 Extension/Hook 调用包装。

### 5. TypeBox 只放在产品输入边界

`ToolDefinition.parameters` 本来就是 TypeBox `TSchema`，因此没有引入 Zod 或新的 schema 表达：

- 注册前使用 `TypeGuard.IsSchema` 检查参数 schema；
- 执行前使用 `Value.Check` 校验模型提供的实际参数；
- 校验失败提供稳定错误码、工具名、字段路径和 TypeBox 错误信息；
- 整组定义全部适配成功后才替换 Session Overlay，失败不会留下部分注册；
- Extension Runtime 和 Runtime Core 不依赖 SDK 错误类型，也不重复解释 schema。

## 本阶段实施记录

### Session Tool Runtime

- 为 Extension Tool Runtime 增加按 `sessionId` 隔离的注册目录；
- 增加 `replaceSessionTools`、`clearSessionTools` 和 Overlay-aware 查询；
- Session tool 同名覆盖 Extension tool，其他 Session 和进程目录不受影响；
- Model Call Compose、工具目录、激活集和 Plugin 基础工具保留判断均传入当前 Session 身份；
- Session continuation 原子重绑定 Tool Overlay 与 Extension Runner；
- Composition 无论是否存在 Extension 都创建轻量 Tool Runtime，使后续动态注册有稳定端口。

### 初始化与生命周期

- `GreenfieldRuntimeSessionOptions` 增加产品宿主已适配的 `sessionTools`；
- Session 初始化事务在 Prompt 预览前安装初始 Overlay，并登记失败回滚；
- Session 正常清理时清除当前身份的 Overlay；
- Composition Controls 增加 Session 工具整组替换和清除端口；
- 新增中立注册类型别名，Composition Contract 没有新增对具体产品 Core 的依赖。

### SDK 产品适配

- `tools` 映射为 `CodingToolActivation` 的 explicit 模式；
- `customTools` 在 SDK Host 中完成 TypeBox schema/input 校验和 Registered Tool 适配；
- 初始 custom tool 进入 Session 初始化参数；
- `reconfigureCustomTools` 进入固定 Session SDK 门面，并委托 Composition 的 Session Overlay 端口；
- SDK Extension Event Host 始终绑定，为运行期新增 custom tool 保留同步执行上下文；
- `tools`、`customTools` 和 `reconfigureCustomTools` 的兼容接线清单改为 `wired`。

## 保留的旧功能语义

- `tools === undefined`：继续使用 Scope/Capability/Agent Mode 激活；
- `tools: []`：显式不激活内置工具；
- `tools: [readTool]`：只按名称激活对应 Greenfield 内置工具，不使用传入实例替换实现；
- 显式 `tools` 模式下，未列入激活名单的 custom tool 仍可查询，但不会进入活动 Tool Frame；
- 普通模式下，无 `scope_use` 的 SDK custom tool 默认全场景可用；
- 同名 SDK custom tool 覆盖 Extension tool；
- `reconfigureCustomTools(undefined)` 清除 SDK Session Overlay，并恢复被覆盖的 Extension 定义；
- custom tool 的 `execute` 参数、更新回调、取消信号和 `ExtensionContext` 原样传递。

## 测试与验证

新增或更新的测试覆盖：

- SDK 显式空工具集和单工具子集；
- 初始 custom tool 的目录与激活状态；
- 动态增加、替换和删除；
- 显式内置工具模式下 custom tool 保持未激活；
- TypeBox 非法 schema 在注册前失败；
- 非法调用参数在进入用户 `execute` 前失败；
- 合法调用保留 Tool Call ID、Signal、Update Callback 和 Extension Context；
- 同名 Session tool 覆盖进程 Extension tool；
- 两个 Session 的 Overlay 相互隔离；
- 已捕获 Frame 在替换后继续使用旧定义，下一 Frame 使用新定义；
- Extension Controls 的替换、清除及缺失 Runtime 行为；
- SDK compatibility inventory 与固定 Session 门面接线状态。

验证结果：

- `bunx vitest --run test/runtime-core/greenfield-runtime-extension-controls.test.ts test/runtime-core/greenfield-extension-tool-runtime.test.ts test/sdk/coding-agent-sdk-custom-tools.test.ts test/sdk/coding-agent-sdk-host-adapter.test.ts test/sdk/greenfield-sdk-session-adapter.test.ts test/sdk/sdk-compatibility-inventory.test.ts`：6 个文件、27 项测试通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包含全仓 Biome、monorepo/CLI/Desktop/Admin 类型检查与全部架构门禁。

## 阶段结论

第 214 阶段完成了 SDK 动态工具的架构迁移：动态能力现在是“进程 Extension 目录 + Session 私有
Overlay + Model Call Frame 生效边界”，而不是修改全局 Registry 或重建整个 Runtime 快照。旧功能行为、
Extension 执行上下文和同步 SDK 方法均保留。

后续阶段应独立处理 Tracing 端口，或者处理 Subagent Type Registry/Session Factory。两者都不应借动态
工具机制进入 Runtime Tool Registry，也不应改变本阶段已经固定的 Session 隔离和 Turn 一致性合同。
