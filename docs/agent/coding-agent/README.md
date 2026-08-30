# Coding Agent 架构分析

本目录记录 `packages/coding-agent` 的架构现状、主要问题与后续演进建议。

当前结论：`runtime-core` 已拥有产品无关的 Session、Turn、Feature、Session Extension、Context Strategy、生命周期与
Port 编排；`coding-agent` 负责 Prompt、Profile、Mode、Compaction 策略和具体产品 Feature；Node 文件、进程、Shell、
Sandbox 与 Desktop 命令实现由平台 Runtime 持有。历史上的组合边界混杂已按 ADR-0077 持续收敛，后续评估应区分
“产品 Feature 数量较多”和“通用机制或平台实现错误下沉”两类问题，不能再以目录规模直接判断核心所有权。

## 文档索引

- [工具选择边界与回归样例](../tool-routing-evaluation.md) — Tool、Skill、App Action 的实际说明入口、成对误用场景和模型评估范围。
- [Coding Agent 与多主 Agent 基座](../../../packages/coding-agent/docs/runtime-agent-base.md) — 当前生产链路、共享 Host、动态 revision、观测汇聚与生命周期使用说明。
- [架构现状与问题评估](./01-architecture-assessment.md) — 当前运行链路、量化证据、问题优先级、目标边界与渐进式重构建议。
- [内核与能力边界分析](./02-core-boundary-analysis.md) — 从模型原语出发，定义 Agent、Session、Capability、Adapter、Infrastructure 与 Profile 的边界。
- [“内核 + 能力编排”重构方案](./03-kernel-capability-refactoring-solution.md) — 目标架构、核心合同、能力迁移方式、实施阶段、测试策略与完成标准。
- [grok-build Agent 内部实现分析](./04-grok-build-agent-internals-analysis.md) — 分析 grok-build 的 Agent、Session Actor、Sampler、Chat State、Tool、MCP、Skill 与 Plugin，并提炼完全重构时应借鉴和避免的设计。
- [Coding Agent 全面重写方案](./05-greenfield-rewrite/README.md) — 按范围、目标架构、执行 Pipeline、包布局、实施路线、测试及迁移验收拆分的完整方案。

建议按编号顺序阅读：先确认当前问题，再统一内核定义，用 `grok-build` 的真实实现校验目标边界，最后根据是否选择全面替换决定执行 `03` 的渐进式方案或 `05` 的全面重写方案。

## 使用说明

早期评估文档保留当时的源码背景；当前所有权以 ADR-0075、ADR-0076、ADR-0077、源码架构守卫和最新迁移记录为准。
实施后续架构调整时，仍需补充兼容范围、测试基线和分阶段验收标准。
