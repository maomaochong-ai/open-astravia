# 实施日志：Find 行为兼容、空 scope 与显式 Tool Loop 接入

## 2026-07-26

### 目标

- 迁移第二个搜索类只读工具 `find`。
- 保留旧工具的空 `scope_use` 默认不激活语义。
- 将 fd 下载器和 glob 实现留在宿主/Operations 边界。
- 验证空 scope 工具可以通过 explicit activation 进入 Model Call Frame 和 Agent Core Tool Loop。

### 旧行为审计

旧 find 的可观察合同包括：

- `pattern`、`path`、`limit` 参数。
- 描述、name、label、Schema、`scope_use: []`、category `core`。
- 基于 cwd 的相对路径、绝对路径和 Unicode 路径解析。
- 结果路径相对搜索目录输出，目录保持 `/` 后缀。
- 隐藏文件可见，但 `.gitignore`、`node_modules` 和 `.git` 被排除。
- 默认 1000 个结果。
- 结果上限 notice、总字节截断和 details。
- 空结果 `No files found matching pattern`。
- 路径不存在、fd 不可用和取消错误。

本轮没有把 `find` 改成 scope 默认工具；如果模型没有显式选择，它仍然不会出现在任何
场景的默认 Tool 清单中。

### 实施范围

#### `packages/runtime-tools/src/coding/tools/find`

- 新增 `find-tool.ts`：
  - TypeBox 输入 Schema。
  - Runtime Tool 请求/结果适配。
  - fd 子进程输出解析。
  - 自定义 `FindOperations.glob` 执行路径。
  - 相对路径、目录尾部 `/`、结果上限和截断。
  - `AbortSignal` 提前取消和执行中取消。
- 新增 `description.ts`，逐字保留旧模型描述。
- 新增 `registration.ts`，固定 `FIND_TOOL_SCOPES = []` 和 `core` category。
- 新增 `index.ts` 子入口。

#### 宿主依赖边界

- Runtime find 不导入 `coding-agent` 的 `ensureTool`。
- 默认使用 PATH 中的 `fd`。
- Composition Root 可以通过 `FindToolOptions.fdPath` 注入已下载或受控版本的 fd。
- 远程/沙箱文件搜索通过 `FindOperations.exists` 和 `FindOperations.glob` 注入。
- fd 下载、版本选择、权限和打包定位不进入 Runtime find。

#### Catalog 与 Feature

- `createFindToolRegistration()` 可直接注册到 Catalog。
- Feature 不增加 find 特殊分支。
- 空 scope 的 find 只有在 explicit activation 中进入 Model Call Frame。
- deactivate、revoke、unregister 继续复用统一 Catalog 执行仲裁。

### 明确未修改

- 未修改旧生产入口、RuntimeHost、Desktop、CLI、RPC 或 IM。
- 未把 find 默认加入任何 Coding 场景。
- 未迁移 glob、edit、write 或 process。
- 未把 fd 下载器复制到 Runtime Tools。
- 未修改 Session、Context、Snapshot 或 MCP/Skill 生命周期。

### 测试

- `find-runtime-contract.test.ts`
  - 旧新定义和注册元数据逐字段比较。
  - 空 scope 默认不激活。
  - 自定义 glob 结果、相对路径和限制参数差分。
  - explicit activation 验证。
- `coding-tools-feature.test.ts`
  - 使用自定义 `FindOperations` 显式激活 find。
  - 通过真实 Agent Core Tool Loop 执行并验证模型可见工具。
- Runtime Tools 完整测试：9 个文件、106 项通过。
- `bun run check:quick` 通过。
- `bun run check` 通过。

### 下一步

1. 迁移 `glob`，重点验证文件名模式、排序、隐藏路径和取消 Port。
2. 为 fd/rg 统一建立宿主可执行文件解析 Port 和产物级测试。
3. 只读工具矩阵稳定后，再评估新的 Coding Profile 装配，不切换旧生产入口。
