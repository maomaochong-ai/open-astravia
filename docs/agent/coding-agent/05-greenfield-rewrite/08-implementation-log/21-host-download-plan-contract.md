# 第 21 轮：宿主下载计划与跨平台产物合同

## 目标

在不触发网络、不执行解压、不改变旧下载流程的前提下，锁定 `fd`/`rg` 的版本、平台、
架构、归档文件名、安装路径和下载 URL 规则。

## 实施内容

- 新增纯函数 `createToolDownloadPlan`，根据工具、版本、平台、架构和工具目录生成：
  - 归档文件名。
  - 归档路径。
  - 二进制文件名。
  - 安装路径。
  - GitHub Release 下载 URL。
- `downloadTool` 继续负责真实版本查询、下载、解压、二进制查找、权限设置和清理；
  仅改为消费下载计划，行为顺序和错误文本保持不变。
- 新增跨平台下载计划合同：
  - fd：macOS arm64、Windows x64。
  - rg：Linux arm64、Linux x64。
  - 不支持的平台返回空计划。

## 明确未修改

- 没有发起网络请求或解压归档。
- 没有修改版本查询、重试、下载、安装和临时目录策略。
- 没有修改旧 grep/find/tree 的生产调用。
- 没有将下载计划放入 Runtime Tools；它仍属于 coding-agent 宿主层。

## 验证

- `test/tools-manager-resolver.test.ts`：11 项通过。
- 根仓库 `bun run check:quick` 和 `bun run check` 通过。

## 未解决问题

- 真实下载、归档内容、权限设置和独立可执行产物仍未进行产物级验证。
- 同一工具的并发下载去重策略尚未设计；当前仍保持旧行为。
- Composition Root 尚未将 Adapter 接入新的 Runtime Profile。

## 下一步

为下载器增加可注入的网络、归档和文件系统边界测试，再决定是否需要并发下载协调器；
在不改变旧行为前，不主动引入缓存或单飞机制。
