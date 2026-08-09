# AI 与 Agent 长期重构方案

本目录给出 `packages/ai` 与 `packages/agent` 的长期重构方案。分析范围不止两个包本身，还包括实际承载产品运行时的 `packages/runtime-core`、工具定义层 `packages/runtime-tools`，以及 `packages/coding-agent`、`packages/desktop-app`、`packages/cli-app` 等上游应用。

## 核心结论

1. `packages/ai` 应保留为 Provider 中立的模型调用门面，但需要把协议、Provider 适配、模型目录、流式生命周期和公共工具拆成清晰模块。
2. `packages/agent` 不应再次扩张为 Session Runtime。生产路径的 Session、Turn、持久化、上下文、输入队列和工具策略已经由 `packages/runtime-core` 负责。
3. 保留 `@vetta/agent-core` 作为无持久状态的模型-工具执行引擎；现有 `Agent` 类移到 standalone 兼容子路径，满足退出条件后删除。
4. 不立即复制 Vercel AI SDK 的多包规模。先在现有包内形成可验证的模块边界，只有出现独立版本、独立消费者或独立发布需求时才拆新 workspace 包。
5. TypeBox 用于工具输入和 JSON Schema 协议边界；Zod 只用于确实需要预处理、转换、默认值和迁移的配置边界；内部领域对象只用 TypeScript。禁止同一个对象同时维护 TypeBox、Zod 和手写类型三份定义。
6. 重构必须以契约测试、Provider 功能一致性测试、Agent 场景测试、Runtime 集成测试和新旧实现差分测试作为迁移前提，而不是重构完成后的补充工作。

## 文档状态

方案按三轮分析迭代：

- 第一轮：以当前仓库的实际依赖和职责为准，建立目标边界。
- 第二轮：参考本地 `C:\develop\github\ai` 的 Provider、schema 和功能测试实现，反审第一轮。
- 第三轮：从迁移风险、上游维护成本、兼容期和五年尺度的演进能力收敛最终方案。

三轮分析均已完成。迭代过程与修改理由记录在 [00-iterations.md](./00-iterations.md)，其余文档是收敛后的最终建议。

## 文档导航

- [00-iterations.md](./00-iterations.md)：三轮方案演进和被否决的方向
- [01-target-architecture.md](./01-target-architecture.md)：职责边界、模块划分和依赖方向
- [02-packages-ai-refactor.md](./02-packages-ai-refactor.md)：`packages/ai` 的协议、Provider、Registry 和流式生命周期
- [03-agent-runtime-refactor.md](./03-agent-runtime-refactor.md)：Agent Engine 与 Runtime 的职责重组
- [04-schema-and-validation.md](./04-schema-and-validation.md)：TypeBox、Zod、TypeScript 的使用边界
- [05-testing-strategy.md](./05-testing-strategy.md)：功能测试、契约测试、差分测试和 canary
- [06-context-observability.md](./06-context-observability.md)：系统提示词、skill、工具和历史消息的 token 组成报告
- [07-upstream-migration.md](./07-upstream-migration.md)：Runtime、Coding Agent、Desktop、CLI 和共享类型迁移
- [08-delivery-roadmap.md](./08-delivery-roadmap.md)：分阶段实施、测试门禁与兼容层退出条件
