# 第 16 轮：Runtime Glob

## 目标

在不改变旧 `glob` 工具可观察行为的前提下，把实现从 `coding-agent` 移到
`@vetta/runtime-tools/coding/tools/glob`，并接入动态 Coding Tool Catalog 与 Agent Core
Tool Loop。

## 实施内容

- 新增独立 `glob/` 工具目录：
  - `glob-tool.ts`：Runtime Tool、TypeBox Schema、路径解析、`.gitignore` 过滤、结果格式化和
    可注入 `GlobOperations`。
  - `description.ts`：保留旧 `description.txt` 的完整模型描述。
  - `registration.ts`：保留旧全 scope 暴露和 `core` 分类。
  - `index.ts`：提供明确的 Coding 子入口。
- Runtime 包直接声明 `glob` 与 `ignore` 依赖，移除对旧实现传递依赖的隐式依赖。
- 将 `glob` 导出到 `@vetta/runtime-tools/coding`。
- 在 Feature 契约中注册并显式激活 `glob`，通过真实 `AgentCoreTurnEngine` Tool Loop 验证。
- 增加旧新差分测试，覆盖完整定义、注册元数据、去重、相对路径、目录标记、绝对模式和
  `.gitignore`。
- 为 Vitest 将 `glob`/`ignore` 外部化，保持 ESM 宿主依赖由 Node 解析。

## 明确未修改

- 没有修改旧 `coding-agent` 的 `glob` 实现或生产入口。
- 没有修改工具描述、Schema、结果文案、limit、取消和路径语义。
- 没有把工具默认暴露范围扩大到旧实现之外。
- 没有把宿主依赖下载、版本选择和打包逻辑塞入 Runtime。

## 验证

运行结果：

- `bunx vitest --run test/coding/glob/glob-runtime-contract.test.ts`
  - 4 tests passed。
- `bunx vitest --run test/coding/coding-tools-feature.test.ts`
  - 12 tests passed。
- `bun run test`（`packages/runtime-tools`）
  - 10 test files、111 tests passed。

## 未解决问题

- Runtime Tools 尚未替代 `coding-agent` 的生产 Profile。
- `glob` 的宿主打包和独立可执行产物验证仍需在 Composition Root 阶段完成。
- 其他写入、进程和编辑能力仍未迁移。

## 下一步

优先进入宿主可执行解析/打包层，统一处理 `rg`、`fd`、Photon 和其他外部依赖；或者继续
迁移下一个只读工具。两条路径都必须沿用同一差分合同和动态 Catalog 边界。
