# 第 19 轮：宿主适配器边界与行为合同

## 目标

将旧工具下载策略与 Agent 内核目录解耦，并为现有 `ensureTool` 建立不触发真实网络的
行为锁定测试，确保后续迁移只改变结构，不改变工具可用性策略。

## 实施内容

- 新增 `EnsureToolDependencies`，把路径查找、离线判断、平台判断和下载动作作为内部
  可注入依赖。
- 新增 `ensureToolWithDependencies`，保留旧 `ensureTool` 的判断顺序、日志文案、失败
  返回值和 Termux 分支。
- `ensureTool` 仍使用原有默认依赖，因此旧 grep/find/tree 的生产调用和功能没有改变。
- 将 Runtime 适配器入口调整到：
  `src/adapters/runtime-tools/executable-resolver.ts`。
- `src/core/host/executable-resolver.ts` 保留为迁移期转发入口，避免已建立的导出路径立即失效。
- 新增组合层公共子路径：
  `@vetta/coding-agent/host`（稳定子路径；内部实现仍在 `adapters/runtime-tools`）。
- 新增行为测试，覆盖：
  - 已有受管可执行文件时不下载。
  - 离线模式不下载。
  - Android/Termux 不下载。
  - 下载成功透传路径。
  - 下载失败返回 `undefined`。

## 明确未修改

- 没有修改 `ensureTool` 的下载 URL、版本选择、重试和安装流程。
- 没有修改 coding-agent 旧 grep/find/tree 的直接调用。
- 没有把下载策略或 `coding-agent` 依赖引入 Runtime Tools。
- 没有进行网络下载、产物构建或生产 Profile 切换。

## 验证

- 新增测试不访问真实网络，所有下载行为均使用注入函数。
- `bunx vitest --run test/tools-manager-resolver.test.ts` 通过。
- 根仓库 `bun run check:quick` 和 `bun run check` 通过。

## 未解决问题

- 旧 grep/find/tree 尚未切换为通过 Resolver 注入。
- 并发下载、版本锁定、独立产物打包和跨平台路径仍缺少产物级合同。
- Runtime Port 类型与 coding-agent Adapter 类型仍是结构兼容，尚未建立直接包级类型依赖。

## 下一步

先为宿主产物和并发行为建立测试矩阵，再在 Composition Root 中将 Resolver 注入新的
Runtime Tool Registry；通过差分验证后，才删除旧工具的直接 `ensureTool` 依赖。
