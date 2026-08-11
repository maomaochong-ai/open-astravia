# 第 23 轮：网络边界、独立产物验证与 CLI Composition Root

## 目标

完成一个完整宿主阶段：隔离版本查询和 HTTP 下载，验证重试与错误语义，使用本地真实
归档验证独立安装链路，并在不制造 `coding-agent ↔ runtime-tools` 直接循环的前提下接入
新的 Runtime Tools Composition Root。

## 实施内容

- 新增 `ToolHttpRequest` / `ToolHttpResponse`：
  - 版本查询和归档下载都可以注入 HTTP 请求实现。
  - 生产默认仍使用全局 `fetch`。
- 新增 `parseLatestReleaseVersion`：
  - 支持 `v1.2.3` 和 `1.2.3`。
  - 缺失或错误的 `tag_name` 返回明确错误。
- 新增 `fetchLatestVersion`：
  - 保留 GitHub URL、User-Agent、超时和 HTTP 错误语义。
- 新增 `downloadFileWithRetry`：
  - 保留 TypeError/TimeoutError 重试。
  - HTTP 非成功响应不重试。
  - 通过可选重试参数让测试不等待真实退避时间。
- 新增网络合同测试：
  - 版本响应解析。
  - 版本接口 HTTP 503。
  - 下载瞬时错误两次后成功。
  - 下载 HTTP 404 不重试。
- 新增本地真实 tar.gz 产物测试：
  - 使用系统 tar 创建临时归档。
  - 走实际解压、嵌套目录二进制定位、移动、chmod 和清理。
  - 验证最终二进制内容和 staging 文件删除。
- 在 `cli-app` 新增 `createCodingToolsRuntimeComposition`：
  - 创建旧 `ensureTool` 的 Runtime Resolver Adapter。
  - 注册 current_time/read/ls/glob/grep/find。
  - 通过 `CodingToolsFeature` 和 `FeatureCompiler` 生成 Runtime Profile。
  - 默认 CLI scope 暴露 current_time/glob/grep/read，find/ls 仍需显式激活。
  - Adapter 只在工具执行时解析 `rg`/`fd`，不构建快照路径缓存。

## 依赖边界决策

当前 `runtime-tools` 包根仍保留旧 `@vetta/coding-agent` 兼容导出，因此不能让
`coding-agent` 直接依赖 `runtime-tools` 作为组合根。组合根暂时放在 `cli-app`：

```text
cli-app
  -> coding-agent Adapter
  -> runtime-tools/coding
  -> runtime-core

runtime-tools/coding -X-> coding-agent
```

这样可以验证新的 Runtime Profile，但不把旧 CLI 入口切换到新 Runtime，也不新增
`coding-agent ↔ runtime-tools` 直接循环。待 runtime-tools 根兼容导出拆除后，再把产品级
Composition Root 上移回 coding-agent。

## 明确未修改

- 没有访问 GitHub 真实网络。
- 没有修改旧 `ensureTool` 的默认下载策略、重试次数或用户可见日志。
- 没有切换旧 coding-agent CLI、Desktop 或 RPC 生产入口。
- 没有把下载器或归档安装逻辑放入 Runtime Tools。

## 验证

- `packages/coding-agent/test/tools-manager-resolver.test.ts`：20 项通过。
- `packages/cli-app/test/runtime-tools-composition.test.ts`：2 项通过。
- `bun install --lockfile-only` 完成 workspace 依赖锁定。
- `bun run check:quick` 通过。
- `bun run check` 通过。

## 未解决问题

- 真实 GitHub 网络、生产包管理器和最终独立可执行文件仍需发布前验证。
- `cli-app` Composition Root 目前是并行新链路，未替代旧入口。
- runtime-tools 包根兼容导出仍阻止 coding-agent 直接消费 runtime-tools。

## 下一步

继续迁移 runtime-tools 包根兼容导出，建立 coding-agent 产品级 Composition Root；迁移前
必须先完成新旧 Tool Profile 的差分测试和 CLI/桌面入口适配。
