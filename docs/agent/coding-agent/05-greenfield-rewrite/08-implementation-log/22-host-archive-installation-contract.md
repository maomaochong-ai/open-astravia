# 第 22 轮：宿主归档安装与清理合同

## 目标

把下载后的归档解压、二进制定位、权限设置和清理从网络下载流程中分离，并在不触发真实
网络或文件系统的前提下锁定安装行为。

## 实施内容

- 新增 `ToolArchiveOperations`，注入：
  - tar.gz / zip 解压。
  - 文件存在检查和递归二进制定位。
  - 文件移动、Unix 权限设置。
  - 归档和临时目录清理。
- 新增 `installToolArchive`，保留旧流程的：
  - tar.gz 与 zip 分支。
  - 版本目录嵌套二进制查找。
  - 缺失二进制错误文本。
  - Unix chmod、Windows 不 chmod。
  - 成功和失败时的 finally 清理。
- `downloadTool` 继续使用默认操作实现，网络、版本查询和下载流程没有改变。
- 新增测试覆盖：
  - tar.gz 嵌套二进制成功安装。
  - Windows zip 安装且不修改权限。
  - 二进制缺失时仍然清理归档和临时目录。

## 明确未修改

- 没有发起网络请求、执行真实解压或写入用户工具目录。
- 没有修改旧 `ensureTool`、grep/find/tree 或下载重试行为。
- 没有引入下载缓存、并发单飞或新的版本策略。
- 没有把归档安装边界放入 Runtime Tools。

## 验证

- `test/tools-manager-resolver.test.ts`：14 项通过。
- 根仓库 `bun run check:quick` 和 `bun run check` 通过。

## 未解决问题

- 真实 GitHub 下载、归档内容和独立可执行产物仍未验证。
- 下载失败重试与归档安装失败的端到端合同仍未覆盖。
- Composition Root 尚未将 Adapter 接入新的 Runtime Profile。

## 下一步

继续为网络下载和版本查询增加可注入边界测试，再进行独立可执行打包验证；所有真实网络
测试必须保持显式隔离，不进入常规单元测试。
