# Vetta 与 Pi 扩展性评审

本目录比较 Vetta 当前实现与 Pi 当前实现的扩展能力，并追踪 `coding-agent` 从早期 Pi 分支重写之后 Pi 新增的关键能力。结论面向架构决策，不以 API 名称数量代替可扩展性，也不把 Pi 的实验性设计当成已交付能力。

## 结论摘要

- **Vetta 更像可嵌入的 Agent 平台**：运行时拆成 `runtime-*` 包，`coding-agent` 负责产品组合，Desktop Plugin 还有独立的权限与 capability 体系。它在宿主无关性、内部边界、MCP、subagent、动态工具目录和多宿主集成上更强。
- **Pi 更像可自定义的终端产品**：Extension、Skill、Prompt Template、Theme、Pi Package 形成一套较统一的作者模型。它在扩展开发体验、TUI 注入、包分发、资源溯源、Provider 动态注册和项目信任防护上更成熟。
- Vetta 的主要问题不是“扩展点少”，而是 **Coding Extension、Desktop Plugin、Runtime Feature/Port、Agent Plugin、MCP、Hook 等机制缺少统一分类、生命周期和冲突规则**。平台能力很强，但外部作者很难快速判断应使用哪一层。
- Pi 自早期基线之后最值得 Vetta 吸收的不是它的单体 `core`，而是项目信任、扩展代际失效、动态注册语义、统一 `sourceInfo`、包管理事务、Provider 拦截、流式 delta 协议等合同级改进。
- Pi 的 AgentHarness v2 展示了 durable run、lane、effect boundary、原子 snapshot + live events 等有价值方向，但当前仍是未完成实现；现阶段只适合作为设计输入，不应直接迁移或作为评分中的已交付能力。

## 文档导航

1. [范围、方法与版本基线](01-scope-and-baseline.md)
2. [架构与扩展模型](02-architecture-and-extension-models.md)
3. [分维度评审](03-dimension-review.md)
4. [Pi 在重写基线后的关键更新](04-pi-updates-since-rewrite.md)
5. [差距与采纳路线](05-gap-and-adoption-roadmap.md)
6. [证据索引](06-evidence-index.md)

## 实施方案

准备进入实现时，以 [Pi Extension 行为子集兼容实施方案](spec/README.md) 为入口。方案采用 Vetta native-first：先增强原生 contribution catalog、Tool、生命周期、Provider ownership 和结构化交互，再通过 Anti-Corruption Layer 映射 Pi 行为子集；明确不兼容 Pi TUI，也不让兼容层拥有第二套 Runtime。方案同时说明模块划分、TypeBox/Zod 取舍、测试矩阵和分阶段交付。

## 建议如何使用本评审

- 做近期迭代：从 [P0/P1 路线](05-gap-and-adoption-roadmap.md#建议路线) 选择合同级修复，不要先做大规模 API 搬运。
- 设计新扩展点：先用 [扩展机制选择表](02-architecture-and-extension-models.md#vetta-扩展机制选择表) 确定归属层，再检查宿主覆盖、权限、生命周期与冲突策略。
- 评估 Pi 新提交：先判断它属于生产 `coding-agent`、实验性 remote protocol，还是未完成的 AgentHarness v2，三者成熟度不同。
