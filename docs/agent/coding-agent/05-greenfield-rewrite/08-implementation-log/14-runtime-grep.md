# 实施日志：Grep 行为兼容、独立 Runtime 实现与 Tool Loop 接入

## 2026-07-26

### 目标

- 按照上一轮确定的迁移顺序，选择 `grep` 作为首个复杂只读工具。
- 保留旧 grep 的模型描述、Schema、scope、搜索结果和取消行为。
- 将工具实现从 `coding-agent` 的工具下载器和旧 Tool 类型中分离。
- 接入 `CodingToolRegistration`、Catalog 和 Model Call Frame。
- 使用真实 Agent Core Tool Loop 验证，而不是只测试 Runtime Tool 的直接调用。

### 旧行为审计

旧实现的可观察合同包括：

- pattern、path、glob、ignoreCase、literal、context、limit 参数。
- 单文件输出文件名；目录输出相对路径。
- ripgrep JSON 行事件转为匹配行和上下文行。
- 匹配行格式 `path:line:hash: content`。
- 上下文行格式 `path-line:hash- content`。
- 匹配行锚点使用完整行内容计算，展示截断不改变 hash。
- 默认最多 100 个匹配，达到限制时停止子进程并追加提示。
- 总字节截断、长行截断和结构化 details。
- 空结果返回 `No matches found`。
- 路径不存在、ripgrep 启动失败和取消返回既有错误文本。
- `scope_use` 覆盖所有现有 Coding 场景，category 为 `core`。

本轮没有扩大或缩小这些能力范围。旧描述文件中的历史文案（包括 30KB/2000 字符说明）
保持逐字一致；实际执行结果继续由旧实现差分测试作为判定依据。

### 实施范围

#### `packages/runtime-tools/src/coding/tools/grep`

- 新增 `grep-tool.ts`：
  - TypeBox 输入 Schema。
  - Runtime Tool 请求/结果适配。
  - ripgrep 子进程解析。
  - 目录/单文件路径格式化。
  - context、anchor hash、匹配限制、总字节和单行截断。
  - `AbortSignal` 提前取消和执行中取消。
- 新增 `description.ts`，使用 TS 常量保存模型描述，不再依赖 `description.txt` 生成链。
- 新增 `registration.ts`，单独保存 scope/category 元数据。
- 新增 `index.ts` 子入口。

#### 宿主依赖边界

- Runtime grep 不导入 `coding-agent` 的 `ensureTool`。
- 默认使用 PATH 中的 `rg`。
- Composition Root 可以通过 `GrepToolOptions.rgPath` 注入已下载或受控版本的 ripgrep。
- 文件读取通过 `GrepOperations` 注入，未来可接远程或沙箱文件系统。
- 下载、版本选择、权限和进程策略不进入 Runtime grep 领域实现。

#### Catalog 与 Feature

- `createGrepToolRegistration()` 可直接放入 `InMemoryCodingToolRegistry`。
- `CodingToolsFeature` 无需修改具体工具分支；仍按 Catalog Snapshot 和激活策略动态物化。
- Model Call Frame 只暴露 active grep Entry。
- 工具在模型看到后被 deactivate、revoke 或 unregister 时，继续由上一轮 Catalog 执行仲裁合同处理。

### 明确未修改

- 未把 grep 加入旧生产入口或切换 RuntimeHost、Desktop、CLI、RPC、IM。
- 未改变旧 grep 的 `scope_use`、category、Schema、描述和结果格式。
- 未把 ripgrep 下载逻辑复制到 Runtime Tools。
- 未迁移 glob、find、edit、write 或 process。
- 未修改 Runtime Snapshot、Context Strategy、Session Storage 或 MCP/Skill 实现。

### 测试

- `packages/runtime-tools/test/coding/grep/grep-runtime-contract.test.ts`
  - 定义和注册元数据与旧实现比较。
  - context、anchor、limit notice 和完整结果差分。
  - 提前取消。
- `packages/runtime-tools/test/coding/coding-tools-feature.test.ts`
  - 新增真实 Agent Core Tool Loop grep 执行。
  - 验证 Model Call Frame 只暴露 grep。
- Runtime Tools 完整测试：8 个文件、102 项通过。
- `bun run check:quick` 通过。

### 下一步

1. 为宿主组合根设计统一的 ripgrep 路径解析/下载 Port，保持 Runtime grep 只接收已解析路径。
2. 迁移 `glob` 或 `find`，复用路径解析、Catalog 生命周期和差分测试框架。
3. 只读工具组稳定后，再评估将其接入新的 Coding Profile；在完整工具矩阵和宿主产物测试
   通过前，不切换旧生产入口。
