# 第 20 轮：Runtime 可执行文件实时重解析

## 目标

验证宿主工具在 Runtime 运行期间发生变化时，下一次工具执行能够看到最新状态，不依赖
Turn 级或 Runtime Snapshot 级的旧可执行文件路径。

## 实施内容

- 为本地 `CodingToolExecutableResolver` 增加动态行为测试：
  - 受管 bin 存在时优先返回受管路径。
  - 受管文件移除后重新检查 PATH。
  - PATH 命令也不可用后返回 `undefined`。
- 为 Runtime grep 增加重复执行合同，确认每次执行都会重新调用 `resolve("rg")`。
- 为 Runtime find 增加重复执行合同，确认每次执行都会重新调用 `resolve("fd")`。
- 将旧 Runtime Adapter 实现从 `tools-manager.ts` 移到
  `adapters/runtime-tools/executable-resolver.ts`，工具下载模块不再持有 Runtime Port
  类型和 Adapter 工厂。

## 明确未修改

- 没有缓存可执行文件解析结果。
- 没有修改 grep/find 的输出、错误文本、Schema 或取消语义。
- 没有修改旧 coding-agent grep/find/tree 的 `ensureTool` 生产调用。
- 没有引入并发下载、网络访问或产物构建。

## 验证

- coding-agent 定向测试：6 项通过。
- Runtime Tools 宿主、grep、find 定向测试：14 项通过。
- 测试覆盖宿主可执行文件移除、PATH 回退和重复执行重新解析。

## 未解决问题

- Composition Root 尚未把 coding-agent Adapter 接入新 Runtime Profile。
- 下载并发、版本锁定、独立产物打包和跨平台安装仍缺少产物级合同。
- Runtime Port 与 coding-agent Adapter 仍通过结构类型兼容，尚未建立直接包级类型共享。

## 下一步

建立宿主下载与打包的可注入测试矩阵，然后在独立 Composition Root 中注册 Runtime 工具；
通过旧新差分后，再迁移旧工具的直接 `ensureTool` 调用。
