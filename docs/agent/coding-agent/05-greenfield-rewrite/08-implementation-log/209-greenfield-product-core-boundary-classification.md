# 第 209 阶段：Greenfield 产品 Core 边界分类与收窄

## 1. 阶段目标

本阶段不重构功能，也不删除兼容 API。目标是把 Greenfield 代码仍然存在的产品 Core 依赖从“一个总数”拆成可解释、可约束的架构边界，并消除 Composition 合同对具体旧实现类型的泄漏。

成功标准：

1. 逐项审计 Greenfield 对 `packages/coding-agent/src/core` 的静态依赖；
2. Composition 对 Extension 运行器和工具来源只依赖窄端口；
3. 剩余依赖按职责分类，新增依赖不能无分类进入；
4. Greenfield 不得重新依赖旧 `AgentSession` 或旧 SDK 执行入口；
5. 原有 Extension、CLI、Desktop 运行行为保持不变；
6. 定向测试和根级完整质量门禁全部通过。

## 2. 审计结论

实施前共有 98 条 Greenfield 到产品 Core 的静态导入边：

| 来源职责 | 数量 | 结论 |
| --- | ---: | --- |
| 产品适配器 `adapters/runtime-core` | 84 | 合理。这里负责把现有 coding-agent 产品能力适配到中立 Runtime 合同，不应把 Skill、Tool、Knowledge、Settings 等产品实现搬入内核。 |
| Composition 装配 | 10 | 其中 5 条是具体 Core 类型泄漏，需要收窄；其余 5 条属于当前产品装配边界。 |
| RPC 宿主适配 | 4 | 合理。RPC 是宿主协议兼容层，不属于中立 Runtime 内核。 |

审计同时确认：这 98 条边没有导入旧 `core/agent-session.ts` 或 `core/sdk.ts`。因此本阶段不存在需要立即删除的 Legacy 执行依赖，问题集中在 Composition 合同暴露了 `ExtensionRunner`、`Extension` 和 `TodoLockSource` 等具体产品类型。

## 3. 实施内容

### 3.1 建立 Extension 窄端口

新增 `greenfield-extension-contract.ts`，定义两个结构化端口：

- `CodingAgentGreenfieldExtensionRunnerPort`：只保留 Greenfield 实际使用的上下文创建、事件分发和处理器查询能力；
- `CodingAgentGreenfieldExtensionToolSource`：只暴露动态 Extension 工具刷新所需的 `tools` 字段。

端口定义位于产品适配器层。这样 Runtime/Composition 依赖的是“需要什么能力”，具体 `ExtensionRunner` 和 `Extension` 仍由 coding-agent 产品实现并注入。动态注册、刷新和运行时变化语义没有改变。

### 3.2 收窄 Composition 合同

调整 Greenfield Runtime Composition 合同及 Extension 控制器：

- `bindExtensionRunner` 改为接收窄运行器端口；
- `extensionTools` 与 `refreshExtensionTools` 改为接收窄工具来源；
- 初始 Todo 锁来源改为 Composition 自己的字面量合同 `GreenfieldInitialTodoLockSource = "scene"`；
- 通过现有 barrel 导出新端口和新合同，保持调用方导入路径稳定。

本次只改变静态依赖方向和类型表面，没有改变方法名、调用顺序、事件语义、工具动态刷新策略或会话行为。

### 3.3 建立产品 Core 边界分类守卫

扩展 `check-legacy-execution-retirement.mjs`，将 Greenfield 产品 Core 边分为：

- `product-adapter`：产品能力适配器；
- `composition-wiring`：产品 Composition 装配；
- `rpc-host-adapter`：RPC 宿主兼容适配。

本阶段完成后的基线为 93 条：

| 分类 | 基线 |
| --- | ---: |
| `product-adapter` | 84 |
| `composition-wiring` | 5 |
| `rpc-host-adapter` | 4 |

守卫执行以下约束：

1. 未分类的 Greenfield 产品 Core 依赖直接失败；
2. 任一分类超过基线直接失败；
3. 数量减少允许通过，因此该基线是单调收敛预算，不是运行时快照；
4. Greenfield 导入旧 `agent-session` 或 `sdk` 直接失败；
5. Composition 的 `*-contract.ts` 再次直接导入产品 Core 直接失败。

这里记录的是源码架构边，不缓存运行时 Tool、Prompt、Skill 或知识资源，因此不会限制用户在运行时添加、删除或刷新能力。

## 4. 测试与验证

新增或调整的守卫测试覆盖：

- 三类合法边的识别与精确预算；
- 未分类依赖拒绝；
- 旧 `AgentSession` 依赖拒绝；
- Composition 合同重新泄漏具体 Core 类型时拒绝。

验证结果：

- `legacy-execution-retirement.test.mjs`：8 项通过；
- coding-agent Extension 事件桥、工具运行时和控制器：10 项通过；
- CLI Greenfield Runtime Host 定向回归：3 个文件、21 项通过；
- Desktop 模型调用帧差异回归：1 个文件、10 项通过；
- `bun run check:quick`：通过；
- `bun run check`：通过，包括 Biome、根类型检查、CLI 类型检查、Desktop `tsc`、Admin `tsc -b` 和全部质量守卫；
- 最终架构守卫结果：0 条 Legacy 执行边、8 条保留格式边、93 条已分类 Greenfield 产品 Core 边。

## 5. 阶段结论

本阶段把“Greenfield 仍导入 Core”从模糊债务拆成了三类明确边界。产品适配器保留产品能力，Composition 不再对外暴露 Extension 的具体实现类型，守卫确保后续依赖只减不增，并阻止旧执行内核重新进入 Greenfield。

功能兼容性保持不变：Extension 事件、动态工具注册和刷新、CLI 会话、Desktop 模型调用帧均通过原有行为回归。

## 6. 下一阶段入口

第 210 阶段应处理公开 SDK 的兼容迁移，而不是继续机械减少适配器导入：

1. 固化 `createAgentSession` 与 `runRpcMode(session)` 的公开行为、类型和事件基线；
2. 在 Greenfield Composition 之上实现 SDK 兼容门面；
3. 用同一组合同测试同时验证旧入口和 Greenfield 门面；
4. 只有在行为、错误、取消、事件和会话恢复全部等价后，才移除旧 `AgentSession` 执行实现；
5. 产品能力适配器继续留在适配层，不把 coding-agent 业务能力下沉到 Runtime Core。

该顺序可以把最终删除旧内核变成有行为证据的切换，而不是以减少导入数量为目标的结构改写。
