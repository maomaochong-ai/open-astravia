# Dir Tree 行为兼容、独立 Runtime 实现与 Profile 接入

## 目标

在不改变 `dir_tree` 功能的前提下，将工具定义、fd 扫描编排、树模型和输出限制迁入独立
Runtime，并通过现有宿主 Resolver 动态取得 fd。

## 修改范围

- 新增独立 `tools/tree` 目录，包含 TypeScript description、Tool、纯树模型、Registration 和导出。
- 使用原 TypeBox Schema，保留 `dir_tree` 名称、label、全场景 scope 和 `core` category。
- `TreeOperations` 只暴露 exists、stat 和 runFd；fd 可执行文件通过既有 Resolver 注入。
- 纯树模型负责 fd 路径标准化、树重建、目录优先排序、即时子节点计数和渲染。
- Composition Root 注册 Runtime tree，并将其加入 7 个场景 Tool Profile 差分。
- 新增旧、新共用差分合同。

## 当前责任边界

```text
Runtime tree
  TypeBox Schema / input normalization / errors / details
  tree model
    -> parse fd output
    -> rebuild hierarchy
    -> sort / count / render
  TreeOperations
    -> exists / stat / runFd
  CodingToolExecutableResolver
    -> resolve fd on every execution
```

Runtime 不负责下载、版本查询或宿主日志；Composition Root 继续通过 coding-agent Adapter
静默委托原 `ensureTool`，因此下载策略没有进入 Tool 实现。

## 行为兼容证据

- name、label、description、Schema、scope 和 category 逐字段相等。
- fd 目录/文件扫描参数及调用顺序相等。
- `[D]/[F]`、目录优先排序、即时子目录/文件计数、层级线和 node type tag 相等。
- directory-only、hidden、ignore、maxDepth 取整和 limit 取整相等。
- node limit、scan limit、50KB truncation details 和组合提示相等。
- 路径不存在、非目录、fd 不可用、目录/文件扫描失败和提前取消错误相等。
- 7 个场景的 Tool Profile 差分继续为零。

## 明确未修改

- 没有修改旧 `createTreeTool`、旧默认工具集合或旧 AgentSession。
- 没有改变 fd 下载、版本、归档或 PATH 解析策略。
- 没有新增目录遍历实现；默认行为仍由 fd 提供并遵守 `.gitignore`。
- 没有改变工具描述中已经存在的 path ID 文案，也没有夹带新的 path ID 功能。
- 没有引入 Zod；原 TypeBox Schema 足以保持模型输入合同。

## 验证结果

- Tree 旧新差分合同 10 项通过。
- Runtime Tools 全包 15 个测试文件、155 项测试通过。
- CLI Composition Root 9 项通过。
- `check:quick`、Runtime Tools 独立包类型检查、lint 和质量 guards 通过。
- 完整 `bun run check` 的类型阶段仍被既有
  `capability-runtime/test/registry.test.ts`、`runtime-core/test/kernel/turn-pipeline.test.ts` 和旧
  Tool 差分测试的函数参数型变错误阻断；没有错误指向本轮 tree 实现。

## 下一步

迁移 write。先建立路径解析、父目录创建、内容逐字节写入、受保护目录告警、错误和取消合同；
再把文件系统副作用收敛到 WriteOperations。write 通过后再迁移 edit 的锚点、模糊匹配、重复
匹配、BOM 与 CRLF/LF 保持语义。
