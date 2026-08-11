# Coding Agent 全面重写方案

## 核心结论

`coding-agent` 适合全面重写，但不适合采用“先删除旧代码，再集中开发新代码”的大爆炸方式。

建议采用以下策略：

> 保留外部行为和持久化数据作为迁移契约；在同一仓库中并行构建全新实现；完成契约测试、下游迁移和入口切换后，一次性删除旧实现。

最终目标：

- 旧 `coding-agent` 内部代码、目录结构和内部类全部删除。
- 新公开 API 只暴露稳定合同，不暴露 Manager、Registry 等实现对象。
- `coding-agent` 退回 Coding Profile 与 Composition Root。
- `runtime-core + agent-core + ai` 形成稳定内核。
- Tool、MCP、Skill、知识库等通过 Agent Feature 建立长生命周期资源，并通过
  Model Call Contribution 在每次模型调用前物化动态能力。
- IM、CLI、RPC、Desktop 只消费稳定 Session API。

## 文档索引

1. [范围、现状与基本边界](./01-scope-and-problem.md)
   - 重写假设、保留与舍弃范围。
   - 当前包职责和依赖方向问题。
   - 从模型原语定义最小内核。
2. [目标架构与核心合同](./02-target-architecture-and-contracts.md)
   - 目标分层和包职责。
   - Session、Runtime Snapshot、Agent Feature、Compiler 和状态机合同。
3. [执行 Pipeline 与抽象边界](./03-execution-pipeline-and-abstractions.md)
   - `Session State Machine + Typed Turn Pipeline + Tool Loop + Feature Compiler`。
   - 禁止万能 Middleware。
   - Port 抽象原则。
   - 上下文压缩和会话存储边界。
4. [包布局与公开 API](./04-package-layout-and-api.md)
   - 新目录布局。
   - `coding-agent` 根入口收缩。
5. [实施路线](./05-implementation-roadmap.md)
   - 从合同冻结到删除旧代码的完整阶段。
6. [测试策略与架构守卫](./06-testing-strategy.md)
   - Kernel、Pipeline、Compiler、Feature、上下文、存储和 Adapter 测试。
7. [数据迁移、风险与验收](./07-migration-risk-and-acceptance.md)
   - 数据版本、迁移、回滚、风险、Gate、首批任务和实施记录。
8. [实施日志](./08-implementation-log.md)
   - 索引；每轮实施单独成文，见 [`08-implementation-log/`](./08-implementation-log/)。
   - 按实施轮次记录实际修改、验证结果、未完成项和下一步。
   - 最新记录：[第 174 轮：自动 Legacy 回退策略门禁](./08-implementation-log/174-automatic-legacy-fallback-policy.md)。
9. [行为兼容性审计](./09-behavior-compatibility-audit.md)
   - 审计已实施模块与旧行为的差距。
   - 定义旧新差分测试和迁移 Gate。

## 建议阅读方式

- 评审架构边界：阅读 `01`、`02`、`03`。
- 评审代码组织：阅读 `04`。
- 制定实施任务：阅读 `05`、`06`、`07`。
- 跟踪实际进度：阅读 `08`、`09`。
- 正式开工前，至少确认 `07` 中的 Gate A 和首批实施任务。

## 与其他方案的关系

- [内核与能力边界分析](../02-core-boundary-analysis.md) 定义概念边界。
- [“内核 + 能力编排”重构方案](../03-kernel-capability-refactoring-solution.md) 适用于渐进式重构。
- [grok-build Agent 内部实现分析](../04-grok-build-agent-internals-analysis.md) 提供外部实现参考。
- 本文档集适用于已经决定舍弃旧内部实现的全面重写。
