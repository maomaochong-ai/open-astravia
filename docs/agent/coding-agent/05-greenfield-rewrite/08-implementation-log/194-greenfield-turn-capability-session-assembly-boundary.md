# 第 194 阶段：Greenfield Turn Capability Session Assembly 边界

## 阶段目标

将单个 Session 的 Prompt、Plugin、Continuation、动态工具面、Model Call Frame 与最终 Capability Profile 装配从 `greenfield-runtime-composition.ts` 抽取为独立的 Session-local Assembly。

本阶段只调整架构归属，不改变工具注册和动态可见性、系统提示词、Skill、Plugin、MCP、Todo、Memory、Hook、续跑、模型调用 Frame、上下文压缩或会话存储行为。

## 实施前问题

主 Composition Root 除了创建全局服务、会话基础设施和资源生命周期，还直接负责：

- Plugin Run Orchestrator 与 Plugin Tool Runtime；
- Todo、Plugin、Stop Hook 三类 continuation 的组合顺序；
- 注入式、共享式和默认 Prompt Runtime 的选择；
- System Prompt Resolver、Prompt Resource Resolver 与 Invoke Skill Feature；
- Coding Tools、Execution Tools、Product Tools、Todo、Memory、Subagent 和 Extension Tools 的动态工具面合并；
- Model Call Frame Composer 与最终 Agent Profile；
- Capability snapshot、初始系统提示词预览和 Prompt Adapter；
- conversation continuation 后的 Plugin Session identity 重绑定。

这些职责共同描述一个 Session 在一次 Turn 中可被模型观察和调用的能力，不属于全局 Composition Root 的拓扑编排。它们继续留在主文件会让全局资源生命周期与会话能力策略混在一起，也使 Prompt、Plugin、Tool Frame 和 Capability 的共同变化边界不可见。

## 目标边界

```text
Greenfield Runtime Composition Root
  - 创建全局服务和 Session 基础设施
  - 创建 Repository、Context、Model、Hook、MCP、Memory、Subagent
  - 提供 Session identity 与动态配置端口
  - 注册 rollback 和 session cleanup
                    |
                    v
Greenfield Turn Capability Session Assembly
  - Prompt runtime and resource resolution
  - Plugin run/tool orchestration
  - Todo/Plugin/Stop continuation chain
  - dynamic available-tool surface
  - model-call frame composition
  - final capability profile and snapshot
  - prompt adapter and initial preview
  - continuation session rebind
                    |
                    v
RuntimeCapabilityComposition / Agent Core Turn
```

Assembly 接收窄端口和已经创建的 Session-local runtime，不读取完整的 `GreenfieldRuntimeCompositionOptions`，也不创建 Repository、会话文档、模型目录、MCP supervisor、Memory controller 或 Subagent child composition。

## 实施内容

### 1. 新增 Turn Capability Session Assembly

新增 `greenfield-turn-capability-session-assembly.ts`，集中拥有：

- Plugin Session identity、Plugin Run Orchestrator 和 Plugin Tool Runtime；
- Todo、Plugin、Stop Hook continuation source 及原有顺序；
- Prompt Runtime 的注入、共享和默认资源加载三种路径；
- System Prompt Options、Prompt Resource 与 Invoke Skill 的解析；
- 每次模型调用读取的当前工具面；
- MCP prompt state、Plugin 动态效果、Hook、Extension 与系统提示词的 Model Call Frame；
- 最终 Agent Profile 和 `RuntimeCapabilityComposition`；
- Prompt Adapter、初始系统提示词预览、Session rebind 与关闭。

### 2. 收窄主 Composition Root

主文件删除上述具体装配，只保留：

- 创建基础 Profile 及各个 Session-local runtime；
- 将 Session identity、激活策略、Prompt 配置和 runtime 端口传给 Assembly；
- 将 Assembly 暴露的 capability、prompt adapter、available tools 和 plugin active tools 接入 Session resources；
- conversation continuation 成功后调用 Assembly 的 session rebind；
- rollback、session cleanup 和 composition dispose 时关闭 Assembly。

主文件由本阶段实施前的 1642 行降为 1473 行。迁出的 318 行不是新增功能，而是原有会话级能力装配的独立归属。

### 3. 保留 Turn 级动态语义

本阶段没有把动态能力固化为 Session 启动时快照：

- Coding Tool registry 仍在每次读取工具面时读取当前 snapshot；
- Execution、Extension、Plugin 和 MCP 工具状态仍在模型调用边界动态读取；
- active tool override、agent mode、agent plugins、MCP prompt state 和 Memory prompt 仍通过回调读取；
- Runtime Capability snapshot 仍只保存稳定的 Profile 结构，Model Call Frame 继续解析当前 Turn 的动态贡献；
- conversation continuation 后只重绑定需要 Session identity 的 Plugin Session，不重建全部 capability snapshot。

因此用户运行时新增或移除工具、Plugin、MCP、Skill 或 Prompt 资源的原有生效时机没有改变。

### 4. 架构守卫

质量门禁新增主 Composition Root 专用规则，禁止下列具体实现重新回流：

- Prompt Runtime、Prompt Adapter 和 Prompt Resource Resolver；
- Plugin Run Orchestrator 与 Plugin Tool Runtime；
- Todo、Stop Hook 与总 Continuation Orchestrator；
- Invoke Skill Feature；
- Model Call Frame Composer 和 Message Finalizer；
- Runtime Capability Composition；
- System Prompt addon 拼接、Plugin Tool activation 映射与初始 prompt preview。

守卫允许主文件依赖 `createGreenfieldTurnCapabilitySessionAssembly` 这一窄装配入口。

失败优先验证中，旧主 Composition Root 产生 32 个实际违规，证明守卫覆盖了本阶段要迁出的职责；完成迁移后实际仓库守卫通过。

## 功能兼容性核对

迁移逐项保留了原实现：

- Prompt Runtime 三种选择路径和错误文案不变；
- system prompt addon、Memory prompt 与 Agent Plugin 合并顺序不变；
- Plugin tool activation、一次 Turn 内的动态效果回放和 active tools 读取不变；
- Todo → Plugin → Stop Hook continuation 顺序不变；
- Coding、Execution、Product、Todo、Memory、Subagent 和 Extension 工具面合并不变；
- MCP 工具可见性、延迟激活和 prompt state 读取不变；
- Model Call Frame、Message Finalizer、Context Runtime、Conversation Projector 与 Extension Event Bridge 接线不变；
- capability lease、初始 prompt preview、rollback、session cleanup 和 composition dispose 语义不变；
- conversation continuation 后的 Plugin Session identity 更新不变。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。新增边界全部是进程内 TypeScript 对象端口，没有新增 JSON、RPC、MCP wire payload、配置文件或持久化输入。原有工具输入继续使用既有 Schema，外部数据继续由原来的边界校验。

## 测试与验证

- Turn Capability Session Assembly 合同测试：1/1 通过；
- CLI Runtime Composition、Plugin、Plugin Tool、Ecosystem Hook、Continuation 和 Runtime Host 回归：23/23 通过；
- 质量门禁测试：42/42 通过；
- `bun run check:quick` 通过；
- 完整 `bun run check` 通过，包括 Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫。

Assembly 合同测试覆盖：

- Product Feature 被编译进最终 capability snapshot；
- Context Strategy、Model Call Frame、Message Finalizer、Continuation 和 Extension Event Bridge 被保留；
- Execution 工具继续出现在动态 available-tool surface；
- Feature 工具不会错误混入 registration 驱动的 available-tool surface；
- continuation session rebind 入口可用；
- capability lease 和关闭生命周期可正常完成。

CLI 回归继续覆盖真实 Prompt、工具注册动态变化、Plugin 动态 prompt/tool/continuation、Hook 生命周期、Todo continuation、MCP 增删与延迟激活、系统提示词重编译、会话恢复和宿主能力动态重配置。

## 阶段结论

Turn 执行内核、工具实现和业务功能均未重写。变化只在装配归属：主 Composition Root 现在负责创建和连接服务，独立 Session Assembly 负责组合模型在当前 Session/Turn 可观察的能力。该边界把“内核 + 能力编排”的结构进一步显式化，并由合同测试、真实组合回归和架构守卫共同约束。
