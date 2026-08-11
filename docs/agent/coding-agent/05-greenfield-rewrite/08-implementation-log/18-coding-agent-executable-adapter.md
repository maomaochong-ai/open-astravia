# 第 18 轮：Coding Agent 宿主解析适配

## 目标

把旧 `ensureTool("rg" | "fd")` 适配到 Runtime 的可执行文件解析 Port，保持下载、离线、
Termux、失败日志和版本选择仍由 `coding-agent` 拥有。

## 实施内容

- 在 `coding-agent/src/utils/tools-manager.ts` 新增：
  - `ToolExecutableName`
  - `EnsureTool`
  - `ToolExecutableResolver`
  - `createToolExecutableResolver`
- 通过 `@vetta/coding-agent/core/host/executable-resolver.js` 发布明确子入口，不把
  `tools-manager` 的下载细节暴露给组合根。
- Adapter 每次 `resolve()` 都以 `silent: true` 委托 `ensureTool`。
- Resolver 结果原样透传：
  - 已存在或下载成功：返回路径/命令名。
  - 不可用或下载失败：返回 `undefined`。
- 没有把 Runtime Tools 加入 `coding-agent`，避免形成反向依赖。
- 新增单元测试验证静默委托、`rg/fd` 参数和不可用结果。

## 明确未修改

- 没有改变 `ensureTool` 的 PATH 检查、受管 bin 目录、下载、重试、离线或 Termux 行为。
- 没有修改旧 grep/find 工具或生产工具列表。
- 没有在 Runtime 中引入 `coding-agent`。
- 没有开始产物构建、网络下载或生产 Profile 切换。

## 验证

- `bunx vitest --run test/tools-manager-resolver.test.ts`
  - 2 tests passed。

后续还需运行 Runtime Tools 全量测试、coding-agent 相关门禁和根仓库质量检查。

## 未解决问题

- Runtime 新 Profile 尚未在实际 Composition Root 中装配。
- 下载并发、版本锁定、离线模式和独立可执行打包仍缺少产物级合同。
- Photon/WASM 仍需单独完成资源复制和定位验证。

## 下一步

优先建立宿主级解析/打包测试矩阵，随后再把 Resolver 注入真实的新 Profile Registry；在这些
测试通过前，不删除旧生产工具链。
