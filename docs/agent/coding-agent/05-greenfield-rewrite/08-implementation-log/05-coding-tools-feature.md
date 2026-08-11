# 实施日志：第一个独立 Coding Tools Feature

本文件记录第一个独立 Coding Tools Feature 的实施与验证。

## 2026-07-26：第一个独立 Coding Tools Feature

### 目标

让 `runtime-tools` 开始真正拥有工具实现，而不是继续永久转发 `coding-agent`，并用一个完整纵向切片验证：

```text
TypeBox Schema
-> CodingToolsFeature
-> FeatureCompiler
-> RuntimeSnapshot
-> AgentCoreTurnEngine
-> agent-core 参数校验与 Tool Loop
-> 标准 Tool Result
```

### 迁移选择

首个工具选择 `current_time`，原因是：

- 没有文件写入、进程启动或权限副作用。
- 可以注入确定性时间源，验证 Feature 和 Tool 隔离。
- 可以直接对比旧新 Tool Schema、模型描述和执行结果。
- 不需要提前复制旧 `read` 的图片处理、锚点、截断和模糊路径规则。
- 不需要在 Workspace Path Policy 尚未冻结时迁移 `write`。

这只是架构纵向切片，不代表 `current_time` 比 read、edit 或 process 更重要。

### 修改范围

- 新增 `@vetta/runtime-tools/coding` 子入口：
  - `tools/current-time/current-time-tool.ts`
  - `tools/current-time/description.ts`
  - `tools/current-time/index.ts`
  - `coding-tools-feature.ts`
  - `index.ts`
- 新增 `createCurrentTimeTool()`：
  - TypeBox 输入 Schema。
  - `Static<typeof Schema>` 静态输入类型。
  - 可注入 `now()`，默认使用系统时间。
  - 保持旧工具在直接调用时的执行语义。
- 新增 `createCodingToolsFeature()`：
  - Feature ID 为 `coding-tools`。
  - prepare 和 contribute 均传播取消。
  - 当前只贡献 `current_time`。
- `RuntimeToolDefinition<TInput>` 和 `RuntimeToolExecutionRequest<TInput>` 增加输入泛型。
- 新增包边界守卫，禁止 `runtime-tools/src/coding` 导入 `coding-agent`。
- 包根旧工具转发保持不变，避免提前切换生产调用方。

### 类型与校验

- 工具工厂返回 `RuntimeToolDefinition<CurrentTimeToolInput>`。
- 工具实现直接获得 TypeBox 推导的输入类型，不使用 `any` 或手写断言。
- Feature Compiler 在异构 Snapshot 边界将具体输入类型统一为 Runtime Tool 合同。
- AgentCoreTurnEngine 将 JSON Schema 交给 agent-core/AJV，且不额外收紧旧 Tool Schema。

### 明确未修改

- 未迁移 read、write、edit、search、bash 或 process。
- 未删除 `runtime-tools` 包根对 `coding-agent` 的兼容依赖。
- 未切换 Coding Profile、RuntimeHost、Desktop、CLI、RPC 或 IM。
- 未定义 Workspace Path Policy 或文件系统 Capability。
- 未复制旧工具的场景 scope、知识库和 Skill 目录规则。

### 测试

- `packages/runtime-tools`
  - `bun run test`
  - 2 个测试文件、5 个测试通过。
- 覆盖：
  - 注入时间源后的确定性结果。
  - 已取消 Signal 下直接调用仍保持旧执行结果。
  - Feature Compiler 到真实 agent-core Tool Loop 的完整执行。
  - 旧新 name、label、完整描述、Schema、content 和 details 差分一致。
  - 额外模型参数保持旧 Schema 的宽容度。
- `packages/runtime-core`
  - `bun run test`
  - 4 个测试文件、21 个测试通过。
- 质量守卫
  - `bunx vitest --run scripts/quality/quality-gates.test.mjs`
  - 21 个测试通过。
- Root TypeScript
  - `bunx tsgo --noEmit -p tsconfig.json`
  - 通过。
- `bun run check:quick`
  - 本次变更的 Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- `runtime-tools` 已拥有第一份完全不依赖 `coding-agent` 的工具源码。
- Runtime Tool 的 TypeBox Schema、静态输入类型和运行时参数校验形成单一来源。
- Feature 只贡献工具，不持有 Session、不决定 Policy、不访问模型。
- 新旧工具可以在迁移期并行存在，生产入口未受影响。

### 下一步

1. 先为 read 建立覆盖完整旧行为的差分合同。
2. 在保留路径、编码、图片、锚点和截断语义的前提下拆分 Read Operations。
3. read 完整差分通过后，再迁移 ls / grep 和 write / edit。
4. 每个工具同时运行旧实现、新 Feature 和 AgentCoreTurnEngine 合同测试。
