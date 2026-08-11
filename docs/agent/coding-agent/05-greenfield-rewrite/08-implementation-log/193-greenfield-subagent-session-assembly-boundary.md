# 第 193 阶段：Greenfield Subagent Session Assembly 边界

## 阶段目标

将父 Session 内的 Subagent 装配策略从 `greenfield-runtime-composition.ts` 抽取为独立 Session-local Assembly，使主 Composition Root 只负责提供宿主端口。

本阶段只重构架构，不改变七个控制工具、Subagent Profile、子会话目录、模型与 thinking 继承、MCP 继承、父上下文、Todo、Hook、通知、观察事件、恢复和清理行为。

## 实施前问题

主 Composition Root 同时拥有以下职责：

- Explorer/Workflow child composition 创建与恢复；
- `.subagents/<parentSessionId>` 存储策略；
- 父模型、thinking、cwd、scenario 和 MCP 继承；
- 单层委派约束；
- SubagentStart/SubagentStop Hook 映射；
- 通知上下文与 `subagents_update` 观察事件投影；
- 恢复 transcript 的父目录归属与文件存在性校验；
- child session、child composition 和 coordinator 的失败清理。

这些逻辑属于一个父 Session 的能力装配，而不是全局 Runtime Composition Root 的拓扑职责。继续保留在主文件中会让 Subagent 策略与 Todo、Memory、MCP、Extension 等其他能力的接线混在一起。

## 目标边界

```text
Greenfield Runtime Composition Root
  - 创建父 Session 基础设施
  - 提供当前 Session identity/path
  - 提供 model/thinking/MCP/readMessages
  - 提供 Hook 与 Resource Context
  - 提供 child composition factory
                    |
                    v
Greenfield Subagent Session Assembly
  - child profile policy
  - child create/resume mapping
  - storage layout and recovery validation
  - hook lifecycle mapping
  - notification/observation projection
  - Subagent runtime construction
                    |
                    v
GreenfieldSubagentRuntime / runtime-subagents
```

`runtime-subagents` 继续只负责通用协调、状态和生命周期；Coding Agent 的 Profile、工具激活、MCP、Session 存储与 Hook 组合仍属于产品 composition 层，没有下沉到通用内核。

## 实施内容

### 1. 新增 Session-local Assembly

新增 `greenfield-subagent-session-assembly.ts`，集中拥有：

- 是否启用与并发上限；
- child session create/resume；
- Explorer/Workflow activation 与 MCP 合并；
- 当前父 Session id/path 的动态读取；
- child transcript 路径与恢复校验；
- Subagent Hook lifecycle；
- notification 与 observation 投影；
- child composition 异常和正常清理。

Assembly 只接收窄端口，没有依赖完整 `GreenfieldRuntimeCompositionOptions`，也没有反向导入主 Composition Root。

### 2. 收窄主 Composition Root

主文件删除了 Subagent child factory、Hook lifecycle、恢复校验和事件投影实现，只保留：

- 父 Session 资源创建；
- child composition 的递归 composition 接线；
- model、thinking、MCP、repository、Hook 和 resource context 端口注入；
- Assembly runtime 的 rollback 与 session cleanup 注册。

child composition 仍显式设置 `enableSubagents: false`，保持原有单层委派行为。

### 3. 保留动态 Session 身份语义

审计发现 `activeSessionId` 会在 conversation continuation 后重绑定。Assembly 因此没有缓存父 Session path 或 Hook turn id，而是通过回调在实际 child create/resume 和 Hook 执行时读取当前值。

协调器的 `parentSessionId` 仍按原实现于父 Session Assembly 创建时固定，未改变持久化 ownership 合同。

### 4. 架构守卫

质量门禁新增主 Composition Root 专用规则，禁止其重新拥有：

- `GreenfieldSubagentRuntime` 和 child handle 构造；
- runtime-subagents child/lifecycle/snapshot/type 定义；
- SubagentStart/SubagentStop Hook 映射；
- `.subagents` 路径策略；
- `subagent-notification` 与 `subagents_update` 投影；
- recovered transcript 校验。

守卫允许主文件依赖 `createGreenfieldSubagentSessionAssembly` 这一窄装配入口。

## 功能兼容性核对

迁移逐项保留了原实现细节：

- 七个控制工具及其 TypeBox Schema、名称、描述和返回协议不变；
- Explorer 仍为只读工具面，Workflow 仍继承父上下文并启用 Todo；
- 父模型、thinking、cwd、scenario 与 MCP 继承不变；
- child transcript 仍位于 `.subagents/<parentSessionId>`；
- Hook turn id、阻断文案和 continuation 拼接不变；
- notification context 与 observation payload 不变；
- recovery 错误文案、路径比较和文件校验不变；
- child session id、session file、context delivery 和 dispose 语义不变；
- child composition 创建失败时仍先清理 composition，再传播错误。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。新增边界由进程内 TypeScript 函数与对象端口组成，没有新增 JSON、RPC、MCP wire payload 或持久化输入。已有 Subagent 工具输入继续使用原 TypeBox Schema，恢复输入继续由既有文档状态恢复合同处理。

## 验证记录

失败优先基线：

- 架构守卫接入后，旧主 Composition Root 产生 31 个实际违规；
- 违规覆盖 child factory、Hook、路径、通知、观察和恢复校验，证明守卫能够识别本阶段目标边界。

实施完成后：

- 新 Session Assembly 合同测试：2/2 通过；
- Subagent workflow 与 Assembly 合同测试：16/16 通过；
- CLI Greenfield Subagent 真实会话回归：3/3 通过；
- 质量门禁测试：41/41 通过；
- `bun run check:quick` 通过；
- 完整 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

CLI 回归继续覆盖：

- 七工具兼容和 child notification 闭环；
- Explorer 工具面与不可递归委派；
- Workflow 父上下文、coding tools 和 Todo；
- parent-indexed recovery；
- delivery claim 保留；
- child transcript lazy reopen；
- transcript 缺失失败投影。

## 阶段结论

Subagent 的通用运行时没有被重写，产品功能也没有变化。变化仅在装配归属：主 Composition Root 现在通过窄端口组合独立的 Session-local Subagent Assembly，Subagent 策略、恢复和事件投影不再与其他能力接线混杂，并由架构守卫防止回流。
