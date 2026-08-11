# 第 187 阶段：Provider 差异测试的宿主能力基线

## 阶段目标

在不修改 Legacy 与 Greenfield Runtime 功能的前提下，消除 Provider 差异测试中由宿主能力配置不一致造成的伪差异，并验证工具、提示词与附件 Host Bridge 行为仍然等价。

## 分析结论

`startAgentRpc()` 的默认测试配置同时隐含了两个不同维度：

- Runtime backend：`legacy` 或 `greenfield-im`；
- Host capability profile：是否启用 Host Bridge，以及使用哪个运行场景。

原差异测试只切换 backend，却沿用了不同的默认 Host profile：Greenfield 默认启用 `im-claw` Host Bridge，Legacy 默认不启用。因此 `im_send_attachment` 工具、桌面文件链接规则和附件请求链路的差异来自宿主能力，不是 Runtime 实现差异。

正确的差异测试矩阵应固定 Host profile，只替换 Runtime backend。Runtime 与宿主能力是两个正交维度，不能由 backend 名称隐式绑定。

## 本阶段实施

修改 `packages/cli-app/test/agent-runtime-provider-differential.test.ts`：

1. 增加类型受约束的共享配置 `PROVIDER_DIFFERENTIAL_HOST_OPTIONS`，统一启用 Host Bridge 并使用 `im-claw` 场景；
2. 将共享配置应用到主测试进程、上下文压缩后的重启进程，以及迁移会话后的重启进程；
3. 为整组 Provider 差异测试设置 30 秒超时，覆盖两个 backend 和 Host Bridge 进程在全量并行测试负载下的合理执行时间；
4. 未修改 Legacy adapter、Greenfield adapter、工具注册、提示词生成或附件处理生产代码。

没有引入 TypeBox 或 Zod。这里处理的是内部测试组合参数，现有 `StartAgentRpcOptions` 静态约束已经足够，不存在需要运行时解析的不可信输入边界。

## 验证结果

- Provider 差异测试独立运行：11/11 通过；
- 失败文件单 worker 隔离复核：Provider 差异、Runtime 选择、旧会话回退共 30 项通过；
- CLI 全量测试在修改超时前：204/210 通过；其中 Provider 的 2 项是默认 5 秒超时，Runtime 选择与旧会话回退各 1 项只在并行负载下超时，另外 2 项稳定失败仅存在于既有命令准入差异测试；
- CLI 全量测试在修改超时后：207/210 通过，Provider 差异测试全部通过；剩余 2 项命令准入稳定失败和 1 项已隔离通过的 Runtime 选择并行超时；
- `bun run check:quick`：通过。
- `bun run check`：通过，包含 Biome、monorepo 与 CLI/desktop-app/admin 类型检查及质量守卫。

命令准入差异测试的两个独立失败分别是 Legacy 异步关闭审计顺序不符，以及等待 Host Response 时未收到 RPC frame。它们不涉及本阶段修改文件，应作为后续独立阶段分析，而不是通过放宽本阶段断言掩盖。

## 阶段结果

Provider 差异基线现在显式表达为“相同宿主能力、不同 Runtime backend”。工具、提示词、附件与重启场景不再受到测试启动器默认值干扰，生产功能保持不变。
