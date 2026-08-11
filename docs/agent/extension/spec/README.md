# Pi Extension 行为子集兼容实施方案

本方案的上游事实基线为 Pi `@earendil-works/pi-coding-agent@0.84.1`、commit `936aff00918de1187f085f123c2812d8f2d67745`。它是首个兼容 profile 的输入，不表示对该版本全部 API 作整体承诺。

## 决策摘要

目标是在 Vetta 中运行只依赖双方共有行为合同的 Pi Extension，并消费 Pi Package 中适合 Vetta 的资源；目标不是完整适配 Pi Extension API，不复制 Pi 的 `coding-agent/src/core`，也不兼容 Pi TUI。

推荐方案是建立 **Pi Extension Anti-Corruption Layer**：

```text
Pi source module
  -> Pi module facade / ExtensionAPI facade
  -> registration draft
  -> validate + normalize + compatibility assessment
  -> canonical Extension Contribution IR
  -> atomic publish
  -> existing Vetta Extension/Runtime ports
```

但实施顺序是 **Vetta native-first**：先把 catalog/generation、Tool 输入与 prompt、生命周期事件、Provider ownership 和结构化交互做成 Vetta 原生能力，再接入 Pi facade。Pi 兼容层不得拥有 Vetta native 尚不存在的 Tool 调度、事件或 Provider 生命周期。

核心约束：

- 只有一条 Agent、Tool 和 Session 执行路径；Pi Extension 最终进入 Vetta 现有 Runtime。
- Pi 与 Vetta 的作者 API 都编译成同一套 canonical contribution，不在 Runner 中长期维护两组分支。
- 每个新增能力先由 Vetta native Extension fixture 验证；删除 `pi-compat` 后这些能力仍应完整成立。
- 兼容以 capability 为单位，不宣称“兼容所有 Pi `0.84.1` Extension”。
- 首个 profile 只覆盖 Tool、共有事件、Command、会话/模型/工具动作、事件总线、配置型 Provider、Skill/Prompt 和少量结构化交互。
- `pi-tui`、Theme、Component、renderer、widget、header/footer、terminal input 和其他展示注入明确排除，后续路线也不预留 TUI bridge。
- 兼容报告必须区分 `lossless`、`adapted`、`host-dependent`、`excluded`、`unsupported`，不能静默降级。
- project-local Pi Extension 在执行模块代码前必须经过 project trust；兼容不扩大信任边界。
- 扩展采用开放的受信代码执行模型；兼容层负责 trust、能力评估和生命周期，不宣称提供代码隔离。
- TypeBox 1 只作为 Pi authoring/runtime facade；跨边界归一化成带 dialect 的 plain JSON Schema，Vetta native TypeBox 0.34 暂不迁移。
- Zod 不用于重复描述 Tool Schema 或内部 contribution；只有未来复杂配置需要 preprocess/transform/refine 时才复用现有 Zod。

## 为什么不直接映射到当前 Vetta ExtensionAPI

直接把 Pi 包名 alias 到 `@vetta/coding-agent` 能很快跑通少量扩展，但会产生四个问题：

1. 同名 API 的参数和生命周期已经分叉，静态类型相似不代表运行时兼容。
2. Pi current 使用 `typebox@1.3.7`，Vetta native Extension 使用 `@sinclair/typebox@0.34`；直接共享对象会隐藏 Schema 方言和运行时校验问题。
3. Pi 的 `SessionManager`、`ModelRegistry` 等具体类型不应进入 Vetta 稳定领域合同；Pi TUI 类型不进入 facade。
4. 加载失败、半注册和 reload 可能污染活动目录，难以做原子回滚。

因此，包名 alias 只负责“让模块可以导入”，真正的兼容发生在 facade、normalizer 和 contribution compiler 中。

## 交付物导航

1. [兼容目标与功能范围](01-compatibility-scope.md)
2. [Vetta 原生能力先行方案](07-vetta-native-first.md)
3. [目标架构与模块划分](02-target-architecture.md)
4. [TypeBox、Zod 与运行时校验策略](03-schema-and-validation.md)
5. [加载、生命周期与功能适配](04-runtime-semantics.md)
6. [测试、阶段和验收标准](05-testing-and-delivery.md)
7. [Pi 设计复盘与替代方案](06-pi-design-review.md)
8. [首轮实施状态与未完成边界](08-implementation-status.md)

## 最终建议

首轮已经完成 Runtime validator、native Tool normalize/prompt、Tool generation catalog 和最小 Pi Tool ACL，准确范围见[实施状态](08-implementation-status.md)。下一步应补原生 lifecycle/Provider ownership，再扩展“共有事件 + 命令 + 会话动作 + 资源”的 Pi 行为映射。结构化交互仅支持 `notify/select/confirm/input`。Pi TUI 不进入任何阶段；完整原生 Provider 和任意请求拦截也不属于首个 profile。兼容率必须由固定的非 TUI corpus 计算，而不是由 API 名称对齐率计算。
