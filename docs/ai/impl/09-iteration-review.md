# 三轮实施复盘与方案调整

## 第一轮：先复制 Vercel AI 的测试形态

初始方向是建立 scripted model、controlled stream 和统一 provider transport。这些做法有效解决了真实凭据测试不可重复、abort 难控制和请求参数难断言的问题。

复盘后发现，仅有 mock model 容易把 Provider adapter 自己 mock 掉。因此调整为两类测试并存：Agent 功能测试使用 scripted model；Provider 测试必须从原生 Request/Response/ReadableStream 进入真实 request builder 和 stream parser。

## 第二轮：从“Provider 能注册”改为“Provider 契约可证明”

最初 14 个内置 API 都进入新 Registry，看起来具备统一扩展点。但这只证明分发和重复注册规则，不能证明 wire validation、错误分类和 abort 语义。

因此把 Phase 3 完成标准提高为每个协议族必须有脱敏 fixture、TypeBox 入站 schema、共享 conformance 和最小 live canary。当前只有两个试点满足 deterministic 主体，文档明确保持 Phase 3 进行中。

Vercel AI 的 Provider 测试值得参考，但其规模和多套 generate/stream 对称案例不应机械复制。本仓库更适合以协议族复用 parser harness，并用少量 Provider 特有 fixture 保留差异。

## 第三轮：从 prompt diagnostics 改为最终调用生命周期

第一版上下文占用设想从 prompt 编译器直接统计，这会漏掉 transform/finalizer、compaction、current input 和工具 schema。第二版把 provenance 放入 `ModelCallFrame`，但跨 workspace 测试暴露了一个现实问题：运行时会解析已构建包，而类型检查使用源码 path map，新导出可能出现类型存在、运行时尚未构建的错位。

最终调整为：

- 产品组合器只用 type-only Runtime contract 生成 provenance。
- Runtime Core 在自己的 Provider stream 边界包装生命周期。
- 报告使用最终 Provider-facing Context。
- completed report 必须在终态事件交付前发布，确保随后 usage observation 读到最新值。

这比在 Desktop 本地估算或在 prompt builder 统计更复杂，但它让报告和真实模型输入可对账，并保持敏感正文不跨 Host/IPC。

## 当前最优长期方向

1. 保持 AI protocol、Adapter、Agent Engine、Runtime Session 四层单向依赖。
2. Provider 迁移按协议族完成，不按文件数量制造完成度。
3. 新 Engine 先补齐产品语义和差分矩阵，再替换 production loop。
4. Context provenance 由贡献者声明，Runtime 校验最终上下文，UI 只投影报告。
5. TypeBox 用于 JSON Schema、工具入参和外部 wire 边界；不同时引入 Zod。内部不可变对象依靠 TypeScript 与构造函数保持约束。
6. Phase 7 的删除必须等待真实发布周期和 canary 证据，不能在单次重构中伪造满足。

