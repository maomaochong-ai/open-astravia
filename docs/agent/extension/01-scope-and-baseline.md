# 范围、方法与版本基线

## 评审对象

本评审中的“Vetta”主要指以下实现：

- `@vetta/coding-agent` 的公开 SDK、Extension API、资源加载与宿主组合；
- `runtime-core`、`runtime-tools`、`runtime-mcp`、`runtime-subagents`、`runtime-storage`、`runtime-telemetry`；
- Desktop Plugin SDK、manifest、权限与 capability runtime；
- CLI、Desktop、IM/RPC 等宿主如何消费这些能力。

“Pi”指公开仓库的生产 `packages/coding-agent`、`packages/agent`、Pi Package/Extension 文档及实现；实验性的 `pi-protocol`、`pi-client`、`pi-server` 和 AgentHarness v2 单独标注。

按本次架构决策，Desktop Plugin 采用开放的受信 Renderer/Module Federation 模式评价；扩展执行隔离不纳入本次能力评分或路线建议。

## 固定版本

| 对象 | 版本/提交 | 提交时间 | 用途 |
| --- | --- | --- | --- |
| Vetta | `972647ba26f2bea3f70b3eb2fc1bc9547567235d` | 2026-08-10 | 当前实现基线 |
| Pi current | `936aff00918de1187f085f123c2812d8f2d67745`，package `0.84.1` | 2026-08-09 | 当前对比基线 |
| Pi historical | tag `v0.14.2`，`33a2bcf2031f732a1305b19721b97c69e9bf2c02` | 2025-12-08 | 重写来源的近似历史基线 |

Vetta 的历史 fixtures 中保留了 Pi `0.14.2` 及原始 `pi-mono` 路径信息，因此本评审以 `v0.14.2` 作为“从 Pi 重写”的可验证近似点。它不等价于逐提交的 fork-base；若要做代码血缘审计，应另行使用完整 Git 历史做 patch-id/内容相似度分析。

Pi 上游地址以 [earendil-works/pi](https://github.com/earendil-works/pi) 为准；旧的 `badlogic/pi-mono` 地址会重定向。所有上游源码引用均固定到上述 SHA，防止 `main` 后续变化让结论失真。

## 评价口径

“扩展性”拆为四类，不只统计公开方法数量：

1. **外部扩展性**：第三方能否添加工具、命令、Provider、资源、UI 与分发包。
2. **内部扩展性**：新增运行时能力是否需要修改核心循环，包依赖是否保持单向，是否可用 port/feature/composition 插入。
3. **运行时扩展性**：热注册、热卸载、会话切换、并发执行、失败恢复和 in-flight 语义是否明确。
4. **治理扩展性**：来源、版本、权限、信任、冲突、兼容、观测和测试合同是否可持续。

评分采用 5 分制：

| 分数 | 含义 |
| --- | --- |
| 1 | 基本没有扩展合同，主要依赖改核心代码 |
| 2 | 有局部扩展点，但生命周期、治理或覆盖面明显不足 |
| 3 | 能用于生产，存在较明显的宿主绑定或合同缺口 |
| 4 | 边界清楚、覆盖充分，仅有少数重要缺口 |
| 5 | 机制统一、动态语义和治理成熟，且有充分文档与验证 |

评分是架构评审判断，不是基准测试；具体证据与例外放在[分维度评审](03-dimension-review.md)和[证据索引](06-evidence-index.md)中。

## 方法与限制

- 以源码、`package.json#exports`、类型定义、测试和 changelog 为事实源；README 只作补充。
- 比较的是两个固定快照，不代表未来版本。
- 未运行两个仓库的跨仓行为测试；结论来自静态合同、实现路径和现有测试覆盖分析。
- 没有评价社区规模、下载量或维护组织，只评价实现与作者体验。
- Pi 的 AgentHarness v2 和 remote protocol 明确区分“已生产使用”“实验可用”“设计/脚手架未完成”三种状态。
