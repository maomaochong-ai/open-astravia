# 第 17 轮：宿主可执行文件解析 Port

## 目标

拆分旧 `ensureTool` 的职责，让 Runtime grep/find 只接收宿主解析出的 `rg`/`fd` 路径，不在
Runtime 内负责下载、版本选择或用户可见日志。

## 实施内容

- 新增 `CodingToolExecutableResolver`：
  - `resolve("rg")`
  - `resolve("fd")`
  - 返回可执行路径或 `undefined`
- 新增本地 Adapter：
  - 先查受管 bin 目录。
  - 再查 PATH 命令。
  - Windows 自动使用 `.exe` 后缀。
  - 不下载、不修改文件、不输出日志。
- `GrepToolOptions` 和 `FindToolOptions` 增加可选 `executableResolver`。
- 注入解析器时，grep/find 在每次执行时分别解析 `rg`/`fd`。
- 未注入解析器时保持原来的 `rg`/`fd` 默认命令名和错误语义。
- 增加解析器单元测试和 grep/find 注入合同测试。

## 明确未修改

- 没有修改旧 `coding-agent` 的 `ensureTool`、下载协议或生产入口。
- 没有把下载逻辑复制到 `runtime-tools`。
- 没有改变 grep/find 的模型描述、Schema、输出、路径、limit、取消或 scope 行为。
- 没有重建 Runtime Snapshot 或改变 Catalog 生命周期。

## 验证

- 宿主解析器测试：3 tests passed。
- Runtime grep 合同测试：4 tests passed。
- Runtime find 合同测试：4 tests passed。
- 后续全量 Runtime Tools 测试和仓库质量门禁作为本轮完成条件。

## 未解决问题

- 旧 `ensureTool` 尚未在新的 Composition Root 中实现结构化适配。
- `rg`/`fd` 的下载、版本和独立可执行打包仍缺少产物级测试。
- Photon/WASM 的资源定位仍属于后续 Host Packaging Gate。

## 下一步

在 Composition Root 中把旧下载器适配到 `CodingToolExecutableResolver`，然后为下载失败、
并发解析、版本锁定、Windows/Unix 产物和离线模式建立宿主级合同；Runtime 工具继续只依赖
Port。
