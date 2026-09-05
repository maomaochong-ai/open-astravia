# ADR-0107：插件私有存储采用文件合同与 revision 提交

## 状态

已接受

## 背景

旧 `PluginStorageApi` 同时暴露 `readJson/writeJson` 与 Base64 `readFile/writeFile`。JSON API 的参数名曾被
理解成逻辑 key，但宿主实际把它直接当文件名，因此 `writeJson("settings", value)` 产生的是无扩展名
`settings` 文件。API 还只能保证单文件临时文件替换；JSK 等插件需要把多个上游接口拆成独立文件，同时
要求读者永远看到同一批次的数据，顺序 rename 多个目标无法在进程中断时提供这个保证。

## 决策

1. Plugin API 2.0 删除 `readJson/writeJson`，不保留兼容别名。私有存储只提供文件资源原语：
   `list`、`readFile`、`writeFile`、`readSnapshot`、`commit`。路径始终是插件命名空间内的相对路径，
   不追加扩展名；编码必须显式为 `utf8` 或 `base64`。JSON 由插件用 `JSON.parse/stringify` 序列化，
   SDK 可提供不改变底层合同的 `readJsonFile/writeJsonFile` 便利函数。
2. `commit(changes, { expectedRevision? })` 一次提交至多 128 个 write/remove；成功返回新的 revision。
   `expectedRevision` 用于乐观并发控制，不匹配时返回 `CAPABILITY_CONFLICT`。
3. `readSnapshot(paths, encoding)` 先固定一个 revision，再从该 revision 读取所有路径；缺失文件返回
   `null`。单文件 `writeFile` 是一次单 change commit。
4. 宿主物理存储使用不可变 object、不可变 revision manifest 与原子替换的 `.storage/HEAD`。所有 object
   和 manifest 写完后才切换 HEAD；切换前中断只会留下不可见孤儿，切换后读者只看到完整新 revision。
   `.storage` 是宿主保留路径。Blob 继续作为宿主管理的媒体资源，独立于逻辑文件 revision。
5. 首次读取时，宿主把旧目录中的普通文件导入初始 revision；`blobs`、`blob-metadata` 和旧事务目录不作为
   逻辑文件导入。该迁移保留数据，但不恢复已删除的旧 API。
6. 这是破坏性合同变更，宿主 Plugin API 版本提升到 `2.0.0`；仓库内插件和官方市场插件同步更新。

## 备选方案

- **保留 `writeJson` 并增加 `writeJsonBatch`。** 继续把格式和事务能力绑定，文本、二进制或其它序列化格式
  会重复增加专用 API。
- **逐个临时文件 rename 到三个目标。** 单文件替换是原子的，但多个 rename 之间仍存在可观察的半更新状态。
- **把全部数据合成一个 JSON。** 能借用单文件原子替换，但破坏上游数据边界，大文件任一部分变化都要整体重写，
  也让工具和人工排查无法独立定位数据源。

## 后果

- 插件作者必须明确文件名和编码；`settings.json` 与 `settings` 不再由 API 名称造成歧义。
- 多文件数据可以保持物理/逻辑拆分，并获得一致提交与一致读取。
- 旧 1.x 插件会在兼容性检查阶段被拒绝，而不是加载后因缺少方法才失败。
- 每次提交会产生不可变对象和 manifest；成功切换 HEAD 后，宿主尽力保留当前与上一 revision，并回收更早历史及不可见孤儿。回收失败不影响已提交结果。
