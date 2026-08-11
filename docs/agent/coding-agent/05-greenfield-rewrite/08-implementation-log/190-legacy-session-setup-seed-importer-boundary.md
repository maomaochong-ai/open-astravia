# 第 190 阶段：Legacy Session Setup Seed Importer 边界

## 阶段目标

将 Extension `newSession.setup` 所需的旧 `SessionManager` 构造与会话格式迁移，从 Greenfield 活跃会话事务宿主中移出，收敛为显式兼容适配器。

本阶段只调整架构边界，不改变新会话 setup 的既有能力、持久化结果或 Extension API。

## 实施前判断

Greenfield 已是 CLI 和 Desktop 的默认运行路径，但还不能据此删除全部旧实现：

- 显式 Legacy 运行模式仍是受支持的生产能力；
- Extension `newSession.setup` 的公开回调参数仍是 `SessionManager`，直接改变会形成 API 破坏；
- 旧会话格式读取、历史查询和迁移属于数据兼容，不等同于继续使用 Legacy Agent 执行内核；
- `runtime-storage`、`runtime-tools` 根导出的反向兼容关系需要单独的破坏性变更决策，不在本阶段处理。

实际问题是 `greenfield-active-session-transition-host.ts` 同时承担了两类职责：

1. Greenfield 活跃会话切换、提交与失败回滚；
2. 创建临时 Legacy `SessionManager`、执行 Extension setup、再迁移为 Conversation V2。

第二类职责使事务宿主直接依赖 Legacy 执行对象和迁移细节，模糊了 Greenfield 内核与兼容层的边界。

## 目标结构

```text
Extension newSession.setup
        |
        v
Legacy Session Setup Seed Importer
  - 临时 SessionManager
  - setup 回调
  - 严格 V2 迁移
        |
        v
Greenfield Active Session Transition Host
  - 打开 V2 会话
  - 提交活跃会话
  - 失败回滚
```

事务宿主只依赖中性的 `CodingAgentGreenfieldSessionSeedImporter` 端口；Composition Root 决定是否注入 Legacy 兼容实现。

## 实施内容

### 1. 定义中性 Seed Importer 端口

在 Greenfield 活跃会话事务宿主旁定义：

- `CodingAgentGreenfieldSessionSetup`
- `CodingAgentGreenfieldSessionSeedImport`
- `CodingAgentGreenfieldSessionSeedImporter`

`newSession` 只有在存在 `setup` 回调时才需要 importer。没有注入时会明确失败，不会在 Greenfield 宿主内部隐式构造 Legacy 对象。

### 2. 新增显式 Legacy 兼容适配器

新增 `CodingAgentLegacySessionSetupSeedImporter`，集中负责：

- 创建临时 `SessionManager`；
- 保留 `parentSession` 与 setup 回调语义；
- 固化 setup 后的 header 和 entries；
- 使用既有严格迁移器写入目标 Conversation V2 会话；
- 关闭临时会话并删除临时目录。

该适配器是 Extension 旧 API 的格式桥接层，不属于 Greenfield Agent 执行内核。

### 3. 在 Runtime Composition Root 注入

CLI 的 Greenfield IM runtime host 显式创建并注入 `CodingAgentLegacySessionSetupSeedImporter`。因此生产能力保持不变，同时依赖方向变得可见。

### 4. 增加架构守卫

包边界检查新增约束，禁止 Greenfield 活跃会话事务宿主：

- 导入 `core/session-manager`；
- 导入 Legacy session import normalizer；
- 直接引用 `SessionManager`；
- 直接调用 `migrateLegacySessionToV2`。

守卫允许显式 Legacy 适配器使用这些兼容依赖。

## 行为保持说明

本阶段保留以下既有行为：

- Extension setup 仍接收真实 `SessionManager`；
- setup 写入的消息仍迁移到 Conversation V2；
- `parentSession` 语义保持不变；
- 成功后仍由 Greenfield backend 恢复并切换活跃会话；
- 失败时仍清理临时资源，并回滚目标会话；
- 工具、提示词、Skill、MCP、模型调用和普通无 setup 新会话行为均未改变。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。新增边界是进程内的 TypeScript 端口，没有新的不可信 JSON 输入；持久化格式仍由既有 Conversation V2 schema 与迁移器校验。额外运行时 schema 会重复现有职责。

## 验证记录

采用失败优先方式增加架构守卫测试：

- 守卫实现前：新增用例按预期失败，结果为 37 通过、1 失败；
- 守卫实现后：质量守卫测试 38/38 通过；
- Greenfield 活跃会话事务宿主测试 16/16 通过；
- CLI Greenfield IM runtime host 与 ecosystem hook 测试 20/20 通过；
- `bun run check:quick` 通过；
- 完整仓库 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

## 尚未解决的边界

以下事项需要后续独立阶段处理，不能在没有兼容策略时直接删除：

1. 是否以及何时移除显式 Legacy 用户运行模式；
2. Extension `newSession.setup(SessionManager)` 是否发布新版中性 API；
3. 旧会话 catalog、history、lease 等格式兼容模块的最终归属；
4. `runtime-storage`、`runtime-tools` 根导出兼容面的破坏性迁移；
5. 其余 Greenfield composition 对 `coding-agent/src/core` 的依赖分类与逐项收敛。

## 阶段结论

Greenfield 活跃会话事务宿主已不再直接拥有 Legacy SessionManager 的构造和格式迁移职责。旧 Extension setup 能力被保留在命名明确、由 Composition Root 注入的兼容适配器中，形成可测试、可守卫、可在未来单独替换的边界。
